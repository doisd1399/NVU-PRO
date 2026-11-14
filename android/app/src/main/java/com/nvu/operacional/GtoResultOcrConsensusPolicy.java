package com.nvu.operacional;

import java.text.Normalizer;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Semantic latch for result-screen OCR. OCR is allowed to be incomplete on an
 * individual frame; multiple frames/crops are fused before the capture is handed
 * to the Web receipt policy. This class has no Android dependencies so it can be
 * regression-tested with plain JVM tests.
 */
final class GtoResultOcrConsensusPolicy {
    private GtoResultOcrConsensusPolicy() {}

    static boolean isSemanticallyComplete(String simulatorKey, String rawText) {
        String normalized = normalize(rawText);
        if (normalized.isEmpty()) return false;

        String compact = normalized.replace(" ", "");
        if ("global-truck".equals(simulatorKey)) {
            return compact.contains("CONCLUIDO")
                && compact.contains("VALORARECEBER")
                && hasAmountAfterAny(normalized, "VALOR A RECEBER");
        }
        if ("toe-3".equals(simulatorKey)) {
            return (compact.contains("RENDATOTAL") || compact.contains("GANHOS"))
                && hasAmountAfterAny(normalized, "RENDA TOTAL", "GANHOS");
        }
        if ("wtds".equals(simulatorKey) || "wbds".equals(simulatorKey)) {
            return compact.contains("GANHOS")
                && hasAmountAfterAny(normalized, "GANHOS DA VIAGEM", "TOTAL");
        }
        return false;
    }


    /**
     * Returns a canonical BRL/EUR amount candidate bound to the simulator's
     * earnings label. The candidate is returned as integer cents so different
     * OCR spellings cannot be mistaken for different values.
     */
    static Long extractAmountCents(String simulatorKey, String rawText) {
        String normalized = normalize(rawText);
        if (normalized.isEmpty()) return null;
        if ("toe-3".equals(simulatorKey)) return extractToe3AmountCents(normalized);
        String[] labels;
        if ("global-truck".equals(simulatorKey)) {
            labels = new String[]{"VALOR A RECEBER"};
        } else if ("toe-3".equals(simulatorKey)) {
            labels = new String[]{"RENDA TOTAL", "GANHOS"};
        } else {
            labels = new String[]{"GANHOS DA VIAGEM", "TOTAL"};
        }
        for (String label : labels) {
            int from = normalized.indexOf(label);
            while (from >= 0) {
                int end = Math.min(normalized.length(), from + label.length() + 100);
                String tail = normalized.substring(from + label.length(), end);
                java.util.regex.Matcher matcher = java.util.regex.Pattern
                    .compile("(?:R\\$|EUR|BRL|€|\\$)?\\s*([0-9]+(?:[.,][0-9]{3})*(?:[.,][0-9]{1,2})?)")
                    .matcher(tail);
                if (matcher.find()) {
                    Long cents = parseAmountCents(matcher.group(1));
                    // The result OCR layer must preserve a valid low-value payout;
                    // minimum-value policy belongs to the server/business validator.
                    // Rejecting it here made two independent agreeing regions fail
                    // before the canonical receipt/ACK flow could decide.
                    if (cents != null && cents > 0L) return cents;
                }
                from = normalized.indexOf(label, from + 1);
            }
        }
        return null;
    }


    private static final java.util.regex.Pattern TOE3_AMOUNT = java.util.regex.Pattern
        .compile("(R\\$|EUR|BRL|€|\\$)?\\s*([0-9]+(?:[.,][0-9]{3})*(?:[.,][0-9]{1,2})?)");
    private static final java.util.regex.Pattern TOE3_UNIT_AFTER = java.util.regex.Pattern
        .compile("^\\s*(?:%|KM\\b|L\\b|H\\b|M\\b|MIN\\b)");
    // Text that ends the "Renda total" value area: the other grid labels and the buttons.
    private static final String[] TOE3_WINDOW_END = {
        "PENA DE DANO", "PENALIDADE", "DISTANCIA", "TEMPO GASTO", "COMBUSTIVEL",
        "CONTINUAR", "REMOVER", "BONUS", "DOBRAR"
    };

