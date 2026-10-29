import assert from "node:assert/strict";
import { buildOperationProjection } from "../src/application/operation/OperationProjectionEngine";
import { deriveCurrentOperationProgress } from "../src/lib/currentOperation";

const identity = { uid: "driver", driverId: "driver", companyId: "company", contractId: "contract", operationId: "operation" };
const trip = (id: string, extra = {}) => ({
  canonicalTripId: id, tripId: id, idempotencyKey: `key-${id}`,
  jobId: identity.operationId, operationId: identity.operationId,
  driverId: identity.driverId, companyId: identity.companyId, contractId: identity.contractId,
  status: "SERVER_CONFIRMED", recordStatus: "completed", source: "gto_auto",
  uploadedAt: "2026-10-10T12:00:00.000Z", serverValidatedAt: "2026-10-10T12:00:00.000Z",
  origem: "Agro Grão", destino: "Lages", valor: 24917, ...extra,
});
const history = [trip("first"), trip("second"), trip("second"), trip("pending", { status: "PENDING_SYNC", serverValidatedAt: undefined }), trip("other-company", { companyId: "other" })];
const legacy = buildOperationProjection({ identity, operation: { status: "active", totalDeliveries: 2 },
  confirmedHistory: [trip("old-server-document", { canonicalTripId: undefined, tripId: undefined, idempotencyKey: undefined, id: "firestore-document-id" })] as any });
assert.equal(legacy.confirmedTripCount, 1, "an original server-confirmed Firestore document id must not disappear from the local ledger");
const full = buildOperationProjection({ identity, operation: { status: "active", totalDeliveries: 2 }, confirmedHistory: history as any });
assert.equal(deriveCurrentOperationProgress({ ...identity, id: identity.operationId, status: "active", totalDeliveries: 2 }, history as any, identity.driverId), 2, "the displayed card must deduplicate the same confirmed receipt as the canonical ledger");
assert.equal(full.confirmedTripCount, 2, "duplicates, pending and foreign trips cannot complete the target");
assert.equal(full.status, "awaiting_completion", "reaching the target must not finish the operation");
assert.equal(full.nextAllowedAction, "FINALIZE_OPERATION", "the driver must explicitly finalize the current operation");
assert.equal(full.nextSlot, null, "no extra capture slot after reaching the target");
const awaitingHistory = buildOperationProjection({ identity, operation: { status: "awaiting_completion", totalDeliveries: 2 }, confirmedHistory: [] });
assert.equal(awaitingHistory.nextAllowedAction, "FINALIZE_OPERATION", "server readiness survives an incomplete local history; finalization is still validated by the server");
assert.equal(awaitingHistory.nextSlot, null, "an incomplete local cache cannot authorize an extra trip after server readiness");
for (const status of ["completed", "cancelled"] as const) {
  const terminal = buildOperationProjection({ identity, operation: { status, totalDeliveries: 2 }, confirmedHistory: [] });
  assert.equal(terminal.status, status, "a partial local history must never reopen an acknowledged terminal operation");
  assert.equal(terminal.nextAllowedAction, "OPERATION_COMPLETE");
  assert.equal(terminal.nextSlot, null);
}
const pending = buildOperationProjection({ identity, operation: { status: "pending", totalDeliveries: 2 }, confirmedHistory: history as any });
assert.equal(pending.status, "pending", "progress artifacts cannot start a pending assignment");
assert.equal(pending.nextAllowedAction, "WAIT_FOR_OPERATION");
assert.equal(pending.nextSlot, null);
const open = buildOperationProjection({ identity, operation: { status: "delayed", totalDeliveries: 2 }, confirmedHistory: [trip("first")] as any });
assert.equal(open.status, "delayed");
assert.equal(open.nextAllowedAction, "RECORD_TRIP");
assert.equal(open.nextSlot, 2);
console.log("MANUAL_OPERATION_LIFECYCLE_PASS full target stays current; manual action; terminal/pending invariants; canonical deduplication");
