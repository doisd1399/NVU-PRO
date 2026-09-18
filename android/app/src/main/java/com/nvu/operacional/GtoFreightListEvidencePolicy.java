package com.nvu.operacional;

/**
 * Aggregates freight-list evidence without making one visual signal authoritative.
 * Geometry remains mandatory, while one weak/occluded row is tolerated on multi-row pages.
 */
final class GtoFreightListEvidencePolicy {
    private GtoFreightListEvidencePolicy() {}

    static boolean isPlausibleSimpleList(
        int rowCount,
        boolean geometryValid,
        int acceptAndInfoAnchorRows
    ) {
        // HF35: a visual list is a repeated GTO card template, not merely one orange
        // rectangle beside dark/green pixels. One-row pages remain supported, but any
        // multi-row page must contain at least two independent strong row anchors.
        // This prevents HUB/HUD widgets from becoming a freight-list lifecycle boundary.
        if (!geometryValid || rowCount < 1 || rowCount > 6) return false;
        int requiredAnchors = rowCount == 1 ? 1 : Math.min(2, rowCount);
        return acceptAndInfoAnchorRows >= requiredAnchors;
    }

    static boolean isPlausibleList(
        int rowCount,
        boolean geometryValid,
        int orangeRows,
        int cardContextRows,
        float averageOrange
    ) {
        if (!geometryValid || rowCount < 1 || rowCount > 6) return false;
        int safeOrangeRows = Math.max(0, Math.min(rowCount, orangeRows));
        int safeCardRows = Math.max(0, Math.min(rowCount, cardContextRows));

        if (rowCount == 1) {
            return safeOrangeRows == 1 && safeCardRows == 1 && averageOrange >= 0.11f;
        }

        // A notification, simulator rendering defect or pressed-state frame may weaken
        // one row. The page is still trustworthy when the repeated vertical geometry is
        // intact and the remaining rows jointly carry button + card-context evidence.
        int requiredOrangeRows = Math.max(1, rowCount - 1);
        int requiredCardRows = Math.max(1, (int) Math.ceil(rowCount * 0.50d));
        boolean repeatedEvidence = safeOrangeRows >= requiredOrangeRows
            && safeCardRows >= requiredCardRows;
        boolean averageButtonEvidence = averageOrange >= 0.10f;
        return repeatedEvidence && averageButtonEvidence;
    }
}
