package com.nvu.operacional;

import java.util.List;

/**
 * Safe canonicalization for destinations after a real freight row has been selected.
 *
 * The dictionary is authoritative only when a visible OCR value maps to one unique
 * official/trusted destination. Conflicting selected-row observations remain unresolved.
 */
final class GtoKnownDestinationPolicy {
    static final class Resolution {
        final boolean resolved;
        final String value;
        final String source;

        Resolution(boolean resolved, String value, String source) {
            this.resolved = resolved;
            this.value = value == null ? "" : value.trim();
            this.source = source == null ? "" : source;
        }

        static Resolution none() { return new Resolution(false, "", ""); }
    }

    private GtoKnownDestinationPolicy() {}

    static Resolution resolveSelectedRow(String preciseValue, String frozenValue, List<String> trustedCities) {
        String precise = clean(preciseValue);
        String frozen = clean(frozenValue);

        String preciseCandidate = GtoCityTextResolver.uniqueOfficialCanonicalCandidate(precise, trustedCities);
        String frozenCandidate = GtoCityTextResolver.uniqueOfficialCanonicalCandidate(frozen, trustedCities);

        // Precise selected-row OCR is primary. If it is present but does not map safely to
        // the official universe, never let the older frozen baseline override it silently.
        if (!precise.isEmpty() && preciseCandidate.isEmpty()) return Resolution.none();

        if (!preciseCandidate.isEmpty()) {
            if (frozen.isEmpty()) {
                return new Resolution(true, preciseCandidate, "PRECISE_SELECTED_ROW_OFFICIAL_UNIQUE");
            }
            if (!frozenCandidate.isEmpty()
                && sameCanonical(preciseCandidate, frozenCandidate)) {
                return new Resolution(true, preciseCandidate, "PRECISE_AND_FROZEN_OFFICIAL_UNIQUE");
            }
            return Resolution.none();
        }

        if (precise.isEmpty() && !frozenCandidate.isEmpty()) {
            return new Resolution(true, frozenCandidate, "FROZEN_SELECTED_ROW_OFFICIAL_UNIQUE");
        }
        return Resolution.none();
    }

    static Resolution resolveRetry(String retryValue, String expectedCanonical, List<String> trustedCities) {
        String expected = clean(expectedCanonical);
        if (expected.isEmpty()) return Resolution.none();
        String retryCandidate = GtoCityTextResolver.uniqueOfficialCanonicalCandidate(retryValue, trustedCities);
        if (!retryCandidate.isEmpty() && sameCanonical(expected, retryCandidate)) {
            return new Resolution(true, expected, "FOCUSED_RETRY_OFFICIAL_UNIQUE");
        }
        return Resolution.none();
    }

    private static boolean sameCanonical(String a, String b) {
        return GtoCityTextResolver.normalize(a).equals(GtoCityTextResolver.normalize(b));
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim().replaceAll("\\s+", " ");
    }
}
