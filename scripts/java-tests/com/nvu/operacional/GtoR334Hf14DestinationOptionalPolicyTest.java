package com.nvu.operacional;

public final class GtoR334Hf14DestinationOptionalPolicyTest {
    public static void main(String[] args) {
        require("".equals(GtoFreightReviewPolicy.firstRequiredField(
            "Dobradiças", "Metalúrgica", "", "Itapetuna", "300Km", "R$ 5.300,00")),
            "destinationCompany must be optional when every driver-required freight field is valid");

        String missingOriginField = GtoFreightReviewPolicy.firstRequiredField(
            "Dobradiças", "", "Dalavan", "Itapetuna", "300Km", "R$ 5.300,00");
        require(GtoFreightReviewPolicy.ORIGIN.equals(missingOriginField)
            || GtoFreightReviewPolicy.ORIGIN_COMPANY.equals(missingOriginField),
            "missing origin must still require driver review");

        require(GtoFreightReviewPolicy.DESTINATION.equals(GtoFreightReviewPolicy.firstRequiredField(
            "Dobradiças", "Metalúrgica", "", "", "300Km", "R$ 5.300,00")),
            "missing destination city must still require review");

        require(!GtoFreightReviewPolicy.isManualValueValid(
            GtoFreightReviewPolicy.DESTINATION_COMPANY, "Dalavan"),
            "destinationCompany must never become a manual-driver form field");

        require(GtoFreightReviewPolicy.isManualValueValid(
            GtoFreightReviewPolicy.ORIGIN_COMPANY, "Metalúrgica"),
            "origin remains a valid manual fallback");

        System.out.println("GtoR334Hf14DestinationOptionalPolicyTest: PASS");
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
