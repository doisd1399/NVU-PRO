#!/usr/bin/env node
/**
 * Read-only, field-masked Firestore snapshot via the already-authorized Firebase CLI session.
 * Raw rows exist only in a mode-0700 temporary directory and are removed in finally.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectId = "vtc-frota-log";
if (process.env.NVU_ALLOW_PRODUCTION_READ !== "1") throw new Error("Set NVU_ALLOW_PRODUCTION_READ=1 to confirm read-only access.");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(process.argv[2] || path.join(root, "../results/production"));
if (outDir === root || outDir.startsWith(`${root}${path.sep}`)) throw new Error("Output must be outside the source tree.");
fs.mkdirSync(outDir, { recursive: true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-firestore-readonly-"));
fs.chmodSync(temporary, 0o700);
const salt = crypto.randomBytes(32);
const hmac = value => crypto.createHmac("sha256", salt).update(String(value)).digest("hex");
const projectRoot = process.cwd();
const requireProject = createRequire(path.join(root, "package.json"));
const firebaseBin = fs.realpathSync(execFileSync("which", ["firebase"], { encoding: "utf8" }).trim());
const firebasePackageRoot = path.resolve(path.dirname(firebaseBin), "../..");
const requireFirebase = createRequire(path.join(firebasePackageRoot, "package.json"));
const firebaseAuth = requireFirebase("./lib/auth");
const configstore = requireFirebase("./lib/configstore").configstore;
const account = firebaseAuth.getGlobalDefaultAccount();
const loginScopes = configstore.get("loginScopes") || [];
if (!account?.tokens?.refresh_token) throw new Error("Existing Firebase CLI session is not authenticated; no new credential will be requested.");
if (!loginScopes.includes("https://www.googleapis.com/auth/cloud-platform")) throw new Error("Existing Firebase CLI consent lacks cloud-platform; no reauthorization will be requested.");

const fields = {
  historico_viagens: ["canonicalTripId","tripId","originalCanonicalTripId","originalTripId","idempotencyKey","clientRequestId","companyId","company_id","empresaId","empresa_id","fleetId","frotaId","historicalCompanyId","originalCompanyId","empresaOriginalId","companyIdOriginal","legacyCompanyId","canonicalCompanyId","driverId","driver_id","motoristaId","motorista_id","userId","uid","criadoPor","canonicalDriverId","originalDriverId","jobId","trabalhoId","operationId","contractId","contratoId","status","recordStatus","cancelado","deleted","softDeleted","deletedAt","deletedBy","currency","moeda","simpleReceiptCurrency","moneyCurrency","valorCents","amountCents","earningsCents","valor","value","totalValue","ganho","earnings","completedAt","completedAtLocal","dataFechamento","date","dataLancamento","dataViagem","createdAt","updatedAt","createdAtLocal","localCreatedAt","offlineCreatedAt","serverValidatedAt","serverUpdatedAt","serverConfirmedAt","uploadedAt","source","offlineSyncStatus","syncStatus","validationStatus","simulatorId","simuladorId","simulatorKey","simuladorKey","simulator","simulador","simulatorCode","simulatorName","simuladorNome","simulatorLabel","companyName","company_name","empresaNome"],
  trip_history: ["companyId","company_id","empresaId","empresa_id","fleetId","frotaId","historicalCompanyId","originalCompanyId","driverId","driver_id","motoristaId","motorista_id","userId","uid","jobId","trabalhoId","operationId","contractId","contratoId","status","recordStatus","deleted","softDeleted","cancelado","currency","moeda","valorCents","amountCents","earningsCents","valor","value","totalValue","ganho","completedAt","dataFechamento","date","dataLancamento","createdAt","serverValidatedAt","serverUpdatedAt","uploadedAt","source","offlineSyncStatus","syncStatus","simulatorId","simuladorId","simulatorKey","simuladorKey","simulator","simulador","simulatorName","simuladorNome","companyName","empresaNome"],
  trips: ["canonicalTripId","tripId","originalCanonicalTripId","originalTripId","companyId","company_id","empresaId","empresa_id","fleetId","frotaId","historicalCompanyId","originalCompanyId","empresaOriginalId","driverId","driver_id","motoristaId","motorista_id","userId","uid","criadoPor","jobId","trabalhoId","operationId","contractId","contratoId","status","recordStatus","cancelado","deleted","softDeleted","currency","moeda","simpleReceiptCurrency","moneyCurrency","valorCents","amountCents","earningsCents","valor","value","totalValue","ganho","earnings","completedAt","completedAtLocal","dataFechamento","date","dataLancamento","dataViagem","createdAt","updatedAt","createdAtLocal","localCreatedAt","offlineCreatedAt","serverValidatedAt","serverUpdatedAt","serverConfirmedAt","uploadedAt","source","offlineSyncStatus","syncStatus","validationStatus","simulatorId","simuladorId","simulatorKey","simuladorKey","simulator","simulador","simulatorCode","simulatorName","simuladorNome","companyName","empresaNome"],
  viagens: ["companyId","company_id","empresaId","empresa_id","fleetId","frotaId","historicalCompanyId","originalCompanyId","driverId","driver_id","motoristaId","motorista_id","userId","uid","jobId","trabalhoId","operationId","contractId","contratoId","status","recordStatus","deleted","softDeleted","cancelado","currency","moeda","valorCents","amountCents","valor","value","totalValue","ganho","completedAt","dataFechamento","date","dataLancamento","createdAt","serverValidatedAt","serverUpdatedAt","uploadedAt","source","offlineSyncStatus","syncStatus","simulatorId","simuladorId","simulatorKey","simuladorKey","simulator","simulador","simulatorName","simuladorNome","companyName","empresaNome"],
  frotas: ["companyName","fleetName","nome","name","razaoSocial","ownerId","ownerUid","userId","createdBy","companyId","empresaId","currency","moeda","moneyCurrency","receiptCurrency","simulatorId","simuladorId","simulatorKey","simuladorKey","simulator","simulador","simulatorCode","simulatorName","simuladorNome","label","title","displayName","code","slug","key","status","situacao","state","active","deleted","softDeleted","excluida","excluido","createdAt","updatedAt","verifiedAliases","companyAliases","legacyCompanyIds","historicalCompanyIds","canonicalCompanyId","migrationReferences"],
  users: ["id","email","companyId","company_id","empresaId","companyIds","memberships","status","role","roles","canonicalUserId","active","deleted"],
  companyMembers: ["companyId","userId","uid","driverId","role","roles","status","active","isActive","createdAt","updatedAt","validFrom","validUntil","startsAt","endsAt","startAt","endAt","joinedAt","revokedAt","deleted"],
  contratos: ["companyId","empresaId","contractId","contratoId","status","active","currency","moeda","moneyCurrency","receiptCurrency","createdAt","updatedAt"],
  trabalhos: ["driverId","driver_id","motoristaId","motorista_id","assignedDriverId","userId","companyId","company_id","empresaId","empresa_id","contractId","contratoId","status","jobStatus","progress","totalDeliveries","lastValidatedTripId","lastDeletedTripId","operationCompletedAt","finishedAt","currency","moeda","moneyCurrency","receiptCurrency","createdAt","updatedAt","simulatorId","simuladorId","simulatorName","simuladorNome"],
  simulators: ["name","nome","label","title","displayName","code","slug","key","simulatorId","simuladorId"],
  simulator_members: ["userId","companyId","simulatorId","role","roles","status","createdAt","updatedAt","validFrom","validUntil","startsAt","endsAt","revokedAt","deleted"],
};
const collections = Object.keys(fields);
const collectionCoverage = {};
const snapshot = {};
let token = null;
const getToken = async () => {
  const refreshed = await firebaseAuth.getAccessToken(account.tokens.refresh_token, loginScopes);
  token = typeof refreshed === "string" ? refreshed : refreshed?.access_token;
  if (!token) throw new Error("Firebase CLI did not return an access token.");
  return token;
};
const apiRoot = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
async function listCollection(name) {
  const rows = [];
  let pageToken = null, pages = 0, terminated = false, error = null;
  do {
    const url = new URL(`${apiRoot}/${encodeURIComponent(name)}`);
    url.searchParams.set("pageSize", "1000");
    for (const field of fields[name]) url.searchParams.append("mask.fieldPaths", field);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${await getToken()}` }, signal: AbortSignal.timeout(45000) });
    pages++;
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      error = { httpStatus: response.status, status: body.error?.status || null };
      break;
    }
    const body = await response.json();
    for (const doc of body.documents || []) {
      const id = decodeURIComponent(doc.name.split("/").at(-1));
      rows.push({ id, data: decodeFields(doc.fields || {}) });
    }
    pageToken = body.nextPageToken || null;
    if (!pageToken) terminated = true;
  } while (pageToken && pages < 100000);
  collectionCoverage[name] = { pages, documents: rows.length, terminated, error, fieldMask: fields[name] };
  snapshot[name] = rows;
}
function decodeValue(value) {
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) { const n=Number(value.integerValue); return Number.isSafeInteger(n) ? n : value.integerValue; }
  if ("doubleValue" in value) return value.doubleValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("referenceValue" in value) return value.referenceValue;
  if ("bytesValue" in value) return "[bytes_omitted]";
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeValue);
  if ("mapValue" in value) return decodeFields(value.mapValue.fields || {});
  return null;
}
function decodeFields(map) { return Object.fromEntries(Object.entries(map).map(([key, value]) => [key, decodeValue(value)])); }
function writePrivate(file, value) { fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600, flag: "wx" }); }
const normalizeBusinessName = value => String(value || "").trim().toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const safeAggregateDocumentId = (simulatorId, periodKey) => `v4__${encodeURIComponent(simulatorId)}__${periodKey}`.replace(/[^a-zA-Z0-9%_.~-]/g, "_").slice(0, 1400);
const fieldPathForMapKey = key => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : `\`${String(key).replace(/\\/g, "\\\\").replace(/`/g, "\\`")}\``;
const normalizeBackendToken = value => String(value || "").trim().toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
const canonicalBackendSimulatorAlias = value => {
  const key = normalizeBackendToken(value);
  const aliases = { gto:"gto", globaltruckonline:"gto", wtds:"wtds", worldtruckdrivingsimulator:"wtds", wbds:"wbds", worldbusdrivingsimulator:"wbds", toe3:"toe3", truckersofeurope3:"toe3", ets2:"ets2", eurotrucksimulator2:"ets2", ats:"ats", americantrucksimulator:"ats", pbs:"pbs", protonbussimulator:"pbs" };
  return aliases[key] || key;
};
const hasUnsupportedSimulatorIdentity = data => [data?.simulatorName,data?.simuladorNome,data?.simulator,data?.simulador,data?.name,data?.nome,data?.label,data?.title,data?.displayName].some(value => normalizeBackendToken(value) === "grandtrucksimulator");
function buildBackendSimulatorCatalog(simulators) {
  const ids = new Set(), aliases = new Map();
  for (const simulator of simulators) {
    const semantic = [simulator.name,simulator.nome,simulator.label,simulator.title,simulator.displayName,simulator.code,simulator.slug,simulator.key];
    if (semantic.some(value => normalizeBackendToken(value) === "grandtrucksimulator")) continue;
    ids.add(simulator.id);
    const name = String(simulator.name || simulator.nome || simulator.label || simulator.title || simulator.id || "").trim();
    for (const alias of new Set([simulator.id,name,simulator.code,simulator.slug,simulator.key,simulator.simulatorId,simulator.simuladorId].map(value => String(value || "").trim()).filter(Boolean))) {
      if (normalizeBackendToken(alias) === "grandtrucksimulator") continue;
      aliases.set(alias, simulator.id);
      const canonical = canonicalBackendSimulatorAlias(alias);
      if (canonical) aliases.set(canonical, simulator.id);
    }
  }
  return { ids, aliases };
}
const backendSimulatorCandidates = data => [data?.simulatorId,data?.simuladorId,data?.simulatorKey,data?.simuladorKey,data?.simulatorName,data?.simuladorNome,data?.simulator,data?.simulador].map(value => String(value || "").trim()).filter(Boolean);
const resolveBackendSimulator = (trip, company, catalog) => {
  if (hasUnsupportedSimulatorIdentity(company) || (!company && hasUnsupportedSimulatorIdentity(trip))) return "";
  for (const candidate of [...(company ? backendSimulatorCandidates(company) : []), ...backendSimulatorCandidates(trip)]) {
    if (normalizeBackendToken(candidate) === "grandtrucksimulator") continue;
    if (catalog.ids.has(candidate)) return candidate;
    const exact = catalog.aliases.get(candidate);
    if (exact) return exact;
    const normalized = canonicalBackendSimulatorAlias(candidate);
    const resolved = normalized ? catalog.aliases.get(normalized) : undefined;
    if (resolved) return resolved;
  }
  return "";
};
async function readCurrentPeriodAggregates() {
  const candidates = (snapshot.frotas || []).filter(row => normalizeBusinessName(row.data.companyName || row.data.fleetName || row.data.nome || row.data.name || row.data.razaoSocial) === "dc transportes");
  const simulators = (snapshot.simulators || []).map(row => ({ ...row.data, id: row.id }));
  const companies = (snapshot.frotas || []).map(row => ({ ...row.data, id: row.id }));
  const esbuild = requireProject("esbuild");
  const periodsPath = path.join(temporary, "compiled-backend-ranking-calendar.mjs");
  await esbuild.build({ entryPoints: [path.join(root, "functions/src/rankingCalendar.ts")], outfile: periodsPath, format: "esm", platform: "node", logLevel: "silent" });
  const { periodsForDate } = await import(pathToFileURL(periodsPath).href);
  const backendSimulatorCatalog = buildBackendSimulatorCatalog(simulators);
  const simulatorIds = [...backendSimulatorCatalog.ids];
  const referenceTime = new Date("2026-10-05T06:46:15-03:00");
  const periodPairs = periodsForDate(referenceTime).map(period => ({ periodType: period.type, periodKey: period.key }));
  const records = [];
  let directReads = 0;
  for (const simulatorId of simulatorIds) {
    for (const period of periodPairs) {
      const documentId = safeAggregateDocumentId(simulatorId, period.periodKey);
      const url = new URL(`${apiRoot}/ranking_aggregates/${encodeURIComponent(documentId)}`);
      const commonFields = ["schemaVersion","simulatorId","periodType","periodKey","periodTimeZone","periodPolicy","periodClosed","complete","sourceTripCount","updatedAt","lastReconciledAt"];
      for (const field of commonFields) url.searchParams.append("mask.fieldPaths", field);
      for (const candidate of candidates) url.searchParams.append("mask.fieldPaths", `companies.${fieldPathForMapKey(candidate.id)}`);
      const response = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${await getToken()}` }, signal: AbortSignal.timeout(30000) });
      directReads++;
      const body = await response.json().catch(() => ({}));
      const data = response.ok ? decodeFields(body.fields || {}) : null;
      const schemaValid = Boolean(data && data.schemaVersion === 4 && data.simulatorId === simulatorId && data.periodType === period.periodType && data.periodKey === period.periodKey && data.periodTimeZone === "America/Sao_Paulo" && data.periodPolicy === "SAO_PAULO_CALENDAR" && data.complete === true);
      const candidateStats = candidates.map(candidate => {
        const stat = data?.companies?.[candidate.id];
        const canonicalCompanySimulator = resolveBackendSimulator({}, candidate.data, backendSimulatorCatalog);
        return { companyIdPseudonym: `company_${hmac(candidate.id).slice(0,20)}`, candidateCurrentSimulatorMatchesAggregate: canonicalCompanySimulator === simulatorId, presentInAggregate: Boolean(stat), trips: stat && Number.isFinite(Number(stat.trips)) ? Math.trunc(Number(stat.trips)) : null, value: stat && Number.isFinite(Number(stat.val)) ? Number(stat.val) : null };
      });
      records.push({ simulatorId, periodType: period.periodType, periodKey: period.periodKey, documentId, httpStatus: response.status, found: response.ok, schemaValid, data, candidateStats });
    }
  }
  return { candidates, simulators, referenceTime: referenceTime.toISOString(), periodPairs, directReads, records };
}

try {
  for (const name of collections) await listCollection(name);
  const incomplete = Object.entries(collectionCoverage).filter(([, value]) => !value.terminated || value.error);
  const aggregateEvidence = incomplete.length ? { candidates: [], simulators: [], referenceTime: null, periodPairs: [], directReads: 0, records: [], skipped: "source collections incomplete" } : await readCurrentPeriodAggregates();
  const publicCoverage = Object.fromEntries(Object.entries(collectionCoverage).map(([name, value]) => [name, { pages: value.pages, documents: value.documents, terminated: value.terminated, error: value.error, fieldMask: value.fieldMask }]));
  const email = String(account.user?.email || "").trim().toLowerCase();
  const emailHmac = email ? hmac(email) : null;
  const readManifest = {
    mode: "TARGETED_FIRESTORE_READ_ONLY",
    projectId,
    startedAt: new Date().toISOString(),
    accessMethod: "existing Firebase CLI OAuth session; existing consented scopes only",
    consentedCloudPlatformScope: loginScopes.includes("https://www.googleapis.com/auth/cloud-platform"),
    firebaseCliAccountEmailPseudonym: emailHmac ? `email_${emailHmac.slice(0, 20)}` : null,
    firebaseCliAccountIsNotAppSessionProof: true,
    requestMethod: "GET only for Firestore; no production mutations",
    productionMutations: 0,
    productionReads: Object.values(collectionCoverage).reduce((sum, value) => sum + value.pages, 0) + aggregateEvidence.directReads,
    atomicSnapshot: false,
    sourceCoverage: publicCoverage,
    rankingAggregateReads: { mode: "exact_document_GETs_only", directReads: aggregateEvidence.directReads, foundDocuments: aggregateEvidence.records.filter(record => record.found).length, targetedDocuments: aggregateEvidence.records.length, referenceTime: aggregateEvidence.referenceTime, periods: aggregateEvidence.periodPairs, simulatorCount: aggregateEvidence.simulators.length, exactNameCandidateCount: aggregateEvidence.candidates.length, skipped: aggregateEvidence.skipped || null },
    scope: "Only source, identity, membership, simulator and referenced consumer-support collections; field masks exclude names/photos/phone and unrelated payloads.",
    credentialMaterialIncluded: false,
    pseudonymSaltIncluded: false,
  };
  fs.writeFileSync(path.join(outDir, "read-source-manifest.json"), `${JSON.stringify(readManifest, null, 2)}\n`, { mode: 0o600 });
  if (incomplete.length) {
    const summary = { status: "blocked_partial_read", failedCollections: incomplete.map(([name, value]) => ({ collection: name, pages: value.pages, documents: value.documents, error: value.error })), coverage: publicCoverage };
    fs.writeFileSync(path.join(outDir, "read-blocked.json"), `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify({ status: summary.status, failedCollections: summary.failedCollections.length, productionReads: readManifest.productionReads, productionMutations: 0 }));
    process.exitCode = 4;
  } else {
    readManifest.finishedAt = new Date().toISOString();
    snapshot.ranking_aggregates = aggregateEvidence.records.filter(record => record.found && record.data).map(record => ({ id: record.documentId, data: record.data }));
    writePrivate(path.join(temporary, "snapshot.json"), snapshot);
    writePrivate(path.join(temporary, "read-source-manifest.json"), readManifest);
    const currencyEvidenceRun = spawnSync(process.execPath, [path.join(root, "scripts/analyze-historical-currency-evidence.mjs"), path.join(temporary, "snapshot.json")], { cwd: root, encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 });
    if (currencyEvidenceRun.status === 0) {
      fs.writeFileSync(path.join(outDir, "historical-currency-evidence.json"), currencyEvidenceRun.stdout, { mode: 0o600 });
    } else {
      fs.writeFileSync(path.join(outDir, "historical-currency-evidence-failed.json"), JSON.stringify({ exitCode: currencyEvidenceRun.status, error: String(currencyEvidenceRun.stderr || "").split("\n")[0] }, null, 2), { mode: 0o600 });
    }
    const adminModule = path.join(temporary, "synthetic-admin.mjs");
    const snapshotPath = path.join(temporary, "snapshot.json");
    fs.writeFileSync(adminModule, `import fs from "node:fs";const rows=JSON.parse(fs.readFileSync(${JSON.stringify(snapshotPath)},"utf8"));const firestore=()=>({collection:name=>{let cap=500,cursor=null;const q={limit:n=>(cap=n,q),orderBy:()=>q,startAfter:x=>(cursor=typeof x==="string"?x:x.id,q),get:async()=>{const selected=(rows[name]||[]).filter(r=>!cursor||r.id>cursor).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).slice(0,cap).map(r=>({id:r.id,data:()=>r.data}));return{docs:selected,size:selected.length};}};return q;}});firestore.FieldPath={documentId:()=>({})};export default{initializeApp:()=>({}),credential:{applicationDefault:()=>({})},firestore};`, { mode: 0o600, flag: "wx" });
    const esbuild = requireProject("esbuild");
    const predicatePath = path.join(temporary, "compiled-backend-predicate.mjs");
    await esbuild.build({ entryPoints: [path.join(root, "functions/src/isCanonicalConfirmedTrip.ts")], outfile: predicatePath, format: "esm", platform: "node", logLevel: "silent" });
    const cliEmailHmac = emailHmac || "";
    const env = { ...process.env, NVU_ALLOW_PRODUCTION_READ: "1", NVU_CENSUS_SALT: salt.toString("base64url"), NVU_ADMIN_MODULE: pathToFileURL(adminModule).href, NVU_PREDICATE_MODULE: pathToFileURL(predicatePath).href, NVU_READ_SOURCE_MANIFEST: path.join(temporary, "read-source-manifest.json"), NVU_CLI_ACCOUNT_EMAIL_HMAC: cliEmailHmac };
    env.NVU_RANKING_PERIODS_MODULE = pathToFileURL(path.join(temporary, "compiled-backend-ranking-calendar.mjs")).href;
    const jobStatusPath = path.join(temporary, "compiled-job-status.mjs");
    await esbuild.build({ entryPoints: [path.join(root, "src/lib/jobStatus.ts")], outfile: jobStatusPath, format: "esm", platform: "node", logLevel: "silent" });
    env.NVU_JOB_STATUS_MODULE = pathToFileURL(jobStatusPath).href;
    for (const key of ["GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_APPLICATION_CREDENTIALS_JSON"]) delete env[key];
    const output = path.join(outDir, "reconciliation");
    const run = spawnSync(process.execPath, [path.join(root, "reconcile-identities-a630.mjs"), output], { cwd: root, env, encoding: "utf8", timeout: 180000, maxBuffer: 1024 * 1024 });
    if (run.status !== 0) {
      fs.writeFileSync(path.join(outDir, "reconciliation-failed.json"), JSON.stringify({ exitCode: run.status, error: String(run.stderr || "").split("\n")[0], sourceCoverage: publicCoverage }, null, 2));
      console.log(JSON.stringify({ status: "reconciliation_failed", exitCode: run.status, productionReads: readManifest.productionReads, productionMutations: 0 }));
      process.exitCode = run.status || 5;
    } else {
      const result = JSON.parse(run.stdout.trim().split("\n").at(-1));
      const manifestPath = path.join(output, "production-read-manifest.json");
      const finalManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      finalManifest.salt = "ephemeral salt not retained; no raw IDs emitted";
      finalManifest.predicateExecution = "compiled_backend_source";
      finalManifest.predicateArtifactHash = crypto.createHash("sha256").update(fs.readFileSync(predicatePath)).digest("hex");
      finalManifest.predicateFingerprint = crypto.createHash("sha256").update(JSON.stringify({ mode: finalManifest.predicateExecution, artifactHash: finalManifest.predicateArtifactHash })).digest("hex");
      finalManifest.adapterCoverage = result.coverage;
      finalManifest.sourceCoverageParity = result.sourceCoverageParity;
      finalManifest.readCoverageComplete = result.readCoverageComplete;
      fs.writeFileSync(manifestPath, `${JSON.stringify(finalManifest, null, 2)}\n`);
      fs.writeFileSync(path.join(outDir, "read-source-manifest.json"), `${JSON.stringify(readManifest, null, 2)}\n`);
      const aggregateReport = {
        mode: "TARGETED_RANKING_AGGREGATE_READ_ONLY",
        projectId,
        referenceTime: aggregateEvidence.referenceTime,
        timezone: "America/Sao_Paulo",
        requestMethod: "GET only; exact v4 aggregate document IDs; top-level parser fields and nested companies for exact-name candidates only",
        productionMutations: 0,
        directReads: aggregateEvidence.directReads,
        skipped: aggregateEvidence.skipped || null,
        periodPairs: aggregateEvidence.periodPairs,
        candidateCount: aggregateEvidence.candidates.length,
        simulatorCatalogCount: aggregateEvidence.simulators.length,
        documents: aggregateEvidence.records.map(record => ({
          aggregateDocumentPseudonym: `aggregate_${hmac(record.documentId).slice(0,20)}`,
          simulatorPseudonym: `simulator_${hmac(record.simulatorId).slice(0,20)}`,
          periodType: record.periodType,
          periodKey: record.periodKey,
          httpStatus: record.httpStatus,
          found: record.found,
          schemaValidForClientV4Parser: record.schemaValid,
          schemaVersion: record.data?.schemaVersion ?? null,
          complete: record.data?.complete ?? null,
          periodTimeZone: record.data?.periodTimeZone ?? null,
          periodPolicy: record.data?.periodPolicy ?? null,
          periodClosed: record.data?.periodClosed ?? null,
          sourceTripCount: record.data?.sourceTripCount ?? null,
          updatedAt: record.data?.updatedAt ?? null,
          lastReconciledAt: record.data?.lastReconciledAt ?? null,
          candidateCompanies: record.candidateStats,
        })),
        interpretation: "The exact period comes from the user-provided 2026-10-05 06:46:15-03:00 reference. These targeted docs can validate v4 schema and candidate-specific aggregate contributions, but cannot establish which simulator/period was selected in the missing screenshot or whether a signed-in app session displayed them.",
        crossCandidateTotalsCombined: false,
      };
      fs.writeFileSync(path.join(outDir, "ranking-aggregate-supplemental.json"), `${JSON.stringify(aggregateReport, null, 2)}\n`, { mode: 0o600 });
      console.log(JSON.stringify({ status: "complete", ...result, rankingAggregateReads: aggregateEvidence.directReads, rankingAggregateRecords: aggregateEvidence.records.length, productionReads: readManifest.productionReads, productionMutations: 0, output: `${output}/` }));
    }
  }
} finally {
  salt.fill(0);
  fs.rmSync(temporary, { recursive: true, force: true });
}
