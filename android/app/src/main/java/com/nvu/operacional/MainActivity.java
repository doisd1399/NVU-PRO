package com.nvu.operacional;

import android.content.Intent;
import android.app.AlertDialog;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.RenderProcessGoneDetail;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import com.google.firebase.auth.FirebaseAuth;
import io.capawesome.capacitorjs.plugins.firebase.authentication.FirebaseAuthenticationPlugin;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    public static final String EXTRA_NATIVE_ROUTE = "nvuNativeRoute";
    public static final String EXTRA_NATIVE_PROFILE_TAB = "nvuNativeProfileTab";
    private static final String WEB_ASSET_RELEASE_KEY = BuildConfig.VERSION_CODE + ":" + BuildConfig.VERSION_NAME;
    private FirebaseAuth.AuthStateListener proQueueAuthListener;
    private boolean webViewRecoveryRequested;
    private static long lastWebViewRecoveryAt;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(GtoObserverPlugin.class);
        registerPlugin(SimpleAutomationPlugin.class);
        registerPlugin(ProOverlayProbePlugin.class);
        registerPlugin(PrintDiagnosticsPlugin.class);
        super.onCreate(savedInstanceState);
        invalidateWebAssetCacheForCurrentRelease();
        if (getBridge() != null) {
            getBridge().addWebViewListener(new WebViewListener() {
                @Override
                public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                    // Android can discard only the WebView renderer while NVU
                    // is in the background. Recreate the bridge once instead of
                    // retaining a dead white surface. Auth, routes and durable
                    // pending commands remain in their existing local stores.
                    if (!webViewRecoveryRequested && !isFinishing() && !isDestroyed()) {
                        webViewRecoveryRequested = true;
                        long now = android.os.SystemClock.elapsedRealtime();
                        boolean repeated = lastWebViewRecoveryAt > 0 && now - lastWebViewRecoveryAt < 30_000;
                        lastWebViewRecoveryAt = now;
                        getWindow().getDecorView().post(() -> {
                            if (isFinishing() || isDestroyed()) return;
                            if (repeated) {
                                // A repeatedly failing renderer must not cause
                                // an automatic recreation loop or a dead page.
                                new AlertDialog.Builder(MainActivity.this)
                                    .setTitle("Não foi possível retomar a tela")
                                    .setMessage("Seus registros foram preservados. Reabra a tela para continuar.")
                                    .setPositiveButton("Reabrir", (dialog, which) -> recreate())
                                    .setCancelable(false)
                                    .show();
                            } else recreate();
                        });
                    }
                    return true;
                }
            });
        }
        // Profile hero must render underneath a transparent status bar. Disable
        // framework inset fitting here; the Web route applies its own safe-area
        // padding and contrast without changing any business flow.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setStatusBarContrastEnforced(false);
        }
        getWindow().getDecorView().setBackgroundColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            );
        }
        WindowInsetsControllerCompat insetsController =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        // NVU starts in its own light theme unless localStorage says otherwise.
        // The Web controller immediately applies the persisted NVU theme; this
        // native default prevents Android's system theme from forcing white icons
        // during login/selector first paint.
        insetsController.setAppearanceLightStatusBars(true);
        // Native Google login is mandatory on Android. The generated registry is
        // normally sufficient; this conditional guard repairs installations in
        // which a stale/partial registry omitted FirebaseAuthentication.
        if (getBridge() != null && getBridge().getPlugin("FirebaseAuthentication") == null) {
            getBridge().registerPlugin(FirebaseAuthenticationPlugin.class);
        }
    }

    /**
     * Local Capacitor assets keep stable hashed filenames between hotfixes.
     * Clear only the WebView cache once per native release so an APK update
     * cannot render a cached JS/CSS chunk from the previous APK.
     */
    private void invalidateWebAssetCacheForCurrentRelease() {
        try {
            WebView webView = getBridge() == null ? null : getBridge().getWebView();
            if (webView == null) return;
            android.content.SharedPreferences prefs = getSharedPreferences("nvu_web_release", MODE_PRIVATE);
            String previousKey = prefs.getString("asset_cache_release", "");
            if (!WEB_ASSET_RELEASE_KEY.equals(previousKey)) {
                webView.clearCache(true);
                webView.clearHistory();
                prefs.edit().putString("asset_cache_release", WEB_ASSET_RELEASE_KEY).apply();
            }
            // Release invalidation is one-time. Normal HTTP/image caching must
            // remain available during the first session after an APK update.
            webView.getSettings().setCacheMode(WebSettings.LOAD_DEFAULT);
        } catch (Exception error) {
            android.util.Log.w("NVU", "Não foi possível invalidar o cache dos assets Web", error);
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        // The controller performs the only permission refresh on initial resume
        // or after returning from the Android overlay settings it opened.
        ProModeController.onActivityResume(this);
        GtoObserverService.reportMainActivityForeground(true);
        GtoObserverService.recoverIfEnabled(this);
    }

    @Override
    public void onPause() {
        GtoObserverService.reportMainActivityForeground(false);
        super.onPause();
    }

    @Override
    public void onStart() {
        super.onStart();
        // Recover durable Pro receipts even if the overlay was closed before
        // network or native authentication became available.
        ProPendingTripJobService.scheduleImmediate(this);
        FirebaseAuth nativeAuth = GtoFirebaseRuntime.auth(this);
        if (nativeAuth != null) {
            proQueueAuthListener = auth -> {
                android.content.SharedPreferences pendingIndex = getSharedPreferences(
                    SimpleAutomationService.PREFS_NAME, MODE_PRIVATE);
                if (!ProPendingTripStore.ids(pendingIndex).isEmpty()) {
                    SimpleAutomationService.triggerPendingProcessing(this);
                }
            };
            nativeAuth.addAuthStateListener(proQueueAuthListener);
        }
        android.content.SharedPreferences gtoPrefs = getSharedPreferences(GtoObserverService.PREFS_NAME, MODE_PRIVATE);
        // HF54: recover HF51/HF52 legacy queue state before the observer/menu can render
        // a sticky previous-sync status. The recovery never deletes a sealed trip.
        GtoAutoTripSync.recoverLegacyPendingStateOnAuthenticatedStart(this, gtoPrefs);
        // Durable completed deliveries must be retried even when the driver has
        // temporarily disabled the floating observer. Authentication is checked
        // before touching the queue so the login screen does not inherit another
        // user's pending status on shared devices.
        if (GtoFirebaseRuntime.currentUser(this) != null) {
            GtoTripSubmissionCoordinator.flushPending(this, gtoPrefs, null);
        }
    }

    @Override
    public void onStop() {
        if (proQueueAuthListener != null) {
            FirebaseAuth nativeAuth = GtoFirebaseRuntime.auth(this);
            if (nativeAuth != null) nativeAuth.removeAuthStateListener(proQueueAuthListener);
            proQueueAuthListener = null;
        }
        super.onStop();
    }

    @Override
    public void onDestroy() {
        if (isFinishing()) {
            SimpleAutomationService.stopForAppClosure(this);
        }
        super.onDestroy();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        dispatchNativeNavigation(intent);
    }

    private void dispatchNativeNavigation(Intent intent) {
        if (intent == null || bridge == null || bridge.getWebView() == null) return;
        String route = intent.getStringExtra(EXTRA_NATIVE_ROUTE);
        if (route == null || route.trim().isEmpty()) return;

        String profileTab = intent.getStringExtra(EXTRA_NATIVE_PROFILE_TAB);
        String safeRoute = JSONObject.quote(route);
        String safeTab = JSONObject.quote(profileTab == null ? "" : profileTab);

        String script = "window.__NVU_NATIVE_ROUTE__={path:"
            + safeRoute
            + ",profileTab:"
            + safeTab
            + "};window.dispatchEvent(new CustomEvent('nvu:native-navigation',{detail:window.__NVU_NATIVE_ROUTE__}));";

        bridge.getWebView().post(() -> bridge.getWebView().evaluateJavascript(script, null));
        intent.removeExtra(EXTRA_NATIVE_ROUTE);
        intent.removeExtra(EXTRA_NATIVE_PROFILE_TAB);
    }
}
