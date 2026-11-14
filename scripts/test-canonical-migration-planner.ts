import assert from "node:assert/strict";
import { planCanonicalMigration, executeCanonicalMigration, buildMigrationDecision } from "../functions/src/canonicalMigrationPlanner";
import { rebuildOperationProjection } from "../functions/src/rebuildOperationProjection";

const base = (requiredTrips: number, progress: number, status = "active", patch: Record<string, any> = {}) => ({
  operationId: `op-${requiredTrips}-${progress}-${status}`,
  requiredTrips, requiredTripsBefore: requiredTrips, requiredTripsClassification: "LEGACY_PROVEN",
  canonicalProgress: progress, storedProgress: progress, currentStatus: status,
  projectedStatus: progress === requiredTrips ? "COMPLETED" : "INCOMPLETE", reconstructionConfidence: "HIGH",
  blockingReasons: [], ambiguousCount: 0, invalidCount: 0, probableCount: 0, unresolvedSlots: 0,
  operationReconciliationVersion: 4, ...patch,
});

for (const n of [1, 2, 5, 6, 10, 12, 13, 15, 20, 30, 37, 50, 100]) {
  const active = planCanonicalMigration(base(n, Math.max(0, n - 1)));
  assert.equal(active.classification, "ACTIVE_SAFE");
  const completed = planCanonicalMigration(base(n, n));
  assert.equal(completed.classification, "COMPLETED_SAFE");
}
assert.equal(planCanonicalMigration(base(12, 13)).classification, "CRITICAL_OVERFLOW");
assert.equal(planCanonicalMigration(base(12, 4, "completed")).classification, "HISTORY_SAFE");
assert.equal(planCanonicalMigration(base(12, 4, "active", { requiredTrips: null, requiredTripsClassification: "MISSING" })).classification, "BLOCKED");
assert.equal(planCanonicalMigration(base(12, 4, "active", { blockingReasons: ["slot conflict"] })).classification, "MANUAL_REVIEW");

const plan = planCanonicalMigration(base(12, 11, "active", { storedProgress: 10 }));
assert.equal(plan.proposedPatch.progress, 11);
assert.equal(plan.rollbackPatch.progress, 10);
const decision = buildMigrationDecision(plan, { ...base(12, 11, "active", { storedProgress: 10 }), shadowMode: { divergence: 1 } });
assert.equal(decision.structuralClassification, "ACTIVE_SAFE");
assert.equal(decision.eligible, true);
assert.equal(decision.migrationBlockers.length, 0);
const rows = new Map([[plan.operationId, { ...plan.before }]]);
const first = executeCanonicalMigration({ mode: "DRY_APPLY", plans: [plan], currentRows: rows });
assert.equal(first.mutation, "none");
assert.equal(first.results[0].result, "SIMULATED");
const second = executeCanonicalMigration({ mode: "DRY_APPLY", plans: [plan], currentRows: new Map([[plan.operationId, first.rows.get(plan.operationId)!]]) });
assert.equal(second.results[0].result, "NO_OP");
const concurrent = executeCanonicalMigration({ mode: "DRY_APPLY", plans: [plan], currentRows: new Map([[plan.operationId, { ...plan.before, progress: 9 }]]) });
assert.equal(concurrent.results[0].result, "ABORT_PRECONDITION_MISMATCH");
assert.throws(() => executeCanonicalMigration({ mode: "APPLY", plans: [plan] }), /APPLY_BLOCKED_PHASE_5/);

const scope = { id: "op-final", operationId: "op-final", driverId: "d", companyId: "c", contractId: "ct", totalDeliveries: 2, progress: 1 };
const trip = (id: string, slot: number, extra: Record<string, any> = {}) => ({ id, canonicalTripId: id, operationId: "op-final", jobId: "op-final", driverId: "d", companyId: "c", contractId: "ct", status: "SERVER_CONFIRMED", recordStatus: "concluida", serverValidatedAt: "2026-01-01T00:00:00Z", operationSlot: slot, ...extra });
assert.equal(rebuildOperationProjection({ physicalJobId: scope.id, operation: scope, confirmedTrips: [trip("a", 1)] }).confirmedTripCount, 1);
assert.equal(rebuildOperationProjection({ physicalJobId: scope.id, operation: scope, confirmedTrips: [trip("a", 1), trip("b", 2)] }).confirmedTripCount, 2);
assert.equal(rebuildOperationProjection({ physicalJobId: scope.id, operation: scope, confirmedTrips: [trip("a", 1), trip("b", 2, { deleted: true })] }).confirmedTripCount, 1);
console.log("CANONICAL_MIGRATION_PLANNER_PASS quantities=13 dry-apply double-apply precondition overflow deletion finalization");
