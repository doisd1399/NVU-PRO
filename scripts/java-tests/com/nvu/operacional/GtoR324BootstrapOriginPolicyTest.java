package com.nvu.operacional;

public final class GtoR324BootstrapOriginPolicyTest {
    public static void main(String[] args) {
        require("simple".equals(GtoContractModePolicy.normalize(" SIMPLE ")), "simple mode normalization failed");
        require("detailed".equals(GtoContractModePolicy.normalize("Detailed")), "detailed mode normalization failed");
        require("".equals(GtoContractModePolicy.normalize(null)), "legacy/missing mode must remain unknown");
        require(!GtoContractModePolicy.requiresExactOrigin("simple"), "simple operation must allow unknown first origin");
        require(!GtoContractModePolicy.requiresExactOrigin(""), "legacy remote Web must not block first simple freight locally");
        require(GtoContractModePolicy.requiresExactOrigin("detailed"), "detailed operation must require exact origin");

        require(!GtoFreightBootstrapPolicy.shouldAwaitSecondListFrame("IDLE", 1, -1),
            "fresh IDLE fast tap must not wait for a second list frame");
        require(!GtoFreightBootstrapPolicy.shouldAwaitSecondListFrame("CANCELLED", 1, -1),
            "fresh CANCELLED fast tap must not wait for a second list frame");
        require(GtoFreightBootstrapPolicy.shouldAwaitSecondListFrame("TRIP_IN_PROGRESS", 1, -1),
            "active route replacement must remain conservative without exact row evidence");
        require(!GtoFreightBootstrapPolicy.shouldAwaitSecondListFrame("TRIP_IN_PROGRESS", 1, 2),
            "exact third-row press must be sufficient independent evidence during replacement");
        require(!GtoFreightBootstrapPolicy.shouldAwaitSecondListFrame("TRIP_IN_PROGRESS", 2, -1),
            "two stable list frames must permit active-route replacement correlation");

        System.out.println("GtoR324BootstrapOriginPolicyTest: PASS");
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
