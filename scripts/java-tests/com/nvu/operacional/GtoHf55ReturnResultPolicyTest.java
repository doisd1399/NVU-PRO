package com.nvu.operacional;

public final class GtoHf55ReturnResultPolicyTest {
    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    public static void main(String[] args) {
        // Ratios measured from the two physical screenshots that exposed the bug.
        require(
            GtoResultEvidencePolicy.isStrongReturnResult(0.88f, 0.84f, 0.52f, 0.52f),
            "physical Concluido screenshot must qualify as a strong return result"
        );
        require(
            GtoResultEvidencePolicy.isStrongReturnResult(0.96f, 0.94f, 0.80f, 0.13f),
            "physical screenshot with NVU card overlap must still qualify"
        );
        require(
            !GtoResultEvidencePolicy.isStrongReturnResult(0.80f, 0.70f, 0.42f, 0.02f),
            "dark gameplay without the gold result anchor must not restore foreground"
        );
        require(
            !GtoResultEvidencePolicy.isStrongReturnResult(0.55f, 0.80f, 0.70f, 0.30f),
            "buttons without the central result modal must not restore foreground"
        );

        require(
            GtoProjectionContinuityPolicy.mayProbeResultDuringForegroundLag(
                true, true, true, true, false, false, true
            ),
            "active trip may keep a strict result probe alive across stale UsageStats"
        );
        require(
            !GtoProjectionContinuityPolicy.mayProbeResultDuringForegroundLag(
                true, true, true, true, true, false, true
            ),
            "notification/SystemUI transient surfaces must remain neutral"
        );
        require(
            !GtoProjectionContinuityPolicy.mayProbeResultDuringForegroundLag(
                true, true, true, true, false, true, true
            ),
            "real NVU MainActivity must never be interpreted as GTO"
        );
        require(
            !GtoProjectionContinuityPolicy.mayProbeResultDuringForegroundLag(
                true, false, true, true, false, false, true
            ),
            "result return probing requires the existing MediaProjection and VirtualDisplay"
        );
        require(
            !GtoProjectionContinuityPolicy.mayProbeResultDuringForegroundLag(
                true, true, false, true, false, false, true
            ),
            "no active result-tracking journey means no result return probe"
        );

        System.out.println("GtoHf55ReturnResultPolicyTest: PASS");
    }
}
