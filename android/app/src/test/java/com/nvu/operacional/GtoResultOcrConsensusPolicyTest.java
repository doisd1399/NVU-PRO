package com.nvu.operacional;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** Regression tests for multi-frame/full-frame + modal-crop OCR consensus. */
public class GtoResultOcrConsensusPolicyTest {

    @Test
    public void preservesCurrenciesNextToTheSimulatorEarningsField() {
        assertEquals("BRL", GtoResultOcrConsensusPolicy.extractCurrency("global-truck", "Concluído Valor a receber: R$ 4.099,00"));
        assertEquals("BRL", GtoResultOcrConsensusPolicy.extractCurrency("global-truck", "Valor a receber: R$ 100,00 Bônus Video ADS: 0"));
        assertEquals("EUR", GtoResultOcrConsensusPolicy.extractCurrency("global-truck", "Concluído Valor a receber: € 4,099.00"));
        assertEquals("USD", GtoResultOcrConsensusPolicy.extractCurrency("toe-3", "Renda total: USD 6,547"));
        assertEquals("", GtoResultOcrConsensusPolicy.extractCurrency("toe-3", "Renda total: $ 6,547"));
        assertEquals("", GtoResultOcrConsensusPolicy.extractCurrency("toe-3", "Renda total: 6.547,00"));
        assertEquals("", GtoResultOcrConsensusPolicy.extractCurrency("toe-3", "Renda total: R$ 6.547,00 EUR 6.547,00"));
    }

    @Test
    public void handlesWholeAmountsAndRejectsMalformedGrouping() {
        assertEquals(Long.valueOf(654700), GtoResultOcrConsensusPolicy.parseAmountCents("6,547"));
        assertEquals(Long.valueOf(1061400), GtoResultOcrConsensusPolicy.parseAmountCents("10614"));
        assertEquals(Long.valueOf(3051500), GtoResultOcrConsensusPolicy.parseAmountCents("30.515,00"));
        assertEquals(null, GtoResultOcrConsensusPolicy.parseAmountCents("12.34,56"));
        assertEquals(null, GtoResultOcrConsensusPolicy.parseAmountCents("-1,00"));
        assertEquals(null, GtoResultOcrConsensusPolicy.parseAmountCents("9223372036854775807"));
    }

    @Test
    public void acceptsReportedGtoResultWhenOcrIsFragmented() {
        String firstFrame = "Concluído\nValor a receber:";
        String secondFrame = "R$\n6.547,00\nReceber\nDobrar valor (ADS)";
        String merged = GtoResultOcrConsensusPolicy.mergeEvidence(firstFrame, secondFrame);

        assertTrue(GtoResultOcrConsensusPolicy.isSemanticallyComplete("global-truck", merged));
    }

    @Test
    public void doesNotAcceptTitleWithoutAmount() {
        String text = "Concluído\nValor a receber:\nReceber\nDobrar valor (ADS)";
        assertFalse(GtoResultOcrConsensusPolicy.isSemanticallyComplete("global-truck", text));
    }

    @Test
    public void mergesDuplicateEvidenceWithoutGrowingForever() {
        String merged = GtoResultOcrConsensusPolicy.mergeEvidence(
            "Concluído\nValor a receber: R$ 6.547,00",
            "Concluído\nValor a receber: R$ 6.547,00"
        );
        assertEquals(2, merged.split("\\n", -1).length);
        assertTrue(merged.contains("Concluído"));
        assertTrue(merged.contains("6.547,00"));
    }
    @Test
    public void rejectsSingleRegionAmountAsInsufficientConsensus() {
        assertEquals(null, GtoResultOcrConsensusPolicy.findConsensusAmount(
            "global-truck",
            "Concluído Valor a receber: R$ 2.125.400,00",
            "Concluído Receber Dobrar valor (ADS)",
            "FPS 36 120 km/h"
        ));
    }

    @Test
    public void acceptsOnlyWhenTwoIndependentRegionsAgree() {
        assertEquals(Long.valueOf(777500L), GtoResultOcrConsensusPolicy.findConsensusAmount(
            "global-truck",
            "Concluído Valor a receber: R$ 7.775,00",
            "Valor a receber 7.775,00 Receber",
            "Dobrar valor ADS"
        ));
    }

    @Test
    public void parsesBrazilianThousandsAndDecimalSeparatorsWithout100xInflation() {
        assertEquals(Long.valueOf(1616600L), GtoResultOcrConsensusPolicy.extractAmountCents(
            "global-truck",
            "Concluído Valor a receber: R$ 16.166,00 Receber"
        ));
    }

    @Test
    public void keepsFiveDigitPayoutAs16166ReaisNot1616600Reais() {
        assertEquals("R$ 16.166,00", GtoMoneyValue.canonical("16.166,00"));
    }

    @Test
    public void acceptsSubHundredGtoPayoutWhenTwoRegionsAgree() {
        assertEquals(Long.valueOf(9990L), GtoResultOcrConsensusPolicy.findConsensusAmount(
            "global-truck",
            "Concluído Valor a receber: R$ 99,90",
            "Valor a receber 99,90 Receber",
            "Dobrar valor ADS"
        ));
    }

}
