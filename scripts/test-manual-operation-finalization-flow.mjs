import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const completion = read("functions/src/operationCompletion.ts");
const gto = read("functions/src/gtoTrips.ts");
const pro = read("functions/src/registerGtoProReceipt.ts");
const simple = read("functions/src/registerCanonicalSimpleTrip.ts");
const reconcile = read("functions/src/reconcileOperationTrips.ts");
const callable = read("functions/src/completeCanonicalOperation.ts");
const index = read("functions/src/index.ts");
const app = read("src/context/AppContext.tsx");
const coordinator = read("src/services/operationalCompletionCoordinator.ts");
const recordTrip = read("src/pages/driver/RecordTrip.tsx");
const dashboard = read("src/pages/driver/Dashboard.tsx");
const availability = read("src/lib/proLaunchAvailability.ts");
const nativeSimple = read("android/app/src/main/java/com/nvu/operacional/SimpleAutomationService.java");

assert.match(completion, /operationAwaitingCompletionPatch/);
assert.match(completion, /status:\s*"awaiting_completion"/);
assert.match(completion, /operationCompletionPatch/);
assert.match(completion, /status:\s*"completed"/);

for (const [name, source] of [["GTO", gto], ["Pro", pro], ["Print\/Simple", simple]]) {
  assert.match(source, /operationAwaitingCompletionPatch/, `${name} final receipt must stop at awaiting_completion`);
  assert.doesNotMatch(source, /operationCompletionPatch\(/, `${name} trip writer must not terminally complete the job`);
}
assert.match(gto, /fastJobStatus = "awaiting_completion"/);
assert.match(pro, /jobStatus: confirmedProgress >= total \? "awaiting_completion"/);
assert.match(simple, /jobStatus: projection\.confirmedTripCount \+ 1 >= total \? "awaiting_completion"/);

assert.match(reconcile, /operationAwaitingCompletionPatch/);
assert.match(reconcile, /LIFECYCLE_AWAITING_COMPLETION/);
assert.doesNotMatch(reconcile, /operationCompletionPatch\(/);

assert.match(callable, /context\.auth\?\.uid/);
assert.match(callable, /OPERATION_TRIPS_NOT_VALIDATED/);
assert.match(callable, /OPERATION_CAPACITY_OVERFLOW/);
assert.match(callable, /driver-explicit-confirmation/);
assert.match(callable, /operationCompletionPatch/);
assert.match(index, /completeCanonicalOperation/);

const finishStart = app.indexOf("const finishJob =");
assert.ok(finishStart >= 0, "completion handler found before inspecting its boundary");
const finishEnd = app.indexOf("const cancelJob = async", finishStart);
const finish = app.slice(finishStart, finishEnd);
assert.doesNotMatch(finish, /readAuthoritativeOperationState/);
assert.match(finish, /canonicalTripOperationService\.finalizeOperation\(id\)/);
assert.match(finish, /finalizeOperationWithServerConfirmation/);
assert.doesNotMatch(finish, /inspectOperationCloseQueue|getReadOnlyProQueueDiagnostics/);

const autoArea = app.slice(app.indexOf("const stableFinishJob"));
assert.doesNotMatch(autoArea, /progress >= total\) await stableFinishJob/);
assert.doesNotMatch(autoArea, /confirmedProgress >= total\) await stableFinishJob/);

assert.doesNotMatch(coordinator, /input\.finishJob/);
assert.match(coordinator, /operationReadyToFinalize/);
assert.match(coordinator, /operationStatus = actualReadyToFinalize \? "awaiting_completion" : "active"/);
assert.match(recordTrip, /operationReadyToFinalize/);
assert.match(recordTrip, /navigate\("\/driver\/dashboard", \{ replace: true \}\)/);
assert.doesNotMatch(recordTrip, /publishOperationCompletionResult/);

assert.match(dashboard, /operationReadyForManualFinish/);
assert.match(dashboard, /Finalizar Operação/);
assert.match(dashboard, /await finishJob\(myJob\.id\)/);
assert.match(dashboard, /setShowOperationResultModal\(true\)/);

assert.match(availability, /Finalize a operação no painel para continuar/);
assert.match(nativeSimple, /awaiting_completion/);
assert.match(nativeSimple, /Abra a NVU e finalize a operação para continuar/);
assert.match(nativeSimple, /closedOperationMessage\(jobStatus\)/);

console.log("MANUAL_OPERATION_FINALIZATION_FLOW_PASS final trip -> awaiting_completion -> button -> explicit callable -> result modal; Print and Pro converge");