    /**
     * TOE 3 result screen: a two-column grid whose right column is "Pena de dano",
     * "Penalidade de tempo" and "Renda total" (bottom row). OCR may return it row
     * by row ("Renda total € 3.503") or grouped by column (all labels, then all
     * values: "Renda total - € 202 - € 3.503"). Taking the first number after the
     * label read the damage penalty (€ 202) as the payout in the grouped layout, and
     * the "20%" of the bonus button when the value cell was not read.
     *
     * The payout is the LAST amount between the "Renda total" label and the next
     * grid label/button: it is the bottom row, so in a grouped read it comes after
     * the penalty values. Percentages and distance/time/fuel figures are ignored and
     * amounts with a currency sign win over bare numbers.
     */
    private static Long extractToe3AmountCents(String normalized) {
        for (boolean requireCurrency : new boolean[]{true, false}) {
            for (String label : new String[]{"RENDA TOTAL", "GANHOS"}) {
                int from = normalized.indexOf(label);
                while (from >= 0) {
                    int start = from + label.length();
                    int end = Math.min(normalized.length(), start + 100);
                    for (String stop : TOE3_WINDOW_END) {
                        int at = normalized.indexOf(stop, start);
                        if (at >= 0 && at < end) end = at;
                    }
                    String window = normalized.substring(start, end);
                    Long last = null;
                    java.util.regex.Matcher m = TOE3_AMOUNT.matcher(window);
                    while (m.find()) {
                        if (requireCurrency && m.group(1) == null) continue;
                        if (TOE3_UNIT_AFTER.matcher(window.substring(m.end())).find()) continue;
                        Long cents = parseAmountCents(m.group(2));
                        if (cents != null && cents > 0L) last = cents;
                    }
                    if (last != null) return last;
                    from = normalized.indexOf(label, from + 1);
                }
            }
        }
        return null;
    }

    /**
     * TOE 3 lays its result grid out on a 20:9 reference viewport (centered; the UI
     * scales with the screen height on wider screens and with the width on narrower
     * ones). Region fractions below are relative to that viewport and calibrated on
     * real result screens: the "Renda total" row (label + value cell) sits at about
     * x 0.50-0.70 / y 0.60-0.68, the white value cell at x 0.60-0.68.
     */
    private static final float TOE3_REFERENCE_ASPECT = 20f / 9f;
    private static final float[] TOE3_ROW = {0.50f, 0.598f, 0.20f, 0.084f};
    private static final float[] TOE3_VALUE_CELL = {0.585f, 0.598f, 0.115f, 0.084f};

    private static float[] toe3ToFrame(float[] region, int width, int height) {
        float aspect = width / (float) Math.max(1, height);
        float vx = 0f, vy = 0f, vw = 1f, vh = 1f;
        if (aspect > TOE3_REFERENCE_ASPECT) {
            vw = TOE3_REFERENCE_ASPECT / aspect;
            vx = (1f - vw) / 2f;
        } else if (aspect < TOE3_REFERENCE_ASPECT) {
            vh = aspect / TOE3_REFERENCE_ASPECT;
            vy = (1f - vh) / 2f;
        }
        return new float[]{vx + vw * region[0], vy + vh * region[1], vw * region[2], vh * region[3]};
    }

    /**
     * Normalized {left, top, width, height} of the dedicated monetary crop. The
     * default region (GTO/Global Truck "Valor a receber") ends at 61% of the
     * height, above the TOE 3 "Renda total" row (about 62-66%), so TOE 3 gets the
     * label + value row of its own grid.
     */
    static float[] amountRegion(String simulatorKey, int width, int height) {
        if ("toe-3".equals(simulatorKey)) return toe3ToFrame(TOE3_ROW, width, height);
        return new float[]{0.28f, 0.27f, 0.44f, 0.34f};
    }

    /**
     * Second dedicated crop. For TOE 3 it is only the white value cell (no label, no
     * neighbouring rows), the cleanest possible input for a single "€ 3.934" read;
     * the other simulators keep the same region at a different scale.
     */
    static float[] amountAltRegion(String simulatorKey, int width, int height) {
        if ("toe-3".equals(simulatorKey)) return toe3ToFrame(TOE3_VALUE_CELL, width, height);
        return amountRegion(simulatorKey, width, height);
    }

    private static final String[] TOE3_SCREEN_WORDS = {
        "RENDATOTAL", "GANHOS", "DISTANCIAACIONADA", "DISTANCIAALCANCADA", "TEMPOGASTO", "COMBUSTIVEL",
        "PENADEDANO", "PENALIDADEDETEMPO", "REMOVERPENALIDADES", "CONTINUAR"
    };

    /**
     * Result-screen evidence for TOE 3. The "Renda total" label alone used to be
     * required, but the stylized label can be misread while the rest of the grid and
     * the buttons are fine: two different grid/button words identify the screen.
     */
    static boolean isToe3ResultScreen(String rawText) {
        String compact = normalize(rawText).replace(" ", "");
        if (compact.contains("RENDATOTAL") || compact.contains("GANHOS")) return true;
        int hits = 0;
        for (String word : TOE3_SCREEN_WORDS) if (compact.contains(word)) hits++;
        return hits >= 2;
    }

