package com.nvu.operacional;

import java.util.LinkedHashMap;
import java.util.Map;

/** The pending/confirmed toast and history share the same read-only evidence policy. */
final class ProTripMoneyPresentation {
    private ProTripMoneyPresentation() {}

    static String format(long amountCents, String receiptCurrency, String simulatorKey, String receiptText) {
        Map<String, Object> money = new LinkedHashMap<>();
        money.put("receiptCurrency", receiptCurrency);
        money.put("simulatorKey", simulatorKey);
        money.put("receiptText", receiptText);
        // Recover presentation from the preserved evidence without rewriting
        // the immutable receipt snapshot or its idempotency fingerprint.
        return ProHistoryMoney.format(amountCents, ProHistoryMoney.resolve(money));
    }
}
