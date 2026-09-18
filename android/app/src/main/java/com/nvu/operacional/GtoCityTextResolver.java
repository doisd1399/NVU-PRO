package com.nvu.operacional;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Destination-text helper for OCR output.
 *
 * HF23 rule: OCR text is literal evidence. Known destinations may be compared for diagnostics,
 * but this helper never rewrites a visible destination, never injects accents and never applies
 * edit-distance autocorrection. Any real ambiguity must remain visible to the field-review flow.
 */
final class GtoCityTextResolver {
    private static final String[] PREFERRED_DESTINATIONS = new String[] {
        "Itapetuna",
        "Nova Macaé",
        "Registro",
        "Águas Velhas",
        "Faz Areia Dourada",
        "Cruz do Oeste",
        "Cooperativa Agro Grão",
        "Curitiba",
        "Lages",
        "Lauro Muller"
    };

    static final class Resolution {
        final String value;
        final boolean corrected;
        final String source;

        Resolution(String value, boolean corrected, String source) {
            this.value = value == null ? "" : value.trim();
            this.corrected = corrected;
            this.source = source == null ? "" : source;
        }
    }

    private GtoCityTextResolver() {}

    static Resolution resolveTrusted(String ocrValue, String expectedDestination, List<String> trustedCities) {
        String visible = clean(ocrValue);
        if (visible.isEmpty()) return new Resolution("", false, "");

        // Literal OCR is authoritative. Matching known values is diagnostic only and must
        // never silently replace what was actually read from the selected freight row.
        String expected = clean(expectedDestination);
        if (!expected.isEmpty()) {
            if (sameNormalized(visible, expected)) {
                return new Resolution(visible, false, "EXPECTED_DESTINATION_LITERAL_MATCH");
            }
            if (isSafeOneEditVariant(visible, expected)) {
                return new Resolution(visible, false, "EXPECTED_DESTINATION_NEAR_MATCH_NOT_APPLIED");
            }
        }

        if (trustedCities != null) {
            boolean near = false;
            for (String candidateRaw : trustedCities) {
                String candidate = clean(candidateRaw);
                if (candidate.isEmpty()) continue;
                if (sameNormalized(visible, candidate)) {
                    return new Resolution(visible, false, "TRUSTED_CITY_LITERAL_MATCH");
                }
                if (isSafeOneEditVariant(visible, candidate)) near = true;
            }
            if (near) return new Resolution(visible, false, "TRUSTED_CITY_NEAR_MATCH_NOT_APPLIED");
        }

        // Preferred names are also advisory-only. Keep the literal OCR spelling even if
        // a known city is only one edit away.
        for (String candidate : PREFERRED_DESTINATIONS) {
            if (sameNormalized(visible, candidate)) {
                return new Resolution(visible, false, "PREFERRED_DESTINATION_LITERAL_MATCH");
            }
            if (isSafeOneEditVariant(visible, candidate)) {
                return new Resolution(visible, false, "PREFERRED_DESTINATION_NEAR_MATCH_NOT_APPLIED");
            }
        }
        return new Resolution(visible, false, "LITERAL_OCR");
    }

    private static Resolution resolvePreferredDestination(String visible) {
        String normalizedVisible = normalize(visible);
        if (normalizedVisible.isEmpty()) return null;

        String best = "";
        int bestDistance = Integer.MAX_VALUE;
        boolean tie = false;
        for (String candidate : PREFERRED_DESTINATIONS) {
            String normalizedCandidate = normalize(candidate);
            if (normalizedVisible.equals(normalizedCandidate)) {
                return new Resolution(visible, false, "PREFERRED_DESTINATION_LITERAL_MATCH");
            }
            int maxDistance = normalizedCandidate.length() >= 8 ? 2 : 1;
            if (Math.abs(normalizedVisible.length() - normalizedCandidate.length()) > maxDistance) continue;
            if (normalizedVisible.charAt(0) != normalizedCandidate.charAt(0)) continue;
            int distance = editDistance(normalizedVisible, normalizedCandidate, maxDistance);
            if (distance < 0 || distance > maxDistance) continue;
            if (distance < bestDistance) {
                bestDistance = distance;
                best = candidate;
                tie = false;
            } else if (distance == bestDistance) {
                tie = true;
            }
        }
        if (!best.isEmpty() && !tie) {
            return new Resolution(visible, false, "PREFERRED_DESTINATION_NEAR_MATCH_NOT_APPLIED");
        }
        return null;
    }

