package com.nvu.operacional;

import java.util.regex.Pattern;

/**
 * Preserves textual freight fields when ML Kit groups text and numeric/action tokens
 * into one visual line (for example "Tijolos Maciços 600Km").
 *
 * The GTO cards deliberately place cargo beside distance and route beside value. On some
 * devices ML Kit emits those horizontally aligned regions as a single Text.Line. Dropping
 * the whole line because it contains Km/R$ erases valid cargo/route text. This policy
 * removes only the operational tokens and returns the literal textual remainder.
 */
final class GtoFreightMixedLinePolicy {
    private static final Pattern KM_TOKEN = Pattern.compile(
        "(?iu)(?<!\\p{L})[0-9OIl][0-9OIl.,]*\\s*[kK]\\s*[mM](?!\\p{L})"
    );
    private static final Pattern MONEY_TOKEN = Pattern.compile(
        "(?iu)(?<!\\p{L})[rR]\\s*[$sS]\\s*[0-9OIl][0-9OIl.,]*(?!\\p{L})"
    );
    private static final Pattern ACCEPT_TOKEN = Pattern.compile("(?iu)\\baceitar\\b");

    private GtoFreightMixedLinePolicy() {}

    static String textualRemainder(String value) {
        if (value == null || value.trim().isEmpty()) return "";
        String result = MONEY_TOKEN.matcher(value).replaceAll(" ");
        result = KM_TOKEN.matcher(result).replaceAll(" ");
        result = ACCEPT_TOKEN.matcher(result).replaceAll(" ");
        result = result.replaceAll("\\s+", " ").trim();
        // Clean only punctuation that can be left at the edges after token removal.
        // Keep internal route separators such as '>' / '→' for the existing route parser.
        result = result.replaceAll("^[\\s:;,\\-]+", "")
            .replaceAll("[\\s:;,\\-]+$", "")
            .trim();
        return result;
    }
}
