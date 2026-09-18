package com.nvu.operacional;

public final class GtoHf47CertifiedResultLifecycleTest {
    private static void req(boolean ok, String message) {
        if (!ok) throw new AssertionError(message);
    }

    public static void main(String[] args) {
        long durableCertifiedAt = 12_345L;
        long now = 99_999L;

        // Exact HF46 root-cause regression: after sticky-service/process recreation the
        // in-memory resultScreenLastSeenAt is zero while the durable certified result is
        // still present. Tracking must remain active from durable truth alone.
        req(GtoCertifiedResultLifecyclePolicy.shouldTrack("RESULT_DETECTED", true, false),
            "certified RESULT_DETECTED must remain trackable after lifecycle recreation");
        req(GtoCertifiedResultLifecyclePolicy.restoreCertifiedSeenAt(true, 0L, durableCertifiedAt, now)
                == durableCertifiedAt,
            "volatile result timestamp must be restored from durable certification");
        req(GtoCertifiedResultLifecyclePolicy.restoreCertifiedSeenAt(true, 0L, 0L, now) == now,
            "missing legacy timestamp still gets a fresh nonzero recovery anchor");
        req(!GtoCertifiedResultLifecyclePolicy.shouldTrack("RESULT_DETECTED", true, true),
            "positive watched-ad evidence must stop normal result resolution");

        int absent = GtoResultCompletionPolicy.PASSIVE_EXIT_MIN_ABSENT_FRAMES;
        req(GtoCertifiedResultLifecyclePolicy.shouldArmFrameResolver(absent),
            "enough strict absent frames must arm terminal resolution");
        req(!GtoCertifiedResultLifecyclePolicy.shouldArmFrameResolver(absent - 1),
            "one frame short must not arm terminal resolution");

        req(GtoResultCompletionPolicy.shouldInferReceiveFromCertifiedExit(
                "RESULT_DETECTED", true, false, "", false, false,
                Long.MAX_VALUE, absent, GtoResultCompletionPolicy.PASSIVE_EXIT_GRACE_MS + 1L),
            "certified modal exit with no watched-ad evidence must resolve normal Receive");
        req(!GtoResultCompletionPolicy.shouldInferReceiveFromCertifiedExit(
                "RESULT_DETECTED", true, false, "", true, false,
                Long.MAX_VALUE, absent, GtoResultCompletionPolicy.PASSIVE_EXIT_GRACE_MS + 1L),
            "watched-ad evidence must remain the only positive rejection veto");

        System.out.println("PASS GtoHf47CertifiedResultLifecycleTest");
    }
}