    /**
     * The selected-row OCR is a larger, isolated crop of the exact row already verified by
     * row index + km + offered value. Let it correct only a one-character city variant when
     * its ML confidence is materially stronger. Other fields remain owned by page consensus.
     */
    static Resolution preferPreciseVerifiedRow(
        String stableValue,
        float stableConfidence,
        String preciseValue,
        float preciseConfidence
    ) {
        String stable = clean(stableValue);
        String precise = clean(preciseValue);
        if (stable.isEmpty() || precise.isEmpty()) return new Resolution(stable, false, "");
        if (sameNormalized(stable, precise)) return new Resolution(stable, false, "");
        if (!isSafeOneEditVariant(stable, precise)) return new Resolution(stable, false, "");

        // Confidence may be -1 on old ML Kit builds. In that case we do not rewrite text.
        if (preciseConfidence < 0.70f) return new Resolution(stable, false, "");
        if (stableConfidence >= 0f && preciseConfidence < stableConfidence + 0.035f) {
            return new Resolution(stable, false, "");
        }
        return new Resolution(precise, true, "VERIFIED_SELECTED_ROW_HIGHER_CONFIDENCE");
    }

    /**
     * Returns the single known GTO destination that is exactly one OCR edit away from
     * the visible text. This is advisory only: callers must obtain an independent
     * focused read before adopting the canonical spelling.
     */
    static String uniquePreferredNearCandidate(String visibleValue) {
        String visible = clean(visibleValue);
        if (visible.isEmpty()) return "";
        String found = "";
        for (String candidate : PREFERRED_DESTINATIONS) {
            if (sameNormalized(visible, candidate)) return "";
            if (!isSafeOneEditVariant(visible, candidate)) continue;
            if (!found.isEmpty() && !sameNormalized(found, candidate)) return "";
            found = candidate;
        }
        return found;
    }


    /**
     * Returns a canonical GTO destination only when the visible OCR maps to exactly one
     * official/trusted destination. Exact normalized matches (for example missing accents)
     * and a single one-edit OCR variant are accepted. Ambiguous matches return an empty
     * string so the caller can retry/review instead of guessing.
     */
    static String uniqueOfficialCanonicalCandidate(String visibleValue, List<String> trustedCities) {
        String visible = clean(visibleValue);
        if (visible.isEmpty()) return "";

        // Official simulator names have precedence over operation-provided aliases.
        // A stale trusted-city alias such as "Itopetuna" must never defeat the official
        // preferred spelling "Itapetuna" when the visible value is its unique one-edit
        // variant. Trusted operation values remain useful for exact names not present in
        // the built-in universe, but they are fallback data, not a higher authority.
        LinkedHashMap<String, String> canonical = new LinkedHashMap<>();
        for (String candidate : PREFERRED_DESTINATIONS) {
            String cleanCandidate = clean(candidate);
            String key = normalize(cleanCandidate);
            if (!key.isEmpty() && !canonical.containsKey(key)) canonical.put(key, cleanCandidate);
        }
        if (trustedCities != null) {
            for (String candidate : trustedCities) {
                String cleanCandidate = clean(candidate);
                String key = normalize(cleanCandidate);
                if (!key.isEmpty() && !canonical.containsKey(key)) canonical.put(key, cleanCandidate);
            }
        }

        String normalizedVisible = normalize(visible);
        String exact = canonical.get(normalizedVisible);
        if (exact != null && !exact.isEmpty()) {
            // If a stale trusted spelling is an exact alias but the official preferred
            // universe has one unique edit-distance correction, prefer the official name.
            String preferredNear = uniquePreferredNearCandidate(visible);
            if (!preferredNear.isEmpty()) return preferredNear;
            return exact;
        }

        String found = "";
        for (String candidate : canonical.values()) {
            if (!isSafeOneEditVariant(visible, candidate)) continue;
            if (!found.isEmpty() && !sameNormalized(found, candidate)) return "";
            found = candidate;
        }
        return found;
    }

    /**
     * Canonicalizes only the locality suffix of a selected-list destination when the
     * destination company is independently present on the same row. The company prefix
     * is matched by normalized tokens and is never rewritten; ambiguous or unknown
     * locality suffixes remain unresolved.
     */
    static String canonicalizeDestinationWithCompany(
        String visibleValue, String destinationCompany, List<String> trustedCities
    ) {
        String visible = clean(visibleValue);
        String company = clean(destinationCompany);
        if (visible.isEmpty() || company.isEmpty()) return "";

        String[] visibleTokens = visible.split("\\s+");
        String[] companyTokens = company.split("\\s+");
        if (visibleTokens.length <= companyTokens.length) return "";
        for (int i = 0; i < companyTokens.length; i++) {
            if (!normalize(visibleTokens[i]).equals(normalize(companyTokens[i]))) return "";
        }

        StringBuilder suffix = new StringBuilder();
        for (int i = companyTokens.length; i < visibleTokens.length; i++) {
            if (suffix.length() > 0) suffix.append(' ');
            suffix.append(visibleTokens[i]);
        }
        String canonicalSuffix = uniqueOfficialCanonicalCandidate(suffix.toString(), trustedCities);
        if (canonicalSuffix.isEmpty()) return "";
        return company + " " + canonicalSuffix;
    }

