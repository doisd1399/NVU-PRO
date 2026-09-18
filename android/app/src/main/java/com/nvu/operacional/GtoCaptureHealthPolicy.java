package com.nvu.operacional;

/**
 * Pure capture-health policy. A MediaProjection object existing in memory is not proof
 * that the observer is alive: real frames must arrive and the analysis pipeline must
 * consume them recently while GTO is visible.
 */
final class GtoCaptureHealthPolicy {
    static final long FRAME_HEALTH_FRESH_MS = 1800L;
    static final long ANALYSIS_HEALTH_FRESH_MS = 2400L;

    private GtoCaptureHealthPolicy() {}

    /**
     * HF90 transport authority. Foreground, UsageStats, OCR and geometry readiness
     * belong to other layers and must never turn a live frame transport unhealthy.
     */
    static boolean isTransportHealthy(
        boolean captureEnabled,
        boolean tokenPresent,
        boolean displayPresent,
        boolean readerPresent,
        boolean handlerPresent,
        long now,
        long lastFrameAt,
        long lastAnalyzedAt
    ) {
        if (!captureEnabled || !tokenPresent || !displayPresent || !readerPresent || !handlerPresent) return false;
        if (now <= 0L || lastFrameAt <= 0L || lastAnalyzedAt <= 0L) return false;
        if (now < lastFrameAt || now < lastAnalyzedAt) return false;
        return now - lastFrameAt <= FRAME_HEALTH_FRESH_MS
            && now - lastAnalyzedAt <= ANALYSIS_HEALTH_FRESH_MS;
    }

    static boolean isHealthy(
        boolean projectionActive,
        boolean tokenPresent,
        boolean displayPresent,
        boolean readerPresent,
        boolean handlerPresent,
        boolean gtoForeground,
        boolean analysisPaused,
        boolean stabilityReady,
        long now,
        long lastFrameAt,
        long lastAnalyzedAt
    ) {
        if (!projectionActive || !tokenPresent || !displayPresent || !readerPresent || !handlerPresent) return false;
        // Legacy action-readiness contract retained for compatibility. Runtime transport
        // health must use isTransportHealthy() instead of this foreground-coupled method.
        // HF32: white means the detector is actually capable of interpreting the current
        // GTO stream. Buffer delivery/stability alone is not enough, otherwise the UI can
        // claim healthy while every classifier frame is being gated away.
        if (!gtoForeground || analysisPaused || !stabilityReady) return false;
        if (now <= 0L || lastFrameAt <= 0L || lastAnalyzedAt <= 0L) return false;
        if (now < lastFrameAt || now < lastAnalyzedAt) return false;
        return now - lastFrameAt <= FRAME_HEALTH_FRESH_MS
            && now - lastAnalyzedAt <= ANALYSIS_HEALTH_FRESH_MS;
    }

    static boolean shouldRecoverSurface(
        boolean projectionActive,
        boolean tokenPresent,
        boolean displayPresent,
        boolean readerPresent,
        boolean handlerPresent,
        boolean gtoForeground,
        boolean analysisPaused,
        boolean surfacePending,
        boolean permissionInFlight,
        long now,
        long lastFrameAt,
        long lastAnalyzedAt,
        long projectionStartedAt,
        long lastRecoveryAt,
        long firstFrameTimeoutMs,
        long staleFrameTimeoutMs,
        long staleAnalysisTimeoutMs,
        long recoveryCooldownMs
    ) {
        if (!projectionActive || !tokenPresent || !displayPresent || !readerPresent || !handlerPresent) return false;
        if (surfacePending || permissionInFlight) return false;
        long frameReferenceAt = lastFrameAt > 0L ? lastFrameAt : Math.max(projectionStartedAt, lastRecoveryAt);
        if (frameReferenceAt <= 0L || now < frameReferenceAt) return false;
        long frameTimeout = lastFrameAt > 0L ? staleFrameTimeoutMs : firstFrameTimeoutMs;
        boolean frameDeliveryStalled = now - frameReferenceAt >= frameTimeout;

        long analysisReferenceAt = lastAnalyzedAt > 0L
            ? lastAnalyzedAt
            : Math.max(projectionStartedAt, lastRecoveryAt);
        boolean analysisStalled = gtoForeground
            && !analysisPaused
            && analysisReferenceAt > 0L
            && now >= analysisReferenceAt
            && now - analysisReferenceAt >= staleAnalysisTimeoutMs;

        if (!frameDeliveryStalled && !analysisStalled) return false;
        return lastRecoveryAt <= 0L || now - lastRecoveryAt >= recoveryCooldownMs;
    }
}
