package mx.packatelas.app;

import android.Manifest;
import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.BatteryManager;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Ubicación del repartidor durante el turno, aun con la pantalla apagada [R10, P03].
 * Corre como servicio en primer plano (notificación fija "En turno") y manda los puntos
 * a /api/driver/location; en la misma conexión revisa avisos, y se apaga solo si la
 * plataforma dice que el turno terminó.
 *
 * Batería y datos: el GPS se adapta. En movimiento pide un punto cada 15 s; detenido (entregando,
 * comiendo, en bodega) baja a uno por minuto, y con batería baja todo se espacia al doble.
 * Envío y avisos van juntos en una sola "ráfaga" de red cada 45 s (antes eran dos por separado),
 * y si no hay puntos nuevos no se manda nada.
 */
public class LocationService extends Service implements LocationListener {
    private static final long TICK_MS = 45_000;
    private static final int NOTICES_EVERY_TICKS = 2; // ~90 s
    private static final long STILL_AFTER_MS = 3 * 60_000;
    private static final int LOW_BATTERY_PCT = 20;

    private final List<JSONObject> buffer = new ArrayList<>();
    private HandlerThread thread;
    private Handler handler;
    private LocationManager lm;
    private long lastFix = 0;
    private long lastMoveAt = System.currentTimeMillis();
    private String mode = "";
    private int ticks = 0;

    static void start(Context c) {
        Api.prefs(c).edit().putBoolean("onDuty", true).apply();
        c.startForegroundService(new Intent(c, LocationService.class));
    }

    static void stop(Context c) {
        Api.prefs(c).edit().putBoolean("onDuty", false).apply();
        c.stopService(new Intent(c, LocationService.class));
    }

