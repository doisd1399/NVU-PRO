package com.nvu.operacional;

public final class GtoHf41ReceiveFlowPolicyTest {
    private static void req(boolean ok, String message) {
        if (!ok) throw new AssertionError(message);
    }

    public static void main(String[] args) {
        req(GtoResultActionFlowPolicy.keepPassiveTouchObserver(true, true, true),
            "touch observer must already be alive while normal GTO gameplay is active");
        req(GtoResultActionFlowPolicy.keepPassiveTransportObserver(true, false, true),
            "passive transport must remain attached during temporary capture recovery");
        req(!GtoResultActionFlowPolicy.keepPassiveTouchObserver(false, true, true),
            "disabled Observe must not keep input observer alive");

        req(!GtoResultActionFlowPolicy.useFullFramePostResult(
            "RESULT_DETECTED", "", false, false, 0L, true, true),
            "before any result action, central result OCR remains the fast path");
        req(GtoResultActionFlowPolicy.useFullFramePostResult(
            "RESULT_DETECTED", "TOUCH_PENDING", false, false, 0L, true, false),
            "after a redacted Receive/ADS touch, full-frame OCR is mandatory");
        req(GtoResultActionFlowPolicy.useFullFramePostResult(
            "RESULT_DETECTED", "", false, false, 1L, true, false),
            "after the result dialog first disappears, HUD must be read from full frame");
        req(GtoResultActionFlowPolicy.useFullFramePostResult(
            "AWAITING_BONUS_VALIDATION", "", false, true, 0L, true, false),
            "OEM input fallback also requires full-frame post-result classification");

        req(GtoResultActionFlowPolicy.shouldPromoteGameplayReturnToReceive(
            "RESULT_DETECTED", true, false, 2, 120L, 1),
            "two stable HUD frames after an observed result action confirm normal Receive");
        req(!GtoResultActionFlowPolicy.shouldPromoteGameplayReturnToReceive(
            "RESULT_DETECTED", false, false, 2, 200L, 2),
            "one ambiguous transition must not fabricate Receive");
        req(GtoResultActionFlowPolicy.shouldPromoteGameplayReturnToReceive(
            "RESULT_DETECTED", false, false, 3, 320L, 3),
            "certified result dialog disappearing into stable gameplay self-recovers even if OEM drops ACTION_OUTSIDE");
        req(!GtoResultActionFlowPolicy.shouldPromoteGameplayReturnToReceive(
            "RESULT_DETECTED", true, true, 5, 1000L, 5),
            "ADS evidence blocks normal trip completion");

        req(GtoResultActionFlowPolicy.mayCommitCompletedTrip(true),
            "durably latched Receive may commit/sync");
        req(!GtoResultActionFlowPolicy.mayCommitCompletedTrip(false),
            "completion must never sync without a durable Receive latch");

        System.out.println("PASS GtoHf41ReceiveFlowPolicyTest");
    }
}
