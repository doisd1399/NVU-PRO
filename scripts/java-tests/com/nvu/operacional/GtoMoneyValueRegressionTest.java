package com.nvu.operacional;

public final class GtoMoneyValueRegressionTest {
    public static void main(String[] args) {
        require("R$ 5.300,00".equals(GtoMoneyValue.canonical("R$ 5.300,00")),
            "pt-BR thousands plus cents must render with grouping and cents");
        require("R$ 5.300,00".equals(GtoMoneyValue.canonical("R$ 5.300")),
            "GTO integer thousands formatting must render as pt-BR currency");
        require("R$ 5.300,00".equals(GtoMoneyValue.canonical("R$ 5300,00")),
            "comma cents must render as pt-BR currency");
        require("R$ 5.300,00".equals(GtoMoneyValue.canonical("R$ 5300.00")),
            "dot cents must render as pt-BR currency");
        require("R$ 5.300,50".equals(GtoMoneyValue.canonical("R$ 5.300,50")),
            "non-zero cents must be preserved");

        GtoResultValueConsensus.Decision first = GtoResultValueConsensus.observe(
            "", "pass-1", "R$ 5.300,00", ""
        );
        GtoResultValueConsensus.Decision second = GtoResultValueConsensus.observe(
            first.evidence, "pass-2", "R$ 5300.00", ""
        );
        require("R$ 5.300,00".equals(second.stableValue),
            "equivalent locale formats must agree in canonical pt-BR display");
        require(second.evidence.contains("=c530000"),
            "consensus evidence must be stored explicitly in cents");

        GtoResultValueConsensus.Decision centsFirst = GtoResultValueConsensus.observe(
            "", "cents-1", "R$ 5.300,50", ""
        );
        GtoResultValueConsensus.Decision centsSecond = GtoResultValueConsensus.observe(
            centsFirst.evidence, "cents-2", "R$ 5300,50", ""
        );
        require("R$ 5.300,50".equals(centsSecond.stableValue),
            "real cents must survive consensus");

        GtoResultValueConsensus.Decision legacyIgnored = GtoResultValueConsensus.observe(
            "old-pass=530000", "new-pass", "R$ 5.300,00", ""
        );
        require(legacyIgnored.sampleCount == 1 && legacyIgnored.stableValue.isEmpty(),
            "ambiguous pre-fix evidence must be ignored after upgrade");

        require(GtoMoneyValue.finalValueCompatibilityIssue("R$ 5300", "R$ 530000") != null,
            "100x cent-shift corruption must be rejected locally");
        require(GtoMoneyValue.finalValueCompatibilityIssue("R$ 5300", "R$ 5300,00") == null,
            "normal final value must be accepted");
        require(GtoMoneyValue.finalValueCompatibilityIssue("R$ 5300", "R$ 10600") == null,
            "broad safety gate must not reject a 2x value solely by ratio");

        System.out.println("GtoMoneyValueRegressionTest: PASS");
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
