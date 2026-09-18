package com.nvu.operacional;

import java.util.Arrays;
import java.util.Collections;

public final class GtoDestinationOperationFinalContractTest {
    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    public static void main(String[] args) {
        String canonical = GtoCityTextResolver.canonicalizeVisibleDestinationSuffix(
            "Matecom Itopetuna", null
        );
        require("Matecom Itapetuna".equals(canonical),
            "Itopetuna não foi canonizada para Itapetuna: " + canonical);
        System.out.println("ITAPETUNA_OK");

        String noDuplicate = GtoCityTextResolver.canonicalizeVisibleDestinationSuffix(
            "Matecom Itapetuna", Arrays.asList("Motecom", "Matecom Itopetuna")
        );
        require("".equals(noDuplicate),
            "Destino completo correto foi alterado indevidamente: " + noDuplicate);
        System.out.println("DUPLICATE_OK");
    }
}
