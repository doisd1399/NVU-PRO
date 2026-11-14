#!/usr/bin/env node
/**
 * Aggregate-only historical currency evidence analyzer.
 * Raw rows are processed in memory; output contains no trip, company, driver,
 * route, receipt text, or document identifiers. No mutations are performed.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRequire = createRequire(path.join(SOURCE_ROOT, "package.json"));
const directCurrencyFields = ["currency", "moeda", "simpleReceiptCurrency", "moneyCurrency", "receiptCurrency"];
const trustedNonSimpleFields = ["currency", "moeda", "moneyCurrency", "receiptCurrency"];
const historyFields = [
  "currencyHistory", "historicalCurrency", "historicalCurrencies", "currencyTimeline",
  "currencyEvents", "currencyByPeriod", "currencyRegistry", "currencySettingsHistory",
  "moedaHistorico", "historicoMoeda", "historicalMoneySettings",
];
const strongTripIdentityFamilies = [
  { namespace: "trip", fields: ["canonicalTripId", "tripId", "deterministicTripId", "originalCanonicalTripId", "originalTripId"] },
  { namespace: "idempotency", fields: ["idempotencyKey", "clientRequestId"] },
  { namespace: "fingerprint", fields: ["fingerprint"] },
  { namespace: "receipt_event", fields: ["receiptEventKey"] },
  { namespace: "receipt_attempt", fields: ["simpleReceiptCaptureAttemptId"] },
];
const receiptHashFields = ["simpleReceiptHash", "imageHash", "receiptHash", "proofHash"];
const jobIdFields = ["jobId", "operationId", "trabalhoId"];
const contractIdFields = ["contractId", "contratoId"];
const companyIdFields = ["companyId", "empresaId", "company_id", "empresa_id", "fleetId", "frotaId", "canonicalCompanyId", "historicalCompanyId", "originalCompanyId", "empresaOriginalId", "companyIdOriginal", "legacyCompanyId", "verifiedAliases", "companyAliases", "legacyCompanyIds", "historicalCompanyIds", "migrationReferences"];
const effectiveFromFields = ["currencyEffectiveFrom", "currencyValidFrom", "validFrom", "effectiveFrom"];
const effectiveToFields = ["currencyEffectiveUntil", "currencyValidUntil", "validUntil", "effectiveUntil"];
const knownSet = new Set(["BRL", "EUR", "USD", "GBP", "ARS", "CLP", "COP", "MXN", "UYU", "PYG"]);

let sourcePolicyPromise;
async function loadSourcePolicies() {
  if (sourcePolicyPromise) return sourcePolicyPromise;
  sourcePolicyPromise = (async () => {
    const { build } = projectRequire("esbuild");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-currency-policy-"));
    try {
      const tripBundle = path.join(tmp, "trip-normalizer.mjs");
      const canonicalBundle = path.join(tmp, "historical-trip-canonicalizer.mjs");
      await Promise.all([
        build({ entryPoints: [path.join(SOURCE_ROOT, "src/lib/tripNormalizer.ts")], outfile: tripBundle, bundle: true, platform: "node", format: "esm", logLevel: "silent" }),
        build({ entryPoints: [path.join(SOURCE_ROOT, "functions/src/historicalTripCanonicalizer.ts")], outfile: canonicalBundle, bundle: true, platform: "node", format: "esm", logLevel: "silent" }),
      ]);
      const [trip, canonical] = await Promise.all([
        import(pathToFileURL(tripBundle).href),
        import(pathToFileURL(canonicalBundle).href),
      ]);
      for (const name of ["getTripMetricAssessment", "parseTripMoneyRecord", "resolveTripCurrency", "getKnownTripCurrencies", "resolveSimulatorCurrency"]) {
        if (typeof trip[name] !== "function") throw new Error(`Trip policy export missing: ${name}`);
      }
      if (!Array.isArray(trip.SIMULATOR_CURRENCY_REGISTRY)) throw new Error("Simulator currency registry export missing");
      if (typeof canonical.canonicalizeHistoricalTrip !== "function") throw new Error("Historical canonicalizer export missing");
      return { trip, canonical };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  })();
  return sourcePolicyPromise;
}

const text = (value) => String(value ?? "").trim();
const unique = (values) => [...new Set(values.map(text).filter(Boolean))];
const first = (row, fields) => fields.map((field) => row?.[field]).find((value) => value !== undefined && value !== null && text(value) !== "");
const millis = (value) => {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : 0;
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : 0;
  if (value && typeof value === "object" && Number.isFinite(Number(value.seconds))) return Number(value.seconds) * 1000;
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};
const normCurrency = (value) => {
  const raw = text(value).toUpperCase().replace(/\s+/g, " ");
  if (!raw) return { currency: null, recognized: false, ambiguous: false };
  if (raw === "R$" || raw === "R$ BRL") return { currency: "BRL", recognized: true, ambiguous: false };
  if (raw === "€") return { currency: "EUR", recognized: true, ambiguous: false };
  if (raw === "$") return { currency: null, recognized: false, ambiguous: true };
  return knownSet.has(raw) ? { currency: raw, recognized: true, ambiguous: false } : { currency: null, recognized: false, ambiguous: false };
};

function receiptCurrencyEvidence(rawValue) {
  const raw = String(rawValue ?? "");
  if (!raw) return { currencies: [], unsupportedCurrencies: [], ambiguousDollar: false, tokensFound: false, labelsWithCurrencyTokens: [] };
  const labels = ["VALOR A RECEBER", "GANHOS DA VIAGEM", "GANHO DA VIAGEM", "RENDA TOTAL", "GANHOS", "TOTAL"];
  const upper = raw.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const tails = [];
  for (const label of labels) {
    let cursor = 0;
    while ((cursor = upper.indexOf(label, cursor)) >= 0) {
      tails.push({ label, text: upper.slice(cursor + label.length, cursor + label.length + 180) });
      cursor += label.length;
    }
  }
  const regions = tails.length ? tails : [{ label: "UNLABELED_TEXT", text: upper }];
  const currencies = new Set();
  const unsupportedCurrencies = new Set();
  let ambiguousDollar = false;
  let tokensFound = false;
  const labelsWithCurrencyTokens = new Set();
  const tokenPattern = /R\s*\$|US\s*\$|BRL|EUR|USD|GBP|ARS|CLP|COP|MXN|UYU|PYG|CAD|AUD|NZD|JPY|CNY|CHF|INR|€|\$/;
  const tokens = "R\\s*\\$|US\\s*\\$|BRL|EUR|USD|GBP|ARS|CLP|COP|MXN|UYU|PYG|CAD|AUD|NZD|JPY|CNY|CHF|INR|€|\\$";
  const pattern = new RegExp(`(?:${tokens})\\s*(?=[0-9])|[0-9][0-9.,]*\\s*(?:${tokens})`, "g");
  for (const region of regions) {
    for (const match of region.text.matchAll(pattern)) {
      tokensFound = true;
      labelsWithCurrencyTokens.add(region.label);
      const token = match[0].match(tokenPattern)?.[0]?.replace(/\s+/g, "");
      if (!token) continue;
      if (token === "R$") currencies.add("BRL");
      else if (token === "BRL") currencies.add("BRL");
      else if (token === "EUR" || token === "€") currencies.add("EUR");
      else if (token === "USD") currencies.add("USD");
      else if (token === "$") ambiguousDollar = true;
      else unsupportedCurrencies.add(token);
    }
  }
  return { currencies: [...currencies], unsupportedCurrencies: [...unsupportedCurrencies], ambiguousDollar, tokensFound, labelsWithCurrencyTokens: [...labelsWithCurrencyTokens] };
}

function asRows(value, sourceCollection = "") {
  return (Array.isArray(value) ? value : []).map((entry) => {
    const data = entry?.data && typeof entry.data === "object" ? entry.data : entry || {};
    const id = text(entry?.id || data.id);
    return { ...data, id, sourceCollection, physicalDocumentId: sourceCollection ? `${sourceCollection}/${id}` : id, __docId: id };
  }).filter((entry) => entry.id);
}

function aliasValues(row, fields) {
  return unique(fields.map((field) => row?.[field]));
}
function buildDocumentIndex(rows, aliasFields) {
  const index = new Map();
  for (const row of rows) {
    for (const alias of unique([row.id, ...aliasValues(row, aliasFields)])) {
      const matches = index.get(alias) || new Set();
      matches.add(row);
      index.set(alias, matches);
    }
  }
  return index;
}
function buildSimulatorIndex(rows) {
  const aliases = new Map();
  const byId = new Map(rows.map((row) => [row.id, row]));
  const fields = ["simulatorId", "simuladorId", "code", "slug", "key", "name", "nome", "label", "title", "displayName"];
  for (const row of rows) {
    for (const alias of unique([row.id, ...fields.map((field) => row?.[field])])) {
      const matches = aliases.get(alias) || new Set();
      matches.add(row);
      aliases.set(alias, matches);
    }
  }
  return { aliases, byId };
}
function enrichTripSimulatorFromCatalog(trip, simulatorIndex) {
  const identityFields = ["simulatorId", "simuladorId", "simulatorKey", "simuladorKey", "simulator", "simulador", "simulatorCode", "simuladorCodigo", "simulatorName", "simuladorNome"];
  const matches = new Set();
  for (const field of identityFields) {
    const value = text(trip?.[field]);
    if (!value) continue;
    const exactId = simulatorIndex.byId.get(value);
    if (exactId) { matches.add(exactId); continue; }
    const found = simulatorIndex.aliases.get(value);
    if (found?.size === 1) matches.add([...found][0]);
  }
  if (!matches.size) return trip;
  const aliases = unique([...matches].flatMap((item) => [item.code, item.slug, item.key, item.name, item.nome, item.label, item.title, item.displayName]));
  const enriched = { ...trip };
  const availableFields = ["simulatorCode", "simulatorName", "simulatorKey", "simulator", "simuladorCodigo", "simuladorNome", "simuladorKey", "simulador", "gameCode", "packageId"];
  for (const alias of aliases) {
    const emptyField = availableFields.find((field) => !text(enriched[field]));
    if (!emptyField) break;
    enriched[emptyField] = alias;
  }
  return enriched;
}
function resolveIndexedDocument(index, alias) {
  const matches = index.get(text(alias));
  if (!matches?.size) return { doc: null, missing: true, ambiguous: false };
  if (matches.size !== 1) return { doc: null, missing: false, ambiguous: true };
  return { doc: [...matches][0], missing: false, ambiguous: false };
}

function rowCurrencyValues(row, fields = directCurrencyFields) {
  return fields.map((field) => ({ field, value: row?.[field] })).filter((item) => text(item.value));
}

function directTripEvidence(trip, tripPolicy) {
  const observed = rowCurrencyValues(trip);
  const rawReceipt = first(trip, ["gtoRawText", "receiptText", "simpleReceiptText", "ocrText", "receiptOcrText"]);
  const receipt = receiptCurrencyEvidence(rawReceipt);
  const sourceToken = text(trip?.source || trip?.automationSource).toLowerCase();
  const simpleAutomation = trip?.simpleAutomation === true || trip?.registroAutomatico === true || ["gto_auto", "simple_auto", "simple_automation", "simple-native-v1"].some((token) => sourceToken.includes(token)) || trip?.gtoMoneySchemaVersion != null;
  const simpleValues = simpleAutomation ? observed.map((item) => normCurrency(item.value)) : observed.filter((item) => item.field === "simpleReceiptCurrency").map((item) => normCurrency(item.value));
  const simpleKnown = simpleValues.map((item) => item.currency).filter(Boolean);
  const receiptCurrencies = receipt.currencies;
  const simpleSupportedByReceipt = simpleKnown.length > 0 && receiptCurrencies.length === 1 && !receipt.unsupportedCurrencies.length && simpleKnown.every((value) => value === receiptCurrencies[0]);
  const appResolution = tripPolicy.resolveTripCurrency(trip);
  const simulatorResolution = tripPolicy.resolveSimulatorCurrency(trip);
  const unsupportedOrAmbiguous = observed.some((item) => !normCurrency(item.value).currency) || receipt.ambiguousDollar || receipt.unsupportedCurrencies.length > 0;
  const observedKnownCurrencies = unique(observed.map((item) => normCurrency(item.value).currency).filter(Boolean));
  const hasExplicitCurrency = String(appResolution.currencySource || "").startsWith("EXPLICIT_") || appResolution.currencySource === "SERVER_VALIDATED";
  const receiptDisagreesWithStoredAlias = receiptCurrencies.length === 1 && observedKnownCurrencies.some((currency) => currency !== receiptCurrencies[0]);
  const identityConflict = appResolution.currencyStatus === "conflict" || observedKnownCurrencies.length > 1 || receiptDisagreesWithStoredAlias;
  const hasCurrencySignal = observed.length > 0 || receipt.tokensFound;
  return {
    status: identityConflict ? "conflict" : appResolution.currencyStatus,
    currency: !identityConflict && appResolution.currencyStatus === "known" ? appResolution.currency || null : null,
    currencySource: appResolution.currencySource || null,
    simulator: simulatorResolution.status === "known" ? simulatorResolution.simulator : null,
    simulatorStatus: simulatorResolution.status,
    hasExplicitCurrency,
    observedAliases: observed.map((item) => item.field),
    observedKnownCurrencies,
    receiptCurrencies,
    receiptCurrencyLabels: receipt.labelsWithCurrencyTokens,
    receiptAmbiguousDollar: receipt.ambiguousDollar,
    receiptUnsupportedCurrencyTokens: receipt.unsupportedCurrencies,
    simpleReceiptCurrencyUnverified: simpleAutomation && simpleKnown.length > 0 && !simpleSupportedByReceipt,
    simpleReceiptCurrencySupportedByReceipt: simpleSupportedByReceipt,
    unsupportedOrAmbiguous,
    hasCurrencySignal,
    rawReceiptFieldPresent: Boolean(rawReceipt),
  };
}

function documentCurrency(doc) {
  const observed = rowCurrencyValues(doc);
  const parsed = observed.map((item) => normCurrency(item.value));
  const known = unique(parsed.map((item) => item.currency).filter(Boolean));
  const anySignal = observed.length > 0;
  const hasUnsupported = parsed.some((item) => !item.currency);
  return {
    status: known.length > 1 ? "conflict" : known.length === 1 && !hasUnsupported ? "known" : anySignal ? "unknown" : "missing",
    currency: known.length === 1 && !hasUnsupported ? known[0] : null,
    observedAliases: observed.map((item) => item.field),
    unsupportedOrAmbiguous: hasUnsupported,
  };
}

function currencyValidity(doc, tripMillis) {
  if (!tripMillis) return { valid: false, reason: "trip_date_unavailable" };
  for (const field of historyFields) {
    const value = doc?.[field];
    if (value == null) continue;
    const entries = Array.isArray(value) ? value
      : typeof value === "object" ? Object.entries(value).map(([key, entry]) => typeof entry === "object" && entry !== null ? { effectiveFrom: key, ...entry } : { effectiveFrom: key, currency: entry })
        : [];
    const matches = [];
    for (const entry of entries) {
      const c = documentCurrency(entry);
      if (c.status !== "known") continue;
      const start = millis(first(entry, effectiveFromFields));
      const end = millis(first(entry, effectiveToFields));
      if (start && tripMillis >= start && (!end || tripMillis <= end)) matches.push(c.currency);
    }
    const found = unique(matches);
    if (found.length > 1) return { valid: true, reason: "overlapping_history_conflict", currency: null, conflict: true, field };
    if (found.length === 1) return { valid: true, reason: "explicit_history_interval", currency: found[0], field };
  }
  const start = millis(first(doc, effectiveFromFields));
  const end = millis(first(doc, effectiveToFields));
  if (start && tripMillis >= start && (!end || tripMillis <= end)) {
    const c = documentCurrency(doc);
    if (c.status === "known") return { valid: true, reason: "explicit_document_validity_interval", currency: c.currency, field: "direct_currency_with_validity" };
    if (c.status === "conflict") return { valid: true, reason: "direct_currency_interval_conflict", currency: null, conflict: true, field: "direct_currency_with_validity" };
  }
  const created = millis(doc?.createdAt);
  const updateTimes = [millis(doc?.updatedAt), millis(doc?.serverUpdatedAt)].filter(Boolean);
  const updated = updateTimes.length ? Math.max(...updateTimes) : 0;
  if (created && updated && created <= tripMillis && updated <= tripMillis) {
    const c = documentCurrency(doc);
    if (c.status === "known") return { valid: true, reason: "document_unchanged_by_trip_date", currency: c.currency, field: "document_currency" };
    if (c.status === "conflict") return { valid: true, reason: "document_currency_conflict_by_trip_date", currency: null, conflict: true, field: "document_currency" };
  }
  if (docCurrencyPresence(doc)) return { valid: false, reason: updated && updated > tripMillis ? "document_updated_after_trip" : "current_currency_without_historical_validity" };
  return { valid: false, reason: "no_currency_evidence" };
}
function docCurrencyPresence(doc) { return rowCurrencyValues(doc).length > 0 || historyFields.some((field) => doc?.[field] != null); }

function aliasStrings(value) {
  if (typeof value === "string" || typeof value === "number") return [String(value).trim()].filter(Boolean);
  if (Array.isArray(value)) return value.flatMap(aliasStrings);
  if (!value || typeof value !== "object") return [];
  return ["id", "companyId", "empresaId", "company_id", "empresa_id", "canonicalCompanyId", "historicalCompanyId", "originalCompanyId", "companyIdOriginal", "empresaOriginalId", "legacyCompanyId", "fleetId", "frotaId", "alias", "value"].flatMap((field) => aliasStrings(value[field]));
}
function normalizeCompanyIndex(companies) {
  const index = new Map();
  const aliasFields = ["verifiedAliases", "companyAliases", "legacyCompanyIds", "historicalCompanyIds", "canonicalCompanyId", "companyIdOriginal", "historicalCompanyId", "originalCompanyId", "empresaOriginalId", "legacyCompanyId", "fleetId", "frotaId", "company_id", "empresa_id", "companyId", "empresaId", "migrationReferences"];
  for (const company of companies) {
    for (const alias of unique([company.id, ...aliasFields.flatMap((field) => aliasStrings(company[field]))])) {
      const values = index.get(alias) || new Set();
      values.add(company.id);
      index.set(alias, values);
    }
  }
  return index;
}
function resolveCompanyReferences(values, index) {
  const refs = unique(values);
  if (!refs.length) return { ids: [], conflict: false, missing: true };
  const resolved = [];
  let unresolved = false;
  for (const ref of refs) {
    const matches = index.get(ref);
    if (!matches || matches.size === 0) { unresolved = true; continue; }
    if (matches.size !== 1) return { ids: [], conflict: true, missing: false };
    resolved.push([...matches][0]);
  }
  const ids = unique(resolved);
  return { ids, conflict: ids.length > 1, missing: unresolved || ids.length === 0 };
}

function contextForTrip(trip, jobIndex, contractIndex, companyIndex, companyDocs, tripMillis) {
  const jobIds = aliasValues(trip, jobIdFields);
  const contractIds = aliasValues(trip, contractIdFields);
  const tripCompany = resolveCompanyReferences(companyIdFields.map((field) => trip?.[field]), companyIndex);
  const result = { conflict: false, bindingConflict: jobIds.length > 1 || contractIds.length > 1 || tripCompany.conflict, job: null, contract: null, company: null, candidates: {}, reasons: [] };
  if (result.bindingConflict) result.reasons.push("trip_identity_alias_conflict");
  let job = null;
  const jobResolution = jobIds.length === 1 ? resolveIndexedDocument(jobIndex, jobIds[0]) : null;
  if (jobResolution?.ambiguous) { result.bindingConflict = true; result.reasons.push("linked_operation_id_ambiguous"); }
  if (jobResolution?.doc) job = jobResolution.doc;
  if (job) {
    result.job = job;
    const jobContractIds = aliasValues(job, contractIdFields);
    const jobCompany = resolveCompanyReferences(companyIdFields.map((field) => job?.[field]), companyIndex);
    if (jobContractIds.length > 1 || jobCompany.conflict || (contractIds.length === 1 && jobContractIds.length === 1 && contractIds[0] !== jobContractIds[0])) {
      result.bindingConflict = true;
      result.reasons.push("trip_operation_contract_or_company_binding_conflict");
    }
    if (tripCompany.ids.length && jobCompany.ids.length && tripCompany.ids[0] !== jobCompany.ids[0]) {
      result.bindingConflict = true;
      result.reasons.push("trip_operation_company_binding_conflict");
    }
    const operationCurrency = documentCurrency(job);
    const validity = currencyValidity(job, tripMillis);
    result.candidates.operation = { ...operationCurrency, status: validity.conflict ? "conflict" : validity.currency ? "known" : operationCurrency.status, temporal: validity.reason, proven: Boolean(validity.valid && validity.currency), currency: validity.currency || null };
    if (validity.conflict) { result.conflict = true; result.reasons.push("operation_currency_conflict"); }
  } else if (jobIds.length === 1 && !jobResolution?.ambiguous) {
    result.reasons.push("linked_operation_not_found");
  }
  const effectiveContractIds = contractIds.length === 1 ? contractIds : job ? aliasValues(job, contractIdFields) : [];
  let contract = null;
  const contractResolution = effectiveContractIds.length === 1 ? resolveIndexedDocument(contractIndex, effectiveContractIds[0]) : null;
  if (contractResolution?.ambiguous) { result.bindingConflict = true; result.reasons.push("linked_contract_id_ambiguous"); }
  if (contractResolution?.doc) contract = contractResolution.doc;
  if (contract) {
    result.contract = contract;
    const contractCompany = resolveCompanyReferences(companyIdFields.map((field) => contract?.[field]), companyIndex);
    if (contractCompany.conflict || (tripCompany.ids.length && contractCompany.ids.length && tripCompany.ids[0] !== contractCompany.ids[0]) || (job && resolveCompanyReferences(companyIdFields.map((field) => job?.[field]), companyIndex).ids.length && contractCompany.ids.length && resolveCompanyReferences(companyIdFields.map((field) => job?.[field]), companyIndex).ids[0] !== contractCompany.ids[0])) {
      result.bindingConflict = true;
      result.reasons.push("trip_operation_contract_company_binding_conflict");
    }
    const contractCurrency = documentCurrency(contract);
    const validity = currencyValidity(contract, tripMillis);
    result.candidates.contract = { ...contractCurrency, status: validity.conflict ? "conflict" : validity.currency ? "known" : contractCurrency.status, temporal: validity.reason, proven: Boolean(validity.valid && validity.currency), currency: validity.currency || null };
    if (validity.conflict) { result.conflict = true; result.reasons.push("contract_currency_conflict"); }
  } else if (effectiveContractIds.length === 1 && !contractResolution?.ambiguous) {
    result.reasons.push("linked_contract_not_found");
  }
  if (tripCompany.ids.length === 1) {
    const company = companyDocs.get(tripCompany.ids[0]) || null;
    if (company) {
      result.company = company;
      const validity = currencyValidity(company, tripMillis);
      const currentCurrency = documentCurrency(company);
      result.candidates.company = { status: validity.conflict ? "conflict" : validity.currency ? "known" : currentCurrency.status, currency: validity.currency || null, temporal: validity.reason, proven: Boolean(validity.valid && validity.currency) };
      if (validity.conflict) { result.conflict = true; result.reasons.push("company_currency_history_conflict"); }
    }
  }
  const provenCurrencies = ["operation", "contract", "company"]
    .map((level) => result.candidates[level])
    .filter((candidate) => candidate?.proven && candidate.currency);
  if (unique(provenCurrencies.map((candidate) => candidate.currency)).length > 1) {
    result.conflict = true;
    result.reasons.push("operation_contract_company_currency_disagreement");
  }
  return result;
}

function strongIdentityEvidence(row) {
  const tokens = [];
  const aliasConflictFamilies = [];
  for (const family of strongTripIdentityFamilies) {
    const values = unique(family.fields.map((field) => row?.[field]));
    if (values.length > 1) aliasConflictFamilies.push(family.namespace);
    values.forEach((value) => tokens.push(`${family.namespace}:${value}`));
  }
  return { tokens, aliasConflictFamilies, aliasConflict: aliasConflictFamilies.length > 0 };
}
function buildIdentityGroups(rows) {
  const parent = rows.map((_, index) => index);
  const find = (index) => parent[index] === index ? index : (parent[index] = find(parent[index]));
  const union = (left, right) => { const a = find(left), b = find(right); if (a !== b) parent[b] = a; };
  const tokenOwner = new Map();
  rows.forEach((row, index) => {
    for (const token of strongIdentityEvidence(row).tokens) {
      if (tokenOwner.has(token)) union(index, tokenOwner.get(token));
      else tokenOwner.set(token, index);
    }
  });
  const groups = new Map();
  rows.forEach((row, index) => {
    const root = find(index);
    const group = groups.get(root) || { rows: [], aliasConflict: false, aliasConflictFamilies: new Set(), hasStrongIdentity: false };
    const evidence = strongIdentityEvidence(row);
    group.rows.push(row);
    group.aliasConflict ||= evidence.aliasConflict;
    evidence.aliasConflictFamilies.forEach((family) => group.aliasConflictFamilies.add(family));
    group.hasStrongIdentity ||= evidence.tokens.length > 0;
    groups.set(root, group);
  });
  return [...groups.values()];
}
function categoryFor(tripEvidence, context) {
  if (tripEvidence.status === "conflict" || context.conflict) return { category: "CONFLICT", reason: context.reasons.find((reason) => reason.includes("currency")) || "trip_currency_alias_conflict" };
  const contextKnown = ["operation", "contract", "company"].map((level) => context.candidates[level]).filter((candidate) => candidate?.proven && candidate.currency);
  if (tripEvidence.currency && contextKnown.some((candidate) => candidate.currency !== tripEvidence.currency)) return { category: "CONFLICT", reason: "trip_context_currency_disagreement" };
  if (tripEvidence.status === "known" && tripEvidence.currencySource === "SIMULATOR_REGISTRY") return { category: "SIMULATOR_REGISTRY", reason: "canonical_simulator_currency_registry" };
  if (tripEvidence.status === "known") return { category: "EXPLICIT_TRIP", reason: "trusted_trip_currency_or_receipt_token" };
  if (tripEvidence.receiptAmbiguousDollar || (tripEvidence.unsupportedOrAmbiguous && !tripEvidence.simpleReceiptCurrencyUnverified)) return { category: "UNKNOWN", reason: tripEvidence.receiptAmbiguousDollar ? "ambiguous_dollar_symbol" : "unsupported_or_ambiguous_currency_token" };
  if (context.bindingConflict) return { category: "UNKNOWN", reason: context.reasons[0] || "historical_context_binding_ambiguous" };
  const operation = context.candidates.operation;
  if (operation?.proven && operation.currency) return { category: "OPERATION_EVIDENCE", reason: operation.temporal };
  const contract = context.candidates.contract;
  if (contract?.proven && contract.currency) return { category: "CONTRACT_EVIDENCE", reason: contract.temporal };
  const company = context.candidates.company;
  if (company?.proven && company.currency) return { category: "COMPANY_EVIDENCE", reason: company.temporal };
  if (tripEvidence.status === "unknown" || tripEvidence.simpleReceiptCurrencyUnverified || tripEvidence.receiptAmbiguousDollar) return { category: "UNKNOWN", reason: tripEvidence.simpleReceiptCurrencyUnverified ? "simple_receipt_currency_provenance_unverified" : tripEvidence.receiptAmbiguousDollar ? "ambiguous_dollar_symbol" : "unsupported_or_unverified_trip_currency" };
  if (operation?.status === "known" && !operation.proven) return { category: "UNKNOWN", reason: operation.temporal };
  if (contract?.status === "known" && !contract.proven) return { category: "UNKNOWN", reason: contract.temporal };
  if (context.reasons.length) return { category: "UNKNOWN", reason: context.reasons[0] };
  return { category: "UNKNOWN", reason: "no_deterministic_currency_evidence" };
}

function increment(map, key) { map[key] = (map[key] || 0) + 1; }

function summarizeExactLabel(documents, label, labelFields, aliasFields, recordAliasField, records) {
  const target = text(label).toUpperCase();
  const matches = documents.filter((doc) => text(doc.id).toUpperCase() === target || labelFields.some((field) => text(doc[field]).toUpperCase() === target));
  if (matches.length !== 1) return { exactDocumentMatches: matches.length, linkedPhysicalTripDocuments: null, uniqueTripIdentityGroups: null, eligibleTripGroups: null, resolvedCurrencyEligibleTripGroups: null, categories: null, knownSubtotalsByCurrency: null };
  const refs = new Set(unique([matches[0].id, ...aliasValues(matches[0], aliasFields)]));
  const matchedRecords = records.filter((record) => record.sourceCollection === "historico_viagens" && record.primaryLinkageRows.some((row) => row[recordAliasField].some((alias) => refs.has(alias))));
  const linkedPhysicalTripDocuments = matchedRecords.reduce((count, record) => count + record.primaryLinkageRows.filter((row) => row[recordAliasField].some((alias) => refs.has(alias))).length, 0);
  const categories = {};
  const knownSubtotalsByCurrency = {};
  let eligibleTripGroups = 0, resolvedCurrencyEligibleTripGroups = 0;
  const resolved = new Set(["EXPLICIT_TRIP", "SIMULATOR_REGISTRY", "OPERATION_EVIDENCE", "CONTRACT_EVIDENCE", "COMPANY_EVIDENCE"]);
  for (const record of matchedRecords) {
    increment(categories, record.category);
    if (!record.eligible) continue;
    eligibleTripGroups++;
    if (!resolved.has(record.category) || !record.currency) continue;
    resolvedCurrencyEligibleTripGroups++;
    if (record.recordIntegrityConflict || !Number.isSafeInteger(record.amountCents)) continue;
    const subtotal = knownSubtotalsByCurrency[record.currency] || { tripCount: 0, amountCents: 0 };
    subtotal.tripCount++;
    subtotal.amountCents += record.amountCents;
    knownSubtotalsByCurrency[record.currency] = subtotal;
  }
  return { exactDocumentMatches: 1, linkedPhysicalTripDocuments, uniqueTripIdentityGroups: matchedRecords.length, eligibleTripGroups, resolvedCurrencyEligibleTripGroups, categories, knownSubtotalsByCurrency };
}

function summarizeExactCompanyName(companies, label, records) {
  const target = text(label).toUpperCase();
  const nameFields = ["companyName", "company_name", "name"];
  const matches = companies.filter((company) => nameFields.some((field) => text(company[field]).toUpperCase() === target));
  if (matches.length === 0) return {
    exactCompanyDocumentMatches: matches.length,
    linkedCompanyIdentityGroups: null,
    linkedPhysicalTripDocuments: null,
    uniqueTripIdentityGroups: null,
    eligibleTripGroups: null,
    resolvedCurrencyEligibleTripGroups: null,
    categories: null,
    knownSubtotalsByCurrency: null,
    simulatorRegistryFallbackBySimulator: null,
  };
  const companyAliasFields = companyIdFields;
  const candidateAliases = companies.map((company) => new Set(unique([company.id, ...companyAliasFields.flatMap((field) => aliasStrings(company[field]))])));
  const parent = companies.map((_, index) => index);
  const find = (index) => parent[index] === index ? index : (parent[index] = find(parent[index]));
  const union = (left, right) => { const a = find(left), b = find(right); if (a !== b) parent[b] = a; };
  const aliasOwner = new Map();
  candidateAliases.forEach((aliases, index) => aliases.forEach((alias) => {
    if (aliasOwner.has(alias)) union(index, aliasOwner.get(alias)); else aliasOwner.set(alias, index);
  }));
  const matchingIndices = companies.map((company, index) => nameFields.some((field) => text(company[field]).toUpperCase() === target) ? index : -1).filter((index) => index >= 0);
  const matchingRoots = new Set(matchingIndices.map(find));
  if (matchingRoots.size !== 1) return {
    exactCompanyDocumentMatches: matches.length,
    linkedCompanyIdentityGroups: matchingRoots.size,
    linkedPhysicalTripDocuments: null,
    uniqueTripIdentityGroups: null,
    eligibleTripGroups: null,
    resolvedCurrencyEligibleTripGroups: null,
    categories: null,
    knownSubtotalsByCurrency: null,
    simulatorRegistryFallbackBySimulator: null,
  };
  const matchingRoot = [...matchingRoots][0];
  const refs = new Set(unique(candidateAliases.flatMap((aliases, index) => find(index) === matchingRoot ? [...aliases] : [])));
  const matchedRecords = records.filter((record) => record.sourceCollection === "historico_viagens" && record.companyLinkageRows.some((row) => row.aliases.some((alias) => refs.has(alias))));
  const categories = {};
  const knownSubtotalsByCurrency = {};
  const simulatorRegistryFallbackBySimulator = {};
  const resolved = new Set(["EXPLICIT_TRIP", "SIMULATOR_REGISTRY", "OPERATION_EVIDENCE", "CONTRACT_EVIDENCE", "COMPANY_EVIDENCE"]);
  let eligibleTripGroups = 0, resolvedCurrencyEligibleTripGroups = 0, linkedPhysicalTripDocuments = 0;
  for (const record of matchedRecords) {
    const linkedRows = record.companyLinkageRows.filter((row) => row.aliases.some((alias) => refs.has(alias)));
    linkedPhysicalTripDocuments += linkedRows.length;
    increment(categories, record.category);
    if (record.category === "SIMULATOR_REGISTRY") increment(simulatorRegistryFallbackBySimulator, record.simulator || "UNRECOGNIZED");
    if (!record.eligible) continue;
    eligibleTripGroups++;
    if (!resolved.has(record.category) || !record.currency) continue;
    resolvedCurrencyEligibleTripGroups++;
    if (record.recordIntegrityConflict || !Number.isSafeInteger(record.amountCents)) continue;
    const subtotal = knownSubtotalsByCurrency[record.currency] || { tripCount: 0, amountCents: 0 };
    subtotal.tripCount++;
    subtotal.amountCents += record.amountCents;
    knownSubtotalsByCurrency[record.currency] = subtotal;
  }
  return {
    exactCompanyDocumentMatches: matches.length,
    linkedCompanyIdentityGroups: 1,
    linkedPhysicalTripDocuments,
    uniqueTripIdentityGroups: matchedRecords.length,
    eligibleTripGroups,
    resolvedCurrencyEligibleTripGroups,
    categories,
    knownSubtotalsByCurrency,
    simulatorRegistryFallbackBySimulator,
  };
}

export async function analyzeHistoricalCurrencyEvidence(db, options = {}) {
  const { trip: tripPolicy, canonical: canonicalPolicy } = await loadSourcePolicies();
  const tripCollectionNames = ["historico_viagens", "trip_history", "trips", "viagens"];
  const simulators = asRows(db?.simulators);
  const simulatorIndex = buildSimulatorIndex(simulators);
  const tripsByCollection = Object.fromEntries(tripCollectionNames.map((name) => [name, asRows(db?.[name], name).map((trip) => enrichTripSimulatorFromCatalog(trip, simulatorIndex))]));
  const trips = tripCollectionNames.flatMap((name) => tripsByCollection[name]);
  const jobs = asRows(db?.trabalhos);
  const contracts = asRows(db?.contratos);
  const companies = asRows(db?.frotas);
  const companyMap = normalizeCompanyIndex(companies);
  const companyDocs = new Map(companies.map((company) => [company.id, company]));
  const jobIndex = buildDocumentIndex(jobs, jobIdFields);
  const contractIndex = buildDocumentIndex(contracts, contractIdFields);
  const groups = buildIdentityGroups(trips);
  const allTripRows = trips.map((trip) => ({ ...trip }));
  const records = [];
  for (const identity of groups) {
    const { rows } = identity;
    const trip = rows[0];
    const assessments = rows.map((row) => tripPolicy.getTripMetricAssessment(row));
    const eligible = assessments.length > 0 && assessments.every((assessment) => assessment.eligible);
    const assessment = assessments.find((item) => item.eligible) || assessments[0];
    const tripDateMillis = assessment?.valid ? assessment.date.getTime() : 0;
    const direct = directTripEvidence(trip, tripPolicy);
    const context = contextForTrip(trip, jobIndex, contractIndex, companyMap, companyDocs, tripDateMillis);
    if (identity.aliasConflict) { context.bindingConflict = true; context.reasons.unshift("trip_strong_identity_alias_conflict"); }
    let recordIntegrityConflict = false;
    let metricYearConflict = false;
    if (rows.length > 1) {
      const merged = rows.map((row) => directTripEvidence(row, tripPolicy));
      const currencies = unique(merged.map((item) => item.currency).filter(Boolean));
      const simulators = unique(merged.map((item) => item.simulator).filter(Boolean));
      const scopeSignatures = rows.map((row) => JSON.stringify([
        aliasValues(row, jobIdFields).sort(), aliasValues(row, contractIdFields).sort(), resolveCompanyReferences(companyIdFields.map((field) => row?.[field]), companyMap).ids.sort(),
      ]));
      const amountSignatures = rows.map((row) => JSON.stringify(tripPolicy.parseTripMoneyRecord(row).amountCents ?? null));
      const dateSignatures = assessments.map((item) => item.valid ? item.date.toISOString() : "NO_VALID_DATE");
      const eligibilitySignatures = assessments.map((item) => String(item.eligible));
      if (currencies.length > 1) {
        context.conflict = true;
        context.reasons.unshift("duplicate_strong_identity_currency_conflict");
      }
      if (simulators.length > 1) {
        context.conflict = true;
        context.reasons.unshift("duplicate_strong_identity_simulator_conflict");
      }
      if (unique(scopeSignatures).length > 1) {
        context.bindingConflict = true;
        context.reasons.unshift("duplicate_strong_identity_binding_conflict");
      }
      if (new Set(amountSignatures).size > 1 || new Set(dateSignatures).size > 1 || new Set(eligibilitySignatures).size > 1) {
        recordIntegrityConflict = true;
        metricYearConflict = new Set(dateSignatures).size > 1;
      }
    }
    const classification = categoryFor(direct, context);
    const canonical = canonicalPolicy.canonicalizeHistoricalTrip({ trip, operations: jobs, allTrips: allTripRows.filter((row) => row.sourceCollection === trip.sourceCollection) });
    const schemaGeneration = canonical?.schemaGeneration || "UNKNOWN";
    const metricYear = metricYearConflict ? "UNKNOWN" : assessment?.valid ? String(assessment.date.getUTCFullYear()) : "UNKNOWN";
    const money = tripPolicy.parseTripMoneyRecord(trip);
    records.push({
      category: classification.category,
      reason: classification.reason,
      currency: ["EXPLICIT_TRIP", "SIMULATOR_REGISTRY"].includes(classification.category) ? direct.currency
        : context.candidates[classification.category === "OPERATION_EVIDENCE" ? "operation" : classification.category === "CONTRACT_EVIDENCE" ? "contract" : classification.category === "COMPANY_EVIDENCE" ? "company" : ""]?.currency || null,
      currencySource: direct.currencySource,
      simulator: direct.simulator,
      simulatorStatus: direct.simulatorStatus,
      explicitCurrencies: direct.observedKnownCurrencies,
      receiptCurrencies: direct.receiptCurrencies,
      receiptCurrencyLabels: direct.receiptCurrencyLabels,
      hasExplicitCurrency: direct.hasExplicitCurrency,
      eligible,
      amountCents: recordIntegrityConflict ? null : money.amountCents,
      schemaGeneration,
      metricYear,
      physicalRows: rows.length,
      sourceFamily: trip.simpleAutomation === true ? "simple_automation"
        : ["gto_auto", "canonical_app"].includes(text(trip.source || trip.automationSource).toLowerCase()) ? text(trip.source || trip.automationSource).toLowerCase()
          : "other_or_unknown",
      sourceCollection: trip.sourceCollection,
      hasStrongIdentity: identity.hasStrongIdentity,
      identityAliasConflict: identity.aliasConflict,
      identityAliasConflictFamilies: [...identity.aliasConflictFamilies],
      recordIntegrityConflict,
      jobAliases: aliasValues(trip, jobIdFields),
      contractAliases: aliasValues(trip, contractIdFields),
      primaryLinkageRows: rows.filter((row) => row.sourceCollection === "historico_viagens").map((row) => ({
        jobAliases: aliasValues(row, jobIdFields), contractAliases: aliasValues(row, contractIdFields),
      })),
      companyLinkageRows: rows.map((row) => ({ sourceCollection: row.sourceCollection, aliases: aliasValues(row, companyIdFields) })),
      directFields: direct.observedAliases,
      directUnverified: direct.simpleReceiptCurrencyUnverified,
      receiptAmbiguousDollar: direct.receiptAmbiguousDollar,
      receiptUnsupportedCurrencyTokens: direct.receiptUnsupportedCurrencyTokens,
      context,
    });
  }

  const categories = ["EXPLICIT_TRIP", "SIMULATOR_REGISTRY", "OPERATION_EVIDENCE", "CONTRACT_EVIDENCE", "COMPANY_EVIDENCE", "CONFLICT", "UNKNOWN"];
  const classCounts = Object.fromEntries(categories.map((key) => [key, records.filter((record) => record.category === key).length]));
  const eligibleClassCounts = Object.fromEntries(categories.map((key) => [key, records.filter((record) => record.eligible && record.category === key).length]));
  const classifiedTripGroups = Object.values(classCounts).reduce((sum, count) => sum + count, 0);
  const byCategoryAndSchemaGeneration = {};
  const byCategoryAndMetricYear = {};
  const unknownReasons = {};
  const knownSubtotalsByCurrency = {};
  const directAliasCoverage = Object.fromEntries(directCurrencyFields.map((field) => [field, trips.filter((trip) => text(trip[field])).length]));
  const categoryCountsBySourceCollection = {};
  const eligibleCategoryCountsBySourceCollection = {};
  const uniqueEntitiesBySourceCollection = {};
  const sourceFamily = {};
  const currencySourceCounts = {};
  const registryFallbackReceiptCurrencyLabels = {};
  const registryFallbackByCurrency = {};
  const registryFallbackEligibleByCurrency = {};
  const simulatorDistribution = Object.fromEntries(tripPolicy.SIMULATOR_CURRENCY_REGISTRY.map((entry) => [entry.simulator, {
    currency: entry.currency,
    tripGroups: 0,
    eligibleTripGroups: 0,
    explicitCurrencyGroups: 0,
    registryFallbackGroups: 0,
    registryFallbackEligibleGroups: 0,
    conflictGroups: 0,
    unknownGroups: 0,
    knownSubtotals: { tripCount: 0, amountCents: 0 },
  }]));
  let explicitSimulatorCurrencyConflictCount = 0;
  let simulatorMetadataConflictCount = 0;
  let unrecognizedOrMissingSimulatorCount = 0;
  const receiptHashCandidateCoverage = Object.fromEntries(receiptHashFields.map((field) => [field, trips.filter((trip) => text(trip[field])).length]));
  const hashOccurrences = new Map();
  let eligibleCount = 0, ineligibleCount = 0, duplicatePhysicalRows = 0, tripsWithStrongId = 0;
  let tripsWithJob = 0, linkedJobFound = 0, tripsWithContract = 0, linkedContractFound = 0;
  let operationCurrencyCandidate = 0, operationCurrencyHistoricallyProven = 0;
  let contractCurrencyCandidate = 0, contractCurrencyHistoricallyProven = 0;
  let companyCurrentCurrencyCandidate = 0, companyHistoricalCurrencyCandidate = 0, companyHistoricalCurrencyProven = 0;
  let rawReceiptFieldCount = 0, ambiguousDollarReceiptCount = 0, unverifiedSimpleCurrencyCount = 0;
  let recordIntegrityConflictCount = 0;
  const identityAliasConflictFamilies = {};
  const appNormalization = { known: 0, unknown: 0, missing: 0, conflict: 0 };
  const aliasFieldByCurrency = {};
  const receiptUnsupportedCurrencyTokens = {};
  for (const record of records) {
    increment(byCategoryAndSchemaGeneration[record.category] ||= {}, record.schemaGeneration);
    increment(byCategoryAndMetricYear[record.category] ||= {}, record.metricYear);
    increment(categoryCountsBySourceCollection[record.sourceCollection] ||= {}, record.category);
    if (record.eligible) increment(eligibleCategoryCountsBySourceCollection[record.sourceCollection] ||= {}, record.category);
    increment(uniqueEntitiesBySourceCollection, record.sourceCollection);
    if (record.category === "UNKNOWN") increment(unknownReasons, record.reason);
    if (record.eligible) eligibleCount++; else ineligibleCount++;
    duplicatePhysicalRows += Math.max(0, record.physicalRows - 1);
    if (record.recordIntegrityConflict) recordIntegrityConflictCount++;
    record.identityAliasConflictFamilies.forEach((family) => increment(identityAliasConflictFamilies, family));
    increment(currencySourceCounts, record.currencySource || "UNKNOWN");
    if (record.category === "SIMULATOR_REGISTRY" && record.receiptCurrencies.length) {
      for (const label of record.receiptCurrencyLabels) increment(registryFallbackReceiptCurrencyLabels, label);
    }
    const simulatorStats = record.simulator ? simulatorDistribution[record.simulator] : null;
    if (simulatorStats) {
      simulatorStats.tripGroups++;
      if (record.eligible) simulatorStats.eligibleTripGroups++;
      if (record.category === "EXPLICIT_TRIP") simulatorStats.explicitCurrencyGroups++;
      if (record.category === "SIMULATOR_REGISTRY") {
        simulatorStats.registryFallbackGroups++;
        const fallback = registryFallbackByCurrency[record.currency] ||= { tripCount: 0, amountCents: 0 };
        fallback.tripCount++;
        if (!record.recordIntegrityConflict && Number.isSafeInteger(record.amountCents)) fallback.amountCents += record.amountCents;
        if (record.eligible) {
          simulatorStats.registryFallbackEligibleGroups++;
          const eligibleFallback = registryFallbackEligibleByCurrency[record.currency] ||= { tripCount: 0, amountCents: 0 };
          eligibleFallback.tripCount++;
          if (!record.recordIntegrityConflict && Number.isSafeInteger(record.amountCents)) eligibleFallback.amountCents += record.amountCents;
        }
      }
      if (record.category === "CONFLICT") simulatorStats.conflictGroups++;
      if (record.category === "UNKNOWN") simulatorStats.unknownGroups++;
      if (record.eligible && !record.recordIntegrityConflict && record.currency && ["EXPLICIT_TRIP", "SIMULATOR_REGISTRY", "OPERATION_EVIDENCE", "CONTRACT_EVIDENCE", "COMPANY_EVIDENCE"].includes(record.category) && Number.isSafeInteger(record.amountCents)) {
        simulatorStats.knownSubtotals.tripCount++;
        simulatorStats.knownSubtotals.amountCents += record.amountCents;
      }
    } else if (record.simulatorStatus === "conflict") {
      simulatorMetadataConflictCount++;
    } else {
      unrecognizedOrMissingSimulatorCount++;
    }
    if (record.currencySource === "EXPLICIT_SIMULATOR_CONFLICT") explicitSimulatorCurrencyConflictCount++;
    if (record.eligible && !record.recordIntegrityConflict && record.currency && ["EXPLICIT_TRIP", "SIMULATOR_REGISTRY", "OPERATION_EVIDENCE", "CONTRACT_EVIDENCE", "COMPANY_EVIDENCE"].includes(record.category) && Number.isSafeInteger(record.amountCents)) {
      const subtotal = knownSubtotalsByCurrency[record.currency] || { tripCount: 0, amountCents: 0 };
      subtotal.tripCount++;
      subtotal.amountCents += record.amountCents;
      knownSubtotalsByCurrency[record.currency] = subtotal;
    }
    increment(sourceFamily, record.sourceFamily.toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 40));
    if (record.directUnverified) unverifiedSimpleCurrencyCount++;
    if (record.receiptAmbiguousDollar) ambiguousDollarReceiptCount++;
    for (const token of record.receiptUnsupportedCurrencyTokens) increment(receiptUnsupportedCurrencyTokens, token);
    if (record.context.candidates.operation?.status === "known") operationCurrencyCandidate++;
    if (record.context.candidates.operation?.proven) operationCurrencyHistoricallyProven++;
    if (record.context.candidates.contract?.status === "known") contractCurrencyCandidate++;
    if (record.context.candidates.contract?.proven) contractCurrencyHistoricallyProven++;
    if (record.context.candidates.company?.status === "known" && !record.context.candidates.company?.proven) companyHistoricalCurrencyCandidate++;
    if (record.context.candidates.company?.proven) companyHistoricalCurrencyProven++;
    if (record.context.company && documentCurrency(record.context.company).status === "known" && !record.context.candidates.company?.proven) companyCurrentCurrencyCandidate++;
    if (record.hasStrongIdentity) tripsWithStrongId += record.physicalRows;
  }
  for (const trip of trips) {
    const direct = directTripEvidence(trip, tripPolicy);
    if (direct.rawReceiptFieldPresent) rawReceiptFieldCount++;
    increment(appNormalization, tripPolicy.resolveTripCurrency(trip).currencyStatus);
    for (const item of rowCurrencyValues(trip)) {
      const parsed = normCurrency(item.value);
      if (!parsed.currency) continue;
      const byAlias = aliasFieldByCurrency[parsed.currency] ||= {};
      increment(byAlias, item.field);
    }
    for (const field of receiptHashFields) {
      const value = text(trip?.[field]);
      if (value) hashOccurrences.set(`${field}:${value}`, (hashOccurrences.get(`${field}:${value}`) || 0) + 1);
    }
    if (aliasValues(trip, jobIdFields).length) { tripsWithJob++; if (aliasValues(trip, jobIdFields).some((alias) => resolveIndexedDocument(jobIndex, alias).doc)) linkedJobFound++; }
    if (aliasValues(trip, contractIdFields).length) { tripsWithContract++; if (aliasValues(trip, contractIdFields).some((alias) => resolveIndexedDocument(contractIndex, alias).doc)) linkedContractFound++; }
  }
  const simulatorCurrencyConfigs = simulators.filter((item) => documentCurrency(item).status === "known").length;
  const targetLabel = text(options.targetOperationLabel);
  const targetOperation = targetLabel ? {
    requestedLabel: targetLabel,
    exactJobDocument: summarizeExactLabel(jobs, targetLabel, options.operationLabelFields || [], jobIdFields, "jobAliases", records),
    exactContractDocument: summarizeExactLabel(contracts, targetLabel, options.operationLabelFields || [], contractIdFields, "contractAliases", records),
    matchPolicy: "Exact document ID or exact trimmed label-field equality; linked only by exact job/operation/contract identifiers; no fuzzy matching.",
  } : null;
  const targetCompanyName = text(options.targetCompanyName);
  const targetCompany = targetCompanyName ? summarizeExactCompanyName(companies, targetCompanyName, records) : null;
  const report = {
    mode: "READ_ONLY_HISTORICAL_CURRENCY_CENSUS",
    projectId: options.projectId || "vtc-frota-log",
    generatedAt: (options.generatedAt || new Date()).toISOString(),
    mutationCount: 0,
    productionMutations: 0,
    rawRowsPersisted: false,
    sourcePolicy: "Compiled from the source tree tripNormalizer and historicalTripCanonicalizer; app date/eligibility policy is used.",
    physicalTripDocuments: trips.length,
    physicalTripDocumentsByCollection: Object.fromEntries(Object.entries(tripsByCollection).map(([name, rows]) => [name, rows.length])),
    uniqueTripIdentityGroups: records.length,
    categoryIntegrity: { classifiedTripGroups, unclassifiedTripGroups: records.length - classifiedTripGroups },
    uniqueEntitiesBySourceCollection,
    duplicatePhysicalDocumentsByStrongIdentity: duplicatePhysicalRows,
    tripsWithStrongIdentifier: tripsWithStrongId,
    identityAliasConflictEntities: records.filter((record) => record.identityAliasConflict).length,
    identityAliasConflictFamilies,
    duplicateRecordIntegrityConflicts: recordIntegrityConflictCount,
    metricEligibility: { eligible: eligibleCount, ineligible: ineligibleCount, policy: "getTripMetricAssessment from the app source" },
    categoryCounts: classCounts,
    eligibleCategoryCounts: eligibleClassCounts,
      currencyEvidenceCounts: {
      explicitCurrencyEvidenceTripGroups: records.filter((record) => String(record.currencySource || "").startsWith("EXPLICIT_") || record.currencySource === "SERVER_VALIDATED").length,
      eligibleExplicitCurrencyEvidenceTripGroups: records.filter((record) => record.eligible && (String(record.currencySource || "").startsWith("EXPLICIT_") || record.currencySource === "SERVER_VALIDATED")).length,
      explicitlyResolvedTripGroups: classCounts.EXPLICIT_TRIP,
      eligibleExplicitlyResolvedTripGroups: eligibleClassCounts.EXPLICIT_TRIP,
      explicitVsSimulatorConflictTripGroups: explicitSimulatorCurrencyConflictCount,
      currencyConflictTripGroups: classCounts.CONFLICT,
      rawRecognizedCurrencyFieldSignals: records.filter((record) => record.explicitCurrencies.length > 0).length,
      registryFallbackWithCurrencyFieldSignals: records.filter((record) => record.category === "SIMULATOR_REGISTRY" && record.explicitCurrencies.length > 0).length,
      registryFallbackWithReceiptCurrencyTextSignals: records.filter((record) => record.category === "SIMULATOR_REGISTRY" && record.receiptCurrencies.length > 0).length,
      registryFallbackReceiptCurrencyLabels,
    },
    currencyResolutionCoverage: {
      eligibleTripGroups: eligibleCount,
      resolvedEligibleTripGroups: Object.entries(eligibleClassCounts)
        .filter(([category]) => ["EXPLICIT_TRIP", "SIMULATOR_REGISTRY", "OPERATION_EVIDENCE", "CONTRACT_EVIDENCE", "COMPANY_EVIDENCE"].includes(category))
        .reduce((sum, [, count]) => sum + count, 0),
      unresolvedEligibleTripGroups: (eligibleClassCounts.UNKNOWN || 0) + (eligibleClassCounts.CONFLICT || 0),
      percent: eligibleCount ? Math.round((Object.entries(eligibleClassCounts)
        .filter(([category]) => ["EXPLICIT_TRIP", "SIMULATOR_REGISTRY", "OPERATION_EVIDENCE", "CONTRACT_EVIDENCE", "COMPANY_EVIDENCE"].includes(category))
        .reduce((sum, [, count]) => sum + count, 0) / eligibleCount) * 10000) / 100 : 0,
    },
    simulatorRegistryFallback: {
      source: "SIMULATOR_REGISTRY",
      allTripGroups: Object.values(simulatorDistribution).reduce((sum, item) => sum + item.registryFallbackGroups, 0),
      eligibleTripGroups: Object.values(simulatorDistribution).reduce((sum, item) => sum + item.registryFallbackEligibleGroups, 0),
      byCurrency: registryFallbackByCurrency,
      eligibleByCurrency: registryFallbackEligibleByCurrency,
      bySimulator: simulatorDistribution,
      explicitSimulatorCurrencyConflictCount,
      simulatorMetadataConflictCount,
      unrecognizedOrMissingSimulatorCount,
    },
    currencySourceCounts,
    categoryCountsBySourceCollection,
    eligibleCategoryCountsBySourceCollection,
    byCategoryAndSchemaGeneration,
    byCategoryAndMetricYear,
    unknownReasons,
    knownSubtotalsByCurrency,
    directAliasCoverage,
    receiptHashCandidateCoverage,
    repeatedExactReceiptHashValues: [...hashOccurrences.values()].filter((count) => count > 1).length,
    receiptHashValuesUsedForDeduplication: false,
    aliasFieldByCurrency,
    directFieldNormalizationFromApp: appNormalization,
    linkageCoverage: { tripsWithJobId: tripsWithJob, exactJobDocumentFound: linkedJobFound, tripsWithContractId: tripsWithContract, exactContractDocumentFound: linkedContractFound },
    contextualEvidence: {
      operationDocumentsWithCurrencyCandidate: operationCurrencyCandidate,
      tripOperationCurrencyHistoricallyProven: operationCurrencyHistoricallyProven,
      contractCurrencyCandidatesReferencedByTrips: contractCurrencyCandidate,
      tripContractCurrencyHistoricallyProven: contractCurrencyHistoricallyProven,
      companyCurrencyWithoutHistoricalProof: companyCurrentCurrencyCandidate,
      tripCompanyHistoricalCurrencyCandidatesNotProven: companyHistoricalCurrencyCandidate,
      tripCompanyHistoricalCurrencyProven: companyHistoricalCurrencyProven,
      simulatorDocumentsWithCurrencyConfigNotUsedAsProof: simulatorCurrencyConfigs,
    },
    receiptEvidence: { tripRowsWithPersistedRawReceiptText: rawReceiptFieldCount, ambiguousDollarSymbolRows: ambiguousDollarReceiptCount, unsupportedCurrencyTokenRows: receiptUnsupportedCurrencyTokens, simpleAutomationCurrencyUnverified: unverifiedSimpleCurrencyCount },
    sourceFamily,
    ...(targetOperation ? { targetOperation } : {}),
    ...(targetCompany ? { targetCompany } : {}),
    fieldInterpretation: {
      simpleReceiptCurrency: "Not accepted as reliable by itself on automated rows because the inspected current/legacy Android writer can infer it from simulator. Trusted only when an explicit receipt text token corroborates it; source/evidence marker fields are not trusted because no writer validates them.",
      companyCurrency: "Current company configuration never resolves a trip; only an effective historical interval or a currency record unchanged before the trip date qualifies.",
      dollarSymbol: "$ alone is ambiguous and never maps to USD/BRL/EUR.",
      deduplication: "Exact namespaced canonicalTripId/tripId/deterministicTripId/idempotencyKey/clientRequestId/fingerprint/receipt-event/capture-attempt identity only; values, date, route, driver and display name never join records.",
    },
    integrity: { outputContainsDocumentIds: false, outputContainsRoutes: false, outputContainsDriverOrCompanyNames: false, outputContainsReceiptText: false },
  };
  return report;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const input = process.argv[2];
  if (!input) throw new Error("usage: node scripts/analyze-historical-currency-evidence.mjs <snapshot.json>");
  const db = JSON.parse(fs.readFileSync(input, "utf8"));
  const result = await analyzeHistoricalCurrencyEvidence(db);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
