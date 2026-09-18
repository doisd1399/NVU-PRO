import fs from "node:fs";

const root = process.cwd();
const servicePath = "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java";
const flowPath = "android/app/src/main/java/com/nvu/operacional/GtoDeterministicFlowPolicy.java";
const syncPath = "android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java";
const service = fs.readFileSync(`${root}/${servicePath}`, "utf8");
const flow = fs.readFileSync(`${root}/${flowPath}`, "utf8");
const sync = fs.readFileSync(`${root}/${syncPath}`, "utf8");
const checks = [];
const check = (name, ok) => {
  checks.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
};
const body = (start, end) => {
  const a = service.indexOf(start);
  const b = service.indexOf(end, a);
  return a >= 0 && b > a ? service.slice(a, b) : "";
};
const listMessage = body("private void maybeAnnounceFastFreightListMessage", "private void resetLiveFreightMessageCandidate");
const startSession = body("private boolean startNextTripSessionOnAccept", "private void markAcceptKmEvidence");
const preciseCommit = body("private void commitPreciseFreight", "private void clearUncommittedSelectedFreight");
const normalize = body("private void normalizeOrphanedTripStartedState", "private boolean mayObserveFreightSelectionSurface");

check("list count is the same bounded AcceptRects snapshot", listMessage.includes('putInt("freightCount", rowCount)') && listMessage.includes('putInt("freightVisualCount", rowCount)'));
check("list message is immediate and not semantic-OCR gated", listMessage.includes('announceDriverStage("FREIGHT_LIST_DETECTED"') && !listMessage.includes("FAST_FREIGHT_MESSAGE_CONFIRM_MS") && !listMessage.includes("isFreightPageSemanticallyCertified"));
check("new touch transaction does not enter TRIP_STARTED", startSession.includes('putString("tripState", STATE_CONFIRMING_FREIGHT)') && !startSession.includes("setTripState(STATE_TRIP_STARTED"));
check("orphaned TRIP_STARTED has a pure policy", flow.includes("hasDurableTripStartedIdentity") && flow.includes("isOrphanedTripStarted"));
check("orphaned TRIP_STARTED is normalized centrally", service.includes("normalizeOrphanedTripStartedState(rawState)") && normalize.includes('putString("tripState", STATE_WAITING_FREIGHT)'));
check("new list retires only orphaned context", service.includes("retireOrphanedTripContextAtNewFreightList") && service.includes("NEW_FREIGHT_LIST_AFTER_ORPHANED_TRIP"));
check("selected row is locked before validation", service.indexOf('persistSelectionIdentity(row, "TOUCH_LOCKED"') < service.indexOf("runPreciseSelectedRowOcr(transaction)", service.indexOf('persistSelectionIdentity(row, "TOUCH_LOCKED"')));
check("manual route is required after row and km/value", preciseCommit.includes("beginManualRouteSelection") && preciseCommit.includes("commitReviewedFreight"));
check("certified freight is sealed before durable lock", preciseCommit.includes("GtoCertifiedFreight.seal") && preciseCommit.indexOf("GtoCertifiedFreight.seal") < preciseCommit.indexOf("lockSelectedFreight"));
check("TRIP_IN_PROGRESS follows durable lock", preciseCommit.includes("lockSelectedFreight") && preciseCommit.includes("transitionConfirmedFreightToTripInProgress") && preciseCommit.indexOf("lockSelectedFreight") < preciseCommit.indexOf("transitionConfirmedFreightToTripInProgress"));
check("submission remains terminal-only", sync.includes("GtoTripSubmissionPolicy.maySubmit") && sync.includes("Envio bloqueado: a viagem ainda não foi confirmada como Concluído"));

const failed = checks.filter(Boolean).length !== checks.length;
console.log(`${checks.length - (failed ? 1 : 0)}/${checks.length} HF208 SSOT final checks passed.`);
if (failed) process.exit(1);
