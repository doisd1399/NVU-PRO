package com.nvu.operacional;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * HF68: conservative, OCR-only pause-screen gate.
 *
 * Opening the GTO pause menu is an explicit driver action. The policy still requires
 * multiple menu signals before the observer treats the full-frame OCR as a pause read,
 * preventing HUD words such as "menu" or "operação" from starting a trip by themselves.
 */
final class GtoPauseScreenDetectionPolicy {
    private GtoPauseScreenDetectionPolicy() {}

    static boolean isPauseScreen(List<String> lines) {
        if (lines == null || lines.isEmpty()) return false;
        boolean resumeAction = false;
        boolean settingsAction = false;
        boolean freightAction = false;
        boolean exitAction = false;
        boolean explicitPauseWord = false;
        for (String raw : lines) {
            String value = normalize(raw);
            if (value.isEmpty()) continue;
            // Use semantic menu categories rather than a fixed company/game label. The
            // reported GTO screen exposes resume, settings, freight and exit actions.
            resumeAction |= containsAny(value, "continuar", "retomar", "voltar ao jogo", "voltar para o jogo");
            settingsAction |= containsAny(value, "ajustes", "opcoes", "configuracoes", "controles", "config");
            freightAction |= containsAny(value, "cancelar frete", "cancelar viagem", "chamar guincho", "guincho");
            exitAction |= containsAny(value, "voltar ao menu", "sair para o menu", "sair do jogo", "menu principal");
            explicitPauseWord |= containsAny(value, "pause", "pausa");
        }
        int categories = 0;
        if (resumeAction) categories++;
        if (settingsAction) categories++;
        if (freightAction) categories++;
        if (exitAction) categories++;
        // Two independent categories are required so a HUD word or the NVU overlay
        // cannot start full-frame OCR by itself. An explicit pause word may pair with
        // one strong menu category on translations that expose fewer labels.
        return categories >= 2 || (explicitPauseWord && categories >= 1);
    }

    static boolean hasFreightFieldAnchor(List<String> lines) {
        if (lines == null || lines.isEmpty()) return false;
        int anchors = 0;
        for (String raw : lines) {
            String value = normalize(raw);
            if (value.isEmpty()) continue;
            if (startsWithField(value, "carga") || startsWithField(value, "mercadoria")) anchors++;
            else if (startsWithField(value, "origem")) anchors++;
            else if (startsWithField(value, "destino")) anchors++;
        }
        return anchors > 0;
    }

    private static boolean startsWithField(String value, String field) {
        return value.equals(field) || value.startsWith(field + " ") || value.startsWith(field + ":");
    }

    static String valueAfterLabel(String raw, String... labels) {
        if (raw == null) return "";
        String original = raw.trim();
        if (original.isEmpty()) return "";
        String lowerOriginal = original.toLowerCase(Locale.ROOT);
        for (String label : labels) {
            String target = normalize(label);
            if (target.isEmpty()) continue;

            // Preserve the raw remainder first. Route fields depend on the final
            // Empresa -> Local separator (hyphen, en dash or em dash); extracting
            // from the normalized string would erase that evidence and turn a
            // valid line such as "Origem: Cooper Log – Cruz do Oeste" into
            // "cooper log cruz do oeste", which the safe location parser must
            // correctly reject as ambiguous.
            String lowerLabel = label == null ? "" : label.trim().toLowerCase(Locale.ROOT);
            if (!lowerLabel.isEmpty()) {
                int rawIndex = lowerOriginal.indexOf(lowerLabel);
                if (rawIndex >= 0) {
                    String remainder = original.substring(Math.min(original.length(), rawIndex + lowerLabel.length())).trim();
                    remainder = remainder.replaceFirst("^[\\s:：|]+", "").trim();
                    if (!remainder.isEmpty()) return remainder;
                    return "";
                }
            }

            // Never derive a registered field from the normalized detection string.
            // Normalization is only for locating labels; if the raw label is not found,
            // return pending so accents, case, punctuation and literal OCR are preserved.
        }
        return "";
    }

    static boolean isLabelOnly(String raw, String... labels) {
        if (raw == null) return false;
        String normalized = normalize(raw);
        for (String label : labels) {
            if (normalized.equals(normalize(label))) return true;
        }
        return false;
    }

    static boolean isMenuNoise(String raw) {
        String value = normalize(raw);
        return value.isEmpty()
            || value.equals("menu")
            || value.equals("pause")
            || value.equals("pausa")
            || value.equals("continuar")
            || value.equals("retomar")
            || value.equals("opcoes")
            || value.equals("configuracoes")
            || value.equals("controles")
            || value.equals("sair")
            || value.equals("voltar")
            || value.equals("nvu");
    }

    static String normalize(String raw) {
        if (raw == null) return "";
        String value = Normalizer.normalize(raw, Normalizer.Form.NFD)
            .replaceAll("\\p{M}+", "")
            .toLowerCase(Locale.ROOT)
            .replaceAll("[^a-z0-9]+", " ")
            .trim();
        return value.replaceAll("\\s+", " ");
    }

    static boolean containsAny(String value, String... tokens) {
        if (value == null || value.isEmpty()) return false;
        for (String token : tokens) {
            if (value.contains(normalize(token))) return true;
        }
        return false;
    }

    static List<String> nonEmpty(List<String> lines) {
        List<String> result = new ArrayList<>();
        if (lines == null) return result;
        for (String line : lines) {
            if (line != null && !line.trim().isEmpty()) result.add(line.trim());
        }
        return result;
    }
}
