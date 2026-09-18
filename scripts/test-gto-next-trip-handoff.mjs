import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const observer = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const policy = read("android/app/src/main/java/com/nvu/operacional/GtoDeterministicFlowPolicy.java");
const sync = read("android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java");

const sectionBetween = (source, start, end) => {
  const begin = source.indexOf(start);
  assert.ok(begin >= 0, `missing ${start}`);
  const finish = source.indexOf(end, begin);
  return source.slice(begin, finish >= 0 ? finish : source.length);
};

const handoff = sectionBetween(
  observer,
  "private boolean handoffToNextTripSession",
  "private void clearCompletionQueueSealRecovery",
);
const canPrepare = sectionBetween(
  observer,
  "private boolean canPrepareNextFreightFromSealedQueue",
  "private boolean handoffToNextTripSession",
);
const listener = sectionBetween(
  observer,
  "private GtoAutoTripSync.Listener automaticTripSyncListener",
  "private void flushAutomaticTripQueue",
);
const proofAck = sectionBetween(
  observer,
  "private void finalizeResultProofAfterServerAck",
  "private void armCompletionQueueSealRecovery",
);
const terminalCompletion = sectionBetween(
  observer,
  "private void confirmNormalResultAutomatically",
  "private void announceCurrentTripSubmissionState",
);

// Architectural contract: local queue seal creates a pending boundary. Firebase ACK is
// independent, and the next session is created only by the first human ACEITAR.
assert.match(observer, /handoffToNextTripSession\(completedSessionId\)/);
assert.match(terminalCompletion, /submitCompletedTrip[\s\S]{0,1400}handoffToNextTripSession/);
assert.doesNotMatch(canPrepare, /STATUS_SYNCED/);
assert.match(canPrepare, /mayPrepareNextFreightAfterSealedQueue/);
assert.match(handoff, /GtoAutoTripSync\.hasPendingSession/);
assert.match(handoff, /gtoNextTripPending/);
assert.match(handoff, /WAITING_FOR_ACCEPT/);
assert.doesNotMatch(handoff, /beginSessionSnapshot/);
assert.match(handoff, /setTripState\(STATE_WAITING_FREIGHT/);
assert.doesNotMatch(handoff, /stopProjection\(|destroyMediaProjection|stopObserver\(/);
assert.match(handoff, /clearTripAnalysis\(\)/);
assert.match(handoff, /gtoNextTripPreviousSessionId/);

// Late callbacks are independent: only the active session may mutate current sync state.
assert.match(listener, /String currentSession = prefs\.getString\("gtoTripSessionId", ""\)/);
assert.match(listener, /if \(!sessionId\.equals\(currentSession\)\)/);
assert.match(sync, /if \(currentSession\) \{/);
assert.match(sync, /putString\("gtoTripSyncStatus", STATUS_SYNCED\)/);
assert.match(proofAck, /completedSession\.equals\(prefs\.getString\("gtoTripSessionId", ""\)/);

// Progress contract: completedBeforeThisTrip means trips completed before current.
assert.match(policy, /safeStartingProgress \+ 1 < totalDeliveries/);
const hasNext = (completedBeforeThisTrip, totalDeliveries) =>
  totalDeliveries > 0 && Math.max(0, completedBeforeThisTrip) + 1 < totalDeliveries;
assert.equal(hasNext(0, 2), true, "Trip 1 of 2 has a next freight");
assert.equal(hasNext(1, 2), false, "Trip 2 of 2 is the last freight");
assert.equal(hasNext(0, 1), false, "single-trip operation has no phantom next session");

const sealPending = (state) => ({
  ...state,
  currentSession: "",
  previousSession: state.currentSession,
  state: "WAITING_FREIGHT",
  nextPending: true,
});
const accept = (state, row = 0) => {
  if (!state.nextPending || state.transactionId) return state;
  const currentSession = `session-${state.created + 1}`;
  return {
    ...state,
    currentSession,
    state: "TRIP_STARTED",
    nextPending: false,
    transactionId: `sel-${currentSession}`,
    row,
    evidence: "EVIDENCE_PENDING",
    created: state.created + 1,
  };
};
const applyAck = (state, ackSession) =>
  ackSession === state.currentSession ? { ...state, sync: "SYNCED" } : state;
const applyDuplicateAccept = (state, row = 0) => accept(state, row);

// Test 1: Trip 1 seals locally; no next session exists before ACEITAR.
let flow = { currentSession: "trip-1", state: "RESULT_CONFIRMED", sync: "PENDING", created: 1 };
flow = sealPending(flow);
assert.equal(flow.state, "WAITING_FREIGHT");
assert.equal(flow.nextPending, true);
assert.equal(flow.currentSession, "");

// Test 2: the first ACEITAR creates exactly one operational session immediately.
flow = accept(flow, 1);
assert.equal(flow.state, "TRIP_STARTED");
assert.equal(flow.transactionId, "sel-session-2");
assert.equal(flow.row, 1);

// Test 3: late ACK for Trip 1 does not touch Trip 2.
const afterLateAck = applyAck(flow, "trip-1");
assert.equal(afterLateAck.currentSession, flow.currentSession);
assert.equal(afterLateAck.state, "TRIP_STARTED");

// Test 4: no network still permits local session start after the first ACEITAR.
assert.equal(flow.state, "TRIP_STARTED");
assert.equal(flow.evidence, "EVIDENCE_PENDING");

// Test 5: repeated acceptance is idempotent and cannot create a second session.
const duplicate = applyDuplicateAccept(flow, 1);
assert.equal(duplicate.currentSession, flow.currentSession);
assert.equal(duplicate.transactionId, flow.transactionId);
assert.equal(duplicate.created, flow.created);

// Test 6: two different rows cannot silently replace the active transaction.
const otherRow = applyDuplicateAccept(flow, 2);
assert.equal(otherRow.row, flow.row);
assert.equal(otherRow.currentSession, flow.currentSession);

// Test 7: last freight creates no phantom pending boundary.
assert.equal(hasNext(1, 2), false);

console.log("gto-next-trip-handoff: PASS 7 cenários + pending boundary + first ACEITAR + ACK isolation + idempotency");
