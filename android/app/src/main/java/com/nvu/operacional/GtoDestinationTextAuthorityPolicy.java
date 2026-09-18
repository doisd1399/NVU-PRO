
package com.nvu.operacional;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Single closed authority policy for the selected-list destination text.
 *
 * The simulator's known OCR alias is deliberately narrow: the whole token
 * "Motecom" is a forbidden OCR spelling of the destination company "Matecom".
 * This class does not use edit distance, fuzzy matching, a city dictionary, or
 * arbitrary spelling correction. Every other visible token remains literal.
 */
final class GtoDestinationTextAuthorityPolicy {
    private static final String OCR_ALIAS_MOTECOM = "motecom";
    private static final String CANONICAL_MATECOM = "Matecom";

    private GtoDestinationTextAuthorityPolicy() {}

    static String canonicalizeListCompany(String value) {
        return canonicalize(value, true);
    }

    static String canonicalizeListDestination(String value) {
        return canonicalize(value, true);
    }

    static String canonicalizeRoute(String value) {
        String route = clean(value);
        if (route.isEmpty()) return "";
        int separator = routeSeparatorIndex(route);
        if (separator < 0) return route;
        String origin = clean(route.substring(0, separator));
        String destinationCompany = canonicalizeListCompany(
            route.substring(separator + routeSeparatorLength(route, separator))
        );
        return origin + route.substring(separator, separator + routeSeparatorLength(route, separator))
            + destinationCompany;
    }

    static boolean containsForbiddenAlias(String value) {
        for (String token : tokens(value)) {
            if (OCR_ALIAS_MOTECOM.equals(normalizeToken(token))) return true;
        }
        return false;
    }

    static boolean isLocalityOnly(String value) {
        String clean = clean(value);
        if (clean.isEmpty() || clean.indexOf(' ') >= 0) return false;
        return !GtoCityTextResolver.uniqueOfficialCanonicalCandidate(clean, null).isEmpty();
    }

    static boolean sameAcceptedListDestination(
        String firstDestination, String firstCompany,
        String secondDestination, String secondCompany
    ) {
        String first = canonicalizeListDestination(
            GtoAcceptedFreightFieldPolicy.destination(firstDestination, firstCompany)
        );
        String second = canonicalizeListDestination(
            GtoAcceptedFreightFieldPolicy.destination(secondDestination, secondCompany)
        );
        if (sameLiteral(first, second)) return true;
        // A wrapped selected-row route may be represented once as the complete
        // company/locality and once as locality-only. This is not spelling repair;
        // it is the existing List row-shape equivalence.
        return isLocalityOnly(first) && endsWithWord(second, first)
            || isLocalityOnly(second) && endsWithWord(first, second);
    }

    private static String canonicalize(String value, boolean collapseAdjacentCanonicalCompany) {
        List<String> source = tokens(value);
        if (source.isEmpty()) return "";
        List<String> output = new ArrayList<>();
        for (String token : source) {
            String next = OCR_ALIAS_MOTECOM.equals(normalizeToken(token))
                ? CANONICAL_MATECOM : token;
            if (collapseAdjacentCanonicalCompany
                && !output.isEmpty()
                && CANONICAL_MATECOM.equals(next)
                && CANONICAL_MATECOM.equals(output.get(output.size() - 1))) {
                continue;
            }
            output.add(next);
        }
        StringBuilder result = new StringBuilder();
        for (String token : output) {
            if (result.length() > 0) result.append(' ');
            result.append(token);
        }
        return result.toString();
    }

    private static List<String> tokens(String value) {
        List<String> result = new ArrayList<>();
        String clean = clean(value);
        if (clean.isEmpty()) return result;
        for (String token : clean.split("\\s+")) {
            if (!token.isEmpty()) result.add(token);
        }
        return result;
    }

    private static String normalizeToken(String value) {
        String clean = clean(value);
        if (clean.isEmpty()) return "";
        return Normalizer.normalize(clean, Normalizer.Form.NFD)
            .replaceAll("\\p{M}", "")
            .toLowerCase(Locale.ROOT)
            .replaceAll("[^\\p{L}\\p{N}]", "");
    }

    private static boolean sameLiteral(String first, String second) {
        return clean(first).equals(clean(second));
    }

    private static boolean endsWithWord(String value, String suffix) {
        String cleanValue = clean(value);
        String cleanSuffix = clean(suffix);
        return !cleanValue.isEmpty() && !cleanSuffix.isEmpty()
            && (cleanValue.equals(cleanSuffix)
                || cleanValue.endsWith(" " + cleanSuffix));
    }

    private static int routeSeparatorIndex(String value) {
        int best = -1;
        for (char marker : new char[] {'>', '›', '→', '➜'}) {
            int index = value.indexOf(marker);
            if (index > best) best = index;
        }
        return best;
    }

    private static int routeSeparatorLength(String value, int index) {
        if (index < 0 || index >= value.length()) return 1;
        if (index + 1 < value.length() && value.charAt(index) == '-' && value.charAt(index + 1) == '>') return 2;
        return 1;
    }

    private static String clean(String value) {
        return value == null ? "" : value.replaceAll("\\s+", " ").trim();
    }
}
