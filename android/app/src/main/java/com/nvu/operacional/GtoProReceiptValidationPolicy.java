package com.nvu.operacional;

import java.text.Normalizer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Mirrors registerGtoProReceipt's input contract without altering stored OCR.
 * Currency is evidence, never a mandatory input or a simulator-derived guess. */
final class GtoProReceiptValidationPolicy {
    private GtoProReceiptValidationPolicy() {}

    static String validate(String jobId, String companyId, String contractId, String attemptId,
        String epoch, String origin, String destination, String text, int cents, String bonus, String previousTripId) {
        for (String id : new String[]{jobId, companyId, contractId, attemptId}) {
            if (id == null || !id.matches("[A-Za-z0-9_-]{8,180}")) return "GTO_CONTEXT_INVALID";
        }
        if (epoch == null || !epoch.matches("[A-Za-z0-9_:-]{8,180}")) return "GTO_CONTEXT_INVALID";
        if (origin == null || destination == null || origin.trim().isEmpty() || destination.trim().isEmpty()
            || origin.trim().equalsIgnoreCase(destination.trim()) || origin.length() > 180 || destination.length() > 180)
            return "GTO_ROUTE_INVALID";
        if (text == null || text.isEmpty() || text.length() > 5000) return "GTO_RECEIPT_INVALID";
        Long amount = readAmountCents(text);
        if (cents <= 0 || cents > 1_000_000_000 || amount == null || amount != cents) return "GTO_AMOUNT_INVALID";
        if (!("NONE".equals(bonus) || "ZERO_LABEL".equals(bonus) || "OFFER_ONLY".equals(bonus))) return "GTO_BONUS_INVALID";
        if (previousTripId != null && !previousTripId.isEmpty()
            && (previousTripId.length() > 180 || !previousTripId.matches("[A-Za-z0-9_-]+")
                || (!previousTripId.startsWith("nvu_" + jobId + "_") && !previousTripId.startsWith("simple_"))))
            return "GTO_PREVIOUS_TRIP_INVALID";
        return "";
    }

    static Long readAmountCents(String raw) {
        String text = Normalizer.normalize(raw.toUpperCase(java.util.Locale.ROOT), Normalizer.Form.NFD)
            .replaceAll("\\p{M}+", "");
        if (Pattern.compile("(?:VALOR\\s+(?:DOBRADO|DUPLICADO)|ANUNCIO\\s+ASSISTIDO|BONUS\\s+(?:APLICADO|RECEBIDO))").matcher(text).find()) return null;
        Matcher bonus = Pattern.compile("BONUS\\s+(?:VIDEO\\s+)?ADS\\s*:?\\s*(?:R\\$\\s*)?([0-9][0-9.,]*)").matcher(text);
        while (bonus.find()) {
            try {
                if (Double.parseDouble(bonus.group(1).replace(".", "").replace(',', '.')) > 0) return null;
            } catch (NumberFormatException ignored) { /* same as server's NaN */ }
        }
        Matcher payouts = Pattern.compile("VALOR\\s+A\\s+RECEBER[^0-9]{0,60}([0-9][0-9.,]*)").matcher(text);
        Long result = null;
        while (payouts.find()) {
            Long value = GtoResultOcrConsensusPolicy.parseAmountCents(payouts.group(1));
            if (value == null || value <= 0 || result != null && !result.equals(value)) return null;
            result = value;
        }
        return result;
    }
}
