package com.nvu.operacional;

/** HF38 regression: mixed ML Kit lines must not erase textual freight fields. */
public final class GtoHf38MixedFreightLinePolicyTest {
    private static void eq(String expected, String actual, String message) {
        if (!expected.equals(actual)) {
            throw new AssertionError(message + " expected=[" + expected + "] actual=[" + actual + "]");
        }
    }

    public static void main(String[] args) {
        eq("Tijolos Maciços",
            GtoFreightMixedLinePolicy.textualRemainder("Tijolos Maciços 600Km"),
            "cargo beside distance must survive");

        eq("Tijolos Maciços",
            GtoFreightMixedLinePolicy.textualRemainder("600Km Tijolos Maciços"),
            "distance before cargo must also survive");

        eq("CARGA TIJOLO",
            GtoFreightMixedLinePolicy.textualRemainder("CARGA TIJOLO 600Km R$ 12.200 Aceitar"),
            "cargo must survive a fully merged action/numeric line");

        eq("Fabrica de Tijolo > Cooper Log",
            GtoFreightMixedLinePolicy.textualRemainder("Fabrica de Tijolo > Cooper Log R$ 16.386"),
            "route beside value must survive");

        eq("Fábrica de Tijolo > Cooper Log",
            GtoFreightMixedLinePolicy.textualRemainder("R$ 16.386,00 Fábrica de Tijolo > Cooper Log"),
            "route with accents must remain literal");

        eq("", GtoFreightMixedLinePolicy.textualRemainder("600Km"),
            "numeric-only distance must not become text");
        eq("", GtoFreightMixedLinePolicy.textualRemainder("R$ 16.386,00"),
            "numeric-only money must not become text");
        eq("", GtoFreightMixedLinePolicy.textualRemainder("Aceitar"),
            "button action must not become freight text");

        eq("Tijolos Maciços",
            GtoFreightMixedLinePolicy.textualRemainder("Tijolos Maciços   600 km   Aceitar"),
            "spacing variants must remain robust");

        System.out.println("GtoHf38MixedFreightLinePolicyTest: PASS");
    }
}
