package com.nvu.operacional;

/** HF182: text-only list candidacy must be repeated and bounded, never touch-authoritative. */
public final class GtoFreightTextOnlyCertificationPolicyTest {
    private static void require(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }

    public static void main(String[] args) {
        require(GtoFreightSemanticCertificationPolicy.isCertifiedTextOnlyPage(5, 2),
            "two repeated text/numeric rows certify a five-row OCR candidate");
        require(!GtoFreightSemanticCertificationPolicy.isCertifiedTextOnlyPage(5, 1),
            "one accidental OCR row cannot certify a five-row page");
        require(GtoFreightSemanticCertificationPolicy.isCertifiedTextOnlyPage(1, 1),
            "one complete OCR row remains supported");
        require(!GtoFreightSemanticCertificationPolicy.isCertifiedTextOnlyPage(0, 1),
            "empty OCR page must remain neutral");
        require(!GtoFreightSemanticCertificationPolicy.isCertifiedTextOnlyPage(7, 7),
            "unbounded OCR rows must remain neutral");
        System.out.println("GtoFreightTextOnlyCertificationPolicyTest: PASS");
    }
}
