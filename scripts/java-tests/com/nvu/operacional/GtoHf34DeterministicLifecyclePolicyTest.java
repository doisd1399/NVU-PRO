package com.nvu.operacional;

import java.util.Arrays;
import java.util.Collections;

public final class GtoHf34DeterministicLifecyclePolicyTest {
    private static void req(boolean v, String m) { if (!v) throw new AssertionError(m); }

    public static void main(String[] args) {
        req(GtoDeterministicFlowPolicy.mayProbeFreightListForCurrentState("TRIP_IN_PROGRESS", false),
            "active trip must always observe freight list without an explicit replacement arm");
        req(GtoDeterministicFlowPolicy.freightListIsInformationalOnly("TRIP_IN_PROGRESS", false),
            "freight list is informational until an exact Accept touch during an active trip");
        req(GtoDeterministicFlowPolicy.mayReplaceActiveTrip("TRIP_IN_PROGRESS", true),
            "stable returned freight list must be allowed to end the old trip");
        req(!GtoDeterministicFlowPolicy.mayReplaceActiveTrip("TRIP_IN_PROGRESS", false),
            "one unconfirmed visual candidate must not end the old trip");

        req(!GtoSimpleScreenDetectionPolicy.isStableFreightListReturn("TRIP_IN_PROGRESS", true, 1, 120),
            "one frame is insufficient for lifecycle cancellation");
        req(GtoSimpleScreenDetectionPolicy.isStableFreightListReturn("TRIP_IN_PROGRESS", true, 2, 55),
            "two strict frames in 55ms must cancel an active trip");
        req(GtoSimpleScreenDetectionPolicy.isStableFreightListReturn("RESULT_DETECTED", true, 2, 55),
            "unresolved result returning to list must be recognized as a new-cycle boundary");
        req(GtoSimpleScreenDetectionPolicy.isStableFreightListReturn("AWAITING_BONUS_VALIDATION", true, 2, 55),
            "bonus/result state returning to list must be recognized as a new-cycle boundary");
        req(GtoSimpleScreenDetectionPolicy.isStableFreightListReturn("IDLE", true, 2, 55),
            "IDLE plus a real jobs list must bootstrap WAITING_FREIGHT automatically");
        req(GtoSimpleScreenDetectionPolicy.isStableFreightListReturn("CANCELLED", true, 2, 55),
            "CANCELLED plus a real jobs list must bootstrap a clean selection cycle automatically");

        req("Metalúrgica".equals(GtoFreightContextPolicy.unanimousOrigin(
            Arrays.asList("Metalúrgica", "METALURGICA", "Metalurgica"), 5)),
            "same-page origin consensus must recover Metalúrgica without driver input");

        GtoOriginGeometryPolicy.Result ambiguousRoute = GtoOriginGeometryPolicy.inferFromRowLines(
            Arrays.asList(
                new GtoOriginGeometryPolicy.RowLine("Barras de Ferro", 10, 25, 0, 110),
                new GtoOriginGeometryPolicy.RowLine("Metalúrgica Dalavan", 40, 52, 0, 190),
                new GtoOriginGeometryPolicy.RowLine("Águas Velhas", 70, 84, 0, 110)
            ), "", 0, 100
        );
        req(!ambiguousRoute.strong && ambiguousRoute.value.isEmpty(),
            "merged route phrase must never be committed as an invented origin");
        GtoOriginGeometryPolicy.Result anchoredRoute = GtoOriginGeometryPolicy.infer(
            "Metalúrgica Dalavan",
            Arrays.asList(
                new GtoOriginGeometryPolicy.Token("Metalúrgica", 10, 92),
                new GtoOriginGeometryPolicy.Token("Dalavan", 130, 185)
            ), "Dalavan", 22
        );
        req(anchoredRoute.strong && "Metalúrgica".equals(anchoredRoute.value),
            "destination-company anchor must recover source automatically when the separator disappears");

        System.out.println("GtoHf34DeterministicLifecyclePolicyTest: PASS");
    }
}
