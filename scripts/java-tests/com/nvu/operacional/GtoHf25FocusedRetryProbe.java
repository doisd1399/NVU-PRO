package com.nvu.operacional;

public final class GtoHf25FocusedRetryProbe {
    private static void ok(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    public static void main(String[] args) {
        // Text conflicts: retry must agree with one initial literal read.
        ok(GtoFreightFieldConflictPolicy.needsRetry(
            GtoFreightReviewPolicy.DESTINATION, "Itapetuna", "Itapetona"),
            "destination disagreement must trigger focused retry");
        GtoFreightFieldConflictPolicy.Resolution d1 = GtoFreightFieldConflictPolicy.resolve(
            GtoFreightReviewPolicy.DESTINATION, "Itapetuna", "Itapetona", "Itapetuna");
        ok(d1.resolved && "Itapetuna".equals(d1.value), "retry must confirm literal selected destination");
        GtoFreightFieldConflictPolicy.Resolution d2 = GtoFreightFieldConflictPolicy.resolve(
            GtoFreightReviewPolicy.DESTINATION, "Itapetuna", "Itapetona", "Itapetona");
        ok(d2.resolved && "Itapetona".equals(d2.value), "retry may confirm frozen literal destination");
        ok(!GtoFreightFieldConflictPolicy.resolve(
            GtoFreightReviewPolicy.DESTINATION, "Itapetuna", "Itapetona", "Itapetema").resolved,
            "third spelling must remain unresolved");

        // Same policy for origin and cargo.
        ok(GtoFreightFieldConflictPolicy.needsRetry(
            GtoFreightReviewPolicy.ORIGIN_COMPANY, "Metalurgica", "Metalúrgica"),
            "origin accent disagreement must trigger focused retry");
        ok(GtoFreightFieldConflictPolicy.resolve(
            GtoFreightReviewPolicy.ORIGIN_COMPANY, "Metalurgica", "Metalúrgica", "Metalurgica").resolved,
            "origin focused retry must resolve literal agreement");
        ok(GtoFreightFieldConflictPolicy.resolve(
            GtoFreightReviewPolicy.CARGO, "Dobradicas", "Dobradiças", "Dobradicas").resolved,
            "cargo focused retry must resolve literal agreement");

        // Numeric fields remain conservative.
        ok(GtoFreightFieldConflictPolicy.needsRetry(
            GtoFreightReviewPolicy.DISTANCE, "300Km", "800Km"),
            "distance disagreement must trigger retry");
        ok(!GtoFreightFieldConflictPolicy.resolve(
            GtoFreightReviewPolicy.DISTANCE, "300Km", "800Km", "600Km").resolved,
            "third distance must never be guessed");
        ok(GtoFreightFieldConflictPolicy.resolve(
            GtoFreightReviewPolicy.DISTANCE, "300Km", "800Km", "300Km").resolved,
            "distance may resolve only by agreement");

        ok(GtoFreightFieldConflictPolicy.needsRetry(
            GtoFreightReviewPolicy.VALUE, "R$ 5.300,00", "R$ 53.000,00"),
            "money disagreement must trigger retry");
        ok(GtoFreightFieldConflictPolicy.resolve(
            GtoFreightReviewPolicy.VALUE, "R$ 5.300,00", "R$ 53.000,00", "R$ 5.300").resolved,
            "money retry compares semantic amount");
        ok(!GtoFreightFieldConflictPolicy.resolve(
            GtoFreightReviewPolicy.VALUE, "R$ 5.300,00", "R$ 53.000,00", "R$ 7.000").resolved,
            "third money amount must remain unresolved");

        // A frozen value alone is preserved for review but cannot be promoted.
        GtoFreightFieldConflictPolicy.Resolution fallback = GtoFreightFieldConflictPolicy.resolve(
            GtoFreightReviewPolicy.DESTINATION, "", "Cruz do Oeste", "");
        ok(!fallback.resolved,
            "missing exact destination remains pending with only one frozen read");
        GtoFreightFieldConflictPolicy.Resolution focused =
            GtoFreightFieldConflictPolicy.resolveWithFocusedReads(
                GtoFreightReviewPolicy.DESTINATION, "", "Cruz do Oeste",
                "Cruz do Oeste", "Cruz do Oeste");
        ok(focused.resolved && "Cruz do Oeste".equals(focused.value),
            "two focused same-row reads confirm the preserved destination");

        System.out.println("GtoHf25FocusedRetryProbe: PASS");
    }
}
