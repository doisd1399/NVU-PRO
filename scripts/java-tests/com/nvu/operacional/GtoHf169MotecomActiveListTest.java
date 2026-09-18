package com.nvu.operacional;

public final class GtoHf169MotecomActiveListTest {
    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    public static void main(String[] args) {
        String completeDestination = GtoAcceptedFreightFieldPolicy.destination(
            "Matecom Itapetuna", "Motecom", ""
        );
        require("Matecom Itapetuna".equals(completeDestination),
            "a empresa OCR divergente não pode prefixar um destino completo sem raw same-row");

        String duplicatedDestination = GtoAcceptedFreightFieldPolicy.destination(
            "Motecom Matecom Itapetuna", "Motecom", ""
        );
        require("Matecom Itapetuna".equals(duplicatedDestination),
            "prefixo OCR divergente já contaminado não pode permanecer no destino operacional");

        String acceptedDestination = GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination(
            "Matecom Itapetuna",
            "Matecom Itapetuna",
            "Motecom",
            "",
            "Metalurgica > Motecom",
            "Metalurgica",
            false
        );
        require("Matecom Itapetuna".equals(acceptedDestination),
            "accepted-list completo deve vencer metadata divergente");

        require(GtoDeterministicFlowPolicy.freightListIsInformationalOnly(
            "TRIP_IN_PROGRESS", false
        ), "Lista reaberta durante viagem deve ser informativa sem toque de Aceitar");

        System.out.println("GtoHf169MotecomActiveListTest: PASS");
    }
}
