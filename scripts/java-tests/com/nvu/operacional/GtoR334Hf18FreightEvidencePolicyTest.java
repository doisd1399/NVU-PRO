package com.nvu.operacional;

import java.util.ArrayList;
import java.util.List;

public final class GtoR334Hf18FreightEvidencePolicyTest {
    public static void main(String[] args) {
        testMultiLineOriginWithDestinationAnchor();
        testMultiLineOriginWithoutDestinationCompany();
        testFieldEvidenceIsIndependent();
        testDestinationCompanyIsNotRequired();
        testExactTouchIdentityNeedsCompatibleTransition();
        System.out.println("PASS HF18 freight evidence policy");
    }

    private static void testMultiLineOriginWithDestinationAnchor() {
        List<GtoOriginGeometryPolicy.RowLine> lines = new ArrayList<>();
        lines.add(new GtoOriginGeometryPolicy.RowLine("Dobradicas", 12, 24, 10, 90));
        lines.add(new GtoOriginGeometryPolicy.RowLine("Metalurgica", 35, 45, 10, 100));
        lines.add(new GtoOriginGeometryPolicy.RowLine("Dalavan", 47, 57, 10, 80));
        lines.add(new GtoOriginGeometryPolicy.RowLine("Itapetuna", 68, 80, 10, 90));
        GtoOriginGeometryPolicy.Result result = GtoOriginGeometryPolicy.inferFromRowLines(lines, "Dalavan", 0, 100);
        require(result.strong, "multi-line route must be strong");
        require("Metalurgica".equals(result.value), "origin must be the line before destination company");
        require(result.source.startsWith("ROW_ROI_"), "origin must come from selected-row ROI");
    }

    private static void testMultiLineOriginWithoutDestinationCompany() {
        List<GtoOriginGeometryPolicy.RowLine> lines = new ArrayList<>();
        lines.add(new GtoOriginGeometryPolicy.RowLine("Soja", 12, 24, 10, 70));
        lines.add(new GtoOriginGeometryPolicy.RowLine("Cooperativa Central", 37, 49, 10, 140));
        lines.add(new GtoOriginGeometryPolicy.RowLine("Area Rural", 68, 80, 10, 95));
        GtoOriginGeometryPolicy.Result result = GtoOriginGeometryPolicy.inferFromRowLines(lines, "", 0, 100);
        require(!result.strong && result.value.isEmpty(),
            "single unanchored route phrase must stay unresolved because it may contain source+destination company");
    }

    private static void testFieldEvidenceIsIndependent() {
        require(!GtoFreightFieldEvidencePolicy.text("Soja", 1, true), "selected-row cargo evidence must not fabricate a second OCR read");
        require(!GtoFreightFieldEvidencePolicy.text("Metalurgica", 1, true), "selected-row origin evidence must not fabricate a second OCR read");
        require(GtoFreightFieldEvidencePolicy.text("Itapetuna", 2, false), "two agreeing destination reads are sufficient");
        require(GtoFreightFieldEvidencePolicy.distance("300Km", 1, true), "selected-row distance is sufficient for the exact row");
        require(GtoFreightFieldEvidencePolicy.money("R$ 5.300,00", 1, true), "selected-row money is sufficient for the exact row");
        require(!GtoFreightFieldEvidencePolicy.text("Metalurgica", 1, false), "one unrelated OCR read must not be promoted by global consensus");
    }

    private static void testDestinationCompanyIsNotRequired() {
        require(GtoFreightFieldEvidencePolicy.optionalMetadata("", 0, false), "missing destination company must be accepted");
        require(GtoFreightFieldEvidencePolicy.requiredConfidence(true, true, true, true, true) == 1.0f,
            "five required fields must reach full confidence without destination company");
        require("".equals(GtoFreightReviewPolicy.firstRequiredField(
            "Soja", "Metalurgica", "", "Itapetuna", "300Km", "R$ 5.300,00")),
            "destination company must not trigger review");
    }


    private static void testExactTouchIdentityNeedsCompatibleTransition() {
        require(GtoSelectionIdentityPolicy.resolveExactTouchAfterTransition(2, 5, true, -1) == 2,
            "exact touch plus list exit must confirm the touched row");
        require(GtoSelectionIdentityPolicy.resolveExactTouchAfterTransition(2, 5, false, 2) == 2,
            "same-row visual transition must confirm the touched row");
        require(GtoSelectionIdentityPolicy.resolveExactTouchAfterTransition(2, 5, true, 3) == -1,
            "a different visual row must never replace the touched row");
        require(GtoSelectionIdentityPolicy.resolveExactTouchAfterTransition(2, 5, false, -1) == -1,
            "touch without any compatible transition must remain unconfirmed");
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
