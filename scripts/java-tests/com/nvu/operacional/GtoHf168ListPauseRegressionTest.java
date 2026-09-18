package com.nvu.operacional;

public final class GtoHf168ListPauseRegressionTest {
    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
        System.out.println("PASS " + message);
    }

    public static void main(String[] args) {
        String rawList = "Dobradicas | Metalurgica > Matecom | Itapetuna | 300Km | R$ 5300";
        String visibleDestination = GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination(
            "", "Itapetuna", "Matecom", rawList, "Metalurgica > Matecom", "Metalurgica"
        );
        require(
            "Matecom Itapetuna".equals(visibleDestination),
            "Lista recompõe empresa e continuação da cidade no destino"
        );

        String directDestination = GtoAcceptedFreightFieldPolicy.destination(
            "Itapetuna", "Matecom", rawList
        );
        require(
            "Matecom Itapetuna".equals(directDestination),
            "destino oficial isolado não perde a empresa da mesma linha"
        );

        String pauseOrigin = GtoPauseLocationParser.extractOperationalLocation(
            "Metalurgica - Nova Mocaé"
        );
        String pauseDestination = GtoPauseLocationParser.extractOperationalLocation(
            "Matecom - Itapetuna"
        );
        require("Metalurgica".equals(pauseOrigin), "Pause preserva o identificador operacional da origem");
        require("Matecom".equals(pauseDestination), "Pause preserva o identificador operacional do destino");

        String pauseDiagnosticOrigin = GtoPauseLocationParser.extractAfterLastSeparator(
            "Metalurgica - Nova Mocaé"
        );
        String pauseDiagnosticDestination = GtoPauseLocationParser.extractAfterLastSeparator(
            "Matecom - Itapetuna"
        );
        require("Nova Mocaé".equals(pauseDiagnosticOrigin), "Pause mantém a localidade da origem como evidência auxiliar");
        require("Itapetuna".equals(pauseDiagnosticDestination), "Pause mantém a localidade do destino como evidência auxiliar");

        System.out.println("GtoHf168ListPauseRegressionTest: PASS");
    }
}
