package com.nvu.operacional;

/**
 * Text authority contract for the direct freight-list path.
 *
 * Human geometry certifies which row was touched. It does not certify the OCR text
 * inside that row. Required List text is automatically promotable only after two
 * concordant reads; a trusted frozen page baseline is handled by the merge/retry
 * path and must not be converted into direct-row authority.
 */
final class GtoFreightListTextAuthorityPolicy {
    private GtoFreightListTextAuthorityPolicy() {}

    static boolean allRequiredTextFieldsConfirmed(
        String cargo,
        int cargoVotes,
        String origin,
        int originVotes,
        String destination,
        int destinationVotes
    ) {
        return GtoFreightFieldEvidencePolicy.text(cargo, cargoVotes, false, false)
            && GtoFreightFieldEvidencePolicy.text(origin, originVotes, false, false)
            && GtoFreightFieldEvidencePolicy.text(destination, destinationVotes, false, false);
    }

    static boolean canDirectPromote(
        FreightTextEvidence evidence,
        boolean pauseMenuEvidence
    ) {
        if (pauseMenuEvidence || evidence == null) return false;
        return allRequiredTextFieldsConfirmed(
            evidence.cargo,
            evidence.cargoVotes,
            evidence.origin,
            evidence.originVotes,
            evidence.destination,
            evidence.destinationVotes
        );
    }

    /**
     * Narrow same-row route. It is valid only after the caller proves that the
     * focused read and immutable baseline are independent captures of the exact
     * touched row. The boolean is not derived from text quality or a single OCR.
     */
    static boolean canPromoteSameRow(
        FreightTextEvidence evidence,
        boolean sameRowAuthority,
        boolean pauseMenuEvidence
    ) {
        if (pauseMenuEvidence || evidence == null || !sameRowAuthority) return false;
        return GtoFreightFieldEvidencePolicy.textFromSameRowAuthority(evidence.cargo, true)
            && GtoFreightFieldEvidencePolicy.textFromSameRowAuthority(evidence.origin, true)
            && GtoFreightFieldEvidencePolicy.textFromSameRowAuthority(evidence.destination, true);
    }

    static final class FreightTextEvidence {
        final String cargo;
        final int cargoVotes;
        final String origin;
        final int originVotes;
        final String destination;
        final int destinationVotes;

        FreightTextEvidence(
            String cargo,
            int cargoVotes,
            String origin,
            int originVotes,
            String destination,
            int destinationVotes
        ) {
            this.cargo = cargo;
            this.cargoVotes = cargoVotes;
            this.origin = origin;
            this.originVotes = originVotes;
            this.destination = destination;
            this.destinationVotes = destinationVotes;
        }
    }
}
