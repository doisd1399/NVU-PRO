package com.nvu.operacional;

public final class GtoHf45CriticalPolicyTest {
    private static void req(boolean v, String m) { if (!v) throw new AssertionError(m); }

    public static void main(String[] args) {
        req(!GtoResultCompletionPolicy.shouldInferReceiveFromCertifiedExit(
            "RESULT_DETECTED", true, false, "", false, false, Long.MAX_VALUE, 4, 2100L
        ), "passive exit must keep a short safety grace");
        req(GtoResultCompletionPolicy.shouldInferReceiveFromCertifiedExit(
            "RESULT_DETECTED", true, false, "", false, false, Long.MAX_VALUE, 4, 2300L
        ), "certified no-ad exit should resolve promptly after grace");
        req(!GtoResultCompletionPolicy.shouldInferReceiveFromCertifiedExit(
            "RESULT_DETECTED", true, false, "ADS", false, false, 1000L, 12, 10000L
        ), "exact ADS action must hold normal completion");
        req(!GtoResultCompletionPolicy.shouldInferReceiveFromCertifiedExit(
            "RESULT_DETECTED", true, false, "", true, false, Long.MAX_VALUE, 12, 60000L
        ), "positive watched-ad evidence must block normal completion");
        req(GtoMoneyValue.finalValueCompatibilityIssue("R$ 12.227,00", "R$ 1.222.700,00") != null,
            "100x OCR payout corruption must be rejected before certification");
        req(GtoMoneyValue.finalValueCompatibilityIssue("R$ 6.100,00", "R$ 6.100,00") == null,
            "valid result payout must remain compatible");
        System.out.println("GtoHf45CriticalPolicyTest: PASS");
    }
}
