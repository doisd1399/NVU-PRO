package com.nvu.operacional;

import java.text.Normalizer;
import java.util.Locale;

/**
 * Canonical field mapping for the accepted-freight list.
 *
 * The accepted card and the Pause surface have different contracts. The card exposes
 * an operational route plus a regional suffix, so the accepted flow preserves the
 * complete visible destination. The Pause parser is the only path that intentionally
 * extracts the prefix before its final separator.
 */
final class GtoAcceptedFreightFieldPolicy {
    private GtoAcceptedFreightFieldPolicy() {}

    static String origin(String currentOrigin, String originCompany) {
        String current = clean(currentOrigin);
        return current.isEmpty() ? clean(originCompany) : current;
    }

    /**
     * Visible origin authority for the accepted-freight list. The list route marker is
     * stronger than a stale or OCR-corrupted operational field because it belongs to the
     * same selected row. Pause has a separate contract and must keep its own origin value.
     */
    static String acceptedVisibleOrigin(
        String acceptedListOrigin,
        String currentOrigin,
        String originCompany,
        boolean pauseMenuEvidence
    ) {
        return acceptedVisibleOrigin(
            acceptedListOrigin, currentOrigin, originCompany, pauseMenuEvidence, false
        );
    }

    /**
     * A complete, validated Pause reread is allowed to replace the visible operation
     * fields for the same selected freight. A Pause merely observed or restored from a
     * stale snapshot keeps the legacy accepted-list authority above.
     */
    static String acceptedVisibleOrigin(
        String acceptedListOrigin,
        String currentOrigin,
        String originCompany,
        boolean pauseMenuEvidence,
        boolean pauseCorrectionConfirmed
    ) {
        String current = clean(currentOrigin);
        if (pauseCorrectionConfirmed && !current.isEmpty()) return current;
        String accepted = clean(acceptedListOrigin);
        if (!accepted.isEmpty()) return accepted;
        if (pauseMenuEvidence) return current;
        String company = clean(originCompany);
        return company.isEmpty() ? current : company;
    }

    static String destination(String currentDestination, String destinationCompany) {
        return destination(currentDestination, destinationCompany, "");
    }

    /**
     * Accepted-list destination composition. A row may already contain the complete
     * visible route (for example "Matecom Itapetuna") while an older OCR pass still
     * carries a different destination-company token (for example "Motecom"). In that
     * case, never prepend the stale token a second time. The existing value is kept only
     * when there is literal same-row evidence or an exact official locality suffix; no
     * fuzzy correction is performed here.
     */
    static String destination(String currentDestination, String destinationCompany, String rawText) {
        String current = GtoDestinationTextAuthorityPolicy.canonicalizeListDestination(currentDestination);
        String company = GtoDestinationTextAuthorityPolicy.canonicalizeListCompany(destinationCompany);
        if (company.isEmpty() && !clean(rawText).isEmpty()) {
            company = recoverDestinationCompanyFromRawText(currentDestination, rawText);
        }
        company = GtoDestinationTextAuthorityPolicy.canonicalizeListCompany(company);
        if (current.isEmpty()) return company;
        if (company.isEmpty()) return current;

        String normalizedCurrent = normalize(current);
        String normalizedCompany = normalize(company);
        if (normalizedCurrent.equals(normalizedCompany)) {
            return current;
        }
        if (normalizedCurrent.startsWith(normalizedCompany + " ")) {
            String rawTail = exactRouteTailContainedInCurrent(rawText, current);
            if (!rawTail.isEmpty() && !normalizeVisible(rawTail).equals(normalizeVisible(current))) {
                return GtoDestinationTextAuthorityPolicy.canonicalizeListDestination(rawTail);
            }
            // A noisy OCR pass can prepend its own company token to a complete route
            // already containing the real same-row destination, producing values such as
            // "Motecom Matecom Itapetuna". Remove only that leading company token when the
            // remainder still has a non-empty company part plus an official locality.
            String duplicateCollapsed = collapseLeadingDestinationCompany(current, company);
            if (!duplicateCollapsed.isEmpty()) return duplicateCollapsed;
            // A complete destination may already carry the same company prefix. Keep it;
            // accepted-list reconstruction must never append the prefix twice.
            return current;
        }
        if (hasExactOfficialLocalitySuffix(current)
            || hasExactDestinationTailFromRawText(rawText, current)) {
            // The selected row already contains the complete visible destination while
            // destinationCompany is stale or comes from a second OCR pass. The row value
            // is authoritative; do not prepend a second company token.
            return current;
        }
        return company + " " + current;
    }

