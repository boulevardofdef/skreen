package app.skreen;

import android.Manifest;
import android.accounts.Account;
import android.accounts.AccountManager;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.IntentSender;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.PixelFormat;
import android.graphics.drawable.ColorDrawable;
import android.location.Address;
import android.location.Geocoder;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.speech.RecognizerIntent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.content.FileProvider;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebViewAssetLoader;

import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.AccountPicker;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

/**
 * Skreen: a full-screen, always-on shell around the web app in /dashboard.
 *
 * It loads the live site (so updates appear without reinstalling). The site's
 * service worker keeps it working through Wi-Fi drops. A copy of the site is also
 * bundled in the APK as a last resort, for example a first launch while offline;
 * the app goes back to the live site as soon as the network returns.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String BUNDLED_URL = "https://" + HOST + "/assets/index.html";
    private static final int REQ_LOCATION = 1;
    private static final int REQ_VOICE = 2;
    private static final int REQ_ACCOUNT = 3;
    private static final int REQ_AUTH = 4;
    private PlusBilling billing;

    /** What Skreen asks Google for: read the calendars, and manage tasks (to add and check off items). */
    private static final List<Scope> SCOPES = Arrays.asList(
            new Scope("https://www.googleapis.com/auth/calendar.readonly"),
            new Scope("https://www.googleapis.com/auth/tasks"));

    private WebView web;
    private SharedPreferences prefs;
    private int pendingAuthRequest = 0;
    private String remoteUrl = "";
    private String remoteHost = null;
    private boolean onFallback = false;
    private ConnectivityManager connectivity;
    private ConnectivityManager.NetworkCallback networkCallback;
    private GeolocationPermissions.Callback pendingGeoCallback;
    private String pendingGeoOrigin;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Cover every pixel: an opaque window, drawing edge to edge (including behind camera
        // cutouts and the hidden system bars), so nothing from the launcher can show around the edges.
        getWindow().setFormat(PixelFormat.OPAQUE);
        getWindow().setBackgroundDrawable(new ColorDrawable(0xFF0E0D0B));
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= 30
                    ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                    : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }

        prefs = getSharedPreferences("skreen", MODE_PRIVATE);
        billing = new PlusBilling(this, prefs, json -> runOnUiThread(() -> {
            if (web != null) web.evaluateJavascript("window.skreenPlus && window.skreenPlus(" + JSONObject.quote(json) + ")", null);
        }));
        billing.start();
        remoteUrl = getString(R.string.start_url).trim();
        if (!remoteUrl.isEmpty()) remoteHost = Uri.parse(remoteUrl).getHost();

        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web = new WebView(this);
        web.setBackgroundColor(0xFF0E0D0B);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setLongClickable(false);
        web.setHapticFeedbackEnabled(false);
        setContentView(web);
        // Edge-to-edge windows don't resize for the keyboard by themselves; make room for it.
        ViewCompat.setOnApplyWindowInsetsListener(web, (v, insets) -> {
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            v.setPadding(0, 0, 0, ime.bottom);
            return insets;
        });

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setGeolocationEnabled(true);
        s.setSupportZoom(false);

        web.addJavascriptInterface(new Bridge(), "SkreenNative");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (isTrusted(request.getUrl())) return false;
                Uri uri = request.getUrl();
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (ActivityNotFoundException ignored) { }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) fallBack(request.getUrl());
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() && response.getStatusCode() >= 400) fallBack(request.getUrl());
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // The WebView's renderer died (usually low memory). Start fresh.
                runOnUiThread(MainActivity.this::recreate);
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    callback.invoke(origin, true, false);
                } else {
                    pendingGeoOrigin = origin;
                    pendingGeoCallback = callback;
                    requestPermissions(new String[]{Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
                }
            }
        });

        getWindow().getDecorView().setOnSystemUiVisibilityChangeListener(visibility -> {
            if ((visibility & View.SYSTEM_UI_FLAG_FULLSCREEN) == 0) {
                // The bars were summoned (a swipe from the edge). Tuck them away again after a moment.
                web.postDelayed(this::hideSystemUi, 2500);
            }
        });

        web.loadUrl(remoteUrl.isEmpty() ? BUNDLED_URL : remoteUrl);
        watchNetwork();
    }

    /** Only our own pages may run with the native bridge; everything else opens in the browser. */
    private boolean isTrusted(Uri uri) {
        String host = uri.getHost();
        return HOST.equals(host) || (remoteHost != null && remoteHost.equals(host));
    }

    /** The live site couldn't be reached: show the bundled copy until the network is back. */
    private void fallBack(Uri failed) {
        if (onFallback || remoteHost == null || !remoteHost.equals(failed.getHost())) return;
        onFallback = true;
        web.loadUrl(BUNDLED_URL);
    }

    private void watchNetwork() {
        if (remoteHost == null) return;
        connectivity = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                runOnUiThread(() -> {
                    if (onFallback && web != null) {
                        onFallback = false;
                        web.loadUrl(remoteUrl);
                    }
                });
            }
        };
        try {
            connectivity.registerDefaultNetworkCallback(networkCallback);
        } catch (RuntimeException ignored) { }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_LOCATION && pendingGeoCallback != null) {
            boolean ok = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            pendingGeoCallback.invoke(pendingGeoOrigin, ok, false);
            pendingGeoCallback = null;
            pendingGeoOrigin = null;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_ACCOUNT) {
            String name = (resultCode == RESULT_OK && data != null) ? data.getStringExtra(AccountManager.KEY_ACCOUNT_NAME) : null;
            if (name == null) { deliverToken(pendingAuthRequest, null, "cancelled"); return; }
            prefs.edit().putString("account", name).apply();
            authorize(true, pendingAuthRequest);
            return;
        }
        if (requestCode == REQ_AUTH) {
            if (resultCode != RESULT_OK || data == null) { deliverToken(pendingAuthRequest, null, "cancelled"); return; }
            try {
                AuthorizationResult result = Identity.getAuthorizationClient(this).getAuthorizationResultFromIntent(data);
                deliverToken(pendingAuthRequest, result.getAccessToken(), null);
            } catch (ApiException e) {
                deliverToken(pendingAuthRequest, null, "auth_failed");
            }
            return;
        }
        if (requestCode != REQ_VOICE) return;
        String text = "";
        if (resultCode == RESULT_OK && data != null) {
            ArrayList<String> results = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            if (results != null && !results.isEmpty()) text = results.get(0);
        }
        web.evaluateJavascript("window.skreenVoice && window.skreenVoice(" + JSONObject.quote(text) + ")", null);
    }

    @Override
    protected void onResume() {
        super.onResume();
        hideSystemUi();
        if (billing != null) billing.resume();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    /** Back never leaves the app; it only closes whatever sheet is open. */
    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.skreenBack && window.skreenBack()", null);
    }

    @Override
    protected void onDestroy() {
        if (billing != null) billing.end();
        if (connectivity != null && networkCallback != null) {
            try {
                connectivity.unregisterNetworkCallback(networkCallback);
            } catch (RuntimeException ignored) { }
        }
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    /**
     * Gets a short-lived Google access token for the chosen account. With interactive=false it only
     * succeeds if the user has already granted access; otherwise it shows Google's consent screen.
     * The answer goes back to the page through window.skreenToken(id, token, error).
     */
    private void authorize(final boolean interactive, final int reqId) {
        String name = prefs.getString("account", null);
        if (name == null) { deliverToken(reqId, null, "no_account"); return; }
        AuthorizationRequest request = AuthorizationRequest.builder()
                .setRequestedScopes(SCOPES)
                .setAccount(new Account(name, "com.google"))
                .build();
        Identity.getAuthorizationClient(this).authorize(request)
                .addOnSuccessListener(result -> {
                    if (result.hasResolution()) {
                        if (!interactive) { deliverToken(reqId, null, "consent_needed"); return; }
                        pendingAuthRequest = reqId;
                        try {
                            startIntentSenderForResult(result.getPendingIntent().getIntentSender(), REQ_AUTH, null, 0, 0, 0);
                        } catch (IntentSender.SendIntentException e) {
                            deliverToken(reqId, null, "resolution_failed");
                        }
                    } else {
                        deliverToken(reqId, result.getAccessToken(), null);
                    }
                })
                .addOnFailureListener(e -> deliverToken(reqId, null, String.valueOf(e.getMessage())));
    }

    private void notifyUpdate(String kind, String value) {
        final String js = "window.skreenUpdate && window.skreenUpdate(" + JSONObject.quote(kind) + ","
                + JSONObject.quote(value == null ? "" : value) + ")";
        runOnUiThread(() -> { if (web != null) web.evaluateJavascript(js, null); });
    }

    /**
     * Downloads the new APK from our GitHub release, checks it, and hands it to Android's installer
     * (which asks the user to confirm and only accepts an APK signed with the same key as this app).
     */
    private void downloadAndInstall(final String url, final String sha256) {
        if (url == null || !url.startsWith("https://github.com/")) { notifyUpdate("error", "bad_url"); return; }
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            runOnUiThread(() -> startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getPackageName()))));
            notifyUpdate("permission", null);
            return;
        }
        new Thread(() -> {
            try {
                File dir = new File(getCacheDir(), "updates");
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
                File out = new File(dir, "Skreen.apk");

                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(15000);
                c.setReadTimeout(30000);
                c.setInstanceFollowRedirects(true);
                int total = c.getContentLength();
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                try (InputStream in = c.getInputStream(); FileOutputStream fo = new FileOutputStream(out)) {
                    byte[] buf = new byte[16384];
                    int n, last = -1;
                    long got = 0;
                    while ((n = in.read(buf)) > 0) {
                        fo.write(buf, 0, n);
                        md.update(buf, 0, n);
                        got += n;
                        if (total > 0) {
                            int pct = (int) (got * 100 / total);
                            if (pct != last) { last = pct; notifyUpdate("progress", String.valueOf(pct)); }
                        }
                    }
                }
                if (sha256 != null && !sha256.isEmpty()) {
                    StringBuilder hex = new StringBuilder();
                    for (byte b : md.digest()) hex.append(String.format(Locale.US, "%02x", b));
                    if (!hex.toString().equalsIgnoreCase(sha256)) {
                        //noinspection ResultOfMethodCallIgnored
                        out.delete();
                        notifyUpdate("error", "checksum");
                        return;
                    }
                }
                Uri uri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".files", out);
                final Intent install = new Intent(Intent.ACTION_VIEW)
                        .setDataAndType(uri, "application/vnd.android.package-archive")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                notifyUpdate("ready", null);
                runOnUiThread(() -> startActivity(install));
            } catch (Exception e) {
                notifyUpdate("error", String.valueOf(e.getMessage()));
            }
        }).start();
    }

    private void deliverToken(int reqId, String token, String error) {
        if (web == null) return;
        String t = token == null ? "null" : JSONObject.quote(token);
        String e = error == null ? "null" : JSONObject.quote(error);
        web.evaluateJavascript("window.skreenToken && window.skreenToken(" + reqId + "," + t + "," + e + ")", null);
    }

    private void hideSystemUi() {
        // Modern API...
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());
        // ...and the legacy flags too: some tablet skins only honor these.
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    /** What the web app can ask the device to do. */
    private class Bridge {
        /** 0.01 to 1.0 sets the screen brightness for this app; a negative value means "tablet default". */
        @JavascriptInterface
        public void setBrightness(final float level) {
            runOnUiThread(() -> {
                WindowManager.LayoutParams lp = getWindow().getAttributes();
                lp.screenBrightness = level < 0
                        ? WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
                        : Math.max(0.01f, Math.min(1f, level));
                getWindow().setAttributes(lp);
            });
        }

        /** Lets the user pick a Google account, then asks Google for permission. Answer: window.skreenToken. */
        @JavascriptInterface
        public void signIn(final int reqId) {
            runOnUiThread(() -> {
                pendingAuthRequest = reqId;
                Intent intent = AccountPicker.newChooseAccountIntent(
                        new AccountPicker.AccountChooserOptions.Builder()
                                .setAllowableAccountsTypes(Arrays.asList("com.google"))
                                .build());
                try {
                    startActivityForResult(intent, REQ_ACCOUNT);
                } catch (ActivityNotFoundException e) {
                    deliverToken(reqId, null, "no_play_services");
                }
            });
        }

        /** A fresh access token for the account that signed in earlier (silent if access was already granted). */
        @JavascriptInterface
        public void getToken(final int reqId) {
            runOnUiThread(() -> authorize(false, reqId));
        }

        /** Turns coordinates into a place name using the device's geocoder. Answer: window.skreenPlace(id, {city, region, country} | null). */
        @JavascriptInterface
        public void reverseGeocode(final int reqId, final double lat, final double lon) {
            new Thread(() -> {
                String json = "null";
                try {
                    if (Geocoder.isPresent()) {
                        List<Address> found = new Geocoder(MainActivity.this, Locale.getDefault()).getFromLocation(lat, lon, 1);
                        if (found != null && !found.isEmpty()) {
                            Address a = found.get(0);
                            String city = a.getLocality();
                            if (city == null) city = a.getSubAdminArea();
                            if (city == null) city = a.getSubLocality();
                            JSONObject o = new JSONObject();
                            o.put("city", city == null ? JSONObject.NULL : city);
                            o.put("region", a.getAdminArea() == null ? JSONObject.NULL : a.getAdminArea());
                            o.put("country", a.getCountryCode() == null ? JSONObject.NULL : a.getCountryCode());
                            json = o.toString();
                        }
                    }
                } catch (Exception ignored) { }
                final String out = json;
                runOnUiThread(() -> {
                    if (web != null) web.evaluateJavascript("window.skreenPlace && window.skreenPlace(" + reqId + "," + out + ")", null);
                });
            }).start();
        }

        /** The installed build number (matches the number in the GitHub release). */
        @JavascriptInterface
        public int getVersion() {
            try {
                PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
                return Build.VERSION.SDK_INT >= 28 ? (int) pi.getLongVersionCode() : pi.versionCode;
            } catch (Exception e) {
                return 0;
            }
        }

        @JavascriptInterface
        public String getVersionName() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "";
            }
        }

        /** Download and install a new APK from our GitHub release. Progress comes back via window.skreenUpdate. */
        @JavascriptInterface
        public void installUpdate(String url, String sha256) {
            downloadAndInstall(url, sha256);
        }

        /** Opens a web address in the browser (used as a fallback for updates). */
        @JavascriptInterface
        public void openExternal(final String url) {
            if (url == null || !url.startsWith("https://")) return;
            runOnUiThread(() -> {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (ActivityNotFoundException ignored) { }
            });
        }

        /** Skreen Plus status as JSON: {play, price, canBuy}. Changes arrive via window.skreenPlus(json). */
        @JavascriptInterface
        public String getPlus() {
            return billing != null ? billing.json() : "{}";
        }

        /** Opens Google Play's purchase sheet for Skreen Plus. */
        @JavascriptInterface
        public void buyPlus() {
            runOnUiThread(() -> { if (billing != null) billing.buy(MainActivity.this); });
        }

        @JavascriptInterface
        public String getAccount() {
            return prefs.getString("account", "");
        }

        @JavascriptInterface
        public void signOut() {
            prefs.edit().remove("account").apply();
        }

        /** Opens the system's speech recognizer; the result comes back through window.skreenVoice(text). */
        @JavascriptInterface
        public void startVoice() {
            runOnUiThread(() -> {
                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                        .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                        .putExtra(RecognizerIntent.EXTRA_PROMPT, "Add to the list");
                try {
                    startActivityForResult(intent, REQ_VOICE);
                } catch (ActivityNotFoundException e) {
                    web.evaluateJavascript("window.skreenVoice && window.skreenVoice('')", null);
                }
            });
        }
    }
}
