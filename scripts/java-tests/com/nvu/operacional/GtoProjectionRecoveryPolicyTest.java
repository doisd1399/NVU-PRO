package com.nvu.operacional;

public final class GtoProjectionRecoveryPolicyTest {
    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    private static boolean allowed(
        boolean reauthRequired,
        boolean autoAllowed,
        boolean gtoForeground,
        boolean exactGtoPackage,
        boolean landscape,
        boolean bubbleAttached,
        boolean captureNeeded,
        boolean projectionActive,
        boolean surfacePending,
        boolean permissionInFlight,
        long now,
        long lastAutoRequestAt,
        long cooldownMs
    ) {
        return GtoProjectionRecoveryPolicy.shouldAutoRequest(
            reauthRequired,
            autoAllowed,
            gtoForeground,
            exactGtoPackage,
            landscape,
            bubbleAttached,
            captureNeeded,
            projectionActive,
            surfacePending,
            permissionInFlight,
            now,
            lastAutoRequestAt,
            cooldownMs
        );
    }

    public static void main(String[] args) {
        require(
            allowed(true, true, true, true, true, true, true, false, false, false, 10_000L, 0L, 5_000L),
            "authorized reauth in exact GTO foreground may request a fresh grant"
        );
        require(
            !allowed(true, true, true, false, true, true, true, false, false, false, 10_000L, 0L, 5_000L),
            "visual/trusted context without exact GTO package must not auto-request permission"
        );
        require(
            !allowed(true, true, false, true, true, true, true, false, false, false, 10_000L, 0L, 5_000L),
            "exact package alone cannot bypass the foreground gate"
        );
        require(
            !allowed(true, true, true, true, true, true, true, false, false, false, 12_000L, 9_000L, 5_000L),
            "reauthorization cooldown must remain enforced"
        );
        require(
            !allowed(true, true, true, true, true, true, true, true, false, false, 10_000L, 0L, 5_000L),
            "active projection must not trigger duplicate authorization"
        );

        System.out.println("GtoProjectionRecoveryPolicyTest: PASS");
    }
}
