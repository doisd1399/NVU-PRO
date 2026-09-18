package com.nvu.operacional;

/** Fail-safe UX policy for removing the floating observer by an explicit drag gesture. */
final class GtoBubbleDismissPolicy {
    private GtoBubbleDismissPolicy() {}

    static boolean shouldShowRemoveTarget(
        boolean gtoForeground,
        boolean dragging,
        boolean gestureActive,
        boolean gestureStartedOutsideGto,
        boolean dragRemovalArmed
    ) {
        // The removal contract is identical inside and outside GTO: the first real drag
        // shows the target in either context. A drop is still destructive only when the
        // driver releases inside the visible target after all fail-safe checks pass.
        boolean eligibleOrigin = dragging;
        return gestureActive && dragging && eligibleOrigin;
    }

    static boolean shouldExpireGesture(
        boolean gestureActive,
        long now,
        long startedAt,
        long lastEventAt,
        long maxDurationMs,
        long idleTimeoutMs
    ) {
        if (!gestureActive) return false;
        if (now <= 0L || startedAt <= 0L || lastEventAt <= 0L) return true;
        if (now < startedAt || now < lastEventAt) return true;
        if (maxDurationMs > 0L && now - startedAt > maxDurationMs) return true;
        return idleTimeoutMs > 0L && now - lastEventAt > idleTimeoutMs;
    }

    static boolean canCommitStop(
        boolean gtoForeground,
        boolean gestureActive,
        boolean dragging,
        boolean gestureStartedOutsideGto,
        boolean dragRemovalArmed,
        boolean pointerMatches,
        boolean targetVisible,
        boolean targetHighlighted,
        boolean generationMatches,
        boolean geometryInside,
        long now,
        long startedAt,
        long lastMoveAt,
        long maxDurationMs,
        long releaseFreshnessMs
    ) {
        boolean eligibleOrigin = dragging;
        if (!eligibleOrigin || !gestureActive || !dragging) return false;
        if (!pointerMatches || !targetVisible || !targetHighlighted || !generationMatches || !geometryInside) return false;
        if (now <= 0L || startedAt <= 0L || lastMoveAt <= 0L) return false;
        if (now < startedAt || now < lastMoveAt) return false;
        if (maxDurationMs > 0L && now - startedAt > maxDurationMs) return false;
        return releaseFreshnessMs <= 0L || now - lastMoveAt <= releaseFreshnessMs;
    }

    static boolean isDropInside(
        int bubbleX,
        int bubbleY,
        int bubbleWidth,
        int bubbleHeight,
        int targetX,
        int targetY,
        int targetWidth,
        int targetHeight
    ) {
        if (bubbleWidth <= 0 || bubbleHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) return false;
        int cx = bubbleX + bubbleWidth / 2;
        int cy = bubbleY + bubbleHeight / 2;
        return cx >= targetX && cx <= targetX + targetWidth
            && cy >= targetY && cy <= targetY + targetHeight;
    }
}
