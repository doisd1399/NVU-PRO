package com.nvu.operacional;

import android.media.Image;

import java.nio.ByteBuffer;

public final class GtoResultVisualGateScreenMatrixTest {
    public static void main(String[] args) {
        int[][] screens = new int[][] {
            {854, 480},
            {1280, 720},
            {1536, 691},
            {1600, 900},
            {1920, 1080},
            {2400, 1080}
        };
        GtoResultVisualGate gate = new GtoResultVisualGate();
        for (int[] screen : screens) {
            FakeImage result = resultDialog(screen[0], screen[1]);
            require(gate.looksLikeResultDialog(result, screen[0], screen[1]),
                "result dialog must wake OCR at " + screen[0] + "x" + screen[1]);

            FakeImage gameplay = solid(screen[0], screen[1], 110, 145, 170);
            require(!gate.looksLikeResultDialog(gameplay, screen[0], screen[1]),
                "ordinary gameplay color must not match at " + screen[0] + "x" + screen[1]);
        }
        System.out.println("GtoResultVisualGateScreenMatrixTest: PASS");
    }

    private static FakeImage resultDialog(int width, int height) {
        FakeImage image = solid(width, height, 115, 145, 165);
        paint(image, width, height, 0.34f, 0.31f, 0.66f, 0.69f, 55, 57, 60);
        paint(image, width, height, 0.39f, 0.53f, 0.50f, 0.66f, 70, 72, 74);
        paint(image, width, height, 0.50f, 0.53f, 0.61f, 0.66f, 180, 112, 42);
        return image;
    }

    private static FakeImage solid(int width, int height, int r, int g, int b) {
        byte[] pixels = new byte[width * height * 4];
        for (int i = 0; i < pixels.length; i += 4) {
            pixels[i] = (byte) r;
            pixels[i + 1] = (byte) g;
            pixels[i + 2] = (byte) b;
            pixels[i + 3] = (byte) 255;
        }
        return new FakeImage(width, height, pixels);
    }

    private static void paint(
        FakeImage image,
        int width,
        int height,
        float left,
        float top,
        float right,
        float bottom,
        int r,
        int g,
        int b
    ) {
        int l = Math.max(0, Math.round(width * left));
        int t = Math.max(0, Math.round(height * top));
        int rr = Math.min(width, Math.round(width * right));
        int bb = Math.min(height, Math.round(height * bottom));
        for (int y = t; y < bb; y++) {
            for (int x = l; x < rr; x++) {
                int offset = (y * width + x) * 4;
                image.pixels[offset] = (byte) r;
                image.pixels[offset + 1] = (byte) g;
                image.pixels[offset + 2] = (byte) b;
            }
        }
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    private static final class FakeImage extends Image {
        final byte[] pixels;
        final Plane[] planes;

        FakeImage(int width, int height, byte[] pixels) {
            this.pixels = pixels;
            this.planes = new Plane[] { new FakePlane(pixels, width * 4) };
        }

        @Override
        public Plane[] getPlanes() {
            return planes;
        }

        @Override
        public long getTimestamp() {
            return 1L;
        }
    }

    private static final class FakePlane extends Image.Plane {
        final ByteBuffer buffer;
        final int rowStride;

        FakePlane(byte[] pixels, int rowStride) {
            this.buffer = ByteBuffer.wrap(pixels);
            this.rowStride = rowStride;
        }

        @Override
        public ByteBuffer getBuffer() {
            return buffer;
        }

        @Override
        public int getPixelStride() {
            return 4;
        }

        @Override
        public int getRowStride() {
            return rowStride;
        }
    }
}
