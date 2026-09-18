package com.nvu.operacional;

import android.graphics.Rect;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** HF35: only a real, semantically certified GTO jobs page may replace a trip. */
public final class GtoHf35FreightListAuthorityPolicyTest {
    private static void req(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }

    public static void main(String[] args) {
        req(!GtoFreightSemanticCertificationPolicy.isCertifiedPage(5, 5, 1),
            "one accidental monetary row cannot certify a five-row page");
        req(GtoFreightSemanticCertificationPolicy.isCertifiedPage(5, 5, 2),
            "two independent Aceitar+money rows certify a multi-row page");
        req(GtoFreightSemanticCertificationPolicy.isCertifiedPage(1, 1, 1),
            "a legitimate one-row final page remains supported");

        req(!GtoFreightSemanticCertificationPolicy.isCertifiedLifecycleBoundaryPage(5, 5, 2, 0),
            "visual+money without same-row distance cannot destroy the current trip");
        req(GtoFreightSemanticCertificationPolicy.isCertifiedLifecycleBoundaryPage(5, 5, 2, 1),
            "a repeated page with one complete Aceitar+Km+value row may cross the boundary");

        req(!GtoSimpleScreenDetectionPolicy.isCertifiedFreightListReturn(
            "TRIP_IN_PROGRESS", true, false, 5, 500L
        ), "many visual frames alone must never cancel an active trip");
        req(GtoSimpleScreenDetectionPolicy.isCertifiedFreightListReturn(
            "TRIP_IN_PROGRESS", true, true, 2, 55L
        ), "certified list return remains realtime");

        List<Rect> twoButtons = Arrays.asList(
            new Rect(1800, 70, 1950, 125),
            new Rect(1800, 200, 1950, 255)
        );
        float[] orange = new float[] {0.72f, 0.69f};
        float[] weakDark = new float[] {0.60f, 0.64f};
        float[] weakLight = new float[] {0.010f, 0.011f};
        float[] weakGreen = new float[] {0.004f, 0.003f};
        GtoFastVisualDetector.Frame hubLike = new GtoFastVisualDetector.Frame(
            1L, 1L, twoButtons, signatures(2), orange,
            weakDark, weakLight, weakGreen, new int[] {1,2,3}, 2000, 1000
        );
        req(!hubLike.hasFreightList(),
            "HUB-like orange controls without repeated freight-card texture must remain neutral");

        float[] freightDark = new float[] {0.88f, 0.90f};
        float[] freightLight = new float[] {0.042f, 0.038f};
        float[] freightGreen = new float[] {0.024f, 0.022f};
        GtoFastVisualDetector.Frame realLike = new GtoFastVisualDetector.Frame(
            2L, 2L, twoButtons, signatures(2), orange,
            freightDark, freightLight, freightGreen, new int[] {1,2,3}, 2000, 1000
        );
        req(realLike.hasFreightList(),
            "repeated freight-card texture must remain visually detectable");

        System.out.println("GtoHf35FreightListAuthorityPolicyTest: PASS");
    }

    private static List<int[]> signatures(int count) {
        List<int[]> out = new ArrayList<>();
        for (int i = 0; i < count; i++) out.add(new int[] {10, 20, 30});
        return out;
    }
}
