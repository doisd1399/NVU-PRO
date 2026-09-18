package com.nvu.operacional;

public final class GtoHf49AutomaticResultPolicyTest {
    private static void req(boolean ok, String message) {
        if (!ok) throw new AssertionError(message);
    }

    public static void main(String[] args) {
        long hold = GtoResultCompletionPolicy.ADS_ACTION_MAX_HOLD_MS;
        req(GtoAutomaticResultPolicy.mayLatchAutomaticCompletion(
            true, false, true, true, true, false, "", Long.MAX_VALUE, hold
        ), "certified result + locked freight + ADS guard must auto-complete without Receive");
        req(!GtoAutomaticResultPolicy.mayLatchAutomaticCompletion(
            true, true, true, true, true, false, "", Long.MAX_VALUE, hold
        ), "positive watched-ad evidence must block normal automatic completion");
        req(!GtoAutomaticResultPolicy.mayLatchAutomaticCompletion(
            true, false, true, true, false, false, "", Long.MAX_VALUE, hold
        ), "required ADS guard must attach before automatic completion");
        req(!GtoAutomaticResultPolicy.mayLatchAutomaticCompletion(
            true, false, true, true, true, true, "", Long.MAX_VALUE, hold
        ), "active ad UI must pause automatic completion");
        req(!GtoAutomaticResultPolicy.mayLatchAutomaticCompletion(
            true, false, true, true, true, false, "ADS", hold - 1L, hold
        ), "fresh ADS action stays non-terminal while ad evidence is unresolved");
        req(GtoAutomaticResultPolicy.mayLatchAutomaticCompletion(
            true, false, true, true, true, false, "ADS", hold + 1L, hold
        ), "ADS touch alone cannot reject a certified trip forever without watched evidence");
        req(!GtoAutomaticResultPolicy.mayLatchAutomaticCompletion(
            true, false, false, true, true, false, "", Long.MAX_VALUE, hold
        ), "missing immutable freight snapshot must never create an incomplete trip");
        req(GtoAutomaticResultPolicy.shouldKeepAdsGuard(true, true, false),
            "ADS guard remains while auto-registered result dialog is visible");
        req(!GtoAutomaticResultPolicy.shouldKeepAdsGuard(true, false, false),
            "ADS guard is released after the result dialog exits");
        System.out.println("PASS GtoHf49AutomaticResultPolicyTest");
    }
}
