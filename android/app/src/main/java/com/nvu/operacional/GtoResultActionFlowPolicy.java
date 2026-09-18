package com.nvu.operacional;

/**
 * Pure policy for the irreversible GTO result action.
 *
 * Receber closes the result dialog permanently, so input observation must already be
 * attached before RESULT_DETECTED is entered and post-action recognition must inspect
 * the full GTO frame (the HUD lives outside the central result-dialog crop).
 */
final class GtoResultActionFlowPolicy {
    private GtoResultActionFlowPolicy() {}

    static boolean keepPassiveTouchObserver(
        boolean observeEnabled,
        boolean gtoForeground,
        boolean overlayAllowed
    ) {
        return observeEnabled && gtoForeground && overlayAllowed;
    }

    /** HF188: keep the passive listener attached for the whole enabled overlay session.
     * MediaProjection can be temporarily unauthorized while its surface is rebinding or
     * recovering. Removing ACTION_OUTSIDE during that short window loses the driver's
     * first tap even though the GTO is still visible. Listener presence is transport only:
     * action mutation remains separately guarded by current GTO context, fresh list
     * geometry, human coordinates and the immutable selection transaction.
     */
    static boolean keepPassiveTransportObserver(
        boolean observeEnabled,
        boolean authorizedCaptureSession,
        boolean overlayAllowed
    ) {
        return observeEnabled && overlayAllowed;
    }

    static boolean useFullFramePostResult(
        String state,
        String action,
        boolean receiveLatched,
        boolean fallbackRequired,
        long resultExitSeenAt,
        boolean certifiedResultSeen,
        boolean resultDialogVisuallyPresent
    ) {
        boolean resultState = "RESULT_DETECTED".equals(state)
            || "AWAITING_BONUS_VALIDATION".equals(state)
            || "CONFIRMING_FREIGHT".equals(state);
        if (!resultState) return false;
        String safeAction = action == null ? "" : action;
        boolean actionPending = "TOUCH_PENDING".equals(safeAction)
            || safeAction.startsWith("RECEIVE")
            || "ADS".equals(safeAction);
        boolean certifiedDialogGone = certifiedResultSeen && !resultDialogVisuallyPresent;
        return actionPending || receiveLatched || fallbackRequired || resultExitSeenAt > 0L || certifiedDialogGone;
    }

    static boolean shouldPromoteGameplayReturnToReceive(
        String state,
        boolean actionBacked,
        boolean adEvidence,
        int gameplayFrames,
        long exitAgeMs,
        int visuallyAbsentResultFrames
    ) {
        boolean resultState = "RESULT_DETECTED".equals(state)
            || "AWAITING_BONUS_VALIDATION".equals(state)
            || "CONFIRMING_FREIGHT".equals(state);
        boolean transitionOnlyFallback = visuallyAbsentResultFrames >= 3 && exitAgeMs >= 260L;
        return resultState
            && !adEvidence
            && gameplayFrames >= 2
            && exitAgeMs >= 120L
            && (actionBacked || transitionOnlyFallback);
    }

    static boolean mayCommitCompletedTrip(boolean receiveLatched) {
        return receiveLatched;
    }
}
