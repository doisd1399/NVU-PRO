package com.nvu.operacional;

import android.graphics.Rect;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

public final class GtoFreightSelectionRegressionTest {
    private static final int WIDTH = 1536;
    private static final int HEIGHT = 691;

    public static void main(String[] args) throws Exception {
        List<Rect> realFiveFreights = Arrays.asList(
            new Rect(1398, 42, 1533, 95),
            new Rect(1398, 163, 1533, 216),
            new Rect(1398, 285, 1533, 338),
            new Rect(1398, 406, 1533, 460),
            new Rect(1398, 528, 1533, 581)
        );
        List<Rect> reportedGameplayFalsePositive = Arrays.asList(
            new Rect(1398, 268, 1533, 295),
            new Rect(1398, 426, 1533, 497)
        );

        require(frame(realFiveFreights, WIDTH, HEIGHT).hasFreightList(), "real five-row GTO page must remain valid");
        require(!frame(reportedGameplayFalsePositive, WIDTH, HEIGHT).hasFreightList(),
            "reported gameplay frame must not become a two-freight list");

        Method geometry = GtoFastVisualDetector.class.getDeclaredMethod(
            "isPlausibleButtonStack", List.class, int.class
        );
        geometry.setAccessible(true);
        GtoFastVisualDetector detector = new GtoFastVisualDetector();
        require((Boolean) geometry.invoke(detector, realFiveFreights, HEIGHT),
            "detector must retain the real repeated Aceitar stack");
        require(!(Boolean) geometry.invoke(detector, reportedGameplayFalsePositive, HEIGHT),
            "detector must reject unrelated orange regions with incompatible heights");

        List<Rect> scaledTwoFreights = Arrays.asList(
            new Rect(910, 85, 1000, 116),
            new Rect(910, 190, 1000, 223)
        );
        require(frame(scaledTwoFreights, 1024, 576).hasFreightList(),
            "normal scaling variance must not reject a valid two-row page");
        require(!frame(Collections.singletonList(new Rect(1398, 320, 1533, 373)), WIDTH, HEIGHT).hasFreightList(),
            "a lone gameplay orange region below the list header must remain invalid");

        // OEMs are allowed to redact ACTION_OUTSIDE. The detector must still identify
        // one isolated pressed Aceitar row from adjacent frames, while final selection
        // remains gated by list closure + exact OCR in GtoObserverService.
        GtoFastVisualDetector.Frame clean = visualFrame(realFiveFreights, -1);
        GtoFastVisualDetector.Frame pressedThird = visualFrame(realFiveFreights, 2);
        require(detector.samePage(clean, pressedThird),
            "button press must not look like freight-page navigation");
        GtoFastVisualDetector.PressCandidate visualCandidate = detector.detectPressedRow(clean, pressedThird, HEIGHT);
        require(visualCandidate != null && visualCandidate.row == 2,
            "visual-only fallback must identify the third pressed row exactly");

        // Regression fixture for the intermittent loss: compositor dimming/ripple may
        // weaken the aggregate card-context evidence on the pressed frame, making
        // current.hasFreightList() false even though the baseline, panel and button
        // geometry are unchanged. The human-backed after-touch detector must still map
        // the changed row; semantic OCR and transaction gates remain downstream.
        float[] weakDark = repeated(realFiveFreights.size(), 0.70f);
        float[] weakLight = repeated(realFiveFreights.size(), 0.010f);
        float[] weakGreen = repeated(realFiveFreights.size(), 0.004f);
        GtoFastVisualDetector.Frame weakPressed = new GtoFastVisualDetector.Frame(
            1L,
            1L,
            realFiveFreights,
            pressedThird.buttonSignatures,
            pressedThird.orangeRatios,
            weakDark,
            weakLight,
            weakGreen,
            pressedThird.panelSignature,
            WIDTH,
            HEIGHT
        );
        require(!weakPressed.hasFreightList(),
            "marginal pressed frame must reproduce the aggregate-list false negative");
        GtoFastVisualDetector.PressCandidate recoveredMarginal = detector.detectPressedRowAfterTouch(
            clean, weakPressed, HEIGHT
        );
        require(recoveredMarginal != null && recoveredMarginal.row == 2,
            "human-backed after-touch path must recover the exact row from a marginal frame");

        List<Rect> thirdMissing = new ArrayList<>(realFiveFreights);
        thirdMissing.remove(2);
        GtoFastVisualDetector.PressCandidate missingCandidate = detector.detectTemporarilyMissingPressedRow(
            clean, visualFrame(thirdMissing, -1), HEIGHT
        );
        require(missingCandidate != null && missingCandidate.row == 2,
            "temporarily dark/missing third Aceitar must map to the exact missing slot");

        int[][] screens = new int[][] {
            {854, 480},
            {1280, 720},
            {1536, 691},
            {1600, 900},
            {1920, 1080},
            {2400, 1080}
        };
        for (int[] screen : screens) {
            for (int count = 1; count <= 6; count++) {
                require(frame(scaledFreightStack(screen[0], screen[1], count), screen[0], screen[1]).hasFreightList(),
                    "valid " + count + "-row list must work at " + screen[0] + "x" + screen[1]);
            }
            List<Rect> irregular = Arrays.asList(
                scaledRect(screen[0], screen[1], 0.91f, 0.38f, 0.997f, 0.415f),
                scaledRect(screen[0], screen[1], 0.91f, 0.63f, 0.997f, 0.76f)
            );
            require(!frame(irregular, screen[0], screen[1]).hasFreightList(),
                "unrelated orange regions must remain invalid at " + screen[0] + "x" + screen[1]);
        }

        System.out.println("GtoFreightSelectionRegressionTest: PASS");
    }

