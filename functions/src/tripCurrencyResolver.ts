import { normalizeExplicitCurrency, resolveSimulatorCurrency } from "./simulatorCurrencyRegistry";

export type TripCurrencyStatus = "known" | "unknown" | "missing" | "conflict";
export interface TripCurrencyResolution {
  currency?: string;
  currencyStatus: TripCurrencyStatus;
  currencySources: string[];
  currencySource?: string;
}

const knownCurrencies = new Set(["BRL", "EUR", "USD", "GBP", "ARS", "CLP", "COP", "MXN", "UYU", "PYG"]);

function receiptCurrencyEvidence(trip: Record<string, unknown>): { currencies: string[]; unsupportedCurrencies: string[]; ambiguousDollar: boolean; source?: string } {
  const rawField = ["gtoRawText", "receiptText", "simpleReceiptText", "ocrText", "receiptOcrText"]
    .find((field) => String(trip[field] ?? "").trim());
  if (!rawField) return { currencies: [], unsupportedCurrencies: [], ambiguousDollar: false };
  const normalized = String(trip[rawField]).toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const simulator = [trip.simulatorKey, trip.simulatorCode, trip.simuladorCodigo, trip.simulatorId, trip.simulatorName, trip.simuladorNome]
    .map((value) => String(value ?? "").toLowerCase()).join(" ");
  const labels = /global[- ]?truck|\bgto\b/.test(simulator) ? ["VALOR A RECEBER"]
    : /toe[- ]?3|truckers? of europe/.test(simulator) ? ["RENDA TOTAL", "GANHOS"]
    : /wtds|wbds|world truck|world bus/.test(simulator) ? ["GANHOS DA VIAGEM", "TOTAL"]
    : ["VALOR A RECEBER", "RENDA TOTAL", "GANHOS DA VIAGEM", "GANHOS", "TOTAL"];
  const currencies = new Set<string>();
  const unsupportedCurrencies = new Set<string>();
  let ambiguousDollar = false;
  for (const label of labels) {
    let from = normalized.indexOf(label);
    while (from >= 0) {
      const tail = normalized.slice(from + label.length, from + label.length + 160);
      const tokenPattern = /R\s*\$|US\s*\$|BRL|EUR|USD|GBP|ARS|CLP|COP|MXN|UYU|PYG|CAD|AUD|NZD|JPY|CNY|CHF|INR|€|\$/;
      const money = /(?:R\s*\$|US\s*\$|BRL|EUR|USD|GBP|ARS|CLP|COP|MXN|UYU|PYG|CAD|AUD|NZD|JPY|CNY|CHF|INR|€|\$)\s*[0-9][0-9.,]*|[0-9][0-9.,]*\s*(?:R\s*\$|US\s*\$|BRL|EUR|USD|GBP|ARS|CLP|COP|MXN|UYU|PYG|CAD|AUD|NZD|JPY|CNY|CHF|INR|€|\$)/g;
      for (const match of tail.matchAll(money)) {
        const token = match[0].match(tokenPattern)?.[0]?.replace(/\s/g, "");
        if (token === "R$" || token === "BRL") currencies.add("BRL");
        else if (token === "EUR" || token === "€") currencies.add("EUR");
        else if (token === "USD" || token === "US$") currencies.add("USD");
        else if (token === "$") ambiguousDollar = true;
        else if (token) unsupportedCurrencies.add(token);
      }
      from = normalized.indexOf(label, from + 1);
    }
  }
  return { currencies: [...currencies], unsupportedCurrencies: [...unsupportedCurrencies], ambiguousDollar, source: rawField };
}

export function getKnownTripCurrencies(): string[] {
  return [...knownCurrencies].sort();
}

