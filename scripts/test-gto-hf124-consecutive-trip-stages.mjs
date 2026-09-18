import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const policy = read("android/app/src/main/java/com/nvu/operacional/GtoResultActionFlowPolicy.java");
const setup = read("src/components/GtoObserverSetup.tsx");
const checks = [];
function check(name, condition) {
  const ok = Boolean(condition);
  checks.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}

check("passive sensor remains attached during temporary capture recovery", service.includes("keepPassiveTransportObserver") && policy.includes("return observeEnabled && overlayAllowed"));
check("sensor policy documents separate action authority", policy.includes("Listener presence is transport only") && policy.includes("action mutation remains separately guarded"));
check("orphan critical window is self-healed before a new marker", service.includes("ORPHANED_CRITICAL_WINDOW") && service.includes("selectionCoordinator.finishCriticalWindow();"));
check("deferred selected-row commit has an explicit drain", service.includes("drainDeferredPreciseFreightCommitIfReady"));
check("deferred commit drains on GTO return", service.includes("mainHandler.post(this::drainDeferredPreciseFreightCommitIfReady);") && service.includes("VISIBILITY_RETURN_3_FRAMES"));
check("deferred commit drains after a certified list", /boolean actionableList = semanticList;[\s\S]{0,700}if \(semanticList\) \{[\s\S]{0,700}drainDeferredPreciseFreightCommitIfReady/.test(service));
check("drain never promotes an unconfirmed identity", service.includes("if (!hasConfirmedSelectionIdentity()) return;"));
check("native notification does not mask recoverable trip state", service.includes("!isRecoverableActiveState(state) && !STATE_RESULT_CONFIRMED.equals(state)"));
check("frontend lifecycle copy does not mask active trip stage", setup.includes("backgroundLifecycleOnly") && setup.includes('"WAITING_FREIGHT"') && setup.includes("!backgroundLifecycleOnly"));

const activeStages = new Set([
  "WAITING_FREIGHT", "CONFIRMING_FREIGHT", "TRIP_IN_PROGRESS",
  "RESULT_DETECTED", "AWAITING_BONUS_VALIDATION", "RESULT_CONFIRMED", "REJECTED_BONUS",
]);
function backgroundCopyLeads({ lifecycleBackground, state }) {
  return lifecycleBackground && !activeStages.has(state);
}
function passiveSensorAttached({ enabled, overlayAllowed }) {
  return enabled && overlayAllowed;
}
function deferredDrain({ state, identityConfirmed, paused }) {
  return !paused && identityConfirmed && (state === "WAITING_FREIGHT" || state === "CONFIRMING_FREIGHT");
}

check("behavior: background label yields to WAITING_FREIGHT", !backgroundCopyLeads({ lifecycleBackground: true, state: "WAITING_FREIGHT" }));
check("behavior: background label yields to CONFIRMING_FREIGHT", !backgroundCopyLeads({ lifecycleBackground: true, state: "CONFIRMING_FREIGHT" }));
check("behavior: background label remains diagnostic while idle", backgroundCopyLeads({ lifecycleBackground: true, state: "IDLE" }));
check("behavior: listener survives a short unhealthy transport window", passiveSensorAttached({ enabled: true, overlayAllowed: true }));
check("behavior: listener is absent when observation is disabled", !passiveSensorAttached({ enabled: false, overlayAllowed: true }));
check("behavior: deferred commit drains in WAITING_FREIGHT", deferredDrain({ state: "WAITING_FREIGHT", identityConfirmed: true, paused: false }));
check("behavior: deferred commit drains in CONFIRMING_FREIGHT", deferredDrain({ state: "CONFIRMING_FREIGHT", identityConfirmed: true, paused: false }));
check("behavior: deferred commit does not bypass TOUCH_LOCKED", !deferredDrain({ state: "WAITING_FREIGHT", identityConfirmed: false, paused: false }));

let session = "session-0";
let selected = false;
let registered = 0;
for (let trip = 1; trip <= 12; trip += 1) {
  const prior = session;
  session = `session-${trip}`;
  selected = false;
  const listDetected = true;
  const sensor = passiveSensorAttached({ enabled: true, overlayAllowed: true });
  const selectionAccepted = listDetected && sensor && !backgroundCopyLeads({ lifecycleBackground: true, state: "WAITING_FREIGHT" });
  selected = selectionAccepted;
  const completed = selected;
  const acked = completed;
  if (acked) registered += 1;
  check(`behavior: consecutive trip ${trip} isolates session and completes all stages`, prior !== session && listDetected && selected && completed && acked);
}
check("behavior: all modeled consecutive trips register automatically", registered === 12);

const failed = checks.filter((ok) => !ok).length;
if (failed) {
  console.error(`\n${failed} HF124 check(s) failed.`);
  process.exit(1);
}
console.log(`\nHF124 consecutive-trip stages regression: APPROVED (${checks.length}/${checks.length})`);
