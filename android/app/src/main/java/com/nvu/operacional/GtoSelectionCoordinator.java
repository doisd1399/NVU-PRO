package com.nvu.operacional;

/**
 * Orders freight-list frames and user touch markers on the capture thread.
 *
 * The coordinator intentionally does not use wall-clock timestamps. A touch marker is
 * posted to the same Handler that processes ImageReader callbacks, so every frame already
 * queued before the touch is processed first and every subsequent frame receives a larger
 * monotonically increasing sequence number.
 */
final class GtoSelectionCoordinator {
    private long frameSequence = 0L;
    private long touchMarkerSequence = -1L;
    private boolean criticalWindow = false;

    synchronized long onFrameProcessed() {
        return ++frameSequence;
    }

    synchronized long markTouch() {
        touchMarkerSequence = frameSequence;
        criticalWindow = true;
        return touchMarkerSequence;
    }

    synchronized boolean isCriticalWindow() {
        return criticalWindow;
    }

    synchronized boolean isPostTouch(long sequence) {
        return criticalWindow && touchMarkerSequence >= 0L && sequence > touchMarkerSequence;
    }

    synchronized long touchMarkerSequence() {
        return touchMarkerSequence;
    }

    synchronized long currentFrameSequence() {
        return frameSequence;
    }

    synchronized void finishCriticalWindow() {
        criticalWindow = false;
        touchMarkerSequence = -1L;
    }

    synchronized void reset() {
        frameSequence = 0L;
        touchMarkerSequence = -1L;
        criticalWindow = false;
    }
}
