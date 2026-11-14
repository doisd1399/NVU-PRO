package com.nvu.operacional;

import java.util.LinkedHashMap;
import java.util.Arrays;
import java.util.Map;
import java.util.Objects;

public final class ProHistoryMoneyRegressionTest {
    private static int checks;

    public static void main(String[] args) {
        long[] cents = {1338000L, 3774000L, 2491700L, 575000L, 948400L};
        String[] values = {"13.380,00", "37.740,00", "24.917,00", "5.750,00", "9.484,00"};
        for (int i = 0; i < cents.length; i++) {
            Map<String, Object> raw = trip("simulatorCode", "GTO", "valorCents", cents[i]);
            Map<String, Object> before = new LinkedHashMap<>(raw);
            Map<String, Object> projected = ProHistoryAdapterHarness.project(raw);
            equal(projected.get("currency"), "BRL");
            equal(projected.get("currencyStatus"), "known");
            equal(projected.get("currencySource"), "SIMULATOR_REGISTRY");
            equal(projected.get("amountCents"), cents[i]);
            equal(ProHistoryAdapterHarness.render(projected), "R$ " + values[i]);
            equal(raw, before);
        }
        for (String field : new String[]{"currency", "moeda", "simpleReceiptCurrency", "moneyCurrency", "receiptCurrency"}) {
            Map<String, Object> row = ProHistoryAdapterHarness.project(trip(field, "EUR", "valorCents", 530050L));
            equal(ProHistoryAdapterHarness.render(row), "€ 5.300,50");
        }
        display("R$ 0,01", map("currency", " r$ ", "amountCents", 1L));
        display("US$ 10,50", map("currency", "US$", "amountCents", 1050L));
        display("-R$ 10,50", map("currency", "BRL", "amountCents", -1050L));
        display("GBP 10,50", map("currency", "GBP", "amountCents", 1050L));

        // Cached rows are rendered locally without depending on a Firestore refresh.
        display("R$ 13.380,00", map("simulatorKey", "global-truck", "amountCents", 1338000L));
        display("R$ 13.380,00", map("simulatorKey", "world-truck", "amountCents", 1338000L));
        display("R$ 13.380,00", map("simulatorKey", "world-bus", "amountCents", 1338000L));
        display("€ 13.380,00", map("simulatorKey", "toe-3", "amountCents", 1338000L));
        for (Map<String, Object> unknown : Arrays.asList(
            map("amountCents", 1338000L), map("currency", "UNKNOWN", "amountCents", 1338000L),
            map("currency", "$", "amountCents", 1338000L), map("currency", "ZZZ", "amountCents", 1338000L),
            map("simulatorCode", "GTO-copy", "amountCents", 1338000L)
        )) display("13.380,00", unknown);

        display("€ 13.380,00", map("receiptText", "GANHOS: € 13.380,00", "amountCents", 1338000L));
        display("R$ 13.380,00", map("simulatorCode", "GTO", "receiptText", "Valor a receber: $ 13.380,00", "amountCents", 1338000L));

        conflict(map("currency", "BRL", "moeda", "EUR"));
        conflict(map("currency", "EUR", "simulatorCode", "GTO"));
        conflict(map("currency", "CAD", "simulatorCode", "GTO"));
        conflict(map("simulatorCode", "GTO", "simulatorId", "WTDS"));
        conflict(map("currency", "UNKNOWN", "currencySource", "EXPLICIT_SIMULATOR_CONFLICT"));
        conflict(map("currency", "BRL", "currencyStatus", "conflict"));
        conflict(map("simulatorCode", "GTO", "receiptText", "Valor a receber: EUR 13.380,00"));
        conflict(map("currency", "BRL", "receiptText", "Ganhos: EUR 13.380,00"));
        conflict(map("receiptText", "Ganhos: R$ 13.380,00 EUR 13.380,00"));
        conflict(map("simulatorCode", "GTO", "currencyEvidenceVersion", 1L,
            "currencyEvidenceStatus", "known", "currencyEvidenceSource", "server_receipt_text_explicit",
            "serverValidatedAt", "2026-10-08T00:00:00Z"));
        conflict(map("simulatorCode", "GTO", "currencyEvidenceVersion", 1L,
            "currencyEvidenceStatus", "conflict", "currencyEvidenceSource", "server_receipt_or_client_alias_conflict",
            "serverValidatedAt", "2026-10-08T00:00:00Z"));

        equal(ProHistoryAdapterHarness.project(trip("companyId", "other")), null);
        equal(ProHistoryAdapterHarness.project(trip("driverId", "other")), null);
        equal(ProHistoryAdapterHarness.project(trip("jobId", "other")), null);
        equal(ProHistoryAdapterHarness.project(trip("deleted", true)), null);
        equal(ProHistoryAdapterHarness.project(trip("status", "cancelled")), null);
        equal(ProHistoryAdapterHarness.project(trip("status", "pending")), null);
        Map<String, Object> explicit = ProHistoryAdapterHarness.project(trip("currency", "BRL"));
        equal(explicit.get("tripId"), "trip-1");
        equal(explicit.get("origin"), "Nova Macaé");
        equal(explicit.get("destination"), "Registro");
        equal(explicit.get("completedAt"), 1791492000000L);
        equal(explicit.get("pendingSync"), false);
        System.out.println("PASS: " + checks + " Pro history money and actual adapter assertions");
    }

    private static void conflict(Map<String, Object> row) {
        row.put("amountCents", 1338000L);
        equal(ProHistoryMoney.resolve(row).status, "conflict");
        display("13.380,00 · moedas conflitantes", row);
    }

    private static void display(String expected, Map<String, Object> row) {
        equal(ProHistoryAdapterHarness.render(row), expected);
    }

    private static Map<String, Object> trip(Object... pairs) {
        Map<String, Object> row = map("tripId", "trip-1", "jobId", "job-1", "companyId", "company-1",
            "driverId", "driver-1", "status", "completed", "origem", "Nova Macaé", "destino", "Registro",
            "valorCents", 1338000L, "completedAt", 1791492000000L);
        row.putAll(map(pairs));
        return row;
    }

    private static Map<String, Object> map(Object... pairs) {
        Map<String, Object> row = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) row.put((String) pairs[i], pairs[i + 1]);
        return row;
    }

    private static void equal(Object actual, Object expected) {
        checks++;
        if (!Objects.equals(actual, expected)) throw new AssertionError("Expected " + expected + ", got " + actual);
    }
}
