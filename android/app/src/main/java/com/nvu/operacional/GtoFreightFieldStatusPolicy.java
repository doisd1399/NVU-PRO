
package com.nvu.operacional;

/** HF22/HF127: field status is diagnostic/UX metadata only; it never changes selection identity. */
final class GtoFreightFieldStatusPolicy {
    static final String CONFIRMED = "CONFIRMED";
    static final String PENDING = "PENDING";
    static final String OPTIONAL = "OPTIONAL";

    private GtoFreightFieldStatusPolicy() {}

    static String required(String value, String pendingField, String field) {
        if (field != null && field.equals(pendingField)) return PENDING;
        return value != null && !value.trim().isEmpty() ? CONFIRMED : PENDING;
    }

    static String requiredWithEvidence(
        String value,
        String pendingField,
        String field,
        int votes,
        boolean pauseMenuEvidence,
        boolean manualConfirmation
    ) {
        return requiredWithEvidence(
            value, pendingField, field, votes, pauseMenuEvidence, manualConfirmation, false
        );
    }

    static String requiredWithEvidence(
        String value,
        String pendingField,
        String field,
        int votes,
        boolean pauseMenuEvidence,
        boolean manualConfirmation,
        boolean selectedRowEvidence
    ) {
        if (field != null && field.equals(pendingField)) return PENDING;
        if (value == null || value.trim().isEmpty()) return PENDING;
        return pauseMenuEvidence || manualConfirmation || selectedRowEvidence || votes >= 2
            ? CONFIRMED : PENDING;
    }

    static String optional(String value) {
        return value != null && !value.trim().isEmpty() ? CONFIRMED : OPTIONAL;
    }
}
