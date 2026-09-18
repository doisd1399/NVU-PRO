package com.nvu.operacional;

import android.graphics.Rect;
import android.media.Image;

import java.nio.ByteBuffer;

/**
 * Lightweight OCR-free prefilter for the fixed GTO completion dialog.
 *
 * This class is deliberately separate from GtoFastVisualDetector so the proven
 * freight-selection detector remains byte-for-byte unchanged. The gate only decides
 * whether result OCR should wake up; parseResultScreen() remains the authority for
 * accepting a completed delivery.
 */
final class GtoResultVisualGate {
    private interface PixelPredicate {
        boolean test(int rgb);
    }

    boolean looksLikeResultDialog(Image image, int width, int height) {
        Evidence evidence = measure(image, width, height);
        if (evidence == null) return false;
        // OCR remains the semantic authority. This permissive method is only the wake-up
        // gate, so partial/occluded result dialogs still receive semantic OCR.
        return GtoResultEvidencePolicy.isPlausibleResult(
            evidence.dialogNeutralDark, evidence.dialogRightNeutralDark,
            evidence.receiveNeutral, evidence.adsGold
        );
    }

    /**
     * Continuity check for an ALREADY semantically certified result dialog.
     * It is intentionally stricter than looksLikeResultDialog(): a dark gameplay scene
     * must never keep the observer stuck on "toque em Receber" after the modal vanished.
     */
    boolean looksLikeCertifiedResultStillVisible(Image image, int width, int height) {
        Evidence evidence = measure(image, width, height);
        if (evidence == null) return false;
        return GtoResultEvidencePolicy.isCertifiedResultStillVisible(
            evidence.dialogNeutralDark, evidence.dialogRightNeutralDark,
            evidence.receiveNeutral, evidence.adsGold
        );
    }

    /**
     * HF55 foreground-recovery signature. This is deliberately stricter than the
     * ordinary OCR wake-up gate because it may be evaluated while UsageStats still
     * reports the phone/another app after the driver has already returned to GTO.
     */
    boolean looksLikeStrongReturnResultDialog(Image image, int width, int height) {
        Evidence evidence = measure(image, width, height);
        if (evidence == null) return false;
        return GtoResultEvidencePolicy.isStrongReturnResult(
            evidence.dialogNeutralDark, evidence.dialogRightNeutralDark,
            evidence.receiveNeutral, evidence.adsGold
        );
    }

    private Evidence measure(Image image, int width, int height) {
        if (image == null || width <= 0 || height <= 0) return null;
        Image.Plane[] planes = image.getPlanes();
        if (planes == null || planes.length == 0) return null;
        Image.Plane plane = planes[0];
        ByteBuffer buffer = plane.getBuffer();
        int pixelStride = plane.getPixelStride();
        int rowStride = plane.getRowStride();
        if (buffer == null || pixelStride < 3 || rowStride <= 0) return null;

        Rect dialog = normalizedRect(width, height, 0.34f, 0.31f, 0.66f, 0.69f);
        Rect dialogRight = normalizedRect(width, height, 0.50f, 0.31f, 0.66f, 0.69f);
        Rect receive = normalizedRect(width, height, 0.39f, 0.53f, 0.50f, 0.66f);
        Rect ads = normalizedRect(width, height, 0.50f, 0.53f, 0.61f, 0.66f);

        float dialogNeutralDark = sampledRatio(
            buffer, pixelStride, rowStride, width, height, dialog, 12, 9, this::isNeutralDark
        );
        float dialogRightNeutralDark = sampledRatio(
            buffer, pixelStride, rowStride, width, height, dialogRight, 7, 9, this::isNeutralDark
        );
        float receiveNeutral = sampledRatio(
            buffer, pixelStride, rowStride, width, height, receive, 10, 6, this::isNeutralButton
        );
        float adsGold = sampledRatio(
            buffer, pixelStride, rowStride, width, height, ads, 10, 6, this::isResultGold
        );
        return new Evidence(dialogNeutralDark, dialogRightNeutralDark, receiveNeutral, adsGold);
    }

    private static final class Evidence {
        final float dialogNeutralDark;
        final float dialogRightNeutralDark;
        final float receiveNeutral;
        final float adsGold;
        Evidence(float dialogNeutralDark, float dialogRightNeutralDark, float receiveNeutral, float adsGold) {
            this.dialogNeutralDark = dialogNeutralDark;
            this.dialogRightNeutralDark = dialogRightNeutralDark;
            this.receiveNeutral = receiveNeutral;
            this.adsGold = adsGold;
        }
    }

    private Rect normalizedRect(int width, int height, float left, float top, float right, float bottom) {
        int l = clamp(Math.round(width * left), 0, Math.max(0, width - 2));
        int t = clamp(Math.round(height * top), 0, Math.max(0, height - 2));
        int r = clamp(Math.round(width * right), l + 1, width);
        int b = clamp(Math.round(height * bottom), t + 1, height);
        return new Rect(l, t, r, b);
    }

    private float sampledRatio(
        ByteBuffer buffer,
        int pixelStride,
        int rowStride,
        int width,
        int height,
        Rect rect,
        int cols,
        int rows,
        PixelPredicate predicate
    ) {
        if (rect == null || predicate == null || cols <= 0 || rows <= 0) return 0f;
        int hits = 0;
        int total = 0;
        int left = clamp(rect.left, 0, Math.max(0, width - 1));
        int top = clamp(rect.top, 0, Math.max(0, height - 1));
        int right = clamp(rect.right, left + 1, width);
        int bottom = clamp(rect.bottom, top + 1, height);
        for (int gy = 0; gy < rows; gy++) {
            int y = clamp(top + Math.round((gy + 0.5f) * (bottom - top) / rows), top, bottom - 1);
            for (int gx = 0; gx < cols; gx++) {
                int x = clamp(left + Math.round((gx + 0.5f) * (right - left) / cols), left, right - 1);
                total++;
                if (predicate.test(readRgb(buffer, pixelStride, rowStride, x, y))) hits++;
            }
        }
        return total <= 0 ? 0f : hits / (float) total;
    }

    private int readRgb(ByteBuffer buffer, int pixelStride, int rowStride, int x, int y) {
        int offset = y * rowStride + x * pixelStride;
        if (offset < 0 || offset + 2 >= buffer.limit()) return 0;
        int r = buffer.get(offset) & 0xff;
        int g = buffer.get(offset + 1) & 0xff;
        int b = buffer.get(offset + 2) & 0xff;
        return (r << 16) | (g << 8) | b;
    }

    private boolean isNeutralDark(int rgb) {
        int r = (rgb >> 16) & 0xff;
        int g = (rgb >> 8) & 0xff;
        int b = rgb & 0xff;
        int max = Math.max(r, Math.max(g, b));
        int min = Math.min(r, Math.min(g, b));
        return max <= 92 && max - min <= 24;
    }

    private boolean isNeutralButton(int rgb) {
        int r = (rgb >> 16) & 0xff;
        int g = (rgb >> 8) & 0xff;
        int b = rgb & 0xff;
        int max = Math.max(r, Math.max(g, b));
        int min = Math.min(r, Math.min(g, b));
        return max >= 32 && max <= 110 && max - min <= 22;
    }

    private boolean isResultGold(int rgb) {
        int r = (rgb >> 16) & 0xff;
        int g = (rgb >> 8) & 0xff;
        int b = rgb & 0xff;
        return r >= 90 && g >= 52 && g <= 180 && b <= 110
            && r >= g + 8 && g >= b + 12;
    }

    private int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }
}
