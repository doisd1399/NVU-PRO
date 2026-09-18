
package com.nvu.operacional;

/**
 * HF127: resolves required OCR fields only with two independent concordant reads.
 * The immutable selected-row snapshot and a focused retry are evidence sources, but
 * a single one of them cannot auto-confirm cargo, origin or destination.
 */
final class GtoFreightFieldConflictPolicy {
    static final class Resolution {
        final boolean resolved;
        final String value;
        final String source;

        Resolution(boolean resolved, String value, String source) {
            this.resolved = resolved;
            this.value = value == null ? "" : value.trim();
            this.source = source == null ? "" : source;
        }

        static Resolution unresolved() {
            return new Resolution(false, "", "UNRESOLVED");
        }
    }

    private GtoFreightFieldConflictPolicy() {}

    static boolean needsRetry(String field, String exact, String frozen) {
        if (!valid(field, exact) || !valid(field, frozen)) return false;
        return !same(field, exact, frozen);
    }

    /**
     * Resolves a selected-row field when the initial sources are absent and two
     * independent focused rereads agree. A single focused read remains unresolved.
     */
    static Resolution resolveWithFocusedReads(
        String field,
        String exact,
        String frozen,
        String focusedFirst,
        String focusedSecond
    ) {
        if (GtoFreightReviewPolicy.ORIGIN.equals(field)
            || GtoFreightReviewPolicy.ORIGIN_COMPANY.equals(field)) {
            exact = GtoListOriginTextPolicy.canonicalizeOcrLiteral(exact);
            frozen = GtoListOriginTextPolicy.canonicalizeOcrLiteral(frozen);
            focusedFirst = GtoListOriginTextPolicy.canonicalizeOcrLiteral(focusedFirst);
            focusedSecond = GtoListOriginTextPolicy.canonicalizeOcrLiteral(focusedSecond);
        }
        if (valid(field, focusedFirst) && valid(field, focusedSecond)
            && same(field, focusedFirst, focusedSecond)) {
            return new Resolution(true, focusedFirst, "TWO_FOCUSED_READS_AGREED");
        }
        return resolve(field, exact, frozen, focusedFirst);
    }

    static Resolution resolve(String field, String exact, String frozen, String retry) {
        if (GtoFreightReviewPolicy.ORIGIN.equals(field)
            || GtoFreightReviewPolicy.ORIGIN_COMPANY.equals(field)) {
            exact = GtoListOriginTextPolicy.canonicalizeOcrLiteral(exact);
            frozen = GtoListOriginTextPolicy.canonicalizeOcrLiteral(frozen);
            retry = GtoListOriginTextPolicy.canonicalizeOcrLiteral(retry);
        }
        boolean exactValid = valid(field, exact);
        boolean frozenValid = valid(field, frozen);
        boolean retryValid = valid(field, retry);

        // One source alone is review evidence only. It cannot be promoted to an
        // automatic confirmation without an independent second read.
        if (exactValid && !frozenValid) {
            return retryValid && same(field, retry, exact)
                ? new Resolution(true, exact, "FOCUSED_RETRY_CONFIRMED_SELECTED")
                : Resolution.unresolved();
        }
        if (!exactValid && frozenValid) {
            return retryValid && same(field, retry, frozen)
                ? new Resolution(true, frozen, "FOCUSED_RETRY_CONFIRMED_FROZEN")
                : Resolution.unresolved();
        }
        if (!exactValid && !frozenValid) {
            // A retry-only value is still a single OCR observation. Keep it in review.
            return Resolution.unresolved();
        }
        if (same(field, exact, frozen)) {
            return new Resolution(true, exact, "AGREED_INITIAL_READS");
        }

        // Initial reads conflict. Never choose either side without a focused retry.
        if (!retryValid) return Resolution.unresolved();
        if (same(field, retry, exact)) return new Resolution(true, exact, "FOCUSED_RETRY_CONFIRMED_SELECTED");
        if (same(field, retry, frozen)) return new Resolution(true, frozen, "FOCUSED_RETRY_CONFIRMED_FROZEN");
        return Resolution.unresolved();
    }

    private static boolean same(String field, String first, String second) {
        if (GtoFreightReviewPolicy.DISTANCE.equals(field)) {
            return GtoFreightTextGuard.sameNumericValue(first, second);
        }
        if (GtoFreightReviewPolicy.VALUE.equals(field)) {
            Long a = GtoMoneyValue.parseCents(first);
            Long b = GtoMoneyValue.parseCents(second);
            return a != null && b != null && a.longValue() == b.longValue();
        }
        return GtoFreightTextGuard.sameVisibleText(first, second);
    }

    private static boolean valid(String field, String value) {
        return GtoFreightReviewPolicy.isManualValueValid(field, value);
    }
}
