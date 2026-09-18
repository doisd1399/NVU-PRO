package com.nvu.operacional;

public final class GtoVisualForegroundPolicyTest {
    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    public static void main(String[] args) {
        require(
            GtoVisualForegroundPolicy.allowFreightListProof(true, true, true, false, false, 5),
            "known GTO foreground + real five-row list must qualify"
        );
        require(
            GtoVisualForegroundPolicy.allowFreightListProof(true, true, false, true, false, 3),
            "unknown/stale foreground owner may be bridged by strict freight pixels"
        );
        require(
            GtoVisualForegroundPolicy.allowFreightListProof(true, true, false, false, true, 1),
            "bounded MediaProjection return grace may bridge the NVU permission activity"
        );
        require(
            !GtoVisualForegroundPolicy.allowFreightListProof(true, true, false, false, false, 5),
            "a positively known non-GTO foreground app must never be overridden by freight-like pixels"
        );
        require(
            GtoVisualForegroundPolicy.allowCurrentSessionFreightListProof(true, true, true, true, false, false, false, false, 5),
            "current authorized session with known GTO foreground may qualify"
        );
        require(
            GtoVisualForegroundPolicy.allowCurrentSessionFreightListProof(true, true, true, false, true, false, false, false, 3),
            "current authorized session with unknown foreground may bridge strict freight pixels"
        );
        require(
            !GtoVisualForegroundPolicy.allowCurrentSessionFreightListProof(true, true, true, false, false, false, false, false, 5),
            "current authorized session must not override a positively known non-GTO foreground app"
        );
        require(
            !GtoVisualForegroundPolicy.allowFreightListProof(false, true, true, false, true, 5),
            "visual proof is forbidden outside freight selection"
        );
        require(
            !GtoVisualForegroundPolicy.allowFreightListProof(true, false, true, false, true, 5),
            "visual proof requires an active projection"
        );
        require(
            !GtoVisualForegroundPolicy.allowFreightListProof(true, true, true, false, true, 0),
            "zero rows cannot prove GTO"
        );

        System.out.println("GtoVisualForegroundPolicyTest: PASS");
    }
}