    /**
     * Returns the visible destination of an accepted-list freight. The persisted
     * accepted-list value is authoritative because a later Pause reread may replace
     * the internal operational destination with its own company/locality contract.
     */
    static String acceptedVisibleDestination(
        String acceptedListDestination,
        String currentDestination,
        String destinationCompany,
        String rawText
    ) {
        return acceptedVisibleDestination(
            acceptedListDestination, currentDestination, destinationCompany, rawText, ""
        );
    }

    /**
     * Backward-compatible recovery for snapshots that kept companyRoute but lost
     * destinationCompany as a separate JSON field.
     */
    static String acceptedVisibleDestination(
        String acceptedListDestination,
        String currentDestination,
        String destinationCompany,
        String rawText,
        String companyRoute
    ) {
        return acceptedVisibleDestination(
            acceptedListDestination, currentDestination, destinationCompany, rawText, companyRoute, ""
        );
    }

    /**
     * Extended accepted-list recovery. When the route marker is lost by OCR,
     * originCompany identifies the line boundary; only intervening lines before
     * the final locality can become destination-company text.
     */
    static String acceptedVisibleDestination(
        String acceptedListDestination,
        String currentDestination,
        String destinationCompany,
        String rawText,
        String companyRoute,
        String originCompany
    ) {
        return acceptedVisibleDestination(
            acceptedListDestination, currentDestination, destinationCompany, rawText,
            companyRoute, originCompany, false
        );
    }

    /**
     * A complete validated Pause reread controls the current operational destination.
     * The accepted-list destination remains stored separately for list semantics, but
     * it must not repaint a different current operation after a valid Pause correction.
     */
    static String acceptedVisibleDestination(
        String acceptedListDestination,
        String currentDestination,
        String destinationCompany,
        String rawText,
        String companyRoute,
        String originCompany,
        boolean pauseCorrectionConfirmed
    ) {
        String current = GtoDestinationTextAuthorityPolicy.canonicalizeListDestination(currentDestination);
        if (pauseCorrectionConfirmed && !current.isEmpty()) return current;
        String accepted = GtoDestinationTextAuthorityPolicy.canonicalizeListDestination(acceptedListDestination);
        String company = GtoDestinationTextAuthorityPolicy.canonicalizeListCompany(destinationCompany);
        if (company.isEmpty()) company = destinationCompanyFromRoute(companyRoute);
        if (company.isEmpty()) company = recoverDestinationCompanyFromRawText(
            currentDestination, rawText, originCompany
        );
        company = GtoDestinationTextAuthorityPolicy.canonicalizeListCompany(company);
        String reconstructed = destination(currentDestination, company, rawText);
        if (accepted.isEmpty()) return reconstructed;

        // A legacy snapshot may have stored only the final locality as the
        // accepted-list value. If reliable route/raw evidence reconstructs a
        // longer visible destination, the locality-only value is not authoritative.
        // A genuinely complete accepted-list value is preserved unchanged.
        if (!reconstructed.isEmpty()
            && sameVisibleText(accepted, currentDestination)
            && !sameVisibleText(accepted, reconstructed)) {
            return reconstructed;
        }
        return accepted;
    }

    private static String destinationCompanyFromRoute(String companyRoute) {
        String route = clean(companyRoute);
        if (route.isEmpty()) return "";
        int separator = routeSeparatorIndex(route);
        if (separator < 0 || separator + 1 >= route.length()) return "";
        return GtoDestinationTextAuthorityPolicy.canonicalizeListCompany(route.substring(separator + 1));
    }

