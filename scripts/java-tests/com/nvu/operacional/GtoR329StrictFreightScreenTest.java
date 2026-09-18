package com.nvu.operacional;

import android.graphics.Rect;
import android.media.Image;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.File;
import java.nio.ByteBuffer;
import javax.imageio.ImageIO;

/** Real-pixel regression: only the actual GTO jobs list may become FREIGHT_LIST. */
public final class GtoR329StrictFreightScreenTest {
    private static void require(boolean c, String m) { if (!c) throw new AssertionError(m); }

    public static void main(String[] args) throws Exception {
        String[] neutral = {
            "scripts/fixtures/r329-gameplay-timeout.png",
            "scripts/fixtures/r329-route-menu.png",
            "scripts/fixtures/r329-gameplay-false-2.png",
            "scripts/fixtures/r329-gameplay-false-1.png",
            "scripts/fixtures/r329-gameplay-stale-1.png",
            "scripts/fixtures/r329-gameplay-stale-2.png",
            "scripts/fixtures/r331-trip-phantom-list.png",
            "scripts/fixtures/r331-post-trip-screen.png",
            "scripts/fixtures/hf26-negative-gameplay-1.png",
            "scripts/fixtures/hf26-negative-gameplay-2.png",
            "scripts/fixtures/hf26-negative-gameplay-3.png",
            "scripts/fixtures/hf26-negative-gameplay-4.png",
            "scripts/fixtures/hf26-negative-gameplay-5.png",
            "scripts/fixtures/hf29-user-loading-after-consent.png",
            "scripts/fixtures/gto-hf30/01-star-games-loading.png",
            "scripts/fixtures/gto-hf30/02-notification-shade.png",
            "scripts/fixtures/gto-hf30/03-black-loading-fps0.png",
            "scripts/fixtures/gto-hf30/04-garage-auth-stale.png"
        };
        GtoFastVisualDetector detector = new GtoFastVisualDetector();
        long ts = 1L;
        for (String path : neutral) {
            BufferedImage image = ImageIO.read(new File(path));
            require(image != null, path + " must load");
            GtoFastVisualDetector.Frame frame = analyze(detector, image, ts++);
            require(!frame.hasFreightList(), path + " must remain neutral, got " + frame.buttons.size() + " orange candidates");
        }

        BufferedImage list = ImageIO.read(new File("scripts/fixtures/r329-real-freight-list.png"));
        require(list != null, "real list must load");
        GtoFastVisualDetector.Frame baseline = analyze(detector, list, ts++);
        require(baseline.hasFreightList(), "actual GTO freight list must be recognized");
        require(baseline.buttons.size() == 5, "actual list must report 5 freights");

        BufferedImage hf29List = ImageIO.read(new File("scripts/fixtures/hf29-user-real-freight-list-not-detected.png"));
        require(hf29List != null, "HF29 user freight list must load");
        GtoFastVisualDetector.Frame hf29Frame = analyze(detector, hf29List, ts++);
        require(hf29Frame.hasFreightList(), "HF29 physical freight list must be recognized");
        require(hf29Frame.buttons.size() == 5, "HF29 physical freight list must report 5 freights");

        // Selection must still resolve every visible row after the stricter list gate.
        for (int row = 0; row < baseline.buttons.size(); row++) {
            BufferedImage pressed = copy(list);
            Rect button = baseline.buttons.get(row);
            for (int y = Math.max(0, button.top - 2); y < Math.min(pressed.getHeight(), button.bottom + 2); y++) {
                for (int x = Math.max(0, button.left - 3); x < Math.min(pressed.getWidth(), button.right + 3); x++) {
                    pressed.setRGB(x, y, 0xFF3A3A3A);
                }
            }
            GtoFastVisualDetector.Frame current = analyze(detector, pressed, ts++);
            GtoFastVisualDetector.PressCandidate candidate = detector.detectPressedRowAfterTouch(baseline, current, list.getHeight());
            if (candidate == null) candidate = detector.detectTemporarilyMissingPressedRow(baseline, current, list.getHeight());
            require(candidate != null && candidate.row == row, "pressed freight row " + (row + 1) + " must remain exact");
        }

        System.out.println("GtoR329StrictFreightScreenTest: PASS");
    }

    private static GtoFastVisualDetector.Frame analyze(GtoFastVisualDetector d, BufferedImage image, long ts) {
        return d.analyze(new BufferedImageFrame(image, ts), image.getWidth(), image.getHeight(), ts);
    }

    private static BufferedImage copy(BufferedImage input) {
        BufferedImage output = new BufferedImage(input.getWidth(), input.getHeight(), BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = output.createGraphics(); g.drawImage(input, 0, 0, null); g.dispose(); return output;
    }

    private static final class BufferedImageFrame extends Image {
        private final Plane[] planes; private final long timestamp;
        BufferedImageFrame(BufferedImage image, long timestamp) {
            this.timestamp = timestamp;
            int w=image.getWidth(), h=image.getHeight(); byte[] rgba=new byte[w*h*4]; int o=0;
            for(int y=0;y<h;y++) for(int x=0;x<w;x++) { int a=image.getRGB(x,y); rgba[o++]=(byte)(a>>16); rgba[o++]=(byte)(a>>8); rgba[o++]=(byte)a; rgba[o++]=(byte)(a>>24); }
            planes = new Plane[] { new BufferedPlane(ByteBuffer.wrap(rgba), w*4) };
        }
        @Override public Plane[] getPlanes(){ return planes; }
        @Override public long getTimestamp(){ return timestamp; }
    }
    private static final class BufferedPlane extends Image.Plane {
        private final ByteBuffer buffer; private final int rowStride;
        BufferedPlane(ByteBuffer b,int r){buffer=b;rowStride=r;}
        @Override public ByteBuffer getBuffer(){return buffer.duplicate();}
        @Override public int getPixelStride(){return 4;}
        @Override public int getRowStride(){return rowStride;}
    }
}
