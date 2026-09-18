package com.nvu.operacional;

public final class GtoHf170DestinationAuthorityTest {
    private static void expect(String actual, String expected, String message) {
        if (!expected.equals(actual)) {
            throw new AssertionError(message + " expected=" + expected + " actual=" + actual);
        }
    }

    public static void main(String[] args) {
        expect(
            GtoAcceptedFreightFieldPolicy.destination("Itapetuna", "Matecom", ""),
            "Matecom Itapetuna",
            "rota embrulhada deve recompor empresa e localidade da mesma linha"
        );
        expect(
            GtoAcceptedFreightFieldPolicy.destination("Motecom Matecom Itapetuna", "Motecom", ""),
            "Matecom Itapetuna",
            "prefixo OCR divergente não pode duplicar destino completo"
        );
        expect(
            GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination(
                "Matecom Itapetuna",
                "Motecom Matecom Itapetuna",
                "Motecom",
                "",
                "Metalurgica > Matecom | Itapetuna",
                "Metalurgica",
                false
            ),
            "Matecom Itapetuna",
            "destino completo da Lista deve vencer projeção contaminada"
        );
        expect(
            GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination(
                "Area Rural",
                "Area Rural",
                "",
                "Metalurgica > Agro Grão | Area Rural",
                "",
                "Metalurgica",
                false
            ),
            "Agro Grão Area Rural",
            "snapshot legado localidade-only deve recuperar rota da mesma Lista"
        );
        System.out.println("GtoHf170DestinationAuthorityTest: PASS");
    }
}
