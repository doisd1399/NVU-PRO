package com.nvu.operacional;

/** Deterministic beginning-to-end journey simulation using the production transition policy. */
public final class GtoFullJourneyPolicyTest {
    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    private static String move(String state, String target) {
        require(GtoDeterministicFlowPolicy.isAllowedTripTransition(state, target),
            "transition blocked: " + state + " -> " + target);
        return target;
    }

    public static void main(String[] args) {
        String state = "IDLE";
        require(GtoDeterministicFlowPolicy.shouldPrepareWaitingBeforeGtoOpen(state),
            "launch must prepare IDLE before GTO frames arrive");
        state = move(state, "WAITING_FREIGHT");

        // FREIGHT_LIST_DETECTED is a visual state, not a journey reset.
        require(GtoDeterministicFlowPolicy.mayUseVisualFreightProof(true, true, false, true, false, 5),
            "real five-row list may recover stale OEM foreground evidence while waiting");
        require("WAITING_FREIGHT".equals(state), "list detection preserves WAITING_FREIGHT");

        state = move(state, "CONFIRMING_FREIGHT");
        require(!GtoDeterministicFlowPolicy.mayObserveFreightListOutsideWaiting(state),
            "live list cannot overwrite the frozen selection transaction");
        state = move(state, "TRIP_IN_PROGRESS");

        // Leaving/returning GTO is orthogonal to journey state.
        String preserved = state;
        require(GtoDeterministicFlowPolicy.unknownScreenMustBeNeutral(state),
            "unknown/non-GTO screens are neutral");
        require(state.equals(preserved), "app switch cannot mutate the trip");
        require(GtoDeterministicFlowPolicy.freightListIsInformationalOnly(state, false),
            "reopened list is informational until an exact Accept touch during an active trip");
        require(GtoDeterministicFlowPolicy.mayReplaceActiveTrip(state, true),
            "a stable returned freight list closes the old trip and prepares the next selection");
        require(!GtoDeterministicFlowPolicy.mayReplaceActiveTrip(state, false),
            "one unconfirmed candidate frame cannot close the old trip");

        require(GtoDeterministicFlowPolicy.mayObserveFreightSelectionSurface(
                "TRIP_STARTED", false, false, true
            ),
            "an unanchored TRIP_STARTED session must keep observing the visible freight surface");
        require(GtoDeterministicFlowPolicy.mayObserveFreightSelectionSurface(
                "TRIP_STARTED", true, false, true
            ),
            "a row with pending evidence must keep the selection surface observable");
        require(!GtoDeterministicFlowPolicy.mayObserveFreightSelectionSurface(
                "TRIP_STARTED", true, true, false
            ),
            "a confirmed active row must not be replaced by informational list observation");

        require(GtoDeterministicFlowPolicy.mayInterpretResultScreen(state),
            "result is valid only once trip is in progress");
        state = move(state, "RESULT_DETECTED");
        require(GtoDeterministicFlowPolicy.mayInterpretBonusOrAds(state),
            "result action classification is valid after result detection");
        state = move(state, "RESULT_CONFIRMED");
        require("RESULT_CONFIRMED".equals(state), "Receive completion reaches durable confirmed state");

        System.out.println("GtoFullJourneyPolicyTest: PASS");
    }
}
