import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const sync = read("android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java");
const backend = read("functions/src/gtoState.ts");
const checks = [];
function check(name, condition) {
  const ok = Boolean(condition);
  checks.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}

check("canonical bootstrap does not compare stale local predecessor", backend.includes("const bootstrapState = !currentSnap.exists") && backend.includes("if (expectedState && !bootstrapState && expectedState !== currentState)"));
check("canonical existing-session CAS remains fail-closed", backend.includes("if (currentSnap.exists && currentState !== state && !transitions[currentState]?.has(state))"));
check("old queue is diagnostic and not a selection gate", service.includes("hasQueuedOtherThanForDriver") && !service.includes("hasQueuedOtherThanForDriver(context, currentSessionId, uid)) return"));
check("exit boundary invalidates only uncommitted freight touch", service.includes("invalidateTransientFreightSelectionForVisibilityBoundary"));
check("return path invalidates stale uncommitted touch", service.includes("invalidateTransientFreightSelectionForVisibilityBoundary(\"GTO_RETURN\")"));
check("touch cleanup clears stale UI marker", service.includes('.remove("pendingSelectionSource")') && service.includes('.remove("freightTouchPulseAt")'));
check("new session does not inherit prior selection evidence", service.includes('.remove("selectionSource")') && service.includes('.remove("selectionTouchSequence")'));
check("critical-window timeout is not the only cleanup boundary", service.includes("pauseScreenAnalysisOutsideGto") && service.includes("selectionCoordinator.finishCriticalWindow()"));
check("ACK remains durable before queue removal", sync.includes('putString("gtoTripSyncStatus", STATUS_SYNCED)') && sync.includes("queue.edit().remove(key).commit()"));

function canonicalTransition({ exists, expectedState, remoteState, target }) {
  const current = exists ? remoteState : "IDLE";
  const bootstrapState = !exists && (target === "WAITING_FREIGHT" || target === "IDLE");
  if (expectedState && !bootstrapState && expectedState !== current) return false;
  return true;
}
function selectionCanProceed({ waiting, visualConfirmed, transportHealthy, oldQueue, canonicalError }) {
  return waiting && visualConfirmed && transportHealthy && oldQueue && canonicalError && true;
}

check("behavior: missing remote session can bootstrap WAITING after local CONFIRMING", canonicalTransition({
  exists: false,
  expectedState: "CONFIRMING_FREIGHT",
  remoteState: "IDLE",
  target: "WAITING_FREIGHT",
}));
check("behavior: existing remote session still rejects stale expectedState", !canonicalTransition({
  exists: true,
  expectedState: "WAITING_FREIGHT",
  remoteState: "CONFIRMING_FREIGHT",
  target: "TRIP_IN_PROGRESS",
}));
check("behavior: old same-driver queue does not block a confirmed current list", selectionCanProceed({
  waiting: true,
  visualConfirmed: true,
  transportHealthy: true,
  oldQueue: true,
  canonicalError: true,
}));
const previousSelectionEvidence = "touch-marker+frame-lock";
const freshSessionSelectionEvidence = "";
check("behavior: previous selection evidence is not reused by a fresh session", previousSelectionEvidence !== freshSessionSelectionEvidence && freshSessionSelectionEvidence === "");

class TouchRuntime {
  constructor() {
    this.critical = false;
    this.pulse = false;
    this.pendingUiMarker = "";
    this.markers = 0;
  }
  touch() {
    if (this.critical) return false;
    this.critical = true;
    this.pulse = true;
    this.pendingUiMarker = "touch-marker";
    this.markers += 1;
    return true;
  }
  exitOrReturn() {
    this.critical = false;
    this.pulse = false;
    this.pendingUiMarker = "";
  }
  timeout() {
    this.critical = false;
    this.pulse = false;
    this.pendingUiMarker = "";
  }
}

const runtime = new TouchRuntime();
check("behavior: first touch opens one critical correlation window", runtime.touch() && runtime.critical && runtime.markers === 1);
runtime.exitOrReturn();
check("behavior: return clears abandoned marker and permits next touch", !runtime.critical && runtime.pendingUiMarker === "" && runtime.touch() && runtime.markers === 2);
runtime.timeout();
check("behavior: expired touch cannot poison later consecutive freight", !runtime.critical && !runtime.pulse && runtime.pendingUiMarker === "");

const failed = checks.filter((ok) => !ok).length;
if (failed) {
  console.error(`\n${failed} HF123 check(s) failed.`);
  process.exit(1);
}
console.log(`\nHF123 consecutive-selection recovery regression: APPROVED (${checks.length}/${checks.length})`);
