package com.nvu.operacional;

public final class ProReceiptScreenshotTest {
    public static void main(String[] args) {
        String result = "Concluído\nValor a receber: R$ 2.397,00\nReceber\nDobrar valor (ADS)";
        if (!GtoResultOcrConsensusPolicy.isSemanticallyComplete("global-truck", result)) {
            throw new AssertionError("A tela de conclusão GTO deve ser reconhecida");
        }
        Long amount = GtoResultOcrConsensusPolicy.findFastPathAmountPair(
            "global-truck", "Valor a receber: R$ 2.397,00", "Valor a receber: R$ 2.397,00", result);
        if (amount == null || amount != 239700L) {
            throw new AssertionError("O ganho de R$ 2.397,00 deve ser confirmado em centavos");
        }
        if (GtoResultOcrConsensusPolicy.findFastPathAmountPair(
            "global-truck", "Valor a receber: R$ 2.397,00", "Valor a receber: R$ 2.897,00") != null) {
            throw new AssertionError("Leituras conflitantes não podem registrar viagem");
        }
        if (GtoResultOcrConsensusPolicy.findFastPathAmountPair(
            "global-truck", "Valor a receber: R$ 101,00", "Valor a receber: R$ 101,00",
            "Concluído Valor a receber: R$ 2.563,00") != null) {
            throw new AssertionError("Duas escalas da mesma leitura errada não vencem o modal de R$ 2.563,00");
        }
        if (!Long.valueOf(256300L).equals(GtoResultOcrConsensusPolicy.findFastPathAmountPair(
            "global-truck", "Valor a receber: R$ 101,00", "Valor a receber: R$ 101,00",
            "Concluído Valor a receber: R$ 2.563,00", "Valor a receber: R$ 2.563,00"))) {
            throw new AssertionError("Modal e frame completo concordantes confirmam R$ 2.563,00");
        }
        if (GtoResultOcrConsensusPolicy.extractAmountCents("global-truck", "Valor a receber R$ 101,00") != null
            || GtoResultOcrConsensusPolicy.findConsensusAmount("global-truck",
                "Valor a receber R$ 101,00", "Valor a receber R$ 101,00") != null) {
            throw new AssertionError("R$ 101,00 não pode ser promovido como ganho GTO");
        }
        String fieldResult = "Concluído\nValor a receber: R$ 2.333,00\nReceber\nDobrar valor (ADS)";
        if (!GtoResultOcrConsensusPolicy.isSemanticallyComplete("global-truck", fieldResult)
            || GtoResultOcrConsensusPolicy.hasConfirmedRewardedBonus(fieldResult)
            || !Long.valueOf(233300L).equals(GtoResultOcrConsensusPolicy.findConsensusAmount(
                "global-truck", fieldResult, "Valor a receber: R$ 2.333,00"))) {
            throw new AssertionError("O resultado R$ 2.333,00 deve passar pela validação simples");
        }
        if (!GtoResultOcrConsensusPolicy.hasConfirmedRewardedBonus(
            "Concluído Valor a receber: R$ 2.333,00 Bonus Video Ads: 150,00")) {
            throw new AssertionError("Bônus pago não pode ser registrado como resultado normal");
        }
        System.out.println("PASS: resultado GTO da captura, valor e consenso OCR");
    }
}
