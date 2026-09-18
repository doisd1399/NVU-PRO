package com.nvu.operacional;

/**
 * Same-session reconciliation policy for a validated Pause reread.
 *
 * A Pause may correct OCR fields of the currently selected freight, but it may
 * never replace a locked freight with another row or another numeric contract.
 * This policy is deliberately pure and does not read Android state.
 */
final class GtoPauseCorrectionPolicy {
    private GtoPauseCorrectionPolicy() {}

    static boolean sameSelectedFreightAnchors(
        int lockedRow,
        int candidateRow,
        String lockedCargo,
        String candidateCargo,
        String lockedDistance,
        String candidateDistance,
        String lockedValue,
        String candidateValue
    ) {
        return lockedRow >= 0
            && candidateRow >= 0
            && lockedRow == candidateRow
            && GtoFreightTextGuard.sameLiteralText(lockedCargo, candidateCargo)
            && GtoFreightTextGuard.sameNumericValue(lockedDistance, candidateDistance)
            && sameMoney(lockedValue, candidateValue);
    }

    private static boolean sameMoney(String first, String second) {
        Long a = GtoMoneyValue.parseCents(first == null ? "" : first.trim());
        Long b = GtoMoneyValue.parseCents(second == null ? "" : second.trim());
        return a != null && b != null && a.equals(b);
    }
}
