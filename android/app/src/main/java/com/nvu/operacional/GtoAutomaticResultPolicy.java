package com.nvu.operacional;

/**
 * HF49 terminal-result policy.
 *
 * A semantically certified GTO "Concluído + Valor a receber" screen is already proof
 * that the selected freight was executed. Receber is therefore not a completion gate.
 * The only reason to delay normal registration is an unresolved rewarded-ad branch.
 */
final class GtoAutomaticResultPolicy {
    private GtoAutomaticResultPolicy() {}

    static boolean mayLatchAutomaticCompletion(
        boolean certifiedResult,
        boolean watchedAdEvidence,
        boolean lockedFreightSnapshot,
        boolean adsGuardRequired,
        boolean adsGuardAttached,
        boolean adUiFresh,
        String action,
        long actionAgeMs,
        long adsActionHoldMs
    ) {
        if (!certifiedResult || watchedAdEvidence || !lockedFreightSnapshot) return false;
        if (adsGuardRequired && !adsGuardAttached) return false;
        if (adUiFresh) return false;
        if ("ADS".equals(action) && actionAgeMs < Math.max(0L, adsActionHoldMs)) return false;
        return true;
    }

    static boolean shouldKeepAdsGuard(
        boolean automaticCompletionLatched,
        boolean resultDialogStillVisible,
        boolean watchedAdEvidence
    ) {
        return automaticCompletionLatched && resultDialogStillVisible && !watchedAdEvidence;
    }
}
