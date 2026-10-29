package com.nvu.operacional;

import android.app.ActivityManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.WindowInsets;
import android.view.WindowMetrics;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import com.google.firebase.Timestamp;
import com.google.firebase.firestore.DocumentSnapshot;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.QuerySnapshot;
import com.google.firebase.firestore.Source;
import com.google.android.gms.tasks.Tasks;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Native overlay for NVU's independent Simple Automatic mode.
 *
 * This service intentionally has no GTO detector, Usage Access, freight state or
 * GTO queue integration. It owns the reusable NVU bubble, city route selection,
 * a local simple-mode session snapshot and the one-shot MediaProjection receipt
 * capture flow used after the driver finishes a route.
 */
public final class SimpleAutomationService extends Service {
    // Responsibility boundary: capture/permission and overlay lifecycle are
    // explicit collaborators; receipt submission remains an adapter.
    private final GtoServiceBoundaries serviceBoundaries = new GtoServiceBoundaries();
    public static final String PREFS_NAME = "nvu_simple_automation";
    public static final String ACTION_START = "com.nvu.operacional.simple.START";
    public static final String ACTION_STOP = "com.nvu.operacional.simple.STOP";
    public static final String ACTION_START_CAPTURE = "com.nvu.operacional.simple.START_CAPTURE";
    public static final String EXTRA_RESULT_CODE = "simpleProjectionResultCode";
    public static final String EXTRA_RESULT_DATA = "simpleProjectionResultData";

    public static final String STATE_IDLE = "IDLE";
    public static final String STATE_ROUTE_ORIGIN = "ROUTE_ORIGIN";
    public static final String STATE_ROUTE_DESTINATION = "ROUTE_DESTINATION";
    public static final String STATE_TRIP_ACTIVE = "TRIP_ACTIVE";
    public static final String STATE_CAPTURE_PENDING = "CAPTURE_PENDING";
    public static final String STATE_COMPLETED = "COMPLETED";
    public static final String STATE_REJECTED_AD = "REJECTED_AD";
    public static final String STATE_CANCELLED = "CANCELLED";

    private static final String CHANNEL_ID = "nvu_simple_automation";
    private static final int NOTIFICATION_ID = 4717;
    private static final String DEFAULT_STATE = STATE_IDLE;
    private static final long BUBBLE_GESTURE_IDLE_TIMEOUT_MS = 1800L;
    private static final long BUBBLE_GESTURE_MAX_DURATION_MS = 12000L;
    private static final long BUBBLE_STOP_RELEASE_FRESH_MS = 900L;
    private static final long SIMULATOR_LAUNCH_HANDSHAKE_MAX_MS = 12000L;
    // Give Android one task-switch window to commit the external simulator launch
    // before opening the MediaProjection consent host. This is deliberately a
    // fixed scheduling barrier, not a foreground/package check.
    private static final long SIMULATOR_TO_CAPTURE_BARRIER_MS = 800L;
    private static final int BUBBLE_POSITION_SCALE = 10_000;
    private static final int PRO_MESSAGE_MIN_BAND_DP = 76;
    private static final long RECENT_FOREGROUND_HEARTBEAT_MAX_MS = 30_000L;
    private static final String PRO_TIMING_TAG = "NVU-ProTiming";
    private static final String PRO_HISTORY_TAG = "NVU-ProHistory";
    private static final String HISTORY_SCOPES_PREF = "operationHistoryScopesJson";
    private static final long HISTORY_RECONCILE_THROTTLE_MS = 1200L;

    private static volatile SimpleAutomationService instance;

    private WindowManager windowManager;
    private android.content.SharedPreferences prefs;
    private View bubbleView;
    private TextView bubbleLabelView;
    private View captureHealthDotView;
    private LinearLayout menuView;
    private NativeRouteReadySnapshot statusChipRouteReady;
    private WindowManager.LayoutParams bubbleParams;
    private WindowManager.LayoutParams menuParams;
    private int menuBaseY;
    private boolean destroying;
    private final NativeBubbleVisibility bubbleCardVisibility = new NativeBubbleVisibility();
    private final NativeOverlayCardVisibility cardVisibility =
        new NativeOverlayCardVisibility(this::applyBubbleCardVisibility);
    private boolean historyExpanded;
    private int bubbleLayoutDisplayWidth;
    private int bubbleLayoutDisplayHeight;
    private TextView bubbleRemoveTargetView;
    private WindowManager.LayoutParams bubbleRemoveTargetParams;
    private boolean bubbleRemoveTargetHighlighted;
    private long bubbleGestureGeneration;
    private long bubbleActiveGestureGeneration;
    private int bubbleGesturePointerId = MotionEvent.INVALID_POINTER_ID;
    private boolean bubbleGestureActive;
    private boolean bubbleDragging;
    private float bubbleGestureDownRawX;
    private float bubbleGestureDownRawY;
    private int bubbleGestureStartX;
    private int bubbleGestureStartY;
    private long bubbleGestureDownAt;
    private long bubbleGestureLastEventAt;
    private long bubbleTapCount;
    private long bubbleLastTapAt;
    private Handler mainHandler;
    private volatile boolean captureFrameRequested;
    private volatile boolean temporaryReceiptCapture;
    private final Runnable visibilityMonitorRunnable = this::monitorSimulatorVisibility;
    private final Runnable captureConsentTimeoutRunnable = () -> {
        if (prefs == null) return;
        String stage = safe(prefs.getString("captureStage", ""));
        String state = safe(prefs.getString("simpleState", DEFAULT_STATE));
        if (("CONSENT_PENDING".equals(stage) || "CONSENT_LAUNCHING".equals(stage))
            && STATE_CAPTURE_PENDING.equals(state) && !captureFrameRequested) {
            android.util.Log.w(PRO_TIMING_TAG, "stage=consent_timeout fallback=web_retry");
            failCapture("A autorização de captura demorou além do limite. Tente novamente.");
        }
    };

    /**
     * captureUiHidden is a visual-suppression flag, not a global input lock.
     * The bubble must remain interactive while the one-shot capture/submission
     * pipeline is running, otherwise an interrupted capture can leave a visible
     * but permanently "frozen" NVU control. Only the Android consent surface
     * itself is a true interaction-blocking state.
     */
    private boolean isCaptureConsentSurfaceActive() {
        if (prefs == null) return false;
        String stage = safe(prefs.getString("captureStage", ""));
        return "CONSENT_PENDING".equals(stage) || "CONSENT_LAUNCHING".equals(stage);
    }

    private boolean isCapturePipelineActive() {
        if (prefs == null) return false;
        String state = safe(prefs.getString("simpleState", DEFAULT_STATE));
        String stage = safe(prefs.getString("captureStage", ""));
        return STATE_CAPTURE_PENDING.equals(state)
            || "CAPTURING".equals(stage)
            || "VIRTUAL_DISPLAY_CREATED".equals(stage)
            || "OCR_PROCESSING".equals(stage)
            || "OCR_RETRYING".equals(stage)
            || "OCR_VALIDATING".equals(stage)
            || "NATIVE_SUBMITTING".equals(stage)
            || "CAPTURE_CAPTURED".equals(state)
            || "SUBMITTING_NATIVE".equals(prefs.getString("nativeSubmissionState", ""));
    }

    private void recoverStaleCaptureUiLock() {
        if (prefs == null || !prefs.getBoolean("captureUiHidden", false)) return;
        if (isCaptureConsentSurfaceActive() || isCapturePipelineActive()) return;
        prefs.edit()
            .putBoolean("captureUiHidden", false)
            .putString("lastEvent", "Bloqueio visual de captura recuperado; botão NVU reativado")
            .apply();
    }

    private String pendingInFlightId = "";
    private int pendingInFlightGeneration;
    private final Runnable nativeSubmissionTimeoutRunnable = () -> {
        String id = pendingInFlightId;
        if (id.isEmpty()) return;
        if (prefs == null || !ProPendingTripStore.contains(prefs, id)) {
            pendingInFlightId = "";
            pendingInFlightGeneration = -1;
            processPendingProTrips();
            return;
        }
        SharedPreferences entry = ProPendingTripStore.entry(this, id);
        if (ProPendingTripStore.isCompletionRecorded(prefs, entry) || !ProPendingTripStore.isRetryAllowed(entry)
            || pendingInFlightGeneration != entry.getInt("nativeAttemptGeneration", 0)) {
            pendingInFlightId = "";
            pendingInFlightGeneration = -1;
            processPendingProTrips();
            return;
        }
        entry.edit().putString("nativeSubmissionState", "QUEUED")
            .putInt("nativeAttemptGeneration", ++pendingInFlightGeneration)
            .putString("queueStatus", "WAITING")
            .putLong("retryAt", System.currentTimeMillis() + 5000L)
            .putString("lastQueueError", "Tempo de resposta excedido; nova tentativa automática")
            .apply();
        pendingInFlightId = "";
        showPendingTripCard(id, hasUsableNetwork()
            ? "Tentando enviar novamente" : "Aguardando envio · sem rede");
    };

    private final Runnable nativeSubmissionRetryRunnable = new Runnable() {
        @Override public void run() {
            processPendingProTrips();
            if (mainHandler != null) mainHandler.postDelayed(this, NATIVE_SUBMISSION_RETRY_INTERVAL_MS);
        }
    };
    private boolean simulatorVisible;
    private boolean simulatorVisibilityEstablished;
    private boolean simulatorLaunchPending;
    private long simulatorLaunchPendingUntil;
    private String simulatorLaunchPackage = "";
    private View statusChipView;
    private WindowManager.LayoutParams statusChipParams;
    private Runnable statusChipHideRunnable;
    private NvuAudioManager audioManager;
    private float downRawX;
    private float downRawY;
    private int downX;
    private int downY;
    private boolean dragging;
    private boolean summaryExpanded;
    private String selectedInitial = "";
    private String lastCaptureHealthIndicatorState;
    private HandlerThread captureThread;
    private Handler captureHandler;
    private TextRecognizer textRecognizer;
    private MediaProjection mediaProjection;
    private android.hardware.display.VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private volatile boolean captureOcrInFlight;
    private volatile int captureOcrAttempts;
    private String captureOcrEvidence = "";
    private long captureStartedAt;
    private volatile long captureStartedElapsedAt;
    private static final long CAPTURE_FRAME_WARMUP_MS = 250L;
    private static final long CAPTURE_FRAME_RETRY_MS = 160L;
    // Four independent OCR passes can take longer than the old eight-second
    // timer on a busy phone. Keep a bounded capture without aborting an active
    // read and report separately when the projection supplies no frames.
    private static final long CAPTURE_WATCHDOG_MS = 30000L;
    private static final long CAPTURE_OCR_HARD_LIMIT_MS = 45000L;
    // A readable OCR frame is not enough: a result modal can be split across OCR
    // blocks/frames. Keep a short bounded consensus window and fuse full-frame +
    // center-modal evidence before handing the receipt to the Web policy.
    private static final int CAPTURE_MAX_OCR_ATTEMPTS = 12;
    private static final long VISIBILITY_POLL_MS = 250L;
    // Retry is only a safety net; online submissions wait for the server ACK
    // directly. Keep recovery responsive after auth/network return.
    private static final long NATIVE_SUBMISSION_RETRY_INTERVAL_MS = 5000L;
    private static final long NATIVE_SUBMISSION_TIMEOUT_MS = 30000L;
    private static final long NATIVE_SUBMISSION_STALE_MS = 10000L;
    private static final long NATIVE_AUTH_RETRY_COOLDOWN_MS = 60000L;
    private static final long NATIVE_PERMISSION_RETRY_COOLDOWN_MS = 60000L;
    private static final java.util.concurrent.atomic.AtomicBoolean authRecoveryInFlight =
        new java.util.concurrent.atomic.AtomicBoolean(false);
    private static final long CAPTURE_CONSENT_TIMEOUT_MS = 10000L;

    private final MediaProjection.Callback projectionCallback = new MediaProjection.Callback() {
        @Override
        public void onStop() {
            cleanupCapture();
        }
    };

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    public static boolean isRunning() {
        return instance != null;
    }

    public static void triggerPendingProcessing() {
        SimpleAutomationService active = instance;
        if (active != null) active.mainHandlerPost(() -> {
            recoverAuthenticatedPending(active);
            active.processPendingProTrips();
        });
    }

    /** Rechecks the native identity when the app opens or native auth changes. */
    public static void triggerPendingProcessing(Context context) {
        if (context == null) return;
        SimpleAutomationService active = instance;
        if (active != null) {
            active.mainHandlerPost(() -> {
                recoverAuthenticatedPending(active);
                active.processPendingProTrips();
            });
            return;
        }
        Context appContext = context.getApplicationContext();
        recoverAuthenticatedPending(appContext);
        ProPendingTripJobService.scheduleImmediate(appContext);
    }

    /** Resume only a saved receipt owned by the matching native UID after
     * obtaining a fresh token. A later rules denial is retried as a server
     * failure, never relabeled as another interactive Google login. */
    public static void recoverAuthenticatedPending(Context context) {
        if (context == null) return;
        Context appContext = context.getApplicationContext();
        SharedPreferences index = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        ProPendingTripStore.recoverAutomatically(appContext, index);
        com.google.firebase.auth.FirebaseUser user = GtoFirebaseRuntime.currentUser(appContext);
        String nativeUid = user == null ? "" : safe(user.getUid());
        boolean matching = false;
        for (String id : ProPendingTripStore.ids(index)) {
            SharedPreferences entry = ProPendingTripStore.entry(appContext, id);
            if (ProPendingTripStore.isCompletionRecorded(index, entry)) continue;
            String entryDriverId = safe(entry.getString("driverId", ""));
            String queueStatus = safe(entry.getString("queueStatus", ""));
            String legacyError = safe(entry.getString("lastQueueError", ""));
            boolean legacyAuthFailure = "WAITING".equals(queueStatus)
                && (legacyError.contains("Autenticação nativa não corresponde")
                    || safe(entry.getString("lastQueueErrorCode", "")).contains("Autenticação nativa não corresponde"));
            if (legacyAuthFailure) {
                boolean sameNativeIdentity = !nativeUid.isEmpty() && nativeUid.equals(entryDriverId);
                boolean migrated = entry.edit()
                    .putString("queueStatus", "AUTH_REQUIRED")
                    .putString("nativeSubmissionState", "AUTH_REQUIRED")
                    .putString("nativeAuthState", nativeUid.isEmpty() ? "MISSING" : (sameNativeIdentity ? "MATCH" : "DIVERGENT"))
                    .putBoolean("nativeAuthRequired", true)
                    .putLong("nativeAuthDiagnosticAt", System.currentTimeMillis())
                    .putString("lastQueueError", "Autenticação Google necessária para retomar o envio desta viagem.")
                    .commit();
                if (migrated) queueStatus = "AUTH_REQUIRED";
            }
            if ("AUTH_REQUIRED".equals(queueStatus) && !nativeUid.isEmpty()
                && nativeUid.equals(entryDriverId)) {
                matching = true;
                break;
            }
        }
        if (!matching) return;
        if (!authRecoveryInFlight.compareAndSet(false, true)) return;
        try {
            user.getIdToken(true).addOnCompleteListener(result -> {
                try {
                    com.google.firebase.auth.FirebaseUser current = GtoFirebaseRuntime.currentUser(appContext);
                    if (!result.isSuccessful() || current == null || !nativeUid.equals(current.getUid())) return;
                    boolean released = false;
                    for (String id : ProPendingTripStore.ids(index)) {
                        SharedPreferences entry = ProPendingTripStore.entry(appContext, id);
                        if (ProPendingTripStore.isCompletionRecorded(index, entry)) continue;
                        if (!nativeUid.equals(safe(entry.getString("driverId", "")))
                            || !"AUTH_REQUIRED".equals(entry.getString("queueStatus", ""))) continue;
                        released |= entry.edit().putString("queueStatus", "WAITING")
                            .putString("nativeSubmissionState", "QUEUED")
                            .putString("nativeAuthState", "MATCH")
                            .putBoolean("nativeAuthRequired", false)
                            .putLong("retryAt", 0L)
                            .remove("lastQueueError")
                            .remove("nativeSubmissionError")
                            .commit();
                    }
                    if (released) {
                        index.edit().putString("nativeAuthState", "MATCH")
                            .putBoolean("nativeAuthRequired", false).apply();
                        triggerPendingProcessing(appContext);
                    }
                } finally {
                    authRecoveryInFlight.set(false);
                }
            });
        } catch (RuntimeException error) {
            authRecoveryInFlight.set(false);
        }
    }

    public static boolean hasCapturedReceipt(Context context) {
        if (context == null) return false;
        android.content.SharedPreferences preferences = context.getApplicationContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return "CAPTURE_CAPTURED".equals(preferences.getString("simpleState", DEFAULT_STATE))
            && !safe(preferences.getString("receiptText", "")).isEmpty()
            && !safe(preferences.getString("captureAttemptId", "")).isEmpty();
    }

    public static long getCapturedReceiptEventVersion(Context context) {
        if (context == null) return 0L;
        return context.getApplicationContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getLong("captureEventVersion", 0L);
    }

    public static void markSimulatorLaunchRequested(Context context, String packageId) {
        if (context == null || safe(packageId).isEmpty()) return;
        Context appContext = context.getApplicationContext();
        appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString("pendingSimulatorLaunchPackage", safe(packageId))
            .putLong("pendingSimulatorLaunchAt", System.currentTimeMillis())
            .apply();
        if (instance != null) instance.markSimulatorLaunchRequestedInternal(packageId);
    }

    private void markSimulatorLaunchRequestedInternal(String packageId) {
        simulatorLaunchPackage = safe(packageId);
        simulatorLaunchPending = !simulatorLaunchPackage.isEmpty();
        simulatorLaunchPendingUntil = System.currentTimeMillis() + SIMULATOR_LAUNCH_HANDSHAKE_MAX_MS;
        if (prefs != null) prefs.edit().putString("simulatorVisibility", "UNKNOWN").apply();
        if (mainHandler != null) {
            mainHandler.removeCallbacks(visibilityMonitorRunnable);
            mainHandler.post(visibilityMonitorRunnable);
        }
    }

    public static boolean startIfAllowed(Context context) {
        if (context == null) return false;
        resetOrphanedCaptureState(context.getApplicationContext());
        // ProModeController already validated overlay at the user start boundary.
        // The service continues preparation asynchronously and does not re-query
        // Android Settings during startup.
        try {
            Intent intent = new Intent(context.getApplicationContext(), SimpleAutomationService.class)
                .setAction(ACTION_START);
            androidx.core.content.ContextCompat.startForegroundService(context.getApplicationContext(), intent);
            return true;
        } catch (Exception error) {
            return false;
        }
    }

    public static boolean isServiceAlive() {
        SimpleAutomationService current = instance;
        return current != null && current.prefs != null && current.prefs.getBoolean("running", false);
    }

    public static boolean isBubbleAttached() {
        SimpleAutomationService current = instance;
        return current != null && current.bubbleView != null && current.bubbleView.isAttachedToWindow();
    }

    public static void requestBubbleRecovery() {
        SimpleAutomationService current = instance;
        if (current == null || current.mainHandler == null) return;
        current.mainHandler.post(() -> current.showBubbleIfAllowed(true));
    }

    private static void resetProSessionState(Context context) {
        if (context == null) return;
        android.content.SharedPreferences preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String state = preferences.getString("simpleState", DEFAULT_STATE);
        if (STATE_TRIP_ACTIVE.equals(state)) {
            preferences.edit()
                .putString("simpleState", STATE_IDLE)
                .putBoolean("captureUiHidden", false)
                .putString("captureStage", "IDLE")
                .putString("simulatorVisibility", "UNKNOWN")
                .putBoolean("visibilityEstablished", false)
                .remove("lastSimulatorVisiblePackage")
                .remove("lastSimulatorVisibleAt")
                .remove("lastSimulatorVisibleSource")
                .remove("origin")
                .remove("destination")
                .remove("lastEvent")
                .remove("receiptText")
                .remove("captureRequestedAt")
                .remove("receiptCapturedAt")
                .remove("tripStartedAt")
                .remove("routeUpdatedAt")
                .apply();
        }
        resetOrphanedCaptureState(context);
    }

    private static void resetOrphanedCaptureState(Context context) {
        if (context == null) return;
        android.content.SharedPreferences preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String state = preferences.getString("simpleState", DEFAULT_STATE);
        boolean capturedReceiptRecoverable = "CAPTURE_CAPTURED".equals(state)
            && hasCapturedReceipt(context)
            && !safe(preferences.getString("captureContextEpoch", "")).isEmpty();
        boolean captureState = STATE_CAPTURE_PENDING.equals(state)
            || capturedReceiptRecoverable
            || "CAPTURE_ERROR".equals(state);
        boolean terminalState = "CAPTURE_ERROR".equals(state)
            || STATE_COMPLETED.equals(state)
            || STATE_REJECTED_AD.equals(state)
            || STATE_CANCELLED.equals(state);
        boolean hasRoute = !safe(preferences.getString("origin", "")).isEmpty()
            && !safe(preferences.getString("destination", "")).isEmpty();
        // An explicit new Pro start must not resurrect a terminal receipt/error
        // from the previous session, even when acknowledgeReceipt left the old
        // route visible for history. A pending capture with a real route remains
        // resumable; a capture state without a route is always orphaned.
        if ((!captureState && !terminalState) || (STATE_CAPTURE_PENDING.equals(state) && hasRoute) || capturedReceiptRecoverable) return;
        preferences.edit()
            .putString("simpleState", STATE_IDLE)
            .putString("captureStage", "IDLE")
            .putBoolean("captureUiHidden", false)
            .remove("origin")
            .remove("destination")
            .remove("lastEvent")
            .remove("receiptText")
            .remove("captureRequestedAt")
            .remove("receiptCapturedAt")
            .apply();
    }

    public static void updateCities(Context context, String citiesJson) {
        if (context == null) return;
        context.getApplicationContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString("citiesJson", safe(citiesJson))
            .apply();
    }

    public static void updateContext(
        Context context,
        String simulatorKey,
        String simulatorCode,
        String simulatorLabel,
        String contextEpoch,
        String companyName,
        String operationName,
        String contractName,
        String jobId,
        String contractId,
        String companyId,
        String driverId,
        int jobProgress,
        int jobTotalDeliveries,
        String jobStatus,
        boolean operationClosed,
        String vehicleName,
        String trailerName,
        String packageId,
        String citiesJson
    ) {
        if (context == null) return;
        android.content.SharedPreferences preferences = context.getApplicationContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String existingState = preferences.getString("simpleState", DEFAULT_STATE);
        boolean historyScopeChanged = !safe(jobId).equals(safe(preferences.getString("historyScopeJobId", "")))
            || !safe(companyId).equals(safe(preferences.getString("historyScopeCompanyId", "")))
            || !safe(driverId).equals(safe(preferences.getString("historyScopeDriverId", "")));
        boolean preservePendingReceipt = STATE_CAPTURE_PENDING.equals(existingState)
            || hasCapturedReceipt(context);
        if (historyScopeChanged) preserveHistoryScope(preferences);
        android.content.SharedPreferences.Editor editor = preferences.edit();
        editor.putString("simulatorKey", safe(simulatorKey));
        editor.putString("simulatorCode", safe(simulatorCode));
        editor.putString("simulatorLabel", safe(simulatorLabel));
        editor.putString("contextEpoch", safe(contextEpoch));
        editor.putString("simulatorVisibility", "UNKNOWN");
        editor.putBoolean("visibilityEstablished", false);
        editor.remove("lastSimulatorVisiblePackage");
        editor.remove("lastSimulatorVisibleAt");
        editor.remove("lastSimulatorVisibleSource");
        editor.putString("companyName", safe(companyName).isEmpty() ? "Empresa" : safe(companyName));
        editor.putString("operationName", safe(operationName).isEmpty() ? "Operação Pro" : safe(operationName));
        editor.putString("contractName", safe(contractName).isEmpty() ? "Operação Pro" : safe(contractName));
        editor.putString("jobId", safe(jobId));
        editor.putString("contractId", safe(contractId));
        editor.putString("companyId", safe(companyId));
        editor.putString("driverId", safe(driverId));
        int safeProgress = Math.max(0, jobProgress);
        int safeTotal = Math.max(0, jobTotalDeliveries);
        boolean computedClosed = operationClosed
            || "completed".equalsIgnoreCase(safe(jobStatus))
            || "cancelled".equalsIgnoreCase(safe(jobStatus))
            || (safeTotal > 0 && safeProgress >= safeTotal);
        editor.putInt("confirmedTripCount", safeProgress);
        editor.putInt("jobProgress", safeProgress);
        editor.putInt("profileJobProgress", safeProgress);
        editor.putInt("jobTotalDeliveries", safeTotal);
        editor.putString("jobStatus", safe(jobStatus));
        editor.putBoolean("operationClosed", computedClosed);
        editor.putString("vehicleName", safe(vehicleName));
        editor.putString("trailerName", safe(trailerName));
        editor.putString("packageId", safe(packageId));
        editor.putString("citiesJson", safe(citiesJson));
        if (historyScopeChanged) {
            JSONArray restored = readHistoryScopes(preferences).optJSONArray(
                historyScopeKey(jobId, companyId, driverId));
            editor.putString("operationHistoryJson", restored == null ? "[]" : restored.toString())
                .putString("historyScopeJobId", safe(jobId))
                .putString("historyScopeCompanyId", safe(companyId))
                .putString("historyScopeDriverId", safe(driverId))
                .putString("historyLoadState", "LOCAL");
        }
        if (!preservePendingReceipt) {
            editor.remove("captureAttemptId");
            editor.remove("captureContextEpoch");
            editor.remove("captureSimulatorKey");
            editor.remove("captureSimulatorCode");
            editor.remove("captureOrigin");
            editor.remove("captureDestination");
            editor.remove("captureCompanyId");
            editor.remove("captureJobId");
            editor.remove("captureContractId");
            editor.remove("capturePackageId");
        }
        resetProSessionState(context.getApplicationContext());
        editor.apply();
        if (instance != null) {
            instance.selectedInitial = "";
            instance.refreshMenuContents();
        }
        reconcileOperationHistory(context.getApplicationContext(), jobId, companyId, driverId);
    }

