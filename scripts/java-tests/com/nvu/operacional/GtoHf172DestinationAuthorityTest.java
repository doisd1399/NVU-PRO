package com.nvu.operacional;

public final class GtoHf172DestinationAuthorityTest {
    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    public static void main(String[] args) {
        require("Matecom Itapetuna".equals(
            GtoAcceptedFreightFieldPolicy.destination("Itapetuna", "Motecom", "")
        ), "alias OCR deve virar Matecom ao compor localidade-only");

        require("Matecom Itapetuna".equals(
            GtoAcceptedFreightFieldPolicy.destination("Motecom Matecom Itapetuna", "Motecom", "")
        ), "prefixo Motecom duplicado deve desaparecer do destino");

        require("Matecom Itapetuna".equals(
            GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination(
                "Motecom Matecom Itapetuna",
                "Motecom Matecom Itapetuna",
                "Motecom",
                "",
                "Metalurgica > Motecom Matecom",
                "Metalurgica",
                false
            )
        ), "projeção accepted-list não pode reintroduzir Motecom");

        require(GtoAcceptedFreightFieldPolicy.sameLiteralDestination(
            "Itapetuna", "Motecom", "Itapetuna", "Matecom"
        ), "Motecom e Matecom são o mesmo alias fechado para esta autoridade");

        require(!GtoAcceptedFreightFieldPolicy.sameLiteralDestination(
            "Itapetuna", "Empresa Alfa", "Itapetuna", "Empresa Beta"
        ), "empresas diferentes não podem ser igualadas por fuzzy matching");

        require(!GtoDestinationTextAuthorityPolicy.containsForbiddenAlias("Matecom Itapetuna"),
            "destino canônico não pode conter alias proibido");
        require(GtoDestinationTextAuthorityPolicy.containsForbiddenAlias("Motecom Itapetuna"),
            "fixture deve reconhecer a evidência OCR proibida antes da canonicalização");

        System.out.println("GtoHf172DestinationAuthorityTest: PASS");
    }
}
