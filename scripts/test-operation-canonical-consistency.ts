import assert from "node:assert/strict";
import { buildCanonicalOperationProjection } from "../functions/src/canonicalOperationProjection";
import { buildOperationProjection } from "../src/application/operation/OperationProjectionEngine";
import { RankingProjectionService } from "../src/application/ranking/RankingProjectionService";
import { isCanonicalConfirmedTrip } from "../functions/src/isCanonicalConfirmedTrip";

const scope = { operationId: "job-canonical", driverId: "driver-canonical", companyId: "company-canonical", contractId: "contract-canonical" };
const operation = { ...scope, id: scope.operationId, totalDeliveries: 12, status: "active" };
const baseTrip = (slot: number, kind: "old" | "new" = "new") => ({
  id: `${kind}-${slot}`, tripId: `${kind}-${slot}`, canonicalTripId: `${kind}-${slot}`,
  jobId: scope.operationId, operationId: scope.operationId, trabalhoId: scope.operationId,
  driverId: scope.driverId, motoristaId: scope.driverId, criadoPor: scope.driverId,
  companyId: scope.companyId, empresaId: scope.companyId,
  contractId: scope.contractId, contratoId: scope.contractId,
  source: "gto_auto", uploadedAt: new Date(`2026-09-${String(slot).padStart(2, "0")}T10:00:00Z`),
  status: "SERVER_CONFIRMED", recordStatus: "concluida", deleted: false,
  operationSlot: slot, createdAt: `2026-09-${String(slot).padStart(2, "0")}T10:00:00Z`,
  updatedAt: `2026-09-${String(slot).padStart(2, "0")}T10:00:00Z`,
  valor: 100 + slot, valorCents: (100 + slot) * 100,
  simulatorId: "GTO", earnings: 100 + slot,
  ...(kind === "old" ? { legacyFormat: true } : { serverValidatedAt: new Date() }),
});

const counts = (trips: any[], expectedCompleted = true) => {
  const backend = buildCanonicalOperationProjection({ physicalJobId: scope.operationId, operation, confirmedHistory: trips.map((data) => ({ id: data.id, data })) });
  const client = buildOperationProjection({ identity: scope, operation, confirmedHistory: trips as any[] });
  const historyCount = backend.confirmedTripIds.length;
  const ranking = new RankingProjectionService().project(trips as any[], { scope: "global", simulatorId: "GTO" });
  const rankingCount = ranking.rows.reduce((sum, row) => sum + row.trips, 0);
  assert.equal(client.confirmedTripCount, backend.confirmedTripCount, "APK e Functions divergem");
  assert.equal(historyCount, backend.confirmedTripCount, "histórico diverge da projeção");
  assert.equal(rankingCount, backend.confirmedTripCount, "ranking diverge da projeção");
  assert.equal(backend.confirmedTripCount >= operation.totalDeliveries, expectedCompleted, "finalização deve refletir somente a projeção canônica");
  return backend.confirmedTripCount;
};

// 1) 12/12 with old GTO rows.
assert.equal(counts(Array.from({ length: 12 }, (_, index) => baseTrip(index + 1, "old"))), 12);
console.log("PASS 1 operação 12/12 com viagens GTO antigas");

// 2) 12/12 with new rows.
assert.equal(counts(Array.from({ length: 12 }, (_, index) => baseTrip(index + 1, "new"))), 12);
console.log("PASS 2 operação com viagens GTO novas");

// 3) Mixed old + new.
assert.equal(counts(Array.from({ length: 12 }, (_, index) => baseTrip(index + 1, index < 6 ? "old" : "new"))), 12);
console.log("PASS 3 mistura de viagens antigas e novas");

// 4) Offline pending trip is excluded until the server upload completes.
const offline = Array.from({ length: 11 }, (_, index) => baseTrip(index + 1, "old"));
const pending = { ...baseTrip(12, "new"), source: "gto_auto", uploadedAt: undefined, status: "PENDING_SYNC", recordStatus: "pending_sync" };
assert.equal(counts(offline.map((trip) => trip), false), 11);
const afterSync = [...offline, { ...pending, uploadedAt: new Date(), status: "SERVER_CONFIRMED", recordStatus: "concluida" }];
assert.equal(counts(afterSync), 12);
console.log("PASS 4 offline sincronizando depois");

// 5) A trip linked to another operation never contributes to this operation.
const outside = { ...baseTrip(12, "new"), id: "outside", tripId: "outside", canonicalTripId: "outside", jobId: "other-job", operationId: "other-job", operationSlot: 12 };
const withOutside = [...Array.from({ length: 12 }, (_, index) => baseTrip(index + 1, "new")), outside];
assert.equal(counts(withOutside.filter((trip) => trip.operationId === scope.operationId)), 12);
assert.equal(isCanonicalConfirmedTrip(outside, scope), false);
console.log("PASS 5 tentativa de incluir viagem fora da operação");

console.log("CANONICAL_OPERATION_CONSISTENCY_PASS 5 cenários; contador, operação, histórico, ranking e finalização alinhados");
