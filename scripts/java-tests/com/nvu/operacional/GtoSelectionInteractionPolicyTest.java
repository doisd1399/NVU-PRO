package com.nvu.operacional;

public final class GtoSelectionInteractionPolicyTest {
    private static void check(String name, boolean ok) {
        if (!ok) throw new AssertionError(name);
        System.out.println("PASS " + name);
    }

    public static void main(String[] args) {
        check("pre-ready visual list cannot arm first attempt",
            !GtoSelectionInteractionPolicy.mayArmFromFreshFreightList(
                true, false, 1_100L, 500L, 1, true, false, false, true, false
            ));
        check("first row touch can arm after recent list and ready capture",
            GtoSelectionInteractionPolicy.mayArmFromFreshFreightList(
                true, false, 1_100L, 500L, 1, true, true, false, true, false
            ));
        check("confirmed list can arm with one accept geometry",
            GtoSelectionInteractionPolicy.mayArmFromFreshFreightList(
                true, false, 1_100L, 1_000L, 1, true, true, true, false, false
            ));
        check("fresh-list boundary at 1.100ms can arm",
            GtoSelectionInteractionPolicy.mayArmFromFreshFreightList(
                true, false, 2_100L, 1_000L, 1, true, true, true, false, false
            ));
        check("stale list at 1.101ms cannot arm",
            !GtoSelectionInteractionPolicy.mayArmFromFreshFreightList(
                true, false, 2_101L, 1_000L, 1, true, true, true, false, false
            ));
        check("stale list cannot arm",
            !GtoSelectionInteractionPolicy.mayArmFromFreshFreightList(
                true, false, 2_000L, 500L, 1, true, true, true, false, false
            ));
        check("known non-GTO paused context cannot arm",
            !GtoSelectionInteractionPolicy.mayArmFromFreshFreightList(
                true, true, 1_100L, 1_000L, 1, true, true, true, false, false
            ));
        check("different capture generation cannot arm",
            !GtoSelectionInteractionPolicy.mayArmFromFreshFreightList(
                true, false, 1_100L, 1_000L, 1, false, true, true, false, true
            ));
        check("reopening the list after cancellation can arm a new touch",
            GtoSelectionInteractionPolicy.mayArmFromFreshFreightList(
                true, false, 5_250L, 5_000L, 3, true, true, false, true, true
            ));
        check("same route step preserves scroll",
            GtoSelectionInteractionPolicy.shouldRestoreRouteScroll("ORIGIN", "ORIGIN"));
        check("origin to destination starts a new scroll context",
            !GtoSelectionInteractionPolicy.shouldRestoreRouteScroll("ORIGIN", "DESTINATION"));
        check("destination to origin starts a new scroll context",
            !GtoSelectionInteractionPolicy.shouldRestoreRouteScroll("DESTINATION", "ORIGIN"));
        check("scroll never becomes negative",
            GtoSelectionInteractionPolicy.safeScrollY(-24) == 0);
        check("positive scroll is preserved",
            GtoSelectionInteractionPolicy.safeScrollY(144) == 144);
        System.out.println("14/14 selection interaction checks passed.");
    }
}
