package com.nvu.operacional;

import java.math.BigDecimal;
import java.text.Normalizer;
import java.text.NumberFormat;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Read-only money presentation for Pro history; never changes receipt or server policy. */
final class ProHistoryMoney {
    private static final String[] CURRENCY_FIELDS = {
        "currency", "moeda", "simpleReceiptCurrency", "moneyCurrency", "receiptCurrency"
    };
    private static final String[] SIMULATOR_FIELDS = {
        "simulatorId", "simulatorCode", "simulatorKey", "simulatorName", "simulator",
        "simuladorId", "simuladorCodigo", "simuladorKey", "simuladorNome", "simulador",
        "gameId", "gameCode", "gameName", "packageId"
    };
    private static final Set<String> SUPPORTED = new LinkedHashSet<>(Arrays.asList(
        "BRL", "EUR", "USD", "GBP", "ARS", "CLP", "COP", "MXN", "UYU", "PYG"
    ));
    private static final Set<String> UNSUPPORTED = new LinkedHashSet<>(Arrays.asList(
        "CAD", "AUD", "NZD", "JPY", "CNY", "CHF", "INR"
    ));
    private static final String MONEY_TOKEN = "R\\s*\\$|US\\s*\\$|BRL|EUR|USD|GBP|ARS|CLP|COP|MXN|UYU|PYG|CAD|AUD|NZD|JPY|CNY|CHF|INR|€|\\$";
    private static final Pattern TOKEN = Pattern.compile(MONEY_TOKEN);
    private static final Pattern MONEY = Pattern.compile("(?:" + MONEY_TOKEN + ")\\s*[0-9][0-9.,]*|[0-9][0-9.,]*\\s*(?:" + MONEY_TOKEN + ")");

    static final class Resolution {
        final String currency;
        final String status;
        final String source;

        Resolution(String currency, String status, String source) {
            this.currency = currency;
            this.status = status;
            this.source = source;
        }
    }

    private ProHistoryMoney() {}

    static Resolution resolve(Map<String, ?> row) {
        // A WebView projection can carry UNKNOWN after discarding the raw aliases.
        // Preserve its conflict marker rather than reclassifying it as BRL.
        String source = text(row.get("currencySource")).toUpperCase(Locale.ROOT);
        boolean verifiedEvidence = "1".equals(text(row.get("currencyEvidenceVersion")))
            && !text(row.get("serverValidatedAt")).isEmpty()
            && text(row.get("currencyEvidenceSource")).startsWith("server_");
        String evidenceStatus = verifiedEvidence ? text(row.get("currencyEvidenceStatus")) : "";
        if ("conflict".equals(text(row.get("currencyStatus"))) || source.contains("CONFLICT") || "conflict".equals(evidenceStatus)) {
            return new Resolution("", "conflict", "PRESERVED_CURRENCY_CONFLICT");
        }

        Set<String> simulators = new LinkedHashSet<>();
        for (String field : SIMULATOR_FIELDS) {
            String simulator = canonicalSimulator(row.get(field));
            if (!simulator.isEmpty()) simulators.add(simulator);
        }
        if (simulators.size() > 1) return new Resolution("", "conflict", "SIMULATOR_METADATA_CONFLICT");
        String simulatorCurrency = simulators.isEmpty() ? ""
            : simulators.contains("TOE3") ? "EUR" : "BRL";

        Set<String> explicit = new LinkedHashSet<>();
        for (String field : CURRENCY_FIELDS) {
            String currency = normalizeCurrency(row.get(field));
            if (SUPPORTED.contains(currency) || UNSUPPORTED.contains(currency)) explicit.add(currency);
        }
        boolean hasExplicitField = !explicit.isEmpty();
        explicit.addAll(receiptCurrencies(row, simulators.isEmpty() ? "" : simulators.iterator().next()));
        if (explicit.size() > 1) return new Resolution("", "conflict", "EXPLICIT_CURRENCY_CONFLICT");
        if ("known".equals(evidenceStatus) && (explicit.isEmpty() || !SUPPORTED.contains(explicit.iterator().next()))) {
            return new Resolution("", "conflict", "SERVER_EVIDENCE_CONFLICT");
        }
        if (!explicit.isEmpty()) {
            String currency = explicit.iterator().next();
            if (!simulatorCurrency.isEmpty() && !simulatorCurrency.equals(currency)) {
                return new Resolution("", "conflict", "EXPLICIT_SIMULATOR_CONFLICT");
            }
            if (!SUPPORTED.contains(currency)) return new Resolution("", "unknown", "UNKNOWN");
            return new Resolution(currency, "known", "known".equals(evidenceStatus) ? "SERVER_VALIDATED"
                : hasExplicitField ? "EXPLICIT_TRIP_FIELD" : "EXPLICIT_RECEIPT_TEXT");
        }
        if (!simulatorCurrency.isEmpty()) return new Resolution(simulatorCurrency, "known", "SIMULATOR_REGISTRY");
        return new Resolution("", "unknown", "UNKNOWN");
    }

