package com.nvu.operacional;

public final class GtoR334Hf19OverlayVisualPolicyTest {
    private static void eq(String name, int expected, int actual) {
        if (expected != actual) {
            throw new AssertionError(name + " expected=" + expected + " actual=" + actual);
        }
    }

    private static void yes(String name, boolean ok) {
        if (!ok) throw new AssertionError(name);
    }

    public static void main(String[] args) {
        // 720px-high usable area example: a tall card must rise instead of leaving the screen.
        eq("bottom clamp", 380, GtoOverlayLayoutPolicy.clampMenuY(620, 300, 40, 680));
        eq("top clamp", 40, GtoOverlayLayoutPolicy.clampMenuY(5, 300, 40, 680));
        eq("middle preserved", 180, GtoOverlayLayoutPolicy.clampMenuY(180, 300, 40, 680));
        eq("oversized card anchors to safe top", 40, GtoOverlayLayoutPolicy.clampMenuY(300, 800, 40, 680));

        int side = GtoOverlayLayoutPolicy.chooseBubbleSide(240, 496, 8, 1000, 70, 8);
        yes("bubble chooses roomier right side", side == GtoOverlayLayoutPolicy.SIDE_RIGHT);
        int x = GtoOverlayLayoutPolicy.bubbleX(side, 240, 496, 8, 1000, 70, 8);
        yes("bubble stays fully inside safe bounds", x >= 8 && x + 70 <= 1000);

        System.out.println("PASS HF19 overlay visual policy");
    }
}
