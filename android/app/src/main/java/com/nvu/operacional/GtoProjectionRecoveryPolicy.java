package com.nvu.operacional;

/** Pure policy for deciding when capture recovery should request a fresh Android grant. */
final class GtoProjectionRecoveryPolicy {
    private GtoProjectionRecoveryPolicy() {}

    static boolean shouldEscalateSurfaceRecovery(
        int rebindAttempts,
        boolean gtoForeground,
        boolean captureNeeded,
        boolean permissionInFlight,
        long now,
        long lastFrameAt,
        long lastAnalyzedAt,
        long startedAt,
        long staleThresholdMs
    ) {
        if (rebindAttempts < 3 || !gtoForeground || !captureNeeded || permissionInFlight) return false;
        long reference = Math.max(startedAt, Math.max(lastFrameAt, lastAnalyzedAt));
        if (reference <= 0L || now < reference) return false;
        return now - reference >= Math.max(1L, staleThresholdMs);
    }

    static boolean shouldAutoRequest(
        boolean reauthRequired,
        boolean autoAllowed,
        boolean gtoForeground,
        boolean exactGtoPackage,
        boolean landscape,
        boolean bubbleAttached,
        boolean captureNeeded,
        boolean projectionActive,
        boolean surfacePending,
        boolean permissionInFlight,
        long now,
        long lastAutoRequestAt,
        long cooldownMs
    ) {
        if (!reauthRequired || !autoAllowed || !gtoForeground || !exactGtoPackage || !landscape
            || !bubbleAttached || !captureNeeded || projectionActive || surfacePending || permissionInFlight) return false;
        return lastAutoRequestAt <= 0L || (now >= lastAutoRequestAt && now - lastAutoRequestAt >= cooldownMs);
    }
}
