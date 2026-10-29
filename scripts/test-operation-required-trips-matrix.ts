import assert from "node:assert/strict";
import { buildCanonicalOperationProjection } from "../functions/src/canonicalOperationProjection";
import { buildOperationProjection } from "../src/application/operation/OperationProjectionEngine";
import { isCanonicalConfirmedTrip } from "../functions/src/isCanonicalConfirmedTrip";

const REQUIRED_TRIPS = [1, 2, 5, 6, 10, 12, 13, 15, 20, 30, 37, 50, 100] as const;
const dateFor = (index: number) => new Date(Date.UTC(2026, 0, 1 + index, 10, 0, 0));

function makeScope(requiredTrips: number) {
  return {
    operationId: `matrix-operation-${requiredTrips}`,
    driverId: "matrix-driver",
    companyId: "matrix-company",
    contractId: `matrix-contract-${requiredTrips}`,
  };
}

function makeTrip(scope: ReturnType<typeof makeScope>, slot: number, patch: Record<string, unknown> = {}) {
  const id = `${scope.operationId}-trip-${slot}`;
  return {
    id,
    tripId: id,
    canonicalTripId: id,
    jobId: scope.operationId,
    operationId: scope.operationId,
    driverId: scope.driverId,
    companyId: scope.companyId,
    contractId: scope.contractId,
    status: "SERVER_CONFIRMED",
    recordStatus: "concluida",
    source: "gto_auto",
    uploadedAt: dateFor(slot),
    serverValidatedAt: dateFor(slot),
    createdAt: dateFor(slot),
    updatedAt: dateFor(slot),
    operationSlot: slot,
    operationSlotKey: id,
    deleted: false,
    valor: 100 + slot,
    valorCents: (100 + slot) * 100,
    ...patch,
  };
}

function project(requiredTrips: number, trips: any[]) {
  const scope = makeScope(requiredTrips);
  const operation = { ...scope, id: scope.operationId, totalDeliveries: requiredTrips, status: "active" };
  const backend = buildCanonicalOperationProjection({
    physicalJobId: scope.operationId,
    operation,
    confirmedHistory: trips.map((data) => ({ id: data.id, data })),
  });
  const client = buildOperationProjection({ identity: scope, operation, confirmedHistory: trips });
  return { scope, operation, backend, client };
}

for (const requiredTrips of REQUIRED_TRIPS) {
  const complete = Array.from({ length: requiredTrips }, (_, index) =>
    makeTrip(makeScope(requiredTrips), index + 1),
  );
  const beforeLast = complete.slice(0, -1);
  const incomplete = project(requiredTrips, beforeLast);
  const finished = project(requiredTrips, complete);

  assert.equal(incomplete.backend.confirmedTripCount, Math.max(0, requiredTrips - 1));
  assert.equal(incomplete.client.confirmedTripCount, Math.max(0, requiredTrips - 1));
  assert.equal(incomplete.backend.confirmedTripCount >= requiredTrips, false);
  assert.equal(finished.backend.confirmedTripCount, requiredTrips);
  assert.equal(finished.client.confirmedTripCount, requiredTrips);
  assert.equal(finished.backend.confirmedTripCount >= requiredTrips, true);
  assert.equal(finished.backend.confirmedTripIds.length, requiredTrips);

  const duplicate = project(requiredTrips, [...complete, { ...complete[0] }]);
  assert.equal(duplicate.backend.confirmedTripCount, requiredTrips, "duplicate tripId cannot increase progress");

  const pending = project(requiredTrips, [
    ...beforeLast,
    makeTrip(makeScope(requiredTrips), requiredTrips, {
      status: "PENDING_SYNC",
      recordStatus: "pending_sync",
      uploadedAt: undefined,
      serverValidatedAt: undefined,
    }),
  ]);
  assert.equal(pending.backend.confirmedTripCount, Math.max(0, requiredTrips - 1), "offline pending is not confirmed");

  const outside = makeTrip({ ...makeScope(requiredTrips), operationId: "other-operation" }, requiredTrips);
  const withOutside = project(requiredTrips, [...beforeLast, outside]);
  assert.equal(withOutside.backend.confirmedTripCount, Math.max(0, requiredTrips - 1));
  assert.equal(isCanonicalConfirmedTrip(outside, makeScope(requiredTrips)), false);

  console.log(`PASS requiredTrips=${requiredTrips}: ${requiredTrips - 1}/${requiredTrips}, complete, duplicate, pending, outside-scope`);
}

console.log(`OPERATION_REQUIRED_TRIPS_MATRIX_PASS ${REQUIRED_TRIPS.length} quantities; canonical count and completion invariant aligned`);