    public static void refreshOperationSnapshot(
        Context context, String companyName, String operationName, String contractName,
        String jobId, String contractId, String companyId, String driverId, int jobProgress,
        int jobTotalDeliveries, String jobStatus, boolean operationClosed, String vehicleName,
        String trailerName
    ) {
        SharedPreferences prefs = context == null ? null : context.getApplicationContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        long nextRevision = prefs == null ? 0L
            : Math.max(0L, prefs.getLong("operationContextRevision", 0L)) + 1L;
        refreshOperationSnapshot(context, companyName, operationName, contractName, jobId, contractId,
            companyId, driverId, jobProgress, jobTotalDeliveries, jobStatus, operationClosed,
            vehicleName, trailerName, nextRevision);
    }

    public static void refreshOperationSnapshot(
        Context context, String companyName, String operationName, String contractName,
        String jobId, String contractId, String companyId, String driverId, int jobProgress,
        int jobTotalDeliveries, String jobStatus, boolean operationClosed, String vehicleName,
        String trailerName, long operationContextRevision
    ) {
        if (context == null) return;
        android.content.SharedPreferences preferences = context.getApplicationContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        int safeProgress = Math.max(0, jobProgress);
        int safeTotal = Math.max(0, jobTotalDeliveries);
        boolean closed = operationClosed
            || "completed".equalsIgnoreCase(safe(jobStatus))
            || "cancelled".equalsIgnoreCase(safe(jobStatus))
            || (safeTotal > 0 && safeProgress >= safeTotal);
        String existingJobId = safe(preferences.getString("jobId", ""));
        String existingCompanyId = safe(preferences.getString("companyId", ""));
        String existingDriverId = safe(preferences.getString("driverId", ""));
        if ((!safe(jobId).isEmpty() && !existingJobId.isEmpty() && !safe(jobId).equals(existingJobId))
            || (!safe(companyId).isEmpty() && !existingCompanyId.isEmpty() && !safe(companyId).equals(existingCompanyId))
            || (!safe(driverId).isEmpty() && !existingDriverId.isEmpty() && !safe(driverId).equals(existingDriverId))) {
            android.util.Log.w(PRO_HISTORY_TAG, "snapshot descartado por mudança de operação"
                + " jobId=" + safe(jobId) + " currentJobId=" + existingJobId
                + " companyId=" + safe(companyId) + " currentCompanyId=" + existingCompanyId
                + " driverId=" + safe(driverId) + " currentDriverId=" + existingDriverId);
            return;
        }
        int existingProgress = Math.max(0, preferences.getInt("jobProgress", 0));
        boolean existingClosed = preferences.getBoolean("operationClosed", false);
        long existingRevision = Math.max(0L, preferences.getLong("operationContextRevision", 0L));
        long incomingRevision = Math.max(0L, operationContextRevision);
        if (safeProgress < existingProgress && readLocalHistory(preferences).length() > safeProgress) {
            // The WebView may still hold the old job after a native ACK. A
            // genuine deletion is applied after the job is read from server.
            verifyOperationProgressFromServer(context.getApplicationContext(), jobId, companyId, driverId);
            return;
        }
        if (!shouldAcceptOperationSnapshot(
            existingJobId, safe(jobId), existingProgress, safeProgress,
            existingClosed, closed, existingRevision, incomingRevision)) {
            return;
        }
        android.content.SharedPreferences.Editor editor = preferences.edit();
        if (!safe(companyName).isEmpty()) editor.putString("companyName", safe(companyName));
        if (!safe(operationName).isEmpty()) editor.putString("operationName", safe(operationName));
        if (!safe(contractName).isEmpty()) editor.putString("contractName", safe(contractName));
        if (!safe(jobId).isEmpty()) editor.putString("jobId", safe(jobId));
        if (!safe(contractId).isEmpty()) editor.putString("contractId", safe(contractId));
        if (!safe(companyId).isEmpty()) editor.putString("companyId", safe(companyId));
        if (!safe(driverId).isEmpty()) editor.putString("driverId", safe(driverId));
        editor.putInt("confirmedTripCount", safeProgress);
        editor.putInt("jobProgress", safeProgress);
        editor.putInt("profileJobProgress", safeProgress);
        editor.putInt("jobTotalDeliveries", safeTotal);
        if (incomingRevision > 0L) editor.putLong("operationContextRevision", incomingRevision);
        editor.putString("jobStatus", safe(jobStatus));
        editor.putBoolean("operationClosed", closed);
        editor.putString("vehicleName", safe(vehicleName));
        editor.putString("trailerName", safe(trailerName));
        editor.putString("lastEvent", closed
            ? closedOperationMessage(jobStatus)
            : "Operação atualizada.");
        editor.apply();
        if (instance != null) {
            instance.refreshMenuContents();
            if (closed) {
                instance.showStatusChip(closedOperationMessage(jobStatus), 6500L);
            }
        }
        reconcileOperationHistory(context.getApplicationContext(), jobId, companyId, driverId);
    }

    private static void verifyOperationProgressFromServer(
        Context context, String jobId, String companyId, String driverId
    ) {
        if (context == null || safe(jobId).isEmpty()) return;
        long requestedAt = System.currentTimeMillis();
        FirebaseFirestore.getInstance().collection("trabalhos").document(jobId)
            .get(Source.SERVER).addOnSuccessListener(document -> {
                if (!document.exists() || document.getData() == null) return;
                Map<String, Object> job = document.getData();
                if (!safe(driverId).equals(firstText(job, "driverId", "motoristaId", "userId"))
                    || !safe(companyId).equals(firstText(job, "companyId", "empresaId"))) return;
                SharedPreferences fresh = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                if (!historyScopeKey(jobId, companyId, driverId).equals(historyScopeKey(
                    fresh.getString("jobId", ""), fresh.getString("companyId", ""),
                    fresh.getString("driverId", "")))) return;
                JSONArray latestRows = readLocalHistory(fresh);
                for (int i = 0; i < latestRows.length(); i++) {
                    JSONObject row = latestRows.optJSONObject(i);
                    if (row != null && row.optLong("nativeAckAt", 0L) > requestedAt) return;
                }
                Object value = job.get("progress");
                if (!(value instanceof Number)) return;
                int verifiedProgress = ((Number) value).intValue();
                if (verifiedProgress < 0 || verifiedProgress > 9999) return;
                fresh.edit().putInt("jobProgress", verifiedProgress)
                    .putInt("profileJobProgress", verifiedProgress).apply();
                if (instance != null) instance.mainHandler.post(instance::refreshMenuContents);
                reconcileOperationHistory(context, jobId, companyId, driverId);
            }).addOnFailureListener(error ->
                android.util.Log.w(PRO_HISTORY_TAG, "progresso do trabalho indisponível; ACK preservado", error));
    }

    /**
     * Decides whether an operation snapshot may replace the current native snapshot.
     *
     * For the same operation identity, the snapshot revision is authoritative.
     * Progress itself is mutable: a legitimate trip deletion/reconciliation can
     * move 09 -> 08. A newer revision therefore replaces an older progress value,
     * while an older revision is rejected to prevent stale CompletionBridge writes.
     */
    static boolean shouldAcceptOperationSnapshot(
        String existingJobId, String incomingJobId,
        int existingProgress, int incomingProgress,
        boolean existingClosed, boolean incomingClosed,
        long existingRevision, long incomingRevision
    ) {
        if (!safe(incomingJobId).isEmpty() && !safe(existingJobId).isEmpty()
            && !safe(incomingJobId).equals(safe(existingJobId))) {
            return true;
        }
        if (!safe(incomingJobId).isEmpty() && safe(incomingJobId).equals(safe(existingJobId))) {
            // Progress is mutable state: a legitimate trip deletion can move 09 -> 08.
            // Revision, not the numeric progress value, determines freshness.
            if (incomingRevision > 0L && existingRevision > 0L && incomingRevision < existingRevision) return false;
            if (incomingRevision == 0L && existingRevision > 0L) return false;
            if (incomingRevision == 0L && existingClosed && !incomingClosed) return false;
        }
        return true;
    }

    public static void refreshOperationState(
        Context context,
        int jobProgress,
        int jobTotalDeliveries,
        String jobStatus,
        boolean operationClosed
    ) {
        if (context == null) return;
        android.content.SharedPreferences preferences = context.getApplicationContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        int safeProgress = Math.max(0, jobProgress);
        int safeTotal = Math.max(0, jobTotalDeliveries);
        boolean closed = operationClosed
            || "completed".equalsIgnoreCase(safe(jobStatus))
            || "cancelled".equalsIgnoreCase(safe(jobStatus))
            || (safeTotal > 0 && safeProgress >= safeTotal);
        int existingProgress = Math.max(0, preferences.getInt("jobProgress", 0));
        boolean existingClosed = preferences.getBoolean("operationClosed", false);
        if (safeProgress < existingProgress || (existingClosed && !closed)) return;
        preferences.edit()
            .putInt("confirmedTripCount", safeProgress)
            .putInt("jobProgress", safeProgress)
            .putInt("jobTotalDeliveries", safeTotal)
            .putString("jobStatus", safe(jobStatus))
            .putBoolean("operationClosed", closed)
            .putString("lastEvent", closed
                ? closedOperationMessage(jobStatus)
                : "Operação atualizada.")
            .apply();
        if (instance != null) {
            instance.refreshMenuContents();
            if (closed) {
                instance.showStatusChip(closedOperationMessage(jobStatus), 6500L);
            }
        }
    }

    public static void showStatusMessage(Context context, String message, long durationMs) {
        if (context == null) return;
        android.content.SharedPreferences preferences = context.getApplicationContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String safeMessage = safe(message);
        if (safeMessage.isEmpty()) return;
        preferences.edit().putString("lastEvent", safeMessage).apply();
        if (instance != null) {
            instance.showStatusChip(safeMessage, Math.max(5000L, durationMs), true);
            if (!preferences.getBoolean("captureUiHidden", false)) instance.refreshMenuContents();
        }
    }

    public static void setRoute(Context context, String origin, String destination) {
        if (context == null) return;
        android.content.SharedPreferences preferences = context.getApplicationContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        if (PendingOperationStartStore.capturePaused(context, preferences)) {
            showStatusMessage(context, "Ação da operação salva. Aguarde a sincronização antes de iniciar outra viagem.", 6500L);
            return;
        }
        if (preferences.getBoolean("operationClosed", false)) {
            preferences.edit()
                .putString("lastEvent", closedOperationMessage(preferences.getString("jobStatus", "")))
                .apply();
            if (instance != null) {
                instance.showStatusChip(closedOperationMessage(preferences.getString("jobStatus", "")), 6500L);
                instance.refreshMenuContents();
            }
            return;
        }
        if (safe(origin).isEmpty() || safe(destination).isEmpty() || safe(origin).equalsIgnoreCase(safe(destination))) {
            if (instance != null) instance.showStatus("Origem e destino devem ser diferentes e preenchidos.");
            return;
        }
        android.content.SharedPreferences.Editor editor = preferences.edit();
        String operationName = safe(preferences.getString("operationName", ""));
        editor.putString("origin", safe(origin));
        editor.putString("destination", safe(destination));
        if (operationName.isEmpty()) editor.putString("operationName", "Operação Pro");
        if (!preferences.contains("jobProgress")) editor.putInt("jobProgress", 0);
        if (!preferences.contains("jobTotalDeliveries")) editor.putInt("jobTotalDeliveries", 0);
        editor.putString("simpleState", STATE_TRIP_ACTIVE);
        editor.putString("captureStage", "TRIP_ACTIVE");
        editor.remove("receiptText");
        editor.remove("captureRequestedAt");
        editor.remove("receiptCapturedAt");
        editor.putLong("routeUpdatedAt", System.currentTimeMillis());
        editor.apply();
        if (instance != null) {
            long routeEventId = System.currentTimeMillis();
            instance.emitSimpleReadyVoice(routeEventId);
            instance.showRouteReadyMessage();
        }
    }

    public static void requestReceiptCapture(Context context) {
        if (context == null) return;
        android.content.SharedPreferences preferences = context.getApplicationContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        if (PendingOperationStartStore.capturePaused(context, preferences)) {
            showStatusMessage(context, "Ação da operação salva. As viagens existentes continuam aguardando envio.", 6500L);
            return;
        }
        String currentState = preferences.getString("simpleState", DEFAULT_STATE);
        int totalSlots = Math.max(0, preferences.getInt("jobTotalDeliveries", 0));
        int reserved = Math.max(0, preferences.getInt("confirmedTripCount", 0))
            + (instance == null ? 0 : instance.pendingTripCountForCurrentScope());
        if (totalSlots > 0 && reserved >= totalSlots) {
            String fullOperationMessage = preferences.getBoolean("operationClosed", false)
                ? closedOperationMessage(preferences.getString("jobStatus", ""))
                : "Todas as vagas da operação estão confirmadas ou aguardando envio.";
            preferences.edit().putString("lastEvent", fullOperationMessage).apply();
            if (instance != null) instance.showStatusChip(fullOperationMessage, 6500L);
            return;
        }
        if (preferences.getBoolean("operationClosed", false)) {
            preferences.edit()
                .putString("captureStage", "BLOCKED_OPERATION_CLOSED")
                .putString("lastEvent", closedOperationMessage(preferences.getString("jobStatus", "")))
                .apply();
            if (instance != null) {
                instance.showStatusChip(closedOperationMessage(preferences.getString("jobStatus", "")), 6500L);
                instance.refreshMenuContents();
            }
            recordProDiagnostic(context, "pro-closed-" + System.currentTimeMillis(), "capture_start", "BLOCK", "OPERATION_CLOSED", "");
            return;
        }
        String attemptId = "pro-" + System.currentTimeMillis() + "-" + Integer.toHexString((int) (Math.random() * Integer.MAX_VALUE));
        preferences.edit().putString("captureStage", "REQUEST_RECEIVED").apply();
        if (!STATE_TRIP_ACTIVE.equals(currentState)) {
            preferences.edit().putString("captureStage", "BLOCKED_ROUTE").apply();
            recordProDiagnostic(context, attemptId, "capture_start", "BLOCK", "ROUTE_MISSING", "");
            return;
        }
        // Foreground APIs are advisory on modern Android/OEMs: opening the NVU
        // overlay can make the observed package become com.nvu.operacional even
        // while the selected simulator remains underneath. The authoritative proof
        // for Pro is the explicit MediaProjection frame plus semantic OCR.
        boolean foregroundConfirmed = instance != null && instance.isConfiguredSimulatorForeground();
        boolean usedRecentHeartbeat = false;
        if (!foregroundConfirmed && instance != null && instance.canUseRecentSimulatorHeartbeat()) {
            foregroundConfirmed = true;
            usedRecentHeartbeat = true;
        }
        String observedPackage = preferences.getString("foregroundCheckPackage", "");
        String evidenceCode = foregroundConfirmed
            ? (usedRecentHeartbeat ? "FOREGROUND_HEARTBEAT_FALLBACK" : "FOREGROUND_TASK_ADVISORY")
            : "FOREGROUND_UNVERIFIED_CAPTURE_FIRST";
        recordProDiagnostic(context, attemptId, "foreground_validation", "PASS", evidenceCode, observedPackage);
        recordProDiagnostic(context, attemptId, "pro_finish", "PENDING", "PRO_SIMULATOR_RELAUNCH_REQUIRED", observedPackage);
        recordProDiagnostic(context, attemptId, "projection_permission", "PENDING", "PROJECTION_PERMISSION_PENDING", preferences.getString("foregroundCheckPackage", ""));
        String captureContextEpoch = preferences.getString("contextEpoch", "");
        String captureSimulatorKey = normalizeProSimulatorKey(
            preferences.getString("simulatorKey", ""),
            preferences.getString("simulatorCode", ""),
            preferences.getString("packageId", "")
        );
        String captureSimulatorCode = preferences.getString("simulatorCode", "");
        String captureOrigin = preferences.getString("origin", "");
        String captureDestination = preferences.getString("destination", "");
        String captureCompanyId = preferences.getString("companyId", "");
        String captureDriverId = preferences.getString("driverId", "");
        String captureJobId = preferences.getString("jobId", "");
        String captureContractId = preferences.getString("contractId", "");
        String capturePackageId = resolveCanonicalProSimulatorPackage(captureSimulatorKey, captureSimulatorCode, preferences.getString("packageId", ""));
        // Never depend on a stale/empty packageId persisted by an older Pro session.
        // The simulator identity (key/code) is the authoritative configuration and
        // always maps to one canonical package. Persist the normalized package into
        // the capture snapshot so the completion path can relaunch the exact same app.
        if (capturePackageId.isEmpty()) {
            instance.failCapture("Simulador do Modo Pro não configurado para esta viagem.");
            return;
        }
        preferences.edit()
            .putString("captureStage", "CONSENT_PENDING")
            .putString("simpleState", STATE_CAPTURE_PENDING)
            .putString("captureAttemptId", attemptId)
            .putString("captureContextEpoch", captureContextEpoch)
            .putString("captureSimulatorKey", captureSimulatorKey)
            .putString("captureSimulatorCode", captureSimulatorCode)
            .putString("captureOrigin", captureOrigin)
            .putString("captureDestination", captureDestination)
            .putString("captureCompanyId", captureCompanyId)
            .putString("captureDriverId", captureDriverId)
            .putString("captureJobId", captureJobId)
            .putString("captureContractId", captureContractId)
            .putString("capturePackageId", capturePackageId)
            .putBoolean("captureUiHidden", true)
            .putString("lastEvent", "Captura de recebimento pendente")
            .putLong("captureRequestedAt", System.currentTimeMillis())
            .apply();
        // IMPORTANT: never reopen NVU here. Finalization is already initiated by
        // the Pro bubble/session. Relaunch only the configured Pro simulator and
        // immediately continue to Android's capture-consent dialog. No foreground
        // confirmation is required. This path is not used by manual Print trips,
        // which are launched/registered by RecordTrip.tsx.
        if (!isCanonicalProSimulatorPackage(captureSimulatorKey, capturePackageId)) {
            instance.failCapture("Configuração do simulador do Modo Pro inválida para esta viagem.");
            return;
        }
        PackageManager manager = instance.getPackageManager();
        Intent launch = manager.getLaunchIntentForPackage(capturePackageId);
        if (launch == null) {
            instance.failCapture("O simulador selecionado do Modo Pro não está instalado neste aparelho.");
            return;
        }
        // Play on the accepted Finalizar action, using the capture id so retries
        // cannot replay the voice when the server acknowledgement arrives.
        long simulatorLaunchStartedAt = System.currentTimeMillis();
        preferences.edit()
            .putString("captureStage", "SIMULATOR_LAUNCHED_WAITING_CAPTURE")
            .putString("lastEvent", "Abrindo o simulador para capturar o resultado…")
            .putLong("simulatorLaunchStartedAt", simulatorLaunchStartedAt)
            .apply();
        instance.hideCaptureInteractiveOverlaysKeepBubble();
        try {
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
            instance.markSimulatorLaunchRequestedInternal(capturePackageId);
            instance.startActivity(launch);
        } catch (Exception error) {
            instance.failCapture("Não foi possível abrir o simulador do Modo Pro.");
            return;
        }
        // Do not inspect foreground state. The simulator launch and the capture
        // permission request must be sequential: first commit the external task
        // switch, then present Android's MediaProjection consent as the last
        // activity launched by NVU. This fixed barrier avoids a race where the
        // simulator wins the task switch after the consent host was requested,
        // leaving the result screen visible with capture pending forever.
        instance.scheduleCaptureConsentAfterSimulatorLaunch(simulatorLaunchStartedAt);
    }

    public static void recordConfirmedTrip(
        Context context,
        String tripId,
        String jobId,
        String companyId,
        String driverId,
        String contractId,
        String simulatorKey,
        String origin,
        String destination,
        long amountCents,
        long completedAt
    ) {
        recordConfirmedTrip(context, tripId, jobId, companyId, driverId, contractId, simulatorKey,
            origin, destination, amountCents, completedAt, "");
    }

    public static void recordConfirmedTrip(Context context, String tripId, String jobId, String companyId,
        String driverId, String contractId, String simulatorKey, String origin, String destination,
        long amountCents, long completedAt, String currency) {
        if (context == null) {
            android.util.Log.w(PRO_HISTORY_TAG, "registro descartado: contexto ausente");
            return;
        }
        String safeTripId = safe(tripId);
        String safeJobId = safe(jobId);
        String safeCompanyId = safe(companyId);
        String safeDriverId = safe(driverId);
        if (safeTripId.isEmpty() || safeJobId.isEmpty() || safeCompanyId.isEmpty()
            || safeDriverId.isEmpty() || amountCents <= 0L) {
            android.util.Log.w(PRO_HISTORY_TAG, "registro descartado: contexto incompleto"
                + " tripId=" + safeTripId + " jobId=" + safeJobId
                + " companyId=" + safeCompanyId + " driverId=" + safeDriverId
                + " amountCents=" + amountCents);
            return;
        }
        android.content.SharedPreferences preferences = context.getApplicationContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String activeJobId = safe(preferences.getString("jobId", ""));
        String activeCompanyId = safe(preferences.getString("companyId", ""));
        String activeDriverId = safe(preferences.getString("driverId", ""));
        boolean activeScope = safeJobId.equals(activeJobId)
            && safeCompanyId.equals(activeCompanyId)
            && safeDriverId.equals(activeDriverId);
        if (!safeJobId.equals(activeJobId)) {
            android.util.Log.w(PRO_HISTORY_TAG, "jobId divergente callback=" + safeJobId + " atual=" + activeJobId);
        }
        if (!safeCompanyId.equals(activeCompanyId)) {
            android.util.Log.w(PRO_HISTORY_TAG, "companyId divergente callback=" + safeCompanyId + " atual=" + activeCompanyId);
        }
        if (!safeDriverId.equals(activeDriverId)) {
            android.util.Log.w(PRO_HISTORY_TAG, "driverId divergente callback=" + safeDriverId + " atual=" + activeDriverId);
        }
        String scopeKey = historyScopeKey(safeJobId, safeCompanyId, safeDriverId);
        try {
            JSONObject scopes = readHistoryScopes(preferences);
            JSONArray current = scopes.optJSONArray(scopeKey);
            if (current == null) current = new JSONArray();
            if (activeScope && current.length() == 0) {
                String localScope = historyScopeKey(
                    preferences.getString("historyScopeJobId", ""),
                    preferences.getString("historyScopeCompanyId", ""),
                    preferences.getString("historyScopeDriverId", "")
                );
                if (scopeKey.equals(localScope)) current = readLocalHistory(preferences);
            }
            List<JSONObject> entries = new ArrayList<>();
            boolean duplicate = false;
            for (int index = 0; index < current.length(); index++) {
                JSONObject item = current.optJSONObject(index);
                if (item == null) continue;
                if (safeTripId.equals(safe(tripId)) && safeTripId.equals(safe(item.optString("tripId", "")))) {
                    duplicate = true;
                    item.put("pendingSync", false);
                }
                entries.add(item);
            }
            if (duplicate) {
                android.util.Log.i(PRO_HISTORY_TAG, "tripId duplicado ignorado=" + safeTripId
                    + " scope=" + scopeKey);
            } else {
                JSONObject item = new JSONObject();
                item.put("tripId", safeTripId);
                item.put("jobId", safeJobId);
                item.put("companyId", safeCompanyId);
                item.put("driverId", safeDriverId);
                item.put("contractId", safe(contractId));
                item.put("simulatorKey", safe(simulatorKey));
                item.put("origin", safe(origin));
                item.put("destination", safe(destination));
                item.put("amountCents", amountCents);
                item.put("currency", currency);
                item.put("completedAt", completedAt > 0L ? completedAt : System.currentTimeMillis());
                item.put("pendingSync", false);
                item.put("nativeAckAt", System.currentTimeMillis());
                entries.add(item);
            }
            Collections.sort(entries, (left, right) -> {
                int byTime = Long.compare(left.optLong("completedAt", 0L), right.optLong("completedAt", 0L));
                return byTime != 0 ? byTime : safe(left.optString("tripId", ""))
                    .compareTo(safe(right.optString("tripId", "")));
            });
            JSONArray rebuilt = new JSONArray();
            for (JSONObject item : entries) rebuilt.put(item);
            scopes.put(scopeKey, rebuilt);
            android.content.SharedPreferences.Editor editor = preferences.edit()
                .putString(HISTORY_SCOPES_PREF, scopes.toString());
            if (activeScope) {
                editor.putString("historyScopeJobId", safeJobId)
                    .putString("historyScopeCompanyId", safeCompanyId)
                    .putString("historyScopeDriverId", safeDriverId)
                    .putString("operationHistoryJson", rebuilt.toString())
                    .putString("historyLoadState", "ACK")
                    .putLong("historyUpdatedAt", System.currentTimeMillis());
                android.util.Log.i(PRO_HISTORY_TAG, "gravação local realizada tripId=" + safeTripId
                    + " scope=" + scopeKey);
            } else {
                android.util.Log.w(PRO_HISTORY_TAG, "callback fora da operação atual mantido somente no escopo=" + scopeKey);
            }
            editor.apply();
            if (instance != null) instance.refreshMenuContents();
        } catch (JSONException error) {
            android.util.Log.e(PRO_HISTORY_TAG, "projeção local inconsistente; reconstrução pendente", error);
            preferences.edit().remove("operationHistoryJson").apply();
        }
        reconcileOperationHistory(context.getApplicationContext(), safeJobId, safeCompanyId, safeDriverId);
    }

