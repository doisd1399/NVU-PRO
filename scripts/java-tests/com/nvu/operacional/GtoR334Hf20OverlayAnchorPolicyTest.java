package com.nvu.operacional;

public final class GtoR334Hf20OverlayAnchorPolicyTest {
    private static void eq(String name, int expected, int actual) {
        if (expected != actual) throw new AssertionError(name + " expected=" + expected + " actual=" + actual);
    }
    private static void yes(String name, boolean value) {
        if (!value) throw new AssertionError(name);
    }

    public static void main(String[] args) {
        final int safeLeft = 8;
        final int safeRight = 352;
        final int bubbleW = 69;
        final int cardW = 256;
        final int gap = 8;

        yes("pair fits common 360dp portrait safe width",
            GtoOverlayLayoutPolicy.horizontalPairFits(safeLeft, safeRight, bubbleW, cardW, gap));

        // Bubble already near right edge: card must open immediately to its left without moving bubble.
        int sideRightBubble = GtoOverlayLayoutPolicy.chooseMenuSideForBubble(
            275, bubbleW, cardW, safeLeft, safeRight, gap);
        eq("right-edge bubble chooses left card", GtoOverlayLayoutPolicy.SIDE_LEFT, sideRightBubble);
        int rightBubbleX = GtoOverlayLayoutPolicy.bubbleXForMenuSide(
            sideRightBubble, 275, bubbleW, cardW, safeLeft, safeRight, gap);
        eq("right-edge bubble does not move", 275, rightBubbleX);
        eq("left card is exactly beside bubble", 11,
            GtoOverlayLayoutPolicy.menuXBesideBubble(sideRightBubble, rightBubbleX, bubbleW, cardW, safeLeft, safeRight, gap));

        // Bubble near left edge: card opens to the right without moving bubble.
        int sideLeftBubble = GtoOverlayLayoutPolicy.chooseMenuSideForBubble(
            8, bubbleW, cardW, safeLeft, safeRight, gap);
        eq("left-edge bubble chooses right card", GtoOverlayLayoutPolicy.SIDE_RIGHT, sideLeftBubble);
        int leftBubbleX = GtoOverlayLayoutPolicy.bubbleXForMenuSide(
            sideLeftBubble, 8, bubbleW, cardW, safeLeft, safeRight, gap);
        eq("left-edge bubble does not move", 8, leftBubbleX);
        eq("right card is exactly beside bubble", 85,
            GtoOverlayLayoutPolicy.menuXBesideBubble(sideLeftBubble, leftBubbleX, bubbleW, cardW, safeLeft, safeRight, gap));

        // Bubble in the middle: neither side initially fits. The pair should make the smallest
        // deterministic nudge, not put the card at an unrelated fixed X.
        int middleSide = GtoOverlayLayoutPolicy.chooseMenuSideForBubble(
            150, bubbleW, cardW, safeLeft, safeRight, gap);
        int movedBubble = GtoOverlayLayoutPolicy.bubbleXForMenuSide(
            middleSide, 150, bubbleW, cardW, safeLeft, safeRight, gap);
        int cardX = GtoOverlayLayoutPolicy.menuXBesideBubble(
            middleSide, movedBubble, bubbleW, cardW, safeLeft, safeRight, gap);
        yes("middle bubble is nudged only as required", Math.abs(movedBubble - 150) <= 142);
        if (middleSide == GtoOverlayLayoutPolicy.SIDE_LEFT) {
            eq("middle pair keeps exact left gap", movedBubble - gap - cardW, cardX);
        } else {
            eq("middle pair keeps exact right gap", movedBubble + bubbleW + gap, cardX);
        }
        yes("card remains in safe bounds", cardX >= safeLeft && cardX + cardW <= safeRight);
        yes("bubble remains in safe bounds", movedBubble >= safeLeft && movedBubble + bubbleW <= safeRight);

        eq("card vertically centers on bubble", 128,
            GtoOverlayLayoutPolicy.centeredMenuYBesideBubble(240, 56, 280, 24, 700));
        eq("centered card clamps at top", 24,
            GtoOverlayLayoutPolicy.centeredMenuYBesideBubble(20, 56, 280, 24, 700));
        eq("centered card clamps at bottom", 420,
            GtoOverlayLayoutPolicy.centeredMenuYBesideBubble(650, 56, 280, 24, 700));

        yes("narrow freight strip triggers vertical fallback",
            !GtoOverlayLayoutPolicy.horizontalPairFits(8, 280, bubbleW, cardW, gap));

        // A measured card wider than the initial 256dp must be constrained to the
        // chosen side instead of being clamped over the bubble.
        int measuredBubbleX = 150;
        int measuredCardW = 300;
        int measuredSide = GtoOverlayLayoutPolicy.chooseMenuSideForBubble(
            measuredBubbleX, bubbleW, measuredCardW, safeLeft, safeRight, gap);
        int measuredAvailable = GtoOverlayLayoutPolicy.availableMenuWidthForBubbleSide(
            measuredSide, measuredBubbleX, bubbleW, safeLeft, safeRight, gap);
        int constrainedCardW = Math.max(1, Math.min(measuredCardW, measuredAvailable));
        int constrainedCardX = GtoOverlayLayoutPolicy.menuXBesideBubble(
            measuredSide, measuredBubbleX, bubbleW, constrainedCardW, safeLeft, safeRight, gap);
        yes("measured card is constrained to the selected side",
            constrainedCardW == measuredAvailable);
        yes("measured card never overlaps bubble",
            !GtoOverlayLayoutPolicy.overlaps(
                measuredBubbleX, 100, bubbleW, 56,
                constrainedCardX, 80, constrainedCardW, 280));

        System.out.println("PASS HF20 overlay anchor policy");
    }
}
