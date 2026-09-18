package com.nvu.operacional;

public final class GtoHf148DestinationOperationTest {
    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    public static void main(String[] args) {
        String raw = "Dobradicas | Metalurgica → Matecom Itapetuna | 300Km | R$ 5.300,00";
        String alreadyCombined = GtoAcceptedFreightFieldPolicy.destination(
            "Motecom Matecom Itapetuna", "Motecom", raw
        );
        require("Matecom Itapetuna".equals(alreadyCombined),
            "stale destination company must not be duplicated");

        String accepted = GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination(
            "Motecom Matecom Itapetuna",
            "Motecom Matecom Itapetuna",
            "Motecom",
            raw,
            "Metalurgica > Motecom",
            "Metalurgica",
            false
        );
        require("Matecom Itapetuna".equals(accepted),
            "accepted-list authority must collapse the duplicated destination");

        String localityOnly = GtoAcceptedFreightFieldPolicy.destination(
            "Area Rural", "Agro Grão", ""
        );
        require("Agro Grão Area Rural".equals(localityOnly),
            "locality-only destination must still be reconstructed once");

        String complete = GtoAcceptedFreightFieldPolicy.destination(
            "Matecom Itapetuna", "Motecom", raw
        );
        require("Matecom Itapetuna".equals(complete),
            "complete selected-row destination must remain canonical");
    }
}
