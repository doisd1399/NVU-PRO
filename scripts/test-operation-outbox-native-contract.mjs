import assert from "node:assert/strict";
import fs from "node:fs";
const java="android/app/src/main/java/com/nvu/operacional/", read=p=>fs.readFileSync(p,"utf8");
// Integration boundaries complement the JVM store/coordinator tests. This
// contract does not claim to compile the full Android SDK or exercise a device.
for(const name of ["SimpleProNativeSubmissionCoordinator","SimpleAutomationService","ProPendingTripJobService"])
  assert.match(read(java+name+".java"),/PendingOperationStartStore\.blocks/);
const max=read(java+"GtoAutoTripSync.java"), plugin=read(java+"SimpleAutomationPlugin.java");
assert.equal((max.match(/PendingOperationStartStore\.blocks/g)||[]).length,2,"both Max state sync and sealed receipt uploader wait for start ACK");
assert.match(max,/pendingOperationSessionIds[\s\S]+driver\.equals\(clean\(user\.getUid\(\)\)\)/);
assert.match(max,/company\.equals\(clean\(payload\.optString\("companyId"/);
assert.match(max,/job\.equals\(clean\(payload\.optString\("jobId"/);
assert.match(plugin,/pendingGtoTripIds/);
assert.match(plugin,/if \(!pending && wasPending\)[\s\S]{0,600}scheduleImmediate/);
assert.match(plugin,/markOperationCapturePaused/);
const service=read(java+"SimpleAutomationService.java");
for(const entry of ["setRoute","requestReceiptCapture"])
  assert.match(service,new RegExp(`public static void ${entry}[\\s\\S]{0,650}PendingOperationStartStore\\.capturePaused`));
assert.match(read(java+"GtoObserverService.java"),/isOperationClosedForNewTrip\(\) \{\s*if \(PendingOperationStartStore\.capturePaused/);
const adapter=read("src/services/operationOutbox.ts");
assert.match(adapter,/data\.ownerAuthenticated \?/);
assert.match(adapter,/pendingGtoTripIds/);
assert.match(adapter,/entry\.kind === "finish" && entry\.state === "CONFIRMED"[\s\S]{0,250}confirmCompletedOperationQueueCleanup/);
assert.match(adapter,/if \(verified\) operationOutbox\.acknowledgeNativeCleanup/);
console.log("OPERATION_OUTBOX_NATIVE_CONTRACT_PASS: Pro/Max ordering, exact-owner diagnostics, local capture pause and server-proven cleanup");
