import assert from "node:assert/strict";
import fs from "node:fs";
import { isCanonicalConfirmedTrip, isTrustedServerConfirmedTrip } from "../functions/src/isCanonicalConfirmedTrip.ts";
import { resolveLegacyOperationAttribution } from "../functions/src/legacyOperationTripRecovery.ts";
import { decideReconciledProgress } from "../functions/src/operationReconciliationPolicy.ts";

const scope = { operationId: "job-12", driverId: "driver-1", companyId: "company-1", contractId: "contract-1" };
const operation = {
  id: scope.operationId,
  ...scope,
  assignedAt: "2026-09-01T00:00:00.000Z",
  status: "active",
  totalDeliveries: 12,
};
const base = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  tripId: id,
  jobId: scope.operationId,
  operationId: scope.operationId,
  driverId: scope.driverId,
  companyId: scope.companyId,
  contractId: scope.contractId,
  status: "concluida",
  recordStatus: "concluida",
  completedAt: "2026-09-10T12:00:00.000Z",
  ...patch,
});

// Three server-confirmed historical shapes with the complete physical scope
// must converge on the same canonical result. The old fixture omitted
// companyId/contractId and was incorrectly asserting canonical membership.
const current = base("current", { source: "gto_auto", uploadedAt: "2026-09-10T12:01:00Z", serverValidatedAt: "2026-09-10T12:01:00Z" });
const syncAdapterLegacy = base("sync-adapter", { source: "PRINT_PRO_REGISTRATION", syncStatus: "synced", serverUpdatedAt: "2026-09-10T12:01:00Z" });
const gtoLegacy = base("gto-legacy", { source: "gto_auto", uploadedAt: "2026-09-10T12:01:00Z" });
assert.equal(isTrustedServerConfirmedTrip(current), true);
assert.equal(isTrustedServerConfirmedTrip(syncAdapterLegacy), true);
assert.equal(isTrustedServerConfirmedTrip(gtoLegacy), true);
assert.equal(isCanonicalConfirmedTrip(current, scope), true);
assert.equal(isCanonicalConfirmedTrip(syncAdapterLegacy, scope), true);
assert.equal(isCanonicalConfirmedTrip(gtoLegacy, scope), true);

// A physical jobId alone is not enough to enter operational projection.
assert.equal(isCanonicalConfirmedTrip(base("missing-company", { companyId: undefined }), scope), false);
assert.equal(isCanonicalConfirmedTrip(base("missing-contract", { contractId: undefined }), scope), false);
assert.equal(isCanonicalConfirmedTrip(base("wrong-driver", { driverId: "other-driver" }), scope), false);
assert.equal(isCanonicalConfirmedTrip(base("wrong-job", { jobId: "other-job", operationId: "other-job" }), scope), false);

// Pending/client-only rows remain excluded.
assert.equal(isCanonicalConfirmedTrip(base("pending", { status: "PENDING_SYNC", recordStatus: "concluida", uploadedAt: "2026-09-10T12:01:00Z", source: "gto_auto" }), scope), false);
assert.equal(isCanonicalConfirmedTrip(base("client-only", { source: "PRINT_PRO_REGISTRATION", uploadedAt: "2026-09-10T12:01:00Z" }), scope), false);
assert.equal(isCanonicalConfirmedTrip(base("pending-sync-marker", { source: "gto_auto", serverValidatedAt: "2026-09-10T12:01:00Z", offlineSyncStatus: "pending_sync" }), scope), false);
assert.equal(isCanonicalConfirmedTrip(base("wrong-job", { jobId: "other", operationId: "other", source: "gto_auto", uploadedAt: "2026-09-10T12:01:00Z" }), scope), false);

// Rows created before jobId became mandatory can be recovered only when the
// driver+contract+time window identifies exactly one operation.
const unboundLegacy = {
  id: "legacy-unbound",
  driverId: scope.driverId,
  companyId: scope.companyId,
  contractId: scope.contractId,
  status: "concluida",
  recordStatus: "concluida",
  source: "gto_auto",
  uploadedAt: "2026-09-10T12:01:00Z",
  completedAt: "2026-09-10T12:00:00Z",
};
const unique = resolveLegacyOperationAttribution(unboundLegacy, [operation]);
assert.equal(unique.ownerOperationId, scope.operationId);
assert.equal(unique.ambiguous, false);

const overlapping = { ...operation, id: "job-overlap", operationId: "job-overlap", assignedAt: "2026-09-05T00:00:00Z" };
const ambiguous = resolveLegacyOperationAttribution(unboundLegacy, [operation, overlapping]);
assert.equal(ambiguous.ownerOperationId, "");
assert.equal(ambiguous.ambiguous, true);

const explicitOther = resolveLegacyOperationAttribution({ ...unboundLegacy, jobId: "other-job" }, [operation]);
assert.equal(explicitOther.ownerOperationId, "");
assert.equal(explicitOther.ambiguous, false);


// The exact regression from production: persisted 12/12 plus an incomplete
// legacy query returning 3 must never downgrade the operation. Conversely, a
// repaired projection proving 12 receipts may safely raise a stale 3 counter.
const incompleteLegacyQuery = decideReconciledProgress({
  reportedProgress: 12,
  confirmedCount: 3,
  safeDecreaseEvidence: false,
  hasConflict: false,
});
assert.equal(incompleteLegacyQuery.unresolvedDownwardGap, true);
assert.equal(incompleteLegacyQuery.canRepairProgress, false);
assert.equal(incompleteLegacyQuery.nextProgress, 12);

