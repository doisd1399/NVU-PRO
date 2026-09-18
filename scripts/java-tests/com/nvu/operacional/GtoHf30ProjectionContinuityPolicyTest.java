package com.nvu.operacional;

public final class GtoHf30ProjectionContinuityPolicyTest {
    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    public static void main(String[] args) {
        // Initial WAITING_FREIGHT with no grant belongs to the normal consent path.
        require(!GtoProjectionContinuityPolicy.needsFreshGrant(
            true, false, false, false, false, false
        ), "fresh observer must not be classified as lost projection");

        // If runtime says a projection is active but the token vanished, Android consent
        // is genuinely required again.
        require(GtoProjectionContinuityPolicy.needsFreshGrant(
            true, true, false, false, false, true
        ), "active projection with missing token needs a fresh grant");

        // The one legal VirtualDisplay disappearing after creation is terminal for the
        // Android 14+ grant.
        require(GtoProjectionContinuityPolicy.needsFreshGrant(
            true, true, true, false, false, true
        ), "missing consumed VirtualDisplay needs a fresh grant");

        // Missing ImageReader/handler is repairable on the same grant/display.
        require(GtoProjectionContinuityPolicy.shouldRepairPartialSurface(
            true, true, true, true, false, false, true
        ), "missing reader must be repaired in place");
        require(GtoProjectionContinuityPolicy.shouldRepairPartialSurface(
            true, true, true, true, false, true, false
        ), "missing handler must be repaired in place");
        require(GtoProjectionContinuityPolicy.shouldKeepRecoveringSameGrant(
            true, true, true, true
        ), "live token/display must keep recovering indefinitely");

        // The strict waiting-freight probe is allowed during OEM UsageStats lag only for
        // GTO/unknown/NVU ownership; a known third-party app is excluded.
        require(GtoProjectionContinuityPolicy.mayProbeWaitingFreightDuringForegroundLag(
            true, true, true, false, true, false, false
        ), "GTO owner may be probed");
        require(GtoProjectionContinuityPolicy.mayProbeWaitingFreightDuringForegroundLag(
            true, true, true, false, false, true, false
        ), "unknown owner after consent may be probed");
        require(GtoProjectionContinuityPolicy.mayProbeWaitingFreightDuringForegroundLag(
            true, true, true, false, false, false, true
        ), "stale NVU owner after consent may be probed");
        require(!GtoProjectionContinuityPolicy.mayProbeWaitingFreightDuringForegroundLag(
            true, true, true, false, false, false, false
        ), "known unrelated owner must remain excluded");
        require(!GtoProjectionContinuityPolicy.mayProbeWaitingFreightDuringForegroundLag(
            true, true, true, true, true, false, false
        ), "system permission/notification surface must remain transient");

        long now = 10_000L;
        require(GtoCaptureHealthPolicy.shouldRecoverSurface(
            true, true, true, true, true,
            false, true, false, false,
            now, 1_000L, 1_000L, 500L, 0L,
            2_800L, 3_200L, 4_200L, 1_500L
        ), "frame delivery stall must recover even while foreground classification lags");

        require(!GtoCaptureHealthPolicy.shouldRecoverSurface(
            true, true, true, true, true,
            false, true, false, false,
            2_000L, 1_500L, 100L, 500L, 0L,
            2_800L, 3_200L, 4_200L, 1_500L
        ), "analysis stall alone must not recover while GTO is not confirmed");

        require(!GtoCaptureHealthPolicy.isHealthy(
            true, true, true, true, true,
            false, true, false,
            10_000L, 9_500L, 9_400L
        ), "buffer processing outside a ready GTO must not fake detector health");

        require(GtoCaptureHealthPolicy.isHealthy(
            true, true, true, true, true,
            true, false, true,
            10_000L, 9_500L, 9_400L
        ), "ready GTO plus real frame and recognition heartbeat must be healthy");

        System.out.println("GtoHf30ProjectionContinuityPolicyTest: PASS");
    }
}
