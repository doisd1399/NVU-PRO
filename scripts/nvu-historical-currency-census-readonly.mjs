#!/usr/bin/env node
/**
 * Minimal Firestore production census for historical currency evidence.
 * GET-only; reuses existing Firebase CLI credentials and consent, requests no
 * new scope, persists no raw documents, and writes only aggregate JSON reports.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { analyzeHistoricalCurrencyEvidence } from "./analyze-historical-currency-evidence.mjs";

const projectId = "vtc-frota-log";
if (process.env.NVU_ALLOW_PRODUCTION_READ !== "1") throw new Error("Bloqueado: defina NVU_ALLOW_PRODUCTION_READ=1 para confirmar leitura somente-GET.");
const configuredProject = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || projectId;
if (configuredProject !== projectId) throw new Error(`Bloqueado: projeto configurado difere do projeto autorizado (${projectId}).`);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const outDir = path.resolve(process.argv[2] || path.join(projectRoot, "../results/production-currency-census"));
if (outDir === projectRoot || outDir.startsWith(`${projectRoot}${path.sep}`)) throw new Error("Bloqueado: resultados agregados devem ficar fora da árvore-fonte.");

const historicalTripFields = [
  "canonicalTripId", "tripId", "deterministicTripId", "originalCanonicalTripId", "originalTripId", "idempotencyKey", "clientRequestId", "fingerprint", "simpleReceiptCaptureAttemptId",
  "imageHash", "simpleReceiptHash", "receiptHash", "proofHash", "receiptEventKey", "simpleDuplicateGuardKey", "gtoSourceLineFingerprint",
  "companyId", "company_id", "empresaId", "empresa_id", "fleetId", "frotaId", "canonicalCompanyId", "historicalCompanyId", "originalCompanyId", "companyIdOriginal", "empresaOriginalId", "legacyCompanyId",
  "driverId", "driver_id", "motoristaId", "motorista_id", "userId", "criadoPor",
  "jobId", "trabalhoId", "operationId", "contractId", "contratoId",
  "status", "recordStatus", "cancelado", "deleted", "softDeleted", "deletedAt", "tombstonedAt",
  "currency", "moeda", "simpleReceiptCurrency", "moneyCurrency", "receiptCurrency",
  "currencyEvidenceSource", "currencyEvidenceVersion", "simpleReceiptCurrencySource", "simpleReceiptCurrencyEvidenceVersion", "simpleReceiptSourceField",
  "simpleAutomation", "simpleAutomationVersion", "gtoMoneySchemaVersion", "operationProjectionVersion", "schemaVersion", "schemaGeneration",
  "valorCents", "amountCents", "earningsCents", "valor", "value", "totalValue", "ganho", "earnings",
  "completedAt", "completedAtLocal", "dataFechamento", "date", "dataLancamento", "dataViagem", "createdAt", "updatedAt", "createdAtLocal", "localCreatedAt", "offlineCreatedAt", "serverValidatedAt", "serverUpdatedAt", "serverConfirmedAt", "uploadedAt",
  "source", "automationSource", "offlineSyncStatus", "syncStatus", "validationStatus",
  "simulatorId", "simuladorId", "simulatorKey", "simuladorKey", "simulator", "simulador", "simulatorCode", "simuladorCodigo", "simulatorName", "simuladorNome",
  "gtoRawText", "receiptText", "simpleReceiptText", "ocrText", "receiptOcrText",
];
const contextCurrencyFields = [
  "currency", "moeda", "simpleReceiptCurrency", "moneyCurrency", "receiptCurrency",
  "currencyHistory", "historicalCurrency", "historicalCurrencies", "currencyTimeline", "currencyEvents", "currencyByPeriod", "currencyRegistry", "currencySettingsHistory", "moedaHistorico", "historicoMoeda", "historicalMoneySettings",
  "currencyEffectiveFrom", "currencyEffectiveUntil", "currencyValidFrom", "currencyValidUntil", "validFrom", "validUntil", "effectiveFrom", "effectiveUntil",
  "createdAt", "updatedAt", "serverUpdatedAt",
];
const companyIdentityFields = ["companyId", "company_id", "empresaId", "empresa_id", "fleetId", "frotaId", "canonicalCompanyId", "historicalCompanyId", "originalCompanyId", "companyIdOriginal", "empresaOriginalId", "legacyCompanyId", "verifiedAliases", "companyAliases", "legacyCompanyIds", "historicalCompanyIds", "migrationReferences"];
const simulatorIdentityFields = ["simulatorId", "simuladorId", "simulatorKey", "simuladorKey", "simulator", "simulador", "simulatorCode", "simuladorCodigo", "simulatorName", "simuladorNome"];
const operationLabelFields = ["name", "nome", "code", "codigo", "number", "jobCode", "jobNumber", "operationNumber", "operationCode", "operationName", "operationLabel", "jobName", "taskCode", "taskName", "contractCode", "contractNumber", "contractNo", "contractName", "contractReference", "contratoNumero", "numeroContrato", "codigoContrato", "numeroOperacao", "codigoOperacao", "reference", "identifier", "displayName", "displayCode", "title", "label"];
const fields = {
  historico_viagens: historicalTripFields,
  trip_history: historicalTripFields,
  trips: historicalTripFields,
  viagens: historicalTripFields,
  trabalhos: ["jobId", "operationId", "trabalhoId", "contractId", "contratoId", ...companyIdentityFields, ...simulatorIdentityFields, "driverId", "driver_id", "motoristaId", "userId", ...contextCurrencyFields, "startedAt", "assignedAt", "acceptedAt", "completedAt", "operationCompletedAt", "finishedAt", "closedAt", "cancelledAt", "canceledAt", "status", "jobStatus", "operationReconciliationVersion", "totalDeliveries", "progress", ...operationLabelFields],
  contratos: ["contractId", "contratoId", ...companyIdentityFields, ...simulatorIdentityFields, "driverId", "motoristaId", ...contextCurrencyFields, "status", "active", ...operationLabelFields],
  frotas: [...companyIdentityFields, ...simulatorIdentityFields, ...contextCurrencyFields, "companyName", "company_name", "name", "status", "active"],
  simulators: ["name", "nome", "label", "title", "displayName", "code", "slug", "key", "simulatorId", "simuladorId", ...contextCurrencyFields],
};

const firebaseBin = fs.realpathSync((await import("node:child_process")).execFileSync("which", ["firebase"], { encoding: "utf8" }).trim());
const firebasePackageRoot = path.resolve(path.dirname(firebaseBin), "../..");
const requireFirebase = createRequire(path.join(firebasePackageRoot, "package.json"));
const firebaseAuth = requireFirebase("./lib/auth");
const configstore = requireFirebase("./lib/configstore").configstore;
const account = firebaseAuth.getGlobalDefaultAccount();
const loginScopes = configstore.get("loginScopes") || [];
if (!account?.tokens?.refresh_token) throw new Error("Bloqueado: a sessão Firebase CLI já autenticada não está disponível; nenhuma nova credencial será solicitada.");
if (!loginScopes.includes("https://www.googleapis.com/auth/cloud-platform")) throw new Error("Bloqueado: o consentimento existente não inclui cloud-platform; nenhuma reautorização será solicitada.");

let accessToken = null;
async function token() {
  const refreshed = await firebaseAuth.getAccessToken(account.tokens.refresh_token, loginScopes);
  accessToken = typeof refreshed === "string" ? refreshed : refreshed?.access_token;
  if (!accessToken) throw new Error("A sessão Firebase CLI não retornou token de leitura.");
  return accessToken;
}
function decodeValue(value) {
  if (Object.hasOwn(value, "nullValue")) return null;
  if (Object.hasOwn(value, "stringValue")) return value.stringValue;
  if (Object.hasOwn(value, "integerValue")) { const number = Number(value.integerValue); return Number.isSafeInteger(number) ? number : value.integerValue; }
  if (Object.hasOwn(value, "doubleValue")) return value.doubleValue;
  if (Object.hasOwn(value, "booleanValue")) return value.booleanValue;
  if (Object.hasOwn(value, "timestampValue")) return value.timestampValue;
  if (Object.hasOwn(value, "referenceValue")) return value.referenceValue;
  if (Object.hasOwn(value, "arrayValue")) return (value.arrayValue.values || []).map(decodeValue);
  if (Object.hasOwn(value, "mapValue")) return decodeFields(value.mapValue.fields || {});
  return null;
}
function decodeFields(map) { return Object.fromEntries(Object.entries(map).map(([key, value]) => [key, decodeValue(value)])); }

const apiRoot = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
const snapshot = {};
const coverage = {};
let productionReads = 0;
const startedAt = new Date();
async function readCollection(name) {
  const rows = [];
  let pageToken = null, pages = 0;
  do {
    const url = new URL(`${apiRoot}/${encodeURIComponent(name)}`);
    url.searchParams.set("pageSize", "1000");
    for (const field of fields[name]) url.searchParams.append("mask.fieldPaths", field);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${await token()}` }, signal: AbortSignal.timeout(45000) });
    productionReads++;
    pages++;
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Leitura GET falhou para ${name}: HTTP ${response.status} (${body.error?.status || "sem código"}). Nenhuma escrita foi tentada.`);
    for (const document of body.documents || []) {
      const id = decodeURIComponent(document.name.split("/").at(-1));
      rows.push({ id, data: decodeFields(document.fields || {}) });
    }
    pageToken = body.nextPageToken || null;
    if (pages > 100000) throw new Error(`Limite de paginação de segurança excedido em ${name}.`);
  } while (pageToken);
  snapshot[name] = rows;
  coverage[name] = { pages, documents: rows.length, terminated: true, fieldMask: fields[name] };
}

try {
  for (const name of Object.keys(fields)) await readCollection(name);
  const aggregate = await analyzeHistoricalCurrencyEvidence(snapshot, { projectId, generatedAt: new Date(), targetOperationLabel: "BLS-120", targetCompanyName: "DC Transportes", operationLabelFields });
  for (const name of Object.keys(snapshot)) snapshot[name] = [];
  const finishedAt = new Date();
  const manifest = {
    mode: "GET_ONLY_FIELD_MASKED_FIRESTORE_CENSUS",
    projectId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    productionReads,
    mutationCount: 0,
    productionMutations: 0,
    requestMethods: ["GET"],
    rawDocumentsWrittenToDisk: false,
    historicalTripCollections: ["historico_viagens", "trip_history", "trips", "viagens"],
    appPrimaryTripCollection: "historico_viagens",
    collectionCoverage: coverage,
    credentialSource: "existing Firebase CLI session; no new OAuth consent requested",
    fieldMaskPolicy: "Only trip identity, currency aliases/provenance, status/schema/date/value/hash/text and simulator identity fields; operation/contract/company links and effective-dated currency fields; exact job/contract label fields for BLS-120 and company name fields used only for the requested exact company match. Company name, receipt/OCR text and IDs are processed in memory and never written. No user, member, receipt-image or storage URL collection queried.",
  };
  const final = { ...aggregate, collectionCoverage: Object.fromEntries(Object.entries(coverage).map(([name, value]) => [name, { pages: value.pages, documents: value.documents, terminated: value.terminated }])), readManifest: manifest };
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(outDir, 0o700);
  const outFile = path.join(outDir, "NVU-429-HISTORICAL-CURRENCY-CENSUS-READONLY.json");
  fs.writeFileSync(outFile, `${JSON.stringify(final, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  process.stdout.write(`${JSON.stringify({ status: "complete", projectId, productionReads, mutationCount: 0, productionMutations: 0, collectionCounts: Object.fromEntries(Object.entries(coverage).map(([name, value]) => [name, value.documents])), output: outFile })}\n`);
} finally {
  accessToken = null;
}
