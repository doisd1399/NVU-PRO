package com.nvu.operacional;

/**
 * HF16: small, state-oriented rules for screen transitions.
 *
 * The detector deliberately prefers a few strong semantic/interaction signals over
 * broad color/layout signatures.  It has no Android dependencies so the invariants
 * can be regression-tested without an emulator.
 */
final class GtoSimpleScreenDetectionPolicy {
    private GtoSimpleScreenDetectionPolicy() {}

    static boolean isCompletedResult(boolean completionWord, boolean monetaryValuePresent) {
        return completionWord && monetaryValuePresent;
    }

    static boolean isStableFreightListReturn(
        String state,
        boolean listPresent,
        int observedFrames,
        long visibleForMs
    ) {
        // The jobs list is a canonical lifecycle screen both before a freight exists and
        // after a route/result becomes stale. Two strict visual frames avoid a one-frame
        // false positive while still bootstrapping IDLE/CANCELLED in well under 100 ms.
        boolean lifecycleBoundary = "IDLE".equals(state)
            || "CANCELLED".equals(state)
            || "TRIP_IN_PROGRESS".equals(state)
            || "RESULT_DETECTED".equals(state)
            || "AWAITING_BONUS_VALIDATION".equals(state);
        return lifecycleBoundary
            && listPresent
            && observedFrames >= 2
            && visibleForMs >= 55L;
    }

    static boolean isCertifiedFreightListReturn(
        String state,
        boolean visualListPresent,
        boolean semanticListCertified,
        int observedFrames,
        long visibleForMs
    ) {
        // HF35: visual repetition is necessary for speed, semantic repetition is
        // necessary for authority. A HUB/HUD lookalike may be observed, but it cannot
        // cross the lifecycle boundary without same-page Aceitar + Km + value evidence.
        return semanticListCertified && isStableFreightListReturn(
            state, visualListPresent, observedFrames, visibleForMs
        );
    }

    static boolean mayReplaceCancelledTripOnNewAccept(
        String state,
        boolean listCandidateArmed,
        boolean stableReturnedList,
        boolean touchOrPressedRowEvidence,
        boolean exactAcceptRowEvidence
    ) {
        return "TRIP_IN_PROGRESS".equals(state)
            && listCandidateArmed
            && (stableReturnedList || exactAcceptRowEvidence || touchOrPressedRowEvidence);
    }
}
