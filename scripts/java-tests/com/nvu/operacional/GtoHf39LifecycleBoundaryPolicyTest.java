package com.nvu.operacional;

public final class GtoHf39LifecycleBoundaryPolicyTest {
    private static void req(boolean v, String m) { if (!v) throw new AssertionError(m); }

    public static void main(String[] args) {
        req(GtoFreightLifecycleBoundaryPolicy.mayReplaceCurrentContext("TRIP_IN_PROGRESS", false),
            "active trip must be replaceable by a certified list");
        req(GtoFreightLifecycleBoundaryPolicy.mayReplaceCurrentContext("RESULT_DETECTED", false),
            "result must be replaceable by a certified list");
        req(GtoFreightLifecycleBoundaryPolicy.mayReplaceCurrentContext("AWAITING_BONUS_VALIDATION", false),
            "bonus/result state must be replaceable by a certified list");
        req(GtoFreightLifecycleBoundaryPolicy.mayReplaceCurrentContext("CONFIRMING_FREIGHT", true),
            "stale manual review must be replaceable by a certified list");
        req(!GtoFreightLifecycleBoundaryPolicy.mayReplaceCurrentContext("CONFIRMING_FREIGHT", false),
            "automatic immutable-row confirmation must not be restarted by the original list frame");
        req(!GtoFreightLifecycleBoundaryPolicy.mayReplaceCurrentContext("WAITING_FREIGHT", false),
            "waiting state already owns the list and must not replace itself");
        req(GtoFreightLifecycleBoundaryPolicy.mustClearStaleReviewOnCertifiedList(
            "CONFIRMING_FREIGHT", true, true, 2, 55L),
            "two certified frames must clear stale review");
        req(!GtoFreightLifecycleBoundaryPolicy.mustClearStaleReviewOnCertifiedList(
            "CONFIRMING_FREIGHT", true, false, 10, 500L),
            "visual-only list may not clear review");
        req(!GtoFreightLifecycleBoundaryPolicy.mustClearStaleReviewOnCertifiedList(
            "CONFIRMING_FREIGHT", true, true, 1, 500L),
            "one frame may not clear review");
        System.out.println("GtoHf39LifecycleBoundaryPolicyTest: PASS");
    }
}
