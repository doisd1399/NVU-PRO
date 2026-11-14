import assert from "node:assert/strict";
import { CanonicalTripRepository } from "../src/repositories/CanonicalTripRepository";
import { OfflineDatabase } from "../src/services/offline/OfflineDatabase";

class MemoryStorage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
const repository = new CanonicalTripRepository({
  database: new OfflineDatabase({ storage: new MemoryStorage() }),
  queue: { enqueue: async () => undefined, enqueueDeletion: async () => undefined, enqueueUpdate: async () => ({ editId: "edit-audit" }) },
  now: () => "2026-10-10T12:00:00.000Z",
});
const trip: any = {
  id: "snapshot-audit", tripId: "snapshot-audit", canonicalTripId: "snapshot-audit", idempotencyKey: "snapshot-audit",
  driverId: "driver", companyId: "company", jobId: "operation", operationId: "operation", contractId: "contract",
  simulatorId: "GTO", status: "SERVER_CONFIRMED", recordStatus: "concluida", source: "PRINT",
  createdAt: "2026-10-10T10:00:00.000Z", updatedAt: "2026-10-10T10:00:00.000Z",
  serverValidatedAt: "2026-10-10T10:00:00.000Z", uploadedAt: "2026-10-10T10:00:00.000Z",
  completedAt: "2026-10-10T10:00:00.000Z", origem: "A", destino: "B", valor: 10, currency: "BRL", syncVersion: 1,
};
const confirmed = repository.applyServerSnapshot(trip);
assert.ok(confirmed, JSON.stringify(repository.getLastSnapshotIssues()));
await repository.deleteLocal(trip.tripId, trip.driverId);
const replay = repository.applyServerSnapshot(trip);
assert.ok(replay, "rejected stale replay must return the tombstone instead of undefined");
assert.equal(replay.deleted, true);
assert.equal(repository.list().length, 0, "a rejected replay must not restore a deleted trip");
const edited = repository.applyServerSnapshot({ ...trip, id: "edited", tripId: "edited", canonicalTripId: "edited", idempotencyKey: "edited" });
await repository.editFieldsLocal(edited.tripId, { valor: 20 }, "driver");
const protectedEdit = repository.applyServerSnapshot(edited);
assert.ok(protectedEdit, "a protected local edit must still return its current projection");
assert.equal(protectedEdit.editPending, true);
console.log("CANONICAL_SNAPSHOT_RETURN_PASS tombstone and pending edit replay remain readable and cannot be overwritten");