    /** Mirrors the same validated operation rows used by the WebView progress counter. */
    public static boolean updateOperationHistory(
        Context context, String jobId, String companyId, String driverId,
        int jobProgress, JSONArray rows
    ) {
        if (context == null || rows == null) return false;
        android.content.SharedPreferences preferences = context.getApplicationContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String scope = historyScopeKey(jobId, companyId, driverId);
        if (safe(jobId).isEmpty() || safe(companyId).isEmpty() || safe(driverId).isEmpty()
            || !scope.equals(historyScopeKey(preferences.getString("jobId", ""),
                preferences.getString("companyId", ""), preferences.getString("driverId", "")))) return false;
        try {
            Map<String, JSONObject> unique = new LinkedHashMap<>();
            for (int i = 0; i < rows.length(); i++) {
                JSONObject item = rows.optJSONObject(i);
                if (item == null || !scope.equals(historyScopeKey(item.optString("jobId", ""),
                    item.optString("companyId", ""), item.optString("driverId", "")))) return false;
                String id = safe(item.optString("tripId", ""));
                if (id.isEmpty() || !item.has("amountCents")
                    || item.optBoolean("pendingSync", false)) return false;
                unique.put(id, item);
            }
            // A complete profile snapshot replaces ACK-only native rows, including deleted trips.
            List<JSONObject> ordered = new ArrayList<>(unique.values());
            sortHistoryEntries(ordered);
            JSONArray rebuilt = new JSONArray();
            for (JSONObject item : ordered) rebuilt.put(item);
            // The WebView can resume with an older cached job (5/12) just
            // after the native transaction has acknowledged slot 6. Do not
            // erase an ACK absent from that cached list; a server read decides
            // whether the row was later deleted.
            JSONArray currentRows = readLocalHistory(preferences);
            for (int i = 0; i < currentRows.length(); i++) {
                JSONObject acknowledged = currentRows.optJSONObject(i);
                if (acknowledged == null || acknowledged.optLong("nativeAckAt", 0L) <= 0L) continue;
                if (!unique.containsKey(safe(acknowledged.optString("tripId", "")))) {
                    reconcileOperationHistory(context.getApplicationContext(), jobId, companyId, driverId);
                    return false;
                }
            }
            // A WebView snapshot may lag an already confirmed native receipt.
            // Keep the ACK row until the driver history has caught up. A
            // deletion is still accepted when the job counter also decreases.
            if (jobProgress > rebuilt.length()) {
                android.util.Log.i(PRO_HISTORY_TAG, "histórico web incompleto: "
                    + rebuilt.length() + "/" + jobProgress);
                reconcileOperationHistory(context.getApplicationContext(), jobId, companyId, driverId);
                return false;
            }
            if ("WEB".equals(preferences.getString("historyLoadState", ""))
                && scope.equals(historyScopeKey(preferences.getString("historyScopeJobId", ""),
                    preferences.getString("historyScopeCompanyId", ""),
                    preferences.getString("historyScopeDriverId", "")))
                && rebuilt.toString().equals(preferences.getString("operationHistoryJson", "[]"))
                && preferences.getInt("profileJobProgress", -1) == jobProgress) return true;
            JSONObject scopes = readHistoryScopes(preferences);
            scopes.put(scope, rebuilt);
            boolean saved = preferences.edit()
                .putString(HISTORY_SCOPES_PREF, scopes.toString())
                .putString("operationHistoryJson", rebuilt.toString())
                .putString("historyScopeJobId", safe(jobId))
                .putString("historyScopeCompanyId", safe(companyId))
                .putString("historyScopeDriverId", safe(driverId))
                .putString("historyLoadState", "WEB")
                .putInt("profileJobProgress", jobProgress)
                .putLong("historyUpdatedAt", System.currentTimeMillis()).commit();
            if (saved) {
                if (instance != null) instance.mainHandler.post(instance::refreshMenuContents);
            }
            return saved;
        } catch (JSONException error) {
            android.util.Log.e(PRO_HISTORY_TAG, "projeção web rejeitada", error);
            return false;
        }
    }

    private static String historyScopeKey(String jobId, String companyId, String driverId) {
        return safe(jobId) + "|" + safe(companyId) + "|" + safe(driverId);
    }

    private static JSONArray readLocalHistory(android.content.SharedPreferences preferences) {
        try {
            return new JSONArray(preferences.getString("operationHistoryJson", "[]"));
        } catch (JSONException error) {
            android.util.Log.w(PRO_HISTORY_TAG, "operationHistoryJson inconsistente", error);
            return new JSONArray();
        }
    }

    private static JSONObject readHistoryScopes(android.content.SharedPreferences preferences) {
        try {
            String raw = preferences.getString(HISTORY_SCOPES_PREF, "{}");
            return new JSONObject(raw == null || raw.trim().isEmpty() ? "{}" : raw);
        } catch (JSONException error) {
            android.util.Log.w(PRO_HISTORY_TAG, "projeção por escopo inconsistente; iniciando reconciliação", error);
            return new JSONObject();
        }
    }

    private static void preserveHistoryScope(android.content.SharedPreferences preferences) {
        String oldJobId = safe(preferences.getString("historyScopeJobId", ""));
        String oldCompanyId = safe(preferences.getString("historyScopeCompanyId", ""));
        String oldDriverId = safe(preferences.getString("historyScopeDriverId", ""));
        if (oldJobId.isEmpty() || oldCompanyId.isEmpty() || oldDriverId.isEmpty()) return;
        JSONArray local = readLocalHistory(preferences);
        if (local.length() == 0) return;
        try {
            JSONObject scopes = readHistoryScopes(preferences);
            scopes.put(historyScopeKey(oldJobId, oldCompanyId, oldDriverId), local);
            preferences.edit().putString(HISTORY_SCOPES_PREF, scopes.toString()).apply();
            android.util.Log.i(PRO_HISTORY_TAG, "histórico anterior preservado no escopo="
                + historyScopeKey(oldJobId, oldCompanyId, oldDriverId));
        } catch (JSONException error) {
            android.util.Log.e(PRO_HISTORY_TAG, "falha ao preservar histórico anterior", error);
        }
    }

