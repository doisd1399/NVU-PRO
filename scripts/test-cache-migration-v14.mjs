import assert from "node:assert/strict";
import { canonicalTripMigrationService } from "../src/application/trip/CanonicalTripMigrationService.ts";
import { getOfflineTrips, OFFLINE_TRIP_QUEUE_KEY, OFFLINE_TRIP_QUEUE_LEGACY_KEY } from "../src/lib/offlineTripQueue.ts";

const values = new Map();
let failQueueWrites = false;
const storage = {
  get length() { return values.size; },
  key(index) { return [...values.keys()][index] ?? null; },
  getItem(key) { return values.get(key) ?? null; },
  setItem(key, value) {
    if (failQueueWrites && key === OFFLINE_TRIP_QUEUE_KEY) throw new Error("QuotaExceededError");
    values.set(key, String(value));
  },
  removeItem(key) { values.delete(key); },
};
globalThis.window = { localStorage: storage };
globalThis.localStorage = storage;

const pending = { id: "offline-1", status: "PENDING_SYNC", attempts: 0, payload: { jobId: "job-1" } };
storage.setItem(OFFLINE_TRIP_QUEUE_KEY, JSON.stringify([pending]));
storage.setItem(OFFLINE_TRIP_QUEUE_LEGACY_KEY, JSON.stringify([pending]));
storage.setItem("nvu.persisted.v3.active-operation.old", "stale");
storage.setItem("nvu.ranking.snapshot.v2.old", "stale");
storage.setItem("nvu.trips.v2:offline-history", "keep-for-offline");
storage.setItem("nvu.canonical.migration.v13", JSON.stringify({ version: 13 }));
const report = canonicalTripMigrationService.validateStartup();
assert.equal(report.version, 14);
assert.equal(storage.getItem("nvu.persisted.v3.active-operation.old"), null);
assert.equal(storage.getItem("nvu.ranking.snapshot.v2.old"), null);
assert.equal(storage.getItem("nvu.trips.v2:offline-history"), "keep-for-offline");
assert.deepEqual(getOfflineTrips().map(({ id }) => id), ["offline-1"]);
assert.deepEqual(canonicalTripMigrationService.validateStartup().removedKeys, []);

// Once v2 has been drained, a leftover v1 record must never be replayed.
storage.setItem(OFFLINE_TRIP_QUEUE_KEY, "[]");
assert.deepEqual(getOfflineTrips(), []);

values.delete(OFFLINE_TRIP_QUEUE_KEY);
storage.setItem(OFFLINE_TRIP_QUEUE_LEGACY_KEY, JSON.stringify([
  pending,
  { ...pending, id: "already-synced", status: "SYNCED" },
  { ...pending, id: "failed", status: "FAILED" },
]));
assert.deepEqual(getOfflineTrips().map(({ id, status }) => [id, status]), [
  ["offline-1", "PENDING_SYNC"], ["failed", "FAILED"],
]);
assert.equal(storage.getItem(OFFLINE_TRIP_QUEUE_LEGACY_KEY), null);

values.delete(OFFLINE_TRIP_QUEUE_KEY);
storage.setItem(OFFLINE_TRIP_QUEUE_LEGACY_KEY, JSON.stringify([pending]));
failQueueWrites = true;
assert.deepEqual(getOfflineTrips().map(({ id }) => id), ["offline-1"]);
assert.ok(storage.getItem(OFFLINE_TRIP_QUEUE_LEGACY_KEY));
console.log("PASS: migração v14 preserva dados offline, não reenvia fila antiga e mantém pendências se faltar espaço");
