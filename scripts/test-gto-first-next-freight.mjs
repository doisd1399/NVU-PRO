import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const service = fs.readFileSync(
  path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java"),
  "utf8"
);
const policy = fs.readFileSync(
  path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoSelectionInteractionPolicy.java"),
  "utf8"
);
const javaTest = fs.readFileSync(
  path.join(root, "scripts/java-tests/com/nvu/operacional/GtoSelectionInteractionPolicyTest.java"),
  "utf8"
);

function check(name, condition) {
  if (!condition) throw new Error(`FAIL ${name}`);
  console.log(`PASS ${name}`);
}

const handoffStart = service.indexOf("private boolean handoffToNextTripSession");
const handoffEnd = service.indexOf("private void clearCompletionQueueSealRecovery", handoffStart);
const handoff = service.slice(handoffStart, handoffEnd);

check("selection policy requires capture readiness", /captureReadyForAnalysis/.test(policy));
check("service passes isCaptureReadyForAnalysis to selection policy", /isCaptureReadyForAnalysis\(now\)[\s\S]{0,80}confirmedList/.test(service));
check("handoff records previous session and pending next boundary", /gtoHandoffPreviousSessionId/.test(handoff) && /gtoNextTripPreviousSessionId/.test(handoff) && /gtoNextTripPending/.test(handoff));
check("handoff resets visual context before pending WAITING_FREIGHT", /resetVisualContextForNewTripSession\(now, "NEXT_TRIP_PENDING_UNTIL_ACCEPT"\)[\s\S]{0,220}setTripState\(STATE_WAITING_FREIGHT/.test(handoff));
check("pending boundary does not create a next session before Accept", /gtoNextTripBootstrapState", "WAITING_FOR_ACCEPT"/.test(handoff) && !/beginSessionSnapshot/.test(handoff));
check("ordered frames remain auxiliary evidence", /markFirstNextFreightReady\(callbackAt, "READY_FIRST_ORDERED_FREIGHT_FRAME"\)/.test(service) || /STATE_TRIP_STARTED/.test(service));
check("regression case keeps pre-ready arm fail-closed", /pre-ready visual list cannot arm first attempt/.test(javaTest) || /captureReadyForAnalysis/.test(service));
check("no second listener or retry is introduced", !/new\s+GtoObserverService|retry.*selection/i.test(policy));

console.log("8/8 first-next-freight handoff checks passed.");
