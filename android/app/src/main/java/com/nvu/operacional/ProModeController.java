package com.nvu.operacional;

import android.content.Context;

/**
 * Single entry coordinator for the Android Pro mode.
 *
 * The system overlay permission is queried only at an explicit Pro start click
 * and when the activity resumes after this controller opened Android settings.
 * Services consume the cached decision; they do not call Settings.canDrawOverlays
 * on every lifecycle, overlay or foreground transition.
 *
 * The service start itself is intentionally fire-and-return: Android continues
 * foreground-service preparation in the background while the Web/native UI can
 * render the operation immediately.
 */
public final class ProModeController {
    public enum Mode {
        SIMPLE_AUTOMATION,
        GTO_OBSERVER
    }

    public enum StartResult {
        STARTED,
        OVERLAY_PERMISSION,
        START_FAILED
    }

    private static final Object LOCK = new Object();
    private static volatile Boolean cachedOverlayPermission;
    private static volatile boolean cachedPermissionIsTemporary;
    private static volatile boolean awaitingOverlaySettingsReturn;
    private static volatile long lastOverlayValidationAt;
    private static volatile String lastOverlayValidationReason = "UNKNOWN";

    private ProModeController() {}

    /**
     * Validates the one permission required at the user's Pro start boundary.
     */
    public static boolean validateOverlayAtEntry(Context context) {
        return refreshOverlayPermission(context, "ENTRY");
    }

    /**
     * Refreshes permission only for the initial activity resume or the return
     * from the Android overlay settings opened by this controller.
     */
    public static boolean onActivityResume(Context context) {
        if (cachedOverlayPermission == null || awaitingOverlaySettingsReturn) {
            return refreshOverlayPermission(context, awaitingOverlaySettingsReturn ? "SETTINGS_RETURN" : "INITIAL_RESUME");
        }
        return hasOverlay(context);
    }

    /**
     * Cached read used by services and status payloads. This method never asks
     * Android Settings again; the controller owns the two allowed query points.
     */
    public static boolean hasOverlay(Context context) {
        // The projection service marks itself active only after Android has
        // actually granted overlay. Its lifetime bounds the temporary grant.
        return ProOverlayAuthorizationPolicy.isAuthorized(cachedOverlayPermission,
            cachedPermissionIsTemporary, ProOverlayProbeService.isActive());
    }

    public static void onServiceCreate(Context context) {
        // A restarted foreground service has no Activity to seed this cache.
        if (cachedOverlayPermission == null) refreshOverlayPermission(context, "SERVICE_RESTORE");
    }

    /** A rejected window is concrete evidence that the cached grant may be stale. */
    public static boolean onOverlayWindowRejected(Context context) {
        return refreshOverlayPermission(context, "WINDOW_REJECTED");
    }

    public static boolean isOverlayPermissionKnown() {
        return cachedOverlayPermission != null;
    }

    public static long getLastOverlayValidationAt() {
        return lastOverlayValidationAt;
    }

    public static String getLastOverlayValidationReason() {
        return lastOverlayValidationReason;
    }

    public static void openOverlaySettings(Context context) {
        synchronized (LOCK) {
            awaitingOverlaySettingsReturn = true;
        }
        android.content.Intent intent = new android.content.Intent(context, ProOverlayPermissionSetupActivity.class);
        intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
    }

    /**
     * Single native start boundary for either Pro implementation.
     */
    public static StartResult start(Context context, Mode mode) {
        if (!validateOverlayAtEntry(context)) return StartResult.OVERLAY_PERMISSION;
        return startAfterValidation(context, mode);
    }

    /**
     * Starts a service after the caller has already performed the one entry
     * validation for this user action.
     */
    public static StartResult startAfterValidation(Context context, Mode mode) {
        if (context == null || !hasOverlay(context)) return StartResult.OVERLAY_PERMISSION;
        try {
            boolean started = mode == Mode.GTO_OBSERVER
                ? GtoObserverService.startIfAllowed(context)
                : SimpleAutomationService.startIfAllowed(context);
            return started ? StartResult.STARTED : StartResult.START_FAILED;
        } catch (Exception error) {
            return StartResult.START_FAILED;
        }
    }

    private static boolean refreshOverlayPermission(Context context, String reason) {
        if (context == null) return false;
        boolean granted = NvuPermissionManager.hasOverlay(context.getApplicationContext());
        synchronized (LOCK) {
            cachedOverlayPermission = granted;
            cachedPermissionIsTemporary = granted && ProOverlayProbeService.isActive();
            awaitingOverlaySettingsReturn = false;
            lastOverlayValidationAt = System.currentTimeMillis();
            lastOverlayValidationReason = reason == null ? "UNKNOWN" : reason;
        }
        return granted || ProOverlayProbeService.isActive();
    }
}
