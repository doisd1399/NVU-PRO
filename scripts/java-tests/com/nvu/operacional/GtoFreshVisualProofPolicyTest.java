package com.nvu.operacional;

public final class GtoFreshVisualProofPolicyTest {
    private static final String GTO = "com.stargamesapps.gto";
    private static final String NVU = "com.nvu.operacional";
    private static final long PROOF_AT = 10_000L;
    private static final long WINDOW = 2_500L;

    private static void check(String name, boolean value) {
        if (!value) throw new AssertionError(name);
    }

    public static void main(String[] args) {
        check("exact GTO package accepts fresh proof", GtoFreshVisualProofPolicy.isUsable(
            PROOF_AT, 11_000L, WINDOW, GTO, GTO, NVU, false, false
        ));
        check("unknown package accepts bounded fresh bridge", GtoFreshVisualProofPolicy.isUsable(
            PROOF_AT, 12_500L, WINDOW, "", GTO, NVU, false, false
        ));
        check("known external package is blocked", !GtoFreshVisualProofPolicy.isUsable(
            PROOF_AT, 11_000L, WINDOW, "com.android.systemui", GTO, NVU, false, false
        ));
        check("NVU activity is blocked", !GtoFreshVisualProofPolicy.isUsable(
            PROOF_AT, 11_000L, WINDOW, NVU, GTO, NVU, false, true
        ));
        check("transient surface is blocked", !GtoFreshVisualProofPolicy.isUsable(
            PROOF_AT, 11_000L, WINDOW, GTO, GTO, NVU, true, false
        ));
        check("expired proof is blocked", !GtoFreshVisualProofPolicy.isUsable(
            PROOF_AT, 12_501L, WINDOW, GTO, GTO, NVU, false, false
        ));
        check("future proof timestamp is blocked", !GtoFreshVisualProofPolicy.isUsable(
            PROOF_AT, 9_999L, WINDOW, GTO, GTO, NVU, false, false
        ));
        check("negative freshness window is blocked", !GtoFreshVisualProofPolicy.isUsable(
            PROOF_AT, 10_000L, -1L, GTO, GTO, NVU, false, false
        ));
        check("action context accepts exact GTO package",
            GtoVisualActionContextPolicy.allows(false, false, false, GTO, GTO, NVU));
        check("action context accepts unknown package during OEM uncertainty",
            GtoVisualActionContextPolicy.allows(false, false, false, "", GTO, NVU));
        check("action context blocks known external package",
            !GtoVisualActionContextPolicy.allows(false, false, false, "com.android.systemui", GTO, NVU));
        check("action context blocks explicit outside-GTO pause",
            !GtoVisualActionContextPolicy.allows(true, false, false, GTO, GTO, NVU));
        check("action context blocks NVU activity",
            !GtoVisualActionContextPolicy.allows(false, false, true, GTO, GTO, NVU));
        check("action context blocks transient surface",
            !GtoVisualActionContextPolicy.allows(false, true, false, GTO, GTO, NVU));
        System.out.println("GtoFreshVisualProofPolicyTest: PASS 14/14");
    }
}