    /**
     * Reads the white value cell crop: no label is available there, so the text must
     * hold exactly one amount ("€ 3.934", "3.934"); anything else is rejected.
     */
    static Long extractToe3CellAmountCents(String rawText) {
        String normalized = normalize(rawText);
        if (normalized.isEmpty()) return null;
        java.util.regex.Matcher m = TOE3_AMOUNT.matcher(normalized);
        Long found = null;
        int count = 0;
        while (m.find()) {
            Long cents = parseAmountCents(m.group(2));
            if (cents == null || cents <= 0L) continue;
            found = cents;
            count++;
        }
        return count == 1 ? found : null;
    }

    /** First available single reading, used to confirm the same value on the next frame. */
    static Long toe3BestCandidate(String rowText, String cellText, String modalText, String fullText) {
        Long[] reads = toe3Reads(rowText, cellText, modalText, fullText);
        for (int index : new int[]{1, 0, 2, 3}) if (reads[index] != null) return reads[index];
        return null;
    }

    private static Long[] toe3Reads(String rowText, String cellText, String modalText, String fullText) {
        return new Long[]{
            extractAmountCents("toe-3", rowText), extractToe3CellAmountCents(cellText),
            extractAmountCents("toe-3", modalText), extractAmountCents("toe-3", fullText)
        };
    }

    /**
     * TOE 3 payout: the same value must be confirmed by two INDEPENDENT sources. The
     * row crop and the value-cell crop share the very same pixels, so together they
     * count as one source (a glyph misread as 6 -> 8 would repeat in both); the other
     * sources are the modal crop, the full frame and the previous frame's reading.
     * Never a single source: a misread glyph must not become the payout.
     */
    static Long findToe3Amount(String rowText, String cellText, String modalText, String fullText, Long previousFrameAmount) {
        Long[] reads = toe3Reads(rowText, cellText, modalText, fullText);
        int[] groupOf = {0, 0, 1, 2};   // row/cell = 0, modal = 1, full = 2, previous frame = 3
        java.util.Map<Long, java.util.Set<Integer>> groups = new java.util.LinkedHashMap<>();
        for (int i = 0; i < reads.length; i++) {
            if (reads[i] == null) continue;
            groups.computeIfAbsent(reads[i], key -> new java.util.HashSet<>()).add(groupOf[i]);
        }
        if (previousFrameAmount != null && groups.containsKey(previousFrameAmount)) groups.get(previousFrameAmount).add(3);
        Long winner = null;
        for (java.util.Map.Entry<Long, java.util.Set<Integer>> entry : groups.entrySet()) {
            if (entry.getValue().size() < 2) continue;
            if (winner != null) return null;   // two different values both confirmed: no consensus
            winner = entry.getKey();
        }
        return winner;
    }

    /** Currency sign read next to the value (cell/row crops carry no label to bind it to). */
    static String toe3Currency(String... texts) {
        java.util.Set<String> currencies = new LinkedHashSet<>();
        if (texts != null) for (String text : texts) {
            String n = normalize(text);
            if (n.contains("€") || n.contains("EUR")) currencies.add("EUR");
            if (n.contains("R$") || n.contains("BRL")) currencies.add("BRL");
            if (n.contains("US$") || n.contains("USD")) currencies.add("USD");
        }
        return currencies.size() == 1 ? currencies.iterator().next() : "";
    }

    /**
     * A PRO result is accepted only when two independent OCR regions agree on
     * the same simulator earnings value. A single OCR hit is not sufficient:
     * HUD digits, buttons and anti-aliased game text can produce plausible but
     * wrong monetary candidates.
     */
    static Long findConsensusAmount(String simulatorKey, String... sources) {
        java.util.Map<Long, Integer> votes = new java.util.HashMap<>();
        if (sources == null) return null;
        for (String source : sources) {
            Long cents = extractAmountCents(simulatorKey, source);
            if (cents == null) continue;
            votes.put(cents, votes.getOrDefault(cents, 0) + 1);
        }
        Long winner = null;
        int winnerVotes = 0;
        int secondVotes = 0;
        for (java.util.Map.Entry<Long, Integer> entry : votes.entrySet()) {
            int count = entry.getValue();
            if (count > winnerVotes) {
                secondVotes = winnerVotes;
                winnerVotes = count;
                winner = entry.getKey();
            } else if (count > secondVotes) {
                secondVotes = count;
            }
        }
        return winnerVotes >= 2 && winnerVotes > secondVotes ? winner : null;
    }

