import fs from "node:fs";
import https from "node:https";

const PROJECT = process.env.FIREBASE_PROJECT || "vtc-frota-log";
const DATABASE = "(default)";
const tokenFile = process.env.FIREBASE_TOKEN_FILE || "/home/ubuntu/.config/configstore/firebase-tools.json";
const tokenConfig = JSON.parse(fs.readFileSync(tokenFile, "utf8"));
const accessToken = tokenConfig.tokens?.access_token;
if (!accessToken) throw new Error("FIREBASE_OAUTH_ACCESS_TOKEN_UNAVAILABLE");

const requestJson = (method, path, body) => new Promise((resolve, reject) => {
  const request = https.request({
    hostname: "firestore.googleapis.com",
    path,
    method,
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
  }, (response) => {
    let text = "";
    response.setEncoding("utf8");
    response.on("data", (chunk) => { text += chunk; });
    response.on("end", () => {
      let parsed;
      try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
      if (response.statusCode >= 400) return reject(new Error(`FIRESTORE_READ_${response.statusCode}:${JSON.stringify(parsed).slice(0, 500)}`));
      resolve(parsed);
    });
  });
  request.on("error", reject);
  if (body) request.write(JSON.stringify(body));
  request.end();
});

const typed = (value) => {
  if (!value || typeof value !== "object") return value;
  if (Object.hasOwn(value, "nullValue")) return null;
  if (Object.hasOwn(value, "stringValue")) return value.stringValue;
  if (Object.hasOwn(value, "booleanValue")) return value.booleanValue;
  if (Object.hasOwn(value, "integerValue")) return Number(value.integerValue);
  if (Object.hasOwn(value, "doubleValue")) return Number(value.doubleValue);
  if (Object.hasOwn(value, "timestampValue")) return value.timestampValue;
  if (Object.hasOwn(value, "referenceValue")) return value.referenceValue;
  if (Object.hasOwn(value, "bytesValue")) return "<bytes>";
  if (Object.hasOwn(value, "arrayValue")) return (value.arrayValue.values || []).map(typed);
  if (Object.hasOwn(value, "mapValue")) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, typed(item)]));
  return value;
};
const documentData = (document) => ({
  __docId: document.name?.split("/").pop() || "",
  ...Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, typed(value)])),
});

async function listCollection(collectionId) {
  const rows = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({ pageSize: "1000" });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await requestJson("GET", `/v1/projects/${PROJECT}/databases/${encodeURIComponent(DATABASE)}/documents/${collectionId}?${params}`);
    rows.push(...(page.documents || []).map(documentData));
    pageToken = page.nextPageToken || "";
  } while (pageToken);
  return rows;
}

const text = (row, ...keys) => {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
};
const date = (row, ...keys) => text(row, ...keys);
const jsonSafe = (row) => JSON.parse(JSON.stringify(row));
const contractToken = (row) => Object.values(row).filter((value) => typeof value === "string").join(" ");
const targetPattern = /(?:^|[^a-z0-9])(BS[- _]?10|X[- _]?10)(?:$|[^a-z0-9])/i;

