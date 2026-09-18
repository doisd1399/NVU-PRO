package com.nvu.operacional;

/**
 * HF30 projection-continuity rules.
 *
 * MediaProjection liveness is independent from UsageStats. Once the user has granted a
 * session over a verified GTO task, missing/late foreground events must not be able to
 * stop frame delivery. Foreground evidence only gates interpretation of pixels; it does
 * not gate repair of ImageReader/VirtualDisplay delivery.
 */
final class GtoProjectionContinuityPolicy {
    private GtoProjectionContinuityPolicy() {}

    static boolean mayProbeWaitingFreightDuringForegroundLag(
        boolean projectionActive,
        boolean verifiedGtoSession,
        boolean waitingForFreight,
        boolean transientSurface,
        boolean packageMatchesGto,
        boolean packageUnknown,
        boolean packageIsNvu
    ) {
        if (!projectionActive || !verifiedGtoSession || !waitingForFreight || transientSurface) return false;
        // NVU can remain the last UsageStats owner after the transparent consent host exits.
        // A strict multi-row GTO freight screen is the authority that resolves that stale
        // owner. A positively identified unrelated application is not eligible here.
        return packageMatchesGto || packageUnknown || packageIsNvu;
    }

    /**
     * HF63/HF88: after leaving GTO for a call/browser/other app, UsageStats and the NVU
     * activity latch can remain stale after the driver is visibly back in the simulator.
     * Keep only the strict OCR-free freight recognizer alive in that paused state. The
     * stale package/latch is never trusted: two current freight-list frames must prove GTO
     * before ordinary analysis resumes, and semantic row/money checks remain mandatory.
     */
    static boolean mayProbeFreightReturnDuringForegroundLag(
        boolean projectionActive,
        boolean tokenAndDisplayPresent,
        boolean verifiedGtoSession,
        boolean freightReturnEligibleState,
        boolean analysisPaused,
        boolean transientSurface,
        boolean nvuMainActivityForeground,
        boolean captureGeometryValid
    ) {
        return projectionActive
            && tokenAndDisplayPresent
            && verifiedGtoSession
            && freightReturnEligibleState
            && analysisPaused
            && !transientSurface
            // The caller provides the current strict freight-list signature. A stale NVU
            // activity latch must not veto that signature and freeze the return forever.
            && captureGeometryValid;
    }

    /**
     * HF55: while a durable trip is active, keep a tiny result-only probe alive even if
     * UsageStats is stale after a call/app switch. The probe may inspect pixels but may
     * only attempt same-frame OCR after the strict result-modal visual signature matches;
     * semantic Concluído + payout certification is required before GTO foreground is restored.
     */
    static boolean mayProbeResultDuringForegroundLag(
        boolean projectionActive,
        boolean tokenAndDisplayPresent,
        boolean resultTrackingState,
        boolean analysisPaused,
        boolean transientSurface,
        boolean nvuMainActivityForeground,
        boolean captureGeometryValid
    ) {
        return projectionActive
            && tokenAndDisplayPresent
            && resultTrackingState
            && analysisPaused
            && !transientSurface
            && !nvuMainActivityForeground
            && captureGeometryValid;
    }

    static boolean shouldRepairPartialSurface(
        boolean captureNeeded,
        boolean projectionActive,
        boolean tokenPresent,
        boolean displayPresent,
        boolean surfacePending,
        boolean readerPresent,
        boolean handlerPresent
    ) {
        if (!captureNeeded || !projectionActive || !tokenPresent || !displayPresent || surfacePending) return false;
        return !readerPresent || !handlerPresent;
    }

    static boolean shouldKeepRecoveringSameGrant(
        boolean captureNeeded,
        boolean projectionActive,
        boolean tokenPresent,
        boolean displayPresent
    ) {
        return captureNeeded && projectionActive && tokenPresent && displayPresent;
    }

    static boolean needsFreshGrant(
        boolean captureNeeded,
        boolean projectionActive,
        boolean tokenPresent,
        boolean displayPresent,
        boolean surfacePending,
        boolean virtualDisplayEverCreated
    ) {
        if (!captureNeeded || surfacePending) return false;
        // No token on a fresh WAITING_FREIGHT session is not a "lost grant"; the ordinary
        // initial-consent path owns that state. A fresh grant is required here only when
        // our runtime still claims an active projection whose token vanished.
        if (!tokenPresent) return projectionActive;
        // Android 14+ permits one VirtualDisplay per MediaProjection grant. If that display
        // itself is gone after having been created, a new Android grant is the only legal
        // recovery path. Missing ImageReader/handler alone is repairable on the same display.
        return projectionActive && virtualDisplayEverCreated && !displayPresent;
    }
}
