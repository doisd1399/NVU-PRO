// This deterministic storage test does not opt into Node experimental Web Locks.
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
import assert from "node:assert/strict";
import { OfflineDatabase } from "../src/services/offline/OfflineDatabase.ts";
import { SyncEngine } from "../src/services/sync/SyncEngine.ts";

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

const trip = { tripId: "trip-storage-1", driverId: "driver-1" };
const record = {
  trip,
  syncStatus: "PENDING_SYNC",
  syncVersion: 1,
  clientUpdatedAt: "2026-09-25T00:00:00.000Z",
};

const durable = new MemoryStorage();
new OfflineDatabase({ storage: durable }).save(record);
assert.equal(new OfflineDatabase({ storage: durable }).get(trip.tripId)?.syncStatus, "PENDING_SYNC");
const cachedDatabase = new OfflineDatabase({ storage: durable });
const firstRead = cachedDatabase.get(trip.tripId); firstRead.trip.driverId = "mutated-consumer";
assert.equal(cachedDatabase.get(trip.tripId).trip.driverId, "driver-1", "memoized records remain independent snapshots");
const listed = cachedDatabase.list(); listed[0].trip.driverId = "mutated-list";
assert.equal(cachedDatabase.get(trip.tripId).trip.driverId, "driver-1");
new OfflineDatabase({storage:durable}).save({...record,syncStatus:"SERVER_CONFIRMED"});
assert.equal(cachedDatabase.get(trip.tripId).syncStatus,"SERVER_CONFIRMED","another writer invalidates the memo");

const readFailure = new OfflineDatabase({ storage: {
  getItem() { throw new Error("SecurityError"); },
  setItem() { throw new Error("should not write"); },
} });
assert.throws(() => readFailure.list(), /OFFLINE_STORAGE_READ_FAILED/);

const corrupt = new OfflineDatabase({ storage: {
  getItem() { return "{"; },
  setItem() { throw new Error("must preserve corrupt data"); },
} });
assert.throws(() => corrupt.list(), /OFFLINE_STORAGE_DATA_CORRUPT/);

const quota = new OfflineDatabase({ storage: {
  getItem() { return null; },
  setItem() { throw new Error("QuotaExceededError"); },
} });
assert.throws(() => quota.save(record), /OFFLINE_STORAGE_WRITE_FAILED/);

const syncReadFailure = new SyncEngine({
  adapter: { async push() { throw new Error("not used"); } },
  getCurrentUser: () => ({ uid: "driver-1" }),
  storage: { getItem() { throw new Error("SecurityError"); }, setItem() {} },
});
await assert.rejects(syncReadFailure.enqueue(trip), /SYNC_QUEUE_STORAGE_READ_FAILED/);

const syncCorrupt = new SyncEngine({
  adapter: { async push() { throw new Error("not used"); } },
  getCurrentUser: () => ({ uid: "driver-1" }),
  storage: { getItem() { return "{"; }, setItem() {} },
});
await assert.rejects(syncCorrupt.enqueue(trip), /SYNC_QUEUE_STORAGE_READ_FAILED/);

const syncWriteFailure = new SyncEngine({
  adapter: { async push() { throw new Error("not used"); } },
  getCurrentUser: () => ({ uid: "driver-1" }),
  storage: { getItem() { return null; }, setItem() { throw new Error("QuotaExceededError"); } },
});
await assert.rejects(syncWriteFailure.enqueue(trip), /SYNC_QUEUE_STORAGE_WRITE_FAILED/);

const recoveryStorage = new MemoryStorage();
const recoveryTrip = {
  tripId: "trip-abandoned-syncing",
  clientRequestId: "trip-abandoned-syncing",
  idempotencyKey: "offline:trip-abandoned-syncing",
  driverId: "driver-1",
  companyId: "company-1",
  jobId: "job-1",
  source: "PRINT",
  status: "SYNCING",
  createdAt: "2026-09-25T00:00:00.000Z",
  updatedAt: "2026-09-25T00:00:00.000Z",
  clientUpdatedAt: "2026-09-25T00:00:00.000Z",
  syncVersion: 1,
  deleted: false,
};
recoveryStorage.setItem("nvu_sync_queue_v2", JSON.stringify({
  [recoveryTrip.tripId]: {
    trip: recoveryTrip,
    state: "SYNCING",
    attempts: 1,
    queuedAt: "2026-09-25T00:00:00.000Z",
    syncingAt: "2026-09-25T00:00:00.000Z",
  },
}));
let replayCount = 0;
const recoveryEngine = new SyncEngine({
  adapter: {
    async push(input) {
      replayCount += 1;
      assert.equal(input.tripId, recoveryTrip.tripId);
      return {
        confirmed: true,
        tripId: recoveryTrip.tripId,
        data: { serverValidatedAt: "2026-09-26T00:00:00.000Z" },
      };
    },
  },
  getCurrentUser: () => ({ uid: "driver-1" }),
  offlineDatabase: new OfflineDatabase({ storage: recoveryStorage }),
  storage: recoveryStorage,
});
const recoveryResult = await recoveryEngine.synchronize();
assert.equal(replayCount, 1, "abandoned SYNCING item must be retried once on recovery");
assert.equal(recoveryResult.synchronized, 1);
assert.equal(recoveryEngine.getResult(recoveryTrip.tripId)?.state, "SERVER_CONFIRMED");

console.log("PASS: persistent offline storage survives reload; storage errors fail closed; abandoned SYNCING item recovers to server ACK");
