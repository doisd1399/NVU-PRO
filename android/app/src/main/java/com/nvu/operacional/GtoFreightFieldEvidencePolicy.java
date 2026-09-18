package com.nvu.operacional;

/**
 * Field-level evidence policy for an already-selected freight row.
 *
 * Required operational text fields are accepted automatically only after two
 * concordant OCR reads. Evidence from the immutable selected-row snapshot is
 * retained for review/audit, but it is deliberately not a second OCR vote.
 * The pause menu is an explicit trusted source and is handled by the observer's
 * pause-specific gate instead of weakening this generic policy.
 */
final class GtoFreightFieldEvidencePolicy {
    private GtoFreightFieldEvidencePolicy() {}

    static boolean text(String value, int votes, boolean selectedRowEvidence) {
        return text(value, votes, selectedRowEvidence, false);
    }

    static boolean text(String value, int votes, boolean selectedRowEvidence, boolean pauseMenuEvidence) {
        // selectedRowEvidence identifies the exact touched row only. A single
        // snapshot must never become an automatic confirmation for cargo/origin/
        // destination merely because it came from that row. The pause menu is
        // accepted only when the caller explicitly marks that authoritative surface.
        return validText(value) && (pauseMenuEvidence || votes >= 2);
    }

    /**
     * Narrow List-only contract. The caller must have already proved that the
     * focused OCR and the immutable baseline belong to the same touched row and
     * independently agree. This method never normalizes or rewrites the literal.
     */
    static boolean textFromSameRowAuthority(String value, boolean sameRowAuthority) {
        return validText(value) && sameRowAuthority;
    }

    static boolean distance(String value, int votes, boolean selectedRowEvidence) {
        return GtoFreightReviewPolicy.isManualValueValid(GtoFreightReviewPolicy.DISTANCE, value)
            && (votes >= 2 || selectedRowEvidence);
    }

    static boolean money(String value, int votes, boolean selectedRowEvidence) {
        return GtoFreightReviewPolicy.isManualValueValid(GtoFreightReviewPolicy.VALUE, value)
            && (votes >= 2 || selectedRowEvidence);
    }

    static boolean optionalMetadata(String value, int votes, boolean selectedRowEvidence) {
        if (value == null || value.trim().isEmpty()) return true;
        return validText(value) && (votes >= 1 || selectedRowEvidence);
    }

    static float requiredConfidence(
        boolean cargo,
        boolean origin,
        boolean destination,
        boolean distance,
        boolean value
    ) {
        int ok = 0;
        if (cargo) ok++;
        if (origin) ok++;
        if (destination) ok++;
        if (distance) ok++;
        if (value) ok++;
        return ok / 5f;
    }

    private static boolean validText(String value) {
        if (value == null) return false;
        String v = value.trim();
        if (v.length() < 2 || v.length() > 220) return false;
        String normalized = v.toLowerCase(java.util.Locale.ROOT).replaceAll("\\s+", " ");
        if (normalized.matches("^(carga|origem|destino)\\s+(e|de|do|da|final)$")
            || normalized.matches("^(carga|origem|destino)\\s+(e|ou)\\s+(carga|origem|destino)$")) return false;
        int letters = 0;
        for (int i = 0; i < v.length(); i++) if (Character.isLetter(v.charAt(i))) letters++;
        return letters >= 2;
    }
}
