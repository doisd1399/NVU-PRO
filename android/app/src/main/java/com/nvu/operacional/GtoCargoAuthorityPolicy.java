package com.nvu.operacional;


/**
 * HF163: source-bound authority for Cargo. This class never corrects spelling by
 * dictionary, fuzzy matching or character substitution.
 */
final class GtoCargoAuthorityPolicy {
    static final class Resolution {
        final String value;
        final boolean accepted;
        final boolean conflict;
        final String source;

        Resolution(String value, boolean accepted, boolean conflict, String source) {
            this.value = clean(value);
            this.accepted = accepted;
            this.conflict = conflict;
            this.source = source == null ? "" : source;
        }
    }

    private GtoCargoAuthorityPolicy() {}

    /**
     * A completed same-row List value is authoritative during Pause recovery. A
     * divergent Pause OCR literal is diagnostic only and cannot overwrite it. If
     * no such List authority exists, Pause requires two identical literal reads.
     */
    static Resolution resolvePauseCargo(
        String trustedListCargo,
        boolean trustedListEvidence,
        String pauseCargo,
        int pauseReads
    ) {
        String list = clean(trustedListCargo);
        String pause = clean(pauseCargo);
        boolean listValid = valid(list);
        boolean pauseValid = valid(pause);

        if (trustedListEvidence && listValid) {
            if (!pauseValid || sameLiteral(list, pause)) {
                return new Resolution(list, true, false, "LIST_SAME_ROW");
            }
            return new Resolution(list, true, true, "LIST_SAME_ROW_PRESERVED_OVER_PAUSE_OCR");
        }
        if (pauseValid && pauseReads >= 2) {
            return new Resolution(pause, true, false, "PAUSE_TWO_LITERAL_READS");
        }
        // A pending candidate is diagnostic only. Never return it as an operational
        // value, otherwise a caller can accidentally render or persist an unconfirmed
        // OCR token such as Sojo.
        return new Resolution("", false, false, "PAUSE_PENDING");
    }

    static boolean sameLiteral(String first, String second) {
        return GtoFreightTextGuard.sameLiteralText(first, second);
    }

    static boolean valid(String value) {
        if (value == null) return false;
        String v = clean(value);
        if (v.length() < 2 || v.length() > 220) return false;
        int letters = 0;
        for (int i = 0; i < v.length(); i++) {
            if (Character.isLetter(v.charAt(i))) letters++;
        }
        return letters >= 2;
    }

    private static String clean(String value) {
        return value == null ? "" : value.replaceAll("\\s+", " ").trim();
    }

}