    /** Precisa o aproximada: con cualquiera de las dos el servicio manda ubicación. */
    static boolean hasPermission(Context c) {
        return c.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || c.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    static boolean hasPrecise(Context c) {
        return c.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    /** "Permitir todo el tiempo" (Android 10+). */
    static boolean hasBackground(Context c) {
        return android.os.Build.VERSION.SDK_INT < 29
                || c.checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    /** Ubicación del teléfono encendida (el interruptor de "Ubicación"/GPS). */
    static boolean deviceLocationOn(Context c) {
        LocationManager m = c.getSystemService(LocationManager.class);
        if (m == null) return false;
        if (android.os.Build.VERSION.SDK_INT >= 28) return m.isLocationEnabled();
        return m.isProviderEnabled(LocationManager.GPS_PROVIDER) || m.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        Api.channels(this);
        thread = new HandlerThread("ubicacion");
        thread.start();
        handler = new Handler(thread.getLooper());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        PendingIntent open = PendingIntent.getActivity(this, 1, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(this, Api.CH_TRACKING)
                .setSmallIcon(R.drawable.ic_notify)
                .setContentTitle("En turno")
                .setContentText("Packatelas está mandando tu ubicación")
                .setOngoing(true)
                .setContentIntent(open)
                .build();
        try {
            if (android.os.Build.VERSION.SDK_INT >= 29) startForeground(42, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            else startForeground(42, n);
        } catch (Exception e) {
            // Sin permiso de ubicación no se puede iniciar como servicio de ubicación.
            stopSelf();
            return START_NOT_STICKY;
        }
        if (lm == null && hasPermission(this)) {
            lm = getSystemService(LocationManager.class);
            applyMode();
            handler.postDelayed(tick, TICK_MS);
            handler.post(this::pollNotices);
        }
        return START_STICKY;
    }

    @Override
    public void onLocationChanged(Location l) {
        // Si llegan GPS y red casi al mismo tiempo, se queda el primero.
        if (l.getTime() - lastFix < 10_000) return;
        lastFix = l.getTime();
        // Con distancia mínima, cada punto que llega es movimiento real (o el primero de la red).
        if (LocationManager.GPS_PROVIDER.equals(l.getProvider()) || (l.hasSpeed() && l.getSpeed() > 1.5f)) {
            lastMoveAt = System.currentTimeMillis();
            if (mode.startsWith("still")) handler.post(this::applyMode);
        }
        try {
            JSONObject p = new JSONObject();
            p.put("lat", l.getLatitude());
            p.put("lng", l.getLongitude());
            if (l.hasAccuracy()) p.put("accuracy", l.getAccuracy());
            if (l.hasSpeed()) p.put("speed", l.getSpeed());
            BatteryManager bm = getSystemService(BatteryManager.class);
            int pct = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
            if (pct > 0) p.put("battery", pct / 100.0);
            java.text.SimpleDateFormat f = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US);
            f.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
            p.put("at", f.format(new java.util.Date(l.getTime())));
            synchronized (buffer) {
                buffer.add(p);
                while (buffer.size() > 500) buffer.remove(0);
            }
        } catch (Exception ignored) {
        }
    }

    /** Modo según movimiento y batería: intervalo y distancia del GPS. */
    private String wantedMode() {
        boolean still = System.currentTimeMillis() - lastMoveAt > STILL_AFTER_MS;
        boolean low = false;
        try {
            BatteryManager bm = getSystemService(BatteryManager.class);
            low = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) <= LOW_BATTERY_PCT && !bm.isCharging();
        } catch (Exception ignored) {
        }
        return (still ? "still" : "moving") + (low ? "-low" : "");
    }

    private void applyMode() {
        String m = wantedMode();
        if (m.equals(mode) || lm == null) return;
        mode = m;
        boolean still = m.startsWith("still");
        boolean low = m.endsWith("-low");
        long gpsMs = (still ? 60_000 : 15_000) * (low ? 2 : 1);
        float meters = (still ? 30f : 20f) * (low ? 1.5f : 1f);
        try {
            lm.removeUpdates(this);
            if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER))
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, gpsMs, meters, this, thread.getLooper());
            // La red (wifi/antenas) gasta poco: respaldo bajo techo o sin GPS, con menos frecuencia.
            if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER))
                lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, Math.max(gpsMs, 60_000), meters, this, thread.getLooper());
        } catch (SecurityException ignored) {
        }
    }

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            applyMode();
            sendPoints();
            // Avisos en la misma ráfaga de red que la ubicación: el módem se despierta una vez.
            if (++ticks % NOTICES_EVERY_TICKS == 0 && !pollNotices()) return;
            long next = TICK_MS * (mode.endsWith("-low") ? 2 : 1);
            handler.postDelayed(this, next);
        }
    };

    private void sendPoints() {
        List<JSONObject> batch;
        synchronized (buffer) {
            batch = new ArrayList<>(buffer);
            buffer.clear();
        }
        if (batch.isEmpty()) return;
        try {
            JSONObject body = new JSONObject().put("points", new JSONArray(batch));
            Object[] r = Api.request("POST", "/api/driver/location", body.toString());
            int code = (int) r[0];
            // Sin red o error del servidor: se reintenta en la siguiente vuelta.
            if (code == 0 || code >= 500) synchronized (buffer) { buffer.addAll(0, batch); }
        } catch (Exception ignored) {
        }
    }

    /** Devuelve false si el turno ya terminó (y apaga el servicio). */
    private boolean pollNotices() {
        JSONObject j = Api.pollNotices(LocationService.this);
        if (j != null && !j.optBoolean("enTurno", true)) {
            // El turno se cerró desde la plataforma (u otra sesión): apagar el GPS.
            new Handler(Looper.getMainLooper()).post(() -> stop(LocationService.this));
            return false;
        }
        return true;
    }

    @Override
    public void onDestroy() {
        if (lm != null) lm.removeUpdates(this);
        handler.removeCallbacksAndMessages(null);
        handler.post(this::sendPoints); // último envío
        thread.quitSafely();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