const [contracts, jobs, trips, slots] = await Promise.all([
  listCollection("contratos"),
  listCollection("trabalhos"),
  listCollection("historico_viagens"),
  listCollection("trip_operation_slots"),
]);
const targetContracts = contracts.filter((row) => targetPattern.test(contractToken(row)));
const targetContractIds = new Set(targetContracts.map((row) => row.__docId));
const targetContractLabels = new Set(targetContracts.flatMap((row) => Object.values(row).filter((value) => typeof value === "string").map((value) => value.trim()).filter(Boolean)));
const jobMatchesTarget = (job) => targetContractIds.has(text(job, "contractId", "contratoId")) || targetPattern.test(contractToken(job)) || [...targetContractLabels].some((label) => label && contractToken(job).includes(label));
const targetJobs = jobs.filter(jobMatchesTarget);
const targetJobIds = new Set(targetJobs.map((row) => row.__docId));
const targetDriverContractPairs = new Set(targetJobs.map((job) => `${text(job, "driverId", "motoristaId", "userId")}|${text(job, "companyId", "empresaId")}|${text(job, "contractId", "contratoId")}`));
const targetTrips = trips.filter((trip) => {
  const jobId = text(trip, "jobId");
  if (jobId && targetJobIds.has(jobId)) return true;
  const pair = `${text(trip, "driverId", "motoristaId", "userId", "criadoPor")}|${text(trip, "companyId", "empresaId")}|${text(trip, "contractId", "contratoId")}`;
  return targetDriverContractPairs.has(pair) || targetPattern.test(contractToken(trip));
});
const targetSlots = slots.filter((slot) => targetJobIds.has(text(slot, "jobId")));
const byJob = new Map(targetJobs.map((job) => [job.__docId, job]));
const map = targetJobs.map((job) => {
  const jobId = job.__docId;
  const jobTrips = targetTrips.filter((trip) => text(trip, "jobId") === jobId);
  const exactCanonical = jobTrips.filter((trip) => text(trip, "jobId") === jobId && text(trip, "driverId", "motoristaId", "userId", "criadoPor") === text(job, "driverId", "motoristaId", "userId") && text(trip, "companyId", "empresaId") === text(job, "companyId", "empresaId") && text(trip, "contractId", "contratoId") === text(job, "contractId", "contratoId") && trip.deleted !== true && String(trip.status || "").toUpperCase() !== "DELETED");
  return {
    jobId,
    driverId: text(job, "driverId", "motoristaId", "userId"),
    companyId: text(job, "companyId", "empresaId"),
    contractId: text(job, "contractId", "contratoId"),
    status: text(job, "status"),
    totalDeliveries: Number(job.totalDeliveries ?? job.requiredTrips ?? 0) || 0,
    storedProgress: Number.isFinite(Number(job.progress)) ? Number(job.progress) : null,
    canonicalTripIds: exactCanonical.map((trip) => text(trip, "canonicalTripId", "tripId", "__docId")),
    canonicalTripCount: exactCanonical.length,
    slots: targetSlots.filter((slot) => text(slot, "jobId") === jobId).map((slot) => ({ tripId: text(slot, "tripId"), operationSlot: Number(slot.operationSlot) || null, deleted: slot.deleted === true })),
  };
});
const legacyUnbound = targetTrips.filter((trip) => !text(trip, "jobId")).map((trip) => ({
  tripId: text(trip, "canonicalTripId", "tripId", "__docId"),
  driverId: text(trip, "driverId", "motoristaId", "userId", "criadoPor"),
  companyId: text(trip, "companyId", "empresaId"),
  contractId: text(trip, "contractId", "contratoId"),
  operationIdPresentButNotBinding: text(trip, "operationId", "trabalhoId"),
  status: text(trip, "status", "recordStatus"),
  uploadedAt: date(trip, "uploadedAt", "createdAt", "completedAt"),
}));
const foreignBindings = targetTrips.filter((trip) => {
  const jobId = text(trip, "jobId");
  return Boolean(jobId) && !targetJobIds.has(jobId) && targetDriverContractPairs.has(`${text(trip, "driverId", "motoristaId", "userId", "criadoPor")}|${text(trip, "companyId", "empresaId")}|${text(trip, "contractId", "contratoId")}`);
}).map((trip) => ({ tripId: text(trip, "canonicalTripId", "tripId", "__docId"), jobId: text(trip, "jobId"), driverId: text(trip, "driverId", "motoristaId", "userId", "criadoPor"), contractId: text(trip, "contractId", "contratoId") }));

const report = {
  phase: "OPERATION_PROJECTION_FIX",
  mode: "READ_ONLY",
  project: PROJECT,
  generatedAt: new Date().toISOString(),
  sourceCollectionsRead: ["contratos", "trabalhos", "historico_viagens", "trip_operation_slots"],
  mutationCount: 0,
  scopePolicy: "exact jobId + exact driverId + exact companyId + exact contractId; no driver/contract/date fallback",
  requestedLabels: ["BS-10", "X-10"],
  targetContracts: targetContracts.map(jsonSafe),
  targetJobCount: targetJobs.length,
  jobsByExecution: map,
  legacyUnboundTrips: legacyUnbound,
  foreignBindings,
  counts: { contractsRead: contracts.length, jobsRead: jobs.length, tripsRead: trips.length, slotsRead: slots.length, targetTripsRead: targetTrips.length, legacyUnbound: legacyUnbound.length, foreignBindings: foreignBindings.length },
  conclusions: [
    "Cada mapa de execução conta apenas historico_viagens.jobId igual ao ID físico do trabalho.",
    "Viagens sem jobId ficam fora da projeção; operationId/trabalhoId não substituem jobId.",
    "Nenhuma alteração, backfill, repair, write, callable ou deploy foi executado por este script.",
  ],
};
const output = process.env.OUTPUT || "PRODUCTION_JOBID_AUDIT_READONLY.json";
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ output, mode: report.mode, targetContracts: targetContracts.length, targetJobs: targetJobs.length, targetTrips: targetTrips.length, legacyUnbound: legacyUnbound.length, foreignBindings: foreignBindings.length }, null, 2));
