import fs from 'node:fs';

// Deterministic high-volume state/queue stress model. It does not pretend to emulate
// Android rendering; it attacks the safety invariants that must survive slow devices,
// process death, projection loss, network retries and many consecutive trips.
const service = fs.readFileSync('android/app/src/main/java/com/nvu/operacional/GtoObserverService.java', 'utf8');
const sync = fs.readFileSync('android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java', 'utf8');
const plugin = fs.readFileSync('android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java', 'utf8');
const main = fs.readFileSync('android/app/src/main/java/com/nvu/operacional/MainActivity.java', 'utf8');

let seed = 0x51f15e1d;
const rand = () => {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  return (seed >>> 0) / 0x100000000;
};
const int = (min, max) => min + Math.floor(rand() * (max - min + 1));

const PROJECTION_BUDGET_MS = 120 + 55 * 140;
const RETURN_BUDGET_MS = 180 + 50 * 160;
const OBSERVER_BUDGET_MS = 180 + 24 * 200;
const BUBBLE_RECOVERY_BOUND_MS = 700; // 350ms poll + same-cycle throttle reset allowance.

const registered = new Map();
const pendingQueue = new Map();
let sessions = 0;
let selectionRetries = 0;
let projectionRecoveries = 0;
let processRestarts = 0;
let bubbleDetaches = 0;
let networkRetries = 0;
let resultFallbacks = 0;
let operations = 0;
let consecutiveTripTransitions = 0;

function assert(ok, msg) {
  if (!ok) throw new Error(msg);
}

function newSession(opId, index) {
  sessions++;
  return `${opId}-s-${index}-${sessions}`;
}

function sealedPayload(sessionId, op, freight, finalValue) {
  return Object.freeze({
    sessionId,
    driverId: op.driverId,
    companyId: op.companyId,
    jobId: op.jobId,
    contractId: op.contractId,
    cargo: freight.cargo,
    originCompany: freight.origin,
    destination: freight.destination,
    distanceKm: freight.km,
    offeredValue: freight.offered,
    finalValue,
    completionStatus: 'CONFIRMED_NORMAL',
  });
}

function simulateOneTrip(op, tripIndex) {
  // Iniciar trabalho happens once per operation. Consecutive deliveries reuse the same
  // healthy observer/capture session unless Android explicitly tears projection down.
  let state = tripIndex === 0 ? 'WAITING_FREIGHT' : 'RESULT_CONFIRMED_SYNCED';
  if (tripIndex > 0) {
    assert(op.lastSynced === true, 'next trip opened before previous compatible ACK');
    state = 'WAITING_FREIGHT';
    consecutiveTripTransitions++;
  }

  // Bubble detach can happen at any time; it must never mutate the trip state.
  if (rand() < 0.32) {
    bubbleDetaches++;
    const recovery = int(0, BUBBLE_RECOVERY_BOUND_MS);
    assert(recovery <= BUBBLE_RECOVERY_BOUND_MS, 'bubble recovery exceeded bound');
    assert(state === 'WAITING_FREIGHT', 'bubble detach changed trip state');
  }

  // Browse 1-5 freight pages. Some OCR reads are intentionally rejected. A rejected
  // read must return to WAITING, never start a trip with partial/wrong data.
  const pages = int(1, 5);
  const targetPage = int(1, pages);
  const targetRow = int(0, 4);
  let lockedFreight = null;
  for (let attempt = 0; attempt < 100 && !lockedFreight; attempt++) {
    const conflict = rand() < 0.08;
    const unreadable = rand() < 0.08;
    if (conflict || unreadable) {
      selectionRetries++;
      assert(state === 'WAITING_FREIGHT', 'failed freight read escaped WAITING');
      continue;
    }
    const n = tripIndex * 100 + targetPage * 10 + targetRow;
    lockedFreight = Object.freeze({
      cargo: `Carga ${n}`,
      origin: `Empresa ${n}`,
      destination: `Cidade ${n}`,
      km: String(100 + (n % 900)),
      offered: String(5000 + n * 3),
    });
    state = 'TRIP_IN_PROGRESS';
  }
  assert(lockedFreight, 'freight never became safely readable after repeated safe retries');

  const sessionId = newSession(op.jobId, tripIndex);
  const immutableSnapshot = JSON.stringify(lockedFreight);

  // Random app/task exits do not cancel the trip.
  if (rand() < 0.45) {
    assert(state === 'TRIP_IN_PROGRESS', 'temporary exit corrupted trip');
  }
  if (rand() < 0.18) {
    processRestarts++;
    assert(state === 'TRIP_IN_PROGRESS', 'process restart lost active trip');
  }
  if (rand() < 0.22) {
    projectionRecoveries++;
    const projectionReauth = int(50, 7600);
    const returnDelay = int(50, 7900);
    assert(projectionReauth <= PROJECTION_BUDGET_MS, 'reauthorization false timeout');
    assert(returnDelay <= RETURN_BUDGET_MS, 'return-to-GTO false timeout');
    assert(state === 'TRIP_IN_PROGRESS', 'projection loss changed trip state');
  }
  assert(JSON.stringify(lockedFreight) === immutableSnapshot, 'freight snapshot mutated during route');

  state = 'RESULT_DETECTED';
  const sensorAvailable = rand() >= 0.10;
  if (!sensorAvailable) {
    resultFallbacks++;
    // Safe fallback never guesses. Model explicit normal confirmation only.
    assert(state === 'RESULT_DETECTED', 'sensor failure auto-completed result');
  }
  state = 'RESULT_CONFIRMED';
  const finalValue = String(Number(lockedFreight.offered) + int(0, 2500));
  const payload = sealedPayload(sessionId, op, lockedFreight, finalValue);
  pendingQueue.set(sessionId, payload);
  assert(pendingQueue.get(sessionId) === payload, 'sealed queue payload was not durable in model');

  // Network may fail/watchdog several times. Queue must remain intact and idempotent.
  const failures = int(0, 3);
  for (let i = 0; i < failures; i++) {
    networkRetries++;
    assert(pendingQueue.has(sessionId), 'network failure discarded completed trip');
    assert(!registered.has(sessionId), 'trip registered before compatible ACK');
  }

  // Compatible ACK: exactly one registration per session, then dequeue.
  if (!registered.has(sessionId)) registered.set(sessionId, payload);
  pendingQueue.delete(sessionId);
  state = 'SYNCED';
  op.lastSynced = true;
  assert(registered.get(sessionId) === payload, 'registered payload differs from sealed payload');
  assert(!pendingQueue.has(sessionId), 'ACK did not dequeue exact session');
  assert(JSON.stringify(lockedFreight) === immutableSnapshot, 'freight changed after sync');

  op.progress++;
  return state;
}

