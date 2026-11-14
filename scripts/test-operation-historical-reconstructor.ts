import assert from "node:assert/strict";
import {
  reconstructOperationHistoricalState,
  simulateNextTrip,
  simulateOfflineQueue,
  simulateReplay,
} from "../functions/src/operationHistoricalReconstructor";

const operation = { id: "op-v3", jobId: "op-v3", driverId: "d1", companyId: "co1", contractId: "ct1", totalDeliveries: 3, status: "active", progress: 1 };
const trip = (id: string, extra: Record<string, unknown> = {}) => ({ id, tripId: id, jobId: "op-v3", driverId: "d1", companyId: "co1", contractId: "ct1", status: "concluida", uploadedAt: "2026-09-01T00:00:00Z", completedAt: "2026-09-01T00:01:00Z", ...extra });

const countOnly = reconstructOperationHistoricalState({ operation, canonicalTrips: [], legacyProvenTrips: [trip("a"), trip("b"), trip("c")], allScopedTrips: [trip("a"), trip("b"), trip("c")], classificationByTripId: new Map([["a", "LEGACY_PROVEN"], ["b", "LEGACY_PROVEN"], ["c", "LEGACY_PROVEN"]]) });
assert.equal(countOnly.provenTrips, 3);
assert.equal(countOnly.projectedProgress, 3);
assert.equal(countOnly.gates.countSafe, true);
assert.equal(countOnly.gates.slotSafe, false);
assert.equal(countOnly.terminalState, "COMPLETED_CANDIDATE");
assert.equal(countOnly.blockingReasons.includes("one or more trips have no deterministic slot"), true);

const explicit = reconstructOperationHistoricalState({ operation, canonicalTrips: [], legacyProvenTrips: [trip("a", { operationSlot: 1 }), trip("b", { operationSlot: 2 }), trip("c", { operationSlot: 3 })], allScopedTrips: [trip("a", { operationSlot: 1 }), trip("b", { operationSlot: 2 }), trip("c", { operationSlot: 3 })], classificationByTripId: new Map([["a", "LEGACY_PROVEN"], ["b", "LEGACY_PROVEN"], ["c", "LEGACY_PROVEN"]]) });
assert.equal(explicit.gates.slotSafe, true);
assert.equal(explicit.gates.terminalSafe, true);
assert.equal(explicit.gates.migrationSafe, true);

const duplicate = reconstructOperationHistoricalState({ operation, canonicalTrips: [], legacyProvenTrips: [trip("a", { canonicalTripId: "same" }), trip("b", { canonicalTripId: "same" }), trip("c", { operationSlot: 3 })], allScopedTrips: [trip("a", { canonicalTripId: "same" }), trip("b", { canonicalTripId: "same" }), trip("c", { operationSlot: 3 })], classificationByTripId: new Map([["same", "LEGACY_PROVEN"], ["c", "LEGACY_PROVEN"]]) });
assert.equal(duplicate.exactDuplicates, 1);
assert.equal(duplicate.provenTrips, 2);

const overflow = reconstructOperationHistoricalState({ operation: { ...operation, totalDeliveries: 2 }, canonicalTrips: [], legacyProvenTrips: [trip("a", { operationSlot: 1 }), trip("b", { operationSlot: 2 }), trip("c", { operationSlot: 3 })], allScopedTrips: [trip("a", { operationSlot: 1 }), trip("b", { operationSlot: 2 }), trip("c", { operationSlot: 3 })], classificationByTripId: new Map([["a", "LEGACY_PROVEN"], ["b", "LEGACY_PROVEN"], ["c", "LEGACY_PROVEN"]]) });
assert.equal(overflow.terminalState, "CRITICAL_OVERFLOW");
assert.equal(overflow.gates.terminalSafe, false);

for (const n of [1, 2, 6, 12, 13, 37]) {
  const step = simulateNextTrip({ requiredTrips: n, currentProgress: n - 1, usedSlots: Array.from({ length: Math.max(0, n - 1) }, (_, i) => i + 1), tripId: `last-${n}` });
  assert.equal(step.accepted, true);
  assert.equal(step.canonicalProgress, n);
  assert.equal(step.projectedStatus, "COMPLETED");
}
const replay = simulateReplay({ tripId: "a", existingTripIds: ["a"], currentProgress: 3, requiredTrips: 3 });
assert.equal(replay.createdTrip, false);
assert.equal(replay.canonicalProgress, 3);
const offline = simulateOfflineQueue({ requiredTrips: 3, tripIds: ["a", "b", "c"], arrivalOrder: ["c", "a", "b", "a"] });
assert.deepEqual(offline.acceptedTripIds, ["a", "b", "c"]);
assert.deepEqual(offline.slots.map((entry) => entry.slot), [1, 2, 3]);
console.log("OPERATION_HISTORICAL_RECONSTRUCTOR_PASS");
