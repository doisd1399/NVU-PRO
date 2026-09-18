package com.nvu.operacional;

/** Multiple-evidence wake-up policy for the GTO completion/result dialog. */
final class GtoResultEvidencePolicy {
    private GtoResultEvidencePolicy() {}

    static boolean isPlausibleResult(
        float dialogDark,
        float dialogRightDark,
        float receiveNeutral,
        float adsGold
    ) {
        // The central modal remains the anchor. Any one supporting region may be partly
        // obscured without suppressing result OCR; two independent supports are required.
        if (dialogDark < 0.58f) return false;
        int supports = 0;
        if (dialogRightDark >= 0.50f) supports++;
        if (receiveNeutral >= 0.30f) supports++;
        if (adsGold >= 0.10f) supports++;
        return supports >= 2;
    }

    /**
     * Stricter continuity check used only AFTER OCR has already certified a real result.
     *
     * The historical wake-up gate is deliberately permissive so OCR is not starved. That
     * same permissiveness must not be used to decide whether the irreversible result modal
     * is still on screen: a dark gameplay scene plus a neutral control region can mimic two
     * of the coarse supports. The gold ADS button is part of the certified GTO result modal
     * itself, so persistence requires that modal-specific anchor plus one structural support.
     */
    static boolean isCertifiedResultStillVisible(
        float dialogDark,
        float dialogRightDark,
        float receiveNeutral,
        float adsGold
    ) {
        if (dialogDark < 0.58f || adsGold < 0.10f) return false;
        return dialogRightDark >= 0.48f || receiveNeutral >= 0.28f;
    }

    /**
     * HF55: high-confidence visual signature used only to recover from stale Android
     * foreground ownership after a call/app switch. Unlike the ordinary OCR wake-up
     * gate, this requires every modal-specific anchor because it is allowed to bridge a
     * stale third-party UsageStats owner. Semantic OCR (Concluído + payout) remains the
     * authority that certifies the delivery.
     */
    static boolean isStrongReturnResult(
        float dialogDark,
        float dialogRightDark,
        float receiveNeutral,
        float adsGold
    ) {
        return dialogDark >= 0.72f
            && dialogRightDark >= 0.62f
            && receiveNeutral >= 0.30f
            && adsGold >= 0.08f;
    }
}
