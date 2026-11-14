import assert from "node:assert/strict";
import { deriveCurrentOperationProgress } from "../src/lib/currentOperation";
import { filterAndSortTripHistory } from "../src/lib/tripHistoryEngine";
import { canonicalTripMigrationService } from "../src/application/trip/CanonicalTripMigrationService";
import { OfflineDatabase } from "../src/services/offline/OfflineDatabase";
import { CanonicalTripRepository } from "../src/repositories/CanonicalTripRepository";

class StorageFixture {
  values = new Map<string, string>();
  writes = 0;
  get length() { return this.values.size; }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.writes++; this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const store = new StorageFixture();
(globalThis as any).window = Object.assign(new EventTarget(), { localStorage: store });
(globalThis as any).localStorage = store;
const job = { id: "bls-10", driverId: "david", companyId: "company-1", contractId: "contract-1", progress: 1, status: "active", assignedAt: "2026-09-26T00:00:00.000Z" };
assert.equal(deriveCurrentOperationProgress(job, [], "david"), 0, "the deleted trip must not survive as job.progress=1");
const base = { id: "t1", jobId: job.id, driverId: job.driverId, companyId: job.companyId, contractId: job.contractId, status: "concluida", source: "gto_auto", uploadedAt: "2026-09-27T05:01:00.000Z", serverValidatedAt: "2026-09-27T05:01:00.000Z", completedAt: "2026-09-27T05:00:00.000Z" };
const trips = [base, { ...base, id: "other-company", companyId: "company-2" }, { ...base, id: "other-driver", driverId: "other" }, { ...base, id: "deleted", deleted: true }, { ...base, id: "pending", offlineSyncStatus: "pending_sync" }];
assert.equal(deriveCurrentOperationProgress(job, trips, "david"), 1);
assert.equal(filterAndSortTripHistory(trips, { periodPreset: "todos", embeddedJob: job }).length, 1);
assert.equal(deriveCurrentOperationProgress(job, trips.slice(1), "david"), 0, "deletion must immediately return the operation to zero");

store.setItem("nvu.persisted.v2.driver-trips.david", "cached-history");
store.setItem("nvu.canonical.migration.v13", JSON.stringify({ version: 13 }));
assert.deepEqual(canonicalTripMigrationService.validateStartup().removedKeys, []);
assert.equal(store.getItem("nvu.persisted.v2.driver-trips.david"), "cached-history", "a warm startup must retain the fast history cache");

const repository = new CanonicalTripRepository({ database: new OfflineDatabase({ storage: store }) });
const confirmed = (id: string) => ({ ...base, id, tripId: id, canonicalTripId: id, operationId: job.id, simulatorId: "GTO", source: "PRINT", serverValidatedAt: "2026-09-27T05:01:00.000Z" });
const before = store.writes;
repository.applyServerSnapshots([confirmed("batch-1"), confirmed("batch-2")] as any);
assert.equal(store.writes - before, 1, "a server snapshot must persist the batch once");
assert.equal(repository.list().length, 2);
await repository.deleteLocal("batch-1", "david");
assert.deepEqual(repository.list().map((trip) => trip.tripId), ["batch-2"]);
console.log("etapa14-operation-performance: PASS operation/history parity, deletion, warm startup, batch persistence");
