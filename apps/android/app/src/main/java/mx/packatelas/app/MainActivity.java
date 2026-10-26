package mx.packatelas.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Envoltorio de la plataforma Packatelas [P03]: una sola pantalla con la web (el menú cambia
 * según quién entra), cámara para escanear y fotos de evidencia, ubicación en segundo plano
 * durante el turno y avisos nativos.
 */
public class MainActivity extends Activity {
    private static final int REQ_PERMS = 10;
    private static final int REQ_FILE = 11;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraUri;
    private PermissionRequest pendingWebPermission;
    private GeolocationPermissions.Callback pendingGeo;
    private String pendingGeoOrigin;
    private boolean pendingDuty;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Api.channels(this);
        NoticeJob.schedule(this);
        cleanOldPhotos();

        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setUserAgentString(s.getUserAgentString() + " PackatelasAndroid/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);

        web.addJavascriptInterface(new Bridge(), "PackatelasNative");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener((url, ua, disposition, mime, length) -> download(url, ua, disposition, mime));

        if (state != null) web.restoreState(state);
        else web.loadUrl(startUrl(getIntent()));
        askNotificationsOnce();
    }

    private String startUrl(Intent i) {
        String u = i != null ? i.getStringExtra("url") : null;
        if (u != null && !u.isEmpty()) return u.startsWith("http") ? u : Api.base() + (u.startsWith("/") ? u : "/" + u);
        return Api.base() + "/";
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent.getStringExtra("url") != null) web.loadUrl(startUrl(intent));
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    // ——— Puente con la web ———

    final class Bridge {
        /** La app del repartidor avisa si está en turno: enciende o apaga el GPS en segundo plano. */
        @JavascriptInterface
        public void setOnDuty(boolean on) {
            runOnUiThread(() -> {
                if (!on) {
                    LocationService.stop(MainActivity.this);
                } else if (LocationService.hasPermission(MainActivity.this)) {
                    LocationService.start(MainActivity.this);
                } else {
                    pendingDuty = true;
                    requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_PERMS);
                }
            });
        }

        @JavascriptInterface
        public boolean hasLocation() {
            return LocationService.hasPermission(MainActivity.this);
        }