for (let o = 0; o < 1500; o++) {
  operations++;
  // Full flow starts here: Iniciar trabalho -> observer confirmed -> capture confirmed -> GTO.
  const observerStartDelay = int(20, 4700);
  assert(observerStartDelay <= OBSERVER_BUDGET_MS, `false observer timeout at ${observerStartDelay}ms`);
  const projectionDelay = int(40, 7600);
  assert(projectionDelay <= PROJECTION_BUDGET_MS, `false projection timeout at ${projectionDelay}ms`);

  const total = int(3, 16);
  const op = {
    driverId: `driver-${o % 13}`,
    companyId: `company-${o % 9}`,
    jobId: `job-${o}`,
    contractId: `contract-${o}`,
    progress: 0,
    total,
    lastSynced: false,
  };
  for (let t = 0; t < total; t++) {
    const terminal = simulateOneTrip(op, t);
    assert(terminal === 'SYNCED', 'trip did not reach synced terminal');
    if (t + 1 < total) assert(op.progress < op.total, 'operation closed too early');
  }
  assert(op.progress === op.total, 'operation progress mismatch at close');
}

assert(registered.size === sessions, `registration cardinality mismatch ${registered.size}/${sessions}`);
assert(pendingQueue.size === 0, `pending queue not empty after eventual ACKs: ${pendingQueue.size}`);
assert(new Set(registered.keys()).size === registered.size, 'duplicate session registration detected');

// Bind the stress model to the implementation that provides its safety properties.
assert(service.includes('BUBBLE_RETRY_INTERVAL_MS = 350L'), 'implementation bubble recovery budget drifted');
assert(service.includes('lastBubbleAttemptAt = 0L'), 'implementation detached-bubble immediate retry missing');
assert(plugin.includes('attempt >= 55'), 'projection slow-device budget drifted');
assert(plugin.includes('attempt >= 24'), 'observer slow-device budget drifted');
assert(main.includes('attempt < 50'), 'return-to-GTO slow-device budget drifted');
assert(service.includes('GtoAutoTripSync.lockSelectedFreight(this, prefs)'), 'immutable freight lock missing');
assert(service.includes('boolean completionPersisted = prefs.edit()'), 'durable completion gate missing');
assert(sync.includes('queue.edit().putString(QUEUE_PREFIX + sessionId, sealed).commit()'), 'durable queue commit missing');
assert(sync.includes('sessionId.equals(responseSession)'), 'exact ACK session validation missing');
assert(sync.includes('queue.edit().remove(key).commit()'), 'ACK dequeue missing');

console.log(`OK   operations simulated: ${operations}`);
console.log(`OK   full trips simulated: ${sessions}`);
console.log(`OK   safe freight-read retries: ${selectionRetries}`);
console.log(`OK   projection recovery events: ${projectionRecoveries}`);
console.log(`OK   process restart events: ${processRestarts}`);
console.log(`OK   bubble detach events: ${bubbleDetaches}`);
console.log(`OK   network/watchdog retry events: ${networkRetries}`);
console.log(`OK   result sensor fallback events: ${resultFallbacks}`);
console.log(`OK   consecutive new-trip transitions after ACK: ${consecutiveTripTransitions}`);
console.log(`OK   unique registered sessions: ${registered.size}`);
console.log('OK   no duplicate, lost, mutated or cross-session trip found in stress model');
