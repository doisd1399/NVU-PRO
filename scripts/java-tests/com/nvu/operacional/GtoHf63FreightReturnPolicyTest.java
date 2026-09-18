package com.nvu.operacional;

public final class GtoHf63FreightReturnPolicyTest {
    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    private static boolean allowed(
        boolean projectionActive,
        boolean tokenAndDisplayPresent,
        boolean verifiedGtoSession,
        boolean freightReturnEligibleState,
        boolean analysisPaused,
        boolean transientSurface,
        boolean nvuMainActivityForeground,
        boolean landscapeCapture
    ) {
        return GtoProjectionContinuityPolicy.mayProbeFreightReturnDuringForegroundLag(
            projectionActive,
            tokenAndDisplayPresent,
            verifiedGtoSession,
            freightReturnEligibleState,
            analysisPaused,
            transientSurface,
            nvuMainActivityForeground,
            landscapeCapture
        );
    }

    public static void main(String[] args) {
        require(allowed(true, true, true, true, true, false, false, true),
            "validated paused GTO session must keep the freight-return visual probe alive");
        require(!allowed(false, true, true, true, true, false, false, true),
            "inactive projection must block return probe");
        require(!allowed(true, false, true, true, true, false, false, true),
            "missing token/display must block return probe");
        require(!allowed(true, true, false, true, true, false, false, true),
            "unverified projection session must block return probe");
        require(!allowed(true, true, true, false, true, false, false, true),
            "ineligible state must block return probe");
        require(!allowed(true, true, true, true, false, false, false, true),
            "ordinary active analysis does not need the paused return probe");
        require(!allowed(true, true, true, true, true, true, false, true),
            "transient system surface must veto return probe");
        require(allowed(true, true, true, true, true, false, true, true),
            "stale NVU MainActivity latch must not veto a strict current freight-list return probe");
        require(!allowed(true, true, true, true, true, false, false, false),
            "portrait/non-GTO capture geometry must veto return probe");

        // Keep the older consent-host bridge conservative: a known third-party owner is
        // still rejected there. HF63 does not globally relax package ownership; it creates
        // a separate visual-only return probe whose authority comes from current pixels.
        require(!GtoProjectionContinuityPolicy.mayProbeWaitingFreightDuringForegroundLag(
            true, true, true, false, false, false, false),
            "legacy WAITING_FREIGHT bridge must still reject known unrelated package owners");

        System.out.println("GtoHf63FreightReturnPolicyTest: PASS");
    }
}