    private static String exactRouteTailContainedInCurrent(String rawText, String currentDestination) {
        String raw = clean(rawText);
        String current = clean(currentDestination);
        if (raw.isEmpty() || current.isEmpty() || current.indexOf(' ') < 0) return "";
        String normalizedCurrent = normalizeVisible(current);
        String[] lines = raw.split("[\\r\\n|]+");
        for (String line : lines) {
            String cleanLine = clean(line);
            int separator = routeSeparatorIndex(cleanLine);
            if (separator < 0 || separator + 1 >= cleanLine.length()) continue;
            String tail = clean(cleanLine.substring(separator + 1));
            String normalizedTail = normalizeVisible(tail);
            if (normalizedTail.isEmpty()) continue;
            if (normalizedTail.equals(normalizedCurrent)
                || normalizedCurrent.endsWith(" " + normalizedTail)) return tail;
        }
        return "";
    }

    private static boolean hasExactDestinationTailFromRawText(String rawText, String currentDestination) {
        String raw = clean(rawText);
        String current = clean(currentDestination);
        if (raw.isEmpty() || current.isEmpty() || current.indexOf(' ') < 0) return false;
        String[] lines = raw.split("[\\r\\n|]+");
        String normalizedCurrent = normalizeVisible(current);
        for (String line : lines) {
            String cleanLine = clean(line);
            int separator = routeSeparatorIndex(cleanLine);
            if (separator < 0 || separator + 1 >= cleanLine.length()) continue;
            String tail = clean(cleanLine.substring(separator + 1));
            if (normalizeVisible(tail).equals(normalizedCurrent)) return true;
        }
        return false;
    }

    private static String collapseLeadingDestinationCompany(String current, String noisyCompany) {
        String visible = clean(current);
        String noisy = clean(noisyCompany);
        if (visible.isEmpty() || noisy.isEmpty()) return "";
        String[] visibleTokens = visible.split("\\s+");
        String[] noisyTokens = noisy.split("\\s+");
        if (visibleTokens.length <= noisyTokens.length + 1) return "";
        for (int i = 0; i < noisyTokens.length; i++) {
            if (!normalize(visibleTokens[i]).equals(normalize(noisyTokens[i]))) return "";
        }
        StringBuilder remainder = new StringBuilder();
        for (int i = noisyTokens.length; i < visibleTokens.length; i++) {
            if (remainder.length() > 0) remainder.append(' ');
            remainder.append(visibleTokens[i]);
        }
        String candidate = remainder.toString();
        return hasExactOfficialLocalitySuffix(candidate) ? candidate : "";
    }

    private static boolean hasExactOfficialLocalitySuffix(String currentDestination) {
        String current = clean(currentDestination);
        String[] tokens = current.split("\\s+");
        if (tokens.length < 2) return false;
        for (int start = 1; start < tokens.length; start++) {
            StringBuilder suffix = new StringBuilder();
            for (int i = start; i < tokens.length; i++) {
                if (suffix.length() > 0) suffix.append(' ');
                suffix.append(tokens[i]);
            }
            String candidate = GtoCityTextResolver.uniqueOfficialCanonicalCandidate(suffix.toString(), null);
            if (!candidate.isEmpty()
                && normalize(candidate).equals(normalize(suffix.toString()))) return true;
        }
        return false;
    }

    private static String recoverDestinationCompanyFromRawText(String currentDestination, String rawText) {
        return recoverDestinationCompanyFromRawText(currentDestination, rawText, "");
    }