    /**
     * Canonicalizes only an official locality suffix of a complete selected-row value.
     * The prefix is copied literally and is never replaced by a trusted-company alias.
     * This is the safe path for values such as "Matecom Itopetuna" ->
     * "Matecom Itapetuna".
     */
    static String canonicalizeVisibleDestinationSuffix(
        String visibleValue, List<String> trustedCities
    ) {
        String visible = clean(visibleValue);
        if (visible.isEmpty()) return "";
        String[] tokens = visible.split("\\s+");
        if (tokens.length < 2) return "";
        for (int start = 1; start < tokens.length; start++) {
            StringBuilder suffix = new StringBuilder();
            for (int i = start; i < tokens.length; i++) {
                if (suffix.length() > 0) suffix.append(' ');
                suffix.append(tokens[i]);
            }
            String canonicalSuffix = uniqueOfficialCanonicalCandidate(suffix.toString(), trustedCities);
            if (canonicalSuffix.isEmpty()
                || normalize(canonicalSuffix).equals(normalize(suffix.toString()))) continue;
            StringBuilder prefix = new StringBuilder();
            for (int i = 0; i < start; i++) {
                if (prefix.length() > 0) prefix.append(' ');
                prefix.append(tokens[i]);
            }
            return prefix + " " + canonicalSuffix;
        }
        return "";
    }

    /**
     * Canonicalizes a destination owned by a verified selected List row. This is the
     * only entry point allowed to apply the one-edit official exception (Itopetuna ->
     * Itapetuna); callers must already have row evidence and must not use this for Pause.
     */
    static String canonicalizeSelectedRowDestination(String visibleValue) {
        String visible = clean(visibleValue);
        if (visible.isEmpty()) return "";
        String complete = canonicalizeVisibleDestinationSuffix(visible, null);
        if (!complete.isEmpty()) return complete;
        String standalone = uniqueOfficialCanonicalCandidate(visible, null);
        if (!standalone.isEmpty() && !normalize(standalone).equals(normalize(visible))) return standalone;
        return "";
    }

    static boolean isSafeOneEditVariant(String first, String second) {
        String a = normalize(first);
        String b = normalize(second);
        if (a.equals(b)) return false;
        if (a.length() < 5 || b.length() < 5) return false;
        if (Math.abs(a.length() - b.length()) > 1) return false;
        if (a.charAt(0) != b.charAt(0) || a.charAt(a.length() - 1) != b.charAt(b.length() - 1)) {
            return false;
        }
        return editDistanceAtMostOne(a, b);
    }

    static String normalize(String value) {
        if (value == null) return "";
        return Normalizer.normalize(value.trim(), Normalizer.Form.NFD)
            .replaceAll("\\p{M}", "")
            .toLowerCase(Locale.ROOT)
            .replaceAll("[^\\p{L}\\p{N}]+", " ")
            .replaceAll("\\s+", " ")
            .trim();
    }

    private static boolean sameNormalized(String first, String second) {
        String a = normalize(first);
        String b = normalize(second);
        return !a.isEmpty() && a.equals(b);
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim().replaceAll("\\s+", " ");
    }

    private static int editDistance(String a, String b, int limit) {
        if (a.equals(b)) return 0;
        if (Math.abs(a.length() - b.length()) > limit) return -1;
        int[] previous = new int[b.length() + 1];
        int[] current = new int[b.length() + 1];
        for (int j = 0; j <= b.length(); j++) previous[j] = j;
        for (int i = 1; i <= a.length(); i++) {
            current[0] = i;
            int rowMin = current[0];
            for (int j = 1; j <= b.length(); j++) {
                int cost = a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1;
                current[j] = Math.min(
                    Math.min(previous[j] + 1, current[j - 1] + 1),
                    previous[j - 1] + cost
                );
                rowMin = Math.min(rowMin, current[j]);
            }
            if (rowMin > limit) return -1;
            int[] swap = previous; previous = current; current = swap;
        }
        return previous[b.length()] <= limit ? previous[b.length()] : -1;
    }

    private static boolean editDistanceAtMostOne(String a, String b) {
        if (a.equals(b)) return true;
        int lenA = a.length();
        int lenB = b.length();
        if (Math.abs(lenA - lenB) > 1) return false;

        if (lenA == lenB) {
            int mismatches = 0;
            for (int i = 0; i < lenA; i++) {
                if (a.charAt(i) != b.charAt(i) && ++mismatches > 1) return false;
            }
            return mismatches <= 1;
        }

        String shorter = lenA < lenB ? a : b;
        String longer = lenA < lenB ? b : a;
        int i = 0;
        int j = 0;
        int edits = 0;
        while (i < shorter.length() && j < longer.length()) {
            if (shorter.charAt(i) == longer.charAt(j)) {
                i++;
                j++;
            } else {
                if (++edits > 1) return false;
                j++;
            }
        }
        if (j < longer.length()) edits++;
        return edits <= 1;
    }
}
