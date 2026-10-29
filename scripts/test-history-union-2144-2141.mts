import assert from "node:assert/strict";
import { ScopedHistoryReadProjection } from "../src/lib/scopedHistoryReadProjection";

// Synthetic regression only; never reads or mutates production data.
// Source A: 316 rows selected by companyId=316. Source B: 2144 rows selected
// by empresaId=2144. The 316 A rows overlap by physical document ID with B and
// carry both legacy identities. Three distinct rows are canceled/excluded.
// The expected eligible count is computed from the fixture (not hard-coded).
const projection = new ScopedHistoryReadProjection();
const makeDocument = (n: number) => {
  const id = `synthetic-trip-${String(n).padStart(4, "0")}`;
  const isOverlap = n < 316;
  const canceled = n >= 2141;
  return {
    id,
    data: {
      ...(isOverlap ? { companyId: "316" } : {}),
      empresaId: "2144",
      driverId: "synthetic-driver",
      motoristaId: "synthetic-driver",
      contractId: "synthetic-contract",
      tripId: id,
      canonicalTripId: id,
      recordStatus: canceled ? "cancelada" : "concluida",
      status: canceled ? "cancelada" : "concluida",
      cancelado: canceled,
      valor: 100,
      currency: "BRL",
      completedAt: `2026-09-${String((n % 28) + 1).padStart(2, "0")}T12:00:00.000Z`,
      serverValidatedAt: "2026-10-01T00:00:00.000Z",
    },
    hasPendingWrites: false,
  };
};
const sourceA = Array.from({ length: 316 }, (_, i) => makeDocument(i));
const sourceB = Array.from({ length: 2144 }, (_, i) => makeDocument(i));
const canceledCount = sourceB.filter((row) => row.data.cancelado).length;
const expectedPhysicalUnion = new Set([...sourceA, ...sourceB].map((row) => row.id)).size;
const expectedEligible = expectedPhysicalUnion - canceledCount;

assert.equal(projection.replaceSource("companyId=316", sourceA, { fromCache: false, hasPendingWrites: false }), 0);
assert.equal(projection.replaceSource("empresaId=2144", sourceB, { fromCache: false, hasPendingWrites: false }), 0);

const scope = { companyId: "316", companyIds: ["316", "2144"] };
const unionRows = projection.list(scope);
const assessment = projection.assess(scope);
assert.equal(sourceA.length, 316);
assert.equal(sourceB.length, 2144);
assert.equal(expectedPhysicalUnion, 2144, "the same physical IDs must be unioned once");
assert.equal(assessment.eligibleRows, expectedEligible,
  "legacy companyId/empresaId coexistence must not discard otherwise valid historical rows");
assert.equal(assessment.excludedRows, canceledCount);
assert.equal(assessment.deletedOrCanceledRows, canceledCount);
assert.equal(assessment.pendingWriteRows, 0);

console.log(JSON.stringify({
  syntheticOnly: true,
  companyIdSourceRows: sourceA.length,
  empresaIdSourceRows: sourceB.length,
  physicalOverlapRows: 316,
  expectedPhysicalUnion,
  projectedRowsAfterIdentityFiltering: unionRows.length,
  expectedEligible,
  eligibleRows: assessment.eligibleRows,
  canceledOrDeletedRows: assessment.deletedOrCanceledRows,
  result: "PASS",
}, null, 2));
