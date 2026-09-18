package com.nvu.operacional;

import java.util.Arrays;

public final class GtoHf159ListOriginTextPolicyTest {
    public static void main(String[] args) {
        exactKnownOcrAliasIsCorrected();
        selectedRowGeometryReturnsCorrectOriginOnFirstRead();
        repeatedBadOcrCannotCertifyTheBadLiteral();
        focusedReadsReturnTheCanonicalOrigin();
        unrelatedOriginsRemainLiteral();
        nonExactVariantsRemainLiteral();
        destinationIsNotChangedByOriginPolicy();
        System.out.println("GtoHf159ListOriginTextPolicyTest: PASS");
    }

    private static void exactKnownOcrAliasIsCorrected() {
        require("Metalurgica".equals(GtoListOriginTextPolicy.canonicalizeOcrLiteral("Metalurgioa")),
            "the proven Metalurgioa OCR alias must become Metalurgica");
        require("Metalurgica".equals(GtoListOriginTextPolicy.canonicalizeOcrLiteral("  METALURGIOA  ")),
            "the exact alias must be matched after harmless case/space normalization");
    }

    private static void selectedRowGeometryReturnsCorrectOriginOnFirstRead() {
        GtoOriginGeometryPolicy.Result result = GtoOriginGeometryPolicy.infer(
            "Metalurgioa > Matecom",
            Arrays.asList(
                new GtoOriginGeometryPolicy.Token("Metalurgioa", 0, 105),
                new GtoOriginGeometryPolicy.Token(">", 112, 118),
                new GtoOriginGeometryPolicy.Token("Matecom", 130, 200)
            ),
            "Matecom",
            24
        );
        require(result.strong, "the visible route separator must remain strong evidence");
        require("Metalurgica".equals(result.value),
            "the first selected-row origin read must already be canonical");
    }

    private static void repeatedBadOcrCannotCertifyTheBadLiteral() {
        GtoFreightFieldConflictPolicy.Resolution result = GtoFreightFieldConflictPolicy.resolve(
            GtoFreightReviewPolicy.ORIGIN,
            "Metalurgioa",
            "Metalurgica",
            "Metalurgioa"
        );
        require(result.resolved, "two compatible same-row sources must resolve");
        require("Metalurgica".equals(result.value),
            "the retry must never promote Metalurgioa as the certified origin");
    }

    private static void focusedReadsReturnTheCanonicalOrigin() {
        GtoFreightFieldConflictPolicy.Resolution result =
            GtoFreightFieldConflictPolicy.resolveWithFocusedReads(
                GtoFreightReviewPolicy.ORIGIN,
                "",
                "",
                "Metalurgioa",
                "Metalurgioa"
            );
        require(result.resolved, "two focused reads must remain usable");
        require("Metalurgica".equals(result.value),
            "two focused reads of the same OCR alias must return Metalurgica");
    }

    private static void unrelatedOriginsRemainLiteral() {
        String[] values = {
            "Fazenda Areia Dourada",
            "Cooperativa Central",
            "Porto de Santos",
            "Madeireira São José",
            "Metalúrgica"
        };
        for (String value : values) {
            require(value.equals(GtoListOriginTextPolicy.canonicalizeOcrLiteral(value)),
                "unrelated origin must remain literal: " + value);
        }
    }

    private static void nonExactVariantsRemainLiteral() {
        require("Metalurgioa Norte".equals(
                GtoListOriginTextPolicy.canonicalizeOcrLiteral("Metalurgioa Norte")),
            "the rule must not rewrite a longer legitimate name");
        require("Metalurgia".equals(GtoListOriginTextPolicy.canonicalizeOcrLiteral("Metalurgia")),
            "the rule must not use fuzzy prefix correction");
    }

    private static void destinationIsNotChangedByOriginPolicy() {
        GtoFreightFieldConflictPolicy.Resolution result = GtoFreightFieldConflictPolicy.resolve(
            GtoFreightReviewPolicy.DESTINATION,
            "Metalurgioa",
            "Metalurgioa",
            "Metalurgioa"
        );
        require(result.resolved && "Metalurgioa".equals(result.value),
            "destination must not be canonicalized by the origin-only policy");
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
