package com.nvu.operacional;

public final class GtoR334Hf12IntelligentFlowPolicyTest {
    public static void main(String[] args) {
        require(GtoFreightListEvidencePolicy.isPlausibleList(5, true, 4, 4, 0.42f),
            "one weak freight row must not invalidate a five-row list");
        require(!GtoFreightListEvidencePolicy.isPlausibleList(5, true, 2, 4, 0.42f),
            "too little button evidence must remain rejected");
        require(!GtoFreightListEvidencePolicy.isPlausibleList(3, false, 3, 3, 0.70f),
            "bad geometry must remain fail-closed");

        require(GtoResultEvidencePolicy.isPlausibleResult(0.72f, 0.63f, 0.36f, 0.03f),
            "result may survive a weak gold region when two independent supports remain");
        require(GtoResultEvidencePolicy.isPlausibleResult(0.72f, 0.63f, 0.10f, 0.14f),
            "result may survive a partially covered receive region");
        require(!GtoResultEvidencePolicy.isPlausibleResult(0.72f, 0.20f, 0.10f, 0.14f),
            "one support alone must not wake result OCR");

        // Critical invariant: a usable touch on N resolves only to N or NONE, never M.
        for (int rows = 1; rows <= 6; rows++) {
            for (int touched = 0; touched < rows; touched++) {
                require(GtoSelectionIdentityPolicy.resolveRow(touched, true, touched, rows) == touched,
                    "matching touch must resolve to the touched row");
                for (int visual = 0; visual < rows; visual++) {
                    if (visual == touched) continue;
                    require(GtoSelectionIdentityPolicy.resolveRow(touched, true, visual, rows) == -1,
                        "touch N plus visual M must resolve to NONE");
                }
            }
        }
        require(GtoSelectionIdentityPolicy.resolveRow(-1, false, 3, 5) == 3,
            "redacted OEM coordinates may use the visual row fallback");

        long previousProducerNs = 2_000_000_000L;
        require(GtoFrameFreshnessPolicy.shouldConsume(previousProducerNs, 2_016_000_000L, false),
            "same-producer forward frame must be consumed");
        require(!GtoFrameFreshnessPolicy.shouldConsume(previousProducerNs, previousProducerNs, false),
            "exact duplicate may be dropped outside a critical touch window");
        require(GtoFrameFreshnessPolicy.shouldConsume(previousProducerNs, previousProducerNs, true),
            "critical touch must fail open on an OEM duplicate timestamp");
        require(GtoFrameFreshnessPolicy.shouldConsume(90_000_000_000L, 4_000_000L, false),
            "producer timestamp domain reset must never blind detection");

        require(GtoFreightReviewPolicy.DESTINATION.equals(GtoFreightReviewPolicy.firstRequiredField(
            "Soja", "Coop A", "Coop B", "", "420Km", "R$ 5.300,00")),
            "only the unreadable destination should be requested");
        require(GtoFreightReviewPolicy.isManualValueValid(GtoFreightReviewPolicy.DESTINATION, "Itapetuna"),
            "literal destination must be accepted");
        require("Itapetuna".equals(GtoFreightReviewPolicy.preserveLiteralManualText("  Itapetuna  ")),
            "manual text must only be trimmed, never autocorrected");
        require(!GtoFreightReviewPolicy.isManualValueValid(GtoFreightReviewPolicy.DISTANCE, "2Km"),
            "distance outside the established freight contract must remain invalid");

        System.out.println("GtoR334Hf12IntelligentFlowPolicyTest: PASS");
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
