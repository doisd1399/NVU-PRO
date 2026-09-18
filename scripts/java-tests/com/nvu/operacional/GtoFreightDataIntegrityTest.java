package com.nvu.operacional;

public final class GtoFreightDataIntegrityTest {
    public static void main(String[] args) {
        require(GtoFreightTextGuard.sameVisibleText("Itapetuna", " itapetuna  "),
            "case and whitespace may differ without changing the literal name");
        require(!GtoFreightTextGuard.sameVisibleText("Itapetuna", "Itapetona"),
            "one-letter destination mutation must be rejected");
        require(!GtoFreightTextGuard.sameVisibleText("\u00c1guas Velhas", "Aguas Velhas"),
            "accent loss must not silently change a visible GTO name");
        require(GtoFreightTextGuard.sameNumericValue("550Km", "550 km"),
            "numeric formatting may differ");
        require(!GtoFreightTextGuard.sameNumericValue("R$ 6.900", "R$ 6.800"),
            "different offered values must be rejected");

        require("R$ 6.900,00".equals(GtoMoneyValue.canonical("R$ 6.900,00")),
            "Brazilian final-value cents must not inflate the amount by 100x");

        GtoResultValueConsensus.Decision first = GtoResultValueConsensus.observe(
            "", "live-1", "R$ 6.900", ""
        );
        require(first.stableValue.isEmpty(), "one result OCR must remain a candidate");

        GtoResultValueConsensus.Decision duplicateSource = GtoResultValueConsensus.observe(
            first.evidence, "live-1", "R$ 6.900", ""
        );
        require(duplicateSource.sampleCount == 1 && duplicateSource.stableValue.isEmpty(),
            "the same OCR pass cannot vote twice");

        GtoResultValueConsensus.Decision conflict = GtoResultValueConsensus.observe(
            first.evidence, "live-2", "R$ 6.800", ""
        );
        require(conflict.conflict && conflict.stableValue.isEmpty(),
            "two divergent result readings must not choose a value");

        GtoResultValueConsensus.Decision majority = GtoResultValueConsensus.observe(
            conflict.evidence, "live-3", "R$ 6.900", ""
        );
        require("R$ 6.900,00".equals(majority.stableValue),
            "two independent matching readings must stabilize the canonical amount");

        GtoResultValueConsensus.Decision immutable = GtoResultValueConsensus.observe(
            majority.evidence, "live-4", "R$ 7.900", majority.stableValue
        );
        require("R$ 6.900,00".equals(immutable.stableValue),
            "a later OCR outlier must never replace the latched amount");

        System.out.println("GtoFreightDataIntegrityTest: PASS");
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
