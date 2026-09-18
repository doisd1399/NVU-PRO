package com.nvu.operacional;

import java.util.Locale;

/**
 * Field-level review policy used after the selected row identity is already confirmed.
 * Missing text never invalidates the selected row and manual values are never autocorrected.
 */
final class GtoFreightReviewPolicy {
    static final String CARGO = "CARGO";
    static final String ORIGIN = "ORIGIN";
    // Legacy key retained for old snapshots; it no longer owns operational origin.
    static final String ORIGIN_COMPANY = "ORIGIN_COMPANY";
    static final String DESTINATION_COMPANY = "DESTINATION_COMPANY";
    static final String DESTINATION = "DESTINATION";
    static final String DISTANCE = "DISTANCE";
    static final String VALUE = "VALUE";
    static final String LOCAL_INTEGRITY = "LOCAL_INTEGRITY";
    static final String MANUAL_ROUTE_ORIGIN = "MANUAL_ROUTE_ORIGIN";
    static final String MANUAL_ROUTE_DESTINATION = "MANUAL_ROUTE_DESTINATION";

    private GtoFreightReviewPolicy() {}

    static String firstRequiredField(
        String cargo,
        String origin,
        String destinationCompany,
        String destination,
        String distance,
        String value
    ) {
        if (!isOperationalTextUsable(cargo)) return CARGO;
        if (!isOperationalTextUsable(origin)) return ORIGIN;
        // HF14: destinationCompany is optional metadata. It may be captured and
        // preserved internally when readable, but it is never a driver-required field.
        if (!isOperationalTextUsable(destination)) return DESTINATION;
        // One canonical rule applies to every source: duplicated origin/destination is
        // unsafe and must be reread, never accepted through a source-specific exception.
        if (sameVisibleText(origin, destination)) return DESTINATION;
        if (!validDistance(distance)) return DISTANCE;
        if (!validMoney(value)) return VALUE;
        return "";
    }

    static boolean isManualValueValid(String field, String value) {
        if (field == null) return false;
        String key = field.trim().toUpperCase(Locale.ROOT);
        if (DISTANCE.equals(key)) return validDistance(value);
        if (VALUE.equals(key)) return validMoney(value);
        if (MANUAL_ROUTE_ORIGIN.equals(key) || MANUAL_ROUTE_DESTINATION.equals(key)) {
            return GtoManualRouteSelectionPolicy.isValidLocation(value);
        }
        return CARGO.equals(key) || ORIGIN.equals(key) || ORIGIN_COMPANY.equals(key) || DESTINATION.equals(key)
            ? validManualText(value)
            : false;
    }

    static String preserveLiteralManualText(String value) {
        return value == null ? "" : value.trim();
    }

    static boolean isAutomaticTextUsable(String value) {
        return isOperationalTextUsable(value);
    }

    private static boolean isOperationalTextUsable(String value) {
        return validText(value) && !isObviousNoise(value);
    }

    private static boolean validText(String value) {
        if (value == null) return false;
        String trimmed = value.trim();
        if (trimmed.length() < 2 || trimmed.length() > 220) return false;
        int letters = 0;
        int useful = 0;
        for (int i = 0; i < trimmed.length(); i++) {
            char c = trimmed.charAt(i);
            if (Character.isLetter(c)) letters++;
            if (!Character.isWhitespace(c)) useful++;
        }
        return letters >= 2 && useful > 0 && letters / (float) useful >= 0.55f;
    }

    private static boolean validManualText(String value) {
        return isOperationalTextUsable(value);
    }

    private static boolean sameVisibleText(String first, String second) {
        if (first == null || second == null) return false;
        String a = normalizeVisible(first);
        String b = normalizeVisible(second);
        return !a.isEmpty() && a.equals(b);
    }

    private static String normalizeVisible(String value) {
        return value == null
            ? ""
            : value.trim().toLowerCase(Locale.ROOT).replaceAll("\\s+", " ");
    }

    private static boolean isObviousNoise(String value) {
        if (value == null) return true;
        String normalized = normalizeVisible(value);
        // Common HUD/action fragments and the exact garbage observed in the rejected
        // HF25/HF102 physical runs are never valid freight field values by themselves.
        if (normalized.equals("oi")
            || normalized.equals("ok")
            || normalized.equals("fps")
            || normalized.equals("km")
            || normalized.equals("nvu")
            || normalized.equals("aceitar")
            || normalized.equals("operação")
            || normalized.equals("operacao")
            || normalized.equals("carga")
            || normalized.equals("origem")
            || normalized.equals("destino")
            || normalized.equals("valor")
            || normalized.equals("distância")
            || normalized.equals("distancia")) return true;
        // OCR often returns the beginning of the next label as a plausible phrase.
        // These short label fragments must never be accepted as cargo or a location.
        return normalized.matches("^(carga|origem|destino)\\s+(e|de|do|da|final)$")
            || normalized.matches("^(carga|origem|destino)\\s+(e|ou)\\s+(carga|origem|destino)$");
    }

    private static boolean validDistance(String value) {
        if (value == null) return false;
        String digits = value.replaceAll("[^0-9]", "");
        if (digits.isEmpty()) return false;
        try {
            int km = Integer.parseInt(digits);
            return km >= 10 && km <= 10_000;
        } catch (Exception ignored) {
            return false;
        }
    }

    private static boolean validMoney(String value) {
        Double parsed = GtoMoneyValue.parseReais(value);
        return parsed != null && parsed >= 100d && parsed <= 100_000_000d;
    }
}
