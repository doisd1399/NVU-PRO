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


    // --- TOE 3 (resultado em €): relato "Não foi possível confirmar o valor do recebimento" ---
    // Tela: Distância 205 Km, Tempo 2 h 50 m, Combustível 168 l, Pena de dano - € 202, Penalidade de tempo -, Renda total € 3.503.
    private static final String TOE3_ROWS =
        "Resultados Distância acionada 205 Km Pena de dano - € 202 Tempo gasto 2 h 50 m Penalidade de tempo - "
        + "Combustível 168 l Renda total € 3.503 Continuar Remover Penalidades Bônus De 20%";
    private static final String TOE3_COLUMNS =
        "Distância acionada Tempo gasto Combustível 205 Km 2 h 50 m 168 l Pena de dano Penalidade de tempo Renda total "
        + "- € 202 - € 3.503 Continuar Remover Penalidades Bônus De 20%";

    @Test
    public void toe3PayoutIsTheRendaTotalRowWhateverTheOcrBlockOrder() {
        assertEquals(Long.valueOf(350300), GtoResultOcrConsensusPolicy.extractAmountCents("toe-3", TOE3_ROWS));
        // Agrupado por coluna: antes lia a Pena de dano (€ 202 -> 20200 centavos) como se fosse o ganho.
        assertEquals(Long.valueOf(350300), GtoResultOcrConsensusPolicy.extractAmountCents("toe-3", TOE3_COLUMNS));
        assertEquals(Long.valueOf(350300), GtoResultOcrConsensusPolicy.extractAmountCents("toe-3", "Renda total € 3.503"));
        assertEquals(Long.valueOf(350300), GtoResultOcrConsensusPolicy.extractAmountCents("toe-3", "RENDA TOTAL: EUR 3.503"));
        assertEquals(Long.valueOf(20200), GtoResultOcrConsensusPolicy.extractAmountCents("toe-3", "Renda total € 202"));
        assertEquals(Long.valueOf(415673), GtoResultOcrConsensusPolicy.extractAmountCents("toe-3", "Renda total: € 4.156,73 Distância: 2621 km"));
    }

    @Test
    public void toe3NeverTurnsAPercentageOrAnotherGridValueIntoThePayout() {
        // Rótulo lido, valor não lido: antes o "20%" do botão de bônus virava 20,00.
        assertEquals(null, GtoResultOcrConsensusPolicy.extractAmountCents("toe-3",
            "Pena de dano Penalidade de tempo Renda total Continuar Remover Penalidades Bônus De 20%"));
        assertEquals(null, GtoResultOcrConsensusPolicy.extractAmountCents("toe-3", "Renda total 168 l 205 Km 2 h 50 m"));
        assertEquals(null, GtoResultOcrConsensusPolicy.extractAmountCents("toe-3", "Pena de dano - € 202"));
        // Com o € perdido pelo OCR, o último número da área vale (a Pena de dano vem antes).
        assertEquals(Long.valueOf(350300), GtoResultOcrConsensusPolicy.extractAmountCents("toe-3",
            "Pena de dano Penalidade de tempo Renda total - 202 - 3.503 Continuar"));
    }

    @Test
    public void toe3RewardedBonusLayoutKeepsTheBaseAmountAndStillBlocksTheTrip() {
        String withBonus = "Resultados Renda total: € 2.621 Bônus Video ADS: € 524,20 Total: € 3.145,20";
        assertEquals(Long.valueOf(262100), GtoResultOcrConsensusPolicy.extractAmountCents("toe-3", withBonus));
        assertTrue(GtoResultOcrConsensusPolicy.hasConfirmedRewardedBonus(withBonus));
        // O botão "Bônus De 20%" sem valor pago não é evidência de bônus consumido.
        assertFalse(GtoResultOcrConsensusPolicy.hasConfirmedRewardedBonus(TOE3_ROWS));
        assertFalse(GtoResultOcrConsensusPolicy.hasConfirmedRewardedBonus(TOE3_COLUMNS));
    }

    @Test
    public void toe3ConsensusAgreesAcrossDifferentlyGroupedReads() {
        // Modal agrupado por coluna + recorte do valor por linha: os dois votam no mesmo ganho.
        assertEquals(Long.valueOf(350300), GtoResultOcrConsensusPolicy.findConsensusAmount("toe-3", TOE3_COLUMNS, "Penalidade de tempo - Renda total € 3.503"));
        assertEquals(Long.valueOf(350300), GtoResultOcrConsensusPolicy.findFastPathAmountPair("toe-3",
            "Renda total € 3.503", "Renda total € 3.503", TOE3_COLUMNS, TOE3_ROWS));
        assertEquals("EUR", GtoResultOcrConsensusPolicy.extractCurrency("toe-3", TOE3_ROWS));
        assertTrue(GtoResultOcrConsensusPolicy.isSemanticallyComplete("toe-3", TOE3_COLUMNS));
    }

    @Test
    public void toe3RegionsCoverTheRendaTotalRowAndTheValueCellOfTheReportedScreen() {
        // Captura reportada: 2712x1220. Linha "Renda total" x 0.520-0.680 / y 0.618-0.660; célula branca x 0.600-0.678.
        float[] row = GtoResultOcrConsensusPolicy.amountRegion("toe-3", 2712, 1220);
        float[] cell = GtoResultOcrConsensusPolicy.amountAltRegion("toe-3", 2712, 1220);
        assertTrue(row[0] <= 0.52f && row[0] + row[2] >= 0.68f);
        assertTrue(row[1] <= 0.618f && row[1] + row[3] >= 0.660f);
        assertTrue(cell[0] <= 0.600f && cell[0] + cell[2] >= 0.678f);
        assertTrue(cell[1] <= 0.618f && cell[1] + cell[3] >= 0.660f);
        // O recorte da célula não alcança o rótulo (só o valor).
        assertTrue(cell[0] > 0.56f);
        // Telas mais estreitas (16:9) e mais largas (21:9) mantêm a célula dentro do recorte.
        for (int[] size : new int[][]{{1920, 1080}, {2520, 1080}, {2400, 1080}}) {
            float aspect = size[0] / (float) size[1];
            float vw = aspect > 20f / 9f ? (20f / 9f) / aspect : 1f, vx = (1f - vw) / 2f;
            float vh = aspect < 20f / 9f ? aspect / (20f / 9f) : 1f, vy = (1f - vh) / 2f;
            float[] c = GtoResultOcrConsensusPolicy.amountAltRegion("toe-3", size[0], size[1]);
            float cellLeft = vx + vw * 0.600f, cellRight = vx + vw * 0.678f, cellTop = vy + vh * 0.618f, cellBottom = vy + vh * 0.660f;
            assertTrue(size[0] + "x" + size[1], c[0] <= cellLeft && c[0] + c[2] >= cellRight && c[1] <= cellTop && c[1] + c[3] >= cellBottom);
        }
        // Os demais simuladores ficam exatamente como estavam (termina em 61% da altura).
        for (String key : new String[]{"global-truck", "wtds", "wbds", ""}) {
            float[] other = GtoResultOcrConsensusPolicy.amountRegion(key, 2712, 1220);
            assertEquals(0.28f, other[0], 0.0001f);
            assertEquals(0.27f, other[1], 0.0001f);
            assertEquals(0.44f, other[2], 0.0001f);
            assertEquals(0.34f, other[3], 0.0001f);
            float[] alt = GtoResultOcrConsensusPolicy.amountAltRegion(key, 2712, 1220);
            assertEquals(other[0], alt[0], 0.0001f);
            assertEquals(other[3], alt[3], 0.0001f);
        }
    }

    @Test
    public void toe3ValueCellReadAcceptsOnlyASingleAmount() {
        assertEquals(Long.valueOf(393400), GtoResultOcrConsensusPolicy.extractToe3CellAmountCents("€ 3.934"));
        assertEquals(Long.valueOf(393400), GtoResultOcrConsensusPolicy.extractToe3CellAmountCents("€3.934"));
        assertEquals(Long.valueOf(393400), GtoResultOcrConsensusPolicy.extractToe3CellAmountCents("3.934"));
        assertEquals(Long.valueOf(415673), GtoResultOcrConsensusPolicy.extractToe3CellAmountCents("€ 4.156,73"));
        assertEquals(null, GtoResultOcrConsensusPolicy.extractToe3CellAmountCents("- € 214 € 3.934"));
        assertEquals(null, GtoResultOcrConsensusPolicy.extractToe3CellAmountCents(""));
        assertEquals(null, GtoResultOcrConsensusPolicy.extractToe3CellAmountCents("tal"));
        assertEquals(null, GtoResultOcrConsensusPolicy.extractToe3CellAmountCents("0"));
    }

    @Test
    public void toe3ResultScreenIsRecognisedEvenWhenTheRendaTotalLabelIsMisread() {
        assertTrue(GtoResultOcrConsensusPolicy.isToe3ResultScreen("Renda total € 3.934"));
        assertTrue(GtoResultOcrConsensusPolicy.isToe3ResultScreen("Rendatotal"));
        assertTrue(GtoResultOcrConsensusPolicy.isToe3ResultScreen("Distância acionada 224 Km Pena de dano - € 214 Continuar Remover Penalidades"));
        assertTrue(GtoResultOcrConsensusPolicy.isToe3ResultScreen("Combustível 339 l Continuar"));
        // Uma palavra solta (ou uma tela qualquer com valor em €) não basta.
        assertFalse(GtoResultOcrConsensusPolicy.isToe3ResultScreen("Continuar"));
        assertFalse(GtoResultOcrConsensusPolicy.isToe3ResultScreen("€ 3.934"));
        assertFalse(GtoResultOcrConsensusPolicy.isToe3ResultScreen(""));
    }

    @Test
    public void toe3PayoutNeedsTwoIndependentSources() {
        // Linha + célula são os mesmos pixels: sozinhas NÃO bastam (um 6 lido como 8 se repetiria nas duas).
        assertEquals(null, GtoResultOcrConsensusPolicy.findToe3Amount("Renda total € 3.934", "€ 3.934", "", "", null));
        // Célula + modal (regiões independentes).
        assertEquals(Long.valueOf(393400), GtoResultOcrConsensusPolicy.findToe3Amount("", "€ 3.934", "Renda total € 3.934 Continuar", "", null));
        // Linha + tela inteira.
        assertEquals(Long.valueOf(393400), GtoResultOcrConsensusPolicy.findToe3Amount("Renda total € 3.934", "", "", "Renda total € 3.934", null));
        // Modal + tela inteira, sem os recortes dedicados.
        assertEquals(Long.valueOf(393400), GtoResultOcrConsensusPolicy.findToe3Amount("", "", "Renda total € 3.934", "Renda total € 3.934", null));
        // Mesmo valor lido no quadro anterior (tela estática, nova tentativa): vale.
        assertEquals(Long.valueOf(393400), GtoResultOcrConsensusPolicy.findToe3Amount("", "€ 3.934", "", "", Long.valueOf(393400)));
        assertEquals(Long.valueOf(393400), GtoResultOcrConsensusPolicy.findToe3Amount("Renda total € 3.934", "€ 3.934", "", "", Long.valueOf(393400)));
        // Leitura única no primeiro quadro não basta.
        assertEquals(null, GtoResultOcrConsensusPolicy.findToe3Amount("", "€ 3.934", "", "", null));
        // Quadro anterior com outro valor (animação de contagem): não confirma.
        assertEquals(null, GtoResultOcrConsensusPolicy.findToe3Amount("", "€ 3.934", "", "", Long.valueOf(210000)));
        // Duas fontes independentes discordam (3.934 x 8.934): sem consenso.
        assertEquals(null, GtoResultOcrConsensusPolicy.findToe3Amount("Renda total € 3.934", "€ 3.934", "Renda total € 8.934", "", null));
        // 6 -> 8 repetido em linha+célula e lido certo no modal: o modal e o erro empatam em fontes? Não: o erro só tem 1 fonte.
        assertEquals(null, GtoResultOcrConsensusPolicy.findToe3Amount("Renda total € 3.984", "€ 3.984", "Renda total € 3.934", "", null));
        // A Pena de dano nunca vira ganho, nem no recorte da célula.
        assertEquals(null, GtoResultOcrConsensusPolicy.findToe3Amount("", "- € 214", "", "", null));
        assertEquals(Long.valueOf(21400), GtoResultOcrConsensusPolicy.toe3BestCandidate("", "€ 214", "", ""));
        assertEquals(null, GtoResultOcrConsensusPolicy.toe3BestCandidate("", "", "", ""));
    }

    @Test
    public void toe3CurrencyComesFromTheValueCellWhenThereIsNoLabelToBindTo() {
        assertEquals("EUR", GtoResultOcrConsensusPolicy.toe3Currency("€ 3.934"));
        assertEquals("EUR", GtoResultOcrConsensusPolicy.toe3Currency("Renda total", "€ 3.934", "- € 214"));
        assertEquals("", GtoResultOcrConsensusPolicy.toe3Currency("3.934"));
        assertEquals("", GtoResultOcrConsensusPolicy.toe3Currency("€ 3.934", "US$ 3.934"));
    }
}
