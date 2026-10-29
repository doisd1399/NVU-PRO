import assert from "node:assert/strict";
import { CanonicalTripRepository } from "../src/repositories/CanonicalTripRepository";
import { OfflineDatabase } from "../src/services/offline/OfflineDatabase";
import { SyncEngine } from "../src/services/sync/SyncEngine";
import { rankingProjectionService } from "../src/application/ranking/RankingProjectionService";
import { operationReconciliationService } from "../src/services/operationReconciliationService";

class MemoryStorage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
  removeItem(key: string) { this.values.delete(key); }
}

const localStorage = new MemoryStorage();
const windowTarget = new EventTarget();
Object.defineProperty(windowTarget, "localStorage", { value: localStorage });
(globalThis as any).window = windowTarget;
(globalThis as any).localStorage = localStorage;

const baseTrip = (id: string) => ({
  canonicalTripId: id,
  tripId: id,
  clientRequestId: id,
  idempotencyKey: `print:${id}`,
  source: "PRINT",
  status: "concluida",
  recordStatus: "concluida",
  driverId: "driver-13",
  companyId: "company-13",
  operationId: "operation-13",
  jobId: "operation-13",
  simulatorId: "GTO",
  contractId: "contract-13",
  valor: 100,
  earnings: 100,
  createdAt: "2026-09-27T08:00:00.000Z",
  completedAt: "2026-09-27T08:00:00.000Z",
  deleted: false,
});

const queueEvents: string[] = [];
const queue = {
  async enqueue(trip: any) { queueEvents.push(`UPSERT:${trip.canonicalTripId}`); },
  async enqueueDeletion(trip: any) { queueEvents.push(`DELETE:${trip.canonicalTripId}`); },
};
const repository = new CanonicalTripRepository({
  database: new OfflineDatabase({ storage: localStorage }),
  queue,
});

const local = await repository.saveLocal(baseTrip("trip-13-1") as any);
assert.equal(local.status, "PENDING_SYNC");
assert.deepEqual(queueEvents, ["UPSERT:trip-13-1"]);
assert.equal(repository.list().length, 1);

const confirmed = repository.applyServerSnapshot({
  ...local,
  status: "SERVER_CONFIRMED",
  recordStatus: "concluida",
  syncStatus: "synced",
  offlineSyncStatus: "synced",
  serverValidatedAt: "2026-09-27T08:01:00.000Z",
  serverVersion: 1,
} as any);
assert.equal(confirmed.status, "SERVER_CONFIRMED");
assert.equal(repository.list().length, 1);

await repository.deleteLocal("trip-13-1", "driver-13");
assert.equal(repository.list().length, 0, "deleted trip disappears from canonical history immediately");
assert.deepEqual(queueEvents, ["UPSERT:trip-13-1", "DELETE:trip-13-1"]);

const afterRestart = new CanonicalTripRepository({
  database: new OfflineDatabase({ storage: localStorage }),
  queue,
});
afterRestart.hydrate();
assert.equal(afterRestart.list().length, 0, "tombstone survives repository restart");
const staleServerReplay = afterRestart.applyServerSnapshot({ ...baseTrip("trip-13-1"), physicalDocumentId: "trip-13-1" } as any);
assert.equal(staleServerReplay.deleted, true, "stale server snapshot cannot resurrect tombstone");
assert.equal(afterRestart.list().length, 0);

const live = afterRestart.applyServerSnapshot({
  ...baseTrip("trip-13-2"),
  status: "SERVER_CONFIRMED",
  recordStatus: "concluida",
  syncStatus: "synced",
  offlineSyncStatus: "synced",
  serverValidatedAt: "2026-09-27T08:03:00.000Z",
} as any);
const ranking = rankingProjectionService.project([live], {
  scope: "global",
  simulatorId: "GTO",
});
assert.equal(ranking.rows[0]?.trips, 1, "global ranking reads confirmed canonical projection");
assert.equal(ranking.tripIds.includes("trip-13-2"), true);

const operation = operationReconciliationService.rebuild({
  operationId: "operation-13",
  driverId: "driver-13",
  companyId: "company-13",
  simulatorId: "GTO",
  contractId: "contract-13",
  totalDeliveries: 2,
  status: "active",
});
assert.equal(operation.progress, 1);
assert.equal(operation.confirmedProgress, 1);

const conflictStorage = new MemoryStorage();
const conflictQueueStorage = new MemoryStorage();
const conflictTrip = baseTrip("trip-13-conflict");
const conflictEngine = new SyncEngine({
  getCurrentUser: () => ({ uid: "driver-13" }),
  offlineDatabase: new OfflineDatabase({ storage: conflictStorage }),
  storage: conflictQueueStorage,
  adapter: {
    async push() {
      throw Object.assign(new Error("CANONICAL_TRIP_CONFLICT"), {
        code: "CANONICAL_TRIP_CONFLICT",
        serverTrip: {
          ...conflictTrip,
          status: "SERVER_CONFIRMED",
          serverValidatedAt: "2026-09-27T08:04:00.000Z",
          serverVersion: 2,
        },
      });
    },
  },
});
await conflictEngine.enqueue(conflictTrip as any);
const conflictResult = await conflictEngine.synchronize();
assert.equal(conflictResult.results[0]?.conflictResolution, "SERVER_WON");
assert.equal(conflictEngine.getResult("trip-13-conflict")?.state, "SERVER_CONFIRMED");

console.log("PASS ETAPA13 canonical source: offline, ACK, tombstone, restart, ranking, operation reconciliation and conflict resolution");
