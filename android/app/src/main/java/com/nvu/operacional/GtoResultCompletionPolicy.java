package com.nvu.operacional;

/**
 * HF42 canonical result policy.
 *
 * A semantically certified GTO result (Concluido + valid monetary value) is durable proof
 * that the delivery happened. From that point the delivery may only be rejected by
 * positive evidence that an advertisement/reward was actually consumed/completed.
 * Generic ad words, the presence of an ad button, a loading screen or a missing touch
 * callback are never rejection evidence.
 */
final class GtoResultCompletionPolicy {
    static final int PASSIVE_EXIT_MIN_ABSENT_FRAMES = 4;
    static final long PASSIVE_EXIT_GRACE_MS = 2200L;
    static final long ADS_ACTION_MAX_HOLD_MS = 45_000L;
    static final long AD_UI_CLEAR_GRACE_MS = 1_800L;

    private GtoResultCompletionPolicy() {}

    static boolean isWatchedAdEvidence(String normalized) {
        if (normalized == null) return false;
        String n = normalized.trim();
        if (n.isEmpty()) return false;

        // Require a terminal verb to be attached to the ad/video concept. Never combine
        // unrelated words from different parts of the result dialog (for example the
        // delivery title "Concluído" plus the untouched "ADS" button).
        if (n.contains("anuncio assistido") || n.contains("anuncio concluido")
            || n.contains("anuncio finalizado") || n.contains("video assistido")
            || n.contains("video concluido") || n.contains("video finalizado")
            || n.contains("ad watched") || n.contains("ad completed")
            || n.contains("ad finished") || n.contains("advertisement watched")
            || n.contains("advertisement completed") || n.contains("rewarded ad completed")) {
            return true;
        }

        boolean reward = n.contains("recompensa") || n.contains("bonus")
            || n.contains("bonificacao") || n.contains("reward");
        boolean granted = n.contains("recebida") || n.contains("recebido")
            || n.contains("creditada") || n.contains("creditado")
            || n.contains("aplicada") || n.contains("aplicado")
            || n.contains("concedida") || n.contains("concedido")
            || n.contains("granted") || n.contains("received");
        if (reward && granted) return true;

        return n.contains("valor dobrado") || n.contains("valor foi dobrado")
            || n.contains("ganho dobrado") || n.contains("ganhos dobrados")
            || n.contains("rewarded ad completed");
    }


    /**
     * Non-terminal ad UI evidence. This never rejects a trip: it only prevents the
     * observer from prematurely interpreting a missing touch callback as Receber while
     * an advertisement may still be running.
     */
    static boolean isAdInProgressEvidence(String normalized) {
        if (normalized == null) return false;
        String n = normalized.trim();
        if (n.isEmpty()) return false;
        if (isWatchedAdEvidence(n)) return false;
        return n.contains("skip ad") || n.contains("skip video")
            || n.contains("pular anuncio") || n.contains("pular video")
            || n.contains("fechar anuncio") || n.contains("advertisement")
            || n.contains("anuncio") || n.contains("rewarded ad")
            || n.contains("assistir video") || n.contains("watch video")
            || n.contains("video ad");
    }

    static boolean mayRejectCertifiedResult(boolean certifiedResult, boolean watchedAdEvidence) {
        return certifiedResult && watchedAdEvidence;
    }

    static boolean shouldInferReceiveFromCertifiedExit(
        String state,
        boolean certifiedResult,
        boolean receiveLatched,
        String action,
        boolean watchedAdEvidence,
        boolean adInProgressEvidence,
        long adUiLastSeenAgeMs,
        int visuallyAbsentFrames,
        long resultExitAgeMs
    ) {
        boolean resultState = "RESULT_DETECTED".equals(state)
            || "AWAITING_BONUS_VALIDATION".equals(state)
            || "CONFIRMING_FREIGHT".equals(state);
        if (!resultState || !certifiedResult || receiveLatched || watchedAdEvidence) return false;
        if (adInProgressEvidence) return false;
        if (adUiLastSeenAgeMs >= 0L && adUiLastSeenAgeMs < AD_UI_CLEAR_GRACE_MS) return false;
        if (visuallyAbsentFrames < PASSIVE_EXIT_MIN_ABSENT_FRAMES) return false;
        // If an exact ADS touch was observed, do not guess while a normal rewarded-ad
        // window can still be running. If no positive watched/reward evidence ever
        // appears, the certified delivery is accepted after the bounded hold because
        // the result itself remains proof of execution.
        if ("ADS".equals(action)) return resultExitAgeMs >= ADS_ACTION_MAX_HOLD_MS;
        return resultExitAgeMs >= PASSIVE_EXIT_GRACE_MS;
    }

    static boolean shouldSealAtCertifiedFreightBoundary(
        boolean certifiedResult,
        boolean watchedAdEvidence
    ) {
        return certifiedResult && !watchedAdEvidence;
    }

    static boolean mayDiscardUnresolvedResult(boolean certifiedResult) {
        return !certifiedResult;
    }
}
