import assert from "node:assert/strict";

const state = new Map();
globalThis.window = new EventTarget();
globalThis.localStorage = {
  getItem: (key) => state.get(key) ?? null,
  setItem: (key, value) => state.set(key, value),
};
Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: true });

const {
  enqueueOfflineTrip,
  getOfflineTrips,
  getPendingOfflineTrips,
  getPendingOfflineTripsForJob,
  OFFLINE_TRIP_QUEUE_KEY,
  recoverInterruptedOfflineTrips,
  retryOfflineTrip,
} = await import("../src/lib/offlineTripQueue.ts");
const { SyncManager } = await import("../src/services/syncManager.ts");

const statusEvents = [];
window.addEventListener("nvu-offline-trip-status", (event) => statusEvents.push(event.detail));
let queuedEvents = 0;
window.addEventListener("nvu-offline-trip-queued", () => { queuedEvents += 1; });

enqueueOfflineTrip({ jobId: "job-a", idempotencyKey: "a1" }, { jobId: "job-a" });
enqueueOfflineTrip({ jobId: "job-a", idempotencyKey: "a2" }, { jobId: "job-a" });
enqueueOfflineTrip({ jobId: "job-b", idempotencyKey: "b1" }, { jobId: "job-b" });
const a1Id = getPendingOfflineTrips().find((item) => item.payload.idempotencyKey === "a1").id;
const b1Id = getPendingOfflineTrips().find((item) => item.payload.idempotencyKey === "b1").id;
const attempted = [];
await SyncManager.syncPendingTrips(async (item) => {
  attempted.push(item.payload.idempotencyKey);
  if (item.payload.idempotencyKey === "a1") throw new Error("temporary network connection failure");
  return { validated: true, tripId: `server-${item.payload.idempotencyKey}` };
});
assert.deepEqual(attempted, ["a1", "a2", "b1"], "falha em A não bloqueia a viagem seguinte nem a operação B");
assert.deepEqual(getPendingOfflineTrips().map((item) => item.payload.idempotencyKey), ["a1"]);
assert.deepEqual(
  statusEvents.filter((event) => event.id === b1Id).map((event) => event.status),
  ["LOCAL_CREATED", "PENDING_SYNC", "UPLOADING", "SERVER_RECEIVED", "VALIDATION_PENDING", "VALIDATED"],
  "só um ACK explícito do servidor permite VALIDATED e remoção da fila",
);
assert.deepEqual(
  statusEvents.filter((event) => event.id === a1Id).map((event) => event.status),
  ["LOCAL_CREATED", "PENDING_SYNC", "UPLOADING", "PENDING_SYNC"],
  "falha de rede volta para PENDING_SYNC sem apagar a viagem",
);

// Definitive server rejection remains visible/recoverable but never blocks a
// later trip from the same operation.
enqueueOfflineTrip({ jobId: "job-fail", idempotencyKey: "f1" }, { jobId: "job-fail" });
enqueueOfflineTrip({ jobId: "job-fail", idempotencyKey: "f2" }, { jobId: "job-fail" });
const failedId = getPendingOfflineTrips().find((item) => item.payload.idempotencyKey === "f1").id;
const failedAttempts = [];
await SyncManager.syncPendingTrips(async (item) => {
  if (item.jobId !== "job-fail") return { validated: true, tripId: `server-${item.payload.idempotencyKey}` };
  failedAttempts.push(item.payload.idempotencyKey);
  throw Object.assign(new Error("SERVER_REJECTED_TRIP_BINDING"), { code: "permission-denied" });
});
assert.deepEqual(failedAttempts, ["f1", "f2"], "falha permanente não bloqueia a viagem seguinte");
assert.equal(getOfflineTrips().find((item) => item.id === failedId).status, "FAILED");
assert.equal(getPendingOfflineTripsForJob("job-fail").length, 0, "falha terminal permanece visível sem reservar capacidade local");
assert.equal(retryOfflineTrip(failedId), true, "falha permanente pode ser tentada novamente pelo usuário");
assert.equal(getOfflineTrips().find((item) => item.id === failedId).status, "PENDING_SYNC");
assert.equal(getPendingOfflineTripsForJob("job-fail").length, 1, "retry manual volta a reservar somente a viagem reativada");
assert.ok(queuedEvents > 0, "retry manual emite evento para iniciar sincronização sem recarregar o app");

for (let index = 1; index <= 5; index += 1) {
  enqueueOfflineTrip({ jobId: "job-c", idempotencyKey: `c${index}` }, { jobId: "job-c" });
}
Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: true });
const fiveTripsAttempted = [];
await SyncManager.syncPendingTrips(async (item) => {
  if (item.jobId === "job-c") fiveTripsAttempted.push(item.payload.idempotencyKey);
  return { validated: true, tripId: `server-${item.payload.idempotencyKey}` };
});
assert.deepEqual(fiveTripsAttempted, ["c1", "c2", "c3", "c4", "c5"]);
assert.equal(new Set(fiveTripsAttempted).size, 5, "cinco viagens são reproduzidas em FIFO uma única vez por tentativa");
assert.ok(fiveTripsAttempted.every((key) => !getOfflineTrips().some((item) => item.payload.idempotencyKey === key)));

const persisted = JSON.parse(localStorage.getItem(OFFLINE_TRIP_QUEUE_KEY) || "[]");
persisted.push(
  { id: "crash-local", status: "LOCAL_CREATED", syncStatus: "LOCAL_CREATED", attempts: 0, payload: { jobId: "job-recovery" } },
  { id: "crash-sync", status: "UPLOADING", syncStatus: "UPLOADING", attempts: 1, payload: { jobId: "job-recovery" } },
  { id: "crash-server", status: "SERVER_RECEIVED", syncStatus: "SERVER_RECEIVED", attempts: 1, payload: { jobId: "job-recovery" } },
  { id: "crash-validated", status: "VALIDATED", syncStatus: "VALIDATED", attempts: 1, payload: { jobId: "job-recovery" } },
  { id: "crash-failed", status: "FAILED", syncStatus: "FAILED", attempts: 2, payload: { jobId: "job-recovery" } },
);
localStorage.setItem(OFFLINE_TRIP_QUEUE_KEY, JSON.stringify(persisted));
recoverInterruptedOfflineTrips();
const afterRecovery = getOfflineTrips().filter((item) => item.id.startsWith("crash-"));
assert.deepEqual(afterRecovery.map((item) => item.id), ["crash-local", "crash-sync", "crash-server", "crash-failed"]);
assert.deepEqual(afterRecovery.slice(0, 3).map((item) => item.status), ["PENDING_SYNC", "PENDING_SYNC", "PENDING_SYNC"]);
assert.equal(afterRecovery[3].status, "FAILED", "falha do servidor continua aguardando ação manual após reinício");
console.log("PASS: ACK obrigatório, falha recuperável/manual, FIFO por operação, cinco viagens sem duplicação e recuperação de crash");
