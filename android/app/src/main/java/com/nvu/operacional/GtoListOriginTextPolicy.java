package com.nvu.operacional;

import java.text.Normalizer;
import java.util.Locale;

/**
 * List-only authority for known deterministic OCR aliases in the freight origin field.
 *
 * This policy is intentionally exact and closed: it never uses edit distance, fuzzy matching,
 * dictionaries or route-wide recomposition. Unknown origins are returned literally. Pause,
 * cargo and destination must never call this policy.
 */
final class GtoListOriginTextPolicy {
    private GtoListOriginTextPolicy() {}

    static String canonicalizeOcrLiteral(String value) {
        String literal = clean(value);
        if (literal.isEmpty()) return "";
        String normalized = normalize(literal);
        if ("metalurgioa".equals(normalized)) return "Metalurgica";
        return literal;
    }

    private static String clean(String value) {
        return value == null ? "" : value.replaceAll("\\s+", " ").trim();
    }

    private static String normalize(String value) {
        return Normalizer.normalize(clean(value), Normalizer.Form.NFD)
            .replaceAll("\\p{M}+", "")
            .toLowerCase(Locale.ROOT)
            .replaceAll("[^a-z0-9]+", " ")
            .replaceAll("\\s+", " ")
            .trim();
    }
}