const recoveredLegacyHistory = decideReconciledProgress({
  reportedProgress: 3,
  confirmedCount: 12,
  safeDecreaseEvidence: false,
  hasConflict: false,
});
assert.equal(recoveredLegacyHistory.unresolvedDownwardGap, false);
assert.equal(recoveredLegacyHistory.canRepairProgress, true);
assert.equal(recoveredLegacyHistory.nextProgress, 12);

const provenDeletion = decideReconciledProgress({
  reportedProgress: 12,
  confirmedCount: 11,
  safeDecreaseEvidence: true,
  hasConflict: false,
});
assert.equal(provenDeletion.canRepairProgress, true);
assert.equal(provenDeletion.nextProgress, 11);

// Regression: reconciliation must never reopen a completed operation or lower
// progress merely because a narrower query sees fewer rows.
const reconcileSource = fs.readFileSync(new URL("../functions/src/reconcileOperationTrips.ts", import.meta.url), "utf8");
assert.doesNotMatch(reconcileSource, /rebuiltStatus/);
assert.doesNotMatch(reconcileSource, /status:\s*["']active["']/);
assert.doesNotMatch(reconcileSource, /UNRESOLVED_LEGACY_GAP/, "LIVE reconciliation must not depend on legacy gap recovery");
assert.doesNotMatch(reconcileSource, /legacyOperationRecoveredAt/, "LIVE reconciliation must not auto-bind legacy rows");
assert.match(reconcileSource, /safeDecreaseEvidence/);


// The native GTO Android bridge is a separate production writer. This was the
// missing path in 1.0.410: registerGtoTrip rebuilt progress from jobId-only
// history and could turn awaiting_completion back into active. It must now
// reuse the same canonical reconciler before trusting/incrementing progress.
const androidGto = fs.readFileSync(new URL("../android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java", import.meta.url), "utf8");
const gtoWriter = fs.readFileSync(new URL("../functions/src/gtoTrips.ts", import.meta.url), "utf8");
assert.match(androidGto, /getHttpsCallable\("registerGtoTrip"\)/);
assert.match(gtoWriter, /reconcileOperationTripsCore/);
assert.match(gtoWriter, /operationReconciliationVersion \|\| 0\) >= 4/);
assert.match(gtoWriter, /OPERATION_ALREADY_FULL/);
assert.match(gtoWriter, /operationAwaitingCompletionPatch/);
assert.match(gtoWriter, /fastJobStatus = "awaiting_completion"/);
assert.doesNotMatch(gtoWriter, /currentStatus === "awaiting_completion"\s*&&\s*progress < totalDeliveries/);
const syncStart = gtoWriter.indexOf("const syncJobProgress = async");
const syncEnd = gtoWriter.indexOf("export const registerGtoTrip", syncStart);
const syncBlock = gtoWriter.slice(syncStart, syncEnd);
assert.doesNotMatch(syncBlock, /progressUpdate\.status|progress:\s*progress/);

// Explicit low-value Print repair may decrease a counter when deletion is
// proven, but it must never reopen a terminal operation.
const printRepair = fs.readFileSync(new URL("../functions/src/repairInvalidGtoPrintProgress.ts", import.meta.url), "utf8");
assert.match(printRepair, /terminalLifecycle/);
assert.match(printRepair, /"completed"/);
assert.match(printRepair, /operationReconciliationVersion:\s*4/);

// Local finalization is a durable pending command. Only the unchanged server
// finalizer (which handles an already-completed operation first) can close it.
const appContext = fs.readFileSync(new URL("../src/context/AppContext.tsx", import.meta.url), "utf8");
const finishStart = appContext.indexOf("const finishJob =");
assert.ok(finishStart >= 0);
const finishBlock = appContext.slice(finishStart, appContext.indexOf("const cancelJob =", finishStart));
assert.match(finishBlock, /operationOutbox\.enqueueFinish/);
assert.match(finishBlock, /pendingSync: true, completed: false/);
assert.doesNotMatch(finishBlock, /readAuthoritativeOperationState|getReadOnlyProQueueDiagnostics|inspectOperationCloseQueue/);
assert.doesNotMatch(finishBlock, /createCorporateNotifications/);
assert.doesNotMatch(finishBlock, /updateDoc\(doc\(db, ["'](?:veiculos|reboques)["']/);
const operationAdapter = fs.readFileSync(new URL("../src/services/operationOutbox.ts", import.meta.url), "utf8");
const outbox = fs.readFileSync(new URL("../src/application/operation/DurableOperationOutbox.ts", import.meta.url), "utf8");
assert.match(operationAdapter, /sendFinish: entry => canonicalTripOperationService\.finalizeOperation\(entry\.jobId\)/);
assert.match(outbox, /result\?\.completed !== true/);
assert.match(outbox, /result\.status !== "completed"/);
const manualFinalizer = fs.readFileSync(new URL("../functions/src/completeCanonicalOperation.ts", import.meta.url), "utf8");
assert.match(manualFinalizer, /driver-explicit-confirmation/);
assert.match(manualFinalizer, /OPERATION_CAPACITY_OVERFLOW/);
assert.match(manualFinalizer, /operationCompletionPatch/);

console.log("OPERATION_FINALIZATION_REGRESSION_PASS legacy formats, canonical readiness at total, explicit driver finalization, safe 12→3 guard, 3→12 recovery and capacity guard");
