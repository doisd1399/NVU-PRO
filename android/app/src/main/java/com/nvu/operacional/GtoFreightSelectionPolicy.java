package com.nvu.operacional;

/**
 * Selection confirmation policy for GTO freight cards.
 *
 * The selected row is established by visual/touch geometry on the immutable pre-touch
 * freight page. The stabilized full-page OCR is the canonical source for the visible
 * freight text. A secondary row OCR is diagnostic only: missing/wrapped text must not
 * veto a canonical row that already has multi-read consensus. It may veto only when it
 * provides an explicit contradictory numeric identity (distance or offered value).
 */
final class GtoFreightSelectionPolicy {
    private GtoFreightSelectionPolicy() {}

    /**
     * Direct promotion is a narrow bypass for an already identified row. The
     * touch geometry identifies the row; no pressed-state, color change, frame
     * delta, or post-touch visual confirmation is required. All five operational
     * fields still have to be valid and no fallback/conflict condition may be active.
     */
    static boolean canCommitHumanBackedSelectedRow(
        int selectedRow,
        int candidateRow,
        boolean humanActionConfirmed,
        boolean acceptGeometryConfirmed,
        boolean completeAndValid,
        boolean pauseRecoveryEligible,
        boolean criticalConflict
    ) {
        // `acceptGeometryConfirmed` is retained as diagnostic metadata for callers,
        // but it is deliberately not a post-touch visual gate. The authoritative
        // geometry is the driver's touch-to-card mapping performed before this method.
        return selectedRow >= 0
            && selectedRow == candidateRow
            && humanActionConfirmed
            && completeAndValid
            && !pauseRecoveryEligible
            && !criticalConflict;
    }

    static boolean canCommitCanonicalRow(
        int selectedRow,
        int canonicalRow,
        boolean canonicalSafe,
        String secondaryKm,
        String secondaryValue,
        String canonicalKm,
        String canonicalValue
    ) {
        if (!canonicalSafe || selectedRow < 0 || selectedRow != canonicalRow) return false;
        if (numericConflict(secondaryKm, canonicalKm)) return false;
        if (moneyConflict(secondaryValue, canonicalValue)) return false;
        return true;
    }

    static boolean numericConflict(String first, String second) {
        String a = digits(first);
        String b = digits(second);
        return !a.isEmpty() && !b.isEmpty() && !a.equals(b);
    }

    /**
     * Money must be compared by value, not by flattened visible digits.
     * `R$ 5.300,00`, `R$ 5.300` and `R$ 5300` are the same freight value.
     * Flattening punctuation made the first form look like 530000 and caused the
     * selected-row OCR to veto an otherwise safe canonical row.
     *
     * The secondary OCR is diagnostic only, so an unreadable secondary amount must
     * never veto a stable canonical row. We reject only when both values parse and
     * they are truly different amounts.
     */
    static boolean moneyConflict(String first, String second) {
        Long a = GtoMoneyValue.parseCents(first);
        Long b = GtoMoneyValue.parseCents(second);
        return a != null && b != null && a.longValue() != b.longValue();
    }

    private static String digits(String value) {
        return value == null ? "" : value.replaceAll("[^0-9]", "");
    }
}
