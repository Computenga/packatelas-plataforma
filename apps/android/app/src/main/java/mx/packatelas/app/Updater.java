package mx.packatelas.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Environment;
import android.provider.Settings;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.File;

/**
 * Actualizaciones de la app sin Play Store: al abrirla (máx. cada 30 min) pregunta a la
 * plataforma cuál es la versión vigente; si hay una nueva ofrece instalarla, la descarga y
 * abre el instalador de Android. La versión vieja se reemplaza sin perder la sesión.
 */
final class Updater {
    private static final long CHECK_EVERY_MS = 30 * 60_000L;
    private static boolean dialogOpen = false;
    private static boolean waitingPermission = false;
    private static long downloadId = -1;

    private Updater() {}

    /** Revisa en segundo plano; si hay versión nueva muestra la ventana. */
    static void check(Activity a, boolean force) {
        long last = Api.prefs(a).getLong("updCheckedAt", 0);
        if (!force && System.currentTimeMillis() - last < CHECK_EVERY_MS) return;
        Api.prefs(a).edit().putLong("updCheckedAt", System.currentTimeMillis()).apply();
        new Thread(() -> {
            Object[] r = Api.request("GET", "/api/app/version", null);
            if ((int) r[0] != 200) return;
            try {
                JSONObject j = new JSONObject((String) r[1]);
                int code = j.optInt("versionCode", 0);
                if (code <= BuildConfig.VERSION_CODE) return;
                String name = j.optString("versionName", "nueva");
                String notes = j.optString("notes", "");
                String url = j.optString("url", "/app/packatelas.apk");
                a.runOnUiThread(() -> offer(a, name, notes, url));
            } catch (Exception ignored) {
            }
        }).start();
    }

    /** Al volver de los ajustes de "Instalar apps desconocidas". */
    static void onResume(Activity a) {
        if (waitingPermission && canInstall(a)) {
            waitingPermission = false;
            check(a, true);
        }
    }

    private static boolean canInstall(Context c) {
        return android.os.Build.VERSION.SDK_INT < 26 || c.getPackageManager().canRequestPackageInstalls();
    }

    private static void offer(Activity a, String name, String notes, String url) {
        if (dialogOpen || a.isFinishing() || downloadId != -1) return;
        dialogOpen = true;
        new AlertDialog.Builder(a)
                .setTitle("Nueva versión " + name)
                .setMessage("Tienes la " + BuildConfig.VERSION_NAME + ". " + notes + "\n\nSe instala encima: no pierdes tu sesión ni tus datos.")
                .setPositiveButton("Actualizar", (d, w) -> {
                    dialogOpen = false;
                    if (!canInstall(a)) {
                        waitingPermission = true;
                        new AlertDialog.Builder(a)
                                .setTitle("Un permiso más")
                                .setMessage("En la siguiente pantalla activa «Permitir de esta fuente» y regresa con la flecha de atrás.")
                                .setPositiveButton("Continuar", (d2, w2) -> a.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + a.getPackageName()))))
                                .setNegativeButton("Ahora no", (d2, w2) -> waitingPermission = false)
                                .show();
                        return;
                    }
                    download(a, name, url);
                })
                .setNegativeButton("Más tarde", (d, w) -> dialogOpen = false)
                .setOnCancelListener(d -> dialogOpen = false)
                .show();
    }

    private static void download(Activity a, String name, String url) {
        try {
            File dir = a.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            String file = "packatelas-" + name + ".apk";
            if (dir != null) {
                File[] old = dir.listFiles((f, n) -> n.endsWith(".apk"));
                if (old != null) for (File f : old) //noinspection ResultOfMethodCallIgnored
                    f.delete();
            }
            String full = url.startsWith("http") ? url : Api.base() + url;
            DownloadManager.Request r = new DownloadManager.Request(Uri.parse(full))
                    .setTitle("Packatelas " + name)
                    .setDescription("Descargando actualización")
                    .setMimeType("application/vnd.android.package-archive")
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalFilesDir(a, Environment.DIRECTORY_DOWNLOADS, file);
            DownloadManager dm = a.getSystemService(DownloadManager.class);
            Context app = a.getApplicationContext();
            BroadcastReceiver done = new BroadcastReceiver() {
                @Override
                public void onReceive(Context c, Intent i) {
                    if (i.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -2) != downloadId) return;
                    try {
                        app.unregisterReceiver(this);
                    } catch (Exception ignored) {
                    }
                    install(app, dm, downloadId);
                    downloadId = -1;
                }
            };
            IntentFilter f = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
            if (android.os.Build.VERSION.SDK_INT >= 33) app.registerReceiver(done, f, Context.RECEIVER_EXPORTED);
            else app.registerReceiver(done, f);
            downloadId = dm.enqueue(r);
            Toast.makeText(a, "Descargando la versión " + name + "…", Toast.LENGTH_LONG).show();
        } catch (Exception e) {
            downloadId = -1;
            // Plan B: la página de descarga de siempre.
            a.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(Api.base() + "/descargar")));
        }
    }

    private static void install(Context c, DownloadManager dm, long id) {
        Uri apk = dm.getUriForDownloadedFile(id);
        if (apk == null) {
            Toast.makeText(c, "No se pudo descargar la actualización. Intenta de nuevo.", Toast.LENGTH_LONG).show();
            return;
        }
        Intent i = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(apk, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            c.startActivity(i);
        } catch (Exception e) {
            Toast.makeText(c, "Abre la descarga desde las notificaciones para instalar.", Toast.LENGTH_LONG).show();
        }
    }
}
