package com.nvu.operacional;

/**
 * Deterministic layout rules for the NVU floating bubble and its card.
 *
 * HF20 UX rule: the bubble is the visual anchor. When the card opens it should sit
 * immediately beside the bubble on the side that requires the least automatic movement
 * while remaining inside the safe horizontal area. If both arrangements are possible
 * without moving the bubble, the side with the most free room wins.
 */
final class GtoOverlayLayoutPolicy {
    static final int SIDE_LEFT = -1;
    static final int SIDE_RIGHT = 1;
    static final long STARTUP_REFERENCE_HOLD_MS = 10_000L;

    private GtoOverlayLayoutPolicy() {}

    /**
     * The reference anchor is intentionally visible during startup. A saved user position
     * may be restored only after the complete startup hold has elapsed.
     */
    static boolean shouldRestoreSavedPositionAfterStartup(
        long now,
        long startupAt,
        boolean hasExplicitUserPosition
    ) {
        return hasExplicitUserPosition
            && now > 0L
            && startupAt > 0L
            && now - startupAt >= STARTUP_REFERENCE_HOLD_MS;
    }

    static boolean overlaps(
        int ax, int ay, int aw, int ah,
        int bx, int by, int bw, int bh
    ) {
        if (aw <= 0 || ah <= 0 || bw <= 0 || bh <= 0) return false;
        return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
    }

    static int chooseBubbleSide(
        int menuLeft,
        int menuRight,
        int safeLeft,
        int safeRight,
        int bubbleWidth,
        int gap
    ) {
        int leftSpace = Math.max(0, menuLeft - safeLeft - gap);
        int rightSpace = Math.max(0, safeRight - menuRight - gap);
        boolean leftFits = leftSpace >= bubbleWidth;
        boolean rightFits = rightSpace >= bubbleWidth;

        if (leftFits && rightFits) {
            return rightSpace >= leftSpace ? SIDE_RIGHT : SIDE_LEFT;
        }
        if (rightFits) return SIDE_RIGHT;
        if (leftFits) return SIDE_LEFT;
        return rightSpace >= leftSpace ? SIDE_RIGHT : SIDE_LEFT;
    }

    static int bubbleX(
        int side,
        int menuLeft,
        int menuRight,
        int safeLeft,
        int safeRight,
        int bubbleWidth,
        int gap
    ) {
        int target = side == SIDE_LEFT
            ? menuLeft - gap - bubbleWidth
            : menuRight + gap;
        int maxX = Math.max(safeLeft, safeRight - bubbleWidth);
        return clamp(target, safeLeft, maxX);
    }

    static boolean horizontalPairFits(
        int safeLeft,
        int safeRight,
        int bubbleWidth,
        int menuWidth,
        int gap
    ) {
        return Math.max(0, safeRight - safeLeft) >= Math.max(0, bubbleWidth) + Math.max(0, menuWidth) + Math.max(0, gap);
    }

    /**
     * Chooses the card side relative to the bubble. The preferred side is the one that
     * requires the least automatic movement of the bubble to fit the complete pair.
     */
    static int chooseMenuSideForBubble(
        int bubbleX,
        int bubbleWidth,
        int menuWidth,
        int safeLeft,
        int safeRight,
        int gap
    ) {
        int bubbleLeft = bubbleX;
        int bubbleRight = bubbleX + Math.max(0, bubbleWidth);
        int leftSpace = Math.max(0, bubbleLeft - safeLeft - gap);
        int rightSpace = Math.max(0, safeRight - bubbleRight - gap);
        boolean leftFitsNow = leftSpace >= menuWidth;
        boolean rightFitsNow = rightSpace >= menuWidth;

        if (leftFitsNow && rightFitsNow) {
            return rightSpace >= leftSpace ? SIDE_RIGHT : SIDE_LEFT;
        }
        if (rightFitsNow) return SIDE_RIGHT;
        if (leftFitsNow) return SIDE_LEFT;

        if (!horizontalPairFits(safeLeft, safeRight, bubbleWidth, menuWidth, gap)) {
            return rightSpace >= leftSpace ? SIDE_RIGHT : SIDE_LEFT;
        }

        int leftBubble = bubbleXForMenuSide(
            SIDE_LEFT, bubbleX, bubbleWidth, menuWidth, safeLeft, safeRight, gap
        );
        int rightBubble = bubbleXForMenuSide(
            SIDE_RIGHT, bubbleX, bubbleWidth, menuWidth, safeLeft, safeRight, gap
        );
        int leftMove = Math.abs(leftBubble - bubbleX);
        int rightMove = Math.abs(rightBubble - bubbleX);
        if (leftMove == rightMove) return rightSpace >= leftSpace ? SIDE_RIGHT : SIDE_LEFT;
        return rightMove < leftMove ? SIDE_RIGHT : SIDE_LEFT;
    }

