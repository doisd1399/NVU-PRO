import assert from "node:assert/strict";
import { analyzeHistoricalCurrencyEvidence } from "./analyze-historical-currency-evidence.mjs";

const date = "2025-06-15T12:00:00.000Z";
const before = "2025-01-01T00:00:00.000Z";
const t = (id, fields = {}) => ({ id, data: { recordStatus: "concluida", status: "concluida", syncStatus: "synced", serverValidatedAt: before, completedAt: date, valorCents: 10000, ...fields } });
const stableDoc = (id, fields = {}) => ({ id, data: { createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-02T00:00:00.000Z", ...fields } });

const snapshot = {
  historico_viagens: [
    t("explicit-brl", { currency: "BRL" }),
    t("explicit-eur", { moeda: "EUR" }),
    t("alias-usd", { moneyCurrency: "USD" }),
    t("alias-gbp", { receiptCurrency: "GBP" }),
    t("simple-unverified", { simpleAutomation: true, currency: "BRL", simpleReceiptCurrency: "BRL", currencyEvidenceSource: "SERVER_VALIDATED_RECEIPT", currencyEvidenceVersion: 1, simulatorCode: "GTO" }),
    t("simple-receipt-proven", { simpleAutomation: true, simpleReceiptCurrency: "EUR", gtoRawText: "GANHOS DA VIAGEM: € 100,00" }),
    t("operation-evidence", { jobId: "job-brl", contractId: "contract-brl", companyId: "company-current" }),
    t("contract-evidence", { contractId: "contract-eur", companyId: "company-current" }),
    t("operation-updated-later", { jobId: "job-current", contractId: "missing-contract" }),
    t("operation-contract-conflict", { jobId: "job-brl", contractId: "contract-eur", companyId: "company-current" }),
    t("company-history", { companyId: "company-history" }),
    t("company-current-only", { companyId: "company-current" }),
    t("ambiguous-dollar", { simulatorCode: "TOE3", gtoRawText: "GANHOS DA VIAGEM: $ 100,00" }),
    t("simple-receipt-conflict", { simpleAutomation: true, currency: "BRL", gtoRawText: "GANHOS DA VIAGEM: EUR 100,00" }),
    t("unsupported", { currency: "ZZZ" }),
    t("trip-alias-conflict", { currency: "BRL", moeda: "EUR" }),
    t("company-alias-conflict", { companyId: "company-current", empresaId: "company-other" }),
    t("explicit-context-conflict", { currency: "EUR", jobId: "job-brl", contractId: "contract-brl", companyId: "company-current" }),
    t("dup-physical-1", { tripId: "strong-dup-ok", currency: "BRL", origem: "same route", destino: "same route end" }),
    t("dup-physical-2", { tripId: "strong-dup-ok", currency: "BRL", origem: "same route", destino: "same route end" }),
    t("dup-conflict-1", { tripId: "strong-dup-conflict", currency: "BRL" }),
    t("dup-conflict-2", { tripId: "strong-dup-conflict", currency: "EUR" }),
    t("similar-trip-1", { tripId: "legitimate-1", currency: "BRL", origem: "same route", destino: "same route end" }),
    t("similar-trip-2", { tripId: "legitimate-2", currency: "BRL", origem: "same route", destino: "same route end" }),
    t("multiple-identity-namespaces", { tripId: "trip-different-from-request", idempotencyKey: "request-a", fingerprint: "fingerprint-a", currency: "BRL" }),
    t("dup-amount-1", { tripId: "amount-conflict", currency: "BRL", valorCents: 10000 }),
    t("dup-amount-2", { tripId: "amount-conflict", currency: "BRL", valorCents: 20000 }),
  ],
  trip_history: [t("legacy-copy", { idempotencyKey: "request-a", currency: "BRL" })],
  trabalhos: [
    stableDoc("job-brl", { jobId: "job-brl", operationId: "job-brl", contractId: "contract-brl", companyId: "company-current", driverId: "driver-1", currency: "BRL", status: "completed" }),
    { id: "job-current", data: { jobId: "job-current", contractId: "missing-contract", currency: "BRL", companyId: "company-current", driverId: "driver-1", createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" } },
  ],
  contratos: [
    stableDoc("contract-brl", { contractId: "contract-brl", companyId: "company-current", currency: "BRL" }),
    stableDoc("contract-eur", { contractId: "contract-eur", companyId: "company-current", moeda: "EUR" }),
  ],
  frotas: [
    { id: "company-current", data: { companyId: "company-current", currency: "BRL", createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" } },
    { id: "company-history", data: { companyId: "company-history", currency: "BRL", updatedAt: "2026-01-01T00:00:00.000Z", currencyHistory: [{ currency: "EUR", effectiveFrom: "2025-06-01T00:00:00.000Z", effectiveTo: "2025-06-30T00:00:00.000Z" }] } },
    { id: "company-other", data: { companyId: "company-other", currency: "EUR" } },
  ],
  simulators: [{ id: "TOE3", data: { name: "TOE3", currency: "EUR" } }],
};

const report = await analyzeHistoricalCurrencyEvidence(snapshot, { generatedAt: new Date("2026-10-06T00:00:00.000Z") });
const rows = report.categoryCounts;
assert.equal(report.physicalTripDocuments, 28);
assert.equal(report.physicalTripDocumentsByCollection.trip_history, 1);
assert.equal(report.uniqueTripIdentityGroups, 24);
assert.equal(rows.EXPLICIT_TRIP, 11, "campos explícitos válidos continuam sendo classificados antes do fallback do simulador");
assert.equal(rows.SIMULATOR_REGISTRY, 1, "simulador reconhecido sem moeda explícita deve ter categoria própria e fonte rastreável");
assert.equal(rows.OPERATION_EVIDENCE, 1, "o job exato com validade temporal deve resolver a moeda");
assert.equal(rows.CONTRACT_EVIDENCE, 1, "o contrato exato e vigente deve resolver a moeda");
assert.equal(rows.COMPANY_EVIDENCE, 1, "a empresa só resolve com intervalo histórico que cobre a data");
assert.equal(rows.CONFLICT, 5, "conflitos monetários explícitos e desacordo do recibo não devem escolher silenciosamente");
assert.equal(rows.UNKNOWN, 4, "simulador canônico resolve o fallback; viagens sem simulador reconhecido permanecem UNKNOWN");
assert.equal(report.eligibleCategoryCounts.UNKNOWN, 4);
assert.equal(report.categoryIntegrity.unclassifiedTripGroups, 0, "cada grupo de identidade deve pertencer a exatamente uma categoria");
assert.equal(report.duplicatePhysicalDocumentsByStrongIdentity, 4);
assert.equal(report.tripsWithStrongIdentifier, 10);
assert.equal(report.duplicateRecordIntegrityConflicts, 1);
assert.equal(report.knownSubtotalsByCurrency.BRL.tripCount, 7);
assert.equal(report.knownSubtotalsByCurrency.EUR.tripCount, 5);
assert.equal(report.currencySourceCounts.SIMULATOR_REGISTRY, 1);
assert.equal(report.simulatorRegistryFallback.byCurrency.EUR.tripCount, 1);
assert.equal(report.simulatorRegistryFallback.bySimulator.TOE3.currency, "EUR");
assert.equal(report.currencyResolutionCoverage.percent, 62.5);
assert.equal(report.receiptEvidence.ambiguousDollarSymbolRows, 1);
assert.equal(report.receiptEvidence.simpleAutomationCurrencyUnverified, 2);
assert.equal(report.contextualEvidence.tripOperationCurrencyHistoricallyProven, 3);
assert.equal(report.contextualEvidence.tripContractCurrencyHistoricallyProven, 4);
assert.equal(report.contextualEvidence.tripCompanyHistoricalCurrencyProven, 1);
assert.equal(report.contextualEvidence.simulatorDocumentsWithCurrencyConfigNotUsedAsProof, 1);
assert.ok(report.directFieldNormalizationFromApp.known > rows.EXPLICIT_TRIP, "o normalizador atual da UI trata alguns campos automáticos sem procedência como conhecidos");
assert.ok(report.byCategoryAndSchemaGeneration.EXPLICIT_TRIP);
assert.ok(report.byCategoryAndMetricYear.EXPLICIT_TRIP["2025"] >= 1);
assert.equal(report.integrity.outputContainsDocumentIds, false);
assert.equal(report.integrity.outputContainsRoutes, false);
const serialized = JSON.stringify(report);
for (const privateValue of ["explicit-brl", "strong-dup-ok", "trip-different-from-request", "request-a", "fingerprint-a", "amount-conflict", "same route", "GANHOS DA VIAGEM: € 100,00", "company-current"]) {
  assert.equal(serialized.includes(privateValue), false, `output leaked ${privateValue}`);
}

const targetReport = await analyzeHistoricalCurrencyEvidence({
  historico_viagens: [
    t("bls-trip-1", { jobId: "bls-job-alias", currency: "BRL" }),
    t("bls-trip-2", { jobId: "bls-job-alias", currency: "BRL" }),
    t("bls-trip-3", { jobId: "bls-job-alias", currency: "BRL" }),
    t("bls-trip-4", { jobId: "bls-job-alias" }),
  ],
  trabalhos: [stableDoc("job-document-id", { jobId: "bls-job-alias", operationId: "bls-job-alias", name: "BLS-120" })],
}, { targetOperationLabel: "BLS-120", operationLabelFields: ["name", "code", "number"] });
assert.equal(targetReport.targetOperation.exactJobDocument.exactDocumentMatches, 1);
assert.equal(targetReport.targetOperation.exactJobDocument.linkedPhysicalTripDocuments, 4);
assert.equal(targetReport.targetOperation.exactJobDocument.eligibleTripGroups, 4);
assert.equal(targetReport.targetOperation.exactJobDocument.resolvedCurrencyEligibleTripGroups, 3);
assert.equal(targetReport.targetOperation.exactJobDocument.knownSubtotalsByCurrency.BRL.tripCount, 3);
assert.equal(JSON.stringify(targetReport).includes("bls-job-alias"), false, "target operation report must not expose IDs");

console.log("PASS historical currency evidence regressions: source policy, explicit/context/temporal/provenance/conflict/identity/epoch/privacy");
