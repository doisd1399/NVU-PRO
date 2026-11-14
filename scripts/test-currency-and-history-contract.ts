import assert from "node:assert/strict";
import { buildCanonicalTripRegistrationRequest } from "../src/services/sync/CanonicalTripRegistrationRequest";
import { parseTripMoneyRecord, resolveTripCurrency } from "../src/lib/tripNormalizer";
import { summarizeTripMoney } from "../src/lib/tripMoneySummary";

const base = { valor: 10100, valorCents: 1010000, tripId: "synthetic-1", driverId: "driver-1", companyId: "company-1" };
for (const field of ["currency", "moeda", "moneyCurrency", "simpleReceiptCurrency", "receiptCurrency"]) {
  const request = buildCanonicalTripRegistrationRequest({ ...base, [field]: "BRL" }, "").trip;
  assert.equal(request.currency, "BRL", `${field} deve chegar como currency canônica no writer atual`);
}
const simpleCompat = buildCanonicalTripRegistrationRequest({ ...base, simpleAutomation: true, simulatorCode: "GTO" }, "").trip;
assert.equal(simpleCompat.currency, undefined, "Simple/Pro não deve ampliar o payload legado com currency");
assert.equal(simpleCompat.simpleReceiptCurrency, undefined, "Simple/Pro sem token explícito não envia alias monetário presumido");
const simpleExplicit = buildCanonicalTripRegistrationRequest({ ...base, simpleAutomation: true, source: "gto_auto", currency: "BRL",
  simpleReceiptCurrency: "BRL", simulatorCode: "GTO", receiptText: "VALOR A RECEBER: R$ 10.100,00" }, "").trip;
assert.equal(simpleExplicit.simpleReceiptCurrency, "BRL", "Simple/Pro preserva moeda corroborada por recibo explícito");
const conflictingRequest = buildCanonicalTripRegistrationRequest({ ...base, currency: "BRL", moeda: "EUR" }, "").trip;
assert.equal(conflictingRequest.currency, "BRL");
assert.equal(conflictingRequest.moeda, "EUR", "writer receberá aliases conflitantes para persistir a viagem como CONFLICT sem subtotal");
const explicitResolution = resolveTripCurrency({ currency: "BRL", simpleReceiptCurrency: "BRL" });
assert.ok(explicitResolution.currencySources.includes("currency"));
assert.ok(explicitResolution.currencySources.includes("simpleReceiptCurrency"));
assert.equal(explicitResolution.currencySource, "EXPLICIT_TRIP_FIELD");
assert.equal(parseTripMoneyRecord({ valorCents: 1010000, currency: "BRL" }).amount, 10100);
assert.equal(parseTripMoneyRecord({ valor: "10.100,00", currency: "BRL" }).amountCents, 1010000);
assert.equal(parseTripMoneyRecord({ valor: "não é valor", currency: "BRL" }).amountCents, null);
assert.equal(resolveTripCurrency({ currency: "ZZZ" }).currencyStatus, "unknown");
assert.equal(resolveTripCurrency({}).currencyStatus, "unknown");
assert.equal(resolveTripCurrency({ simpleAutomation: true, source: "gto_auto", currency: "BRL", simpleReceiptCurrency: "BRL", simulatorCode: "GTO" }).currencyStatus, "known",
  "valid explicit BRL remains known and agrees with the GTO registry");
const explicitSimple = resolveTripCurrency({ simpleAutomation: true, source: "gto_auto", currency: "BRL", simpleReceiptCurrency: "BRL",
  simulatorCode: "GTO", receiptText: "VALOR A RECEBER: R$ 10.100,00" });
assert.equal(explicitSimple.currency, "BRL");
assert.equal(explicitSimple.currencyStatus, "known");
assert.ok(explicitSimple.currencySources.includes("receipt_text_explicit"));
assert.equal(resolveTripCurrency({ simpleAutomation: true, source: "gto_auto", simulatorCode: "GTO",
  receiptText: "Valor a receber: R$ 10.100,00 Bônus Video ADS: 0" }).currency, "BRL", "rótulo ADS zero não é token monetário");
