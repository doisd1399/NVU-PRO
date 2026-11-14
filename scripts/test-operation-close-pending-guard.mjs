import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8');
const app=read('src/context/AppContext.tsx');
const finishStart=app.indexOf('const finishJob =');
assert.ok(finishStart>=0,'completion handler found before inspecting its boundary');
const finish=app.slice(finishStart,app.indexOf('const cancelJob =',finishStart));
const flow=read('src/application/operation/FinalizeOperation.ts');
const store=read('android/app/src/main/java/com/nvu/operacional/ProPendingTripStore.java');
const cleaner=read('android/app/src/main/java/com/nvu/operacional/CompletedProOperationQueueCleaner.java');
const scope=read('android/app/src/main/java/com/nvu/operacional/CompletedOperationScope.java');
const overlay=read('android/app/src/main/java/com/nvu/operacional/SimpleAutomationService.java');
const worker=read('android/app/src/main/java/com/nvu/operacional/ProPendingTripJobService.java');
const server=read('functions/src/completeCanonicalOperation.ts');
const outbox=read('src/services/operationOutbox.ts');
const tripService=read('src/application/trip/CanonicalTripOperationService.ts');
const checks=[
 ['authenticated canonical server callable',finish.includes('getCurrentUserId()')&&finish.includes('operationOutbox.enqueueFinish')&&outbox.includes('sendFinish: entry => canonicalTripOperationService.finalizeOperation(entry.jobId)')&&tripService.includes('"completeCanonicalOperation"')],
 ['local queue never gates completion',!/getReadOnlyProQueueDiagnostics|inspectOperationCloseQueue|OPERATION_LOCAL_TRIPS_NOT_SETTLED/.test(finish)],
 ['client history never gates completion',!finish.includes('readAuthoritativeOperationState')],
 ['validated ACK precedes discard',flow.indexOf('dependencies.onConfirmed(completion)')<flow.indexOf('dependencies.discardPending(id)')],
 ['cleanup failure never rejects completion',flow.includes('void Promise.resolve()')&&flow.includes('onCleanupError')],
 ['native cleanup reads fresh server document',cleaner.includes('.get(Source.SERVER)')],
 ['native cleanup rechecks authenticated owner',cleaner.includes('!uid.equals(current.getUid())')&&scope.includes('!uid.equals(owner)')],
 ['cleanup requires completed scope',scope.includes('!"completed".equalsIgnoreCase')],
 ['cleanup scopes job/company/contract/driver',scope.includes('jobId.equals')&&scope.includes('companyId.equals')&&scope.includes('contractId.equals')&&scope.includes('driverId.equals')],
 ['durable marker precedes cancellation',store.indexOf('index.edit().putLong(scope.markerKey()')<store.indexOf('cancel.add(id)')],
 ['cancellation fences callbacks, timeout and worker stop',store.includes('pending.getInt("nativeAttemptGeneration", 0) + 1')
   && overlay.includes('if (prefs == null || !ProPendingTripStore.contains(prefs, id))')
   && overlay.includes('ProPendingTripStore.isCompletionRecorded(prefs, entry) || !ProPendingTripStore.isRetryAllowed(entry)')
   && worker.includes('&& ProPendingTripStore.isRetryAllowed(entry)')],
 ['recovery resumes at app return',app.includes('reconcileCompletedOperationQueues')&&app.includes('"visibilitychange", refresh')],
 ['cleanup never writes server trips',!/getHttpsCallable|\.set\(|\.update\(|\.delete\(/.test(cleaner)],
 ['server checks exact confirmed quantity',server.includes('projection.confirmedTripCount < total')&&server.includes('projection.confirmedTripCount > total')],
 ['completed remains terminal/idempotent',server.includes('lifecycle === "completed"')&&server.includes('alreadyCompleted: true')],
];
for(const [name,passed]of checks){assert.ok(passed,name);console.log('PASS '+name);}
console.log('PASS '+checks.length+' server completion/local discard invariants');
