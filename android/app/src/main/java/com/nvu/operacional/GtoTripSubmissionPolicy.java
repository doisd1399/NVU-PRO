package com.nvu.operacional;

/**
 * Single terminal gate for GTO trip submission.
 *
 * A queue entry is an outbox detail, not permission to create a delivery. The
 * permission must come from the current session's terminal result proof.
 */
final class GtoTripSubmissionPolicy {
    private GtoTripSubmissionPolicy() {}

    static boolean maySubmit(
        String tripState,
        String completionStatus,
        boolean certifiedResult,
        String sessionId
    ) {
        return "RESULT_CONFIRMED".equals(clean(tripState))
            && "CONFIRMED_NORMAL".equals(clean(completionStatus))
            && certifiedResult
            && !clean(sessionId).isEmpty();
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }
}