assert.equal(resolveTripCurrency({ simpleAutomation: true, source: "gto_auto", currency: "BRL", simulatorCode: "GTO",
  receiptText: "VALOR A RECEBER: $ 10.100,00" }).currency, "BRL", "explicit valid BRL agrees with GTO registry; an unrelated ambiguous token cannot erase it");
assert.equal(resolveTripCurrency({ simpleAutomation: true, source: "gto_auto", currency: "BRL", simulatorCode: "GTO",
  receiptText: "VALOR A RECEBER: R$ 10.100,00 EUR 10.100,00" }).currencyStatus, "conflict");
assert.equal(resolveTripCurrency({ simpleAutomation: true, currency: "EUR", simulatorCode: "GTO",
  receiptText: "VALOR A RECEBER: R$ 10.100,00" }).currencyStatus, "conflict");
assert.equal(resolveTripCurrency({ simpleAutomation: true, currencyEvidenceVersion: 1, currencyEvidenceStatus: "known",
  currencyEvidenceSource: "server_receipt_text_explicit", serverValidatedAt: "2026-10-06T00:00:00Z", currency: "EUR" }).currency, "EUR");
for (const simulator of ["GTO", "WTDS", "WBDS", "TOE3", "UNKNOWN-SIM"]) {
  const result = resolveTripCurrency({ simulatorCode: simulator });
  const expected = simulator === "TOE3" ? "EUR" : simulator === "UNKNOWN-SIM" ? undefined : "BRL";
  assert.equal(result.currency, expected, `${simulator} follows the authorized registry or remains unknown`);
  assert.equal(result.currencyStatus, expected ? "known" : "unknown", `${simulator} status follows the registry`);
  if (expected) assert.equal(result.currencySource, "SIMULATOR_REGISTRY");
}
assert.equal(resolveTripCurrency({ receiptCurrency: "USD", simulatorCode: "TOE3" }).currencyStatus, "conflict");
assert.equal(resolveTripCurrency({ currency: "EUR", simulatorCode: "GTO" }).currencyStatus, "conflict", "explicit/simulator disagreement must not be silently summed");
assert.equal(resolveTripCurrency({ currency: "BRL", simulatorCode: "GTO" }).currency, "BRL", "matching explicit currency retains priority");
assert.equal(resolveTripCurrency({ currency: "BRL", moeda: "EUR" }).currencyStatus, "conflict");

const trips = Array.from({ length: 2141 }, (_, index) => ({
  id: `trip-${index}`,
  valorCents: index < 29 ? 1010000 : 1010000,
  ...(index < 29 ? { currency: "BRL" } : {}),
}));
const groups = summarizeTripMoney(trips);
const brl = groups.find((group) => group.currency === "BRL");
const unknown = groups.find((group) => group.currencyStatus === "unknown");
assert.equal(brl?.tripCount, 29);
assert.equal(brl?.value, 292900);
assert.equal(unknown?.tripCount, 2112);
assert.equal(groups.reduce((sum, group) => sum + group.tripCount, 0), 2141);

const separated = summarizeTripMoney([
  { valorCents: 100, currency: "BRL" },
  { valorCents: 200, currency: "EUR" },
  { valorCents: 300, currency: "USD" },
  { valorCents: 400, simulatorCode: "GTO" },
  { valorCents: 500 },
]);
assert.equal(separated.find((group) => group.currency === "BRL")?.value, 5, "explicit BRL plus GTO registry trips share only the BRL subtotal");
assert.equal(separated.find((group) => group.currency === "EUR")?.value, 2);
assert.equal(separated.find((group) => group.currency === "USD")?.value, 3);
assert.equal(separated.find((group) => group.currencyStatus === "unknown")?.value, null);
assert.equal(separated.find((group) => group.currencyStatus === "missing"), undefined);
assert.equal(separated.find((group) => group.currencyStatus === "unknown")?.tripCount, 1);

const merged = new Map<string, Record<string, unknown>>();
for (const row of [{ id: "same", companyId: "316" }, { id: "same", empresaId: "2144" }, { id: "other" }]) merged.set(String(row.id), row);
assert.equal(merged.size, 2, "consultas sobrepostas devem deduplicar pelo documento");

console.log("CURRENCY/HISTORY CONTRACT PASS: fonte OCR explícita, fallback de simulador, conflitos sem soma, subtotais segregados e deduplicação");
