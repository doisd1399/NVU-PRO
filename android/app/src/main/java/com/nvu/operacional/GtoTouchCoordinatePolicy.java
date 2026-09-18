package com.nvu.operacional;

/**
 * Deterministic row resolution for a real human touch. Each input is already the
 * result of testing one coordinate representation against the current card bounds.
 * The policy never uses nearest-row distance and never lets a lower-confidence OEM
 * representation veto a higher-confidence one.
 */
public final class GtoTouchCoordinatePolicy {
    public static final String SOURCE_CAPTURE = "CAPTURE_SPACE";
    public static final String SOURCE_RAW = "RAW_SPACE";
    public static final String SOURCE_LOCAL = "LOCAL_SPACE";
    public static final String SOURCE_DISPLAY_TRANSFORM = "DISPLAY_TO_CAPTURE";

    private GtoTouchCoordinatePolicy() {}

    public static Resolution resolve(
        int captureRow,
        boolean captureReliable,
        int rawRow,
        boolean rawReliable,
        int localRow,
        boolean localReliable,
        int transformedRow,
        boolean transformedReliable
    ) {
        if (captureReliable && captureRow >= 0) {
            return accepted(captureRow, SOURCE_CAPTURE, 1.00f);
        }
        if (transformedReliable && transformedRow >= 0) {
            return accepted(transformedRow, SOURCE_DISPLAY_TRANSFORM, 0.95f);
        }
        if (rawReliable && rawRow >= 0) {
            return accepted(rawRow, SOURCE_RAW, 0.80f);
        }
        if (localReliable && localRow >= 0) {
            return accepted(localRow, SOURCE_LOCAL, 0.60f);
        }
        if ((captureReliable && captureRow < 0)
            || (rawReliable && rawRow < 0)
            || (localReliable && localRow < 0)
            || (transformedReliable && transformedRow < 0)) {
            return unresolved("ROW_NOT_FOUND");
        }
        return unresolved("TOUCH_COORDINATES_UNAVAILABLE");
    }

    private static Resolution accepted(int row, String source, float confidence) {
        return new Resolution(row, source, confidence, "");
    }

    private static Resolution unresolved(String reason) {
        return new Resolution(-1, "", 0f, reason);
    }

    public static final class Resolution {
        public final int row;
        public final String source;
        public final float confidence;
        public final String failureReason;

        private Resolution(int row, String source, float confidence, String failureReason) {
            this.row = row;
            this.source = source == null ? "" : source;
            this.confidence = confidence;
            this.failureReason = failureReason == null ? "" : failureReason;
        }

        public boolean isResolved() {
            return row >= 0 && !source.isEmpty();
        }
    }
}
