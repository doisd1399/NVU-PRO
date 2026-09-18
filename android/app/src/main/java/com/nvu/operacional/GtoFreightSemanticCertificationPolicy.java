package com.nvu.operacional;

/**
 * A visual orange/card candidate becomes a certified freight list only when at least one
 * detected row also carries a real monetary freight value. Geometry finds candidates;
 * semantics authorizes freight-list state/selection.
 */
final class GtoFreightSemanticCertificationPolicy {
    private GtoFreightSemanticCertificationPolicy() {}

    static boolean isCertifiedPage(int visualRowCount, int parsedRowCount, int sameRowMoneyAnchors) {
        if (visualRowCount < 1 || visualRowCount > 6) return false;
        if (parsedRowCount < 1 || parsedRowCount > 6) return false;
        // HF35: multi-row freight pages must repeat the semantic template. A single
        // accidental money-like OCR token can no longer certify an entire screen.
        int requiredAnchors = visualRowCount == 1 ? 1 : Math.min(2, visualRowCount);
        return sameRowMoneyAnchors >= requiredAnchors;
    }

    /**
     * OCR-only list candidacy used when the fast color/shape detector is unavailable.
     * It requires repeated rows with both numeric freight fields and contextual text;
     * it never authorizes a selected row or a lifecycle transition by itself.
     */
    static boolean isCertifiedTextOnlyPage(int parsedRowCount, int sameRowNumericTextAnchors) {
        if (parsedRowCount < 1 || parsedRowCount > 6) return false;
        int requiredAnchors = parsedRowCount == 1 ? 1 : Math.min(2, parsedRowCount);
        return sameRowNumericTextAnchors >= requiredAnchors;
    }

    static boolean isCertifiedLifecycleBoundaryPage(
        int visualRowCount,
        int parsedRowCount,
        int sameRowAcceptMoneyAnchors,
        int sameRowCompleteAnchors
    ) {
        // Destructive lifecycle transitions are stricter than passive list display.
        // At least one row must contain the complete repeated GTO freight signature:
        // Aceitar text + monetary value + distance on the same visually anchored row.
        return isCertifiedPage(visualRowCount, parsedRowCount, sameRowAcceptMoneyAnchors)
            && sameRowCompleteAnchors >= 1;
    }

    static boolean selectedRowCanCertify(
        boolean hasAcceptGeometry,
        boolean hasAcceptTextEvidence,
        String cargo,
        String origin,
        String destination,
        String distance,
        String value
    ) {
        if (!hasAcceptGeometry || !hasAcceptTextEvidence) return false;
        boolean money = GtoFreightReviewPolicy.isManualValueValid(GtoFreightReviewPolicy.VALUE, value);
        if (!money) return false;
        int contextual = 0;
        if (GtoFreightReviewPolicy.isAutomaticTextUsable(cargo)) contextual++;
        if (GtoFreightReviewPolicy.isAutomaticTextUsable(origin)) contextual++;
        if (GtoFreightReviewPolicy.isAutomaticTextUsable(destination)) contextual++;
        if (GtoFreightReviewPolicy.isManualValueValid(GtoFreightReviewPolicy.DISTANCE, distance)) contextual++;
        return contextual >= 1;
    }
    static boolean selectedRowCanCertify(
        boolean hasAcceptGeometry,
        String cargo,
        String origin,
        String destination,
        String distance,
        String value
    ) {
        return selectedRowCanCertify(
            hasAcceptGeometry, true, cargo, origin, destination, distance, value
        );
    }

    /**
     * A human touch correlated with the exact Accept geometry can certify the
     * selected row even if the pressed transition frame loses OCR of the word
     * Accept. The fields themselves are still checked by the caller/gate.
     */
    static boolean selectedRowCanCertifyAfterHumanTouch(
        boolean hasAcceptGeometry,
        String cargo,
        String origin,
        String destination,
        String distance,
        String value
    ) {
        if (!hasAcceptGeometry) return false;
        boolean money = GtoFreightReviewPolicy.isManualValueValid(GtoFreightReviewPolicy.VALUE, value);
        if (!money) return false;
        int contextual = 0;
        if (GtoFreightReviewPolicy.isAutomaticTextUsable(cargo)) contextual++;
        if (GtoFreightReviewPolicy.isAutomaticTextUsable(origin)) contextual++;
        if (GtoFreightReviewPolicy.isAutomaticTextUsable(destination)) contextual++;
        if (GtoFreightReviewPolicy.isManualValueValid(GtoFreightReviewPolicy.DISTANCE, distance)) contextual++;
        return contextual >= 1;
    }

}
