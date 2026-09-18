package com.nvu.operacional;

public final class GtoPauseLocationParserTest {
    private static void require(String actual, String expected, String label) {
        if (!expected.equals(actual)) {
            throw new AssertionError(label + ": expected=" + expected + " actual=" + actual);
        }
    }

    public static void main(String[] args) {
        require(
            GtoPauseLocationParser.extractAfterLastSeparator("Origem: Cooper Log – Cruz do Oeste"),
            "Cruz do Oeste",
            "origem en dash"
        );
        require(
            GtoPauseLocationParser.extractAfterLastSeparator("Destino: Supermercado Santo Antonio - Nova Macaé"),
            "Nova Macaé",
            "destino hyphen"
        );
        require(
            GtoPauseLocationParser.extractAfterLastSeparator("Destino: Empresa - Região - Nova Macaé"),
            "Nova Macaé",
            "last separator"
        );
        require(
            GtoPauseLocationParser.extractAfterLastSeparator("Origem: Cooper Log — Cruz do Oeste"),
            "Cruz do Oeste",
            "origem em dash"
        );
        require(
            GtoPauseLocationParser.extractAfterLastSeparator("Origem: Cooper Log"),
            "",
            "missing separator is pending"
        );
        require(
            GtoPauseLocationParser.extractAfterLastSeparator("Destino: -"),
            "",
            "empty local is pending"
        );
        System.out.println("PASS GtoPauseLocationParser: Empresa -> Local seguro validado");
    }
}
