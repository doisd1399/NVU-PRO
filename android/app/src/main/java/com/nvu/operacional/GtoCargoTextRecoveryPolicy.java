package com.nvu.operacional;

import java.util.List;
import java.util.Locale;

/**
 * Last automatic cargo-only recovery used on the immutable selected-row snapshot.
 * The crop is intentionally limited to the upper-left text band of the selected card;
 * therefore the policy never searches another row and never infers a cargo from a
 * dictionary. It only returns literal OCR text from that exact region.
 */
final class GtoCargoTextRecoveryPolicy {
    private GtoCargoTextRecoveryPolicy() {}

    static String bestLiteralCandidate(List<String> recognizedLines) {
        if (recognizedLines == null || recognizedLines.isEmpty()) return "";
        String best = "";
        float bestScore = -1f;
        for (int i = 0; i < recognizedLines.size(); i++) {
            String raw = recognizedLines.get(i);
            String value = sanitize(raw);
            if (!isCargoLike(value)) continue;
            float score = score(value, i);
            if (score > bestScore) {
                best = value;
                bestScore = score;
            }
        }
        return best;
    }

    static String sanitize(String raw) {
        String value = GtoFreightMixedLinePolicy.textualRemainder(raw);
        if (value == null) return "";
        value = value
            .replace('¦', ' ')
            .replace('|', ' ')
            .replaceAll("[\\p{Cntrl}]", " ")
            .replaceAll("\\s+", " ")
            .trim();
        value = value.replaceAll("^[^\\p{L}\\p{N}]+", "")
            .replaceAll("[^\\p{L}\\p{N}À-ÿ'&().-]+$", "")
            .trim();
        return value;
    }

    static boolean isCargoLike(String value) {
        if (value == null) return false;
        String v = value.trim();
        if (v.length() < 3 || v.length() > 80) return false;
        if (v.matches(".*[0-9$].*")) return false;
        String n = normalize(v);
        if (n.contains("aceitar") || n.equals("km") || n.equals("nvu")
            || n.equals("fps") || n.equals("voltar") || n.equals("operacao")
            || n.equals("origem") || n.equals("destino") || n.equals("valor")) return false;
        if (v.contains(">") || v.contains("→") || v.contains("›") || v.contains("»")) return false;
        int letters = 0;
        int useful = 0;
        for (int i = 0; i < v.length(); i++) {
            char c = v.charAt(i);
            if (Character.isLetter(c)) letters++;
            if (!Character.isWhitespace(c)) useful++;
        }
        return letters >= 3 && useful > 0 && letters / (float) useful >= 0.72f;
    }

    private static float score(String value, int index) {
        int letters = 0;
        for (int i = 0; i < value.length(); i++) if (Character.isLetter(value.charAt(i))) letters++;
        // Cargo is the first meaningful textual band in the crop. Prefer an early line,
        // then a descriptive multi-letter literal. No fuzzy correction is performed.
        return Math.min(40, letters) + Math.min(12, value.length()) * 0.10f - Math.min(8, index) * 0.35f;
    }

    private static String normalize(String value) {
        if (value == null) return "";
        String lower = value.toLowerCase(Locale.ROOT);
        return java.text.Normalizer.normalize(lower, java.text.Normalizer.Form.NFD)
            .replaceAll("\\p{M}+", "")
            .replaceAll("[^a-z0-9]+", " ")
            .trim();
    }
}