    static String format(long amountCents, Resolution money) {
        NumberFormat number = NumberFormat.getNumberInstance(new Locale("pt", "BR"));
        number.setMinimumFractionDigits(2);
        number.setMaximumFractionDigits(2);
        BigDecimal amount = BigDecimal.valueOf(amountCents, 2);
        if ("conflict".equals(money.status)) return number.format(amount) + " · moedas conflitantes";
        // Missing metadata stays nominal: do not invent a currency or repeat an error label.
        if (!"known".equals(money.status)) return number.format(amount);
        String symbol = "BRL".equals(money.currency) ? "R$ "
            : "EUR".equals(money.currency) ? "€ "
            : "USD".equals(money.currency) ? "US$ " : money.currency + " ";
        return (amount.signum() < 0 ? "-" : "") + symbol + number.format(amount.abs());
    }

    private static String normalizeCurrency(Object value) {
        String token = text(value).toUpperCase(Locale.ROOT).replaceAll("\\s+", " ");
        if ("R$".equals(token) || "R$ BRL".equals(token)) return "BRL";
        if ("€".equals(token)) return "EUR";
        if ("US$".equals(token)) return "USD";
        return token;
    }

    private static Set<String> receiptCurrencies(Map<String, ?> row, String simulator) {
        String receipt = "";
        for (String field : new String[]{"gtoRawText", "receiptText", "simpleReceiptText", "ocrText", "receiptOcrText"}) {
            receipt = text(row.get(field));
            if (!receipt.isEmpty()) break;
        }
        String normalized = Normalizer.normalize(receipt, Normalizer.Form.NFD)
            .replaceAll("\\p{InCombiningDiacriticalMarks}+", "").toUpperCase(Locale.ROOT);
        String[] labels = "GTO".equals(simulator) ? new String[]{"VALOR A RECEBER"}
            : "TOE3".equals(simulator) ? new String[]{"RENDA TOTAL", "GANHOS"}
            : "WTDS".equals(simulator) || "WBDS".equals(simulator) ? new String[]{"GANHOS DA VIAGEM", "TOTAL"}
            : new String[]{"VALOR A RECEBER", "RENDA TOTAL", "GANHOS DA VIAGEM", "GANHOS", "TOTAL"};
        Set<String> currencies = new LinkedHashSet<>();
        for (String label : labels) {
            int index = normalized.indexOf(label);
            while (index >= 0) {
                int start = index + label.length();
                Matcher money = MONEY.matcher(normalized.substring(start, Math.min(normalized.length(), start + 160)));
                while (money.find()) {
                    Matcher token = TOKEN.matcher(money.group());
                    if (!token.find()) continue;
                    String currency = normalizeCurrency(token.group().replaceAll("\\s+", ""));
                    if (SUPPORTED.contains(currency) || UNSUPPORTED.contains(currency)) currencies.add(currency);
                }
                index = normalized.indexOf(label, index + 1);
            }
        }
        return currencies;
    }

    private static String canonicalSimulator(Object value) {
        // Mirrors the existing shared simulator registry, plus validated native keys.
        String alias = Normalizer.normalize(text(value), Normalizer.Form.NFD)
            .replaceAll("\\p{InCombiningDiacriticalMarks}+", "")
            .toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9]+", " ").trim();
        switch (alias) {
            case "GTO": case "GLOBAL TRUCK": case "GLOBAL TRUCK ONLINE": case "COM STARGAMESAPPS GTO":
                return "GTO";
            case "WTDS": case "WORLD TRUCK": case "WORLD TRUCK DRIVING SIMULATOR":
                return "WTDS";
            case "WBDS": case "WORLD BUS": case "WORLD BUS DRIVING SIMULATOR":
                return "WBDS";
            case "TOE3": case "TOE 3": case "TRUCKERS OF EUROPE 3":
                return "TOE3";
            default: return "";
        }
    }

    private static String text(Object value) {
        return value == null ? "" : String.valueOf(value).trim();
    }
}
