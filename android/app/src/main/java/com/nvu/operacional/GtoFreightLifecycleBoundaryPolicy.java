package com.nvu.operacional;

/**
 * Canonical authority for a real, semantically certified GTO freight-list boundary.
 *
 * A freight list is not informational. When it is visible again while a route/result is
 * active, the previous journey is over in the simulator. The same applies to an
 * unresolved CONFIRMING_FREIGHT review: a review card must never survive over a new real
 * list, otherwise stale row data can leak into the next freight selection.
 */
final class GtoFreightLifecycleBoundaryPolicy {
    private GtoFreightLifecycleBoundaryPolicy() {}

    /**
     * A certified jobs list is authoritative in two distinct situations:
     * 1) there is no current trip yet (IDLE/CANCELLED), so the list bootstraps a fresh
     *    WAITING_FREIGHT session; or
     * 2) an old active/review context exists and the certified list replaces it.
     *
     * Keeping both cases behind one policy prevents the observer from seeing a real list
     * while remaining stuck in IDLE/CANCELLED with the touch sensor disabled.
     */
    static boolean mayHandleCertifiedFreightBoundary(String state, boolean freightReviewPending) {
        return mayBootstrapFreshSelection(state) || mayReplaceCurrentContext(state, freightReviewPending);
    }

    static boolean mayBootstrapFreshSelection(String state) {
        return "IDLE".equals(state) || "CANCELLED".equals(state);
    }

    static boolean mayReplaceCurrentContext(String state, boolean freightReviewPending) {
        if (state == null) return false;
        if ("TRIP_IN_PROGRESS".equals(state)
            || "RESULT_DETECTED".equals(state)
            || "AWAITING_BONUS_VALIDATION".equals(state)) return true;
        return "CONFIRMING_FREIGHT".equals(state) && freightReviewPending;
    }

    static boolean isPendingFreightReviewReplacement(String state, boolean freightReviewPending) {
        return "CONFIRMING_FREIGHT".equals(state) && freightReviewPending;
    }

    static boolean mustClearStaleReviewOnCertifiedList(
        String state,
        boolean freightReviewPending,
        boolean semanticallyCertified,
        int visualFrames,
        long visibleForMs
    ) {
        return isPendingFreightReviewReplacement(state, freightReviewPending)
            && semanticallyCertified
            && visualFrames >= 2
            && visibleForMs >= 55L;
    }
}
