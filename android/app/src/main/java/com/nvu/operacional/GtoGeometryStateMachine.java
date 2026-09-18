package com.nvu.operacional;

/**
 * Geometry-only state. Orientation is not a transport condition; geometry is used
 * only to bind coordinates and screen actions to the current capture generation.
 */
final class GtoGeometryStateMachine {
    static final String UNKNOWN = "UNKNOWN";
    static final String VALID = "VALID";
    static final String CHANGED = "CHANGED";
    static final String INVALID = "INVALID";

    static final class Snapshot {
        final long generation;
        final String state;
        final int width;
        final int height;
        final boolean valid;
        final long changedAt;

        Snapshot(long generation, String state, int width, int height, boolean valid, long changedAt) {
            this.generation = generation;
            this.state = state;
            this.width = width;
            this.height = height;
            this.valid = valid;
            this.changedAt = changedAt;
        }
    }

    private long generation = -1L;
    private int width = 0;
    private int height = 0;
    private String state = UNKNOWN;
    private long changedAt = 0L;

    synchronized Snapshot observe(long observedGeneration, int observedWidth, int observedHeight, long now) {
        boolean valid = observedWidth > 0 && observedHeight > 0;
        boolean changed = generation != observedGeneration
            || width != observedWidth
            || height != observedHeight;
        if (changed) {
            generation = observedGeneration;
            width = observedWidth;
            height = observedHeight;
            changedAt = Math.max(0L, now);
        }
        state = !valid ? INVALID : (changed && width > 0 && height > 0 ? CHANGED : VALID);
        return new Snapshot(generation, state, width, height, valid, changedAt);
    }

    synchronized Snapshot current() {
        return new Snapshot(generation, state, width, height,
            width > 0 && height > 0, changedAt);
    }
}
