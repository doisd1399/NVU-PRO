package com.nvu.operacional;

public final class GtoHf164TextAuthorityAndSelectionTest {
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
        System.out.println("PASS " + message);
    }

    public static void main(String[] args) {
        GtoCargoAuthorityPolicy.Resolution listAuthority =
            GtoCargoAuthorityPolicy.resolvePauseCargo("Soja", true, "Sojo", 2);
        check(listAuthority.accepted, "autoridade da Lista continua aceita no Pause");
        check(listAuthority.conflict, "Sojo divergente fica registrado como conflito diagnóstico");
        check("Soja".equals(listAuthority.value), "Sojo não sobrescreve Soja same-row");

        GtoCargoAuthorityPolicy.Resolution noAuthorityOneRead =
            GtoCargoAuthorityPolicy.resolvePauseCargo("", false, "Sojo", 1);
        check(!noAuthorityOneRead.accepted, "Sojo isolado permanece pendente sem autoridade");
        GtoCargoAuthorityPolicy.Resolution noAuthorityTwoReads =
            GtoCargoAuthorityPolicy.resolvePauseCargo("", false, "Sojo", 2);
        check(noAuthorityTwoReads.accepted, "duas leituras literais podem confirmar o literal OCR");
        check("Sojo".equals(noAuthorityTwoReads.value), "sem autoridade o literal não é convertido para Soja");
        check(!GtoCargoConsensusPolicy.sameCandidate("Soja", "Sojo"),
            "comparação de consenso não transforma Soja em Sojo");

        check(!GtoFreightFieldEvidencePolicy.text("Soja", 1, true, false),
            "barreira genérica continua recusando uma única OCR");
        check(GtoFreightFieldEvidencePolicy.textFromSameRowAuthority("Soja", true),
            "contrato same-row aceita apenas autoridade já comprovada");

        GtoFreightListTextAuthorityPolicy.FreightTextEvidence oneRead =
            new GtoFreightListTextAuthorityPolicy.FreightTextEvidence(
                "Soja", 1,
                "Fazenda Areia Dourada", 1,
                "Agro Grão", 1
            );
        check(!GtoFreightListTextAuthorityPolicy.canDirectPromote(oneRead, false),
            "promoção genérica permanece estrita");
        check(GtoFreightListTextAuthorityPolicy.canPromoteSameRow(oneRead, true, false),
            "promoção same-row exige autoridade explícita e preserva os três literais");
        check(!GtoFreightListTextAuthorityPolicy.canPromoteSameRow(oneRead, false, false),
            "sem prova same-row a promoção continua bloqueada");

        check(GtoFreightSelectionPolicy.canCommitHumanBackedSelectedRow(
                2, 2, true, true, true, false, false
            ), "seleção humana same-row pode ser commitada após prova completa");
        check(!GtoFreightSelectionPolicy.canCommitHumanBackedSelectedRow(
                2, 1, true, true, true, false, false
            ), "linha diferente nunca é aceita");
        check(!GtoFreightSelectionPolicy.canCommitHumanBackedSelectedRow(
                2, 2, true, true, true, true, false
            ), "Pause/recovery ativo não é ignorado pela promoção direta");

        System.out.println("GtoHf164TextAuthorityAndSelectionTest: PASS");
    }
}
