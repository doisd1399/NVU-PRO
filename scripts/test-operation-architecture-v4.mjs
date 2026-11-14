import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const currentOperation = read("src/lib/currentOperation.ts");
const dashboard = read("src/pages/driver/Dashboard.tsx");
const recordTrip = read("src/pages/driver/RecordTrip.tsx");
const driverLayout = read("src/layouts/DriverLayout.tsx");
const profile = read("src/pages/driver/Profile.tsx");
const app = read("src/context/AppContext.tsx");
const operationCommand = read("src/application/operation/CanonicalOperationCommandService.ts");
const manualFinalizer = read("functions/src/completeCanonicalOperation.ts");
const adapter = read("src/services/sync/FirebaseTripSyncAdapter.ts");
const webWriter = read("functions/src/registerCanonicalSimpleTrip.ts");
const proWriter = read("functions/src/registerGtoProReceipt.ts");
const gtoWriter = read("functions/src/gtoTrips.ts");
const reconcile = read("functions/src/reconcileOperationTrips.ts");
const rules = read("firestore.rules");
const outbox = read("src/application/operation/DurableOperationOutbox.ts");
const operationAdapter = read("src/services/operationOutbox.ts");

assert.match(currentOperation, /selectCanonicalOperationTrips/);
assert.match(currentOperation, /isCanonicalConfirmedTrip/);
for (const [name, source] of [["Dashboard", dashboard], ["RecordTrip", recordTrip], ["DriverLayout", driverLayout]]) {
  assert.match(source, /selectCanonicalOperationTrips/, `${name} deve usar a lista canônica da operação`);
  assert.doesNotMatch(source, /filterAndSortTripHistory/, `${name} não pode usar histórico genérico para progresso/lista da operação`);
}
assert.match(profile, /canonicalProgressByJobId = useMemo\([\s\S]*?selectCanonicalOperationTrips\(job, historicoTrips,/,
  "o progresso histórico no Profile deve usar somente viagens canônicas confirmadas");
assert.match(profile, /const operationTripsForPro = activeJob \? selectCanonicalOperationTrips\(activeJob, historicoTrips,/,
  "a lista da operação atual no Profile deve usar viagens canônicas");
assert.match(profile, /const resultTrips = useMemo\(\(\) =>[\s\S]*?filterAndSortTripHistory\(historicoTrips/,
  "o histórico genérico no Profile fica restrito à projeção de Resultados");
assert.match(profile, /<DriverResults[\s\S]*?trips=\{resultTrips\}/,
  "a projeção genérica deve alimentar somente o componente de Resultados");
assert.equal([...profile.matchAll(/filterAndSortTripHistory/g)].length, 2,
  "Profile pode importar e usar histórico genérico somente uma vez, na projeção de Resultados");

assert.match(webWriter, /const isGeneric = !isPrint && !isSimple/);
assert.match(webWriter, /operationAwaitingCompletionPatch/);
assert.match(webWriter, /operationReconciliationVersion:\s*4/);
assert.match(proWriter, /operationAwaitingCompletionPatch/);
assert.match(proWriter, /operationReconciliationVersion:\s*4/);
assert.match(gtoWriter, /operationAwaitingCompletionPatch/);
assert.match(gtoWriter, /trip_operation_slots/);
assert.match(gtoWriter, /operationReconciliationVersion \|\| 0\) >= 4/);

assert.match(adapter, /every Web\/Print\/Pro\/offline registration crosses one server-owned/);
assert.match(adapter, /this\.registerCanonicalTrip/);
assert.doesNotMatch(adapter, /transaction\.set\(tripRef/);
assert.doesNotMatch(adapter, /transaction\.update\(jobRef/);

assert.match(reconcile, /authoritativeCoverageComplete/);
assert.match(reconcile, /canonicalSlotPatches/);
assert.match(reconcile, /CANONICAL_SLOT_LEDGER_REBUILT/);
assert.match(reconcile, /canCompleteLifecycle/);
assert.match(reconcile, /operationReconciliationVersion:\s*4/);
assert.doesNotMatch(reconcile, /jobPatch\.status\s*=\s*["']active["']/);

const finishStart = app.indexOf("const finishJob =");
assert.ok(finishStart >= 0, "the completion handler must be found before inspecting its boundary");
const finishEnd = app.indexOf("const cancelJob =", finishStart);
const finish = app.slice(finishStart, finishEnd > finishStart ? finishEnd : undefined);
assert.doesNotMatch(finish, /readAuthoritativeOperationState/);
assert.match(finish, /operationOutbox\.enqueueFinish/);
assert.match(finish, /pendingSync: true, completed: false/);
assert.match(operationAdapter, /sendFinish: entry => canonicalTripOperationService\.finalizeOperation\(entry\.jobId\)/);
assert.match(outbox, /result\?\.completed !== true \|\| result\.jobId !== entry\.jobId \|\| result\.status !== "completed"/);
assert.match(outbox, /this\.ports\.canFinish\(candidate\)/);
assert.match(finish, /await mirrorOperationCapturePause/, "new capture pauses while existing receipts remain uploadable");
assert.doesNotMatch(finish, /inspectOperationCloseQueue|getReadOnlyProQueueDiagnostics/);
assert.doesNotMatch(finish, /setLifecycleStatus\([^)]*completed/);
assert.match(operationCommand, /SERVER_OWNED_OPERATION_COMPLETION/);
assert.match(manualFinalizer, /driver-explicit-confirmation/);
assert.match(manualFinalizer, /operationCompletionPatch/);
assert.match(manualFinalizer, /OPERATION_TRIPS_NOT_VALIDATED/);

// Drivers and managers can no longer close a job from a denormalized progress
// counter. Completion is written by Admin SDK Functions only.
assert.doesNotMatch(rules, /request\.resource\.data\.status == 'completed'[\s\S]{0,350}resource\.data\.progress >= resource\.data\.totalDeliveries/);
assert.match(rules, /!\(request\.resource\.data\.status == 'completed' && resource\.data\.status != 'completed'\)/);

const compatibilityTrigger = read("functions/src/reconcileOperationProjectionOnTripWrite.ts");
const functionsIndex = read("functions/src/index.ts");
assert.match(compatibilityTrigger, /reconcileOperationTripsCore/, "cross-version history writes must converge through the V4 reconciler");
assert.match(compatibilityTrigger, /historico_viagens\/\{tripId\}/, "compatibility guard must observe history writes");
assert.match(functionsIndex, /reconcileOperationProjectionOnTripWrite/, "compatibility convergence trigger must be exported");

console.log("OPERATION_ARCHITECTURE_V4_PASS canonical registration/progress/slots, awaiting-completion gate, explicit server-validated driver finalization, v4 self-healing reconciliation");
