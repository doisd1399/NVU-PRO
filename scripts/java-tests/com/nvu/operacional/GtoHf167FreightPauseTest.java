package com.nvu.operacional;

public final class GtoHf167FreightPauseTest {
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
        System.out.println("PASS " + message);
    }

    public static void main(String[] args) {
        String originLine = "Fazenda Areia Dourada - Área Rural";
        String destinationLine = "Agro Grão - Área Rural";

        check(
            "Fazenda Areia Dourada".equals(
                GtoPauseLocationParser.extractOperationalLocation(originLine)
            ),
            "Pause usa o prefixo operacional da origem"
        );
        check(
            "Agro Grão".equals(
                GtoPauseLocationParser.extractOperationalLocation(destinationLine)
            ),
            "Pause usa o prefixo operacional do destino"
        );
        check(
            "Área Rural".equals(GtoPauseLocationParser.extractAfterLastSeparator(originLine)),
            "parser legado continua disponível apenas para o sufixo diagnóstico"
        );
        check(
            "Fazenda Areia Dourada".equals(GtoPauseLocationParser.extractBeforeLastSeparator(originLine)),
            "empresa/prefixo permanece literal"
        );
        check(
            GtoFreightReviewPolicy.firstRequiredField(
                "Soja",
                "Fazenda Areia Dourada",
                "Agro Grão",
                "Agro Grão",
                "1100Km",
                "R$ 19.900,00"
            ).isEmpty(),
            "origem e destino com sufixo comum não são tratados como duplicados"
        );
        check(
            "Agro Grão Area Rural".equals(
                GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination(
                    "",
                    "Area Rural",
                    "Agro Grão",
                    "Soja\nFazenda Areia Dourada > Agro Grão\nArea Rural",
                    "Fazenda Areia Dourada > Agro Grão"
                )
            ),
            "Lista preserva destino completo em duas linhas"
        );
        check(
            GtoCargoAuthorityPolicy.resolvePauseCargo("Soja", true, "Sojo", 1).accepted,
            "autoridade same-row da Lista protege Soja durante o Pause"
        );
        check(
            "Soja".equals(
                GtoCargoAuthorityPolicy.resolvePauseCargo("Soja", true, "Sojo", 1).value
            ),
            "Sojo divergente não sobrescreve Soja"
        );
        System.out.println("GtoHf167FreightPauseTest: PASS");
    }
}
