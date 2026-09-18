package com.nvu.operacional;

public final class GtoHf56BubblePositionPolicyTest {
    public static void main(String[] args) {
        int scale = 10_000;
        require(GtoOverlayLayoutPolicy.referenceTopX(1080, 68, 20, 1020) == 274,
            "fresh default uses the calibrated reference X anchor");
        require(GtoOverlayLayoutPolicy.referenceTopY(1920, 20, 1840) == 135,
            "fresh default sits below the top HUD anchor");
        require(GtoOverlayLayoutPolicy.normalizedPosition(20, 20, 1020, scale) == 0,
            "left edge normalizes to zero");
        require(GtoOverlayLayoutPolicy.normalizedPosition(1020, 20, 1020, scale) == scale,
            "right edge normalizes to scale");
        int middle = GtoOverlayLayoutPolicy.normalizedPosition(520, 20, 1020, scale);
        require(middle == 5000, "middle normalizes to 50 percent");
        require(GtoOverlayLayoutPolicy.positionFromNormalized(middle, 20, 1020, scale) == 520,
            "normalized position round-trips");
        require(GtoOverlayLayoutPolicy.positionFromNormalized(5000, 40, 640, scale) == 340,
            "favorite position scales to a new safe span");
        require(GtoOverlayLayoutPolicy.isInsideSafeRange(40, 40, 640),
            "safe boundary is accepted");
        require(!GtoOverlayLayoutPolicy.isInsideSafeRange(900, 40, 640),
            "portrait-stale coordinate is rejected instead of bottom-clamped");
        System.out.println("GtoHf56BubblePositionPolicyTest: PASS");
    }

    private static void require(boolean ok, String message) {
        if (!ok) throw new AssertionError(message);
    }
}
