package com.nvu.operacional;

public final class GtoTripSubmissionPolicyTest {
    private static void check(String name, boolean ok) {
        if (!ok) throw new AssertionError(name);
        System.out.println("PASS " + name);
    }

    public static void main(String[] args) {
        check("in-progress trip never submits",
            !GtoTripSubmissionPolicy.maySubmit(
                "TRIP_IN_PROGRESS", "CONFIRMED_NORMAL", true, "session-1"
            ));
        check("freight-confirming trip never submits",
            !GtoTripSubmissionPolicy.maySubmit(
                "CONFIRMING_FREIGHT", "CONFIRMED_NORMAL", true, "session-1"
            ));
        check("result detected is not terminal submission",
            !GtoTripSubmissionPolicy.maySubmit(
                "RESULT_DETECTED", "RESULT_CERTIFIED_AUTO_PENDING", true, "session-1"
            ));
        check("missing certification never submits",
            !GtoTripSubmissionPolicy.maySubmit(
                "RESULT_CONFIRMED", "CONFIRMED_NORMAL", false, "session-1"
            ));
        check("wrong completion status never submits",
            !GtoTripSubmissionPolicy.maySubmit(
                "RESULT_CONFIRMED", "AUTO_RESULT_LATCHED", true, "session-1"
            ));
        check("missing session never submits",
            !GtoTripSubmissionPolicy.maySubmit(
                "RESULT_CONFIRMED", "CONFIRMED_NORMAL", true, ""
            ));
        check("certified final completion submits",
            GtoTripSubmissionPolicy.maySubmit(
                "RESULT_CONFIRMED", "CONFIRMED_NORMAL", true, "session-1"
            ));
        check("task removal has no submission authority",
            !GtoTripSubmissionPolicy.maySubmit(
                "TASK_REMOVED", "CONFIRMED_NORMAL", true, "session-1"
            ));
        System.out.println("8/8 terminal submission checks passed.");
    }
}