    /**
     * Dedicated OCR is a candidate, not an authority. A single interpolated crop
     * can turn a 6 into an 8 while still producing a perfectly plausible amount.
     * Require the dedicated read to agree with at least one independent fallback
     * region before promoting it. If the dedicated crop is unavailable, fall back
     * to the normal multi-region consensus.
     */
    static Long findFastPathAmount(String simulatorKey, String dedicatedSource, String... fallbackSources) {
        Long dedicated = extractAmountCents(simulatorKey, dedicatedSource);
        if (dedicated == null) return findConsensusAmount(simulatorKey, fallbackSources);
        if (fallbackSources != null) {
            for (String fallback : fallbackSources) {
                Long candidate = extractAmountCents(simulatorKey, fallback);
                if (dedicated.equals(candidate)) return dedicated;
            }
        }
        return null;
    }

    /**
     * The Pro capture path runs two differently scaled nearest-neighbour amount
     * crops. Those scales share pixels, so a payout needs agreement with the
     * separate modal or full-frame reading before it becomes a saved receipt.
     */
    static Long findFastPathAmountPair(
        String simulatorKey,
        String firstDedicatedSource,
        String secondDedicatedSource,
        String... fallbackSources
    ) {
        Long first = extractAmountCents(simulatorKey, firstDedicatedSource);
        Long second = extractAmountCents(simulatorKey, secondDedicatedSource);
        // Two scales of the SAME crop can agree on the same mistaken glyph.
        // Require an independent modal/full-frame region to corroborate it.
        if (fallbackSources != null) {
            for (String fallback : fallbackSources) {
                Long candidate = extractAmountCents(simulatorKey, fallback);
                if (candidate == null) continue;
                if (candidate.equals(first) || candidate.equals(second)) return candidate;
            }
        }
        // Both independent regions may agree while the dedicated crop is
        // illegible. Never count two scales of one crop as two votes.
        return findConsensusAmount(simulatorKey, fallbackSources);
    }

    /**
     * OCR evidence is only a bonus block when it proves that the reward/ad was
     * actually consumed. A visible "Dobrar valor (ADS)" button alone is not
     * evidence and must remain compatible with the normal receipt path.
     */
    static boolean hasConfirmedRewardedBonus(String rawText) {
        if (rawText == null || rawText.trim().isEmpty()) return false;
        String normalized = Normalizer.normalize(rawText, Normalizer.Form.NFD)
            .replaceAll("\\p{InCombiningDiacriticalMarks}+", "")
            .toLowerCase(Locale.ROOT)
            .replaceAll("\\s+", " ")
            .trim();
        // A positive bonus amount on the result is payment evidence even when
        // OCR does not see a separate "ad watched" label. The untouched
        // "Dobrar valor (ADS)" offer has no bonus amount and stays allowed.
        java.util.regex.Matcher bonus = java.util.regex.Pattern
            .compile("bonus\\s+(?:video\\s+)?ads?\\s*[:=]?\\s*(?:r\\$|us\\$|eur|usd|€|\\$)?\\s*([0-9]+(?:[.,][0-9]{1,2})?)")
            .matcher(normalized);
        while (bonus.find()) {
            Long cents = parseAmountCents(bonus.group(1));
            if (cents != null && cents > 0L) return true;
        }
        return GtoResultCompletionPolicy.isWatchedAdEvidence(normalized);
    }

    static String formatAmountCents(long cents) {
        long integerPart = cents / 100L;
        long decimalPart = cents % 100L;
        String grouped = String.format(Locale.ROOT, "%,d", integerPart).replace(',', '.');
        return grouped + String.format(Locale.ROOT, ",%02d", decimalPart);
    }

