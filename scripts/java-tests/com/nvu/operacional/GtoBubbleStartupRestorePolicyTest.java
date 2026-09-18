package com.nvu.operacional;

public final class GtoBubbleStartupRestorePolicyTest {
    private static int passed = 0;

    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
        passed++;
    }

    public static void main(String[] args) {
        final long start = 1_000L;
        final long hold = GtoOverlayLayoutPolicy.STARTUP_REFERENCE_HOLD_MS;

        check(!GtoOverlayLayoutPolicy.shouldRestoreSavedPositionAfterStartup(0L, start, true),
            "clock zero must not restore");
        check(!GtoOverlayLayoutPolicy.shouldRestoreSavedPositionAfterStartup(start - 1L, start, true),
            "before startup must not restore");
        check(!GtoOverlayLayoutPolicy.shouldRestoreSavedPositionAfterStartup(start + hold - 1L, start, true),
            "one millisecond before hold must not restore");
        check(GtoOverlayLayoutPolicy.shouldRestoreSavedPositionAfterStartup(start + hold, start, true),
            "restore must begin exactly at the ten-second boundary");
        check(GtoOverlayLayoutPolicy.shouldRestoreSavedPositionAfterStartup(start + hold + 500L, start, true),
            "restore remains valid after the boundary");
        check(!GtoOverlayLayoutPolicy.shouldRestoreSavedPositionAfterStartup(start + hold, start, false),
            "default position must never be treated as saved user position");
        check(!GtoOverlayLayoutPolicy.shouldRestoreSavedPositionAfterStartup(start + hold, 0L, true),
            "missing startup marker must not restore");
        check(!GtoOverlayLayoutPolicy.shouldRestoreSavedPositionAfterStartup(start + hold, start + 1L, true),
            "future startup marker must not restore");

        System.out.println("GtoBubbleStartupRestorePolicyTest: PASS " + passed + "/8");
    }
}
