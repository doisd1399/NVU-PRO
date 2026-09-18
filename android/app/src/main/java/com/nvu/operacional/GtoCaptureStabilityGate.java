package com.nvu.operacional;

/**
 * Small, Android-free state machine that prevents screen analysis from consuming
 * frames while MediaProjection is starting, the GTO task is returning to the
 * foreground, or the captured display is changing geometry.
 *
 * The gate requires an active authorized capture session, stable geometry and a short
 * settling interval. Foreground/package/OCR evidence is deliberately excluded from this
 * transport gate: stale context must never reset a live detector. Actions remain guarded
 * separately by the screen/state reducer.
 */
final class GtoCaptureStabilityGate {
    static final String INACTIVE = "INACTIVE";
    static final String CAPTURE_STARTING = "CAPTURE_STARTING";
    static final String CAPTURE_WAITING_GTO_FOREGROUND = "CAPTURE_WAITING_GTO_FOREGROUND";
    static final String CAPTURE_WAITING_ORIENTATION = "CAPTURE_WAITING_ORIENTATION";
    static final String CAPTURE_WAITING_STABLE_FRAMES = "CAPTURE_WAITING_STABLE_FRAMES";
    static final String GTO_READY = "GTO_READY";
    static final String CAPTURE_RESIZE_FAILED = "CAPTURE_RESIZE_FAILED";

    static final int REQUIRED_STABLE_FRAMES = 3;
    static final long MIN_GEOMETRY_SETTLE_MS = 280L;

    static final class Snapshot {
        final long generation;
        final String phase;
        final boolean ready;
        final int expectedWidth;
        final int expectedHeight;
        final int stableFrames;
        final long startedAt;
        final boolean becameReady;
        final boolean becameUnready;

        Snapshot(
            long generation,
            String phase,
            boolean ready,
            int expectedWidth,
            int expectedHeight,
            int stableFrames,
            long startedAt,
            boolean becameReady,
            boolean becameUnready
        ) {
            this.generation = generation;
            this.phase = phase;
            this.ready = ready;
            this.expectedWidth = expectedWidth;
            this.expectedHeight = expectedHeight;
            this.stableFrames = stableFrames;
            this.startedAt = startedAt;
            this.becameReady = becameReady;
            this.becameUnready = becameUnready;
        }
    }

    private long generation = 0L;
    private String phase = INACTIVE;
    private boolean ready = false;
    private int expectedWidth = 0;
    private int expectedHeight = 0;
    private int stableWidth = 0;
    private int stableHeight = 0;
    private int stableFrames = 0;
    private long startedAt = 0L;

    synchronized Snapshot reset(String nextPhase, int width, int height, long now) {
        boolean wasReady = ready;
        generation++;
        phase = nextPhase == null || nextPhase.isEmpty() ? CAPTURE_STARTING : nextPhase;
        ready = false;
        expectedWidth = Math.max(0, width);
        expectedHeight = Math.max(0, height);
        stableWidth = 0;
        stableHeight = 0;
        stableFrames = 0;
        startedAt = Math.max(0L, now);
        return snapshot(false, wasReady);
    }

    synchronized Snapshot observeFrame(
        int width,
        int height,
        long now,
        boolean captureSessionActive
    ) {
        boolean wasReady = ready;

        if (!captureSessionActive) {
            ready = false;
            phase = INACTIVE;
            stableWidth = 0;
            stableHeight = 0;
            stableFrames = 0;
            return snapshot(false, wasReady);
        }

        if (width <= 0 || height <= 0
            || width != expectedWidth || height != expectedHeight) {
            ready = false;
            phase = CAPTURE_WAITING_ORIENTATION;
            stableWidth = 0;
            stableHeight = 0;
            stableFrames = 0;
            return snapshot(false, wasReady);
        }

        phase = CAPTURE_WAITING_STABLE_FRAMES;
        if (stableWidth != width || stableHeight != height) {
            stableWidth = width;
            stableHeight = height;
            stableFrames = 1;
        } else if (stableFrames < REQUIRED_STABLE_FRAMES) {
            stableFrames++;
        }

        boolean settledLongEnough = now >= startedAt
            && now - startedAt >= MIN_GEOMETRY_SETTLE_MS;
        ready = stableFrames >= REQUIRED_STABLE_FRAMES && settledLongEnough;
        if (ready) phase = GTO_READY;
        return snapshot(!wasReady && ready, wasReady && !ready);
    }

    synchronized Snapshot current() {
        return snapshot(false, false);
    }

    synchronized boolean isReady() {
        return ready;
    }

    synchronized long startedAt() {
        return startedAt;
    }

    private Snapshot snapshot(boolean becameReady, boolean becameUnready) {
        return new Snapshot(
            generation,
            phase,
            ready,
            expectedWidth,
            expectedHeight,
            stableFrames,
            startedAt,
            becameReady,
            becameUnready
        );
    }
}
