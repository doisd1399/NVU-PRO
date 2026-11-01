package com.nvu.operacional;

/** Geometry of the approved landscape receipt, independent from bubble position. */
final class NativeReceiptCardLayoutPolicy {
    private NativeReceiptCardLayoutPolicy() {}

    static int width(int screenWidth, int safeLeft, int safeRightInset, float density) {
        int available = Math.max(1, screenWidth - Math.max(0, safeLeft)
            - Math.max(0, safeRightInset));
        int preferred = Math.round(screenWidth * 0.436f);
        int minimum = Math.round(360 * density);
        int maximum = Math.round(440 * density);
        return Math.max(1, Math.min(available, Math.min(maximum, Math.max(minimum, preferred))));
    }

    static int x(int screenWidth, int safeLeft, int safeRightInset, int width) {
        int left = Math.max(0, safeLeft);
        int lastSafeX = Math.max(left, screenWidth - Math.max(0, safeRightInset) - width);
        // Keep the visual center of the screen even with an asymmetric cutout.
        // Move away from that center only when the card would enter an unsafe edge.
        return Math.max(left, Math.min(lastSafeX, Math.max(0, (screenWidth - width) / 2)));
    }

    /**
     * Where the card starts: at the top of the screen, centered (see {@link #x}), just under a display cutout when there
     * is one, plus a small breathing space. The space grows a little with the screen height (2.5%) and is kept between
     * 8 dp and 16 dp, so it adapts to phones and tablets. It no longer depends on the status bar, whose height (and the
     * game's own interface under it) changed the distance from one device to another.
     */
    static int y(int screenHeight, int cutoutTop, int safeBottomInset, int height, float density) {
        int top = Math.max(0, cutoutTop) + breathing(screenHeight, density);
        int max = Math.max(top, screenHeight - Math.max(0, safeBottomInset) - Math.max(0, height));
        return Math.min(max, top);
    }

    /** Breathing space above the card: 2.5% of the screen height, between 8 dp and 16 dp. */
    static int breathing(int screenHeight, float density) {
        int minimum = Math.round(8 * density), maximum = Math.round(16 * density);
        return Math.max(minimum, Math.min(maximum, Math.round(screenHeight * 0.025f)));
    }
}