export function resolveTripCurrency(trip: Record<string, unknown>): TripCurrencyResolution {
  const fields = ["currency", "moeda", "simpleReceiptCurrency", "moneyCurrency", "receiptCurrency"];
  const observed = fields.flatMap((field) => {
    const currency = String(trip[field] ?? "").trim().toUpperCase();
    return currency ? [{ field, currency }] : [];
  });
  const receipt = receiptCurrencyEvidence(trip);
  const simulator = resolveSimulatorCurrency(trip);
  const normalizedObserved = observed.map((item) => ({ ...item, parsed: normalizeExplicitCurrency(item.currency) }));
  const unsupportedReceipt = receipt.unsupportedCurrencies.map((token) => normalizeExplicitCurrency(token));
  const explicitCurrencies = [...new Set([
    ...normalizedObserved.filter((item) => item.parsed.recognized).map((item) => item.parsed.currency!),
    ...receipt.currencies,
    ...unsupportedReceipt.filter((item) => item.recognized).map((item) => item.currency!),
  ])];
  const verifiedEvidence = Number(trip.currencyEvidenceVersion) === 1 && Boolean(trip.serverValidatedAt) &&
    ["known", "unknown", "conflict"].includes(String(trip.currencyEvidenceStatus ?? "")) &&
    typeof trip.currencyEvidenceSource === "string" && trip.currencyEvidenceSource.startsWith("server_");
  const sources = [...observed.map((item) => item.field), ...(receipt.source ? [receipt.source] : []),
    ...(verifiedEvidence ? [String(trip.currencyEvidenceSource)] : [])];
  const conflict = (currencySource: string): TripCurrencyResolution => ({
    currency: undefined, currencyStatus: "conflict", currencySources: [...sources, currencySource], currencySource,
  });
  const explicitValidUnsupported = normalizedObserved.some((item) => item.parsed.recognized && !item.parsed.supported) ||
    unsupportedReceipt.some((item) => item.recognized && !item.supported);

  if (simulator.status === "conflict") return conflict("SIMULATOR_METADATA_CONFLICT");
  if (explicitCurrencies.length > 1 || receipt.currencies.length > 1) return conflict("EXPLICIT_CURRENCY_CONFLICT");
  const explicitCurrency = explicitCurrencies[0];
  if (explicitCurrency && simulator.status === "known" && explicitCurrency !== simulator.currency) {
    return conflict("EXPLICIT_SIMULATOR_CONFLICT");
  }
  if (explicitValidUnsupported && simulator.status === "known") return conflict("UNSUPPORTED_EXPLICIT_SIMULATOR_CONFLICT");

  if (verifiedEvidence) {
    const evidenceStatus = String(trip.currencyEvidenceStatus) as TripCurrencyStatus;
    const evidenceCurrency = explicitCurrency || "";
    if (evidenceStatus === "conflict" || (evidenceStatus === "known" && (!evidenceCurrency || !knownCurrencies.has(evidenceCurrency)))) {
      return conflict("SERVER_EVIDENCE_CONFLICT");
    }
    if (evidenceStatus === "known") return {
      currency: evidenceCurrency, currencyStatus: "known", currencySources: [...sources, "server_validated_evidence"], currencySource: "SERVER_VALIDATED",
    };
  }

  if (explicitCurrency) {
    if (!knownCurrencies.has(explicitCurrency) || explicitValidUnsupported) {
      if (simulator.status === "known") return conflict("UNSUPPORTED_EXPLICIT_SIMULATOR_CONFLICT");
      return { currency: undefined, currencyStatus: "unknown", currencySources: sources, currencySource: "UNKNOWN" };
    }
    return {
      currency: explicitCurrency, currencyStatus: "known",
      currencySources: [...sources, ...(receipt.currencies.includes(explicitCurrency) ? ["receipt_text_explicit"] : ["explicit_trip_field"])],
      currencySource: verifiedEvidence ? "SERVER_VALIDATED" : receipt.currencies.includes(explicitCurrency) && !normalizedObserved.some((item) => item.parsed.currency === explicitCurrency)
        ? "EXPLICIT_RECEIPT_TEXT" : "EXPLICIT_TRIP_FIELD",
    };
  }

  if (simulator.status === "known" && simulator.currency) {
    return {
      currency: simulator.currency,
      currencyStatus: "known",
      currencySources: [...sources, "SIMULATOR_REGISTRY"],
      currencySource: "SIMULATOR_REGISTRY",
    };
  }
  return { currency: undefined, currencyStatus: "unknown", currencySources: sources, currencySource: "UNKNOWN" };
}
