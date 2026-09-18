package com.nvu.operacional;

import java.text.Normalizer;
import java.util.List;
import java.util.Locale;

/**
 * Cross-row context that is safe to use without guessing a freight identity.
 * It only returns an origin when the readable rows on the same visible GTO page
 * agree literally after accent/case normalization and enough independent rows agree.
 */
final class GtoFreightContextPolicy {
    private GtoFreightContextPolicy() {}

    static String unanimousOrigin(List<String> origins, int visibleRowCount) {
        if (origins == null || origins.isEmpty()) return "";
        String canonical = "";
        String normalized = "";
        int agreeing = 0;
        for (String raw : origins) {
            String value = clean(raw);
            if (value.isEmpty()) continue;
            String n = norm(value);
            if (n.isEmpty()) continue;
            if (normalized.isEmpty()) {
                normalized = n;
                canonical = value;
                agreeing = 1;
            } else if (normalized.equals(n)) {
                agreeing++;
            } else {
                // Any readable conflict makes page context non-authoritative.
                return "";
            }
        }
        int rows = Math.max(0, visibleRowCount);
        int required = rows >= 4 ? 3 : 2;
        return agreeing >= required ? canonical : "";
    }

    private static String clean(String value) {
        return value == null ? "" : value.replaceAll("\\s+", " ").trim();
    }

    private static String norm(String value) {
        return Normalizer.normalize(clean(value), Normalizer.Form.NFD)
            .replaceAll("\\p{M}+", "")
            .toLowerCase(Locale.ROOT)
            .replaceAll("[^a-z0-9]+", " ")
            .replaceAll("\\s+", " ")
            .trim();
    }
}
