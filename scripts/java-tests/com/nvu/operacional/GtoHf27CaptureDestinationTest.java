package com.nvu.operacional;

public final class GtoHf27CaptureDestinationTest {
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    public static void main(String[] args) {
        check("Itapetuna".equals(GtoCityTextResolver.uniquePreferredNearCandidate("Itopetuna")),
            "Itopetuna must trigger focused verification against Itapetuna");
        check(GtoCityTextResolver.uniquePreferredNearCandidate("Itapetuna").isEmpty(),
            "exact Itapetuna must not be treated as a correction candidate");
        check(GtoCityTextResolver.uniquePreferredNearCandidate("Cidade Inventada").isEmpty(),
            "unknown destinations must never be dictionary-corrected");

        check(GtoProjectionForegroundBridgePolicy.allow(false, false, true, false, false, false),
            "exact GTO package is always valid foreground proof");
        check(GtoProjectionForegroundBridgePolicy.allow(true, false, false, true, false, false),
            "verified projection handoff must bridge unknown UsageStats after consent");
        check(GtoProjectionForegroundBridgePolicy.allow(true, false, false, false, true, false),
            "verified projection handoff must bridge the transparent NVU consent host");
        check(!GtoProjectionForegroundBridgePolicy.allow(true, false, false, false, false, false),
            "verified bridge must not override a known third-party foreground app");
        check(!GtoProjectionForegroundBridgePolicy.allow(true, true, false, true, false, false),
            "verified bridge must not override an active transient SystemUI surface");
        check(!GtoProjectionForegroundBridgePolicy.allow(true, false, false, false, true, true),
            "verified bridge must not treat the real NVU MainActivity as GTO");

        System.out.println("PASS HF27 capture/destination policy");
    }
}
