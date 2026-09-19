package com.nvu.operacional;

import android.app.ActivityManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
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

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Native overlay for NVU's independent Simple Automatic mode.
 *
 * This service intentionally has no GTO detector, Usage Access, MediaProjection,
 * freight state or GTO queue integration. It only owns the reusable NVU bubble,
 * city route selection and a local simple-mode session snapshot.
 */
public final class SimpleAutomationService extends Service {
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
    private static final int BUBBLE_POSITION_SCALE = 10_000;
    private static final int PRO_MESSAGE_MIN_BAND_DP = 76;
    private static final String PRO_TIMING_TAG = "NVU-ProTiming";

    private static volatile SimpleAutomationService instance;

    private WindowManager windowManager;
    private android.content.SharedPreferences prefs;
    private View bubbleView;
    private TextView bubbleLabelView;
    private View captureHealthDotView;
    private LinearLayout menuView;
    private WindowManager.LayoutParams bubbleParams;
    private WindowManager.LayoutParams menuParams;
    private int menuBaseY;
    private int bubbleXBeforeMenuOpen = Integer.MIN_VALUE;
    private int bubbleYBeforeMenuOpen = Integer.MIN_VALUE;
    private boolean bubbleAutoDockedForMenu;
    private int bubbleXBeforeStatusMessage = Integer.MIN_VALUE;
    private int bubbleYBeforeStatusMessage = Integer.MIN_VALUE;
    private boolean bubbleMovedForStatusMessage;
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
    private Handler mainHandler;
    private final Runnable visibilityMonitorRunnable = this::monitorSimulatorVisibility;
    private final Runnable nativeSubmissionRetryRunnable = new Runnable() {
        @Override
        public void run() {
            if (prefs != null
                && "CAPTURE_CAPTURED".equals(prefs.getString("simpleState", DEFAULT_STATE))
                && prefs.getBoolean("nativeRetryPending", false)
                && !safe(prefs.getString("receiptText", "")).isEmpty()) {
                submitNativeReceiptIfPending();
            }
            if (mainHandler != null) {
                mainHandler.postDelayed(this, NATIVE_SUBMISSION_RETRY_INTERVAL_MS);
            }
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
    private boolean captureFrameRequested;
    private boolean captureOcrInFlight;
    private int captureOcrAttempts;
    private long captureStartedAt;
    private long captureStartedElapsedAt;
    private static final long CAPTURE_FRAME_WARMUP_MS = 650L;
    private static final long CAPTURE_FRAME_RETRY_MS = 120L;
    // The Web adapter owns simulator-specific receipt validation. Native OCR only
    // needs one readable frame; a single empty-frame retry avoids multi-second loops.
    private static final int CAPTURE_MAX_OCR_ATTEMPTS = 2;
    private static final long VISIBILITY_POLL_MS = 250L;
    private static final long RECENT_FOREGROUND_HEARTBEAT_MAX_MS = 30000L;
    private static final long NATIVE_SUBMISSION_RETRY_INTERVAL_MS = 15000L;
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
        simulatorVisibilityEstablished = false;
        if (prefs != null) prefs.edit().putString("simulatorVisibility", "UNKNOWN").apply();
        if (mainHandler != null) {
            mainHandler.removeCallbacks(visibilityMonitorRunnable);
            mainHandler.post(visibilityMonitorRunnable);
        }
    }

    public static boolean startIfAllowed(Context context) {
        if (context == null) return false;
        resetOrphanedCaptureState(context.getApplicationContext());
        if (!android.provider.Settings.canDrawOverlays(context)) return false;
        try {
            Intent intent = new Intent(context.getApplicationContext(), SimpleAutomationService.class)
                .setAction(ACTION_START);
            androidx.core.content.ContextCompat.startForegroundService(context.getApplicationContext(), intent);
            return true;
        } catch (Exception error) {
            return false;
        }
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
        editor.putInt("jobProgress", safeProgress);
        editor.putInt("jobTotalDeliveries", safeTotal);
        editor.putString("jobStatus", safe(jobStatus));
        editor.putBoolean("operationClosed", computedClosed);
        editor.putString("vehicleName", safe(vehicleName));
        editor.putString("trailerName", safe(trailerName));
        editor.putString("packageId", safe(packageId));
        editor.putString("citiesJson", safe(citiesJson));
        if (historyScopeChanged) {
            editor.remove("operationHistoryJson")
                .remove("historyScopeJobId")
                .remove("historyScopeCompanyId")
                .remove("historyScopeDriverId")
                .remove("historyUpdatedAt");
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
    }

    public static void refreshOperationSnapshot(
        Context context,
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
        String trailerName
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
        int existingProgress = Math.max(0, preferences.getInt("jobProgress", 0));
        boolean existingClosed = preferences.getBoolean("operationClosed", false);
        if (!safe(jobId).isEmpty() && safe(jobId).equals(existingJobId)
            && (safeProgress < existingProgress || (existingClosed && !closed))) return;
        android.content.SharedPreferences.Editor editor = preferences.edit();
        if (!safe(companyName).isEmpty()) editor.putString("companyName", safe(companyName));
        if (!safe(operationName).isEmpty()) editor.putString("operationName", safe(operationName));
        if (!safe(contractName).isEmpty()) editor.putString("contractName", safe(contractName));
        if (!safe(jobId).isEmpty()) editor.putString("jobId", safe(jobId));
        if (!safe(contractId).isEmpty()) editor.putString("contractId", safe(contractId));
        if (!safe(companyId).isEmpty()) editor.putString("companyId", safe(companyId));
        if (!safe(driverId).isEmpty()) editor.putString("driverId", safe(driverId));
        editor.putInt("jobProgress", safeProgress);
        editor.putInt("jobTotalDeliveries", safeTotal);
        editor.putString("jobStatus", safe(jobStatus));
        editor.putBoolean("operationClosed", closed);
        editor.putString("vehicleName", safe(vehicleName));
        editor.putString("trailerName", safe(trailerName));
        editor.putString("lastEvent", closed
            ? "Operação concluída. Não é possível enviar novas viagens."
            : "Operação atualizada.");
        editor.apply();
        if (instance != null) {
            instance.refreshMenuContents();
            if (closed) {
                instance.showStatusChip("Operação concluída. Solicite uma nova operação para continuar.", 6500L);
            }
        }
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
            .putInt("jobProgress", safeProgress)
            .putInt("jobTotalDeliveries", safeTotal)
            .putString("jobStatus", safe(jobStatus))
            .putBoolean("operationClosed", closed)
            .putString("lastEvent", closed
                ? "Operação concluída. Não é possível enviar novas viagens."
                : "Operação atualizada.")
            .apply();
        if (instance != null) {
            instance.refreshMenuContents();
            if (closed) {
                instance.showStatusChip("Operação concluída. Solicite uma nova operação para continuar.", 6500L);
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
        if (preferences.getBoolean("operationClosed", false)) {
            preferences.edit()
                .putString("lastEvent", "Operação concluída. Solicite uma nova operação para continuar.")
                .apply();
            if (instance != null) {
                instance.showStatusChip("Operação concluída. Solicite uma nova operação para continuar.", 6500L);
                instance.refreshMenuContents();
            }
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
            instance.refreshMenuContents();
            long routeEventId = System.currentTimeMillis();
            instance.emitSimpleReadyVoice(routeEventId);
            instance.showStatusChip("Tudo preparado, podemos partir.", 2600L);
        }
    }

    public static void requestReceiptCapture(Context context) {
        if (context == null) return;
        android.content.SharedPreferences preferences = context.getApplicationContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String currentState = preferences.getString("simpleState", DEFAULT_STATE);
        if (preferences.getBoolean("operationClosed", false)) {
            preferences.edit()
                .putString("captureStage", "BLOCKED_OPERATION_CLOSED")
                .putString("lastEvent", "Operação concluída. Solicite uma nova operação para continuar.")
                .apply();
            if (instance != null) {
                instance.showStatusChip("Operação concluída. Solicite uma nova operação para continuar.", 6500L);
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
        // for Pro is the explicit MediaProjection frame followed by semantic OCR.
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
        recordProDiagnostic(context, attemptId, "projection_permission", "PENDING", "PROJECTION_PERMISSION_PENDING", preferences.getString("foregroundCheckPackage", ""));
        String captureContextEpoch = preferences.getString("contextEpoch", "");
        String captureSimulatorKey = preferences.getString("simulatorKey", "");
        String captureSimulatorCode = preferences.getString("simulatorCode", "");
        String captureOrigin = preferences.getString("origin", "");
        String captureDestination = preferences.getString("destination", "");
        String captureCompanyId = preferences.getString("companyId", "");
        String captureDriverId = preferences.getString("driverId", "");
        String captureJobId = preferences.getString("jobId", "");
        String captureContractId = preferences.getString("contractId", "");
        String capturePackageId = preferences.getString("packageId", "");
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
        // Hide only the interactive card/status surfaces. The NVU pill is the
        // persistent control and must remain visible over the simulator while
        // the card and receipt capture are hidden.
        instance.hideCaptureInteractiveOverlaysKeepBubble();
        instance.mainHandlerPost(instance::beginCaptureConsent);
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
        if (context == null || safe(tripId).isEmpty() || safe(jobId).isEmpty()
            || safe(companyId).isEmpty() || safe(driverId).isEmpty()
            || amountCents <= 0L) return;
        android.content.SharedPreferences preferences = context.getApplicationContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        if (!safe(jobId).equals(safe(preferences.getString("jobId", "")))
            || !safe(companyId).equals(safe(preferences.getString("companyId", "")))
            || !safe(driverId).equals(safe(preferences.getString("driverId", "")))) return;
        try {
            JSONArray current = new JSONArray(preferences.getString("operationHistoryJson", "[]"));
            List<JSONObject> entries = new ArrayList<>();
            boolean duplicate = false;
            for (int index = 0; index < current.length(); index++) {
                JSONObject item = current.optJSONObject(index);
                if (item == null) continue;
                if (safe(tripId).equals(safe(item.optString("tripId", "")))) duplicate = true;
                entries.add(item);
            }
            if (!duplicate) {
                JSONObject item = new JSONObject();
                item.put("tripId", safe(tripId));
                item.put("jobId", safe(jobId));
                item.put("companyId", safe(companyId));
                item.put("driverId", safe(driverId));
                item.put("contractId", safe(contractId));
                item.put("simulatorKey", safe(simulatorKey));
                item.put("origin", safe(origin));
                item.put("destination", safe(destination));
                item.put("amountCents", amountCents);
                item.put("completedAt", completedAt > 0L ? completedAt : System.currentTimeMillis());
                entries.add(item);
            }
            Collections.sort(entries, (left, right) -> {
                int byTime = Long.compare(left.optLong("completedAt", 0L), right.optLong("completedAt", 0L));
                return byTime != 0 ? byTime : safe(left.optString("tripId", ""))
                    .compareTo(safe(right.optString("tripId", "")));
            });
            JSONArray rebuilt = new JSONArray();
            for (JSONObject item : entries) rebuilt.put(item);
            preferences.edit()
                .putString("historyScopeJobId", safe(jobId))
                .putString("historyScopeCompanyId", safe(companyId))
                .putString("historyScopeDriverId", safe(driverId))
                .putString("operationHistoryJson", rebuilt.toString())
                .putLong("historyUpdatedAt", System.currentTimeMillis())
                .apply();
            if (instance != null) instance.refreshMenuContents();
        } catch (JSONException ignored) {
            preferences.edit().remove("operationHistoryJson").apply();
        }
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
        if (context == null) return;
        android.content.SharedPreferences preferences = context.getApplicationContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        boolean hasRoute = !safe(preferences.getString("origin", "")).isEmpty()
            && !safe(preferences.getString("destination", "")).isEmpty();
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
            .putString("nativeSubmissionState", accepted ? "SYNCED" : "IDLE")
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
            instance.showBubbleIfAllowed();
            instance.refreshMenuContents();
            if (accepted) {
                instance.emitSimpleTripCompletedVoice("simple-completed:" + System.currentTimeMillis());
                instance.showStatusChip(
                    preferences.getBoolean("operationClosed", false)
                        ? instance.latestHistoryPreview() + "\nOperação concluída."
                        : instance.latestHistoryPreview(),
                    preferences.getBoolean("operationClosed", false) ? 6500L : 3600L
                );
            } else {
                String message = safe(reason).isEmpty()
                    ? "Captura fora da tela correta. Abra a tela de conclusão e tente novamente."
                    : safe(reason);
                instance.showStatusChip(message, 4200L);
            }
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

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        mainHandler = new Handler(Looper.getMainLooper());
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
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
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
        boolean captureHidden = prefs.getBoolean("captureUiHidden", false);
        String simpleState = prefs.getString("simpleState", DEFAULT_STATE);
        if (captureHidden && (STATE_CAPTURE_PENDING.equals(simpleState) || "CAPTURE_CAPTURED".equals(simpleState))) {
            showBubbleIfAllowed();
        } else if (!captureHidden) {
            showBubbleIfAllowed();
        }
        if ("CAPTURE_CAPTURED".equals(simpleState)
            && ("SUBMITTING_NATIVE".equals(prefs.getString("nativeSubmissionState", ""))
                || "WEB_FALLBACK".equals(prefs.getString("nativeSubmissionState", "")))
            && !safe(prefs.getString("receiptText", "")).isEmpty()) {
            mainHandlerPost(this::submitNativeReceiptIfPending);
        }
        scheduleNativeSubmissionRetry();
        if (STATE_CAPTURE_PENDING.equals(simpleState)
            && !captureFrameRequested
            && (intent == null || !ACTION_START_CAPTURE.equals(intent.getAction()))) {
            mainHandlerPost(this::beginCaptureConsent);
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
        if (mainHandler != null) mainHandler.removeCallbacks(visibilityMonitorRunnable);
        if (mainHandler != null) mainHandler.removeCallbacks(nativeSubmissionRetryRunnable);
        cleanupCapture();
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
        long consentStartedElapsedAt = SystemClock.elapsedRealtime();
        prefs.edit().putString("captureStage", "CONSENT_LAUNCHING")
            .putLong("captureConsentStartedElapsedAt", consentStartedElapsedAt)
            .apply();
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

    private void beginCapture(int resultCode, Intent data) {
        if (captureFrameRequested) return;
        captureFrameRequested = true;
        captureOcrInFlight = false;
        captureOcrAttempts = 0;
        captureStartedAt = System.currentTimeMillis();
        captureStartedElapsedAt = SystemClock.elapsedRealtime();
        android.util.Log.i(PRO_TIMING_TAG, "stage=projection_granted elapsedMs=0");
        prefs.edit().putString("captureStage", "CAPTURING")
            .putInt("captureFrameAttempts", 0)
            .putLong("captureWarmupUntil", captureStartedAt + CAPTURE_FRAME_WARMUP_MS)
            .putLong("captureStartedElapsedAt", captureStartedElapsedAt)
            .apply();
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
            captureHandler.postDelayed(() -> {
                if (captureFrameRequested && System.currentTimeMillis() - captureStartedAt >= 8000L) {
                    failCapture("Tempo limite da captura excedido");
                }
            }, 8000L);
        } catch (Exception error) {
            failCapture("Falha ao iniciar captura: " + error.getClass().getSimpleName());
        }
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
            Bitmap cropped = bitmapWidth == width ? bitmap : Bitmap.createBitmap(bitmap, 0, 0, width, height);
            if (cropped != bitmap) bitmap.recycle();
            captureOcrInFlight = true;
            captureOcrAttempts += 1;
            android.util.Log.i(PRO_TIMING_TAG, "stage=ocr_started attempt=" + captureOcrAttempts
                + " elapsedMs=" + (SystemClock.elapsedRealtime() - captureStartedElapsedAt));
            final int attempt = captureOcrAttempts;
            prefs.edit().putString("captureStage", "OCR_PROCESSING")
                .putInt("captureFrameAttempts", attempt)
                .apply();
            final Bitmap frame = cropped;
            if (textRecognizer == null) {
                captureOcrInFlight = false;
                captureFrameRequested = false;
                failCapture("OCR indisponível");
                frame.recycle();
                return;
            }
            textRecognizer.process(InputImage.fromBitmap(frame, 0))
                .addOnSuccessListener(result -> {
                    captureOcrInFlight = false;
                    if (!captureFrameRequested) return;
                    String ocrText = result == null ? "" : result.getText();
                    android.util.Log.i(PRO_TIMING_TAG, "stage=ocr_finished attempt=" + attempt
                        + " readable=" + (!ocrText.trim().isEmpty())
                        + " chars=" + ocrText.length()
                        + " elapsedMs=" + (SystemClock.elapsedRealtime() - captureStartedElapsedAt));
                    // Simulator identity is frozen before consent, but native capture
                    // must still reject arbitrary readable HUD text. The coordinator
                    // performs the exact monetary parse; this first gate only accepts
                    // a result screen with the required receipt field and amount token.
                    boolean readable = !safe(ocrText).isEmpty();
                    boolean resultReceipt = readable && isLikelyResultReceiptText(ocrText)
                        && hasMonetaryCandidateForReceipt(ocrText);
                    if (resultReceipt || attempt >= CAPTURE_MAX_OCR_ATTEMPTS) {
                        captureFrameRequested = false;
                        finishCapture(resultReceipt ? ocrText : "");
                    } else {
                        prefs.edit().putString("captureStage", "OCR_RETRYING").apply();
                    }
                })
                .addOnFailureListener(error -> {
                    captureOcrInFlight = false;
                    if (!captureFrameRequested) return;
                    if (attempt >= CAPTURE_MAX_OCR_ATTEMPTS) {
                        captureFrameRequested = false;
                        failCapture("OCR falhou");
                    } else {
                        prefs.edit().putString("captureStage", "OCR_RETRYING").apply();
                    }
                })
                .addOnCompleteListener(task -> frame.recycle());
        } catch (Exception error) {
            captureOcrInFlight = false;
            captureFrameRequested = false;
            failCapture("Falha ao ler frame");
        } finally {
            if (image != null) image.close();
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

    private boolean hasMonetaryCandidateForReceipt(String text) {
        String normalized = Normalizer.normalize(safe(text), Normalizer.Form.NFD)
            .replaceAll("\\p{InCombiningDiacriticalMarks}+", "")
            .toUpperCase(Locale.ROOT)
            .replaceAll("\\s+", " ")
            .trim();
        String simulatorKey = safe(prefs.getString("captureSimulatorKey", prefs.getString("simulatorKey", "")));
        String[] labels = "global-truck".equals(simulatorKey)
            ? new String[]{"VALOR A RECEBER"}
            : "toe-3".equals(simulatorKey)
                ? new String[]{"RENDA TOTAL", "GANHOS"}
                : new String[]{"GANHOS DA VIAGEM", "TOTAL"};
        for (String label : labels) {
            int index = normalized.indexOf(label);
            while (index >= 0) {
                int end = Math.min(normalized.length(), index + label.length() + 80);
                String tail = normalized.substring(index + label.length(), end);
                if (tail.matches(".*(?:R\\$|BRL|EUR|€|\\$)?\\s*[0-9]+(?:[.,][0-9]{3})*[.,][0-9]{2}.*")) return true;
                index = normalized.indexOf(label, index + 1);
            }
        }
        return false;
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
            .putString("lastEvent", event)
            .apply();
        if (readable) {
            prefs.edit()
                .putString("nativeSubmissionState", "SUBMITTING_NATIVE")
                .putString("captureStage", "NATIVE_SUBMITTING")
                .apply();
            submitNativeReceiptIfPending();
        }
        cleanupCapture();
        if (readable) {
            // Native submission owns the immediate path. Keep every NVU overlay
            // hidden until the native or Web fallback acknowledge, so no card/chip
            // can cover the simulator's result screen while the trip is registered.
            hideStatusChip();
            closeMenu();
        } else {
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
        if ("SUBMITTING_NATIVE".equals(prefs.getString("nativeSubmissionState", ""))) return;
        prefs.edit()
            .putString("nativeSubmissionState", "SUBMITTING_NATIVE")
            .putBoolean("nativeRetryPending", false)
            .putString("captureStage", "NATIVE_SUBMITTING")
            .apply();
        SimpleProNativeSubmissionCoordinator.submit(this, prefs, receipt, new SimpleProNativeSubmissionCoordinator.Listener() {
            @Override
            public void onSuccess(String tripId) {
                android.util.Log.i(PRO_TIMING_TAG, "stage=native_pro_submission_success");
                SimpleAutomationService.acknowledgeReceipt(
                    SimpleAutomationService.this,
                    true,
                    "Viagem Pro registrada imediatamente (" + tripId + ")."
                );
            }

            @Override
            public void onFallback(String reason) {
                android.util.Log.i(PRO_TIMING_TAG, "stage=native_pro_submission_fallback");
                prefs.edit()
                    .putString("nativeSubmissionState", "WEB_FALLBACK")
                    .putBoolean("nativeRetryPending", true)
                    .putString("nativeSubmissionError", safe(reason))
                    .apply();
                SimpleAutomationPlugin.emitReceiptCaptured();
            }
        });
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

    private void showBubbleIfAllowed() {
        showBubbleIfAllowed(false);
    }

    private void showBubbleIfAllowed(boolean forceDuringCapture) {
        if (!forceDuringCapture && prefs != null && prefs.getBoolean("captureUiHidden", false)) return;
        // The Pro bubble is visual-only: orientation controls visibility.
        // Foreground/package evidence must never authorize, block or cancel capture.
        if (!isProBubbleOrientationAllowed()) return;
        boolean overlayPermission = android.provider.Settings.canDrawOverlays(this);
        if (prefs != null) {
            prefs.edit().putBoolean("overlayPermission", overlayPermission).apply();
            if (!overlayPermission) {
                prefs.edit().putString("overlayLastError", "overlay-permission")
                    .putLong("overlayLastErrorAt", System.currentTimeMillis()).apply();
            }
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
        frame.setOnTouchListener((view, event) -> {
            if (prefs != null && prefs.getBoolean("captureUiHidden", false)) return true;
            final int action = event.getActionMasked();
            final long now = System.currentTimeMillis();
            switch (action) {
                case MotionEvent.ACTION_DOWN:
                    rebaseProBubbleLayoutForCurrentDisplay(false, "POINTER_DOWN_REBASE");
                    beginSimpleBubbleGesture(event, now);
                    return true;
                case MotionEvent.ACTION_MOVE:
                    if (!isSimpleBubbleGestureCompatible(event)) {
                        cancelSimpleBubbleGesture("POINTER_CHANGED", true);
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
                    if (stopAllowed) {
                        stopSimpleFromFloatingBubble(releaseGeneration);
                    } else if (!wasDragging) {
                        toggleMenu();
                    }
                    return true;
                case MotionEvent.ACTION_CANCEL:
                    cancelSimpleBubbleGesture("ACTION_CANCEL", false);
                    return true;
                case MotionEvent.ACTION_POINTER_DOWN:
                case MotionEvent.ACTION_POINTER_UP:
                    cancelSimpleBubbleGesture("MULTI_POINTER", true);
                    return true;
                default:
                    return true;
            }
        });
        try {
            windowManager.addView(bubbleView, bubbleParams);
            bubbleLayoutDisplayWidth = initialMetrics.widthPixels;
            bubbleLayoutDisplayHeight = initialMetrics.heightPixels;
            prefs.edit().putBoolean("overlayVisible", true).putBoolean("bubbleVisible", true)
                .putString("overlayLastAction", "added:bubble").apply();
        } catch (SecurityException error) {
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

    private void restoreBubbleAfterMenu() {
        if (!bubbleAutoDockedForMenu || bubbleView == null || bubbleParams == null || windowManager == null) return;
        DisplayMetrics metrics = realDisplayMetrics();
        int bubbleWidth = bubbleView.getWidth() > 0 ? bubbleView.getWidth() : dp(68);
        int bubbleHeight = bubbleView.getHeight() > 0 ? bubbleView.getHeight() : dp(32);
        int safeLeft = dp(8);
        int safeTop = safeTopInsetPx() + dp(8);
        int maxX = bubbleSafeMaxX(metrics, bubbleWidth);
        int maxY = bubbleSafeMaxY(metrics, bubbleHeight);
        bubbleParams.x = Math.max(safeLeft, Math.min(maxX, bubbleXBeforeMenuOpen));
        bubbleParams.y = Math.max(safeTop, Math.min(maxY, bubbleYBeforeMenuOpen));
        try { windowManager.updateViewLayout(bubbleView, bubbleParams); } catch (Exception ignored) {}
        bubbleAutoDockedForMenu = false;
        bubbleXBeforeMenuOpen = Integer.MIN_VALUE;
        bubbleYBeforeMenuOpen = Integer.MIN_VALUE;
    }

    private void moveBubbleAwayFromStatusChip() {
        if (statusChipView == null || statusChipParams == null || bubbleView == null
            || bubbleParams == null || windowManager == null || !bubbleView.isAttachedToWindow()) return;
        int chipHeight = statusChipView.getHeight() > 0 ? statusChipView.getHeight() : dp(PRO_MESSAGE_MIN_BAND_DP);
        int chipBottom = statusChipParams.y + chipHeight;
        int bubbleWidth = bubbleView.getWidth() > 0 ? bubbleView.getWidth() : dp(68);
        int bubbleHeight = bubbleView.getHeight() > 0 ? bubbleView.getHeight() : dp(32);
        boolean overlaps = bubbleParams.y < chipBottom + dp(8)
            && bubbleParams.y + bubbleHeight > statusChipParams.y;
        if (!overlaps) return;
        if (!bubbleMovedForStatusMessage) {
            bubbleXBeforeStatusMessage = bubbleParams.x;
            bubbleYBeforeStatusMessage = bubbleParams.y;
            bubbleMovedForStatusMessage = true;
        }
        DisplayMetrics metrics = realDisplayMetrics();
        int safeTop = safeTopInsetPx() + dp(8);
        int maxY = bubbleSafeMaxY(metrics, bubbleHeight);
        bubbleParams.y = Math.max(safeTop, Math.min(maxY, chipBottom + dp(8)));
        try { windowManager.updateViewLayout(bubbleView, bubbleParams); } catch (Exception ignored) {}
    }

    private void restoreBubbleAfterStatusMessage() {
        if (!bubbleMovedForStatusMessage || bubbleView == null || bubbleParams == null || windowManager == null) return;
        DisplayMetrics metrics = realDisplayMetrics();
        int bubbleWidth = bubbleView.getWidth() > 0 ? bubbleView.getWidth() : dp(68);
        int bubbleHeight = bubbleView.getHeight() > 0 ? bubbleView.getHeight() : dp(32);
        int safeLeft = dp(8);
        int safeTop = safeTopInsetPx() + dp(8);
        int maxX = bubbleSafeMaxX(metrics, bubbleWidth);
        int maxY = bubbleSafeMaxY(metrics, bubbleHeight);
        bubbleParams.x = Math.max(safeLeft, Math.min(maxX, bubbleXBeforeStatusMessage));
        bubbleParams.y = Math.max(safeTop, Math.min(maxY, bubbleYBeforeStatusMessage));
        try { windowManager.updateViewLayout(bubbleView, bubbleParams); } catch (Exception ignored) {}
        bubbleMovedForStatusMessage = false;
        bubbleXBeforeStatusMessage = Integer.MIN_VALUE;
        bubbleYBeforeStatusMessage = Integer.MIN_VALUE;
    }

    private void adjustProMenuLayoutAfterMeasure() {
        if (menuView == null || menuParams == null || windowManager == null || !menuView.isAttachedToWindow()) return;
        int measuredMenuWidth = menuView.getWidth() > 0 ? menuView.getWidth() : dp(256);
        int menuHeight = menuView.getHeight() > 0 ? menuView.getHeight() : dp(220);
        DisplayMetrics metrics = realDisplayMetrics();
        int safeLeft = dp(8);
        int safeTop = safeTopInsetPx() + dp(8);
        int safeBottom = Math.max(safeTop, metrics.heightPixels - safeBottomInsetPx() - dp(8));
        int anchorBubbleY = bubbleParams != null ? bubbleParams.y : menuParams.y;
        int anchorBubbleHeight = bubbleView != null && bubbleView.getHeight() > 0 ? bubbleView.getHeight() : dp(32);
        int baseAnchoredY = GtoOverlayLayoutPolicy.centeredMenuYBesideBubble(
            anchorBubbleY,
            anchorBubbleHeight,
            menuHeight,
            safeTop,
            safeBottom
        );
        menuBaseY = baseAnchoredY;
        int desiredY = baseAnchoredY;
        if (statusChipView != null && statusChipParams != null) {
            int chipBottom = statusChipParams.y
                + (statusChipView.getHeight() > 0 ? statusChipView.getHeight() : dp(PRO_MESSAGE_MIN_BAND_DP));
            if (desiredY < chipBottom + dp(8)) {
                desiredY = GtoOverlayLayoutPolicy.clampMenuY(chipBottom + dp(8), menuHeight, safeTop, safeBottom);
            }
        }

        int safeRight = Math.max(safeLeft, metrics.widthPixels - dp(8));
        int gap = dp(8);
        int targetX = menuParams.x;
        int targetWidth = measuredMenuWidth;
        if (bubbleView != null && bubbleParams != null && bubbleView.isAttachedToWindow()) {
            int bubbleWidth = bubbleView.getWidth() > 0 ? bubbleView.getWidth() : dp(68);
            int bubbleHeight = bubbleView.getHeight() > 0 ? bubbleView.getHeight() : dp(32);
            int bubbleX = bubbleParams.x;
            int side = GtoOverlayLayoutPolicy.chooseMenuSideForBubble(
                bubbleX, bubbleWidth, measuredMenuWidth, safeLeft, safeRight, gap
            );
            int dockedBubbleX = GtoOverlayLayoutPolicy.bubbleXForMenuSide(
                side, bubbleX, bubbleWidth, measuredMenuWidth, safeLeft, safeRight, gap
            );
            if (dockedBubbleX != bubbleX) {
                bubbleParams.x = dockedBubbleX;
                bubbleAutoDockedForMenu = true;
                bubbleX = dockedBubbleX;
                try { windowManager.updateViewLayout(bubbleView, bubbleParams); } catch (Exception ignored) {}
            }

            int availableWidth = GtoOverlayLayoutPolicy.availableMenuWidthForBubbleSide(
                side, bubbleX, bubbleWidth, safeLeft, safeRight, gap
            );
            targetWidth = Math.max(1, Math.min(measuredMenuWidth, availableWidth));
            targetX = GtoOverlayLayoutPolicy.menuXBesideBubble(
                side, bubbleX, bubbleWidth, targetWidth, safeLeft, safeRight, gap
            );

            // A final invariant check prevents a clamped card from landing over the
            // bubble when the measured content is wider than the initial 256dp.
            if (GtoOverlayLayoutPolicy.overlaps(
                bubbleX, bubbleParams.y, bubbleWidth, bubbleHeight,
                targetX, desiredY, targetWidth, menuHeight
            )) {
                int alternateSide = side == GtoOverlayLayoutPolicy.SIDE_LEFT
                    ? GtoOverlayLayoutPolicy.SIDE_RIGHT
                    : GtoOverlayLayoutPolicy.SIDE_LEFT;
                int alternateWidth = GtoOverlayLayoutPolicy.availableMenuWidthForBubbleSide(
                    alternateSide, bubbleX, bubbleWidth, safeLeft, safeRight, gap
                );
                if (alternateWidth > availableWidth) {
                    side = alternateSide;
                    targetWidth = Math.max(1, Math.min(measuredMenuWidth, alternateWidth));
                    targetX = GtoOverlayLayoutPolicy.menuXBesideBubble(
                        side, bubbleX, bubbleWidth, targetWidth, safeLeft, safeRight, gap
                    );
                }
            }
        }

        boolean widthChanged = menuParams.width != targetWidth;
        if (widthChanged || targetX != menuParams.x || desiredY != menuParams.y) {
            menuParams.width = targetWidth;
            menuParams.x = targetX;
            menuParams.y = desiredY;
            try { windowManager.updateViewLayout(menuView, menuParams); } catch (Exception ignored) {}
        }
    }

    private void showStatusChip(String text, long durationMs) {
        showStatusChip(text, durationMs, false);
    }

    private void showStatusChip(String text, long durationMs, boolean allowDuringCaptureHidden) {
        if (mainHandler == null) return;
        mainHandler.post(() -> {
            if (prefs != null && prefs.getBoolean("captureUiHidden", false) && !allowDuringCaptureHidden) return;
            hideStatusChip();
            if (windowManager == null || !android.provider.Settings.canDrawOverlays(this)) return;
            TextView chip = new TextView(this);
            chip.setText(text == null ? "" : text);
            chip.setTextColor(Color.WHITE);
            chip.setTextSize(11f);
            chip.setGravity(Gravity.CENTER_VERTICAL);
            chip.setPadding(dp(12), dp(8), dp(12), dp(8));
            chip.setMaxLines(2);
            chip.setBackground(roundBackground(Color.rgb(31, 36, 43), 12));
            chip.setElevation(dp(7));
            WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
                overlayType(), WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                    | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                    | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT
            );
            params.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
            params.y = safeTopInsetPx() + dp(8);
            int screenWidth = getResources().getDisplayMetrics().widthPixels;
            params.x = 0;
            try {
                windowManager.addView(chip, params);
                moveMenuAwayFromStatusChip();
                statusChipView = chip;
                statusChipParams = params;
                moveBubbleAwayFromStatusChip();
                adjustProMenuLayoutAfterMeasure();
                final View shown = chip;
                statusChipHideRunnable = () -> {
                    if (statusChipView == shown) hideStatusChip();
                };
                mainHandler.postDelayed(statusChipHideRunnable, Math.max(5000L, durationMs));
            } catch (Exception ignored) {}
        });
    }

    private void hideStatusChip() {
        if (mainHandler != null && statusChipHideRunnable != null) {
            mainHandler.removeCallbacks(statusChipHideRunnable);
        }
        statusChipHideRunnable = null;
        if (statusChipView != null && windowManager != null) {
            try { windowManager.removeView(statusChipView); } catch (Exception ignored) {}
        }
        statusChipView = null;
        statusChipParams = null;
        restoreBubbleAfterStatusMessage();
        restoreMenuAfterStatusChip();
        adjustProMenuLayoutAfterMeasure();
    }

    private void moveMenuAwayFromStatusChip() {
        if (menuView == null || menuParams == null || windowManager == null) return;
        int minimumY = dp(16) + dp(72) + dp(12);
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
        if (prefs != null && prefs.getBoolean("captureUiHidden", false)) return;
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
        if (prefs != null && prefs.getBoolean("captureUiHidden", false)) return;
        if (windowManager == null || menuView != null) return;
        menuView = new LinearLayout(this);
        menuView.setOrientation(LinearLayout.VERTICAL);
        menuView.setPadding(dp(8), dp(8), dp(8), dp(8));
        menuView.setBackground(roundBackground(Color.argb(214, 28, 31, 36), 14));
        menuView.setElevation(dp(6));
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(false);
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        scroll.addView(content, new ScrollView.LayoutParams(-1, -2));
        String menuState = prefs.getString("simpleState", DEFAULT_STATE);
        boolean routeSelector = STATE_ROUTE_ORIGIN.equals(menuState) || STATE_ROUTE_DESTINATION.equals(menuState);
        LinearLayout.LayoutParams scrollParams = new LinearLayout.LayoutParams(-1, routeSelector ? dp(280) : -2);
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
        int requestedMenuWidth = dp(256);
        int menuWidth = requestedMenuWidth;
        int bubbleWidth = bubbleView != null && bubbleView.getWidth() > 0 ? bubbleView.getWidth() : dp(68);
        int bubbleHeight = bubbleView != null && bubbleView.getHeight() > 0 ? bubbleView.getHeight() : dp(32);
        int bubbleX = bubbleParams == null ? dp(8) : bubbleParams.x;
        int bubbleY = bubbleParams == null ? safeTop + dp(140) : bubbleParams.y;
        bubbleXBeforeMenuOpen = bubbleX;
        bubbleYBeforeMenuOpen = bubbleY;
        bubbleAutoDockedForMenu = false;
        int side = GtoOverlayLayoutPolicy.chooseMenuSideForBubble(
            bubbleX, bubbleWidth, menuWidth, safeLeft, safeRight, gap
        );
        int dockedBubbleX = GtoOverlayLayoutPolicy.bubbleXForMenuSide(
            side, bubbleX, bubbleWidth, menuWidth, safeLeft, safeRight, gap
        );
        if (bubbleView != null && bubbleParams != null
            && GtoOverlayLayoutPolicy.horizontalPairFits(safeLeft, safeRight, bubbleWidth, menuWidth, gap)
            && dockedBubbleX != bubbleX) {
            bubbleParams.x = dockedBubbleX;
            bubbleAutoDockedForMenu = true;
            try { windowManager.updateViewLayout(bubbleView, bubbleParams); } catch (Exception ignored) {}
            bubbleX = dockedBubbleX;
        }
        int availableMenuWidth = GtoOverlayLayoutPolicy.availableMenuWidthForBubbleSide(
            side, bubbleX, bubbleWidth, safeLeft, safeRight, gap
        );
        menuWidth = Math.max(1, Math.min(requestedMenuWidth, availableMenuWidth));
        menuParams.width = menuWidth;
        menuParams.x = GtoOverlayLayoutPolicy.menuXBesideBubble(
            side, bubbleX, bubbleWidth, menuWidth, safeLeft, safeRight, gap
        );
        menuParams.y = GtoOverlayLayoutPolicy.centeredMenuYBesideBubble(
            bubbleY, bubbleHeight, dp(220), safeTop, safeBottom
        );
        menuBaseY = menuParams.y;
        menuView.addOnLayoutChangeListener((view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
            if (right - left != oldRight - oldLeft || bottom - top != oldBottom - oldTop) {
                mainHandler.post(this::adjustProMenuLayoutAfterMeasure);
            }
        });
        menuView.setOnTouchListener((view, event) -> {
            if (event != null && event.getActionMasked() == MotionEvent.ACTION_OUTSIDE) {
                closeMenu();
                return true;
            }
            // The menu owns every touch inside its window. Child controls still
            // receive their normal click/scroll events; nothing falls through
            // to the simulator while the modal menu is open.
            return false;
        });
        try {
            windowManager.addView(menuView, menuParams);
            menuView.post(this::adjustProMenuLayoutAfterMeasure);
        } catch (Exception error) {
            menuView = null;
            restoreBubbleAfterMenu();
        }
    }

    private void refreshMenuContents() {
        if (prefs != null && prefs.getBoolean("captureUiHidden", false)) {
            closeMenu();
            hideSimpleBubbleRemoveTarget();
            hideStatusChip();
            return;
        }
        if (menuView == null) return;
        closeMenu();
        openMenu();
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
            historyRow.addView(historyButton, new LinearLayout.LayoutParams(dp(30), dp(30)));
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
            tripHeader.addView(operationInfo, new LinearLayout.LayoutParams(dp(30), dp(30)));
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
                target.addView(label("Operação concluída. Solicite uma nova operação para continuar.", 11f, false), fullParams(0, dp(5)));
                Button summary = menuButton("Operação atual");
                summary.setOnClickListener(v -> { summaryExpanded = true; refreshMenuContents(); });
                target.addView(summary, fullParams(dp(4), 0));
                return;
            }
            if (STATE_CANCELLED.equals(state)) target.addView(label("Viagem Pro cancelada.", 11f, false), fullParams(0, dp(3)));
            addActionRow(target, "Iniciar viagem", v -> {
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
        left.setLayoutParams(new LinearLayout.LayoutParams(0, dp(28), 1f));
        Button right = compactMenuButton(rightText);
        right.setOnClickListener(rightAction);
        LinearLayout.LayoutParams rightParams = new LinearLayout.LayoutParams(0, dp(28), 1f);
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
            LinearLayout.LayoutParams letterParams = new LinearLayout.LayoutParams(dp(28), dp(26));
            letterParams.topMargin = dp(2);
            letterParams.bottomMargin = dp(2);
            letterColumn.addView(letter, letterParams);
        }
        body.addView(letterColumn, new LinearLayout.LayoutParams(dp(42), -2));
        LinearLayout cityColumn = new LinearLayout(this);
        cityColumn.setOrientation(LinearLayout.VERTICAL);
        cityColumn.setPadding(dp(4), 0, 0, 0);
        for (String city : cities) {
            if (!selectedInitial.equals(initialOf(city))) continue;
            boolean activeCity = city.equalsIgnoreCase(prefs.getString(origin ? "origin" : "destination", ""));
            Button option = cityButton(city, activeCity);
            option.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
            option.setPadding(dp(10), 0, dp(8), 0);
            option.setMinHeight(dp(30));
            option.setMinimumHeight(dp(30));
            option.setOnClickListener(v -> {
                if (origin) {
                    prefs.edit().putString("origin", city).putString("simpleState", STATE_ROUTE_DESTINATION).apply();
                    selectedInitial = "";
                } else {
                    String selectedOrigin = prefs.getString("origin", "");
                    if (city.equalsIgnoreCase(selectedOrigin)) {
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
                    showStatusChip("Tudo preparado, podemos partir.", 2600L);
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
        int progress = Math.max(0, prefs.getInt("jobProgress", 0));
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
        button.setMinHeight(0);
        button.setMinWidth(0);
        button.setGravity(Gravity.CENTER);
        button.setPadding(dp(7), 0, dp(7), 0);
        button.setBackground(roundBackground(Color.argb(176, 62, 69, 79), 9));
        button.setLayoutParams(new LinearLayout.LayoutParams(-1, dp(31)));
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
        button.setMinWidth(dp(30));
        button.setMinimumWidth(dp(30));
        button.setMinHeight(dp(28));
        button.setMinimumHeight(dp(28));
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
        button.setLayoutParams(new LinearLayout.LayoutParams(-2, dp(28)));
        return button;
    }

    private Button infoMenuButton() {
        Button button = miniButton("ⓘ");
        button.setTextSize(16f);
        button.setContentDescription("Abrir operação atual");
        button.setPadding(0, 0, 0, 0);
        button.setLayoutParams(new LinearLayout.LayoutParams(dp(30), dp(30)));
        return button;
    }

    private Button historyMenuButton() {
        Button button = miniButton("☷");
        button.setTextSize(16f);
        button.setContentDescription("Abrir histórico de viagens da operação atual");
        button.setPadding(0, 0, 0, 0);
        button.setLayoutParams(new LinearLayout.LayoutParams(dp(30), dp(30)));
        return button;
    }

    private void addHistoryContents(LinearLayout target) {
        target.addView(label("VIAGENS REALIZADAS", 12f, true), fullParams(dp(2), dp(4)));
        try {
            JSONArray history = new JSONArray(prefs.getString("operationHistoryJson", "[]"));
            if (history.length() == 0) {
                target.addView(label("Nenhuma viagem confirmada nesta operação.", 10.5f, false), fullParams(0, dp(6)));
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
                card.addView(label(formatAmountCents(item.optLong("amountCents", 0L)), 11f, true), fullParams(0, 0));
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
        long absolute = Math.abs(amountCents);
        long whole = absolute / 100L;
        long cents = absolute % 100L;
        String grouped = String.format(Locale.ROOT, "%d", whole);
        StringBuilder formatted = new StringBuilder();
        for (int index = 0; index < grouped.length(); index++) {
            if (index > 0 && (grouped.length() - index) % 3 == 0) formatted.append('.');
            formatted.append(grouped.charAt(index));
        }
        return (amountCents < 0 ? "-" : "") + "R$ " + formatted + "," + String.format(Locale.ROOT, "%02d", cents);
    }

    private String latestHistoryPreview() {
        try {
            JSONArray history = new JSONArray(prefs.getString("operationHistoryJson", "[]"));
            if (history.length() == 0) return "Viagem registrada com sucesso.";
            JSONObject item = history.optJSONObject(history.length() - 1);
            if (item == null) return "Viagem registrada com sucesso.";
            return "VIAGEM REGISTRADA ✓\n"
                + safe(item.optString("origin", "")) + " → " + safe(item.optString("destination", ""))
                + "\n" + formatAmountCents(item.optLong("amountCents", 0L));
        } catch (JSONException ignored) {
            return "Viagem registrada com sucesso.";
        }
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
        if (menuView != null && windowManager != null) {
            try { windowManager.removeView(menuView); } catch (Exception ignored) {}
        }
        menuView = null;
        menuParams = null;
        restoreBubbleAfterMenu();
        if (statusChipView != null) moveBubbleAwayFromStatusChip();
    }

    private void hideCaptureInteractiveOverlaysKeepBubble() {
        cancelSimpleBubbleGesture("CAPTURE_HIDE_INTERACTIVE", false);
        hideSimpleBubbleRemoveTarget();
        hideStatusChip();
        closeMenu();
        removeBubbleForSensitiveScreen("MEDIA_PROJECTION_CONSENT");
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
                .putString("overlayLastAction", "removed:" + safe(reason))
                .apply();
        }
    }

    private void recordOverlayDiagnostic(String code, Throwable error) {
        if (prefs == null) return;
        String detail = error == null ? "" : safe(error.getClass().getSimpleName());
        prefs.edit()
            .putBoolean("overlayPermission", android.provider.Settings.canDrawOverlays(this))
            .putString("overlayType", String.valueOf(overlayType()))
            .putBoolean("bubbleVisible", bubbleView != null)
            .putBoolean("captureUiHidden", prefs.getBoolean("captureUiHidden", false))
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
        try {
            int configurationOrientation = getResources().getConfiguration().orientation;
            if (configurationOrientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE) return true;
            if (configurationOrientation == android.content.res.Configuration.ORIENTATION_PORTRAIT) return false;
        } catch (Exception ignored) {}
        DisplayMetrics metrics = realDisplayMetrics();
        return metrics.widthPixels > 0 && metrics.heightPixels > 0
            && metrics.widthPixels > metrics.heightPixels;
    }

    private boolean isConfiguredSimulatorForeground() {
        String packageId = safe(prefs == null ? "" : prefs.getString("packageId", ""));
        if (packageId.isEmpty()) return false;
        ActivityManager manager = (ActivityManager) getSystemService(ACTIVITY_SERVICE);
        if (manager == null) return false;

        boolean observed = false;
        String topPackage = "";
        try {
            // Visual visibility must be based on the current top task only. A task
            // appearing anywhere in getRunningTasks() is merely a recent task and
            // must never keep the NVU bubble visible after the driver leaves it.
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
                // A known non-simulator top task is authoritative for visual
                // visibility. Do not fall through to a stale visible process.
                prefs.edit().putString("foregroundCheckPackage", topPackage)
                    .putLong("foregroundCheckAt", System.currentTimeMillis()).apply();
                return false;
            }
        } catch (Exception ignored) {
            // Continue only when task information is genuinely unavailable.
        }

        // Fallback is deliberately stricter than the old implementation: a merely
        // VISIBLE process can remain alive after the user leaves the game. Only a
        // process reported as the actual foreground process may recover visibility
        // when the task API returns no usable task at all.
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
        boolean captureHidden = prefs.getBoolean("captureUiHidden", false);
        boolean horizontal = isProBubbleOrientationAllowed();
        if (horizontal) {
            simulatorVisible = true;
            simulatorVisibilityEstablished = true;
            simulatorLaunchPending = false;
            prefs.edit().putString("simulatorVisibility", "UNKNOWN")
                .putString("bubbleOrientation", "HORIZONTAL")
                .putBoolean("bubbleOrientationHorizontal", true)
                .putBoolean("visibilityEstablished", false).apply();
            // During capture the bubble remains an orientation-only visual affordance.
            // MediaProjection and OCR never depend on this branch.
            showBubbleIfAllowed();
            if (menuView != null && menuParams != null) {
                mainHandler.post(this::adjustProMenuLayoutAfterMeasure);
            }
        } else {
            // A launch handshake is not evidence that the simulator is visible.
            // Clear it on every negative sample so a recent task/process cannot
            // keep the bubble alive after the driver leaves the game.
            simulatorLaunchPending = false;
            prefs.edit().remove("pendingSimulatorLaunchPackage").remove("pendingSimulatorLaunchAt").apply();
            simulatorVisible = false;
            simulatorVisibilityEstablished = true;
            prefs.edit().putString("simulatorVisibility", "UNKNOWN")
                .putString("bubbleOrientation", "VERTICAL")
                .putBoolean("bubbleOrientationHorizontal", false)
                .putBoolean("visibilityEstablished", false).apply();
            // Visual state only: never cancel or reject an already authorized
            // one-shot capture because NVU/consent becomes the observed surface.
            hideBubbleForSimulatorOutside();
        }
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
