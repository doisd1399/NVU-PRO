package com.nvu.operacional;

/**
 * Pure interaction policy for freight selection and the manual route picker.
 *
 * The early-touch window only arms correlation; it never commits a freight. Final
 * selection still requires the immutable before/after transaction and the existing
 * semantic/OCR validation in GtoObserverService.
 */
final class GtoSelectionInteractionPolicy {
    static final long MAX_FRESH_LIST_AGE_MS = 1_100L;

    private GtoSelectionInteractionPolicy() {}

    static boolean mayArmFromFreshFreightList(
        boolean waitingForFreight,
        boolean analysisPausedOutsideGto,
        long now,
        long lastFreightListSeenAt,
        int acceptButtonCount,
        boolean visualGenerationMatches,
        boolean captureReadyForAnalysis,
        boolean confirmedFreightList,
        boolean candidateFreightList,
        boolean recentForegroundProof
    ) {
        if (!waitingForFreight || analysisPausedOutsideGto || now <= 0L) return false;
        if (lastFreightListSeenAt <= 0L || now < lastFreightListSeenAt
            || now - lastFreightListSeenAt > MAX_FRESH_LIST_AGE_MS) return false;
        if (acceptButtonCount < 1 || acceptButtonCount > 6) return false;
        if (!visualGenerationMatches || !captureReadyForAnalysis) return false;
        return confirmedFreightList || candidateFreightList || recentForegroundProof;
    }

    static boolean shouldRestoreRouteScroll(String previousStep, String currentStep) {
        if (previousStep == null || currentStep == null) return false;
        return !previousStep.trim().isEmpty() && previousStep.equals(currentStep);
    }

    static int safeScrollY(int scrollY) {
        return Math.max(0, scrollY);
    }
}

