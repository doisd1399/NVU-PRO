import assert from "node:assert/strict";

const values = new Map<string, string>();
const storage = { getItem: (key: string) => values.get(key) || null,
  setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
Object.defineProperty(globalThis, "window", { value: { localStorage: storage, dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} }, configurable: true });
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
const { SyncEngine, syncEngine } = await import("../src/services/sync/SyncEngine");
const { OfflineDatabase } = await import("../src/services/offline/OfflineDatabase");
const { TripRegistrationService } = await import("../src/application/trip/TripRegistrationService");
const { SyncManager } = await import("../src/services/syncManager");
const { auth } = await import("../src/lib/firebase");
await auth.authStateReady();
Object.defineProperty(auth, "currentUser", { value: { uid: "queue-driver-410" }, configurable: true, writable: true });
const uid = "queue-driver-410", jobId = "queue-job-410";
let checks = 0, rejected = true, submissions = 0;
const pass = (name: string) => { checks++; console.log(`PASS ${name}`); };
const database = new OfflineDatabase({ storage });
const engine = new SyncEngine({ storage, offlineDatabase: database, getCurrentUser: () => ({ uid }), adapter: {
  push: async (trip) => {
    submissions++;
    if (rejected) throw Object.assign(new Error("Operação temporariamente indisponível para esta tentativa"), { code: "functions/failed-precondition" });
    return { confirmed: true, tripId: trip.tripId, data: { ...trip, serverValidatedAt: new Date().toISOString() } };
  },
}});
const trip = TripRegistrationService.register({ tripId: "queue-print-410", idempotencyKey: "queue-print-410",
  driverId: uid, companyId: "queue-company-410", contractId: "queue-contract-410", jobId,
  origem: "A", destino: "B", valor: 101, imageHash: "original-image-hash", source: "PRINT_PRO_REGISTRATION" } as any);
await engine.enqueue(trip);
storage.setItem("nvu.offline.trip.queue.v2", JSON.stringify([{ id: "legacy-same-trip", jobId, status: "PENDING_SYNC",
  payload: { ...trip, canonicalTripId: trip.tripId }, createdAt: Date.now(), attempts: 0 }]));
assert.equal(SyncManager.getPendingRegistrationCount(jobId), 1);
assert.equal(SyncManager.getPendingRegistrationCount("other-job"), 0);
pass("Print reservations include canonical queue and do not count the legacy alias twice");
await engine.synchronize();
assert.equal(engine.getResult(trip.tripId)?.state, "FAILED");
assert.equal(SyncManager.getPendingRegistrationCount(jobId), 0);
Object.assign(navigator, { onLine: false });
assert.equal(await SyncManager.retryTripRegistration(trip.tripId), true);
assert.equal(syncEngine.getResult(trip.tripId)?.state, "PENDING_SYNC");
assert.equal(engine.getResult(trip.tripId)?.trip.imageHash, "original-image-hash");
assert.equal(engine.getResult(trip.tripId)?.trip.idempotencyKey, trip.idempotencyKey);
pass("History retry reaches the canonical queue and preserves the original receipt and identity offline");
Object.assign(navigator, { onLine: true });
rejected = false;
// Inject a secondary panel-refresh failure after the durable server ACK.
(engine as any).reconciliation = { reconcileConfirmedTrip: async () => { throw new Error("Panel refresh failed"); } };
await engine.synchronize();
assert.equal(engine.getResult(trip.tripId)?.state, "SERVER_CONFIRMED");
assert.ok(database.get(trip.tripId)?.trip.serverValidatedAt);
pass("A panel-refresh failure cannot mark a server-confirmed trip as failed");
await Promise.all([engine.retryRegistration(trip.tripId), engine.retryRegistration(trip.tripId)]);
await engine.synchronize();
assert.equal(submissions, 2);
pass("Repeated retry taps never resubmit an acknowledged trip");

const foreign = TripRegistrationService.register({ ...trip, tripId: "foreign-queue-410", canonicalTripId: "foreign-queue-410",
  driverId: "another-driver-410" } as any);
await engine.enqueue(foreign);
await assert.rejects(() => engine.retryRegistration(foreign.tripId), /AUTH_SCOPE_MISMATCH/);
assert.equal(SyncManager.getPendingRegistrationCount(jobId), 0);
pass("Queued receipts remain isolated to their authenticated owner");
const deleted = TripRegistrationService.register({ ...trip, tripId: "deleted-queue-410", canonicalTripId: "deleted-queue-410",
  status: "DELETED", deleted: true } as any);
await engine.enqueue(deleted);
assert.equal(await engine.retryRegistration(deleted.tripId), false);
pass("Retry cannot restore a deleted trip");
console.log(`TRIP_QUEUE_RECOVERY_PASS ${checks} scenarios; mocked sender, no production requests`);
