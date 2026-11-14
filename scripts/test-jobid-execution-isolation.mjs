import assert from "node:assert/strict";
import { selectCanonicalOperationTrips, deriveCurrentOperationProgress } from "../src/lib/currentOperation.ts";
import { filterAndSortTripHistory } from "../src/lib/tripHistoryEngine.ts";
import { buildOperationProjection } from "../src/application/operation/OperationProjectionEngine.ts";
import { isCanonicalConfirmedTrip } from "../functions/src/isCanonicalConfirmedTrip.ts";

const trip = ({ id, jobId, driverId, contractId = "bs-10", companyId = "company-1", slot, status = "completed" }) => ({
  id,
  tripId: id,
  canonicalTripId: id,
  jobId,
  operationId: jobId,
  driverId,
  companyId,
  contractId,
  operationSlot: slot,
  status,
  recordStatus: status,
  source: "gto_auto",
  uploadedAt: "2026-09-01T10:00:00.000Z",
  serverValidatedAt: "2026-09-01T10:01:00.000Z",
  completedAt: `2026-09-01T10:${String(slot || 1).padStart(2, "0")}:00.000Z`,
  valor: 100,
});

const job = ({ id, driverId, contractId = "bs-10", requiredTrips = 6, status = "active" }) => ({
  id,
  operationId: id,
  driverId,
  companyId: "company-1",
  contractId,
  totalDeliveries: requiredTrips,
  status,
});

const bsA = job({ id: "bs-job-a", driverId: "david", status: "completed" });
const bsB = job({ id: "bs-job-b", driverId: "joao" });
const bsC = job({ id: "bs-job-c", driverId: "david" });
const bsTripsA = Array.from({ length: 6 }, (_, i) => trip({ id: `bs-a-${i + 1}`, jobId: bsA.id, driverId: bsA.driverId, slot: i + 1 }));
const bsTripsB = Array.from({ length: 2 }, (_, i) => trip({ id: `bs-b-${i + 1}`, jobId: bsB.id, driverId: bsB.driverId, slot: i + 1 }));
const allBs = [...bsTripsA, ...bsTripsB];

assert.equal(selectCanonicalOperationTrips(bsA, allBs, "david").length, 6, "BS-10 job A must remain 6/6");
assert.equal(selectCanonicalOperationTrips(bsB, allBs, "joao").length, 2, "BS-10 job B must remain 2/6");
assert.equal(selectCanonicalOperationTrips(bsC, allBs, "david").length, 0, "BS-10 new David execution must start 0/6");
assert.equal(deriveCurrentOperationProgress(bsC, allBs, "david"), 0);
assert.equal(filterAndSortTripHistory(allBs, { periodPreset: "todos", embeddedJob: bsC }).length, 0, "current history cannot borrow A or B");

const bsProjectionC = buildOperationProjection({
  identity: { operationId: bsC.id, driverId: bsC.driverId, companyId: bsC.companyId, contractId: bsC.contractId },
  operation: { status: "active", totalDeliveries: 6 },
  confirmedHistory: allBs,
  projectionHints: { progress: 6 },
});
assert.equal(bsProjectionC.confirmedTripCount, 0);
assert.equal(bsProjectionC.remainingTrips, 6);
assert.equal(bsProjectionC.nextSlot, 1);

const repeatA = job({ id: "repeat-a", driverId: "david" });
const repeatB = job({ id: "repeat-b", driverId: "david" });
const repeatTrips = [
  ...Array.from({ length: 6 }, (_, i) => trip({ id: `repeat-a-${i + 1}`, jobId: repeatA.id, driverId: "david", slot: i + 1 })),
  ...Array.from({ length: 3 }, (_, i) => trip({ id: `repeat-b-${i + 1}`, jobId: repeatB.id, driverId: "david", slot: i + 1 })),
];
assert.equal(selectCanonicalOperationTrips(repeatA, repeatTrips, "david").length, 6, "repeated same-driver job A must stay 6/6");
assert.equal(selectCanonicalOperationTrips(repeatB, repeatTrips, "david").length, 3, "repeated same-driver job B must stay 3/6, never 9/6");

const dJob = job({ id: "driver-david", driverId: "david" });
const jJob = job({ id: "driver-joao", driverId: "joao" });
const simultaneous = [
  ...Array.from({ length: 4 }, (_, i) => trip({ id: `d-${i + 1}`, jobId: dJob.id, driverId: "david", slot: i + 1 })),
  ...Array.from({ length: 2 }, (_, i) => trip({ id: `j-${i + 1}`, jobId: jJob.id, driverId: "joao", slot: i + 1 })),
];
assert.equal(selectCanonicalOperationTrips(dJob, simultaneous, "david").length, 4);
assert.equal(selectCanonicalOperationTrips(jJob, simultaneous, "joao").length, 2);

const legacyUnbound = trip({ id: "legacy-unbound", jobId: undefined, driverId: "david", slot: 99 });
assert.equal(filterAndSortTripHistory([legacyUnbound], { periodPreset: "todos", embeddedJob: bsC }).length, 0, "legacy-unbound cannot attach by driver/company/contract/date");
assert.equal(isCanonicalConfirmedTrip({ ...legacyUnbound, operationId: bsC.id }, {
  operationId: bsC.id,
  driverId: "david",
  companyId: "company-1",
  contractId: "bs-10",
}), false, "operationId cannot substitute missing physical jobId");

console.log("JOBID_EXECUTION_ISOLATION_PASS BS-10 A=6/6 B=2/6 C=0/6; repeated=6/6+3/6; simultaneous=4/6+2/6; legacy-unbound=excluded");
