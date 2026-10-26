package mx.packatelas.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Notification;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.webkit.CookieManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Llamadas a la plataforma con la misma sesión del WebView, y avisos del sistema. */
final class Api {
    static final String CH_NOTICES = "avisos";
    static final String CH_TRACKING = "turno";

    private Api() {}

    static String base() {
        return BuildConfig.BASE_URL.replaceAll("/+$", "");
    }

    static boolean isInternal(Uri u) {
        String host = u.getHost();
        if (host == null) return false;
        String own = Uri.parse(base()).getHost();
        return host.equalsIgnoreCase(own) || host.equalsIgnoreCase("admin.packatelas.mx") || host.equalsIgnoreCase("nuevo.packatelas.mx");
    }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("packatelas", Context.MODE_PRIVATE);
    }

    /** Petición HTTP con la cookie de sesión. Devuelve [código, cuerpo]; código 0 si no hubo red. */
    static Object[] request(String method, String path, String json) {
        HttpURLConnection con = null;
        try {
            con = (HttpURLConnection) new URL(base() + path).openConnection();
            con.setRequestMethod(method);
            con.setConnectTimeout(15000);
            con.setReadTimeout(20000);
            con.setInstanceFollowRedirects(false);
            String cookie = CookieManager.getInstance().getCookie(base());
            if (cookie != null) con.setRequestProperty("Cookie", cookie);
            con.setRequestProperty("Accept", "application/json");
            con.setRequestProperty("User-Agent", "PackatelasAndroid/" + BuildConfig.VERSION_NAME);
            if (json != null) {
                con.setDoOutput(true);
                con.setRequestProperty("Content-Type", "application/json");
                try (OutputStream os = con.getOutputStream()) {
                    os.write(json.getBytes(StandardCharsets.UTF_8));
                }
            }
            int code = con.getResponseCode();
            InputStream is = code < 400 ? con.getInputStream() : con.getErrorStream();
            String body = "";
            if (is != null) {
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = is.read(buf)) > 0) bo.write(buf, 0, n);
                body = bo.toString("UTF-8");
                is.close();
            }
            return new Object[]{code, body};
        } catch (Exception e) {
            return new Object[]{0, ""};
        } finally {
            if (con != null) con.disconnect();
        }
    }

    static void channels(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        NotificationChannel a = new NotificationChannel(CH_NOTICES, "Avisos", NotificationManager.IMPORTANCE_HIGH);
        a.setDescription("Rutas asignadas, recibos, documentos y fallas");
        nm.createNotificationChannel(a);
        NotificationChannel t = new NotificationChannel(CH_TRACKING, "Turno y ubicación", NotificationManager.IMPORTANCE_LOW);
        t.setDescription("Indica que la app manda tu ubicación mientras estás en turno");
        nm.createNotificationChannel(t);
    }

    /** Consulta avisos nuevos y los muestra. Devuelve el JSON completo (o null sin sesión/red). */
    static JSONObject pollNotices(Context c) {
        SharedPreferences p = prefs(c);
        String after = p.getString("lastNotice", null);
        String path = "/api/app/avisos" + (after != null ? "?despues=" + Uri.encode(after) : "");
        Object[] r = request("GET", path, null);
        if ((int) r[0] != 200) return null;
        try {
            JSONObject j = new JSONObject((String) r[1]);
            JSONArray list = j.optJSONArray("avisos");
            if (list != null) {
                for (int i = 0; i < list.length(); i++) {
                    JSONObject a = list.getJSONObject(i);
                    // La primera vez solo se marca el punto de partida, sin mostrar avisos viejos.
                    if (after != null) show(c, a.optString("id").hashCode(), a.optString("titulo"), a.optString("texto"), a.optString("url", null));
                    p.edit().putString("lastNotice", a.optString("fecha")).apply();
                }
            }
            if (after == null && (list == null || list.length() == 0)) {
                p.edit().putString("lastNotice", nowIso()).apply();
            }
            return j;
        } catch (Exception e) {
            return null;
        }
    }

    static String nowIso() {
        java.text.SimpleDateFormat f = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US);
        f.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
        return f.format(new java.util.Date());
    }

    static void show(Context c, int id, String title, String text, String url) {
        Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (url != null && !url.isEmpty() && !"null".equals(url)) open.putExtra("url", url);
        PendingIntent pi = PendingIntent.getActivity(c, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(c, CH_NOTICES)
                .setSmallIcon(R.drawable.ic_notify)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setAutoCancel(true)
                .setContentIntent(pi)
                .build();
        try {
            c.getSystemService(NotificationManager.class).notify(id, n);
        } catch (SecurityException ignored) {
            // Sin permiso de notificaciones: el aviso se ve en la plataforma.
        }
    }
}
