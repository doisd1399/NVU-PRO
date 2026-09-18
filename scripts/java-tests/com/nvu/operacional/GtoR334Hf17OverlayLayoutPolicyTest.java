package com.nvu.operacional;

public final class GtoR334Hf17OverlayLayoutPolicyTest {
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    public static void main(String[] args) {
        check(GtoOverlayLayoutPolicy.overlaps(100, 100, 60, 60, 120, 90, 250, 200),
            "bubble under card must be recognized as overlap");
        check(!GtoOverlayLayoutPolicy.overlaps(10, 10, 50, 50, 100, 100, 250, 200),
            "separate bubble must not be moved");

        int right = GtoOverlayLayoutPolicy.chooseBubbleSide(8, 264, 8, 1000, 70, 8);
        check(right == GtoOverlayLayoutPolicy.SIDE_RIGHT,
            "card near left edge must dock bubble on right");
        check(GtoOverlayLayoutPolicy.bubbleX(right, 8, 264, 8, 1000, 70, 8) == 272,
            "right docking must use exact card edge + gap");

        int left = GtoOverlayLayoutPolicy.chooseBubbleSide(700, 956, 8, 1000, 70, 8);
        check(left == GtoOverlayLayoutPolicy.SIDE_LEFT,
            "card near right edge must dock bubble on left");
        check(GtoOverlayLayoutPolicy.bubbleX(left, 700, 956, 8, 1000, 70, 8) == 622,
            "left docking must use exact card edge - gap - bubble width");

        int moreRight = GtoOverlayLayoutPolicy.chooseBubbleSide(350, 606, 8, 1200, 70, 8);
        check(moreRight == GtoOverlayLayoutPolicy.SIDE_RIGHT,
            "when both sides fit, use the side with more spare room");

        System.out.println("PASS HF17 overlay layout policy");
    }
}
