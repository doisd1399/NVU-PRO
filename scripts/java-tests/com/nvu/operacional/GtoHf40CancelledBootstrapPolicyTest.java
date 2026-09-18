package com.nvu.operacional;

/** Regression for the post-cancel automatic jobs-list bootstrap. */
public final class GtoHf40CancelledBootstrapPolicyTest {
    private static void req(boolean v, String m) { if (!v) throw new AssertionError(m); }

    public static void main(String[] args) {
        req(GtoFreightLifecycleBoundaryPolicy.mayBootstrapFreshSelection("IDLE"), "IDLE must bootstrap from a certified list");
        req(GtoFreightLifecycleBoundaryPolicy.mayBootstrapFreshSelection("CANCELLED"), "CANCELLED must bootstrap from a certified list");
        req(!GtoFreightLifecycleBoundaryPolicy.mayBootstrapFreshSelection("WAITING_FREIGHT"), "WAITING already owns normal selection flow");
        req(GtoFreightLifecycleBoundaryPolicy.mayHandleCertifiedFreightBoundary("CANCELLED", false), "CANCELLED certified list must enter lifecycle reducer");
        req(GtoFreightLifecycleBoundaryPolicy.mayHandleCertifiedFreightBoundary("TRIP_IN_PROGRESS", false), "active trip certified list must remain a replacement boundary");
        req(GtoFreightLifecycleBoundaryPolicy.mayHandleCertifiedFreightBoundary("CONFIRMING_FREIGHT", true), "pending review certified list must remain a replacement boundary");
        req(!GtoFreightLifecycleBoundaryPolicy.mayHandleCertifiedFreightBoundary("CONFIRMING_FREIGHT", false), "automatic confirming must stay protected from original list frames");

        req(GtoSimpleScreenDetectionPolicy.isCertifiedFreightListReturn("CANCELLED", true, true, 2, 55L), "CANCELLED + certified stable list must cross boundary");
        req(!GtoSimpleScreenDetectionPolicy.isCertifiedFreightListReturn("CANCELLED", true, false, 10, 1000L), "visual-only lookalike must never cross boundary");
        req(!GtoSimpleScreenDetectionPolicy.isCertifiedFreightListReturn("CANCELLED", true, true, 1, 1000L), "single frame must never cross boundary");
        req(!GtoSimpleScreenDetectionPolicy.isCertifiedFreightListReturn("CANCELLED", true, true, 2, 54L), "unstable list must never cross boundary");

        req(!GtoFreightBootstrapPolicy.shouldAwaitSecondListFrame("CANCELLED", 1, -1), "fresh cancelled bootstrap may preserve a fast touch without active-trip delay");
        req(GtoFreightBootstrapPolicy.shouldAwaitSecondListFrame("TRIP_IN_PROGRESS", 1, -1), "active trip still requires stronger visual evidence without exact row");

        System.out.println("GtoHf40CancelledBootstrapPolicyTest: PASS");
    }
}
