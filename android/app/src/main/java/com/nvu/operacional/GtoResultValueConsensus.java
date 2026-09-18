package com.nvu.operacional;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Small, dependency-free consensus latch for the final GTO amount.
 *
 * A single plausible OCR value is only a candidate. Two distinct OCR passes must
 * agree before the amount becomes immutable. Evidence is stored as integer cents,
 * so Brazilian thousands/decimal separators can never inflate a payout by 100x.
 */
final class GtoResultValueConsensus {
    static final int SCHEMA_VERSION = 2;
    private static final int MAX_EVIDENCE = 5;

    static final class Decision {
        final String evidence;
        final String stableValue;
        final int sampleCount;
        final boolean conflict;

        Decision(String evidence, String stableValue, int sampleCount, boolean conflict) {
            this.evidence = evidence == null ? "" : evidence;
            this.stableValue = stableValue == null ? "" : stableValue;
            this.sampleCount = sampleCount;
            this.conflict = conflict;
        }
    }

    private GtoResultValueConsensus() {}

    static Decision observe(String serialized, String sourceId, String rawValue, String alreadyStable) {
        String locked = canonical(alreadyStable);
        List<Sample> samples = parse(serialized);
        Long cents = GtoMoneyValue.parseCents(rawValue);
        String source = safeSource(sourceId);

        if (cents != null && GtoMoneyValue.isPlausibleCents(cents) && !containsSource(samples, source)) {
            samples.add(new Sample(source, cents));
            while (samples.size() > MAX_EVIDENCE) samples.remove(0);
        }

        if (!locked.isEmpty()) {
            Long lockedCents = GtoMoneyValue.parseCents(locked);
            return new Decision(serialize(samples), locked, samples.size(), hasDifferent(samples, lockedCents));
        }

        Map<Long, Integer> counts = new LinkedHashMap<>();
        for (Sample sample : samples) {
            counts.put(sample.cents, counts.getOrDefault(sample.cents, 0) + 1);
        }
        long best = 0L;
        int bestCount = 0;
        int secondCount = 0;
        for (Map.Entry<Long, Integer> entry : counts.entrySet()) {
            int count = entry.getValue();
            if (count > bestCount) {
                secondCount = bestCount;
                bestCount = count;
                best = entry.getKey();
            } else if (count > secondCount) {
                secondCount = count;
            }
        }
        boolean stable = bestCount >= 2 && bestCount > secondCount;
        boolean conflict = counts.size() > 1;
        return new Decision(
            serialize(samples),
            stable ? GtoMoneyValue.canonicalFromCents(best) : "",
            samples.size(),
            conflict
        );
    }

    static String canonical(String rawValue) {
        return GtoMoneyValue.canonical(rawValue);
    }

    private static boolean containsSource(List<Sample> samples, String source) {
        for (Sample sample : samples) if (sample.source.equals(source)) return true;
        return false;
    }

    private static boolean hasDifferent(List<Sample> samples, Long expected) {
        if (expected == null) return false;
        for (Sample sample : samples) if (sample.cents != expected.longValue()) return true;
        return false;
    }

    private static String safeSource(String source) {
        if (source == null || source.trim().isEmpty()) return "unknown";
        return source.replaceAll("[^A-Za-z0-9._:-]", "_");
    }

    private static List<Sample> parse(String serialized) {
        List<Sample> samples = new ArrayList<>();
        if (serialized == null || serialized.trim().isEmpty()) return samples;
        for (String token : serialized.split(",")) {
            int separator = token.indexOf('=');
            if (separator <= 0 || separator >= token.length() - 1) continue;
            String source = safeSource(token.substring(0, separator));
            String encoded = token.substring(separator + 1).trim();
            // Pre-R3.34 evidence had no unit metadata and is intentionally ignored.
            // It is semantically ambiguous because the old implementation flattened
            // cents and thousands separators into the same digit string.
            if (!encoded.startsWith("c")) continue;
            try {
                long cents = Long.parseLong(encoded.substring(1));
                if (!GtoMoneyValue.isPlausibleCents(cents) || containsSource(samples, source)) continue;
                samples.add(new Sample(source, cents));
            } catch (Exception ignored) {}
        }
        while (samples.size() > MAX_EVIDENCE) samples.remove(0);
        return samples;
    }

    private static String serialize(List<Sample> samples) {
        StringBuilder result = new StringBuilder();
        for (Sample sample : samples) {
            if (result.length() > 0) result.append(',');
            result.append(sample.source).append("=c").append(sample.cents);
        }
        return result.toString();
    }

    private static final class Sample {
        final String source;
        final long cents;

        Sample(String source, long cents) {
            this.source = source;
            this.cents = cents;
        }
    }
}