    private static String recoverDestinationCompanyFromRawText(
        String currentDestination, String rawText, String originCompany
    ) {
        String target = clean(currentDestination);
        if (target.isEmpty()) return "";
        // joinCardText() uses " | " to retain card line boundaries in the
        // persisted OCR text; accept that delimiter as well as real newlines.
        String[] lines = rawText.split("[\\r\\n|]+");
        int targetIndex = -1;
        for (int i = 0; i < lines.length; i++) {
            if (normalizeVisible(lines[i]).equals(normalizeVisible(target))) targetIndex = i;
        }
        if (targetIndex <= 0) return "";

        int routeIndex = -1;
        int separator = -1;
        for (int i = 0; i < targetIndex; i++) {
            int candidate = routeSeparatorIndex(lines[i]);
            if (candidate >= 0) {
                routeIndex = i;
                separator = candidate;
            }
        }
        if (routeIndex < 0) {
            String origin = normalizeVisible(originCompany);
            if (origin.isEmpty()) return "";
            int originIndex = -1;
            for (int i = 0; i < targetIndex; i++) {
                if (normalizeVisible(lines[i]).equals(origin)) originIndex = i;
            }
            if (originIndex < 0 || targetIndex <= originIndex + 1) return "";
            StringBuilder noMarkerRecovery = new StringBuilder();
            for (int i = originIndex + 1; i < targetIndex; i++) {
                appendDestinationPart(noMarkerRecovery, lines[i], target);
            }
            return GtoDestinationTextAuthorityPolicy.canonicalizeListCompany(noMarkerRecovery.toString());
        }

        StringBuilder recovered = new StringBuilder();
        String routeRemainder = clean(lines[routeIndex].substring(separator + 1));
        appendDestinationPart(recovered, routeRemainder, target);
        for (int i = routeIndex + 1; i < targetIndex; i++) {
            appendDestinationPart(recovered, lines[i], target);
        }
        return GtoDestinationTextAuthorityPolicy.canonicalizeListCompany(recovered.toString());
    }

    private static void appendDestinationPart(StringBuilder out, String value, String target) {
        String part = clean(value);
        if (part.isEmpty() || normalizeVisible(part).equals(normalizeVisible(target))) return;
        String normalized = normalizeVisible(part);
        if (normalized.contains("aceitar") || part.matches(".*\\d.*") || normalized.equals("km")) return;
        if (out.length() > 0) out.append(' ');
        out.append(part);
    }

    private static int routeSeparatorIndex(String value) {
        if (value == null) return -1;
        int best = -1;
        for (char marker : new char[] {'>', '›', '→', '➜'}) {
            int index = value.indexOf(marker);
            if (index > best) best = index;
        }
        return best;
    }

    /**
     * Compares destinations using the accepted-list representation. The list may expose
     * the company and regional suffix in separate OCR lines, while a selected-row read may
     * already contain the combined value. Both forms must represent the same visible card.
     */
    static boolean sameVisibleDestination(
        String firstDestination, String firstCompany,
        String secondDestination, String secondCompany
    ) {
        return GtoDestinationTextAuthorityPolicy.sameAcceptedListDestination(
            firstDestination, firstCompany, secondDestination, secondCompany
        );
    }

    /** Same-row evidence keeps visible spelling literal except for the one closed OCR alias. */
    static boolean sameLiteralDestination(
        String firstDestination, String firstCompany,
        String secondDestination, String secondCompany
    ) {
        return GtoDestinationTextAuthorityPolicy.sameAcceptedListDestination(
            firstDestination, firstCompany, secondDestination, secondCompany
        );
    }

    private static boolean sameVisibleText(String first, String second) {
        return normalizeVisible(first).equals(normalizeVisible(second));
    }

    private static String normalizeVisible(String value) {
        String clean = clean(value);
        String folded = Normalizer.normalize(clean, Normalizer.Form.NFD)
            .replaceAll("\\p{M}+", "");
        return folded.toLowerCase(Locale.ROOT)
            .replaceAll("[^\\p{L}\\p{N}]+", " ")
            .trim()
            .replaceAll("\\s+", " ");
    }

    private static String clean(String value) {
        if (value == null) return "";
        return value.replaceAll("\\s+", " ").trim();
    }

    private static String normalize(String value) {
        return clean(value).toLowerCase(java.util.Locale.ROOT);
    }
}
