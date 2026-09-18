package com.nvu.operacional;

public final class GtoR334Hf15OverlaySelfInterferenceTest {
    public static void main(String[] args) {
        // Ratios measured from the physical HF14 screenshot where the NVU card was open.
        // They reproduce the root cause: the card itself satisfies the permissive visual
        // result wake-up gate even though the GTO is still in the driving scene.
        require(GtoResultEvidencePolicy.isPlausibleResult(
            0.7314815f,
            0.6666667f,
            0.9333333f,
            0.0666667f
        ), "HF14 physical card screenshot must reproduce the false result wake-up candidate");

        require(!GtoResultEvidencePolicy.isPlausibleResult(
            0.42f,
            0.30f,
            0.20f,
            0.05f
        ), "ordinary gameplay evidence must remain below the result gate");

        System.out.println("GtoR334Hf15OverlaySelfInterferenceTest: PASS");
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
