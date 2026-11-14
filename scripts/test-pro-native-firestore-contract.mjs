import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rules = readFileSync("firestore.rules", "utf8");
const coordinator = readFileSync(
  "android/app/src/main/java/com/nvu/operacional/SimpleProNativeSubmissionCoordinator.java",
  "utf8",
);

const driverHelper = rules.match(/function tripDriverIdFromMap\(trip\)\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? "";
assert.match(driverHelper, /'driverId' in trip/);
assert.match(driverHelper, /'motoristaId' in trip/);
assert.match(driverHelper, /'userId' in trip/);
assert.match(driverHelper, /return \('driverId' in trip && trip\.driverId is string\)/);
assert.match(rules, /'companyId' in job/);
assert.match(rules, /'empresaId' in job/);
assert.match(rules, /'contractId' in job/);
assert.match(rules, /'contratoId' in job/);
assert.match(rules, /tripDriverIdFromMap\(get\(\/databases\/\$\(database\)\/documents\/trabalhos\/\$\(request\.resource\.data\.jobId\)\)\.data\) == request\.resource\.data\.driverId/);
assert.match(rules, /slotClaim\.tripId == tripId/);
assert.match(rules, /trip\.serverValidatedAt == request\.time/);
assert.match(coordinator, /getHttpsCallable\("registerCanonicalSimpleTrip"\)\.call\(request\)/);
assert.match(coordinator, /getHttpsCallable\("registerGtoProReceipt"\)\.call\(request\)/);
assert.match(coordinator, /SIMPLE_ACK_HISTORY_MISSING/);
assert.match(coordinator, /sameTripEvidence/);
assert.match(coordinator, /sameReceiptOwner/);
assert.doesNotMatch(coordinator, /collection\("historico_viagens"\)\.document\([^)]*\)\.(?:set|update)\(/);
assert.match(coordinator, /get\(Source\.SERVER\)/);
assert.match(coordinator, /getIdToken\(true\)/);
assert.match(coordinator, /AUTH_REQUIRED_PREFIX \+ "TOKEN_REFRESH_FAILED"/);
assert.match(coordinator, /isPermissionFailureReason/);
assert.match(coordinator, /classifyFirestoreFailure/);
assert.match(coordinator, /FirebaseFirestoreException\.Code/);
assert.match(coordinator, /attemptFp=" \+ fingerprint\(attemptId\)/);
const simpleStart = coordinator.indexOf("private static void submitSimpleTrip");
const serverHistoryRead = coordinator.indexOf(".get(Source.SERVER)", simpleStart);
const simpleProjectionRefresh = coordinator.indexOf("SimpleAutomationService.refreshOperationSnapshot(", serverHistoryRead);
assert.ok(simpleStart >= 0 && serverHistoryRead > simpleStart && simpleProjectionRefresh > serverHistoryRead,
  "local operation/history projection must follow the exact server ACK");

console.log("PASS: native Firestore binding accepts canonical/legacy job aliases and requires server ACK");
