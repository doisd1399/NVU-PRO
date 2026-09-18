package com.nvu.operacional;

public final class GtoHf32ContinuousRecognitionPolicyTest {
    public static void main(String[] args) {
        // Different absolute time domains: must be accepted. This is the HF31 field failure class.
        require(GtoFrameFreshnessPolicy.shouldConsume(88_000_000_000L, 3_000_000L, false),
            "timestamp-domain reset/difference must not suppress live GTO frames");
        require(GtoFrameFreshnessPolicy.shouldConsume(3_000_000L, 19_000_000L, false),
            "forward producer timestamp must be accepted");
        require(!GtoFrameFreshnessPolicy.shouldConsume(19_000_000L, 19_000_000L, false),
            "normal exact duplicate may be ignored");
        require(GtoFrameFreshnessPolicy.shouldConsume(19_000_000L, 19_000_000L, true),
            "critical touch must fail-open on duplicate timestamp");

        long now = 10_000L;
        require(GtoCaptureHealthPolicy.isHealthy(
            true, true, true, true, true, true, false, true,
            now, now - 100L, now - 120L
        ), "real frame + real classifier heartbeat in ready GTO must be healthy");
        require(!GtoCaptureHealthPolicy.isHealthy(
            true, true, true, true, true, true, false, false,
            now, now - 100L, now - 120L
        ), "stability-only capture must not claim detector health");
        require(!GtoCaptureHealthPolicy.isHealthy(
            true, true, true, true, true, true, false, true,
            now, now - 100L, now - 3000L
        ), "fresh buffers with stale classifier heartbeat must be unhealthy");

        System.out.println("GtoHf32ContinuousRecognitionPolicyTest: PASS");
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
