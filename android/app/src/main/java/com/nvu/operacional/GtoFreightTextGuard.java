package com.nvu.operacional;

import java.text.Normalizer;
import java.util.Locale;

/**
 * Small, dependency-free comparison guard shared by the native freight flow.
 * It deliberately normalizes representation only; it never invents values.
 */
final class GtoFreightTextGuard {
    private GtoFreightTextGuard() {}

    static boolean sameVisibleText(String first, String second) {
        String a = normalizeVisible(first);
        String b = normalizeVisible(second);
        return !a.isEmpty() && !b.isEmpty() && a.equals(b);
    }

    /** Exact visible-text equality for operational fields; no case, accent, or spelling folding. */
    static boolean sameLiteralText(String first, String second) {
        String a = preserveLiteral(first);
        String b = preserveLiteral(second);
        return !a.isEmpty() && !b.isEmpty() && a.equals(b);
    }

    static boolean sameNumericValue(String first, String second) {
        String a = digitsOnly(first);
        String b = digitsOnly(second);
        return !a.isEmpty() && !b.isEmpty() && stripLeadingZeros(a).equals(stripLeadingZeros(b));
    }

    private static String normalizeVisible(String value) {
        if (value == null) return "";
        return Normalizer.normalize(value.trim(), Normalizer.Form.NFC)
            .toLowerCase(Locale.ROOT)
            .replaceAll("\\s+", " ")
            .trim();
    }

    private static String preserveLiteral(String value) {
        if (value == null) return "";
        return Normalizer.normalize(value.trim(), Normalizer.Form.NFC)
            .replaceAll("\\s+", " ")
            .trim();
    }

    private static String digitsOnly(String value) {
        if (value == null) return "";
        return value.replaceAll("[^0-9]", "");
    }

    private static String stripLeadingZeros(String value) {
        String result = value.replaceFirst("^0+(?!$)", "");
        return result.isEmpty() ? "0" : result;
    }
}

