package com.nvu.operacional;

public final class GtoHf163CargoAuthorityTest {
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
        System.out.println("PASS " + message);
    }

    public static void main(String[] args) {
        GtoCargoAuthorityPolicy.Resolution preserved =
            GtoCargoAuthorityPolicy.resolvePauseCargo("Soja", true, "Sojo", 2);
        check(preserved.accepted, "Carga da Lista same-row continua aceita");
        check(preserved.conflict, "Sojo divergente é marcado como conflito diagnóstico");
        check("Soja".equals(preserved.value), "Sojo não sobrescreve Soja certificada");
        check("LIST_SAME_ROW_PRESERVED_OVER_PAUSE_OCR".equals(preserved.source),
            "fonte final preserva a autoridade da Lista");

        GtoCargoAuthorityPolicy.Resolution pending =
            GtoCargoAuthorityPolicy.resolvePauseCargo("", false, "Sojo", 1);
        check(!pending.accepted, "um Sojo sem autoridade independente permanece pendente");
        GtoCargoAuthorityPolicy.Resolution twoReads =
            GtoCargoAuthorityPolicy.resolvePauseCargo("", false, "Sojo", 2);
        check(twoReads.accepted, "duas leituras literais concordantes podem confirmar Pause");
        check("Sojo".equals(twoReads.value), "o literal OCR é preservado sem correção ortográfica");

        check(!GtoCargoAuthorityPolicy.sameLiteral("Soja", "soja"),
            "comparação de autoridade preserva diferença de caixa");
        check(!GtoCargoAuthorityPolicy.sameLiteral("Soja", "Sojo"),
            "Soja e Sojo não são tratados como equivalentes por fuzzy matching");
        check(GtoCargoConsensusPolicy.selectedRowDirectPromotionAllowed(true, 0),
            "evidência same-row permite promoção da Carga sem fabricar voto");
        GtoFreightListTextAuthorityPolicy.FreightTextEvidence oneReadList =
            new GtoFreightListTextAuthorityPolicy.FreightTextEvidence(
                "Soja", 1, "Fazenda Areia Dourada", 1, "Agro Grão", 1
            );
        check(!GtoFreightListTextAuthorityPolicy.canDirectPromote(oneReadList, false),
            "barreira genérica permanece estrita fora da reconciliação same-row");
        System.out.println("GtoHf163CargoAuthorityTest: PASS");
    }
}
