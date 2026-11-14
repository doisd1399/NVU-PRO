package com.nvu.operacional;

import java.util.Locale;

/** Server ACKs must describe the same immutable captured receipt. */
final class ProReceiptEvidencePolicy {
    private ProReceiptEvidencePolicy() {}

    static boolean matches(long savedCents, String savedOrigin, String savedDestination,
            String savedSimulator, long serverCents, String serverOrigin,
            String serverDestination, String serverSimulator) {
        return savedCents > 0L && savedCents == serverCents
            && normalized(savedOrigin).equals(normalized(serverOrigin))
            && normalized(savedDestination).equals(normalized(serverDestination))
            && normalized(savedSimulator).equals(normalized(serverSimulator));
    }

    private static String normalized(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }
}