    private static List<Rect> scaledFreightStack(int width, int height, int count) {
        List<Rect> rows = new ArrayList<>();
        float gap = count >= 6 ? 0.145f : 0.175f;
        float center = 0.10f;
        float buttonHeight = 0.075f;
        for (int row = 0; row < count; row++) {
            float cy = center + row * gap;
            rows.add(scaledRect(width, height, 0.91f, cy - buttonHeight / 2f, 0.997f, cy + buttonHeight / 2f));
        }
        return rows;
    }

    private static Rect scaledRect(int width, int height, float left, float top, float right, float bottom) {
        return new Rect(
            Math.round(width * left),
            Math.round(height * top),
            Math.round(width * right),
            Math.round(height * bottom)
        );
    }

    private static GtoFastVisualDetector.Frame frame(List<Rect> rects, int width, int height) {
        List<int[]> signatures = new ArrayList<>();
        for (int ignored = 0; ignored < rects.size(); ignored++) signatures.add(new int[1]);
        return new GtoFastVisualDetector.Frame(
            1L,
            1L,
            rects,
            signatures,
            filledOrange(rects.size()),
            new int[1],
            width,
            height
        );
    }

    private static float[] filledOrange(int size) {
        return repeated(size, 0.72f);
    }

    private static float[] repeated(int size, float value) {
        float[] values = new float[size];
        java.util.Arrays.fill(values, value);
        return values;
    }

    private static GtoFastVisualDetector.Frame visualFrame(List<Rect> rects, int pressedRow) {
        List<int[]> signatures = new ArrayList<>();
        float[] orange = new float[rects.size()];
        for (int i = 0; i < rects.size(); i++) {
            int value = i == pressedRow ? 138 : 100;
            signatures.add(new int[] { value, value, value, value });
            orange[i] = i == pressedRow ? 0.54f : 0.72f;
        }
        return new GtoFastVisualDetector.Frame(
            1L,
            1L,
            rects,
            signatures,
            orange,
            new int[] { 100, 100, 100, 100 },
            WIDTH,
            HEIGHT
        );
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
