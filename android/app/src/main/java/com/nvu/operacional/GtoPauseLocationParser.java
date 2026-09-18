package com.nvu.operacional;

/**
 * HF77 parser for pause-menu lines in the form "Empresa – Local".
 * It deliberately refuses to use the whole line when no separator is present.
 */
final class GtoPauseLocationParser {
    private GtoPauseLocationParser() {}

    static String extractAfterLastSeparator(String raw) {
        if (raw == null) return "";
        String value = normalizeWhitespace(raw);
        int separator = lastSeparatorIndex(value);
        if (separator <= 0 || separator >= value.length() - 1) return "";
        String[] pair = extractCompanyAndLocation(value);
        String local = pair == null ? "" : pair[1];
        return local;
    }

    /**
     * Returns the operational endpoint shown before the regional suffix. The GTO
     * Pause surface uses `Empresa – Área Rural`; for trip identity the visible
     * endpoint is the company/prefix (`Empresa`), not the shared suffix.
     */
    static String extractOperationalLocation(String raw) {
        return extractBeforeLastSeparator(raw);
    }

    /**
     * Returns the source company from the same Pause route line. This helper belongs
     * exclusively to the Pause parser and is used only to reject mixed snapshots.
     */
    static String extractBeforeLastSeparator(String raw) {
        String[] pair = extractCompanyAndLocation(raw);
        return pair == null ? "" : pair[0];
    }

    private static String[] extractCompanyAndLocation(String raw) {
        if (raw == null) return null;
        String value = normalizeWhitespace(raw);
        if (value.isEmpty()) return null;

        int separator = lastSeparatorIndex(value);
        if (separator <= 0 || separator >= value.length() - 1) return null;

        String company = normalizeWhitespace(value.substring(0, separator));
        String local = normalizeWhitespace(value.substring(separator + 1));
        if (company.isEmpty() || local.isEmpty()) return null;
        if (!hasUsefulLetters(company) || !hasUsefulLetters(local)) return null;
        return new String[] {company, local};
    }

    private static int lastSeparatorIndex(String value) {
        if (value == null) return -1;
        for (int i = value.length() - 1; i >= 0; i--) {
            char c = value.charAt(i);
            if (c == '-' || c == '\u2013' || c == '\u2014') return i;
        }
        return -1;
    }

    private static String normalizeWhitespace(String value) {
        return value == null ? "" : value.replaceAll("\\s+", " ").trim();
    }

    private static boolean hasUsefulLetters(String value) {
        int letters = 0;
        for (int i = 0; i < value.length(); i++) {
            if (Character.isLetter(value.charAt(i))) letters++;
        }
        return letters >= 2;
    }
}
