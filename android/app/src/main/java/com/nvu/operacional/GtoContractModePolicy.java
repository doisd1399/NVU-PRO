package com.nvu.operacional;

import java.util.Locale;

/**
 * Contract-mode compatibility policy shared by the native observer and durable sync.
 *
 * Older Netlify builds did not send contractMode to the native bridge. Empty/unknown
 * must therefore remain a compatibility state, never be silently rewritten to a
 * different business mode. The server remains authoritative and rejects a detailed
 * contract if its exact origin is missing.
 */
final class GtoContractModePolicy {
    private GtoContractModePolicy() {}

    static String normalize(String value) {
        String normalized = value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
        if ("simple".equals(normalized) || "detailed".equals(normalized)) return normalized;
        return "";
    }

    static boolean requiresExactOrigin(String value) {
        return "detailed".equals(normalize(value));
    }

    static boolean mayKeepOriginUnknown(String value) {
        return !requiresExactOrigin(value);
    }
}