    static String extractCurrency(String simulatorKey, String rawText) {
        String normalized = normalize(rawText);
        String[] labels = "global-truck".equals(simulatorKey) ? new String[]{"VALOR A RECEBER"}
            : "toe-3".equals(simulatorKey) ? new String[]{"RENDA TOTAL", "GANHOS"}
            : new String[]{"GANHOS DA VIAGEM", "TOTAL"};
        Set<String> currencies = new LinkedHashSet<>();
        Set<String> unsupportedCurrencies = new LinkedHashSet<>();
        boolean ambiguousOrUnsupported = false;
        for (String label : labels) {
            int index = normalized.indexOf(label);
            while (index >= 0) {
                String tail = normalized.substring(index + label.length(), Math.min(normalized.length(), index + label.length() + 160));
                java.util.regex.Matcher money = java.util.regex.Pattern
                    .compile("(?:R\\s*\\$|US\\s*\\$|BRL|EUR|USD|GBP|ARS|CLP|COP|MXN|UYU|PYG|CAD|AUD|NZD|JPY|CNY|CHF|INR|€|\\$)\\s*[0-9][0-9.,]*|[0-9][0-9.,]*\\s*(?:R\\s*\\$|US\\s*\\$|BRL|EUR|USD|GBP|ARS|CLP|COP|MXN|UYU|PYG|CAD|AUD|NZD|JPY|CNY|CHF|INR|€|\\$)").matcher(tail);
                while (money.find()) {
                    java.util.regex.Matcher tokenMatcher = java.util.regex.Pattern
                        .compile("R\\s*\\$|US\\s*\\$|BRL|EUR|USD|GBP|ARS|CLP|COP|MXN|UYU|PYG|CAD|AUD|NZD|JPY|CNY|CHF|INR|€|\\$").matcher(money.group());
                    if (!tokenMatcher.find()) continue;
                    String token = tokenMatcher.group().replaceAll("\\s+", "");
                    if ("R$".equals(token) || "BRL".equals(token)) currencies.add("BRL");
                    else if ("€".equals(token) || "EUR".equals(token)) currencies.add("EUR");
                    else if ("US$".equals(token) || "USD".equals(token)) currencies.add("USD");
                    else if ("$".equals(token)) ambiguousOrUnsupported = true;
                    else unsupportedCurrencies.add(token);
                }
                index = normalized.indexOf(label, index + 1);
            }
        }
        if (currencies.size() != 1 || ambiguousOrUnsupported || !unsupportedCurrencies.isEmpty()) return "";
        return currencies.iterator().next();
    }

    static Long parseAmountCents(String raw) {
        if (raw == null) return null;
        String cleaned = raw.trim();
        if (!cleaned.matches("[0-9][0-9.,]*")) return null;
        int separator = Math.max(cleaned.lastIndexOf(','), cleaned.lastIndexOf('.'));
        String fraction = separator < 0 ? "" : cleaned.substring(separator + 1);
        boolean decimal = fraction.length() == 1 || fraction.length() == 2;
        String integerPart = decimal ? cleaned.substring(0, separator) : cleaned;
        if (!integerPart.matches("[0-9]+|[0-9]{1,3}(?:\\.[0-9]{3})+|[0-9]{1,3}(?:,[0-9]{3})+")) return null;
        String decimals = decimal ? (fraction.length() == 1 ? fraction + "0" : fraction) : "00";
        integerPart = integerPart.replace(",", "").replace(".", "");
        try {
            long cents = Math.addExact(Math.multiplyExact(Long.parseLong(integerPart), 100L), Long.parseLong(decimals));
            return cents >= 0L && cents <= 1_000_000_000L ? cents : null;
        } catch (RuntimeException error) {
            return null;
        }
    }

    static String mergeEvidence(String current, String next) {
        Set<String> parts = new LinkedHashSet<>();
        addParts(parts, current);
        addParts(parts, next);
        StringBuilder merged = new StringBuilder();
        for (String part : parts) {
            if (merged.length() > 0) merged.append('\n');
            merged.append(part);
        }
        return merged.toString();
    }

    private static void addParts(Set<String> parts, String value) {
        if (value == null) return;
        for (String line : value.split("\\R")) {
            String trimmed = line.trim();
            if (!trimmed.isEmpty()) parts.add(trimmed);
        }
    }

    private static boolean hasAmountAfterAny(String normalized, String... labels) {
        for (String label : labels) {
            int from = normalized.indexOf(label);
            while (from >= 0) {
                int end = Math.min(normalized.length(), from + label.length() + 100);
                String tail = normalized.substring(from + label.length(), end);
                if (tail.matches(".*(?:R\\$|BRL|EUR|€|\\$)?\\s*[0-9]+(?:[.,][0-9]{3})*(?:[.,][0-9]{1,2})?.*")) {
                    return true;
                }
                from = normalized.indexOf(label, from + 1);
            }
        }
        return false;
    }

    static String normalize(String rawText) {
        return Normalizer.normalize(rawText == null ? "" : rawText, Normalizer.Form.NFD)
            .replaceAll("\\p{InCombiningDiacriticalMarks}+", "")
            .toUpperCase(Locale.ROOT)
            .replaceAll("\\s+", " ")
            .trim();
    }
}
