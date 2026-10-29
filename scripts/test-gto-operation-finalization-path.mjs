import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const android = read("../android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java");
const gto = read("../functions/src/gtoTrips.ts");
const reconcile = read("../functions/src/reconcileOperationTrips.ts");
const repair = read("../functions/src/repairInvalidGtoPrintProgress.ts");
const app = read("../src/context/AppContext.tsx");
const manualFinalizer = read("../functions/src/completeCanonicalOperation.ts");
const operationOutbox = read("../src/services/operationOutbox.ts");
const tripOperationService = read("../src/application/trip/CanonicalTripOperationService.ts");

assert.match(android, /getHttpsCallable\("registerGtoTrip"\)/,
  "the Android GTO bridge must be audited against its real backend callable");
assert.match(gto, /reconcileOperationTripsCore/,
  "registerGtoTrip must converge on canonical operation reconciliation");
assert.match(gto, /operationReconciliationVersion \|\| 0\) >= 4/,
  "GTO fast-path cannot trust pre-audit progress");
assert.match(gto, /OPERATION_ALREADY_FULL/,
  "a recovered full operation must reject a 13th trip even if an old status remained active");
assert.doesNotMatch(gto, /currentStatus === "awaiting_completion"\s*&&\s*progress < totalDeliveries/,
  "GTO synchronization must never reopen an operation from an incomplete jobId-only projection");

const syncStart = gto.indexOf("const syncJobProgress = async");
const syncEnd = gto.indexOf("export const registerGtoTrip", syncStart);
assert(syncStart >= 0 && syncEnd > syncStart, "syncJobProgress block must exist");
const syncBlock = gto.slice(syncStart, syncEnd);
assert.doesNotMatch(syncBlock, /progressUpdate\.status|progress:\s*progress/,
  "GTO compatibility sync may update metadata but cannot own counter/lifecycle writes");

assert.doesNotMatch(reconcile, /rebuiltStatus/,
  "canonical reconciler must not use the old completed-to-active rebuild path");
assert.match(reconcile, /authoritativeCoverageComplete/,
  "v4 exhaustive coverage must make the canonical projection authoritative");
assert.doesNotMatch(reconcile, /legacyOperationRecoveredAt/,
  "LIVE reconciliation must not auto-bind legacy-unbound server trips");
assert.match(reconcile, /canCompleteLifecycle/,
  "recovered full operations must become ready for explicit completion on the canonical server projection");
assert.match(reconcile, /LIFECYCLE_AWAITING_COMPLETION/,
  "canonical reconciliation must stop at awaiting_completion");
assert.doesNotMatch(reconcile, /jobPatch\.status\s*=\s*["']active["']/,
  "reconciliation cannot reopen an operation");

assert.match(repair, /terminalLifecycle/,
  "explicit low-value repair must preserve terminal lifecycle");

const finishStart = app.indexOf("const finishJob =");
assert.ok(finishStart >= 0, "completion handler found before inspecting its boundary");
const finishEnd = app.indexOf("const cancelJob = async", finishStart);
const finish = app.slice(finishStart, finishEnd);
assert.match(finish, /finishJobInFlightRef/);
assert.match(finish, /operationOutbox\.enqueueFinish/);
assert.match(finish, /pendingSync:\s*true/);
assert.doesNotMatch(finish, /readAuthoritativeOperationState|getReadOnlyProQueueDiagnostics/);
assert.ok(operationOutbox.includes("sendFinish: entry => canonicalTripOperationService.finalizeOperation(entry.jobId)"));
assert.ok(tripOperationService.includes('"completeCanonicalOperation"'));
assert.match(manualFinalizer, /driver-explicit-confirmation/,
  "terminal completion must be attributed to explicit driver confirmation");
assert.match(manualFinalizer, /OPERATION_TRIPS_NOT_VALIDATED/,
  "manual finalization must revalidate the canonical ledger");
assert.match(app, /operationProjectionSource:\s*"new-operation-v4"/,
  "newly assigned operations must start on canonical reconciliation v4");

console.log("GTO_OPERATION_FINALIZATION_PATH: PASS native GTO -> awaiting_completion -> explicit server-validated Finalizar Operação");
