import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const read = p => fs.readFileSync(p, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const city = read("android/app/src/main/java/com/nvu/operacional/GtoCityTextResolver.java");
const origin = read("android/app/src/main/java/com/nvu/operacional/GtoOriginGeometryPolicy.java");
const recovery = read("android/app/src/main/java/com/nvu/operacional/GtoSessionRecoveryPolicy.java");
const sync = read("android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java");
const coordinator = read("android/app/src/main/java/com/nvu/operacional/GtoTripSubmissionCoordinator.java");
const gradle = read("android/app/build.gradle");
const workflow = read(".github/workflows/build-android-release.yml");

const checks = [];
function check(name, ok) {
  checks.push({name, ok: !!ok});
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}
const code = Number((gradle.match(/versionCode\s+(\d+)/)||[])[1]||0);
const patch = Number((gradle.match(/versionName\s+"1\.0\.(\d+)"/)||[])[1]||0);
check("HF23 baseline identity is preserved or advanced", code >= 75 && patch >= 75);
check("release workflow identity matches current Android version", workflow.includes(`EXPECTED_VERSION_CODE: "${code}"`) && workflow.includes(`EXPECTED_VERSION_NAME: "1.0.${patch}"`) && workflow.includes(`versionCode ${code}`) && workflow.includes(`versionName "1.0.${patch}"`));
check("destination resolver is advisory-only", city.includes("NEAR_MATCH_NOT_APPLIED") && !service.includes("option.destination = destinationResolution.value"));
check("origin ROI rejects compact Km and money labels", origin.includes("isMetricOrActionLabel") && origin.includes("\\\\d+(?:[.,]\\\\d+)?\\\\s*k\\\\s*m"));
check("confirmed REVIEW_REQUIRED survives process restart", service.includes("GtoSessionRecoveryPolicy.restoredState") && recovery.includes('return confirmedReview ? "CONFIRMING_FREIGHT" : "WAITING_FREIGHT"'));
check("12h threshold is diagnostic only", recovery.includes("return hasRecoverableSnapshot") && service.includes("LONG_RUNNING_SESSION"));
check("durable queue/ACK mechanisms remain in place",
  sync.includes("STATUS_PENDING")
  && sync.includes("STATUS_SYNCED")
  && coordinator.includes("STATE_SENDING")
  && coordinator.includes("STATE_SYNCED")
  && coordinator.includes("STATE_PENDING_RETRY")
  && coordinator.includes("submitCompletedTrip")
  && service.includes("GtoTripSubmissionCoordinator.submitCompletedTrip")
  && service.includes("syncCanonicalState"));
check("selection still locks immutable touch identity", service.includes('persistSelectionIdentity(hit, "TOUCH_LOCKED", "precise-touch")') && service.includes("GtoSelectionIdentityPolicy.resolveExactTouchAfterTransition"));

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "nvu-hf23-"));
const sources = [
  "android/app/src/main/java/com/nvu/operacional/GtoCityTextResolver.java",
  "android/app/src/main/java/com/nvu/operacional/GtoListOriginTextPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoOriginGeometryPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoSessionRecoveryPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoSelectionEvidencePolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoSelectionIdentityPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoDeterministicFlowPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoManualRouteSelectionPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoFreightReviewPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoFreightSemanticCertificationPolicy.java",
  "android/app/src/main/java/com/nvu/operacional/GtoMoneyValue.java",
  "android/app/src/main/java/com/nvu/operacional/GtoResultValueConsensus.java",
  "scripts/java-tests/com/nvu/operacional/GtoHf23ProductionFlowProbe.java",
];
let r = spawnSync("javac", ["-encoding", "UTF-8", "-d", temp, ...sources], {encoding:"utf8"});
if (r.stdout) process.stdout.write(r.stdout); if (r.stderr) process.stderr.write(r.stderr);
check("HF23 pure production-flow probe compiles", r.status === 0);
if (r.status === 0) {
  r = spawnSync("java", ["-cp", temp, "com.nvu.operacional.GtoHf23ProductionFlowProbe"], {encoding:"utf8"});
  if (r.stdout) process.stdout.write(r.stdout); if (r.stderr) process.stderr.write(r.stderr);
  check("5 distinct freight journeys pass init -> selection -> trip -> result -> receive -> automatic-send model", r.status === 0);
}
fs.rmSync(temp, {recursive:true, force:true});

const failed = checks.filter(x => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF23 production certification checks passed.`);
if (failed.length) process.exit(1);
