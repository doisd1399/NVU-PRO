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
            .compile("bonus\\s+(?:video\\s+)?ads?\\s*[:=]?\\s*(?:r\\$\\s*)?([0-9]+(?:[.,][0-9]{1,2})?)")
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
