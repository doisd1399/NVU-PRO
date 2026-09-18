package com.nvu.operacional;

import java.util.Arrays;
import java.util.Collections;

public final class GtoR334Hf13CaptureOriginPolicyTest {
    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    public static void main(String[] args) {
        long now = 10_000L;
        require(GtoCaptureHealthPolicy.isHealthy(
            true, true, true, true, true, true, false, true,
            now, 9_500L, 9_400L), "fresh received/analyzed frames must be healthy");
        require(!GtoCaptureHealthPolicy.isHealthy(
            true, true, true, true, true, true, false, true,
            now, 9_500L, 7_000L), "stale analysis must not be reported healthy");
        require(!GtoCaptureHealthPolicy.isHealthy(
            true, true, true, true, true, false, true, false,
            now, 9_900L, 9_900L), "fresh buffers outside a ready GTO must not fake recognition health");

        require(GtoCaptureHealthPolicy.shouldRecoverSurface(
            true, true, true, true, true, true, false, false, false,
            20_000L, 15_000L, 19_500L, 10_000L, 18_000L, 2_800L, 3_200L, 4_200L, 1_500L),
            "surface recovery must remain repeatable after cooldown");
        require(GtoCaptureHealthPolicy.shouldRecoverSurface(
            true, true, true, true, true, false, true, false, false,
            20_000L, 15_000L, 19_500L, 10_000L, 18_000L, 2_800L, 3_200L, 4_200L, 1_500L),
            "real frame-delivery stall must self-heal even while foreground classification is paused");
        require(!GtoCaptureHealthPolicy.shouldRecoverSurface(
            true, true, true, true, true, false, true, false, false,
            20_000L, 19_900L, 15_000L, 10_000L, 18_000L, 2_800L, 3_200L, 4_200L, 1_500L),
            "analysis-only stall must stay neutral while GTO analysis is intentionally paused");

        require(GtoCaptureHealthPolicy.shouldRecoverSurface(
            true, true, true, true, true, true, false, false, false,
            30_000L, 29_900L, 24_000L, 20_000L, 27_500L, 2_800L, 3_200L, 4_200L, 1_500L),
            "fresh callbacks with stale analysis must also trigger recovery");

        GtoOriginGeometryPolicy.Result anchored = GtoOriginGeometryPolicy.infer(
            "Metalurgica Dalavan",
            Arrays.asList(
                new GtoOriginGeometryPolicy.Token("Metalurgica", 10, 92),
                new GtoOriginGeometryPolicy.Token("Dalavan", 128, 181)
            ),
            "Dalavan", 22);
        require(anchored.strong && "Metalurgica".equals(anchored.value),
            "destination-company anchor must recover left-side origin when > is lost");

        GtoOriginGeometryPolicy.Result multi = GtoOriginGeometryPolicy.infer(
            "Fabrica de Tijolo Cooper Log",
            Arrays.asList(
                new GtoOriginGeometryPolicy.Token("Fabrica", 10, 58),
                new GtoOriginGeometryPolicy.Token("de", 64, 78),
                new GtoOriginGeometryPolicy.Token("Tijolo", 84, 126),
                new GtoOriginGeometryPolicy.Token("Cooper", 164, 212),
                new GtoOriginGeometryPolicy.Token("Log", 217, 242)
            ),
            "Cooper Log", 22);
        require(multi.strong && "Fabrica de Tijolo".equals(multi.value),
            "multi-word origin must remain literal and left of destination company");

        GtoOriginGeometryPolicy.Result direct = GtoOriginGeometryPolicy.infer(
            "Metalurgica > Dalavan", Collections.emptyList(), "", 22);
        require(direct.strong && "Metalurgica".equals(direct.value),
            "visible separator path must preserve literal origin");

        GtoOriginGeometryPolicy.Result uncertain = GtoOriginGeometryPolicy.infer(
            "Alpha Beta Gamma",
            Arrays.asList(
                new GtoOriginGeometryPolicy.Token("Alpha", 10, 44),
                new GtoOriginGeometryPolicy.Token("Beta", 49, 78),
                new GtoOriginGeometryPolicy.Token("Gamma", 83, 124)
            ),
            "", 22);
        require(!uncertain.strong && uncertain.value.isEmpty(),
            "ambiguous geometry must stay unknown instead of guessing");

        for (int trip = 1; trip <= 5; trip++) {
            require(GtoDeterministicFlowPolicy.shouldAutoPrepareNextFreightAfterSync(
                "RESULT_CONFIRMED", true, false),
                "ACKed trip " + trip + " must prepare next freight without ending automatic session");
        }
        require(GtoDeterministicFlowPolicy.mayProbeFreightListForCurrentState(
            "TRIP_IN_PROGRESS", false),
            "active trip must always observe a returned jobs list; stable evidence decides the lifecycle transition");

        System.out.println("GtoR334Hf13CaptureOriginPolicyTest: PASS");
    }
}