    /**
     * Returns the minimally shifted bubble X needed to make room for a card on the chosen
     * side. If the full pair cannot fit, the bubble is only clamped to the safe area.
     */
    static int bubbleXForMenuSide(
        int side,
        int currentBubbleX,
        int bubbleWidth,
        int menuWidth,
        int safeLeft,
        int safeRight,
        int gap
    ) {
        int maxBubbleX = Math.max(safeLeft, safeRight - Math.max(0, bubbleWidth));
        if (!horizontalPairFits(safeLeft, safeRight, bubbleWidth, menuWidth, gap)) {
            return clamp(currentBubbleX, safeLeft, maxBubbleX);
        }
        if (side == SIDE_LEFT) {
            int minBubbleX = safeLeft + Math.max(0, menuWidth) + Math.max(0, gap);
            return clamp(currentBubbleX, minBubbleX, maxBubbleX);
        }
        int maxForRightCard = safeRight - Math.max(0, menuWidth) - Math.max(0, gap) - Math.max(0, bubbleWidth);
        return clamp(currentBubbleX, safeLeft, Math.max(safeLeft, maxForRightCard));
    }

    static int menuXBesideBubble(
        int side,
        int bubbleX,
        int bubbleWidth,
        int menuWidth,
        int safeLeft,
        int safeRight,
        int gap
    ) {
        int target = side == SIDE_LEFT
            ? bubbleX - Math.max(0, gap) - Math.max(0, menuWidth)
            : bubbleX + Math.max(0, bubbleWidth) + Math.max(0, gap);
        int maxMenuX = Math.max(safeLeft, safeRight - Math.max(0, menuWidth));
        return clamp(target, safeLeft, maxMenuX);
    }

    /**
     * Returns the exact horizontal width available for a card on one side of the
     * bubble. The result already reserves the requested gap and never includes
     * pixels occupied by the bubble.
     */
    static int availableMenuWidthForBubbleSide(
        int side,
        int bubbleX,
        int bubbleWidth,
        int safeLeft,
        int safeRight,
        int gap
    ) {
        int available = side == SIDE_LEFT
            ? bubbleX - safeLeft - Math.max(0, gap)
            : safeRight - (bubbleX + Math.max(0, bubbleWidth)) - Math.max(0, gap);
        return Math.max(0, available);
    }

    static int centeredMenuYBesideBubble(
        int bubbleY,
        int bubbleHeight,
        int menuHeight,
        int safeTop,
        int safeBottom
    ) {
        int preferred = bubbleY + Math.max(0, bubbleHeight) / 2 - Math.max(0, menuHeight) / 2;
        return clampMenuY(preferred, menuHeight, safeTop, safeBottom);
    }

    static int clampMenuY(int preferredY, int menuHeight, int safeTop, int safeBottom) {
        int top = Math.max(0, safeTop);
        int bottom = Math.max(top, safeBottom);
        int height = Math.max(0, menuHeight);
        int maxY = Math.max(top, bottom - height);
        return clamp(preferredY, top, maxY);
    }


    // HF56: persist a preferred GTO location as a normalized value inside the current
    // safe drag span. Pixel coordinates are still written for backwards diagnostics, but
    // the normalized anchor survives resolution/inset changes without importing portrait
    // coordinates into the landscape simulator.
    static int normalizedPosition(int position, int min, int max, int scale) {
        int safeScale = Math.max(1, scale);
        if (max <= min) return 0;
        int clamped = clamp(position, min, max);
        return clamp(Math.round((clamped - min) * safeScale / (float) (max - min)), 0, safeScale);
    }

    static int positionFromNormalized(int normalized, int min, int max, int scale) {
        int safeScale = Math.max(1, scale);
        if (max <= min) return min;
        int n = clamp(normalized, 0, safeScale);
        return clamp(min + Math.round((max - min) * n / (float) safeScale), min, max);
    }

    /**
     * HF186 reference anchor: the NVU control is born just to the right of the minimap,
     * around 28.5% of the full landscape width, rather than at the geometric centre of
     * the whole safe span. The result is still clamped to the active safe range.
     */
    static int referenceTopX(int displayWidth, int bubbleWidth, int safeLeft, int maxX) {
        if (maxX <= safeLeft) return safeLeft;
        int desiredLeft = Math.round(Math.max(0, displayWidth) * 0.285f)
            - Math.max(0, bubbleWidth) / 2;
        return clamp(desiredLeft, safeLeft, maxX);
    }

    /**
     * HF186 reference anchor: leave the top HUD readable and place the control below it.
     * The offset scales with the landscape display while remaining inside the safe range.
     */
    static int referenceTopY(int displayHeight, int safeTop, int maxY) {
        if (maxY <= safeTop) return safeTop;
        int desired = safeTop + Math.round(Math.max(0, displayHeight) * 0.06f);
        return clamp(desired, safeTop, maxY);
    }

    static boolean isInsideSafeRange(int value, int min, int max) {
        return value >= min && value <= max;
    }

    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }
}
