package com.nvu.operacional;

public final class GtoHf42ResultProofPolicyTest {
    private static void require(boolean ok, String message) {
        if (!ok) throw new AssertionError(message);
    }

    public static void main(String[] args) {
        // Result proof: generic ADS UI is not proof that an ad was watched.
        require(!GtoResultCompletionPolicy.isWatchedAdEvidence("dobrar valor ads"), "ADS button must not reject");
        require(!GtoResultCompletionPolicy.isWatchedAdEvidence("concluido anuncio dobrar valor"), "delivery Concluido plus ad button must not reject");
        require(!GtoResultCompletionPolicy.isWatchedAdEvidence("assistir video"), "watch-video invitation must not reject");
        require(!GtoResultCompletionPolicy.isWatchedAdEvidence("skip ad 5"), "ad player UI must not reject");
        require(GtoResultCompletionPolicy.isWatchedAdEvidence("anuncio assistido concluido"), "watched ad must reject");
        require(GtoResultCompletionPolicy.isWatchedAdEvidence("recompensa recebida"), "reward granted must reject");
        require(GtoResultCompletionPolicy.isWatchedAdEvidence("valor dobrado"), "doubled payout must reject");
        require(GtoResultCompletionPolicy.isAdInProgressEvidence("skip ad 5"), "ad player UI should hold terminal inference");
        require(!GtoResultCompletionPolicy.isAdInProgressEvidence("concluido valor a receber"), "result itself is not ad UI");

        require(!GtoResultCompletionPolicy.mayDiscardUnresolvedResult(true), "certified result can never be discarded");
        require(GtoResultCompletionPolicy.mayDiscardUnresolvedResult(false), "uncertified candidate may be discarded");
        require(GtoResultCompletionPolicy.shouldSealAtCertifiedFreightBoundary(true, false), "new certified list seals previous certified delivery");
        require(!GtoResultCompletionPolicy.shouldSealAtCertifiedFreightBoundary(true, true), "watched ad blocks normal seal");

        require(!GtoResultCompletionPolicy.shouldInferReceiveFromCertifiedExit(
            "RESULT_DETECTED", true, false, "", false, false, Long.MAX_VALUE, 4, 2100L
        ), "no-touch normal inference must respect grace");
        require(GtoResultCompletionPolicy.shouldInferReceiveFromCertifiedExit(
            "RESULT_DETECTED", true, false, "", false, false, Long.MAX_VALUE, 4, 2300L
        ), "certified result exit without ad evidence should resolve normal");
        require(!GtoResultCompletionPolicy.shouldInferReceiveFromCertifiedExit(
            "RESULT_DETECTED", true, false, "", false, true, 0L, 12, 10000L
        ), "active ad UI must hold, not reject or auto-receive");
        require(!GtoResultCompletionPolicy.shouldInferReceiveFromCertifiedExit(
            "RESULT_DETECTED", true, false, "ADS", false, false, 3000L, 12, 20000L
        ), "exact ADS touch must not auto-receive during ad window");
        require(GtoResultCompletionPolicy.shouldInferReceiveFromCertifiedExit(
            "RESULT_DETECTED", true, false, "ADS", false, false, 5000L, 12, 46000L
        ), "ADS with no watched/reward evidence must eventually preserve normal delivery");
        require(!GtoResultCompletionPolicy.shouldInferReceiveFromCertifiedExit(
            "RESULT_DETECTED", true, false, "", true, false, Long.MAX_VALUE, 12, 60000L
        ), "positive watched-ad evidence blocks normal completion");

        // Operational readiness: the bubble is an interface, not proof of capture health.
        require(!GtoObserverOperationalPolicy.isReady(true, true, true, false, false, false), "bubble alone is not ready");
        require(!GtoObserverOperationalPolicy.isReady(true, true, true, true, true, false), "projection without analyzed frames is not ready");
        require(GtoObserverOperationalPolicy.isReady(true, true, true, true, true, true), "all observer layers make READY");
        require(GtoObserverOperationalPolicy.transportReady(true, true, true, true, true), "live transport must not depend on foreground");
        require(GtoObserverOperationalPolicy.shouldRepairBoundTransport(true, true, false, false), "bound transport must self-repair with stale foreground");
        require("TRANSPORT_READY".equals(GtoObserverOperationalPolicy.transportStatus(true, true, false, true, true, true)), "transport status must ignore foreground");
        require(GtoObserverOperationalPolicy.shouldArmInitialPermission(true, true, true, false, false, false, false, false), "missing grant must auto-arm permission");
        require(!GtoObserverOperationalPolicy.shouldArmInitialPermission(true, true, true, false, false, false, false, true), "explicit denial requires human Android consent");
        require(GtoObserverOperationalPolicy.shouldRepairBoundCapture(true, true, true, false, false), "bound unhealthy capture must self-repair");
        require("READY".equals(GtoObserverOperationalPolicy.status(true, true, true, false, true, true, true)), "READY status must match invariant");

        System.out.println("PASS HF42 certified-result + operational-readiness policy");
    }
}
