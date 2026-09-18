package com.nvu.operacional;

/**
 * HF23: durable-session recovery policy isolated from Android lifecycle details.
 * A confirmed selected row under field review survives process death. Session age is
 * diagnostic only; a valid durable snapshot is never discarded solely because time elapsed.
 */
final class GtoSessionRecoveryPolicy {
    private GtoSessionRecoveryPolicy() {}

    static String restoredState(
        String restoredState,
        String selectionIdentityStatus,
        String selectionConfirmationStatus,
        String reviewRequiredField
    ) {
        return restoredState(
            restoredState, selectionIdentityStatus, selectionConfirmationStatus, reviewRequiredField, ""
        );
    }

    static String restoredState(
        String restoredState,
        String selectionIdentityStatus,
        String selectionConfirmationStatus,
        String reviewRequiredField,
        String selectionIdentitySource
    ) {
        String state = restoredState == null ? "" : restoredState.trim();
        if (!"CONFIRMING_FREIGHT".equals(state)) return state;
        boolean confirmedReview = GtoSelectionEvidencePolicy.mayRestoreConfirmedSelection(
                selectionIdentityStatus, selectionIdentitySource
            )
            && "REVIEW_REQUIRED".equals(selectionConfirmationStatus)
            && reviewRequiredField != null
            && !reviewRequiredField.trim().isEmpty();
        return confirmedReview ? "CONFIRMING_FREIGHT" : "WAITING_FREIGHT";
    }

    static boolean keepDurableSession(boolean hasRecoverableSnapshot, long ageMs, long diagnosticStaleMs) {
        // ageMs/diagnosticStaleMs intentionally do not authorize destruction. They exist
        // only so callers may surface LONG_RUNNING_SESSION diagnostics.
        return hasRecoverableSnapshot;
    }

    static boolean isLongRunning(long ageMs, long diagnosticStaleMs) {
        return ageMs > diagnosticStaleMs && diagnosticStaleMs > 0L;
    }
}