    private static void reconcileOperationHistory(Context context, String jobId, String companyId, String driverId) {
        if (context == null) return;
        String safeJobId = safe(jobId);
        String safeCompanyId = safe(companyId);
        String safeDriverId = safe(driverId);
        if (safeJobId.isEmpty() || safeCompanyId.isEmpty() || safeDriverId.isEmpty()) {
            android.util.Log.w(PRO_HISTORY_TAG, "reconciliação ignorada: contexto ausente"
                + " jobId=" + safeJobId + " companyId=" + safeCompanyId + " driverId=" + safeDriverId);
            return;
        }
        android.content.SharedPreferences preferences = context.getApplicationContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String scopeKey = historyScopeKey(safeJobId, safeCompanyId, safeDriverId);
        String activeScope = historyScopeKey(
            preferences.getString("jobId", ""),
            preferences.getString("companyId", ""),
            preferences.getString("driverId", "")
        );
        if (!scopeKey.equals(activeScope)) {
            android.util.Log.w(PRO_HISTORY_TAG, "reconciliação descartada por mudança de operação scope=" + scopeKey);
            return;
        }
        // Equal counts do not prove equal receipts: an ACK can refer to a
        // deleted document while another row is absent. Verify the IDs.
        long now = System.currentTimeMillis();
        long projectionAtStart = preferences.getLong("historyUpdatedAt", 0L);
        long lastAt = preferences.getLong("historyReconcileAt", 0L);
        String lastScope = safe(preferences.getString("historyReconcileScope", ""));
        if (scopeKey.equals(lastScope)
            && lastAt > 0L && now - lastAt < HISTORY_RECONCILE_THROTTLE_MS) {
            // A call coalesced immediately after an ACK still needs a bounded
            // follow-up. Otherwise the removed ACK can remain forever when
            // the WebView has no further state change.
            long dueAt = lastAt + HISTORY_RECONCILE_THROTTLE_MS + 50L;
            long scheduled = preferences.getLong("historyReconcileRetryAt", 0L);
            if (scheduled != dueAt) {
                preferences.edit().putLong("historyReconcileRetryAt", dueAt).apply();
                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                    SharedPreferences retry = context.getApplicationContext()
                        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                    if (retry.getLong("historyReconcileRetryAt", 0L) != dueAt) return;
                    retry.edit().remove("historyReconcileRetryAt").apply();
                    reconcileOperationHistory(context, safeJobId, safeCompanyId, safeDriverId);
                }, Math.max(50L, dueAt - now));
            }
            return;
        }
        long requestGeneration = Math.max(0L, preferences.getLong("historyReconcileGeneration", 0L)) + 1L;
        preferences.edit().putLong("historyReconcileAt", now)
            .putLong("historyReconcileGeneration", requestGeneration)
            .putString("historyReconcileScope", scopeKey).apply();
        try {
            FirebaseFirestore firestore = FirebaseFirestore.getInstance();
            Tasks.whenAllSuccess(
                firestore.collection("historico_viagens")
                    .whereEqualTo("driverId", safeDriverId)
                    .whereEqualTo("jobId", safeJobId).get(Source.SERVER),
                firestore.collection("historico_viagens")
                    .whereEqualTo("motoristaId", safeDriverId).get(Source.SERVER)
            )
                .addOnCompleteListener(task -> {
                    android.content.SharedPreferences fresh = context.getApplicationContext()
                        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                    String freshScope = historyScopeKey(
                        fresh.getString("jobId", ""),
                        fresh.getString("companyId", ""),
                        fresh.getString("driverId", "")
                    );
                    if (!scopeKey.equals(freshScope)) {
                        android.util.Log.w(PRO_HISTORY_TAG, "reconciliação descartada por mudança de operação durante consulta scope=" + scopeKey);
                        return;
                    }
                    if (fresh.getLong("historyReconcileGeneration", 0L) != requestGeneration) return;
                    if (!task.isSuccessful()) {
                        android.util.Log.w(PRO_HISTORY_TAG, "fonte autoritativa indisponível; projeção mantida", task.getException());
                        int failures = Math.min(5, fresh.getInt("historyReconcileFailures", 0) + 1);
                        fresh.edit().putInt("historyReconcileFailures", failures).apply();
                        long delay = Math.min(60_000L, 5_000L << (failures - 1));
                        new Handler(Looper.getMainLooper()).postDelayed(() ->
                            reconcileOperationHistory(context, safeJobId, safeCompanyId, safeDriverId), delay);
                        return;
                    }
                    fresh.edit().remove("historyReconcileFailures").apply();
                    if (fresh.getLong("historyUpdatedAt", 0L) > projectionAtStart) {
                        // A newer WebView or native ACK projection must not be
                        // overwritten by a request started before that update.
                        return;
                    }
                    Map<String, JSONObject> merged = new LinkedHashMap<>();
                    try {
                        JSONObject scopes = readHistoryScopes(fresh);
                        int authoritativeCount = 0;
                        for (Object result : task.getResult()) {
                            if (!(result instanceof QuerySnapshot)) continue;
                            QuerySnapshot snapshot = (QuerySnapshot) result;
                            for (DocumentSnapshot document : snapshot.getDocuments()) {
                                JSONObject item = historyItemFromFirestore(
                                    document, safeJobId, safeCompanyId, safeDriverId
                                );
                                if (item != null) {
                                    merged.put(item.optString("tripId", document.getId()), item);
                                    authoritativeCount++;
                                }
                            }
                        }
                        // Firestore is authoritative. Only explicitly pending local
                        // entries may survive a server snapshot that has not yet
                        // reflected the write. Deleted/remote-absent confirmed trips
                        // must never be resurrected from the old local projection.
                        JSONArray scoped = scopes.optJSONArray(scopeKey);
                        addPendingHistoryEntries(merged, scoped);
                        String currentScope = historyScopeKey(
                            fresh.getString("historyScopeJobId", ""),
                            fresh.getString("historyScopeCompanyId", ""),
                            fresh.getString("historyScopeDriverId", "")
                        );
                        if (scopeKey.equals(currentScope)) addPendingHistoryEntries(merged, readLocalHistory(fresh));
                        List<JSONObject> entries = new ArrayList<>(merged.values());
                        sortHistoryEntries(entries);
                        JSONArray rebuilt = new JSONArray();
                        for (JSONObject item : entries) rebuilt.put(item);
                        scopes.put(scopeKey, rebuilt);
                        fresh.edit()
                            .putString(HISTORY_SCOPES_PREF, scopes.toString())
                            .putString("historyScopeJobId", safeJobId)
                            .putString("historyScopeCompanyId", safeCompanyId)
                            .putString("historyScopeDriverId", safeDriverId)
                            .putString("operationHistoryJson", rebuilt.toString())
                            .putString("historyLoadState", "SERVER")
                            .putLong("historyUpdatedAt", System.currentTimeMillis())
                            .apply();
                        android.util.Log.i(PRO_HISTORY_TAG, "reconstrução realizada scope=" + scopeKey
                            + " authoritative=" + authoritativeCount + " projected=" + rebuilt.length());
                        if (instance != null) instance.refreshMenuContents();
                    } catch (JSONException error) {
                        android.util.Log.e(PRO_HISTORY_TAG, "falha ao gravar projeção reconciliada", error);
                    }
                });
        } catch (RuntimeException error) {
            android.util.Log.w(PRO_HISTORY_TAG, "consulta Firestore de histórico indisponível", error);
            new Handler(Looper.getMainLooper()).postDelayed(() ->
                reconcileOperationHistory(context, safeJobId, safeCompanyId, safeDriverId), 10_000L);
        }
    }

    private static void addPendingHistoryEntries(Map<String, JSONObject> target, JSONArray source) {
        if (source == null) return;
        for (int index = 0; index < source.length(); index++) {
            JSONObject item = source.optJSONObject(index);
            if (item == null || !item.optBoolean("pendingSync", false)) continue;
            String tripId = safe(item.optString("tripId", ""));
            // Older releases marked even server-confirmed native records as
            // pending. Only local queue IDs may survive server absence.
            if (tripId.startsWith("local-") && !target.containsKey(tripId)) target.put(tripId, item);
        }
    }

    private static void addHistoryEntries(Map<String, JSONObject> target, JSONArray source) {
        if (source == null) return;
        for (int index = 0; index < source.length(); index++) {
            JSONObject item = source.optJSONObject(index);
            if (item == null) continue;
            String tripId = safe(item.optString("tripId", ""));
            if (!tripId.isEmpty()) target.put(tripId, item);
        }
    }

    private static JSONObject historyItemFromFirestore(
        DocumentSnapshot document, String jobId, String companyId, String driverId
    ) {
        if (document == null || document.getData() == null) return null;
        Map<String, Object> data = document.getData();
        if (!jobId.equals(firstText(data, "jobId"))) return null;
        if (!companyId.equals(firstText(data, "companyId", "empresaId"))) return null;
        if (!driverId.equals(firstText(data, "driverId", "motoristaId"))) return null;
        String status = firstText(data, "status").toLowerCase(Locale.ROOT);
        if (Boolean.TRUE.equals(data.get("deleted")) || "deleted".equals(status) || "cancelled".equals(status)) return null;
        if (!("concluida".equals(status) || "concluído".equals(status)
            || "completed".equals(status) || "confirmed".equals(status)
            || "confirmada".equals(status))) return null;
        String tripId = firstText(data, "tripId", "deterministicTripId");
        if (tripId.isEmpty()) tripId = safe(document.getId());
        long amountCents = longValue(data.get("valorCents"));
        if (amountCents <= 0L) amountCents = Math.round(doubleValue(data.get("valor")) * 100.0d);
        if (tripId.isEmpty() || (!data.containsKey("valorCents") && !data.containsKey("valor"))) return null;
        try {
            JSONObject item = new JSONObject();
            item.put("tripId", tripId);
            item.put("canonicalTripId", firstText(data, "canonicalTripId", "tripId", "deterministicTripId"));
            item.put("jobId", jobId);
            item.put("operationId", firstText(data, "operationId", "jobId"));
            item.put("companyId", companyId);
            item.put("driverId", driverId);
            item.put("contractId", firstText(data, "contractId", "contratoId"));
            item.put("simulatorKey", firstText(data, "simulatorKey", "simulatorId", "simulatorCode", "simuladorCodigo"));
            item.put("origin", firstText(data, "origin", "origem"));
            item.put("destination", firstText(data, "destination", "destino"));
            item.put("amountCents", amountCents);
            // Keep money metadata when a server snapshot replaces the local ACK/WebView row.
            ProHistoryMoney.Resolution money = ProHistoryMoney.resolve(data);
            item.put("currency", money.currency);
            item.put("currencyStatus", money.status);
            item.put("currencySource", money.source);
            item.put("completedAt", firstTimestamp(data, "completedAt", "dataLancamento", "createdAt"));
            item.put("pendingSync", false);
            return item;
        } catch (JSONException error) {
            return null;
        }
    }

    private static String firstText(Map<String, Object> data, String... keys) {
        if (data == null) return "";
        for (String key : keys) {
            Object value = data.get(key);
            if (value != null && !safe(String.valueOf(value)).isEmpty()) return safe(String.valueOf(value));
        }
        return "";
    }

    private static long firstTimestamp(Map<String, Object> data, String... keys) {
        if (data == null) return 0L;
        for (String key : keys) {
            long value = timestampValue(data.get(key));
            if (value > 0L) return value;
        }
        return 0L;
    }

    private static long timestampValue(Object value) {
        if (value instanceof Timestamp) return ((Timestamp) value).toDate().getTime();
        if (value instanceof Number) return ((Number) value).longValue();
        try { return Long.parseLong(safe(String.valueOf(value))); } catch (RuntimeException error) { return 0L; }
    }

    private static long longValue(Object value) {
        if (value instanceof Number) return Math.max(0L, ((Number) value).longValue());
        try { return Math.max(0L, Long.parseLong(safe(String.valueOf(value)))); } catch (RuntimeException error) { return 0L; }
    }

    private static double doubleValue(Object value) {
        if (value instanceof Number) return Math.max(0.0d, ((Number) value).doubleValue());
        try { return Math.max(0.0d, Double.parseDouble(safe(String.valueOf(value)).replace(',', '.'))); }
        catch (RuntimeException error) { return 0.0d; }
    }

    private static void sortHistoryEntries(List<JSONObject> entries) {
        Collections.sort(entries, (left, right) -> {
            int byTime = Long.compare(left.optLong("completedAt", 0L), right.optLong("completedAt", 0L));
            return byTime != 0 ? byTime : safe(left.optString("tripId", ""))
                .compareTo(safe(right.optString("tripId", "")));
        });
    }

    public static void confirmReceiptCaptureReentry(Context context) {
        if (context == null) return;
        if (instance == null || instance.prefs == null) {
            failStaticCapture(context, "O Modo Pro não está disponível para confirmar a captura.");
            return;
        }
        instance.confirmReceiptCaptureReentryInternal();
    }

    public static void cancelReceiptCaptureReentry(Context context) {
        if (context == null) return;
        SharedPreferences preferences = context.getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        if (!STATE_CAPTURE_PENDING.equals(preferences.getString("simpleState", DEFAULT_STATE))) return;
        preferences.edit()
            .putString("captureStage", "REENTRY_CANCELLED")
            .putString("simpleState", STATE_TRIP_ACTIVE)
            .putBoolean("captureUiHidden", false)
            .putString("lastEvent", "Captura não confirmada. A viagem continua em andamento.")
            .apply();
        if (instance != null) {
            instance.showBubbleIfAllowed();
            instance.refreshMenuContents();
            instance.showStatusChip("A captura foi cancelada. A viagem continua em andamento.", 4200L);
        }
    }

    private static void failStaticCapture(Context context, String message) {
        SharedPreferences preferences = context.getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        preferences.edit().putString("captureStage", "REENTRY_FAILED").putString("simpleState", "CAPTURE_ERROR")
            .putBoolean("captureUiHidden", false).putString("lastEvent", message).apply();
    }

    private void confirmReceiptCaptureReentryInternal() {
        if (prefs == null || !STATE_CAPTURE_PENDING.equals(prefs.getString("simpleState", DEFAULT_STATE))) return;
        String packageId = safe(prefs.getString("capturePackageId", prefs.getString("packageId", "")));
        if (packageId.isEmpty()) {
            failCapture("Simulador Pro não configurado para a captura.");
            return;
        }
        PackageManager manager = getPackageManager();
        Intent launch = manager.getLaunchIntentForPackage(packageId);
        if (launch == null) {
            failCapture("O simulador selecionado não está instalado neste aparelho.");
            return;
        }
        prefs.edit().putString("captureStage", "SIMULATOR_LAUNCHING")
            .putString("lastEvent", "Abrindo o simulador para capturar o resultado…")
            .putLong("simulatorLaunchStartedAt", System.currentTimeMillis()).apply();
        markSimulatorLaunchRequestedInternal(packageId);
        hideCaptureInteractiveOverlaysKeepBubble();
        try {
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
            startActivity(launch);
        } catch (Exception error) {
            failCapture("Não foi possível abrir o simulador selecionado.");
            return;
        }
        mainHandler.postDelayed(() -> {
            if (STATE_CAPTURE_PENDING.equals(prefs.getString("simpleState", DEFAULT_STATE))) {
                beginCaptureConsent();
            }
        }, 250L);
    }

    private void scheduleCaptureConsentAfterSimulatorLaunch(long launchStartedAt) {
        if (mainHandler == null || prefs == null) return;
        long now = System.currentTimeMillis();
        long alreadyScheduledAt = prefs.getLong("captureConsentScheduledAt", 0L);
        if (alreadyScheduledAt > 0L && now - alreadyScheduledAt < 2000L) return;
        prefs.edit().putLong("captureConsentScheduledAt", now).apply();
        long elapsed = Math.max(0L, now - launchStartedAt);
        long remaining = Math.max(0L, SIMULATOR_TO_CAPTURE_BARRIER_MS - elapsed);
        mainHandler.postDelayed(() -> {
            if (prefs == null) return;
            prefs.edit().remove("captureConsentScheduledAt").apply();
            if (!STATE_CAPTURE_PENDING.equals(prefs.getString("simpleState", DEFAULT_STATE))) return;
            String stage = safe(prefs.getString("captureStage", ""));
            if ("SIMULATOR_LAUNCHED_WAITING_CAPTURE".equals(stage)
                || "SIMULATOR_LAUNCHING".equals(stage)
                || "CONSENT_PENDING".equals(stage)) {
                beginCaptureConsent();
            }
        }, remaining);
    }

    public static void retryReceiptCapture(Context context) {
        if (context == null) return;
        android.content.SharedPreferences preferences = context.getApplicationContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String state = preferences.getString("simpleState", DEFAULT_STATE);
        if (!"CAPTURE_ERROR".equals(state)) return;
        if (safe(preferences.getString("origin", "")).isEmpty()
            || safe(preferences.getString("destination", "")).isEmpty()) {
            preferences.edit().putString("lastEvent", "Rota incompleta; inicie uma viagem novamente.").apply();
            return;
        }
        preferences.edit()
            .putString("simpleState", STATE_TRIP_ACTIVE)
            .putBoolean("captureUiHidden", false)
            .putString("lastEvent", "Nova tentativa de captura solicitada")
            .apply();
        requestReceiptCapture(context);
    }

    public static void acknowledgeReceipt(Context context, boolean accepted, String reason) {
        acknowledgeReceipt(context, accepted, reason, accepted && (safe(reason).contains("Viagem preservada")
            || safe(reason).contains("Aguardando conexão para validação")));
    }

    public static void acknowledgeReceipt(Context context, boolean accepted, String reason, boolean pendingSync) {
        if (context == null) return;
        android.content.SharedPreferences preferences = context.getApplicationContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        boolean hasRoute = !safe(preferences.getString("origin", "")).isEmpty()
            && !safe(preferences.getString("destination", "")).isEmpty();
        boolean queuedReceipt = accepted && pendingSync;
        // A rejected OCR/policy result is retryable when it belongs to a real
        // route. It must never turn the active trip into a terminal state or
        // erase the route; only an accepted submission or explicit cancellation
        // ends the Pro session.
        boolean retryableRejection = !accepted && hasRoute;
        long startedElapsedAt = preferences.getLong("captureStartedElapsedAt", 0L);
        long elapsedMs = startedElapsedAt > 0L
            ? Math.max(0L, SystemClock.elapsedRealtime() - startedElapsedAt)
            : -1L;
        android.util.Log.i(PRO_TIMING_TAG, "stage=native_ack accepted=" + accepted
            + " elapsedMs=" + elapsedMs);
        preferences.edit()
            .putString("captureStage", accepted ? "SUBMITTED" : (retryableRejection ? "REJECTED_RETRYABLE" : "REJECTED"))
            .putString("simpleState", accepted ? STATE_COMPLETED : (retryableRejection ? STATE_TRIP_ACTIVE : STATE_REJECTED_AD))
            .putBoolean("captureUiHidden", false)
            .putString("lastEvent", safe(reason))
            .putString("nativeSubmissionState", queuedReceipt ? "QUEUED" : (accepted ? "SYNCED" : "IDLE"))
            .putBoolean("nativeRetryPending", false)
            .remove("nativeSubmissionError")
            .remove("receiptText")
            .remove("captureAttemptId")
            .remove("captureContextEpoch")
            .remove("captureSimulatorKey")
            .remove("captureSimulatorCode")
            .remove("captureOrigin")
            .remove("captureDestination")
            .remove("captureCompanyId")
            .remove("captureJobId")
            .remove("captureContractId")
            .remove("capturePackageId")
            .remove("captureStartedElapsedAt")
            .putLong("captureEventVersion", preferences.getLong("captureEventVersion", 0L))
            .apply();
        if (instance != null) {
            if (accepted) {
                boolean awaitingServerValidation = queuedReceipt;
                // A confirmação de uma viagem registrada é uma superfície terminal
                // curta. Nunca reabra o menu grande aqui: ele competiria visualmente
                // com o card compacto e deixaria a interface parecendo presa na
                // validação. O usuário volta a abrir o menu pelo NVU após o card
                // desaparecer.
                instance.closeMenu();
                instance.showBubbleIfAllowed();
                if (awaitingServerValidation) {
                    String id = safe(preferences.getString("lastPendingProAttemptId", ""));
                    if (ProPendingTripStore.contains(preferences, id)) {
                        instance.showPendingTripCard(id, instance.hasUsableNetwork()
                            ? "Enviando viagem…" : "Aguardando envio · sem rede");
                    } else {
                        instance.showStatusChip("Viagem salva no aparelho. Aguardando validação do servidor.", 5500L);
                    }
                } else {
                    instance.showRegisteredTripCard(
                        instance.latestHistoryReceipt(),
                        preferences.getBoolean("operationClosed", false) ? 6500L : 3600L
                    );
                }
            } else {
                instance.showBubbleIfAllowed();
                instance.refreshMenuContents();
                String message = safe(reason).isEmpty()
                    ? "Não foi possível validar a captura do resultado. Mantenha a tela de conclusão aberta e tente novamente."
                    : safe(reason);
                instance.showStatusChip(message, 4200L);
            }
        }
    }

    /**
     * Repairs a terminal native submission whose durable Firestore write was
     * confirmed but whose older UI acknowledgement was interrupted. This is
     * intentionally idempotent and only trusts the explicit SYNCED marker.
     */
    public static void reconcileSyncedUi(Context context) {
        if (context == null) return;
        Context appContext = context.getApplicationContext();
        SharedPreferences preferences = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String nativeState = safe(preferences.getString("nativeSubmissionState", ""));
        String simpleState = safe(preferences.getString("simpleState", DEFAULT_STATE));
        if (!"SYNCED".equals(nativeState) || !"CAPTURE_CAPTURED".equals(simpleState)) return;

        boolean operationClosed = preferences.getBoolean("operationClosed", false);
        preferences.edit()
            .putString("captureStage", "SUBMITTED")
            .putString("simpleState", STATE_COMPLETED)
            .putBoolean("captureUiHidden", false)
            .apply();

        if (instance != null) {
            instance.mainHandlerPost(() -> {
                instance.closeMenu();
                instance.showBubbleIfAllowed();
                instance.showRegisteredTripCard(
                    instance.latestHistoryReceipt(),
                    operationClosed ? 6500L : 3600L
                );
            });
        }
    }

    public static void cancelTrip(Context context) {
        if (context == null) return;
        context.getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString("captureStage", "CANCELLED")
            .putString("simpleState", STATE_CANCELLED)
            .putString("lastEvent", "Viagem Pro cancelada")
            .remove("origin")
            .remove("destination")
            .apply();
        if (instance != null) instance.refreshMenuContents();
    }

    private static void recordProDiagnostic(Context context, String attemptId, String stage, String decision, String failureCode, String observedPackage) {
        if (context == null) return;
        android.content.SharedPreferences preferences = context.getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String expectedPackage = preferences.getString("packageId", "");
        long now = System.currentTimeMillis();
        preferences.edit()
            .putString("proLastAttemptId", safe(attemptId))
            .putString("proLastStage", safe(stage))
            .putString("proLastDecision", safe(decision))
            .putString("proLastFailureCode", safe(failureCode))
            .putString("proLastExpectedPackage", safe(expectedPackage))
            .putString("proLastObservedPackage", safe(observedPackage))
            .putLong("proLastDiagnosticAt", now)
            .apply();
        android.util.Log.i("NVU-ProFlow", "attempt=" + safe(attemptId)
            + " stage=" + safe(stage)
            + " decision=" + safe(decision)
            + " failure=" + safe(failureCode)
            + " expected=" + safe(expectedPackage)
            + " observed=" + safe(observedPackage));
    }

    public static android.content.SharedPreferences getPreferences(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    static void onCompletedOperationQueueDiscarded(CompletedOperationScope scope, java.util.List<String> attempts) {
        SimpleAutomationService active = instance;
        if (active == null) return;
        active.mainHandlerPost(() -> {
            if (attempts.contains(active.pendingInFlightId)) {
                active.mainHandler.removeCallbacks(active.nativeSubmissionTimeoutRunnable);
                active.pendingInFlightId = "";
                active.pendingInFlightGeneration = -1;
            }
            if (scope.matches(active.prefs)) {
                active.prefs.edit().putString("jobStatus", "completed")
                    .putBoolean("operationClosed", true).putString("simpleState", STATE_COMPLETED)
                    .putString("nativeSubmissionState", ProPendingTripStore.DISCARDED_OPERATION_COMPLETED)
                    .remove("receiptText").remove("lastPendingProAttemptId").apply();
            }
            active.refreshMenuContents();
            active.processPendingProTrips();
        });
    }

    @Override
    public void onCreate() {
        super.onCreate();
        ProModeController.onServiceCreate(this);
        serviceBoundaries.onServiceCreated();
        instance = this;
        prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        ProPendingTripStore.recoverLegacyGtoRejection(this, prefs);
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        mainHandler = new Handler(Looper.getMainLooper());
        CompletedProOperationQueueCleaner.reconcile(this, (verified, count, reason) -> {});
        audioManager = new NvuAudioManager(this, detail -> prefs.edit()
            .putString("audioError", detail == null ? "audio_error" : detail)
            .putLong("audioErrorAt", System.currentTimeMillis())
            .apply());
        captureThread = new HandlerThread("nvu-simple-capture");
        captureThread.start();
        captureHandler = new Handler(captureThread.getLooper());
        textRecognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        consumePendingSimulatorLaunch();
        createNotificationChannel();
        startSimpleForeground(false);
        startVisibilityMonitor();
        scheduleNativeSubmissionRetry();
        scheduleBubbleRecoveryWatchdog();
        mainHandlerPost(this::processPendingProTrips);
        ProPendingTripJobService.schedule(this);
        reconcileOperationHistory(this,
            prefs.getString("jobId", ""),
            prefs.getString("companyId", ""),
            prefs.getString("driverId", ""));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        recoverStaleCaptureUiLock();
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            ProOverlayProbeService.stopSession(this);
            removeOverlays();
            cleanupCapture();
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }
        consumePendingSimulatorLaunch();
        if (intent != null && ACTION_START.equals(intent.getAction())) {
            playProAutomatedStartVoiceIfEligible();
        }
        if (intent != null && ACTION_START_CAPTURE.equals(intent.getAction())) {
            int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0);
            Intent resultData = readProjectionData(intent);
            if (resultCode == android.app.Activity.RESULT_OK && resultData != null) {
                beginCapture(resultCode, resultData);
            } else {
                markCaptureDenied(this);
            }
        }
        prefs.edit()
            .putBoolean("running", true)
            .putString("simpleState", prefs.getString("simpleState", DEFAULT_STATE))
            .putLong("serviceStartedAt", System.currentTimeMillis())
            .apply();
        startVisibilityMonitor();
        String simpleState = prefs.getString("simpleState", DEFAULT_STATE);
        // The NVU bubble is a persistent control of the Pro session. Its visibility
        // is no longer coupled to captureUiHidden or OCR/submission state. Only the
        // Android consent surface may temporarily remove it.
        if (!isCaptureConsentSurfaceActive()) {
            showBubbleIfAllowed(true);
        }
        if ("CAPTURE_CAPTURED".equals(simpleState)
            && !safe(prefs.getString("receiptText", "")).isEmpty()) {
            mainHandlerPost(this::submitNativeReceiptIfPending);
        }
        scheduleNativeSubmissionRetry();
        mainHandlerPost(this::processPendingProTrips);
        if (STATE_CAPTURE_PENDING.equals(simpleState)
            && !captureFrameRequested
            && (intent == null || !ACTION_START_CAPTURE.equals(intent.getAction()))) {
            String pendingStage = safe(prefs.getString("captureStage", ""));
            if ("SIMULATOR_LAUNCHED_WAITING_CAPTURE".equals(pendingStage)
                || "SIMULATOR_LAUNCHING".equals(pendingStage)) {
                scheduleCaptureConsentAfterSimulatorLaunch(
                    prefs.getLong("simulatorLaunchStartedAt", System.currentTimeMillis())
                );
            } else {
                mainHandlerPost(this::beginCaptureConsent);
            }
        }
        return START_STICKY;
    }

    private void playProAutomatedStartVoiceIfEligible() {
        if (audioManager == null || prefs == null) return;
        String contextEpoch = safe(prefs.getString("contextEpoch", ""));
        if (contextEpoch.isEmpty()) return;
        String eventId = "PRO_AUTOMATED_START|" + contextEpoch;
        if (eventId.equals(safe(prefs.getString("lastProAutomatedStartVoiceEventId", "")))) return;
        if (audioManager.playGtoAutomatedStartVoice(eventId)) {
            prefs.edit()
                .putString("lastProAutomatedStartVoiceEventId", eventId)
                .putLong("lastProAutomatedStartVoiceDispatchAt", System.currentTimeMillis())
                .apply();
        }
    }

    public static void stopForAppClosure(Context context) {
        if (instance != null) {
            instance.stopForAppClosureInternal();
            return;
        }
        if (context == null) return;
        NotificationManager manager = (NotificationManager) context.getApplicationContext()
            .getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.cancel(NOTIFICATION_ID);
        try { context.getApplicationContext().stopService(new Intent(context.getApplicationContext(), SimpleAutomationService.class)); }
        catch (Exception ignored) {}
    }

    private void stopForAppClosureInternal() {
        ProOverlayProbeService.stopSession(this);
        removeOverlays();
        hideStatusChip();
        stopForeground(STOP_FOREGROUND_REMOVE);
        if (prefs != null) prefs.edit().putBoolean("running", false).putBoolean("overlayVisible", false).apply();
        stopSelf();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopForAppClosureInternal();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        destroying = true;
        cardVisibility.close();
        if (mainHandler != null) mainHandler.removeCallbacks(visibilityMonitorRunnable);
        if (mainHandler != null) {
            mainHandler.removeCallbacks(nativeSubmissionRetryRunnable);
            mainHandler.removeCallbacks(captureConsentTimeoutRunnable);
            mainHandler.removeCallbacks(nativeSubmissionTimeoutRunnable);
        }
        ProPendingTripJobService.schedule(this);
        cleanupCapture();
        ProOverlayProbeService.stopSession(this);
        hideStatusChip();
        if (audioManager != null) {
            audioManager.release();
            audioManager = null;
        }
        removeOverlays();
        if (captureThread != null) {
            try { captureThread.quitSafely(); } catch (Exception ignored) {}
            captureThread = null;
        }
        if (prefs != null) prefs.edit().putBoolean("running", false).apply();
        serviceBoundaries.onServiceDestroyed();
        if (instance == this) instance = null;
        super.onDestroy();
    }

    private void scheduleNativeSubmissionRetry() {
        if (mainHandler == null) return;
        mainHandler.removeCallbacks(nativeSubmissionRetryRunnable);
        mainHandler.postDelayed(nativeSubmissionRetryRunnable, NATIVE_SUBMISSION_RETRY_INTERVAL_MS);
    }

    public static void markCaptureDenied(Context context) {
        if (context == null) return;
        context.getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString("captureStage", "PROJECTION_DENIED")
            .putString("simpleState", "CAPTURE_ERROR")
            .putBoolean("captureUiHidden", false)
            .putString("lastEvent", "Autorização de captura recusada")
            .apply();
        if (instance != null) {
            instance.showBubbleIfAllowed();
            instance.refreshMenuContents();
        }
    }

    private void beginCaptureConsent() {
        if (captureFrameRequested || !STATE_CAPTURE_PENDING.equals(prefs.getString("simpleState", DEFAULT_STATE))) return;
        // The temporary bubble already owns an authorized virtual display. Reuse
        // its frames only now, after the driver requested receipt capture.
        if (ProOverlayProbeService.isActive()) {
            beginCaptureFromTemporaryProjection();
            return;
        }
        long consentStartedElapsedAt = SystemClock.elapsedRealtime();
        prefs.edit().putString("captureStage", "CONSENT_LAUNCHING")
            .putLong("captureConsentStartedElapsedAt", consentStartedElapsedAt)
            .apply();
        mainHandler.removeCallbacks(captureConsentTimeoutRunnable);
        mainHandler.postDelayed(captureConsentTimeoutRunnable, CAPTURE_CONSENT_TIMEOUT_MS);
        android.util.Log.i(PRO_TIMING_TAG, "stage=consent_requested elapsedMs=0");
        hideCaptureInteractiveOverlaysKeepBubble();
        try {
            Intent intent = new Intent(this, SimpleAutomationProjectionPermissionActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS);
            startActivity(intent);
        } catch (Exception error) {
            failCapture("Não foi possível solicitar captura");
        }
    }

    Handler getReceiptCaptureHandler() { return captureHandler; }

    void consumeTemporaryCaptureFrame(ImageReader reader, int width, int height) {
        if (temporaryReceiptCapture) captureLatestFrame(reader, width, height);
    }

    private void beginCaptureFromTemporaryProjection() {
        if (captureFrameRequested || !STATE_CAPTURE_PENDING.equals(prefs.getString("simpleState", DEFAULT_STATE))) return;
        mainHandler.removeCallbacks(captureConsentTimeoutRunnable);
        mainHandler.removeCallbacks(nativeSubmissionTimeoutRunnable);
        captureFrameRequested = true;
        captureOcrInFlight = false;
        captureOcrAttempts = 0;
        captureOcrEvidence = "";
        captureStartedAt = System.currentTimeMillis();
        captureStartedElapsedAt = SystemClock.elapsedRealtime();
        temporaryReceiptCapture = true;
        prefs.edit().putString("captureStage", "CAPTURING")
            .putInt("captureFrameAttempts", 0)
            .putLong("captureWarmupUntil", captureStartedAt + CAPTURE_FRAME_WARMUP_MS)
            .putLong("captureStartedElapsedAt", captureStartedElapsedAt)
            .apply();
        attachTemporaryReceiptCapture(2);
    }

    private void attachTemporaryReceiptCapture(int retriesRemaining) {
        if (!temporaryReceiptCapture || !captureFrameRequested) return;
        if (ProOverlayProbeService.beginReceiptCapture(this)) {
            scheduleCaptureWatchdog();
            return;
        }
        if (retriesRemaining > 0 && ProOverlayProbeService.isActive()) {
            captureHandler.postDelayed(() -> attachTemporaryReceiptCapture(retriesRemaining - 1), 300L);
            return;
        }
        mainHandlerPost(() -> {
            if (temporaryReceiptCapture && captureFrameRequested) {
                failCapture(ProOverlayProbeService.isActive()
                    ? "A captura temporária não forneceu imagens. Reabra o resultado e tente novamente."
                    : "A captura temporária foi encerrada pelo Android. Autorize novamente no Modo Pro.");
            }
        });
    }

    private void beginCapture(int resultCode, Intent data) {
        if (captureFrameRequested) return;
        mainHandler.removeCallbacks(captureConsentTimeoutRunnable);
        mainHandler.removeCallbacks(nativeSubmissionTimeoutRunnable);
        captureFrameRequested = true;
        captureOcrInFlight = false;
        captureOcrAttempts = 0;
        captureOcrEvidence = "";
        captureStartedAt = System.currentTimeMillis();
        captureStartedElapsedAt = SystemClock.elapsedRealtime();
        android.util.Log.i(PRO_TIMING_TAG, "stage=projection_granted elapsedMs=0");
        prefs.edit().putString("captureStage", "CAPTURING")
            .putInt("captureFrameAttempts", 0)
            .putLong("captureWarmupUntil", captureStartedAt + CAPTURE_FRAME_WARMUP_MS)
            .putLong("captureStartedElapsedAt", captureStartedElapsedAt)
            .apply();
        // Consent is the only sensitive surface where the bubble is removed.
        // Once MediaProjection is granted, rebuild only the visual bubble;
        // captureUiHidden remains true so cards/menu/status stay suppressed.
        showBubbleIfAllowed(true);
        startSimpleForeground(true);
        MediaProjectionManager manager = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
        if (manager == null) {
            failCapture("MediaProjection indisponível");
            return;
        }
        try {
            mediaProjection = manager.getMediaProjection(resultCode, data);
            if (mediaProjection == null) {
                failCapture("Autorização de captura inválida");
                return;
            }
            mediaProjection.registerCallback(projectionCallback, captureHandler);
            int width = Math.max(1, getResources().getDisplayMetrics().widthPixels);
            int height = Math.max(1, getResources().getDisplayMetrics().heightPixels);
            int density = Math.max(1, getResources().getDisplayMetrics().densityDpi);
            imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2);
            imageReader.setOnImageAvailableListener(reader -> captureLatestFrame(reader, width, height), captureHandler);
            virtualDisplay = mediaProjection.createVirtualDisplay(
                "NVU Simple Receipt", width, height, density,
                android.hardware.display.DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader.getSurface(), null, captureHandler
            );
            prefs.edit().putString("captureStage", "VIRTUAL_DISPLAY_CREATED")
                .putString("lastEvent", "Capturando recebimento").apply();
            android.util.Log.i(PRO_TIMING_TAG, "stage=virtual_display_created elapsedMs="
                + (SystemClock.elapsedRealtime() - captureStartedElapsedAt));
            // Do not refresh the native menu here. The capture flow has already
            // removed all overlays and must remain visually invisible until the
            // Web bridge acknowledges the receipt.
            scheduleCaptureWatchdog();
        } catch (Exception error) {
            failCapture("Falha ao iniciar captura: " + error.getClass().getSimpleName());
        }
    }

    private void scheduleCaptureWatchdog() {
        final long captureId = captureStartedElapsedAt;
        captureHandler.postDelayed(() -> checkCaptureWatchdog(captureId), CAPTURE_WATCHDOG_MS);
    }

    private void checkCaptureWatchdog(long captureId) {
        if (!captureFrameRequested || captureStartedElapsedAt != captureId) return;
        long elapsed = SystemClock.elapsedRealtime() - captureId;
        if (captureOcrInFlight && elapsed < CAPTURE_OCR_HARD_LIMIT_MS) {
            captureHandler.postDelayed(() -> checkCaptureWatchdog(captureId), 2000L);
            return;
        }
        final String message = captureOcrAttempts == 0
            ? "A captura autorizada não forneceu imagens. Reabra o resultado e tente novamente."
            : captureOcrInFlight
                ? "A leitura do resultado demorou. Tente capturar novamente."
                : "Não foi possível confirmar o valor do recebimento. Mantenha o resultado aberto e tente novamente.";
        android.util.Log.w(PRO_TIMING_TAG, "stage=capture_watchdog elapsedMs=" + elapsed
            + " frameAttempts=" + captureOcrAttempts + " ocrInFlight=" + captureOcrInFlight
            + " temporaryProjection=" + temporaryReceiptCapture);
        mainHandlerPost(() -> {
            if (captureFrameRequested && captureStartedElapsedAt == captureId) failCapture(message);
        });
    }

    private void captureLatestFrame(ImageReader reader, int width, int height) {
        if (!captureFrameRequested || captureOcrInFlight || reader == null) return;
        Image image = null;
        try {
            image = reader.acquireLatestImage();
            if (image == null) return;
            long warmupUntil = prefs.getLong("captureWarmupUntil", captureStartedAt + CAPTURE_FRAME_WARMUP_MS);
            if (System.currentTimeMillis() < warmupUntil) return;
            Image.Plane[] planes = image.getPlanes();
            if (planes == null || planes.length == 0) return;
            java.nio.ByteBuffer buffer = planes[0].getBuffer();
            int pixelStride = planes[0].getPixelStride();
            int rowStride = planes[0].getRowStride();
            int rowPadding = Math.max(0, rowStride - pixelStride * width);
            int bitmapWidth = width + (pixelStride == 0 ? 0 : rowPadding / pixelStride);
            Bitmap bitmap = Bitmap.createBitmap(bitmapWidth, height, Bitmap.Config.ARGB_8888);
            buffer.rewind();
            bitmap.copyPixelsFromBuffer(buffer);
            Bitmap frame = bitmapWidth == width ? bitmap : Bitmap.createBitmap(bitmap, 0, 0, width, height);
            if (frame != bitmap) bitmap.recycle();

            captureOcrInFlight = true;
            captureOcrAttempts += 1;
            final int attempt = captureOcrAttempts;
            // Simulator identity is already frozen in captureSimulatorKey/code before capture.
            final String simulatorKey = safe(prefs.getString("captureSimulatorKey", prefs.getString("simulatorKey", "")));
            android.util.Log.i(PRO_TIMING_TAG, "stage=ocr_started attempt=" + attempt
                + " elapsedMs=" + (SystemClock.elapsedRealtime() - captureStartedElapsedAt));
            prefs.edit().putString("captureStage", "OCR_PROCESSING")
                .putInt("captureFrameAttempts", attempt)
                .apply();

            if (textRecognizer == null) {
                captureOcrInFlight = false;
                captureFrameRequested = false;
                failCapture("OCR indisponível");
                frame.recycle();
                return;
            }

            final Bitmap fullFrame = frame;
            final Bitmap modalCrop = createResultModalCrop(frame, width, height);
            // Two nearest-neighbour scales are intentionally used for the monetary
            // field. The old bilinear fast path could soften a 6 into an 8. Agreement
            // between the two dedicated passes prevents that single-glyph error from
            // becoming the registered payout.
            final Bitmap amountCrop = createResultAmountCrop(frame, width, height, 2.0f);
            final Bitmap amountCropAlt = createResultAmountCrop(frame, width, height, 3.0f);
            final long captureId = captureStartedElapsedAt;
            // The modal and amount are the smallest useful regions. Run them
            // together; reserve the full screen for uncertain reads only.
            com.google.android.gms.tasks.Task<com.google.mlkit.vision.text.Text> modalTask =
                textRecognizer.process(InputImage.fromBitmap(modalCrop, 0));
            com.google.android.gms.tasks.Task<com.google.mlkit.vision.text.Text> amountTask =
                textRecognizer.process(InputImage.fromBitmap(amountCrop, 0));
            com.google.android.gms.tasks.Tasks.whenAllComplete(modalTask, amountTask)
                .addOnCompleteListener(firstPass -> {
                    String modalText = modalTask.isSuccessful() ? modalTask.getResult().getText() : "";
                    String amountText = amountTask.isSuccessful() ? amountTask.getResult().getText() : "";
                    Long firstAmount = GtoResultOcrConsensusPolicy.findConsensusAmount(
                        simulatorKey, modalText, amountText);
                    String firstEvidence = GtoResultOcrConsensusPolicy.mergeEvidence(modalText, amountText);
                    if (firstAmount != null && isLikelyResultReceiptText(firstEvidence)) {
                        recycleCaptureBitmaps(fullFrame, modalCrop, amountCrop, amountCropAlt);
                        handleOcrEvidence(firstEvidence, simulatorKey, attempt, firstAmount, captureId);
                        return;
                    }
                    textRecognizer.process(InputImage.fromBitmap(amountCropAlt, 0))
                        .addOnCompleteListener(secondPass -> {
                            String alternateText = secondPass.isSuccessful() ? secondPass.getResult().getText() : "";
                            String evidence = GtoResultOcrConsensusPolicy.mergeEvidence(firstEvidence, alternateText);
                            Long amount = GtoResultOcrConsensusPolicy.findFastPathAmountPair(
                                simulatorKey, amountText, alternateText, modalText);
                            if (amount != null && isLikelyResultReceiptText(evidence)) {
                                recycleCaptureBitmaps(fullFrame, modalCrop, amountCrop, amountCropAlt);
                                handleOcrEvidence(evidence, simulatorKey, attempt, amount, captureId);
                                return;
                            }
                            textRecognizer.process(InputImage.fromBitmap(fullFrame, 0))
                                .addOnCompleteListener(lastPass -> {
                                    String fullText = lastPass.isSuccessful() ? lastPass.getResult().getText() : "";
                                    String allEvidence = GtoResultOcrConsensusPolicy.mergeEvidence(evidence, fullText);
                                    Long confirmed = GtoResultOcrConsensusPolicy.findFastPathAmountPair(
                                        simulatorKey, amountText, alternateText, modalText, fullText);
                                    recycleCaptureBitmaps(fullFrame, modalCrop, amountCrop, amountCropAlt);
                                    handleOcrEvidence(allEvidence, simulatorKey, attempt, confirmed, captureId);
                                });
                        });
                });
        } catch (Exception error) {
            captureOcrInFlight = false;
            captureFrameRequested = false;
            failCapture("Falha ao ler frame");
        } finally {
            if (image != null) image.close();
        }
    }

    private Bitmap createResultAmountCrop(Bitmap frame, int width, int height, float scaleFactor) {
        if (frame == null || width <= 0 || height <= 0) return frame;
        // Dedicated monetary region: includes both the "Valor a receber" label and
        // the amount while excluding most gameplay/HUD. Upscaling improves OCR on
        // the small stylized font used by the result modal.
        int left = Math.max(0, Math.round(width * 0.28f));
        int top = Math.max(0, Math.round(height * 0.27f));
        int cropWidth = Math.min(frame.getWidth() - left, Math.round(width * 0.44f));
        int cropHeight = Math.min(frame.getHeight() - top, Math.round(height * 0.34f));
        if (cropWidth <= 8 || cropHeight <= 8) return frame;
        Bitmap crop = Bitmap.createBitmap(frame, left, top, cropWidth, cropHeight);
        int scaledWidth = Math.max(crop.getWidth(), Math.round(crop.getWidth() * Math.max(1.5f, scaleFactor)));
        int scaledHeight = Math.max(crop.getHeight(), Math.round(crop.getHeight() * Math.max(1.5f, scaleFactor)));
        // Preserve the tiny glyph contours. Bilinear interpolation is the root cause
        // of the reported 6 -> 8 payout misread on Android.
        Bitmap scaled = Bitmap.createScaledBitmap(crop, scaledWidth, scaledHeight, false);
        if (scaled != crop && !crop.isRecycled()) crop.recycle();
        return scaled;
    }

    private void recycleCaptureBitmaps(Bitmap fullFrame, Bitmap modalCrop, Bitmap amountCrop, Bitmap amountCropAlt) {
        if (modalCrop != null && modalCrop != fullFrame && !modalCrop.isRecycled()) modalCrop.recycle();
        if (amountCrop != null && amountCrop != fullFrame && amountCrop != modalCrop && !amountCrop.isRecycled()) amountCrop.recycle();
        if (amountCropAlt != null && amountCropAlt != fullFrame && amountCropAlt != modalCrop
            && amountCropAlt != amountCrop && !amountCropAlt.isRecycled()) amountCropAlt.recycle();
        if (fullFrame != null && !fullFrame.isRecycled()) fullFrame.recycle();
    }

    private Bitmap createResultModalCrop(Bitmap frame, int width, int height) {
        if (frame == null || width <= 0 || height <= 0) return frame;
        // Wide enough for every supported result modal, narrow enough to exclude the
        // simulator HUD. The screenshot regression that motivated this fix has the
        // modal entirely inside this normalized region.
        int left = Math.max(0, Math.round(width * 0.22f));
        int top = Math.max(0, Math.round(height * 0.18f));
        int cropWidth = Math.min(frame.getWidth() - left, Math.round(width * 0.56f));
        int cropHeight = Math.min(frame.getHeight() - top, Math.round(height * 0.60f));
        if (cropWidth <= 8 || cropHeight <= 8) return frame;
        return Bitmap.createBitmap(frame, left, top, cropWidth, cropHeight);
    }

    private void handleOcrEvidence(String evidence, String simulatorKey, int attempt,
                                   Long consensusAmountCents, long captureId) {
        if (!captureFrameRequested || captureStartedElapsedAt != captureId) return;
        captureOcrInFlight = false;
        String merged = GtoResultOcrConsensusPolicy.mergeEvidence(captureOcrEvidence, evidence);
        captureOcrEvidence = merged;
        boolean readable = !merged.trim().isEmpty();
        boolean amountReady = consensusAmountCents != null;
        boolean semanticReady = isLikelyResultReceiptText(merged);
        android.util.Log.i(PRO_TIMING_TAG, "stage=ocr_finished attempt=" + attempt
            + " readable=" + readable
            + " amountReady=" + amountReady
            + " semanticReady=" + semanticReady
            + " chars=" + merged.length()
            + " elapsedMs=" + (SystemClock.elapsedRealtime() - captureStartedElapsedAt));

        // Never turn a monetary candidate into a trip without the simulator's
        // result-screen evidence, even at the last bounded OCR attempt.
        if (amountReady && semanticReady) {
            captureFrameRequested = false;
            String canonicalLabel = "global-truck".equals(simulatorKey) ? "VALOR A RECEBER"
                : "toe-3".equals(simulatorKey) ? "RENDA TOTAL" : "GANHOS DA VIAGEM";
            String canonicalAmount = GtoResultOcrConsensusPolicy.formatAmountCents(consensusAmountCents);
            // Only the agreed monetary value is carried to persistence. Raw OCR
            // from other regions may contain a different, misread copy of the
            // same label, which used to invalidate a correctly confirmed trip.
            if (GtoResultOcrConsensusPolicy.hasConfirmedRewardedBonus(merged)) {
                failCapture("Resultado com bônus ou valor dobrado não pode ser registrado.");
                return;
            }
            String receipt = "global-truck".equals(simulatorKey) ? "CONCLUÍDO\n" : "";
            String currency = GtoResultOcrConsensusPolicy.extractCurrency(simulatorKey, merged);
            finishCapture(receipt + canonicalLabel + ": " + currency + " " + canonicalAmount);
            return;
        }
        if (attempt >= CAPTURE_MAX_OCR_ATTEMPTS) {
            captureFrameRequested = false;
            failCapture(!semanticReady
                ? "A tela de conclusão não foi confirmada. Mantenha o resultado aberto e tente novamente."
                : "Não foi possível confirmar o mesmo ganho em duas leituras independentes");
            return;
        }

        prefs.edit().putString("captureStage", readable ? "OCR_RETRYING" : "OCR_WAITING_FOR_RESULT")
            .putLong("captureNextRetryAt", System.currentTimeMillis() + CAPTURE_FRAME_RETRY_MS)
            .apply();
    }

    private void handleOcrFailure(int attempt) {
        captureOcrInFlight = false;
        if (!captureFrameRequested) return;
        if (attempt >= CAPTURE_MAX_OCR_ATTEMPTS) {
            captureFrameRequested = false;
            failCapture("Não foi possível confirmar o mesmo ganho em duas leituras independentes");
        } else {
            prefs.edit().putString("captureStage", "OCR_RETRYING")
                .putLong("captureNextRetryAt", System.currentTimeMillis() + CAPTURE_FRAME_RETRY_MS)
                .apply();
        }
    }

    private boolean isLikelyResultReceiptText(String text) {
        String normalized = Normalizer.normalize(safe(text), Normalizer.Form.NFD)
            .replaceAll("\\p{InCombiningDiacriticalMarks}+", "")
            .toUpperCase(Locale.ROOT)
            .replaceAll("\\s+", " ")
            .trim();
        String compact = normalized.replace(" ", "");
        String simulatorKey = safe(prefs.getString("captureSimulatorKey", prefs.getString("simulatorKey", "")));
        if ("global-truck".equals(simulatorKey)) {
            return compact.contains("CONCLUIDO") && compact.contains("VALORARECEBER");
        }
        if ("toe-3".equals(simulatorKey)) {
            return compact.contains("RENDATOTAL") || compact.contains("GANHOS");
        }
        if ("wtds".equals(simulatorKey) || "wbds".equals(simulatorKey)) {
            return compact.contains("GANHOS") || compact.contains("TOTAL");
        }
        return false;
    }

    // This is intentionally a monetary-field readiness check, not screen detection.
    // It only answers: "did OCR recover a plausible earnings field yet?"
    private boolean hasReceiptAmountCandidate(String text) {
        String simulatorKey = safe(prefs.getString("captureSimulatorKey", prefs.getString("simulatorKey", "")));
        return GtoResultOcrConsensusPolicy.extractAmountCents(simulatorKey, text) != null;
    }

    private void finishCapture(String text) {
        String normalized = text == null ? "" : text.trim();
        prefs.edit().putString("captureStage", "OCR_VALIDATING").apply();
        boolean readable = !normalized.isEmpty();
        String event = readable
            ? "Recebimento capturado para validação"
            : "Finalize a viagem na tela de resultados e tente novamente.";
        android.util.Log.i(PRO_TIMING_TAG, "stage=web_handoff readable=" + readable
            + " chars=" + normalized.length()
            + " elapsedMs=" + (SystemClock.elapsedRealtime() - captureStartedElapsedAt));
        long captureEventVersion = prefs.getLong("captureEventVersion", 0L) + (readable ? 1L : 0L);
        prefs.edit()
            .putString("captureStage", readable ? "OCR_CAPTURED" : "OCR_REJECTED")
            .putString("simpleState", readable ? "CAPTURE_CAPTURED" : "CAPTURE_ERROR")
            .putString("receiptText", normalized)
            .putLong("receiptCapturedAt", System.currentTimeMillis())
            .putLong("captureEventVersion", captureEventVersion)
            .putString("nativeSubmissionState", readable ? "CAPTURE_CAPTURED" : "IDLE")
            .putBoolean("nativeSubmissionStarted", false)
            .remove("nativeSubmissionStartedAt")
            .putString("lastEvent", event)
            .apply();
        if (readable) {
            submitNativeReceiptIfPending();
        }
        cleanupCapture();
        if (readable && "CAPTURE_CAPTURED".equals(prefs.getString("simpleState", DEFAULT_STATE))) {
            // Only a receipt still waiting for handoff uses the transient chip.
            // The queue has already displayed its own pending/confirmed card.
            hideStatusChip();
            closeMenu();
            showStatusChip("Enviando viagem…", 9000L);
        } else if (!readable) {
            prefs.edit().putBoolean("captureUiHidden", false).apply();
            showBubbleIfAllowed();
            showStatusChip(event, 4200L);
            refreshMenuContents();
        }
    }

    private void submitNativeReceiptIfPending() {
        if (prefs == null || !"CAPTURE_CAPTURED".equals(prefs.getString("simpleState", DEFAULT_STATE))) return;
        String receipt = safe(prefs.getString("receiptText", ""));
        if (receipt.isEmpty()) return;
        if (SimpleProNativeSubmissionCoordinator.parseReceipt(
            safe(prefs.getString("captureSimulatorKey", "")), receipt) == null) {
            failCapture("O valor do comprovante não passou pela validação. Mantenha o resultado aberto.");
            return;
        }
        String id = ProPendingTripStore.enqueue(this, prefs, receipt);
        if (id.isEmpty()) {
            failCapture("Não foi possível guardar a viagem neste aparelho. Tente novamente.");
            return;
        }
        // The existing voice says the trip WILL be sent. Play it only after
        // the validated receipt is safely queued, rather than after its ACK.
        emitSimpleTripCompletedVoice("simple-finish:" + id);
        boolean online = hasUsableNetwork();
        prefs.edit()
            .putString("lastPendingProAttemptId", id)
            .putString("nativeSubmissionState", "QUEUED")
            .putString("captureStage", "QUEUED")
            .apply();
        acknowledgeReceipt(this, true, online
            ? "Viagem preservada. Enviando para validação do servidor."
            : "Viagem preservada. Aguardando conexão para validação.");
        showPendingTripCard(id, online ? "Enviando viagem…" : "Aguardando envio · sem rede");
        ProPendingTripJobService.schedule(this);
        processPendingProTrips();
    }

    private boolean hasUsableNetwork() {
        android.net.ConnectivityManager manager = (android.net.ConnectivityManager)
            getSystemService(CONNECTIVITY_SERVICE);
        if (manager == null) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            android.net.Network network = manager.getActiveNetwork();
            android.net.NetworkCapabilities capabilities = network == null ? null : manager.getNetworkCapabilities(network);
            return capabilities != null
                && capabilities.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET)
                && capabilities.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_VALIDATED);
        }
        android.net.NetworkInfo info = manager.getActiveNetworkInfo();
        return info != null && info.isConnected();
    }

    private String pendingTripPreview(String id, String heading) {
        SharedPreferences entry = ProPendingTripStore.entry(this, id);
        String origin = safe(entry.getString("captureOrigin", ""));
        String destination = safe(entry.getString("captureDestination", ""));
        SimpleProNativeSubmissionCoordinator.Receipt receipt =
            ProPendingTripStore.validatedReceipt(entry);
        long amount = receipt == null ? 0L : receipt.amountCents;
        int total = Math.max(0, entry.getInt("jobTotalDeliveries", 0));
        boolean sameScope = safe(entry.getString("jobId", "")).equals(safe(prefs.getString("jobId", "")))
            && safe(entry.getString("companyId", "")).equals(safe(prefs.getString("companyId", "")))
            && safe(entry.getString("driverId", "")).equals(safe(prefs.getString("driverId", "")));
        int progress = sameScope ? Math.max(0,
            prefs.getInt("confirmedTripCount", 0))
            : Math.max(0, entry.getInt("jobProgress", 0));
        return heading + "\n" + origin + " → " + destination
            + "\nGanhos " + ProTripMoneyPresentation.format(amount, receipt == null ? "" : receipt.currency,
                entry.getString("captureSimulatorKey", ""), entry.getString("receiptText", ""))
            + "\nOperação atual " + Math.min(progress, total > 0 ? total : progress) + "/" + total
            + (heading.startsWith("Viagem registrada")
                ? (sameScope && prefs.getInt("confirmedTripCount", 0) > progress ? " · atualizando painel" : "")
                : "FAILED".equals(entry.getString("queueStatus", "")) ? " · revisão necessária"
                : "AUTH_REQUIRED".equals(entry.getString("queueStatus", "")) ? " · confirme sua conta"
                : "SENDING".equals(entry.getString("queueStatus", "")) ? " · enviando"
                : " · aguardando envio");
    }

    private NativeTripReceipt pendingTripReceipt(String id, String heading, NativeTripReceipt.State state) {
        SharedPreferences entry = ProPendingTripStore.entry(this, id);
        SimpleProNativeSubmissionCoordinator.Receipt receipt = ProPendingTripStore.validatedReceipt(entry);
        boolean sameScope = safe(entry.getString("jobId", "")).equals(safe(prefs.getString("jobId", "")))
            && safe(entry.getString("companyId", "")).equals(safe(prefs.getString("companyId", "")))
            && safe(entry.getString("driverId", "")).equals(safe(prefs.getString("driverId", "")));
        int progress = sameScope ? prefs.getInt("confirmedTripCount", 0) : entry.getInt("jobProgress", 0);
        return new NativeTripReceipt(state, id, entry.getString("nativeTripId", ""),
            entry.getString("driverId", ""), entry.getString("companyId", ""), entry.getString("jobId", ""),
            heading, entry.getString("captureOrigin", ""), entry.getString("captureDestination", ""),
            ProTripMoneyPresentation.format(receipt == null ? 0L : receipt.amountCents,
                receipt == null ? "" : receipt.currency, entry.getString("captureSimulatorKey", ""),
                entry.getString("receiptText", "")), progress, entry.getInt("jobTotalDeliveries", 0));
    }

    private void showPendingTripCard(String id, String heading) {
        if (id.isEmpty() || !ProPendingTripStore.contains(prefs, id)) return;
        if (STATE_CAPTURE_PENDING.equals(prefs.getString("simpleState", DEFAULT_STATE))) return;
        SharedPreferences entry = ProPendingTripStore.entry(this, id);
        NativeTripReceipt.State state = "FAILED".equals(entry.getString("queueStatus", ""))
            || "AUTH_REQUIRED".equals(entry.getString("queueStatus", ""))
            ? NativeTripReceipt.State.ACTION_REQUIRED : NativeTripReceipt.State.PENDING;
        showRegisteredTripCard(pendingTripReceipt(id, heading, state), 6500L);
        refreshMenuContents();
    }

    private void processPendingProTrips() {
        if (prefs == null || !pendingInFlightId.isEmpty() || !hasUsableNetwork()) return;
        com.google.firebase.auth.FirebaseUser nativeUser = GtoFirebaseRuntime.currentUser(this);
        ProPendingTripStore.pruneAcknowledgedEntries(this, prefs, nativeUser == null ? "" : nativeUser.getUid());
        for (String id : ProPendingTripStore.ids(prefs)) {
            SharedPreferences entry = ProPendingTripStore.entry(this, id);
            if (PendingOperationStartStore.blocks(this, entry)) continue;
            String queueStatus = entry.getString("queueStatus", "");
            if ("FAILED".equals(queueStatus) || "AUTH_REQUIRED".equals(queueStatus)) continue;
            int generation = ProPendingTripStore.claim(this, prefs, id);
            if (generation < 0) continue;
            final String attempt = id;
            pendingInFlightId = attempt;
            pendingInFlightGeneration = generation;
            mainHandler.removeCallbacks(nativeSubmissionTimeoutRunnable);
            mainHandler.postDelayed(nativeSubmissionTimeoutRunnable, NATIVE_SUBMISSION_TIMEOUT_MS);
            SimpleProNativeSubmissionCoordinator.submit(
                this, entry, safe(entry.getString("receiptText", "")),
                new SimpleProNativeSubmissionCoordinator.Listener() {
                    @Override public void onSuccess(String tripId) {
                        mainHandlerPost(() -> {
                            if (!ProPendingTripStore.contains(prefs, attempt)) return;
                            if (ProPendingTripStore.isCompletionRecorded(prefs, entry)) return;
                            // A late server ACK is authoritative even if a local
                            // timeout already made the UI show a pending state.
                            if (attempt.equals(pendingInFlightId)) {
                                mainHandler.removeCallbacks(nativeSubmissionTimeoutRunnable);
                                pendingInFlightId = "";
                            }
                            NativeTripReceipt card = pendingTripReceipt(attempt, "", NativeTripReceipt.State.CONFIRMED);
                            boolean sameScope = safe(entry.getString("jobId", "")).equals(safe(prefs.getString("jobId", "")))
                                && safe(entry.getString("companyId", "")).equals(safe(prefs.getString("companyId", "")))
                                && safe(entry.getString("driverId", "")).equals(safe(prefs.getString("driverId", "")));
                            ProPendingTripStore.remove(SimpleAutomationService.this, prefs, attempt);
                            if (attempt.equals(safe(prefs.getString("lastPendingProAttemptId", "")))) {
                                prefs.edit().putString("nativeSubmissionState", "SYNCED")
                                    .putString("nativeTripId", safe(tripId))
                                    .putString("lastEvent", "Viagem registrada no servidor")
                                    .apply();
                            }
                            if (sameScope && !STATE_CAPTURE_PENDING.equals(prefs.getString("simpleState", DEFAULT_STATE))) {
                                showRegisteredTripCard(card, 6500L);
                            }
                            refreshMenuContents();
                            processPendingProTrips();
                        });
                    }

                    @Override public void onFallback(String reason) {
                        mainHandlerPost(() -> {
                            if (ProPendingTripStore.isCompletionRecorded(prefs, entry)) return;
                            if (!attempt.equals(pendingInFlightId) || generation != pendingInFlightGeneration
                                || generation != entry.getInt("nativeAttemptGeneration", 0)) return;
                            mainHandler.removeCallbacks(nativeSubmissionTimeoutRunnable);
                            pendingInFlightId = "";
                            boolean permissionFailure = SimpleProNativeSubmissionCoordinator.isPermissionFailureReason(reason);
                            boolean permissionPaused = permissionFailure
                                && "MATCH".equals(entry.getString("nativeAuthState", "UNKNOWN"));
                            boolean authRequired = SimpleProNativeSubmissionCoordinator.isAuthRequiredReason(reason);
                            boolean rejected = isPermanentSubmissionRejection(entry.getString("reasonCode", "") + ":" + reason);
                            boolean specificContractMismatch = PendingTripFailurePolicy.isSpecificGtoContractMismatch(
                                "FAILED", "FAILED", entry.getString("reasonCode", ""), reason, reason,
                                "registerGtoProReceipt", "CALLABLE_REGISTRATION");
                            boolean manualSpecificFailure = specificContractMismatch && !authRequired;
                            String safeReason = authRequired
                                ? "Autenticação Google necessária para retomar o envio desta viagem."
                                : permissionPaused
                                    ? "Envio pausado por permissão do servidor. O recibo segue salvo e será retomado quando o servidor confirmar o acesso."
                                : safe(reason).contains("GTO_PRO_BACKEND_NOT_DEPLOYED")
                                    ? "Atualização do registro GTO no servidor pendente. A viagem segue salva e será reenviada automaticamente."
                                : isReconciliationRequired(reason)
                                    ? "Estado da operação em reconciliação. A mesma viagem permanece salva e será reenviada automaticamente."
                                : safe(reason).contains("GTO_PRO_REGISTRATION_FAILED:FAILED_PRECONDITION")
                                    || safe(reason).contains("GTO_PRO_REGISTRATION_FAILED:PERMISSION_DENIED")
                                    || safe(reason).contains("GTO_PRO_REGISTRATION_FAILED:INVALID_ARGUMENT")
                                    ? (rejected
                                        ? "Registro rejeitado por uma condição permanente. A viagem foi preservada para revisão."
                                        : "O servidor ainda não confirmou a viagem. O mesmo recibo será reenviado automaticamente.")
                                : safe(reason).contains("NATIVE_RECEIPT_EVIDENCE_CONFLICT")
                                    ? "Conflito entre o comprovante salvo e a viagem no servidor (valor, rota ou simulador). Revisão necessária."
                                : safe(reason).contains("LOW_VALUE_REPAIR_FAILED:FAILED_PRECONDITION")
                                    || safe(reason).contains("LOW_VALUE_REPAIR_NOT_CONFIRMED")
                                    ? "O registro Print anterior exige reconciliação da operação. A viagem Pro continua salva neste aparelho."
                                : permissionFailure
                                    ? "Envio bloqueado por permissão; a etapa exata precisa de diagnóstico. A viagem permanece salva."
                                    : safe(reason);
                            entry.edit()
                                .putString(CanonicalTripOutboxSchema.KEY_STATE, (rejected || manualSpecificFailure)
                                    ? CanonicalTripOutboxSchema.STATE_FAILED : CanonicalTripOutboxSchema.STATE_PENDING_SYNC)
                                .putString("nativeSubmissionState", authRequired ? "AUTH_REQUIRED" : ((rejected || manualSpecificFailure) ? "FAILED" : (permissionPaused ? "PERMISSION_PAUSED" : "QUEUED")))
                                .putString("queueStatus", authRequired ? "AUTH_REQUIRED" : ((rejected || manualSpecificFailure) ? "FAILED" : (permissionPaused ? "PERMISSION_PAUSED" : "WAITING")))
                                .putString("lastQueueError", safeReason)
                                .putString("lastQueueErrorCode", safe(reason))
                                .putBoolean("contractMismatchRecoveryAuthorized", !rejected && !manualSpecificFailure
                                    && entry.getBoolean("contractMismatchRecoveryAuthorized", false))
                                .putBoolean("contractMismatchRecoveryRequested", !rejected && !manualSpecificFailure
                                    && entry.getBoolean("contractMismatchRecoveryRequested", false))
                                // A recoverable network/context race is retried by
                                // the same owner immediately. Only explicit Google
                                // re-authentication keeps a cooldown; permanent
                                // validation failures remain stopped.
                                .putLong("retryAt", permissionPaused ? 0L : System.currentTimeMillis() + (authRequired
                                    ? NATIVE_AUTH_RETRY_COOLDOWN_MS
                                    : ProPendingTripStore.retryDelay(entry, reason)))
                                .apply();
                            if (authRequired) {
                                String authState = entry.getString("nativeAuthState", "UNKNOWN");
                                prefs.edit()
                                    .putString("nativeAuthState", authState)
                                    .putBoolean("nativeAuthRequired", true)
                                    .putLong("nativeAuthDiagnosticAt", entry.getLong("nativeAuthDiagnosticAt", System.currentTimeMillis()))
                                    .putString("nativeSubmissionState", "AUTH_REQUIRED")
                                    .putString("lastEvent", safeReason)
                                    .apply();
                            }
                            showPendingTripCard(attempt, authRequired
                                ? "Autenticação Google necessária para retomar"
                                : rejected
                                ? "Registro não aprovado. Verifique no NVU"
                                : (hasUsableNetwork() ? "Aguardando envio · nova tentativa automática" : "Aguardando envio · sem rede"));
                            if (!authRequired && !permissionPaused && !rejected && !manualSpecificFailure) ProPendingTripJobService.schedule(SimpleAutomationService.this);
                        });
                    }
                });
            return;
        }
    }

    private boolean isReconciliationRequired(String reason) {
        return PendingTripFailurePolicy.isReconciliationRequired(reason);
    }

    private boolean isPermanentSubmissionRejection(String reason) {
        return PendingTripFailurePolicy.isPermanentRejection(reason);
    }

    private void failCapture(String message) {
        prefs.edit().putString("captureStage", "CAPTURE_FAILED").apply();
        String userMessage = safe(message).isEmpty()
            ? "Captura fora da tela correta. Abra a tela de conclusão/recebimento e tente novamente."
            : safe(message);
        prefs.edit()
            .putString("simpleState", "CAPTURE_ERROR")
            .putString("lastEvent", userMessage)
            .apply();
        cleanupCapture();
        prefs.edit().putBoolean("captureUiHidden", false).apply();
        showBubbleIfAllowed();
        showStatusChip(userMessage, 4200L);
        mainHandlerPost(this::refreshMenuContents);
    }

    private void cleanupCapture() {
        if (temporaryReceiptCapture) {
            temporaryReceiptCapture = false;
            ProOverlayProbeService.endReceiptCapture(this);
        }
        if (mainHandler != null) {
            mainHandler.removeCallbacks(captureConsentTimeoutRunnable);
        }
        captureFrameRequested = false;
        captureOcrInFlight = false;
        captureOcrAttempts = 0;
        try { if (imageReader != null) imageReader.close(); } catch (Exception ignored) {}
        imageReader = null;
        try { if (virtualDisplay != null) virtualDisplay.release(); } catch (Exception ignored) {}
        virtualDisplay = null;
        try { if (mediaProjection != null) mediaProjection.unregisterCallback(projectionCallback); } catch (Exception ignored) {}
        try { if (mediaProjection != null) mediaProjection.stop(); } catch (Exception ignored) {}
        mediaProjection = null;
    }

    private void startSimpleForeground(boolean capture) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            int types = ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE;
            if (capture) types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION;
            startForeground(NOTIFICATION_ID, buildNotification(), types);
        } else {
            startForeground(NOTIFICATION_ID, buildNotification());
        }
    }

    private void mainHandlerPost(Runnable action) {
        new Handler(getMainLooper()).post(action);
    }

    @SuppressWarnings("deprecation")
    private Intent readProjectionData(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) return intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent.class);
        return intent.getParcelableExtra(EXTRA_RESULT_DATA);
    }

    public static void onTemporaryOverlayEnded() {
        SimpleAutomationService current = instance;
        if (current == null) return;
        current.mainHandler.postDelayed(() -> {
            if (!ProOverlayProbeService.isActive() && !android.provider.Settings.canDrawOverlays(current)) {
                if (current.temporaryReceiptCapture && current.captureFrameRequested) {
                    current.failCapture("A captura foi interrompida pelo Android. Autorize a bolha novamente.");
                }
                current.removeOverlays();
                current.prefs.edit().putBoolean("overlayPermission", false).apply();
            }
        }, 250L);
    }

    private void showBubbleIfAllowed() {
        showBubbleIfAllowed(false);
    }

    private void scheduleBubbleRecoveryWatchdog() {
        if (mainHandler == null) return;
        mainHandler.postDelayed(new Runnable() {
            @Override public void run() {
                if (destroying) return;
                try {
                    boolean proRunning = prefs != null && prefs.getBoolean("running", false);
                    boolean permission = ProModeController.hasOverlay(SimpleAutomationService.this);
                    boolean missingBubble = bubbleView == null || !bubbleView.isAttachedToWindow();
                    if (proRunning && permission && missingBubble && !isCaptureConsentSurfaceActive()) {
                        showBubbleIfAllowed(true);
                        if (prefs != null) {
                            prefs.edit()
                                .putString("overlayLastAction", "bubble:watchdog_restore")
                                .putLong("overlayLastActionAt", System.currentTimeMillis())
                                .apply();
                        }
                    }
                } catch (Exception ignored) {}
                if (mainHandler != null) mainHandler.postDelayed(this, 3000L);
            }
        }, 3000L);
    }

    private void showBubbleIfAllowed(boolean forceDuringCapture) {
        if (destroying) return;
        // captureUiHidden is never an input/visibility gate for the normal NVU control.
        // The Android consent surface and physical orientation are hard visual gates.
        if (isCaptureConsentSurfaceActive()) return;
        if (!isProBubbleOrientationAllowed()) return;
        // Foreground/package evidence remains advisory for capture. It must not
        // authorize, block, or remove the interactive control in landscape.
        boolean overlayPermission = ProModeController.hasOverlay(this);
        if (prefs != null) {
            prefs.edit().putBoolean("overlayPermission", overlayPermission).apply();
            if (!overlayPermission) {
                prefs.edit().putString("overlayLastError", "overlay-permission")
                    .putLong("overlayLastErrorAt", System.currentTimeMillis()).apply();
            }
        }
        // Android can detach a window while the service still owns its View.
        // Clear that stale reference so the monitor can recreate the button.
        if (bubbleView != null && !bubbleView.isAttachedToWindow()) {
            if (windowManager != null) {
                try { windowManager.removeViewImmediate(bubbleView); } catch (RuntimeException ignored) {}
            }
            bubbleView = null;
            bubbleLabelView = null;
            captureHealthDotView = null;
            bubbleParams = null;
        }
        if (windowManager == null || bubbleView != null || !overlayPermission) return;
        final int buttonWidth = dp(68);
        final int buttonHeight = dp(32);
        final int healthDotSize = dp(6);
        FrameLayout frame = new FrameLayout(this);
        bubbleView = frame;
        frame.setBackgroundColor(Color.TRANSPARENT);
        frame.setElevation(dp(6));

        TextView label = new TextView(this);
        bubbleLabelView = label;
        label.setText("NVU");
        label.setTextColor(Color.WHITE);
        label.setTextSize(12f);
        label.setGravity(Gravity.CENTER);
        label.setTypeface(label.getTypeface(), android.graphics.Typeface.BOLD);
        label.setBackground(makeNvuBubbleBackground(false));
        label.setContentDescription("NVU · Modo Pro · tocar para abrir ou fechar os cards");
        // The parent owns the complete gesture stream. Keeping the child non-clickable
        // prevents OEM/ViewGroup dispatch differences from stealing ACTION_DOWN/UP.
        label.setClickable(false);
        label.setFocusable(false);
        label.setLongClickable(false);
        frame.setClickable(true);
        frame.setFocusable(false);
        frame.setLongClickable(false);
        frame.setContentDescription("NVU · Modo Pro · controle flutuante");
        FrameLayout.LayoutParams labelParams = new FrameLayout.LayoutParams(buttonWidth, buttonHeight);
        labelParams.gravity = Gravity.START | Gravity.TOP;
        frame.addView(label, labelParams);

        captureHealthDotView = new View(this);
        captureHealthDotView.setBackground(roundBackground(Color.rgb(82, 88, 96), healthDotSize / 2));
        captureHealthDotView.setAlpha(0.55f);
        FrameLayout.LayoutParams dotParams = new FrameLayout.LayoutParams(healthDotSize, healthDotSize);
        dotParams.gravity = Gravity.END | Gravity.TOP;
        dotParams.setMargins(0, dp(4), dp(4), 0);
        frame.addView(captureHealthDotView, dotParams);
        lastCaptureHealthIndicatorState = null;

        bubbleParams = new WindowManager.LayoutParams(
            buttonWidth, buttonHeight, overlayType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        );
        bubbleParams.gravity = Gravity.TOP | Gravity.START;
        DisplayMetrics initialMetrics = realDisplayMetrics();
        applyInitialProBubblePosition(initialMetrics, buttonWidth, buttonHeight);
        final int touchSlop = Math.max(dp(10), ViewConfiguration.get(this).getScaledTouchSlop());
        final View.OnTouchListener bubbleTouchListener = (view, event) -> {
            if (cardVisibility.isSuppressed()) return true;
            if (prefs != null && prefs.getBoolean("captureUiHidden", false)) return true;
            final boolean consentSurfaceActive = isCaptureConsentSurfaceActive();
            final int action = event.getActionMasked();
            final long now = System.currentTimeMillis();
            switch (action) {
                case MotionEvent.ACTION_DOWN:
                    view.setPressed(true);
                    rebaseProBubbleLayoutForCurrentDisplay(false, "POINTER_DOWN_REBASE");
                    beginSimpleBubbleGesture(event, now);
                    return true;
                case MotionEvent.ACTION_MOVE:
                    if (!isSimpleBubbleGestureCompatible(event)) {
                        cancelSimpleBubbleGesture("POINTER_CHANGED", true);
                        view.setPressed(false);
                        return true;
                    }
                    bubbleGestureLastEventAt = now;
                    float dx = event.getRawX() - bubbleGestureDownRawX;
                    float dy = event.getRawY() - bubbleGestureDownRawY;
                    if (!bubbleDragging && Math.hypot(dx, dy) >= touchSlop) {
                        bubbleDragging = true;
                        closeMenu();
                    }
                    if (!bubbleDragging) return true;
                    showSimpleBubbleRemoveTarget(bubbleActiveGestureGeneration);
                    DisplayMetrics screen = realDisplayMetrics();
                    int dragSafeLeft = dp(8);
                    int dragSafeTop = safeTopInsetPx() + dp(8);
                    int dragMaxX = bubbleSafeMaxX(screen, buttonWidth);
                    int dragMaxY = bubbleSafeMaxY(screen, buttonHeight);
                    bubbleParams.x = Math.max(dragSafeLeft, Math.min(dragMaxX, bubbleGestureStartX + Math.round(dx)));
                    bubbleParams.y = Math.max(dragSafeTop, Math.min(dragMaxY, bubbleGestureStartY + Math.round(dy)));
                    try {
                        windowManager.updateViewLayout(bubbleView, bubbleParams);
                        updateSimpleBubbleRemoveTargetHighlight();
                    } catch (Exception error) {
                        cancelSimpleBubbleGesture("UPDATE_VIEW_FAILURE", true);
                    }
                    return true;
                case MotionEvent.ACTION_UP:
                    boolean wasDragging = bubbleDragging;
                    boolean pointerMatches = isSimpleBubbleGestureActionPointer(event);
                    long releaseGeneration = bubbleActiveGestureGeneration;
                    boolean geometryInside = isSimpleBubbleDroppedOnRemoveTarget(releaseGeneration);
                    boolean stopAllowed = GtoBubbleDismissPolicy.canCommitStop(
                        true, bubbleGestureActive, bubbleDragging, false, true,
                        pointerMatches, bubbleRemoveTargetView != null,
                        bubbleRemoveTargetHighlighted,
                        releaseGeneration != 0L && bubbleRemoveTargetParams != null,
                        geometryInside, now, bubbleGestureDownAt,
                        bubbleGestureLastEventAt, BUBBLE_GESTURE_MAX_DURATION_MS,
                        BUBBLE_STOP_RELEASE_FRESH_MS
                    );
                    if (wasDragging && !stopAllowed && bubbleParams != null) {
                        persistPreferredProBubblePosition(realDisplayMetrics(), buttonWidth, buttonHeight);
                    }
                    cancelSimpleBubbleGesture("ACTION_UP", false);
                    view.setPressed(false);
                    if (stopAllowed) {
                        stopSimpleFromFloatingBubble(releaseGeneration);
                    } else if (!wasDragging) {
                        // HF377: a short tap must always have a visible action.
                        // captureUiHidden and OCR/submission states are not input locks.
                        // Only Android's MediaProjection consent surface is allowed to
                        // suppress the full cards temporarily.
                        if (consentSurfaceActive) {
                            showStatusChip("Autorização de captura em andamento…", 1800L, true);
                        } else {
                            hideStatusChip();
                            view.performClick();
                        }
                    }
                    return true;
                case MotionEvent.ACTION_CANCEL:
                    cancelSimpleBubbleGesture("ACTION_CANCEL", false);
                    view.setPressed(false);
                    return true;
                case MotionEvent.ACTION_POINTER_DOWN:
                case MotionEvent.ACTION_POINTER_UP:
                    cancelSimpleBubbleGesture("MULTI_POINTER", true);
                    view.setPressed(false);
                    return true;
                default:
                    return true;
            }
        };
        frame.setOnTouchListener(bubbleTouchListener);
        label.setOnTouchListener(bubbleTouchListener);
        captureHealthDotView.setOnTouchListener(bubbleTouchListener);
        View.OnClickListener openCardsClickListener = v -> {
            bubbleTapCount++;
            bubbleLastTapAt = System.currentTimeMillis();
            if (prefs != null) {
                prefs.edit()
                    .putLong("bubbleTapCount", bubbleTapCount)
                    .putLong("bubbleLastTapAt", bubbleLastTapAt)
                    .putString("overlayLastAction", "bubble:tap")
                    .apply();
            }
            if (!cardVisibility.isSuppressed() && !isCaptureConsentSurfaceActive()) {
                toggleMenu();
            }
        };
        frame.setOnClickListener(openCardsClickListener);
        label.setOnClickListener(openCardsClickListener);
        captureHealthDotView.setOnClickListener(openCardsClickListener);
        try {
            applyBubbleCardVisibility(cardVisibility.isSuppressed());
            windowManager.addView(bubbleView, bubbleParams);
            bubbleLayoutDisplayWidth = initialMetrics.widthPixels;
            bubbleLayoutDisplayHeight = initialMetrics.heightPixels;
            prefs.edit().putBoolean("overlayVisible", true).putBoolean("bubbleVisible", true)
                .putString("overlayLastAction", "added:bubble")
                .remove("overlayLastError").remove("overlayLastErrorAt").apply();
        } catch (SecurityException error) {
            ProModeController.onOverlayWindowRejected(this);
            bubbleView = null;
            bubbleLabelView = null;
            captureHealthDotView = null;
            prefs.edit().putBoolean("overlayVisible", false).putBoolean("bubbleVisible", false).apply();
            recordOverlayDiagnostic("add_security_exception", error);
        } catch (RuntimeException error) {
            bubbleView = null;
            bubbleLabelView = null;
            captureHealthDotView = null;
            prefs.edit().putBoolean("overlayVisible", false).putBoolean("bubbleVisible", false).apply();
            recordOverlayDiagnostic("add_runtime_exception", error);
        }
    }

    private void beginSimpleBubbleGesture(MotionEvent event, long now) {
        cancelSimpleBubbleGesture("NEW_ACTION_DOWN", false);
        bubbleGestureGeneration++;
        if (bubbleGestureGeneration <= 0L) bubbleGestureGeneration = 1L;
        bubbleActiveGestureGeneration = bubbleGestureGeneration;
        bubbleGesturePointerId = event.getPointerId(event.getActionIndex());
        bubbleGestureActive = true;
        bubbleDragging = false;
        bubbleGestureDownRawX = event.getRawX();
        bubbleGestureDownRawY = event.getRawY();
        bubbleGestureStartX = bubbleParams == null ? 0 : bubbleParams.x;
        bubbleGestureStartY = bubbleParams == null ? 0 : bubbleParams.y;
        bubbleGestureDownAt = now;
        bubbleGestureLastEventAt = now;
        if (mainHandler != null) {
            mainHandler.postDelayed(() -> {
                if (bubbleActiveGestureGeneration == bubbleGestureGeneration
                    && bubbleGestureActive && !bubbleDragging) {
                    prefs.edit().putString("lastEvent", "Arraste a bolha para movê-la ou removê-la").apply();
                }
            }, 520L);
        }
    }

    private boolean isSimpleBubbleGestureCompatible(MotionEvent event) {
        return bubbleGestureActive && event != null && event.getPointerCount() == 1
            && event.getPointerId(0) == bubbleGesturePointerId;
    }

    private boolean isSimpleBubbleGestureActionPointer(MotionEvent event) {
        if (!bubbleGestureActive || event == null || event.getPointerCount() < 1) return false;
        int index = event.getActionIndex();
        return index >= 0 && index < event.getPointerCount()
            && event.getPointerId(index) == bubbleGesturePointerId;
    }

    private void cancelSimpleBubbleGesture(String reason, boolean persistDiagnostic) {
        long generation = bubbleActiveGestureGeneration;
        bubbleGestureActive = false;
        bubbleDragging = false;
        bubbleGesturePointerId = MotionEvent.INVALID_POINTER_ID;
        bubbleActiveGestureGeneration = 0L;
        bubbleGestureDownAt = 0L;
        bubbleGestureLastEventAt = 0L;
        hideSimpleBubbleRemoveTarget();
        if (persistDiagnostic && prefs != null) {
            prefs.edit().putString("bubbleGestureLastCancelReason", reason == null ? "CANCELLED" : reason)
                .putLong("bubbleGestureLastCancelAt", System.currentTimeMillis())
                .putLong("bubbleGestureLastCancelGeneration", generation)
                .apply();
        }
    }

    private void showSimpleBubbleRemoveTarget(long gestureGeneration) {
        if (windowManager == null || bubbleRemoveTargetView != null || !bubbleGestureActive
            || !bubbleDragging || gestureGeneration == 0L
            || gestureGeneration != bubbleActiveGestureGeneration) return;
        DisplayMetrics screen = getResources().getDisplayMetrics();
        int width = dp(184);
        int height = dp(52);
        TextView target = new TextView(this);
        target.setText("Remover e parar NVU");
        target.setTextColor(Color.WHITE);
        target.setTextSize(14f);
        target.setGravity(Gravity.CENTER);
        target.setTypeface(target.getTypeface(), android.graphics.Typeface.BOLD);
        target.setPadding(dp(14), 0, dp(14), 0);
        target.setBackground(roundBackground(Color.rgb(92, 45, 48), 18));
        target.setElevation(dp(8));
        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
            width, height, overlayType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        );
        params.gravity = Gravity.TOP | Gravity.START;
        params.x = Math.max(dp(8), (screen.widthPixels - width) / 2);
        params.y = Math.max(dp(8), screen.heightPixels - dp(20) - height);
        try {
            windowManager.addView(target, params);
            bubbleRemoveTargetView = target;
            bubbleRemoveTargetParams = params;
            bubbleRemoveTargetHighlighted = false;
        } catch (Exception ignored) {
            bubbleRemoveTargetView = null;
            bubbleRemoveTargetParams = null;
        }
    }

    private void updateSimpleBubbleRemoveTargetHighlight() {
        if (bubbleRemoveTargetView == null || bubbleRemoveTargetParams == null
            || bubbleParams == null || bubbleView == null) return;
        int bubbleWidth = bubbleView.getWidth() > 0 ? bubbleView.getWidth() : dp(68);
        int bubbleHeight = bubbleView.getHeight() > 0 ? bubbleView.getHeight() : dp(32);
        boolean inside = GtoBubbleDismissPolicy.isDropInside(
            bubbleParams.x, bubbleParams.y, bubbleWidth, bubbleHeight,
            bubbleRemoveTargetParams.x, bubbleRemoveTargetParams.y,
            bubbleRemoveTargetParams.width, bubbleRemoveTargetParams.height
        );
        if (inside == bubbleRemoveTargetHighlighted) return;
        bubbleRemoveTargetHighlighted = inside;
        bubbleRemoveTargetView.setBackground(roundBackground(
            inside ? Color.rgb(177, 47, 55) : Color.rgb(92, 45, 48), 18
        ));
        bubbleRemoveTargetView.setText(inside ? "Solte para remover" : "Remover e parar NVU");
    }

    private boolean isSimpleBubbleDroppedOnRemoveTarget(long gestureGeneration) {
        if (bubbleRemoveTargetView == null || bubbleRemoveTargetParams == null
            || bubbleParams == null || bubbleView == null || !bubbleGestureActive
            || gestureGeneration == 0L || gestureGeneration != bubbleActiveGestureGeneration) return false;
        int bubbleWidth = bubbleView.getWidth() > 0 ? bubbleView.getWidth() : dp(68);
        int bubbleHeight = bubbleView.getHeight() > 0 ? bubbleView.getHeight() : dp(32);
        return GtoBubbleDismissPolicy.isDropInside(
            bubbleParams.x, bubbleParams.y, bubbleWidth, bubbleHeight,
            bubbleRemoveTargetParams.x, bubbleRemoveTargetParams.y,
            bubbleRemoveTargetParams.width, bubbleRemoveTargetParams.height
        );
    }

    private void hideSimpleBubbleRemoveTarget() {
        if (bubbleRemoveTargetView != null && windowManager != null) {
            try { windowManager.removeView(bubbleRemoveTargetView); } catch (Exception ignored) {}
        }
        bubbleRemoveTargetView = null;
        bubbleRemoveTargetParams = null;
        bubbleRemoveTargetHighlighted = false;
    }

    private void stopSimpleFromFloatingBubble(long gestureGeneration) {
        if (gestureGeneration == 0L) return;
        prefs.edit().putString("lastEvent", "Modo Pro encerrado pela bolha").apply();
        try {
            startService(new Intent(this, SimpleAutomationService.class).setAction(ACTION_STOP));
        } catch (Exception ignored) {
            removeOverlays();
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
        }
    }

    private DisplayMetrics realDisplayMetrics() {
        DisplayMetrics metrics = new DisplayMetrics();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && windowManager != null) {
                android.graphics.Rect bounds = windowManager.getMaximumWindowMetrics().getBounds();
                metrics.widthPixels = Math.max(1, bounds.width());
                metrics.heightPixels = Math.max(1, bounds.height());
                metrics.density = getResources().getDisplayMetrics().density;
                metrics.densityDpi = getResources().getConfiguration().densityDpi;
                return metrics;
            }
        } catch (Exception ignored) {}
        if (windowManager != null && windowManager.getDefaultDisplay() != null) {
            windowManager.getDefaultDisplay().getRealMetrics(metrics);
        } else {
            metrics.setTo(getResources().getDisplayMetrics());
        }
        return metrics;
    }

    private int safeTopInsetPx() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && windowManager != null) {
            try {
                WindowMetrics metrics = windowManager.getCurrentWindowMetrics();
                Insets insets = metrics.getWindowInsets().getInsetsIgnoringVisibility(
                    WindowInsets.Type.statusBars() | WindowInsets.Type.displayCutout()
                );
                return Math.max(0, insets.top);
            } catch (Exception ignored) {}
        }
        int id = getResources().getIdentifier("status_bar_height", "dimen", "android");
        return id > 0 ? Math.max(0, getResources().getDimensionPixelSize(id)) : 0;
    }

    private int safeBottomInsetPx() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && windowManager != null) {
            try {
                WindowMetrics metrics = windowManager.getCurrentWindowMetrics();
                Insets insets = metrics.getWindowInsets().getInsets(
                    WindowInsets.Type.navigationBars()
                        | WindowInsets.Type.displayCutout()
                        | WindowInsets.Type.ime()
                );
                return Math.max(0, insets.bottom);
            } catch (Exception ignored) {}
        }
        int id = getResources().getIdentifier("navigation_bar_height", "dimen", "android");
        return id > 0 ? Math.max(0, getResources().getDimensionPixelSize(id)) : 0;
    }

    private int bubbleSafeMaxX(DisplayMetrics metrics, int bubbleWidth) {
        if (metrics == null) return dp(8);
        return Math.max(dp(8), metrics.widthPixels - dp(8) - Math.max(0, bubbleWidth));
    }

    private int bubbleSafeMaxY(DisplayMetrics metrics, int bubbleHeight) {
        if (metrics == null) return safeTopInsetPx() + dp(8);
        int safeTop = safeTopInsetPx() + dp(8);
        int safeBottom = safeBottomInsetPx() + dp(8);
        return Math.max(safeTop, metrics.heightPixels - safeBottom - Math.max(0, bubbleHeight));
    }

    private android.content.SharedPreferences maxOverlayPreferences() {
        return getSharedPreferences("nvu_gto_observer", MODE_PRIVATE);
    }

    private boolean hasExplicitProBubblePosition() {
        return prefs != null && (prefs.contains("bubbleProXNorm") && prefs.contains("bubbleProYNorm"));
    }

    private void applyInitialProBubblePosition(DisplayMetrics metrics, int bubbleWidth, int bubbleHeight) {
        int safeLeft = dp(8);
        int safeTop = safeTopInsetPx() + dp(8);
        int maxX = bubbleSafeMaxX(metrics, bubbleWidth);
        int maxY = bubbleSafeMaxY(metrics, bubbleHeight);
        int x = prefs.getInt("bubbleX", dp(18));
        int y = prefs.getInt("bubbleY", dp(180));
        boolean normalized = hasExplicitProBubblePosition();
        if (!normalized) {
            android.content.SharedPreferences maxPrefs = maxOverlayPreferences();
            if (maxPrefs.contains("bubbleGtoXNorm") && maxPrefs.contains("bubbleGtoYNorm")) {
                x = GtoOverlayLayoutPolicy.positionFromNormalized(
                    maxPrefs.getInt("bubbleGtoXNorm", 0), safeLeft, maxX, BUBBLE_POSITION_SCALE
                );
                y = GtoOverlayLayoutPolicy.positionFromNormalized(
                    maxPrefs.getInt("bubbleGtoYNorm", 0), safeTop, maxY, BUBBLE_POSITION_SCALE
                );
            }
        } else {
            x = GtoOverlayLayoutPolicy.positionFromNormalized(
                prefs.getInt("bubbleProXNorm", 0), safeLeft, maxX, BUBBLE_POSITION_SCALE
            );
            y = GtoOverlayLayoutPolicy.positionFromNormalized(
                prefs.getInt("bubbleProYNorm", 0), safeTop, maxY, BUBBLE_POSITION_SCALE
            );
        }
        bubbleParams.x = Math.max(safeLeft, Math.min(maxX, x));
        bubbleParams.y = Math.max(safeTop, Math.min(maxY, y));
    }

    private void persistPreferredProBubblePosition(DisplayMetrics metrics, int bubbleWidth, int bubbleHeight) {
        if (prefs == null || bubbleParams == null || metrics == null) return;
        int safeLeft = dp(8);
        int safeTop = safeTopInsetPx() + dp(8);
        int maxX = bubbleSafeMaxX(metrics, bubbleWidth);
        int maxY = bubbleSafeMaxY(metrics, bubbleHeight);
        prefs.edit()
            .putInt("bubbleX", bubbleParams.x)
            .putInt("bubbleY", bubbleParams.y)
            .putInt("bubbleProXNorm", GtoOverlayLayoutPolicy.normalizedPosition(
                bubbleParams.x, safeLeft, maxX, BUBBLE_POSITION_SCALE
            ))
            .putInt("bubbleProYNorm", GtoOverlayLayoutPolicy.normalizedPosition(
                bubbleParams.y, safeTop, maxY, BUBBLE_POSITION_SCALE
            ))
            .putLong("bubblePositionSavedAt", System.currentTimeMillis())
            .apply();
    }

    private void rebaseProBubbleLayoutForCurrentDisplay(boolean restorePreferred, String reason) {
        if (bubbleView == null || bubbleParams == null || windowManager == null) return;
        DisplayMetrics metrics = realDisplayMetrics();
        int bubbleWidth = bubbleView.getWidth() > 0 ? bubbleView.getWidth() : dp(68);
        int bubbleHeight = bubbleView.getHeight() > 0 ? bubbleView.getHeight() : dp(32);
        int safeLeft = dp(8);
        int safeTop = safeTopInsetPx() + dp(8);
        int maxX = bubbleSafeMaxX(metrics, bubbleWidth);
        int maxY = bubbleSafeMaxY(metrics, bubbleHeight);
        int targetX = bubbleParams.x;
        int targetY = bubbleParams.y;
        if (restorePreferred && hasExplicitProBubblePosition()) {
            targetX = GtoOverlayLayoutPolicy.positionFromNormalized(
                prefs.getInt("bubbleProXNorm", 0), safeLeft, maxX, BUBBLE_POSITION_SCALE
            );
            targetY = GtoOverlayLayoutPolicy.positionFromNormalized(
                prefs.getInt("bubbleProYNorm", 0), safeTop, maxY, BUBBLE_POSITION_SCALE
            );
        }
        targetX = Math.max(safeLeft, Math.min(maxX, targetX));
        targetY = Math.max(safeTop, Math.min(maxY, targetY));
        boolean changed = targetX != bubbleParams.x || targetY != bubbleParams.y
            || bubbleLayoutDisplayWidth != metrics.widthPixels
            || bubbleLayoutDisplayHeight != metrics.heightPixels;
        bubbleParams.x = targetX;
        bubbleParams.y = targetY;
        bubbleLayoutDisplayWidth = metrics.widthPixels;
        bubbleLayoutDisplayHeight = metrics.heightPixels;
        if (changed) {
            try { windowManager.updateViewLayout(bubbleView, bubbleParams); } catch (Exception ignored) {}
        }
        if (menuView != null && menuParams != null && menuView.isAttachedToWindow()) {
            mainHandler.post(this::adjustProMenuLayoutAfterMeasure);
        }
    }

    private void applyBubbleCardVisibility(boolean suppressed) {
        boolean visible = !suppressed && !destroying && ProModeController.hasOverlay(this)
            && isProBubbleOrientationAllowed() && !isCaptureConsentSurfaceActive();
        if (suppressed) {
            cancelSimpleBubbleGesture("CARD_VISIBILITY", false);
            hideSimpleBubbleRemoveTarget();
        }
        bubbleCardVisibility.apply(bubbleView, bubbleParams, windowManager, visible);
        if (prefs != null && prefs.getBoolean("bubbleTemporarilyHiddenByCard", false) != suppressed) {
            prefs.edit().putBoolean("bubbleTemporarilyHiddenByCard", suppressed).apply();
        }
    }

    private void adjustProMenuLayoutAfterMeasure() {
        if (menuView == null || menuParams == null || windowManager == null || !menuView.isAttachedToWindow()) return;
        DisplayMetrics screen = realDisplayMetrics();
        int[] horizontal = NativeTripReceiptCardView.safeHorizontalInsets(windowManager);
        int safeLeft = horizontal[0] + dp(8);
        int safeRight = Math.max(safeLeft, screen.widthPixels - horizontal[1] - dp(8));
        int width = Math.max(1, Math.min(dp(256), safeRight - safeLeft));
        int height = menuView.getHeight() > 0 ? menuView.getHeight() : dp(220);
        int safeTop = safeTopInsetPx() + dp(8);
        int safeBottom = screen.heightPixels - safeBottomInsetPx() - dp(8);
        int bubbleX = bubbleParams != null ? bubbleParams.x : safeLeft;
        int bubbleY = bubbleParams != null ? bubbleParams.y : safeTop;
        int bubbleWidth = bubbleParams != null ? bubbleParams.width : dp(68);
        int bubbleHeight = bubbleParams != null ? bubbleParams.height : dp(32);
        int x = Math.max(safeLeft, Math.min(safeRight - width, bubbleX + bubbleWidth / 2 - width / 2));
        int y = GtoOverlayLayoutPolicy.centeredMenuYBesideBubble(bubbleY, bubbleHeight, height, safeTop, safeBottom);
        menuBaseY = y;
        if (statusChipView != null && statusChipParams != null) {
            int bottom = statusChipParams.y + Math.max(statusChipView.getHeight(), dp(PRO_MESSAGE_MIN_BAND_DP));
            y = GtoOverlayLayoutPolicy.clampMenuY(Math.max(y, bottom + dp(8)), height, safeTop, safeBottom);
        }
        if (menuParams.width != width || menuParams.x != x || menuParams.y != y) {
            menuParams.width = width; menuParams.x = x; menuParams.y = y;
            try { windowManager.updateViewLayout(menuView, menuParams); } catch (RuntimeException ignored) {}
        }
    }

    private void showStatusChip(String text, long durationMs) {
        showStatusChip(text, durationMs, false);
    }

    private void showRegisteredTripCard(NativeTripReceipt receipt, long durationMs) {
        if (receipt == null) {
            showStatusChip("Viagem registrada.", durationMs);
            return;
        }
        if (prefs == null || !receipt.belongsTo(prefs.getString("driverId", ""))) return;
        showStatusChip("", durationMs, false, receipt);
    }

    private void showStatusChip(String text, long durationMs, boolean allowDuringCaptureHidden) {
        showStatusChip(text, durationMs, allowDuringCaptureHidden, null);
    }

    private void showStatusChip(String text, long durationMs, boolean allowDuringCaptureHidden, NativeTripReceipt receipt) {
        showStatusChip(text, durationMs, allowDuringCaptureHidden, receipt, null);
    }

    private void showRouteReadyMessage() {
        NativeRouteReadySnapshot ready = NativeRouteReadySnapshot.capture(prefs);
        if (ready != null) showStatusChip(NativeRouteReadySnapshot.MESSAGE, 2600L, false, null, ready);
    }

    private void showStatusChip(String text, long durationMs, boolean allowDuringCaptureHidden,
        NativeTripReceipt receipt, NativeRouteReadySnapshot ready) {
        if (mainHandler == null || destroying) return;
        mainHandler.post(() -> {
            if (destroying || !isProBubbleOrientationAllowed()) return;
            if (prefs != null && prefs.getBoolean("captureUiHidden", false) && !allowDuringCaptureHidden) return;
            if (ready != null && !ready.isCurrent(prefs)) return;
            if (receipt != null && (!receipt.belongsTo(prefs.getString("driverId", ""))
                || !receipt.companyId.equals(prefs.getString("companyId", ""))
                || !receipt.jobId.equals(prefs.getString("jobId", "")))) return;
            if (statusChipView instanceof NativeTripReceiptCardView) {
                NativeTripReceipt visibleReceipt = ((NativeTripReceiptCardView) statusChipView).receipt;
                if (receipt != null && receipt.sameConfirmation(visibleReceipt)) return;
                if (ready == null && visibleReceipt.state == NativeTripReceipt.State.CONFIRMED && (receipt == null
                    || (receipt.state != NativeTripReceipt.State.CONFIRMED
                        && receipt.sessionId.equals(visibleReceipt.sessionId)))) return;
            }
            if (windowManager == null || !ProModeController.hasOverlay(this)) return;
            View chip;
            if (receipt != null) {
                chip = new NativeTripReceiptCardView(this, receipt);
            } else {
                TextView message = new TextView(this);
                message.setText(text == null ? "" : text);
                message.setTextColor(Color.WHITE);
                message.setTextSize(11f);
                message.setGravity(Gravity.CENTER_VERTICAL);
                message.setPadding(dp(12), dp(8), dp(12), dp(8));
                message.setMaxLines(2);
                message.setBackground(roundBackground(Color.rgb(31, 36, 43), 12));
                message.setElevation(dp(7));
                chip = message;
            }
            WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
                overlayType(), WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                    | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                    | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT);
            params.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
            params.y = safeTopInsetPx() + dp(8);
            params.x = 0;
            if (receipt != null) {
                int[] horizontal = NativeTripReceiptCardView.safeHorizontalInsets(windowManager);
                NativeTripReceiptCardView.position(this, chip, params, realDisplayMetrics(),
                    horizontal[0] + dp(8), safeTopInsetPx() + dp(8),
                    horizontal[1] + dp(8), safeBottomInsetPx() + dp(8));
            } else NativeTripReceiptCardView.applyPassThroughOpacity(this, params);
            if (!cardVisibility.acquire(chip)) return;
            // Acquire the replacement first: releasing an old card cannot flash NVU.
            boolean restoreMenuOnFailure = ready != null && menuView != null;
            hideStatusChip();
            if (receipt != null || ready != null) closeMenu();
            try {
                windowManager.addView(chip, params);
                statusChipView = chip;
                statusChipParams = params;
                statusChipRouteReady = ready;
                if (ready != null) {
                    selectedInitial = "";
                    summaryExpanded = false;
                    historyExpanded = false;
                }
                adjustProMenuLayoutAfterMeasure();
                chip.addOnLayoutChangeListener((v,l,t,r,b,ol,ot,or,ob) -> positionProReceiptCard());
                chip.post(this::positionProReceiptCard);
                final View shown = chip;
                statusChipHideRunnable = () -> {
                    if (statusChipView == shown) hideStatusChip();
                };
                mainHandler.postDelayed(statusChipHideRunnable, Math.max(5000L, durationMs));
            } catch (RuntimeException error) {
                // Keep the transition lease until a replacement menu is attached.
                if (restoreMenuOnFailure && !destroying) openMenu();
                cardVisibility.release(chip);
                recordOverlayDiagnostic("card_add_failed", error);
            }
        });
    }

    private void positionProReceiptCard() {
        if (!(statusChipView instanceof NativeTripReceiptCardView) || statusChipParams == null
            || windowManager == null || !statusChipView.isAttachedToWindow()) return;
        int width = statusChipParams.width, x = statusChipParams.x, y = statusChipParams.y;
        int[] horizontal = NativeTripReceiptCardView.safeHorizontalInsets(windowManager);
        NativeTripReceiptCardView.position(this, statusChipView, statusChipParams, realDisplayMetrics(),
            horizontal[0] + dp(8), safeTopInsetPx() + dp(8), horizontal[1] + dp(8), safeBottomInsetPx() + dp(8));
        if (width != statusChipParams.width || x != statusChipParams.x || y != statusChipParams.y) {
            try { windowManager.updateViewLayout(statusChipView, statusChipParams); } catch (RuntimeException ignored) {}
        }
    }

    private void hideStatusChip() {
        if (mainHandler != null && statusChipHideRunnable != null) mainHandler.removeCallbacks(statusChipHideRunnable);
        statusChipHideRunnable = null;
        View previous = statusChipView;
        if (previous != null && windowManager != null) {
            try { windowManager.removeView(previous); } catch (RuntimeException ignored) {}
        }
        statusChipView = null;
        statusChipParams = null;
        statusChipRouteReady = null;
        cardVisibility.release(previous);
        restoreMenuAfterStatusChip();
        adjustProMenuLayoutAfterMeasure();
    }

    private void moveMenuAwayFromStatusChip() {
        if (menuView == null || menuParams == null || windowManager == null) return;
        int minimumY = statusChipParams == null ? dp(100)
            : statusChipParams.y + (statusChipView != null && statusChipView.getHeight() > 0
                ? statusChipView.getHeight() : dp(PRO_MESSAGE_MIN_BAND_DP)) + dp(12);
        int desiredY = Math.max(menuBaseY, minimumY);
        if (menuParams.y >= desiredY) return;
        menuParams.y = desiredY;
        try { windowManager.updateViewLayout(menuView, menuParams); } catch (Exception ignored) {}
    }

    private void restoreMenuAfterStatusChip() {
        if (menuView == null || menuParams == null || windowManager == null) return;
        if (menuParams.y == menuBaseY) return;
        menuParams.y = menuBaseY;
        try { windowManager.updateViewLayout(menuView, menuParams); } catch (Exception ignored) {}
    }

    private void toggleMenu() {
        if (isCaptureConsentSurfaceActive()) {
            showStatusChip("Autorização de captura em andamento…", 1800L, true);
            return;
        }
        if (menuView != null) {
            closeMenu();
        } else {
            // A short tap on the NVU pill always opens the Pro home card. The
            // operation summary is entered only through its explicit action.
            summaryExpanded = false;
            historyExpanded = false;
            openMenu();
        }
    }

    private void openMenu() {
        if (isCaptureConsentSurfaceActive()) return;
        if (statusChipRouteReady != null && statusChipRouteReady.isCurrent(prefs)) return;
        if (windowManager == null || menuView != null) return;
        menuView = new NativeCompactMenuView(this);
        final LinearLayout openedMenu = menuView;
        String menuState = prefs.getString("simpleState", DEFAULT_STATE);
        final boolean routeSelector = STATE_ROUTE_ORIGIN.equals(menuState) || STATE_ROUTE_DESTINATION.equals(menuState);
        ScrollView scroll = new NativeCompactMenuScrollView(this, () -> {
            int footer = routeSelector ? NativeCompactMenuView.controlExtent(this, 31) + dp(5) : 0;
            int available = realDisplayMetrics().heightPixels - safeTopInsetPx() - safeBottomInsetPx()
                - dp(32) - footer;
            return routeSelector ? Math.min(dp(280), available) : available;
        });
        scroll.setFillViewport(false);
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        scroll.addView(content, new ScrollView.LayoutParams(-1, -2));
        int availableMenuHeight = realDisplayMetrics().heightPixels - safeTopInsetPx() - safeBottomInsetPx() - dp(16);
        int routeFooterHeight = NativeCompactMenuView.controlExtent(this, 31) + dp(5);
        int routeBodyHeight = Math.max(dp(88), Math.min(dp(280), availableMenuHeight - dp(20) - routeFooterHeight));
        LinearLayout.LayoutParams scrollParams = new LinearLayout.LayoutParams(-1, routeSelector ? routeBodyHeight : -2);
        menuView.addView(scroll, scrollParams);
        populateMenuContents(content);
        if (routeSelector) {
            Button fixedBack = menuButton("Voltar");
            fixedBack.setOnClickListener(v -> {
                prefs.edit()
                    .putString("simpleState", STATE_IDLE)
                    .remove("origin")
                    .remove("destination")
                    .apply();
                selectedInitial = "";
                summaryExpanded = false;
                refreshMenuContents();
            });
            menuView.addView(fixedBack, fullParams(dp(5), 0));
        }
        menuParams = new WindowManager.LayoutParams(
            dp(256), WindowManager.LayoutParams.WRAP_CONTENT, overlayType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                | WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH
                | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        );
        menuParams.gravity = Gravity.TOP | Gravity.START;
        DisplayMetrics screen = realDisplayMetrics();
        int gap = dp(8);
        int safeLeft = dp(8);
        int safeRight = Math.max(safeLeft, screen.widthPixels - dp(8));
        int safeTop = safeTopInsetPx() + dp(8);
        int safeBottom = Math.max(safeTop, screen.heightPixels - safeBottomInsetPx() - dp(8));
        int menuWidth = Math.max(1, Math.min(dp(256), safeRight - safeLeft));
        int bubbleWidth = bubbleView != null && bubbleView.getWidth() > 0 ? bubbleView.getWidth() : dp(68);
        int bubbleHeight = bubbleView != null && bubbleView.getHeight() > 0 ? bubbleView.getHeight() : dp(32);
        int bubbleX = bubbleParams == null ? safeLeft : bubbleParams.x;
        int bubbleY = bubbleParams == null ? safeTop + dp(140) : bubbleParams.y;
        menuParams.width = menuWidth;
        menuParams.x = Math.max(safeLeft, Math.min(safeRight - menuWidth, bubbleX + bubbleWidth / 2 - menuWidth / 2));
        menuParams.y = GtoOverlayLayoutPolicy.centeredMenuYBesideBubble(
            bubbleY, bubbleHeight, dp(220), safeTop, safeBottom);
        menuBaseY = menuParams.y;
        menuView.addOnLayoutChangeListener((view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
            if (right - left != oldRight - oldLeft || bottom - top != oldBottom - oldTop) {
                mainHandler.post(this::adjustProMenuLayoutAfterMeasure);
            }
        });
        NativeCompactMenuView.bindOutsideDismiss(openedMenu, () -> menuView == openedMenu, this::closeMenu);
        try {
            if (!cardVisibility.acquire(menuView)) { menuView = null; return; }
            windowManager.addView(menuView, menuParams);
            menuView.post(this::adjustProMenuLayoutAfterMeasure);
        } catch (Exception error) {
            closeMenu();
        }
    }

    private void refreshMenuContents() {
        if (isCaptureConsentSurfaceActive()) {
            closeMenu();
            hideSimpleBubbleRemoveTarget();
            return;
        }
        if (menuView == null) return;
        Object refreshLease = new Object();
        if (!cardVisibility.acquire(refreshLease)) return;
        try { closeMenu(); openMenu(); }
        finally { cardVisibility.release(refreshLease); }
    }

    private void populateMenuContents(LinearLayout target) {
        String state = prefs.getString("simpleState", DEFAULT_STATE);
        String company = safe(prefs.getString("companyName", ""));
        if (company.isEmpty()) company = "Empresa";

        if (summaryExpanded) {
            target.addView(label(company, 14f, true), fullParams(0, dp(1)));
            target.addView(label("Operação atual", 10f, false), fullParams(0, dp(2)));
            target.addView(label(operationSummary(), 11f, false), fullParams(0, dp(5)));
            Button back = menuButton("Voltar");
            back.setOnClickListener(v -> { summaryExpanded = false; refreshMenuContents(); });
            target.addView(back, fullParams(dp(4), 0));
            return;
        }

        target.addView(label(company, 14f, true), fullParams(0, dp(1)));
        target.addView(label("Sistema inteligente de automação pro", 10.5f, false), fullParams(0, dp(5)));

        int awaiting = pendingTripCountForCurrentScope();
        if (awaiting > 0) {
            target.addView(label(awaiting + (awaiting == 1
                ? " viagem aguardando envio automático"
                : " viagens aguardando envio automático"), 10.5f, true), fullParams(0, dp(4)));
        }

        if (!safe(prefs.getString("jobId", "")).isEmpty()) {
            LinearLayout historyRow = new LinearLayout(this);
            historyRow.setOrientation(LinearLayout.HORIZONTAL);
            historyRow.setGravity(Gravity.CENTER_VERTICAL);
            TextView historyLabel = label(historyExpanded ? "Viagens realizadas" : "Histórico da operação", 10.5f, false);
            historyRow.addView(historyLabel, new LinearLayout.LayoutParams(0, -2, 1f));
            Button historyButton = historyMenuButton();
            historyButton.setOnClickListener(v -> {
                historyExpanded = true;
                summaryExpanded = false;
                refreshMenuContents();
            });
            int historySize = NativeCompactMenuView.controlExtent(this, 30);
            historyRow.addView(historyButton, new LinearLayout.LayoutParams(historySize, historySize));
            target.addView(historyRow, fullParams(0, dp(5)));
        }

        if (historyExpanded) {
            addHistoryContents(target);
            return;
        }

        if (STATE_ROUTE_ORIGIN.equals(state)) {
            target.addView(label("Selecione a cidade de origem", 11f, false), fullParams(0, dp(5)));
            addCityPicker(target, true);
        } else if (STATE_ROUTE_DESTINATION.equals(state)) {
            target.addView(label("Origem: " + prefs.getString("origin", "") + "\nSelecione o destino", 11f, false), fullParams(0, dp(5)));
            addCityPicker(target, false);
            Button cancel = menuButton("Cancelar");
            cancel.setOnClickListener(v -> cancelTrip(this));
            target.addView(cancel, fullParams(dp(4), 0));
        } else if (STATE_TRIP_ACTIVE.equals(state)) {
            String origin = prefs.getString("origin", "");
            String destination = prefs.getString("destination", "");
            LinearLayout tripHeader = new LinearLayout(this);
            tripHeader.setOrientation(LinearLayout.HORIZONTAL);
            tripHeader.setGravity(Gravity.CENTER_VERTICAL);
            TextView tripLabel = label("Viagem em andamento\n" + origin + " → " + destination, 11.5f, true);
            tripHeader.addView(tripLabel, new LinearLayout.LayoutParams(0, -2, 1f));
            Button operationInfo = infoMenuButton();
            operationInfo.setOnClickListener(v -> { summaryExpanded = true; refreshMenuContents(); });
            int infoSize = NativeCompactMenuView.controlExtent(this, 30);
            tripHeader.addView(operationInfo, new LinearLayout.LayoutParams(infoSize, infoSize));
            target.addView(tripHeader, fullParams(0, dp(5)));
            addActionRow(target, "Cancelar", v -> cancelTrip(this), "Finalizar", v -> requestReceiptCapture(this));
            return;
        } else if (STATE_CAPTURE_PENDING.equals(state)) {
            target.addView(label("Captura preparada. O valor só será lançado após validação sem ADS/bônus.", 11f, false), fullParams(0, dp(6)));
            Button cancel = menuButton("Cancelar");
            cancel.setOnClickListener(v -> cancelTrip(this));
            target.addView(cancel, fullParams(dp(4), 0));
        } else if ("CAPTURE_CAPTURED".equals(state)) {
            target.addView(label("Recebimento capturado. Validando a viagem.", 11f, false), fullParams(0, dp(6)));
            Button cancel = menuButton("Descartar");
            cancel.setOnClickListener(v -> cancelTrip(this));
            target.addView(cancel, fullParams(dp(4), 0));
        } else if ("CAPTURE_ERROR".equals(state)) {
            target.addView(label(prefs.getString("lastEvent", "Abra a tela correta de conclusão"), 11f, false), fullParams(0, dp(6)));
            Button retry = menuButton("Tentar novamente");
            retry.setOnClickListener(v -> retryReceiptCapture(this));
            target.addView(retry, fullParams(dp(4), 0));
            Button cancel = menuButton("Cancelar");
            cancel.setOnClickListener(v -> cancelTrip(this));
            target.addView(cancel, fullParams(dp(4), 0));
        } else {
            if (prefs.getBoolean("operationClosed", false)) {
                target.addView(label(closedOperationMessage(prefs.getString("jobStatus", "")), 11f, false), fullParams(0, dp(5)));
                Button summary = menuButton("Operação atual");
                summary.setOnClickListener(v -> { summaryExpanded = true; refreshMenuContents(); });
                target.addView(summary, fullParams(dp(4), 0));
                return;
            }
            if (STATE_CANCELLED.equals(state)) target.addView(label("Viagem Pro cancelada.", 11f, false), fullParams(0, dp(3)));
            addActionRow(target, "Iniciar viagem", v -> {
                int totalSlots = Math.max(0, prefs.getInt("jobTotalDeliveries", 0));
                if (totalSlots > 0
                    && Math.max(0, prefs.getInt("confirmedTripCount", 0)) + pendingTripCountForCurrentScope() >= totalSlots) {
                    showStatusChip("Todas as vagas da operação estão confirmadas ou aguardando envio.", 6500L);
                    return;
                }
                prefs.edit().putString("simpleState", STATE_ROUTE_ORIGIN).remove("origin").remove("destination").apply();
                selectedInitial = "";
                refreshMenuContents();
            }, "Operação atual", v -> { summaryExpanded = true; refreshMenuContents(); });
        }

    }

    private void addBackToHomeButton(LinearLayout target) {
        Button back = menuButton("Voltar");
        back.setOnClickListener(v -> {
            prefs.edit()
                .putString("simpleState", STATE_IDLE)
                .remove("origin")
                .remove("destination")
                .apply();
            selectedInitial = "";
            summaryExpanded = false;
            refreshMenuContents();
        });
        target.addView(back, fullParams(dp(4), 0));
    }

    private void addActionRow(LinearLayout target, String leftText, View.OnClickListener leftAction, String rightText, View.OnClickListener rightAction) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        Button left = compactMenuButton(leftText);
        left.setOnClickListener(leftAction);
        int actionHeight = NativeCompactMenuView.controlExtent(this, 28);
        left.setLayoutParams(new LinearLayout.LayoutParams(0, actionHeight, 1f));
        Button right = compactMenuButton(rightText);
        right.setOnClickListener(rightAction);
        LinearLayout.LayoutParams rightParams = new LinearLayout.LayoutParams(0, actionHeight, 1f);
        rightParams.leftMargin = dp(5);
        right.setLayoutParams(rightParams);
        row.addView(left);
        row.addView(right);
        target.addView(row, fullParams(dp(3), 0));
    }

    private void addCityPicker(LinearLayout target, boolean origin) {
        List<String> cities = readCities();
        Set<String> initials = new LinkedHashSet<>();
        for (String city : cities) initials.add(initialOf(city));
        if (initials.isEmpty()) {
            target.addView(label("Nenhuma cidade cadastrada para este simulador.", 10.5f, false), fullParams(0, dp(8)));
            return;
        }
        if (selectedInitial.isEmpty() || !initials.contains(selectedInitial)) selectedInitial = initials.iterator().next();
        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.HORIZONTAL);
        body.setGravity(Gravity.TOP);
        LinearLayout letterColumn = new LinearLayout(this);
        letterColumn.setOrientation(LinearLayout.VERTICAL);
        letterColumn.setGravity(Gravity.CENTER_HORIZONTAL);
        for (String initial : initials) {
            Button letter = miniButton(initial);
            letter.setOnClickListener(v -> { selectedInitial = initial; refreshMenuContents(); });
            letter.setGravity(Gravity.CENTER);
            LinearLayout.LayoutParams letterParams = new LinearLayout.LayoutParams(
                NativeCompactMenuView.controlExtent(this, 28), NativeCompactMenuView.controlExtent(this, 26));
            letterParams.topMargin = dp(2);
            letterParams.bottomMargin = dp(2);
            letterColumn.addView(letter, letterParams);
        }
        body.addView(letterColumn, new LinearLayout.LayoutParams(NativeCompactMenuView.controlExtent(this, 42), -2));
        LinearLayout cityColumn = new LinearLayout(this);
        cityColumn.setOrientation(LinearLayout.VERTICAL);
        cityColumn.setPadding(dp(4), 0, 0, 0);
        for (String city : cities) {
            if (!selectedInitial.equals(initialOf(city))) continue;
            boolean activeCity = city.equalsIgnoreCase(prefs.getString(origin ? "origin" : "destination", ""));
            Button option = cityButton(city, activeCity);
            option.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
            option.setPadding(dp(10), 0, dp(8), 0);
            option.setMinHeight(NativeCompactMenuView.controlExtent(this, 30));
            option.setMinimumHeight(NativeCompactMenuView.controlExtent(this, 30));
            option.setOnClickListener(v -> {
                if (origin) {
                    prefs.edit().putString("origin", city).putString("simpleState", STATE_ROUTE_DESTINATION).apply();
                    selectedInitial = "";
                } else {
                    String selectedOrigin = prefs.getString("origin", "");
                    if (safe(selectedOrigin).isEmpty() || safe(city).isEmpty() || city.equalsIgnoreCase(selectedOrigin)) {
                        showStatus("Origem e destino devem ser diferentes.");
                        return;
                    }
                    long tripStartedAt = System.currentTimeMillis();
                    prefs.edit()
                        .putString("destination", city)
                        .putString("simpleState", STATE_TRIP_ACTIVE)
                        .putLong("tripStartedAt", tripStartedAt)
                        .putString("captureStage", "TRIP_ACTIVE")
                        .apply();
                    emitSimpleReadyVoice(tripStartedAt);
                    showRouteReadyMessage();
                    return; // Confirmation owns the next surface; do not rebuild the menu.
                }
                refreshMenuContents();
            });
            cityColumn.addView(option, fullParams(dp(2), dp(2)));
        }
        LinearLayout.LayoutParams cityColumnParams = new LinearLayout.LayoutParams(0, -2, 1f);
        cityColumnParams.leftMargin = dp(3);
        body.addView(cityColumn, cityColumnParams);
        target.addView(body, fullParams(0, dp(4)));
    }

    private List<String> readCities() {
        List<String> cities = new ArrayList<>();
        String json = prefs.getString("citiesJson", "[]");
        try {
            JSONArray array = new JSONArray(json);
            for (int index = 0; index < array.length(); index++) {
                String value = array.optString(index, "").trim();
                if (!value.isEmpty()) cities.add(value);
            }
        } catch (JSONException ignored) {}
        Collections.sort(cities, (left, right) -> left.compareToIgnoreCase(right));
        return cities;
    }

    private String operationSummary() {
        String state = prefs.getString("simpleState", DEFAULT_STATE);
        String company = safe(prefs.getString("companyName", ""));
        String origin = prefs.getString("origin", "").trim();
        String destination = prefs.getString("destination", "").trim();
        String operation = safe(prefs.getString("operationName", ""));
        if (operation.isEmpty()) operation = safe(prefs.getString("contractName", ""));
        if (operation.isEmpty()) operation = "Operação Pro";
        if (!operation.toLowerCase(Locale.ROOT).startsWith("operação")
            && !operation.toLowerCase(Locale.ROOT).startsWith("operacao")) {
            operation = "Operação " + operation;
        }
        int confirmedProgress = Math.max(0,
            prefs.getInt("confirmedTripCount", 0));
        int awaiting = pendingTripCountForCurrentScope();
        int progress = confirmedProgress;
        int total = Math.max(0, prefs.getInt("jobTotalDeliveries", 0));
        String trips = total > 0
            ? String.format(Locale.ROOT, total >= 10 ? "%02d/%02d" : "%d/%d", Math.min(progress, total), total)
            : "—";
        String vehicle = safe(prefs.getString("vehicleName", ""));
        String trailer = safe(prefs.getString("trailerName", ""));
        int percentage = total > 0 ? Math.min(100, Math.max(0, Math.round((progress * 100f) / total))) : -1;
        StringBuilder summary = new StringBuilder(operation)
            .append("\nViagens ").append(trips)
            .append("\nVeículo ").append(vehicle.isEmpty() ? "—" : vehicle);
        String simulator = safe(prefs.getString("simulatorKey", ""));
        boolean trailerless = simulator.equalsIgnoreCase("wbds") || simulator.equalsIgnoreCase("pbs");
        if (!trailerless) summary.append("\nReboque ").append(trailer.isEmpty() ? "—" : trailer);
        summary.append("\nProgresso ").append(percentage >= 0 ? percentage + "%" : "—");
        if (awaiting > 0) summary.append("\nConfirmadas ").append(confirmedProgress)
            .append(" · aguardando envio ").append(awaiting);
        if (prefs.getBoolean("operationClosed", false)) {
            summary.append("\nOPERAÇÃO ENCERRADA");
        }
        return summary.toString();
    }

    private void emitSimpleReadyVoice(long routeEventId) {
        if (audioManager != null) audioManager.playReadyVoice("simple-ready:" + routeEventId);
    }

    private void emitSimpleTripCompletedVoice(String eventId) {
        if (audioManager != null) audioManager.playTripCompletedVoice(eventId);
    }

    private void showStatus(String message) {
        prefs.edit().putString("lastEvent", message).apply();
        showStatusChip(message, 2600L);
    }

    private GradientDrawable makeNvuBubbleBackground(boolean active) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(active
            ? Color.argb(225, 48, 55, 62)
            : Color.argb(218, 43, 47, 54));
        drawable.setCornerRadius(dp(8));
        drawable.setStroke(dp(1), active
            ? Color.argb(220, 129, 198, 188)
            : Color.argb(170, 125, 132, 142));
        return drawable;
    }

    private Button menuButton(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextColor(Color.WHITE);
        button.setAllCaps(false);
        button.setTextSize(11.5f);
        button.setTextColor(Color.rgb(248, 250, 252));
        button.setTypeface(button.getTypeface(), android.graphics.Typeface.BOLD);
        button.setIncludeFontPadding(false);
        button.setMinHeight(NativeCompactMenuView.controlExtent(this, 31));
        button.setMinimumHeight(NativeCompactMenuView.controlExtent(this, 31));
        button.setMinWidth(0);
        button.setGravity(Gravity.CENTER);
        button.setPadding(dp(7), 0, dp(7), 0);
        button.setBackground(roundBackground(Color.argb(176, 62, 69, 79), 9));
        button.setLayoutParams(new LinearLayout.LayoutParams(-1, NativeCompactMenuView.controlExtent(this, 31)));
        button.setOnTouchListener((view, event) -> {
            int action = event == null ? MotionEvent.ACTION_CANCEL : event.getActionMasked();
            if (action == MotionEvent.ACTION_DOWN) {
                view.animate().scaleX(0.96f).scaleY(0.96f).alpha(0.76f).setDuration(110L).start();
            } else if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) {
                view.animate().scaleX(1f).scaleY(1f).alpha(1f).setDuration(170L).start();
            }
            return false;
        });
        return button;
    }

    private Button miniButton(String text) {
        Button button = menuButton(text);
        button.setTextSize(10f);
        button.setMinWidth(NativeCompactMenuView.controlExtent(this, 30));
        button.setMinimumWidth(NativeCompactMenuView.controlExtent(this, 30));
        button.setMinHeight(NativeCompactMenuView.controlExtent(this, 28));
        button.setMinimumHeight(NativeCompactMenuView.controlExtent(this, 28));
        button.setPadding(dp(2), 0, dp(2), 0);
        return button;
    }

    private Button cityButton(String text, boolean active) {
        Button button = miniButton(text);
        button.setBackground(roundBackground(
            active ? Color.rgb(234, 88, 12) : Color.argb(176, 62, 69, 79),
            9
        ));
        button.setTextColor(active ? Color.WHITE : Color.rgb(248, 250, 252));
        button.setTransitionName(active ? "pro-city-selected" : "pro-city-option");
        button.post(() -> {
            button.setAlpha(0.88f);
            button.animate().alpha(1f).setDuration(180L).start();
        });
        return button;
    }

    private Button compactMenuButton(String text) {
        Button button = menuButton(text);
        button.setTextSize(10.5f);
        button.setPadding(dp(12), 0, dp(12), 0);
        button.setLayoutParams(new LinearLayout.LayoutParams(-2, NativeCompactMenuView.controlExtent(this, 28)));
        return button;
    }

    private Button infoMenuButton() {
        Button button = miniButton("ⓘ");
        button.setTextSize(16f);
        button.setContentDescription("Abrir operação atual");
        button.setPadding(0, 0, 0, 0);
        int size = NativeCompactMenuView.controlExtent(this, 30);
        button.setLayoutParams(new LinearLayout.LayoutParams(size, size));
        return button;
    }

    private Button historyMenuButton() {
        Button button = miniButton("☷");
        button.setTextSize(16f);
        button.setContentDescription("Abrir histórico de viagens da operação atual");
        button.setPadding(0, 0, 0, 0);
        int size = NativeCompactMenuView.controlExtent(this, 30);
        button.setLayoutParams(new LinearLayout.LayoutParams(size, size));
        return button;
    }

    private int pendingTripCountForCurrentScope() {
        int count = 0;
        for (String id : ProPendingTripStore.ids(prefs)) {
            SharedPreferences entry = ProPendingTripStore.entry(this, id);
            if (ProPendingTripStore.isCompletionRecorded(prefs, entry)) continue;
            if ("FAILED".equals(entry.getString("queueStatus", ""))) continue;
            if (safe(entry.getString("jobId", "")).equals(safe(prefs.getString("jobId", "")))
                && safe(entry.getString("companyId", "")).equals(safe(prefs.getString("companyId", "")))
                && safe(entry.getString("driverId", "")).equals(safe(prefs.getString("driverId", "")))) count++;
        }
        return count;
    }

    private void addPendingHistoryContents(LinearLayout target) {
        for (String id : ProPendingTripStore.ids(prefs)) {
            SharedPreferences entry = ProPendingTripStore.entry(this, id);
            if (ProPendingTripStore.isCompletionRecorded(prefs, entry)) continue;
            if (!safe(entry.getString("jobId", "")).equals(safe(prefs.getString("jobId", "")))
                || !safe(entry.getString("companyId", "")).equals(safe(prefs.getString("companyId", "")))
                || !safe(entry.getString("driverId", "")).equals(safe(prefs.getString("driverId", "")))) continue;
            String status = safe(entry.getString("queueStatus", ""));
            boolean permissionPaused = "PERMISSION_PAUSED".equals(status)
                || ("MATCH".equals(entry.getString("nativeAuthState", "UNKNOWN"))
                    && SimpleProNativeSubmissionCoordinator.isPermissionFailureReason(
                        entry.getString("lastQueueErrorCode", "")));
            String title = "FAILED".equals(status) ? "Registro não aprovado"
                : permissionPaused ? "Envio pausado · permissão do servidor"
                : !hasUsableNetwork() ? "Aguardando envio · sem rede"
                : "SENDING".equals(status) ? "Enviando viagem…"
                : "Aguardando envio · nova tentativa automática";
            target.addView(label(pendingTripPreview(id, title), 10.5f, false), fullParams(0, dp(6)));
        }
    }

    private void addHistoryContents(LinearLayout target) {
        addPendingHistoryContents(target);
        try {
            JSONArray history = new JSONArray(prefs.getString("operationHistoryJson", "[]"));
            if (history.length() == 0 && pendingTripCountForCurrentScope() == 0) {
                String emptyMessage = prefs.getInt("confirmedTripCount", 0) > 0
                    ? "Histórico em sincronização. O progresso da operação está preservado."
                    : "SERVER".equals(prefs.getString("historyLoadState", ""))
                        ? "Nenhuma viagem confirmada nesta operação."
                        : "Histórico aguardando sincronização.";
                target.addView(label(emptyMessage, 10.5f, false), fullParams(0, dp(6)));
            }
            for (int index = 0; index < history.length(); index++) {
                JSONObject item = history.optJSONObject(index);
                if (item == null) continue;
                LinearLayout card = new LinearLayout(this);
                card.setOrientation(LinearLayout.VERTICAL);
                card.setPadding(dp(8), dp(5), dp(8), dp(5));
                card.setBackground(roundBackground(Color.argb(120, 62, 69, 79), 9));
                card.addView(label("Viagem " + (index + 1), 11f, true), fullParams(0, dp(1)));
                card.addView(label(
                    safe(item.optString("origin", "")) + " → " + safe(item.optString("destination", "")),
                    10.5f,
                    false
                ), fullParams(0, dp(1)));
                card.addView(label(formatHistoryAmount(item), 11f, true), fullParams(0, 0));
                target.addView(card, fullParams(0, dp(4)));
            }
        } catch (JSONException ignored) {
            target.addView(label("Histórico indisponível no momento.", 10.5f, false), fullParams(0, dp(6)));
        }
        Button back = menuButton("Voltar");
        back.setOnClickListener(v -> { historyExpanded = false; refreshMenuContents(); });
        target.addView(back, fullParams(dp(4), 0));
    }

    private String formatAmountCents(long amountCents) {
        return ProTripMoneyPresentation.format(amountCents, "",
            safe(prefs.getString("simulatorKey", "")), safe(prefs.getString("receiptText", "")));
    }

    private static String formatHistoryAmount(JSONObject item) {
        // Resolve old cached rows at display time, including offline, without rewriting them.
        Map<String, Object> data = new LinkedHashMap<>();
        java.util.Iterator<String> keys = item.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            data.put(key, item.opt(key));
        }
        return ProHistoryMoney.format(item.optLong("amountCents", 0L), ProHistoryMoney.resolve(data));
    }

    private NativeTripReceipt latestHistoryReceipt() {
        try {
            JSONArray history = new JSONArray(prefs.getString("operationHistoryJson", "[]"));
            JSONObject item = history.optJSONObject(history.length() - 1);
            if (item == null) return null;
            return new NativeTripReceipt(NativeTripReceipt.State.CONFIRMED,
                item.optString("id", item.optString("tripId", prefs.getString("nativeTripId", ""))),
                item.optString("tripId", item.optString("id", "")), prefs.getString("driverId", ""),
                prefs.getString("companyId", ""), prefs.getString("jobId", ""), "",
                item.optString("origin", ""), item.optString("destination", ""), formatHistoryAmount(item),
                prefs.getInt("confirmedTripCount", 0), prefs.getInt("jobTotalDeliveries", 0));
        } catch (JSONException ignored) { return null; }
    }

    private LinearLayout.LayoutParams compactParams(int topMargin, int bottomMargin) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-2, dp(28));
        params.topMargin = topMargin;
        params.bottomMargin = bottomMargin;
        return params;
    }

    private TextView label(String text, float size, boolean bold) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(Color.rgb(225, 232, 240));
        view.setTextSize(size);
        view.setPadding(dp(5), dp(3), dp(5), dp(3));
        if (bold) view.setTypeface(view.getTypeface(), android.graphics.Typeface.BOLD);
        return view;
    }

    private LinearLayout.LayoutParams fullParams(int topMargin, int bottomMargin) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.topMargin = topMargin;
        params.bottomMargin = bottomMargin;
        return params;
    }

    private void closeMenu() {
        View previous = menuView;
        if (previous != null && windowManager != null) {
            try { windowManager.removeView(previous); } catch (RuntimeException ignored) {}
        }
        menuView = null;
        menuParams = null;
        cardVisibility.release(previous);
    }

    private void hideCaptureInteractiveOverlaysKeepBubble() {
        cancelSimpleBubbleGesture("CAPTURE_HIDE_INTERACTIVE", false);
        hideSimpleBubbleRemoveTarget();
        hideStatusChip();
        closeMenu();
        // The NVU pill is the persistent Pro control. Only interactive cards,
        // status messages and the drag target are hidden before consent; removing
        // the pill would make an interrupted capture leave the session frozen.
    }

    private void removeBubbleForSensitiveScreen(String reason) {
        if (bubbleView != null && windowManager != null) {
            try {
                windowManager.removeViewImmediate(bubbleView);
            } catch (SecurityException error) {
                recordOverlayDiagnostic("remove_security_exception", error);
            } catch (RuntimeException error) {
                recordOverlayDiagnostic("remove_runtime_exception", error);
            }
        }
        bubbleView = null;
        bubbleLabelView = null;
        captureHealthDotView = null;
        bubbleParams = null;
        if (prefs != null) {
            prefs.edit()
                .putBoolean("captureUiHidden", true)
                .putBoolean("overlayVisible", false)
                .putBoolean("bubbleVisible", false)
                .putString("overlayLastAction", "removed:" + safe(reason))
                .apply();
        }
    }

    private void recordOverlayDiagnostic(String code, Throwable error) {
        if (prefs == null) return;
        String detail = error == null ? "" : safe(error.getClass().getSimpleName());
        prefs.edit()
            .putBoolean("overlayPermission", ProModeController.hasOverlay(this))
            .putString("overlayType", String.valueOf(overlayType()))
            .putBoolean("bubbleVisible", bubbleView != null)
            .putBoolean("captureUiHidden", prefs.getBoolean("captureUiHidden", false))
            .putLong("bubbleTapCount", bubbleTapCount)
            .putLong("bubbleLastTapAt", bubbleLastTapAt)
            .putString("overlayLastError", safe(code) + (detail.isEmpty() ? "" : ":" + detail))
            .putLong("overlayLastErrorAt", System.currentTimeMillis())
            .apply();
    }

    /**
     * Pro visual policy: the bubble follows only the physical display orientation.
     * It is deliberately independent from foreground/package evidence and never
     * authorizes, blocks or cancels MediaProjection.
     */
    private boolean isProBubbleOrientationAllowed() {
        // IMPORTANT: the service may retain the NVU Activity's portrait resource
        // configuration while the external Pro simulator is already landscape.
        // Use the real WindowManager bounds as the source of truth; otherwise the
        // monitor can remove the bubble even though the simulator is visibly landscape.
        try {
            DisplayMetrics metrics = realDisplayMetrics();
            if (metrics.widthPixels > 0 && metrics.heightPixels > 0) {
                return metrics.widthPixels > metrics.heightPixels;
            }
        } catch (Exception ignored) {}
        try {
            return getResources().getConfiguration().orientation
                == android.content.res.Configuration.ORIENTATION_LANDSCAPE;
        } catch (Exception ignored) {
            return false;
        }
    }

    private boolean isConfiguredSimulatorForeground() {
        String packageId = safe(prefs == null ? "" : prefs.getString("packageId", ""));
        if (packageId.isEmpty()) return false;
        ActivityManager manager = (ActivityManager) getSystemService(ACTIVITY_SERVICE);
        if (manager == null) return false;

        boolean observed = false;
        String topPackage = "";
        try {
            // Only the current task is authoritative. A recent task elsewhere in
            // the list must never authorize a capture or keep the bubble visible.
            List<ActivityManager.RunningTaskInfo> tasks = manager.getRunningTasks(1);
            if (tasks != null && !tasks.isEmpty() && tasks.get(0) != null) {
                ActivityManager.RunningTaskInfo topTask = tasks.get(0);
                String taskTop = topTask.topActivity == null ? "" : topTask.topActivity.getPackageName();
                String taskBase = topTask.baseActivity == null ? "" : topTask.baseActivity.getPackageName();
                topPackage = !taskTop.isEmpty() ? taskTop : taskBase;
                observed = !topPackage.isEmpty();
                boolean simulatorIsTop = packageId.equals(taskTop) || packageId.equals(taskBase);
                if (simulatorIsTop) {
                    recordSimulatorForegroundHeartbeat(packageId, "top-task");
                    prefs.edit().putString("foregroundCheckPackage", packageId)
                        .putLong("foregroundCheckAt", System.currentTimeMillis()).apply();
                    return true;
                }
                prefs.edit().putString("foregroundCheckPackage", topPackage)
                    .putLong("foregroundCheckAt", System.currentTimeMillis()).apply();
                return false;
            }
        } catch (Exception ignored) {
            // Continue only when task information is genuinely unavailable.
        }

        // A merely visible process is not enough. This fallback accepts only an
        // actual foreground process when the task API has no usable task.
        try {
            List<ActivityManager.RunningAppProcessInfo> processes = manager.getRunningAppProcesses();
            if (processes != null) {
                for (ActivityManager.RunningAppProcessInfo process : processes) {
                    if (process == null || process.pkgList == null
                        || process.importance != ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND) continue;
                    observed = true;
                    for (String processPackage : process.pkgList) {
                        if (packageId.equals(processPackage)) {
                            recordSimulatorForegroundHeartbeat(packageId, "foreground-process");
                            prefs.edit().putString("foregroundCheckPackage", packageId)
                                .putLong("foregroundCheckAt", System.currentTimeMillis()).apply();
                            return true;
                        }
                    }
                }
            }
        } catch (Exception ignored) {}

        prefs.edit()
            .putString("foregroundCheckPackage", topPackage.isEmpty() ? (observed ? "observed-other" : "unknown") : topPackage)
            .putLong("foregroundCheckAt", System.currentTimeMillis())
            .apply();
        return false;
    }

    private void recordSimulatorForegroundHeartbeat(String packageId, String source) {
        if (prefs == null || safe(packageId).isEmpty()) return;
        prefs.edit()
            .putString("lastSimulatorVisiblePackage", safe(packageId))
            .putLong("lastSimulatorVisibleAt", System.currentTimeMillis())
            .putString("lastSimulatorVisibleSource", safe(source))
            .putString("simulatorVisibility", "VISIBLE")
            .putBoolean("visibilityEstablished", true)
            .apply();
    }

    private boolean isAllowedPostTouchContext() {
        ActivityManager manager = (ActivityManager) getSystemService(ACTIVITY_SERVICE);
        if (manager == null) return false;
        String expected = safe(prefs == null ? "" : prefs.getString("packageId", ""));
        try {
            List<ActivityManager.RunningTaskInfo> tasks = manager.getRunningTasks(1);
            if (tasks == null || tasks.isEmpty() || tasks.get(0) == null) return false;
            ActivityManager.RunningTaskInfo top = tasks.get(0);
            String topPackage = top.topActivity == null ? "" : top.topActivity.getPackageName();
            String basePackage = top.baseActivity == null ? "" : top.baseActivity.getPackageName();
            return getPackageName().equals(topPackage)
                || getPackageName().equals(basePackage)
                || (!expected.isEmpty() && (expected.equals(topPackage) || expected.equals(basePackage)));
        } catch (Exception ignored) {
            return false;
        }
    }

    private boolean canUseRecentSimulatorHeartbeat() {
        if (prefs == null) return false;
        String expected = safe(prefs.getString("packageId", ""));
        String heartbeatPackage = safe(prefs.getString("lastSimulatorVisiblePackage", ""));
        String visibility = safe(prefs.getString("simulatorVisibility", "UNKNOWN"));
        String state = safe(prefs.getString("simpleState", DEFAULT_STATE));
        boolean established = prefs.getBoolean("visibilityEstablished", false);
        long heartbeatAt = prefs.getLong("lastSimulatorVisibleAt", 0L);
        long age = System.currentTimeMillis() - heartbeatAt;
        if (!STATE_TRIP_ACTIVE.equals(state)
            || !established
            || !"VISIBLE".equals(visibility)
            || expected.isEmpty()
            || !expected.equals(heartbeatPackage)
            || heartbeatAt <= 0L
            || age < 0L
            || age > RECENT_FOREGROUND_HEARTBEAT_MAX_MS) return false;
        return isAllowedPostTouchContext();
    }

    private static String normalizeProSimulatorKey(String simulatorKey, String simulatorCode, String packageId) {
        String key = safe(simulatorKey).toLowerCase(Locale.ROOT);
        String code = safe(simulatorCode).toUpperCase(Locale.ROOT);
        String pkg = safe(packageId);
        if ("wtds".equals(key) || "WTDS".equals(code) || "com.dynamicgames.worldtruckdrivingsimulator".equals(pkg)) return "wtds";
        if ("wbds".equals(key) || "WBDS".equals(code) || "com.dynamicgames.worldbusdrivingsimulator".equals(pkg)) return "wbds";
        if ("toe-3".equals(key) || "toe3".equals(key) || "TOE3".equals(code) || "com.WandaSoftware.TruckersofEurope3".equals(pkg)) return "toe-3";
        if ("global-truck".equals(key) || "gto".equals(key) || "GTO".equals(code) || "com.stargamesapps.gto".equals(pkg)) return "global-truck";
        return "";
    }

    private static boolean isCanonicalProSimulatorPackage(String simulatorKey, String packageId) {
        String key = normalizeProSimulatorKey(simulatorKey, "", packageId);
        String pkg = safe(packageId);
        if (key.isEmpty() || pkg.isEmpty()) return false;
        if ("gto".equals(key) || "global-truck".equals(key)) return "com.stargamesapps.gto".equals(pkg);
        if ("wtds".equals(key)) return "com.dynamicgames.worldtruckdrivingsimulator".equals(pkg);
        if ("wbds".equals(key)) return "com.dynamicgames.worldbusdrivingsimulator".equals(pkg);
        if ("toe-3".equals(key)) return "com.WandaSoftware.TruckersofEurope3".equals(pkg);
        return false;
    }

    private static String resolveCanonicalProSimulatorPackage(String simulatorKey, String simulatorCode, String persistedPackageId) {
        String key = normalizeProSimulatorKey(simulatorKey, simulatorCode, persistedPackageId);
        String code = safe(simulatorCode).toUpperCase(Locale.ROOT);
        String persisted = safe(persistedPackageId);

        // Identity may arrive from different generations of the Pro catalog.
        // Resolve by key, code, or canonical package so a valid Pro trip can never
        // be rejected merely because its identity was stored under an older alias.
        switch (key) {
            case "wtds": return "com.dynamicgames.worldtruckdrivingsimulator";
            case "wbds": return "com.dynamicgames.worldbusdrivingsimulator";
            case "toe-3": return "com.WandaSoftware.TruckersofEurope3";
            case "global-truck": return "com.stargamesapps.gto";
            default: break;
        }

        // Code/package-only recovery for partially persisted legacy sessions.
        if ("WTDS".equals(code) || "com.dynamicgames.worldtruckdrivingsimulator".equals(persisted)) return "com.dynamicgames.worldtruckdrivingsimulator";
        if ("WBDS".equals(code) || "com.dynamicgames.worldbusdrivingsimulator".equals(persisted)) return "com.dynamicgames.worldbusdrivingsimulator";
        if ("TOE3".equals(code) || "com.WandaSoftware.TruckersofEurope3".equals(persisted)) return "com.WandaSoftware.TruckersofEurope3";
        if ("GTO".equals(code) || "com.stargamesapps.gto".equals(persisted)) return "com.stargamesapps.gto";
        return "";
    }

    private void consumePendingSimulatorLaunch() {
        if (prefs == null) return;
        String packageId = safe(prefs.getString("pendingSimulatorLaunchPackage", ""));
        long requestedAt = prefs.getLong("pendingSimulatorLaunchAt", 0L);
        long age = System.currentTimeMillis() - requestedAt;
        if (!packageId.isEmpty() && requestedAt > 0L && age >= 0L && age <= SIMULATOR_LAUNCH_HANDSHAKE_MAX_MS) {
            markSimulatorLaunchRequestedInternal(packageId);
        } else if (!packageId.isEmpty() || requestedAt > 0L) {
            prefs.edit().remove("pendingSimulatorLaunchPackage").remove("pendingSimulatorLaunchAt").apply();
        }
    }

    private void startVisibilityMonitor() {
        if (mainHandler == null) return;
        mainHandler.removeCallbacks(visibilityMonitorRunnable);
        mainHandler.post(visibilityMonitorRunnable);
    }

    private void monitorSimulatorVisibility() {
        if (prefs == null || mainHandler == null) return;
        boolean horizontal = isProBubbleOrientationAllowed();
        simulatorVisible = horizontal;
        simulatorVisibilityEstablished = false;
        SharedPreferences.Editor visualState = prefs.edit()
            .putString("bubbleOrientation", horizontal ? "HORIZONTAL" : "VERTICAL")
            .putBoolean("bubbleOrientationHorizontal", horizontal)
            .putString("simulatorVisibility", "UNKNOWN")
            .putBoolean("visibilityEstablished", false);
        if (horizontal) {
            visualState.putString("bubbleOrientation", "HORIZONTAL");
        } else {
            visualState.putString("bubbleOrientation", "VERTICAL");
        }
        visualState.apply();
        String captureStage = safe(prefs.getString("captureStage", ""));
        boolean consentSurface = "CONSENT_PENDING".equals(captureStage)
            || "CONSENT_LAUNCHING".equals(captureStage);
        if (horizontal) {
            if (!consentSurface) showBubbleIfAllowed(true);
        } else {
            // Visual state only: never cancel or reject an already authorized
            // capture because NVU/consent becomes the observed surface.
            hideBubbleForSimulatorOutside();
        }
        if (menuView != null && menuParams != null) {
            mainHandler.post(this::adjustProMenuLayoutAfterMeasure);
        }
        positionProReceiptCard();
        applyBubbleCardVisibility(cardVisibility.isSuppressed());
        mainHandler.postDelayed(visibilityMonitorRunnable, VISIBILITY_POLL_MS);
    }

    private void hideBubbleForSimulatorOutside() {
        cancelSimpleBubbleGesture("SIMULATOR_OUTSIDE", false);
        hideSimpleBubbleRemoveTarget();
        hideStatusChip();
        closeMenu();
        if (bubbleView != null && windowManager != null) {
            try { windowManager.removeView(bubbleView); } catch (Exception ignored) {}
        }
        bubbleView = null;
        bubbleLabelView = null;
        captureHealthDotView = null;
        bubbleParams = null;
        if (prefs != null) prefs.edit().putBoolean("overlayVisible", false).putBoolean("bubbleVisible", false)
            .putString("overlayLastAction", "removed:simulator_outside").apply();
    }

    private void removeOverlays() {
        cancelSimpleBubbleGesture("REMOVE_OVERLAYS", false);
        hideSimpleBubbleRemoveTarget();
        hideStatusChip();
        closeMenu();
        if (bubbleView != null && windowManager != null) {
            try { windowManager.removeView(bubbleView); } catch (Exception ignored) {}
        }
        bubbleView = null;
        bubbleParams = null;
        if (prefs != null) prefs.edit().putBoolean("overlayVisible", false).putBoolean("bubbleVisible", false)
            .putString("overlayLastAction", "removed:service").apply();
    }

    private int overlayType() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            : WindowManager.LayoutParams.TYPE_PHONE;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private GradientDrawable roundBackground(int color, int radiusDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radiusDp));
        return drawable;
    }

    private static String safe(String value) {
        return value == null ? "" : value.trim();
    }

    private static boolean awaitingManualCompletion(String jobStatus) {
        return "awaiting_completion".equalsIgnoreCase(safe(jobStatus));
    }

    private static String closedOperationMessage(String jobStatus) {
        if (awaitingManualCompletion(jobStatus)) {
            return "Todas as viagens foram registradas. Abra a NVU e finalize a operação para continuar.";
        }
        return "Operação concluída. Solicite uma nova operação para continuar.";
    }

    private static String initialOf(String value) {
        String normalized = Normalizer.normalize(safe(value), Normalizer.Form.NFD)
            .replaceAll("\\p{InCombiningDiacriticalMarks}+", "")
            .trim();
        return normalized.isEmpty() ? "" : normalized.substring(0, 1).toUpperCase(Locale.ROOT);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager == null) return;
        manager.createNotificationChannel(new NotificationChannel(
            CHANNEL_ID, "NVU Modo Pro", NotificationManager.IMPORTANCE_LOW
        ));
    }

    private Notification buildNotification() {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_compass)
            .setContentTitle("NVU Modo Pro")
            .setContentText("Bolha Pro pronta")
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build();
    }
}
