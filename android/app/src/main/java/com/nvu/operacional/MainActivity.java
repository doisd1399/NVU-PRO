package com.nvu.operacional;

import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;
import io.capawesome.capacitorjs.plugins.firebase.authentication.FirebaseAuthenticationPlugin;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    public static final String EXTRA_NATIVE_ROUTE = "nvuNativeRoute";
    public static final String EXTRA_NATIVE_PROFILE_TAB = "nvuNativeProfileTab";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(GtoObserverPlugin.class);
        registerPlugin(SimpleAutomationPlugin.class);
        super.onCreate(savedInstanceState);
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

    @Override
    public void onResume() {
        super.onResume();
        GtoObserverService.reportMainActivityForeground(true);
    }

    @Override
    public void onPause() {
        GtoObserverService.reportMainActivityForeground(false);
        super.onPause();
    }

    @Override
    public void onStart() {
        super.onStart();
        android.content.SharedPreferences gtoPrefs = getSharedPreferences(GtoObserverService.PREFS_NAME, MODE_PRIVATE);
        // HF54: recover HF51/HF52 legacy queue state before the observer/menu can render
        // a sticky previous-sync status. The recovery never deletes a sealed trip.
        GtoAutoTripSync.recoverLegacyPendingStateOnAuthenticatedStart(this, gtoPrefs);
        GtoObserverService.recoverIfEnabled(this);
        // Durable completed deliveries must be retried even when the driver has
        // temporarily disabled the floating observer. Authentication is checked
        // before touching the queue so the login screen does not inherit another
        // user's pending status on shared devices.
        if (GtoFirebaseRuntime.currentUser(this) != null) {
            GtoTripSubmissionCoordinator.flushPending(this, gtoPrefs, null);
        }
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
