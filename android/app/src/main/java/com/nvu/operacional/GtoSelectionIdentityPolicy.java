package com.nvu.operacional;

/** Guarantees that a known touch row can resolve only to that same row or to NONE. */
final class GtoSelectionIdentityPolicy {
    private GtoSelectionIdentityPolicy() {}

    static int resolveExactTouchAfterTransition(
        int touchedRow,
        int rowCount,
        boolean listDisappeared,
        int visualCandidateRow
    ) {
        if (rowCount <= 0 || touchedRow < 0 || touchedRow >= rowCount) return -1;
        boolean visualValid = visualCandidateRow >= 0 && visualCandidateRow < rowCount;
        if (visualValid && visualCandidateRow != touchedRow) return -1;
        if (visualValid && visualCandidateRow == touchedRow) return touchedRow;
        return listDisappeared ? touchedRow : -1;
    }

    static int resolveRow(int touchedRow, boolean touchCoordinateUsable, int visualCandidateRow, int rowCount) {
        if (rowCount <= 0) return -1;
        boolean visualValid = visualCandidateRow >= 0 && visualCandidateRow < rowCount;
        if (touchCoordinateUsable) {
            if (touchedRow < 0 || touchedRow >= rowCount) return -1;
            if (visualValid && visualCandidateRow != touchedRow) return -1;
            return touchedRow;
        }
        return visualValid ? visualCandidateRow : -1;
    }
}
