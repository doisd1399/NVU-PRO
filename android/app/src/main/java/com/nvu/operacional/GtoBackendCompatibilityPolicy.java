package com.nvu.operacional;

import java.util.Map;

/** Checks the server's actual capability response, never a local constant. */
final class GtoBackendCompatibilityPolicy {
    static final String VERSION = "gto-contract-v2";
    private GtoBackendCompatibilityPolicy() {}

    static boolean isCompatible(Object response) {
        if (!(response instanceof Map)) return false;
        Map<?, ?> value = (Map<?, ?>) response;
        return Boolean.TRUE.equals(value.get("compatible"))
            && "registerGtoProReceipt".equals(value.get("callable"))
            && VERSION.equals(value.get("contractVersion"))
            && Boolean.TRUE.equals(value.get("allowsUnknownCurrency"));
    }
}
