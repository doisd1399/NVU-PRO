package com.nvu.operacional;

import java.util.Arrays;

public final class GtoHf39CargoTextRecoveryPolicyTest {
    private static void eq(String expected, String actual, String m) {
        if (!expected.equals(actual)) throw new AssertionError(m + " expected=" + expected + " actual=" + actual);
    }
    private static void req(boolean v, String m) { if (!v) throw new AssertionError(m); }

    public static void main(String[] args) {
        eq("Tijolos Maciços", GtoCargoTextRecoveryPolicy.bestLiteralCandidate(
            Arrays.asList("Tijolos Maciços 600Km", "600Km")),
            "mixed cargo+km must retain cargo");
        eq("CARGA TIJOLO", GtoCargoTextRecoveryPolicy.bestLiteralCandidate(
            Arrays.asList("CARGA TIJOLO", "600Km")),
            "uppercase cargo must remain literal");
        eq("Barras de Ferro", GtoCargoTextRecoveryPolicy.bestLiteralCandidate(
            Arrays.asList("Barras de Ferro", "550Km")),
            "ordinary cargo must remain literal");
        eq("", GtoCargoTextRecoveryPolicy.bestLiteralCandidate(
            Arrays.asList("600Km", "R$ 16386", "Aceitar")),
            "operational-only OCR must not invent cargo");
        req(!GtoCargoTextRecoveryPolicy.isCargoLike("Fabrica de Tijolo > Cooper Log"),
            "route must never become cargo");
        System.out.println("GtoHf39CargoTextRecoveryPolicyTest: PASS");
    }
}
