package com.nvu.operacional;

/** HF36 regression: a field missed by both initial reads may be recovered by a focused reread. */
public final class GtoHf36CargoRecoveryPolicyTest {
    private static void req(boolean ok, String message) {
        if (!ok) throw new AssertionError(message);
    }

    public static void main(String[] args) {
        GtoFreightFieldConflictPolicy.Resolution cargo = GtoFreightFieldConflictPolicy.resolveWithFocusedReads(
            GtoFreightReviewPolicy.CARGO, "", "", "Tijolos Maciços", "Tijolos Maciços"
        );
        req(cargo.resolved, "missing cargo must be recoverable from two concordant focused selected-row rereads");
        req("Tijolos Maciços".equals(cargo.value), "focused cargo must remain literal");
        req("TWO_FOCUSED_READS_AGREED".equals(cargo.source), "cargo recovery must record two focused reads agreement");

        GtoFreightFieldConflictPolicy.Resolution destination = GtoFreightFieldConflictPolicy.resolveWithFocusedReads(
            GtoFreightReviewPolicy.DESTINATION, "", "", "Cruz do Oeste", "Cruz do Oeste"
        );
        req(destination.resolved && "Cruz do Oeste".equals(destination.value),
            "same recovery rule must remain generic for operational text fields");

        GtoFreightFieldConflictPolicy.Resolution invalid = GtoFreightFieldConflictPolicy.resolveWithFocusedReads(
            GtoFreightReviewPolicy.CARGO, "", "", "OI", "OI"
        );
        req(!invalid.resolved, "obvious OCR noise must not be promoted as cargo");

        GtoFreightFieldConflictPolicy.Resolution agreed = GtoFreightFieldConflictPolicy.resolve(
            GtoFreightReviewPolicy.CARGO, "CARGA TIJOLO", "CARGA TIJOLO", "outra leitura"
        );
        req(agreed.resolved && "CARGA TIJOLO".equals(agreed.value),
            "focused retry must not overwrite agreeing initial evidence");

        System.out.println("GtoHf36CargoRecoveryPolicyTest: PASS");
    }
}
