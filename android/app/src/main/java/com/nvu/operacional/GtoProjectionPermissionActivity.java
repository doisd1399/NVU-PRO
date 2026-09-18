package com.nvu.operacional;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Rect;
import android.media.projection.MediaProjectionConfig;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.WindowManager;

import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;

/**
 * Transparent MediaProjection consent owner used only while the real GTO task is
 * already visible in landscape. It never opens MainActivity and never launches the
 * simulator itself. The system consent dialog is therefore requested from a stable
 * landscape host above the existing GTO task.
 */
public class GtoProjectionPermissionActivity extends Activity {
    public static final String EXTRA_GTO_VERIFIED_AT = "nvuGtoVerifiedAt";
    public static final String EXTRA_GTO_VERIFIED_WIDTH = "nvuGtoVerifiedWidth";
    public static final String EXTRA_GTO_VERIFIED_HEIGHT = "nvuGtoVerifiedHeight";

    private static final int REQUEST_CAPTURE = 9007;
    private static final long HANDOFF_MAX_AGE_MS = 9000L;
    private static final long LANDSCAPE_SETTLE_MS = 260L;
    private static final long RETRY_MS = 80L;
    private static final int MAX_ATTEMPTS = 80;
    private static final long GRANT_ACK_TIMEOUT_MS = 12000L;
    private static final long GRANT_ACK_POLL_MS = 60L;
    private static final String STATE_CONSENT_LAUNCHED = "nvuConsentLaunched";
    private static final String STATE_VERIFIED_AT = "nvuVerifiedAt";
    private static final String STATE_VERIFIED_WIDTH = "nvuVerifiedWidth";
    private static final String STATE_VERIFIED_HEIGHT = "nvuVerifiedHeight";
    private static final String STATE_STABLE_SINCE = "nvuLandscapeStableSince";
    private static final String STATE_LAST_WIDTH = "nvuLastWidth";
    private static final String STATE_LAST_HEIGHT = "nvuLastHeight";

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private boolean consentLaunched = false;
    private long verifiedAt = 0L;
    private int verifiedWidth = 0;
    private int verifiedHeight = 0;
    private long landscapeStableSince = 0L;
    private int lastWidth = 0;
    private int lastHeight = 0;
    private boolean resultHandled = false;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        // Manifest already pins this Activity to landscape. Repeat the request before
        // any consent UI is created so an OEM cannot briefly inherit NVU portrait.
        try { setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE); } catch (Exception ignored) {}
        super.onCreate(savedInstanceState);
        overridePendingTransition(0, 0);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        Intent launch = getIntent();
        if (savedInstanceState != null) {
            // A system consent Activity is allowed to obscure/recreate its caller. Preserve
            // the fact that the request is already outstanding so recreation can never open
            // a second one-use MediaProjection consent by accident.
            consentLaunched = savedInstanceState.getBoolean(STATE_CONSENT_LAUNCHED, false);
            verifiedAt = savedInstanceState.getLong(STATE_VERIFIED_AT, 0L);
            verifiedWidth = savedInstanceState.getInt(STATE_VERIFIED_WIDTH, 0);
            verifiedHeight = savedInstanceState.getInt(STATE_VERIFIED_HEIGHT, 0);
            landscapeStableSince = savedInstanceState.getLong(STATE_STABLE_SINCE, 0L);
            lastWidth = savedInstanceState.getInt(STATE_LAST_WIDTH, 0);
            lastHeight = savedInstanceState.getInt(STATE_LAST_HEIGHT, 0);
        } else {
            verifiedAt = launch == null ? 0L : launch.getLongExtra(EXTRA_GTO_VERIFIED_AT, 0L);
            verifiedWidth = launch == null ? 0 : launch.getIntExtra(EXTRA_GTO_VERIFIED_WIDTH, 0);
            verifiedHeight = launch == null ? 0 : launch.getIntExtra(EXTRA_GTO_VERIFIED_HEIGHT, 0);
        }

        SharedPreferences prefs = getSharedPreferences(GtoObserverService.PREFS_NAME, MODE_PRIVATE);
        prefs.edit()
            .putBoolean("projectionPermissionInFlight", true)
            .putString("projectionStatus", "CONSENT_HOST_VERIFYING_GTO_LANDSCAPE")
            .putString("lastEvent", "GTO confirmado · validando host horizontal da autorização")
            .apply();

        if (!isFreshLandscapeHandoff()) {
            failAndFinish(
                "CONSENT_GTO_HANDOFF_INVALID",
                "A autorização foi bloqueada porque o GTO horizontal não estava confirmado no instante da solicitação."
            );
            return;
        }
        // If Android recreated this transparent host while its own consent UI was still
        // active, just keep waiting for the original result. Launching again would consume
        // a second user interaction and can invalidate the projection state machine.
        if (!consentLaunched) mainHandler.post(() -> tryLaunchConsent(0));
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        outState.putBoolean(STATE_CONSENT_LAUNCHED, consentLaunched);
        outState.putLong(STATE_VERIFIED_AT, verifiedAt);
        outState.putInt(STATE_VERIFIED_WIDTH, verifiedWidth);
        outState.putInt(STATE_VERIFIED_HEIGHT, verifiedHeight);
        outState.putLong(STATE_STABLE_SINCE, landscapeStableSince);
        outState.putInt(STATE_LAST_WIDTH, lastWidth);
        outState.putInt(STATE_LAST_HEIGHT, lastHeight);
        super.onSaveInstanceState(outState);
    }

    private boolean isFreshLandscapeHandoff() {
        long now = System.currentTimeMillis();
        return verifiedAt > 0L
            && now >= verifiedAt
            && now - verifiedAt <= HANDOFF_MAX_AGE_MS
            && verifiedWidth > verifiedHeight
            && verifiedHeight > 0;
    }

    private void tryLaunchConsent(int attempt) {
        if (isFinishing() || consentLaunched) return;
        if (!isFreshLandscapeHandoff()) {
            failAndFinish(
                "CONSENT_GTO_HANDOFF_EXPIRED",
                "O GTO deixou de estar confirmado antes da autorização de tela ser exibida."
            );
            return;
        }

        int[] size = currentDisplaySize();
        int width = size[0];
        int height = size[1];
        boolean landscape = width > height
            && getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE;

        if (!landscape) {
            landscapeStableSince = 0L;
            lastWidth = 0;
            lastHeight = 0;
            try { setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE); } catch (Exception ignored) {}
            if (attempt >= MAX_ATTEMPTS) {
                failAndFinish(
                    "CONSENT_LANDSCAPE_TIMEOUT",
                    "A autorização não foi aberta porque a tela não permaneceu horizontal."
                );
                return;
            }
            mainHandler.postDelayed(() -> tryLaunchConsent(attempt + 1), RETRY_MS);
            return;
        }

        long now = System.currentTimeMillis();
        if (width != lastWidth || height != lastHeight) {
            lastWidth = width;
            lastHeight = height;
            landscapeStableSince = now;
            mainHandler.postDelayed(() -> tryLaunchConsent(attempt + 1), RETRY_MS);
            return;
        }
        if (landscapeStableSince <= 0L || now - landscapeStableSince < LANDSCAPE_SETTLE_MS) {
            if (attempt >= MAX_ATTEMPTS) {
                failAndFinish(
                    "CONSENT_LANDSCAPE_UNSTABLE",
                    "A autorização não foi aberta porque a geometria horizontal continuou mudando."
                );
                return;
            }
            mainHandler.postDelayed(() -> tryLaunchConsent(attempt + 1), RETRY_MS);
            return;
        }

        MediaProjectionManager manager = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
        if (manager == null) {
            failAndFinish("MANAGER_UNAVAILABLE", "MediaProjectionManager indisponível");
            return;
        }

        try {
            Intent captureIntent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                captureIntent = manager.createScreenCaptureIntent(
                    MediaProjectionConfig.createConfigForDefaultDisplay()
                );
            } else {
                captureIntent = manager.createScreenCaptureIntent();
            }
            consentLaunched = true;
            getSharedPreferences(GtoObserverService.PREFS_NAME, MODE_PRIVATE)
                .edit()
                .putString("projectionStatus", "CONSENT_VISIBLE_OVER_GTO_LANDSCAPE")
                .remove("projectionError")
                .putInt("projectionConsentHostWidth", width)
                .putInt("projectionConsentHostHeight", height)
                .putLong("projectionConsentVisibleAt", now)
                .putString("lastEvent", "Android exibiu a autorização sobre o GTO horizontal")
                .apply();
            startActivityForResult(captureIntent, REQUEST_CAPTURE);
        } catch (Exception ex) {
            failAndFinish("CONSENT_LAUNCH_FAILED", GtoObserverService.describeError(ex));
        }
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (newConfig.orientation != Configuration.ORIENTATION_LANDSCAPE) {
            try { setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE); } catch (Exception ignored) {}
        }
    }

    @SuppressWarnings("deprecation")
    private int[] currentDisplaySize() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Rect bounds = getWindowManager().getCurrentWindowMetrics().getBounds();
                return new int[] { Math.max(1, bounds.width()), Math.max(1, bounds.height()) };
            }
            android.util.DisplayMetrics metrics = new android.util.DisplayMetrics();
            getWindowManager().getDefaultDisplay().getRealMetrics(metrics);
            return new int[] { Math.max(1, metrics.widthPixels), Math.max(1, metrics.heightPixels) };
        } catch (Exception ignored) {
            android.util.DisplayMetrics metrics = getResources().getDisplayMetrics();
            return new int[] { Math.max(1, metrics.widthPixels), Math.max(1, metrics.heightPixels) };
        }
    }

    private void failAndFinish(String status, String detail) {
        resultHandled = true;
        getSharedPreferences(GtoObserverService.PREFS_NAME, MODE_PRIVATE)
            .edit()
            .putBoolean("projectionPermissionInFlight", false)
            .putString("projectionStatus", status)
            .putString("projectionError", detail == null ? "" : detail)
            .putBoolean("projectionReauthRequired", true)
            .putBoolean("projectionReauthNoticeShown", false)
            .putString("lastEvent", detail == null || detail.isEmpty()
                ? "Autorização de leitura bloqueada antes de sair do GTO horizontal"
                : detail)
            .apply();
        GtoObserverService.reportProjectionPermissionTerminalFailure(this, status, detail);
        // Finish only this transparent host. Removing the whole task can trigger OEM
        // task-removal side effects while the observer is binding the projection token.
        finish();
        overridePendingTransition(0, 0);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_CAPTURE) return;
        resultHandled = true;

        boolean granted = resultCode == RESULT_OK && data != null;
        SharedPreferences prefs = getSharedPreferences(GtoObserverService.PREFS_NAME, MODE_PRIVATE);

        if (granted) {
            // Android's documented order is RESULT_OK -> start/promote the
            // mediaProjection foreground service -> getMediaProjection() -> register
            // callback -> createVirtualDisplay(). Do not depend on a pre-existing static
            // Service instance: a game/permission transition can reclaim the app process
            // even though Android still returns this valid one-use grant to the Activity.
            long resultAt = System.currentTimeMillis();
            // HF30: keep an in-process copy of the one-use RESULT_OK only until the
            // foreground service acknowledges/binds it. The normal service Intent remains
            // authoritative and also survives service recreation; this staged reference is
            // a same-process rescue for OEMs that delay that Intent while GTO is loading.
            GtoObserverService.stageProjectionGrantFromPermissionHost(resultCode, data, resultAt);
            prefs.edit()
                .putBoolean("projectionPermissionInFlight", true)
                .putBoolean("projectionGrantValidated", false)
                .putString("projectionStatus", "CONSENT_GRANTED_DISPATCHING")
                .putLong("projectionConsentResultAt", resultAt)
                .putString("lastEvent", "Compartilhamento aceito · iniciando captura no serviço NVU")
                .apply();

            // Same-process fast path: the observer is normally already a foreground
            // service. Queue RESULT_OK directly to its main looper immediately, then also
            // send the normal service Intent as the process-recreation-safe authoritative
            // path. Whichever arrives first wins; acceptProjectionGrantOnMainThread() is
            // duplicate-safe and never consumes the grant twice.
            boolean directRescueArmed = GtoObserverService.rescueStagedProjectionGrantIfRunning(resultAt);
            Intent serviceIntent = new Intent(this, GtoObserverService.class)
                .setAction(GtoObserverService.ACTION_START_PROJECTION)
                .putExtra(GtoObserverService.EXTRA_RESULT_CODE, resultCode)
                .putExtra(GtoObserverService.EXTRA_RESULT_DATA, data);
            try {
                if (GtoObserverService.isRunning()) {
                    startService(serviceIntent);
                } else {
                    ContextCompat.startForegroundService(this, serviceIntent);
                }
            } catch (Exception ex) {
                // If the already-running observer accepted the staged grant, a delayed or
                // rejected duplicate service Intent is not a terminal capture failure.
                if (!directRescueArmed) {
                    GtoObserverService.reportProjectionPermissionTerminalFailure(
                        this,
                        "GRANT_DISPATCH_FAILED",
                        "O Android autorizou o compartilhamento, mas o serviço de captura não pôde ser iniciado: "
                            + GtoObserverService.describeError(ex)
                    );
                    finish();
                    overridePendingTransition(0, 0);
                    return;
                }
                prefs.edit()
                    .putString("projectionDispatchWarning", GtoObserverService.describeError(ex))
                    .putString("lastEvent", "Compartilhamento aceito · vínculo direto ativo apesar do atraso do Intent")
                    .apply();
            }

            // Retry the same staged one-use result at short intervals until the service
            // acknowledges it. These are not new permission requests and cannot create a
            // second VirtualDisplay; they only close OEM scheduling races.
            mainHandler.postDelayed(
                () -> GtoObserverService.rescueStagedProjectionGrantIfRunning(resultAt),
                180L
            );
            mainHandler.postDelayed(
                () -> GtoObserverService.rescueStagedProjectionGrantIfRunning(resultAt),
                700L
            );
            waitForProjectionActivation(resultAt);
            return;
        }

        prefs.edit()
            .putBoolean("projectionPermissionInFlight", false)
            .putBoolean("projectionGrantValidated", false)
            .putString("projectionStatus", "DENIED")
            .putString("lastEvent", "Autorização de leitura recusada")
            .apply();

        Intent serviceIntent = new Intent(this, GtoObserverService.class)
            .setAction(GtoObserverService.ACTION_PROJECTION_DENIED);
        try {
            if (GtoObserverService.isRunning()) {
                startService(serviceIntent);
            } else {
                ContextCompat.startForegroundService(this, serviceIntent);
            }
        } catch (Exception ex) {
            GtoObserverService.reportProjectionPermissionTerminalFailure(
                this, "DENIED_DISPATCH_FAILED", GtoObserverService.describeError(ex)
            );
        }

        finish();
        overridePendingTransition(0, 0);
    }

    private void waitForProjectionActivation(long resultAt) {
        final long deadline = System.currentTimeMillis() + GRANT_ACK_TIMEOUT_MS;
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                if (isFinishing()) return;
                SharedPreferences prefs = getSharedPreferences(GtoObserverService.PREFS_NAME, MODE_PRIVATE);
                boolean active = prefs.getBoolean("projectionActive", false);
                boolean grantValidated = prefs.getBoolean("projectionGrantValidated", false);
                String status = prefs.getString("projectionStatus", "");
                String error = prefs.getString("projectionError", "");
                long firstFrameAt = prefs.getLong("projectionFirstFrameAt", 0L);
                long grantReceivedAt = prefs.getLong("projectionGrantReceivedAt", 0L);
                if (!active && !grantValidated
                    && grantReceivedAt < resultAt
                    && System.currentTimeMillis() - resultAt >= 700L) {
                    GtoObserverService.rescueStagedProjectionGrantIfRunning(resultAt);
                }

                if (active && grantValidated) {
                    prefs.edit()
                        .putBoolean("projectionPermissionInFlight", false)
                        .putString("lastEvent", firstFrameAt > 0L
                            ? "Leitura funcional · captura e quadros validados"
                            : "Captura ativa · aguardando o primeiro quadro do GTO")
                        .apply();
                    finish();
                    overridePendingTransition(0, 0);
                    return;
                }

                boolean terminal = "START_FAILED".equals(status)
                    || "GRANT_DATA_INVALID".equals(status)
                    || "GRANT_DISPATCH_FAILED".equals(status)
                    || "STOPPED".equals(status)
                    || "STOPPED_EARLY".equals(status)
                    || "STOPPED_BEFORE_SURFACE".equals(status);
                if (terminal) {
                    prefs.edit()
                        .putBoolean("projectionPermissionInFlight", false)
                        .putString("lastEvent", error == null || error.isEmpty()
                            ? "A captura não pôde ser iniciada após o compartilhamento"
                            : "Falha ao iniciar captura: " + error)
                        .apply();
                    finish();
                    overridePendingTransition(0, 0);
                    return;
                }

                if (System.currentTimeMillis() >= deadline) {
                    // Do not convert a slow service start into a false denial. The
                    // foreground service continues owning the valid result and its own
                    // watchdog will publish a real failure if initialization actually
                    // fails.
                    prefs.edit()
                        .putString("lastEvent", "Compartilhamento aceito · serviço ainda concluindo a ativação")
                        .apply();
                    finish();
                    overridePendingTransition(0, 0);
                    return;
                }
                mainHandler.postDelayed(this, GRANT_ACK_POLL_MS);
            }
        });
    }

    @Override
    public void finish() {
        super.finish();
        overridePendingTransition(0, 0);
    }

    @Override
    protected void onDestroy() {
        // With finishOnTaskLaunch removed from the manifest, Android must normally return
        // the screen-capture result here through onActivityResult(). If an OEM nevertheless
        // tears down this host without a result, clear the in-flight latch instead of
        // leaving the floating menu permanently stuck at "Autorização em andamento".
        if (consentLaunched && !resultHandled && isFinishing() && !isChangingConfigurations()) {
            GtoObserverService.reportProjectionPermissionTerminalFailure(
                this,
                "CONSENT_HOST_FINISHED_WITHOUT_RESULT",
                "A tela de autorização foi encerrada sem devolver um resultado ao NVU."
            );
        }
        super.onDestroy();
    }
}
