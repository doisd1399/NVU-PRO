import assert from "node:assert/strict";
import { buildCanonicalProductionAudit } from "../functions/src/canonicalProductionAudit";
import { classifyLegacyTripForCanonicalMigration } from "../functions/src/legacyTripMigrationClassifier";

const operation = {
  id: "op-12",
  driverId: "driver-1",
  companyId: "company-1",
  contractId: "contract-1",
  totalDeliveries: 12,
  progress: 3,
  status: "active",
  startedAt: "2026-09-01T00:00:00Z",
  completedAt: "2026-09-30T23:59:59Z",
};
const canonicalTrips = Array.from({ length: 3 }, (_, index) => ({
  id: `trip-${index + 1}`,
  tripId: `trip-${index + 1}`,
  jobId: "op-12",
  operationId: "op-12",
  driverId: "driver-1",
  companyId: "company-1",
  contractId: "contract-1",
  status: "concluida",
  source: "gto_auto",
  uploadedAt: "2026-09-0${index + 1}T10:00:00Z",
  serverValidatedAt: "2026-09-0${index + 1}T10:01:00Z",
  operationSlot: index + 1,
}));
const exactLegacy = {
  id: "legacy-exact",
  tripId: "legacy-exact",
  driverId: "driver-1",
  contractId: "contract-1",
  status: "concluida",
  source: "gto_auto",
  uploadedAt: "2026-09-04T10:00:00Z",
  serverValidatedAt: "2026-09-04T10:01:00Z",
};
const ambiguousLegacy = {
  id: "legacy-ambiguous",
  tripId: "legacy-ambiguous",
  driverId: "driver-1",
  contractId: "contract-1",
  status: "concluida",
  source: "gto_auto",
  uploadedAt: "2026-09-15T10:00:00Z",
  serverValidatedAt: "2026-09-15T10:01:00Z",
};
const operation2 = { ...operation, id: "op-13", totalDeliveries: 6, startedAt: "2026-09-10T00:00:00Z", completedAt: "2026-09-20T23:59:59Z" };
const claims = canonicalTrips.map((trip) => ({ id: trip.id, tripId: trip.id, jobId: "op-12", operationSlot: trip.operationSlot }));
const exact = classifyLegacyTripForCanonicalMigration(exactLegacy, [operation, operation2], claims);
assert.equal(exact.category, "RECOVERABLE_EXACT");
assert.equal(exact.safeToAutoRepair, false, "legacy sem jobId nunca pode ser auto-reparado");
const ambiguous = classifyLegacyTripForCanonicalMigration(ambiguousLegacy, [operation, operation2], claims);
assert.equal(ambiguous.category, "AMBIGUOUS");
assert.equal(ambiguous.safeToAutoRepair, false);
const audit = buildCanonicalProductionAudit({ operations: [operation, operation2], trips: [...canonicalTrips, exactLegacy, ambiguousLegacy], claims });
assert.equal(audit.dryRun, true);
assert.equal(audit.totalOperations, 2);
assert.equal(audit.operations[0].canonicalCount, 3);
assert.equal(audit.operations[0].expectedProgressAfterRepair, 3);
assert.equal(audit.operations[0].physicalTripCount, 3, "legacy-unbound não pode ser atribuído ao job");
assert.ok(audit.totals.legacyAmbiguous >= 1, "legacy ambíguo deve aparecer no relatório global");
assert.equal(audit.operations.some((row) => row.ambiguousCount > 0 && row.safeToAutoRepair), false);
console.log("CANONICAL_PRODUCTION_AUDIT_PASS deterministic fixtures, legacy classification, dry-run projection and ambiguity gate");
