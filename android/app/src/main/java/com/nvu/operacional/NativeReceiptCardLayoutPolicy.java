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

    static int y(int screenHeight, int safeTop, int safeBottomInset, int height) {
        int top = Math.max(0, safeTop);
        int max = Math.max(top, screenHeight - Math.max(0, safeBottomInset) - Math.max(0, height));
        return Math.max(top, Math.min(max, Math.round(screenHeight * 0.076f)));
    }
}
