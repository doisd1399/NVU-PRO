package com.nvu.operacional;

public final class GtoHf24ResilienceProbe {
    public static void main(String[] args) {
        testFrozenSelectedRowFallback();
        testProjectionReauthorizationPolicy();
        testBubbleRemovePolicy();
        System.out.println("GtoHf24ResilienceProbe: PASS");
    }

    private static void testFrozenSelectedRowFallback() {
        String[][] freights = new String[][] {
            {"Dobradicas", "Metalurgica", "Itapetuna", "300Km", "R$ 5.300"},
            {"Soja", "Agro Vale", "Area Rural", "1100Km", "R$ 18.900"},
            {"Carga Tijolo", "Fabrica de Tijolo", "Cruz do Oeste", "600Km", "R$ 12.200"},
            {"Madeira", "Serraria Uniao", "Lauro Muller", "730Km", "R$ 15.200"},
            {"Milho", "Fazenda Horizonte", "Lages", "510Km", "R$ 6.900"}
        };
        for (int i = 0; i < freights.length; i++) {
            String[] f = freights[i];
            require(GtoFrozenFreightFallbackPolicy.canUse(GtoFreightReviewPolicy.CARGO, f[0]), "cargo " + i);
            require(GtoFrozenFreightFallbackPolicy.canUse(GtoFreightReviewPolicy.ORIGIN_COMPANY, f[1]), "origin " + i);
            require(GtoFrozenFreightFallbackPolicy.canUse(GtoFreightReviewPolicy.DESTINATION, f[2]), "destination " + i);
            require(GtoFrozenFreightFallbackPolicy.canUse(GtoFreightReviewPolicy.DISTANCE, f[3]), "distance " + i);
            require(GtoFrozenFreightFallbackPolicy.canUse(GtoFreightReviewPolicy.VALUE, f[4]), "value " + i);
            require(GtoFreightReviewPolicy.firstRequiredField(f[0], f[1], "", f[2], f[3], f[4]).isEmpty(),
                "destinationCompany must never be required " + i);
        }
        require(!GtoFrozenFreightFallbackPolicy.canUse(GtoFreightReviewPolicy.DESTINATION, ""), "empty destination stays pending");
    }

    private static void testProjectionReauthorizationPolicy() {
        long now = 20_000L;
        require(GtoProjectionRecoveryPolicy.shouldAutoRequest(
            true, true, true, true, true, true, true,
            false, false, false, now, 0L, 12_000L),
            "system capture loss should automatically request a fresh grant");
        require(!GtoProjectionRecoveryPolicy.shouldAutoRequest(
            true, false, true, true, true, true, true,
            false, false, false, now, 0L, 12_000L),
            "explicit denial suppresses automatic consent loop");
        require(GtoProjectionRecoveryPolicy.shouldEscalateSurfaceRecovery(
            3, true, true, false, 20_000L, 4_000L, 4_000L, 2_000L, 4_200L),
            "three failed surface recoveries should escalate to a fresh grant");
        require(!GtoProjectionRecoveryPolicy.shouldEscalateSurfaceRecovery(
            2, true, true, false, 20_000L, 4_000L, 4_000L, 2_000L, 4_200L),
            "two recoveries remain surface-only");
    }

    private static void testBubbleRemovePolicy() {
        require(GtoBubbleDismissPolicy.shouldShowRemoveTarget(false, true, true, true, false), "first drag shows target outside GTO");
        require(GtoBubbleDismissPolicy.shouldShowRemoveTarget(true, true, true, false, false), "first drag shows target inside GTO");
        require(!GtoBubbleDismissPolicy.shouldShowRemoveTarget(true, false, true, false, false), "no movement does not show target");
        require(!GtoBubbleDismissPolicy.shouldShowRemoveTarget(false, false, true, true, false), "no movement outside GTO does not show target");
        require(GtoBubbleDismissPolicy.shouldShowRemoveTarget(true, true, true, false, true), "long-press state remains backward-compatible");
        require(GtoBubbleDismissPolicy.canCommitStop(
            true, true, true, false, false, true, true, true, true, true,
            10_000L, 1_000L, 9_900L, 20_000L, 500L
        ), "valid in-GTO drag/drop commits stop without long press");
        require(GtoBubbleDismissPolicy.canCommitStop(
            false, true, true, true, false, true, true, true, true, true,
            10_000L, 1_000L, 9_900L, 20_000L, 500L
        ), "valid outside-GTO drag/drop commits stop without long press");
        require(!GtoBubbleDismissPolicy.canCommitStop(
            true, true, false, false, false, true, true, true, true, true,
            10_000L, 1_000L, 9_900L, 20_000L, 500L
        ), "no drag never commits stop");
        require(GtoBubbleDismissPolicy.isDropInside(100, 100, 70, 56, 80, 80, 180, 80), "bubble centre inside remove target");
        require(!GtoBubbleDismissPolicy.isDropInside(400, 100, 70, 56, 80, 80, 180, 80), "far bubble does not stop observer");
    }

    private static void require(boolean ok, String message) {
        if (!ok) throw new AssertionError(message);
    }
}
