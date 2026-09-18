package com.nvu.operacional;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/**
 * Closed driver-facing route selector for the GTO freight flow.
 * The list is deliberately literal: it is not populated by OCR, Firebase or fuzzy matching.
 */
final class GtoManualRouteSelectionPolicy {
    static final String SOURCE = "MANUAL_ROUTE_LIST";
    static final String ORIGIN_STEP = "ORIGIN";
    static final String DESTINATION_STEP = "DESTINATION";

    private static final List<String> LOCATIONS;

    static {
        ArrayList<String> values = new ArrayList<>(Arrays.asList(
            "Curitiba",
            "Registro",
            "Lages",
            "Lauro Muller",
            "Itapetuna",
            "Nova Macaé",
            "Aguas Velhas",
            "Fazenda Areia Dourada",
            "Cruz do Oeste",
            "Cooperativa Agro Grão"
        ));
        values.sort(Comparator.comparing(value -> value.toLowerCase(Locale.ROOT)));
        LOCATIONS = Collections.unmodifiableList(values);
    }

    private GtoManualRouteSelectionPolicy() {}

    static List<String> locations() {
        return LOCATIONS;
    }

    static boolean isValidLocation(String value) {
        if (value == null) return false;
        String candidate = value.trim();
        for (String location : LOCATIONS) {
            if (location.equals(candidate)) return true;
        }
        return false;
    }

    static boolean isStep(String value, String expected) {
        return expected != null && expected.equals(value == null ? "" : value.trim());
    }

    static String nextStep(String current) {
        return ORIGIN_STEP.equals(current) ? DESTINATION_STEP : "";
    }

    static String labelForStep(String step) {
        return DESTINATION_STEP.equals(step) ? "destino" : "origem";
    }
}
