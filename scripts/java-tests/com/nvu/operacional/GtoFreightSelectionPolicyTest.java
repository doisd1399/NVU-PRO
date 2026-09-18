package com.nvu.operacional;

public final class GtoFreightSelectionPolicyTest {
    public static void main(String[] args) {
        require(GtoFreightSelectionPolicy.canCommitCanonicalRow(
            1, 1, true, "600Km", "R$ 15600", "600Km", "R$ 15600"),
            "matching numeric identity should commit canonical row");

        require(GtoFreightSelectionPolicy.canCommitCanonicalRow(
            1, 1, true, "", "", "600Km", "R$ 15600"),
            "missing secondary OCR must not veto a safe canonical row");

        require(GtoFreightSelectionPolicy.canCommitCanonicalRow(
            1, 1, true, "600Km", "R$ 5.300,00", "600Km", "R$ 5300"),
            "equivalent pt-BR money formatting must not create a false selection conflict");

        require(GtoFreightSelectionPolicy.canCommitCanonicalRow(
            1, 1, true, "600Km", "R$ 5.300", "600Km", "R$ 5300,00"),
            "thousands-only and explicit-cents money formatting must compare by cents");

        require(!GtoFreightSelectionPolicy.canCommitCanonicalRow(
            1, 2, true, "600Km", "R$ 15600", "600Km", "R$ 15600"),
            "different row must never commit");

        require(!GtoFreightSelectionPolicy.canCommitCanonicalRow(
            1, 1, false, "600Km", "R$ 15600", "600Km", "R$ 15600"),
            "unsafe canonical row must never commit");

        require(!GtoFreightSelectionPolicy.canCommitCanonicalRow(
            1, 1, true, "600Km", "R$ 15300", "600Km", "R$ 15600"),
            "explicit value conflict must reject");

        require(!GtoFreightSelectionPolicy.canCommitCanonicalRow(
            1, 1, true, "500Km", "R$ 15600", "600Km", "R$ 15600"),
            "explicit distance conflict must reject");

        System.out.println("GtoFreightSelectionPolicyTest: PASS");
    }

    private static void require(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }
}
