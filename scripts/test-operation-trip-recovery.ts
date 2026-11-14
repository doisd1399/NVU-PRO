import assert from "node:assert/strict";
import { deriveCurrentOperationProgress } from "../src/lib/currentOperation";
import { filterAndSortTripHistory } from "../src/lib/tripHistoryEngine";
import { ingestOperationTripSnapshot } from "../src/lib/operationTripRecovery";

const scope = { jobId: "job-123", driverId: "driver-123", companyId: "company-123", contractId: "contract-123" };
const job = { id: scope.jobId, ...scope, progress: 6, totalDeliveries: 12, operationProgressReconciled: true };
const trip = (slot: number) => ({
  tripId: `receipt-${slot}`, canonicalTripId: `receipt-${slot}`, id: `receipt-${slot}`,
  ...scope, valor: 2341, status: "concluida", source: "gto_auto",
  uploadedAt: "2026-09-29T07:00:00.000Z", serverValidatedAt: "2026-09-29T07:00:00.000Z",
  completedAt: `2026-09-29T06:${String(slot).padStart(2, "0")}:00.000Z`,
});
const history = [1, 2, 3, 4, 5].map(trip);
assert.equal(deriveCurrentOperationProgress(job, history, scope.driverId), 5);
assert.equal(filterAndSortTripHistory(history, { embeddedJob: job }).length, 5);

const received: any[] = [];
const save = (row: any) => received.push(row);
assert.equal(ingestOperationTripSnapshot("receipt-6", trip(6), scope, save), true);
assert.equal(received.length, 1);
const recovered = [...history, ...received];
assert.equal(filterAndSortTripHistory(recovered, { embeddedJob: job }).length, 6);
assert.equal(deriveCurrentOperationProgress(job, recovered, scope.driverId), 6);

assert.equal(ingestOperationTripSnapshot("receipt-7", { ...trip(7), driverId: "other", motoristaId: "other" }, scope, save), false);
assert.equal(ingestOperationTripSnapshot("receipt-7", { ...trip(7), jobId: "other", operationId: "other" }, scope, save), false);
assert.equal(ingestOperationTripSnapshot("receipt-7", { ...trip(7), contractId: "other" }, scope, save), false);
assert.equal(ingestOperationTripSnapshot("receipt-7", { ...trip(7), tripId: "receipt-8" }, scope, save), false);
assert.equal(ingestOperationTripSnapshot("receipt-7", { ...trip(7), status: "PENDING_SYNC", syncStatus: "pending_sync" }, scope, save), false);
assert.equal(received.length, 1, "foreign or unconfirmed documents must never enter the operation");

const deleted = { ...trip(6), status: "DELETED", deleted: true };
assert.equal(ingestOperationTripSnapshot("receipt-6", deleted, scope, save), true);
assert.equal(filterAndSortTripHistory([...history, deleted], { embeddedJob: { ...job, progress: 5 } }).length, 5);
console.log("operation-trip-recovery: PASS delayed ACK, scope, pending and deletion");
