package com.nvu.operacional;

/**
 * HF47 lifecycle policy for an already-certified GTO result.
 *
 * Certification is durable; volatile observer clocks are not. This policy deliberately
 * does not depend on resultScreenLastSeenAt so a service/process recreation cannot make
 * a protected delivery invisible to the terminal resolver.
 */
final class GtoCertifiedResultLifecyclePolicy {
    private GtoCertifiedResultLifecyclePolicy() {}

    static boolean shouldTrack(String state, boolean certifiedResult, boolean watchedAdEvidence) {
        if (!certifiedResult || watchedAdEvidence) return false;
        return "RESULT_DETECTED".equals(state)
            || "AWAITING_BONUS_VALIDATION".equals(state)
            || "CONFIRMING_FREIGHT".equals(state);
    }

    static long restoreCertifiedSeenAt(boolean certifiedResult, long volatileLastSeenAt, long durableCertifiedAt, long now) {
        if (!certifiedResult) return 0L;
        if (volatileLastSeenAt > 0L) return volatileLastSeenAt;
        if (durableCertifiedAt > 0L) return durableCertifiedAt;
        return Math.max(1L, now);
    }

    static boolean shouldArmFrameResolver(int visuallyAbsentFrames) {
        return visuallyAbsentFrames >= GtoResultCompletionPolicy.PASSIVE_EXIT_MIN_ABSENT_FRAMES;
    }
}
