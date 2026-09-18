package com.nvu.operacional;

public final class GtoHf31BubbleLifecyclePolicyTest {
    public static void main(String[] args) {
        require(GtoBubbleDismissPolicy.shouldShowRemoveTarget(false, true, true, true, false), "first drag outside GTO shows target");
        require(GtoBubbleDismissPolicy.shouldShowRemoveTarget(true, true, true, false, false), "first drag inside GTO shows target");
        require(!GtoBubbleDismissPolicy.shouldShowRemoveTarget(true, false, true, false, false), "no movement inside GTO keeps target hidden");
        require(!GtoBubbleDismissPolicy.shouldShowRemoveTarget(false, false, true, true, false), "no movement outside GTO keeps target hidden");
        require(GtoBubbleDismissPolicy.shouldShowRemoveTarget(true, true, true, false, true), "legacy long-press armed drag remains supported");

        require(GtoBubbleDismissPolicy.shouldExpireGesture(true, 3_000L, 1_000L, 1_000L, 12_000L, 1_800L), "orphan gesture expires without terminal touch");
        require(!GtoBubbleDismissPolicy.shouldExpireGesture(true, 2_500L, 1_000L, 2_000L, 12_000L, 1_800L), "fresh drag remains leased");
        require(GtoBubbleDismissPolicy.shouldExpireGesture(true, 14_000L, 1_000L, 13_500L, 12_000L, 1_800L), "absolute max duration expires pathological gesture");

        require(canStop(true, true, true, true, true, 2_000L, 1_000L, 1_600L), "fresh validated release can stop");
        require(!canStop(false, true, true, true, true, 2_000L, 1_000L, 1_600L), "pointer mismatch blocks stop");
        require(!canStop(true, false, true, true, true, 2_000L, 1_000L, 1_600L), "generation mismatch blocks stop");
        require(!canStop(true, true, false, true, true, 2_000L, 1_000L, 1_600L), "target must be visibly highlighted");
        require(!canStop(true, true, true, false, true, 2_000L, 1_000L, 1_600L), "release geometry must still be inside");
        require(!canStop(true, true, true, true, false, 2_800L, 1_000L, 1_600L), "stale release cannot stop");
        require(GtoBubbleDismissPolicy.canCommitStop(true, true, true, true, false, true, true, true, true, true, 2_000L, 1_000L, 1_600L, 12_000L, 900L), "GTO foreground allows valid drag/drop without long press");
        require(GtoBubbleDismissPolicy.canCommitStop(true, true, true, false, true, true, true, true, true, true, 2_000L, 1_000L, 1_600L, 12_000L, 900L), "GTO foreground remains compatible with armed drag/drop");

        require(GtoBubbleDismissPolicy.isDropInside(100, 100, 70, 56, 80, 80, 180, 80), "geometry inside remains supported");
        require(!GtoBubbleDismissPolicy.isDropInside(400, 100, 70, 56, 80, 80, 180, 80), "geometry outside remains safe");
        System.out.println("GtoHf31BubbleLifecyclePolicyTest: PASS");
    }

    private static boolean canStop(
        boolean pointerMatches,
        boolean generationMatches,
        boolean highlighted,
        boolean geometryInside,
        boolean fresh,
        long now,
        long startedAt,
        long lastMoveAt
    ) {
        long moveAt = fresh ? lastMoveAt : now - 1_200L;
        return GtoBubbleDismissPolicy.canCommitStop(
            false, true, true, true, false, pointerMatches, true, highlighted, generationMatches, geometryInside,
            now, startedAt, moveAt, 12_000L, 900L
        );
    }

    private static void require(boolean ok, String message) {
        if (!ok) throw new AssertionError(message);
    }
}
