package com.nvu.operacional;

/**
 * Conservative cargo consensus policy shared by the selected-row and Pause flows.
 * Text candidates are normalized only for consensus comparison; the visible value
 * remains the literal value supplied by the authoritative source.
 */
final class GtoCargoConsensusPolicy {
    static final int REQUIRED_READS = 2;

    private GtoCargoConsensusPolicy() {}

    static boolean confirmed(int reads) {
        return reads >= REQUIRED_READS;
    }

    static boolean validCandidate(String candidate) {
        return GtoFreightReviewPolicy.isAutomaticTextUsable(candidate)
            && !normalize(candidate).isEmpty();
    }

    static boolean sameCandidate(String first, String second) {
        return GtoFreightTextGuard.sameLiteralText(first, second);
    }

    static String normalize(String value) {
        return value == null ? "" : value.trim().replaceAll("\\s+", " ");
    }

    static int nextReadCount(String previous, int previousReads, String candidate) {
        if (!validCandidate(candidate)) return 0;
        if (sameCandidate(previous, candidate)) {
            return Math.min(REQUIRED_READS, Math.max(0, previousReads) + 1);
        }
        return 1;
    }

    static boolean selectedRowDirectPromotionAllowed(boolean directSelectedRowEvidence, int reads) {
        return directSelectedRowEvidence || confirmed(reads);
    }

    static int boundedReads(int reads) {
        return Math.max(0, Math.min(reads, 99));
    }
}

