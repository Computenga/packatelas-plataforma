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
 * a /api/driver/location cada 30 s; también revisa avisos cada minuto y se apaga solo
 * si la plataforma dice que el turno terminó.
 */
public class LocationService extends Service implements LocationListener {
    private static final long SEND_EVERY_MS = 30_000;
    private static final long NOTICES_EVERY_MS = 60_000;
    private static final long MIN_INTERVAL_MS = 15_000;
    private static final float MIN_METERS = 20f;

    private final List<JSONObject> buffer = new ArrayList<>();
    private HandlerThread thread;
    private Handler handler;
    private LocationManager lm;
    private long lastFix = 0;

    static void start(Context c) {
        Api.prefs(c).edit().putBoolean("onDuty", true).apply();
        c.startForegroundService(new Intent(c, LocationService.class));
    }

    static void stop(Context c) {
        Api.prefs(c).edit().putBoolean("onDuty", false).apply();
        c.stopService(new Intent(c, LocationService.class));
    }

    static boolean hasPermission(Context c) {
        return c.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
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
            try {
                if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER))
                    lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, MIN_INTERVAL_MS, MIN_METERS, this, thread.getLooper());
                if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER))
                    lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, MIN_INTERVAL_MS, MIN_METERS, this, thread.getLooper());
            } catch (SecurityException ignored) {
            }
            handler.postDelayed(sender, SEND_EVERY_MS);
            handler.post(notices);
        }
        return START_STICKY;
    }

    @Override
    public void onLocationChanged(Location l) {
        // Si llegan GPS y red casi al mismo tiempo, se queda el primero.
        if (l.getTime() - lastFix < 10_000) return;
        lastFix = l.getTime();
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

    private final Runnable sender = new Runnable() {
        @Override
        public void run() {
            List<JSONObject> batch;
            synchronized (buffer) {
                batch = new ArrayList<>(buffer);
                buffer.clear();
            }
            if (!batch.isEmpty()) {
                try {
                    JSONObject body = new JSONObject().put("points", new JSONArray(batch));
                    Object[] r = Api.request("POST", "/api/driver/location", body.toString());
                    int code = (int) r[0];
                    // Sin red o error del servidor: se reintenta en la siguiente vuelta.
                    if (code == 0 || code >= 500) synchronized (buffer) { buffer.addAll(0, batch); }
                } catch (Exception ignored) {
                }
            }
            handler.postDelayed(this, SEND_EVERY_MS);
        }
    };

    private final Runnable notices = new Runnable() {
        @Override
        public void run() {
            JSONObject j = Api.pollNotices(LocationService.this);
            if (j != null && !j.optBoolean("enTurno", true)) {
                // El turno se cerró desde la plataforma (u otra sesión): apagar el GPS.
                new Handler(Looper.getMainLooper()).post(() -> stop(LocationService.this));
                return;
            }
            handler.postDelayed(this, NOTICES_EVERY_MS);
        }
    };

    @Override
    public void onDestroy() {
        if (lm != null) lm.removeUpdates(this);
        handler.removeCallbacksAndMessages(null);
        handler.post(sender); // último envío
        thread.quitSafely();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