        @JavascriptInterface
        public String version() {
            return BuildConfig.VERSION_NAME;
        }
    }

    // ——— Navegación ———

    final class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            String scheme = u.getScheme() == null ? "" : u.getScheme();
            if ((scheme.equals("https") || scheme.equals("http")) && Api.isInternal(u)) return false;
            // Teléfono, WhatsApp, Maps, Waze y cualquier sitio externo se abren en su app.
            try {
                Intent i = scheme.equals("intent") ? Intent.parseUri(u.toString(), Intent.URI_INTENT_SCHEME) : new Intent(Intent.ACTION_VIEW, u);
                i.addCategory(Intent.CATEGORY_BROWSABLE);
                startActivity(i);
            } catch (Exception e) {
                Toast.makeText(MainActivity.this, "No hay una app para abrir este enlace", Toast.LENGTH_SHORT).show();
            }
            return true;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
            if (!req.isForMainFrame()) return;
            // La web tiene modo sin conexión cuando ya se abrió antes; si no, mensaje y reintento.
            String html = "<html><head><meta name=viewport content='width=device-width,initial-scale=1'></head>"
                    + "<body style='font-family:sans-serif;padding:32px;text-align:center;color:#334155'>"
                    + "<h2 style='color:#173d80'>Sin conexión</h2><p>No se pudo abrir Packatelas. Revisa tu señal o datos.</p>"
                    + "<p><a href='" + Api.base() + "/' style='display:inline-block;background:#1f4fa3;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none'>Reintentar</a></p></body></html>";
            view.loadDataWithBaseURL(Api.base() + "/", html, "text/html", "UTF-8", req.getUrl().toString());
        }
    }

    // ——— Cámara, ubicación y archivos ———

    final class Chrome extends WebChromeClient {
        /** Cámara para el escáner de QR (getUserMedia). */
        @Override
        public void onPermissionRequest(PermissionRequest request) {
            runOnUiThread(() -> {
                if (!Api.isInternal(request.getOrigin())) {
                    request.deny();
                    return;
                }
                if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(request.getResources());
                } else {
                    pendingWebPermission = request;
                    requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_PERMS);
                }
            });
        }

        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
            if (!Api.isInternal(Uri.parse(origin))) {
                callback.invoke(origin, false, false);
                return;
            }
            if (LocationService.hasPermission(MainActivity.this)) {
                callback.invoke(origin, true, true);
            } else {
                pendingGeo = callback;
                pendingGeoOrigin = origin;
                requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_PERMS);
            }
        }

        /** Fotos de evidencia y documentos: cámara o galería/archivos. */
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            List<Intent> extra = new ArrayList<>();
            boolean wantsImage = false;
            for (String t : params.getAcceptTypes()) if (t == null || t.isEmpty() || t.startsWith("image")) wantsImage = true;
            // Android 10+: la foto va a Imágenes/Packatelas sin pedir permiso de almacenamiento.
            if (wantsImage && android.os.Build.VERSION.SDK_INT >= 29 && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Images.Media.DISPLAY_NAME, "packatelas_" + System.currentTimeMillis() + ".jpg");
                v.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                v.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Packatelas");
                try {
                    cameraUri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
                } catch (Exception e) {
                    cameraUri = null;
                }
                if (cameraUri != null) {
                    Intent cam = new Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
                    rememberPhoto(cameraUri);
                    if (params.isCaptureEnabled()) {
                        try {
                            startActivityForResult(cam, REQ_FILE);
                            return true;
                        } catch (ActivityNotFoundException ignored) {
                        }
                    }
                    extra.add(cam);
                }
            } else if (wantsImage && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_PERMS);
            }
            Intent pick = params.createIntent();
            Intent chooser = Intent.createChooser(pick, "Elegir foto o archivo");
            chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, extra.toArray(new Intent[0]));
            try {
                startActivityForResult(chooser, REQ_FILE);
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                return false;
            }
            return true;
        }
    }

    @Override
    protected void onActivityResult(int req, int result, Intent data) {
        super.onActivityResult(req, result, data);
        if (req != REQ_FILE || fileCallback == null) return;
        Uri[] out = null;
        if (result == RESULT_OK) {
            if (data != null && data.getData() != null) out = new Uri[]{data.getData()};
            else if (data != null && data.getClipData() != null) {
                out = new Uri[data.getClipData().getItemCount()];
                for (int i = 0; i < out.length; i++) out[i] = data.getClipData().getItemAt(i).getUri();
            } else if (cameraUri != null) out = new Uri[]{cameraUri};
        } else if (cameraUri != null) {
            getContentResolver().delete(cameraUri, null, null);
        }
        fileCallback.onReceiveValue(out);
        fileCallback = null;
        cameraUri = null;
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] results) {
        super.onRequestPermissionsResult(req, perms, results);
        if (pendingWebPermission != null) {
            if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
                pendingWebPermission.grant(pendingWebPermission.getResources());
            else pendingWebPermission.deny();
            pendingWebPermission = null;
        }
        boolean loc = LocationService.hasPermission(this);
        if (pendingGeo != null) {
            pendingGeo.invoke(pendingGeoOrigin, loc, loc);
            pendingGeo = null;
        }
        if (pendingDuty) {
            pendingDuty = false;
            if (loc) LocationService.start(this);
            else new AlertDialog.Builder(this)
                    .setTitle("Ubicación necesaria")
                    .setMessage("Para trabajar en turno, Packatelas necesita tu ubicación. Actívala en Ajustes → Apps → Packatelas → Permisos → Ubicación.")
                    .setPositiveButton("Abrir ajustes", (d, w) -> startActivity(new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()))))
                    .setNegativeButton("Ahora no", null)
                    .show();
        }
    }

    private void askNotificationsOnce() {
        if (android.os.Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                && !Api.prefs(this).getBoolean("askedNotif", false)) {
            Api.prefs(this).edit().putBoolean("askedNotif", true).apply();
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_PERMS);
        }
    }

    // ——— Descargas (CSV, recibos, documentos) con la sesión ———

    private void download(String url, String ua, String disposition, String mime) {
        try {
            DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) r.addRequestHeader("Cookie", cookie);
            r.addRequestHeader("User-Agent", ua);
            String name = URLUtil.guessFileName(url, disposition, mime);
            r.setTitle(name);
            r.setMimeType(mime);
            r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            if (android.os.Build.VERSION.SDK_INT >= 29) r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            else r.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, name);
            getSystemService(DownloadManager.class).enqueue(r);
            Toast.makeText(this, "Descargando " + name, Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            Toast.makeText(this, "No se pudo descargar", Toast.LENGTH_SHORT).show();
        }
    }

    // Las fotos tomadas para evidencia se suben a la plataforma; las copias del teléfono se borran al día siguiente.
    private void rememberPhoto(Uri u) {
        Set<String> s = new HashSet<>(Api.prefs(this).getStringSet("photos", new HashSet<>()));
        s.add(System.currentTimeMillis() + "|" + u);
        Api.prefs(this).edit().putStringSet("photos", s).apply();
    }

    private void cleanOldPhotos() {
        Set<String> s = new HashSet<>(Api.prefs(this).getStringSet("photos", new HashSet<>()));
        Set<String> keep = new HashSet<>();
        long limit = System.currentTimeMillis() - 24 * 3600_000L;
        for (String e : s) {
            String[] p = e.split("\\|", 2);
            try {
                if (Long.parseLong(p[0]) < limit) getContentResolver().delete(Uri.parse(p[1]), null, null);
                else keep.add(e);
            } catch (Exception ignored) {
            }
        }
        Api.prefs(this).edit().putStringSet("photos", keep).apply();
    }
}
