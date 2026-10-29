const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const Module = require('node:module');
class Timestamp { toMillis() { return Date.now() - 1000; } }
class HttpsError extends Error { constructor(code, message, details) { super(message); this.code = code; this.details = details; } }
const state = new Map(); let writes = 0;
const uid = 'driver123456', jobId = 'job12345678', companyId = 'company123456', contractId = 'contract123456';
const attemptId = 'pro-1234567890123-a1', legacyId = `print:${jobId}:legacy`;
const p = (col, id) => `${col}/${id}`;
const snap = (path, data) => ({ id: path.split('/').slice(1).join('/'), exists: data !== undefined,
  data: () => data, get: (key) => data?.[key] });
const db = {
  collection(collection) { return { doc(id) { const path = p(collection, id); return { path, id, async get() { return snap(path, state.get(path)); } }; },
    where(key, op, value) { assert.equal(op, '=='); const filters = [[key, value]];
      const query = { collection, filters, where(k, operator, v) { assert.equal(operator, '=='); filters.push([k, v]); return query; } };
      return query; } }; },
  async runTransaction(callback) {
    const operations = [];
    const tx = { async get(ref) {
      if (ref.collection) return { docs: [...state.entries()]
        .filter(([key, data]) => key.startsWith(`${ref.collection}/`) && ref.filters.every(([k, v]) => data[k] === v))
        .map(([key, data]) => snap(key, data)) };
      return snap(ref.path, state.get(ref.path));
    }, create(ref, data) { operations.push(['create', ref.path, data]); },
    update(ref, data) { operations.push(['update', ref.path, data]); },
    delete(ref) { operations.push(['delete', ref.path]); } };
    const result = await callback(tx);
    for (const [op, key, data] of operations) {
      if (op === 'create') assert.equal(state.has(key), false, `duplicate create ${key}`);
      if (op === 'delete') state.delete(key);
      else state.set(key, op === 'update' ? { ...state.get(key), ...data } : data);
      writes++;
    }
    return result;
  },
};
const firestore = () => db;
firestore.Timestamp = Timestamp;
firestore.FieldValue = { serverTimestamp: () => new Timestamp() };
const mocks = { 'firebase-admin': { firestore }, 'firebase-admin/firestore': { FieldValue: firestore.FieldValue }, 'firebase-functions': {
  region: () => ({ https: { onCall: (handler) => handler } }),
  https: { HttpsError }, logger: { info() {} },
} };
const load = Module._load;
Module._load = function(request, parent, isMain) { return mocks[request] || load.call(this, request, parent, isMain); };
const { registerGtoProReceipt: register } = require(process.env.GTO_TEST_HANDLER || '../lib/registerGtoProReceipt.js');
Module._load = load;
const req = { jobId, companyId, contractId, driverId: uid, attemptId,
  contextEpoch: 'global-truck:1790660000000:abcdef12', origin: 'Itapetuna', destination: 'Nova Macaé',
  simulatorKey: 'global-truck', simulatorCode: 'GTO', packageId: 'com.stargamesapps.gto',
  amountCents: 256300, currency: 'BRL', bonusEvidence: 'NONE',
  receiptText: 'VALOR A RECEBER R$ 2.563,00', expectedProgress: 3 };
function slotId(slot, attempt = attemptId) {
  let hash = 2166136261;
  for (const c of jobId) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
  return `nvu_${jobId}_${hash.toString(36)}_${slot}${attempt ? '_' + createHash('sha256').update(attempt).digest('hex').slice(0, 12) : ''}`;
}
function seed(progress = 3, historyCount = progress) {
  state.clear(); writes = 0;
  state.set(p('trabalhos', jobId), { driverId: uid, companyId, contractId,
    progress, totalDeliveries: 12, status: 'active', operationReconciliationVersion: 4,
    operationProgressReconciled: true, operationProjectionSource: 'test-seed-canonical-v3' });
  state.set(p('contratos', contractId), { companyId, totalDeliveries: 12 });
  state.set(p('frotas', companyId), { simulatorId: 'gto', name: 'Empresa' });
  state.set(p('users', uid), { name: 'Motorista' });
  for (let slot = 1; slot <= historyCount; slot += 1) {
    const id = `confirmed:${jobId}:${slot}`;
    state.set(p('historico_viagens', id), { id, jobId, operationId: jobId, driverId: uid,
      companyId, contractId, operationSlot: slot, operationSlotKey: id,
      status: 'concluida', recordStatus: 'concluida', source: 'gto_auto', uploadedAt: new Timestamp(), serverValidatedAt: new Timestamp() });
  }
}
async function rejects(code, input = req, auth = { uid }, reasonCode) {
  const before = writes;
  await assert.rejects(register(input, { auth }), (error) => {
    assert.equal(error.code, code);
    assert.equal(error.details.stage, 'CALLABLE_REGISTRATION');
    assert.equal(error.details.callable, 'registerGtoProReceipt');
    assert.equal(error.details.validationVersion, 2);
    if (reasonCode) assert.equal(error.details.reasonCode, reasonCode);
    assert.deepEqual(Object.keys(error.details).sort(), ['callable', 'reasonCode', 'stage', 'validationVersion']);
    return true;
  });
  assert.equal(writes, before, 'rejected request must not mutate');
}

let checks = 0;
const auth = { uid };
const request = { ...req, origin: 'Nova Macaé', destination: 'Agro Grão', amountCents: 575000,
  currency: '', receiptText: 'CONCLUÍDO\nVALOR A RECEBER: 5.750,00', bonusEvidence: 'OFFER_ONLY',
  capturedAt: Date.now() - 1000 };
delete request.expectedProgress;
const known = { ...request, currency: 'BRL', receiptText: 'CONCLUÍDO\nVALOR A RECEBER: R$ 5.750,00' };
const tripCount = () => [...state.keys()].filter(key => key.startsWith('historico_viagens/')).length;
function reset() {
  seed();
  state.get(p('trabalhos', jobId)).totalDeliveries = 10;
  state.get(p('contratos', contractId)).totalDeliveries = 10;
}
async function rejectNoWrites(code, data, reasonCode) {
  const before = JSON.stringify([...state]);
  await rejects(code, data, auth, reasonCode);
  assert.equal(JSON.stringify([...state]), before);
  checks++;
}
async function successfulReplay(data) {
  const before = writes;
  const beforeRows = tripCount();
  const reply = await register(data, { auth });
  assert.equal(reply.registered, true);
  assert.equal(reply.duplicate, true);
  assert.equal(tripCount(), beforeRows);
  assert.equal(writes, before);
  checks++;
  return reply;
}
(async () => {
  for (const currency of ['', undefined, 'BRL']) {
    reset();
    const data = { ...request, currency };
    if (currency === undefined) delete data.currency;
    const immutable = JSON.stringify(data);
    const first = await register(data, { auth });
    assert.equal(first.progress, 4);
    assert.equal(first.total, 10);
    assert.equal(tripCount(), 4);
    const row = state.get(p('historico_viagens', first.tripId));
    assert.equal(row.currencyEvidenceStatus, 'unknown');
    assert.equal(row.valorCents, 575000);
    assert.equal(row.currency, undefined);
    assert.equal(row.simpleReceiptCurrency, undefined);
    assert.equal(row.origem, request.origin);
    assert.equal(row.destino, request.destination);
    assert.equal(JSON.stringify(data), immutable);
    checks++;
    assert.equal((await successfulReplay(data)).tripId, first.tripId);
  }
  for (const [currency, token] of [['BRL','R$'], ['EUR','EUR'], ['USD','US$']]) {
    reset();
    const data = { ...request, currency, receiptText: `CONCLUÍDO\nVALOR A RECEBER: ${token} 5.750,00` };
    const first = await register(data, { auth });
    const row = state.get(p('historico_viagens', first.tripId));
    assert.equal(row.currencyEvidenceStatus, 'known');
    assert.equal(row.currency, currency);
    assert.equal(row.simpleReceiptCurrency, currency);
    checks++;
    await successfulReplay(data);
  }
  for (const currency of [null, 42, {}, [], 'GBP', 'UNKNOWN', '$']) {
    reset();
    await rejectNoWrites('invalid-argument', { ...request, currency }, 'GTO_CURRENCY_INVALID');
  }
  for (const data of [
    { ...known, currency: 'EUR' },
    { ...known, currency: 'USD' },
    { ...known, receiptText: 'CONCLUÍDO\nVALOR A RECEBER: EUR 5.750,00' },
    { ...request, receiptText: 'CONCLUÍDO\nVALOR A RECEBER: R$ 5.750,00\nVALOR A RECEBER: EUR 5.750,00' },
  ]) {
    reset();
    await rejectNoWrites('invalid-argument', data, 'GTO_CURRENCY_CONFLICT');
  }
  // All ACK paths must verify the currency evidence on the saved trip.
  for (const path of ['attempt', 'event', 'previousTrip']) {
    reset();
    const first = await register(known, { auth });
    const row = state.get(p('historico_viagens', first.tripId));
    row.currency = 'EUR';
    row.simpleReceiptCurrency = 'EUR';
    let next = { ...known };
    let reason = 'CONFIRMED_TRIP_CHANGED';
    if (path === 'event') next.attemptId = 'pro-1234567890123-event';
    if (path === 'previousTrip') {
      for (const key of [...state.keys()]) if (key.startsWith('pro_trip_attempts/') || key.startsWith('pro_receipt_events/')) state.delete(key);
      next.previousTripId = first.tripId;
      reason = 'PREVIOUS_RECEIPT_CONFLICT';
    }
    await rejectNoWrites('failed-precondition', next, reason);
  }
  for (const patch of [{ currency: 'EUR' }, { simpleReceiptCurrency: 'EUR' },
    { currencyEvidenceStatus: 'unknown' }, { currencyEvidenceVersion: 2 }]) {
    reset();
    const first = await register(known, { auth });
    Object.assign(state.get(p('historico_viagens', first.tripId)), patch);
    await rejectNoWrites('failed-precondition', known, 'CONFIRMED_TRIP_CHANGED');
  }
  reset();
  const missing = await register(known, { auth });
  delete state.get(p('historico_viagens', missing.tripId)).simpleReceiptCurrency;
  await rejectNoWrites('failed-precondition', known, 'CONFIRMED_TRIP_CHANGED');
  reset();
  const unknown = await register(request, { auth });
  state.get(p('historico_viagens', unknown.tripId)).currency = 'BRL';
  await rejectNoWrites('failed-precondition', request, 'CONFIRMED_TRIP_CHANGED');
  // A valid legacy alias remains replayable; an alias changed in the request
  // or in the confirmed row must fail. Never rewrite the legacy row.
  for (const data of [known, { ...request, currency: 'BRL' }]) {
    reset();
    const first = await register(data, { auth });
    const row = state.get(p('historico_viagens', first.tripId));
    for (const key of ['currency', 'currencyEvidenceVersion', 'currencyEvidenceStatus', 'currencyEvidenceSource']) delete row[key];
    row.simpleReceiptCurrency = 'BRL';
    await successfulReplay(data);
    row.simpleReceiptCurrency = 'EUR';
    await rejectNoWrites('failed-precondition', data, 'CONFIRMED_TRIP_CHANGED');
  }
  reset();
  const data = { ...request, currency: 'BRL' };
  const legacy = await register(data, { auth });
  const legacyRow = state.get(p('historico_viagens', legacy.tripId));
  for (const key of ['currency', 'currencyEvidenceVersion', 'currencyEvidenceStatus', 'currencyEvidenceSource']) delete legacyRow[key];
  legacyRow.simpleReceiptCurrency = 'BRL';
  await rejectNoWrites('failed-precondition', { ...data, currency: 'EUR' }, 'CONFIRMED_TRIP_CHANGED');
  // Legacy event fingerprints remain accepted without rewriting their rows.
  reset();
  const original = await register(known, { auth });
  const row = state.get(p('historico_viagens', original.tripId));
  for (const key of ['currency', 'currencyEvidenceVersion', 'currencyEvidenceStatus', 'currencyEvidenceSource']) delete row[key];
  row.simpleReceiptCurrency = 'BRL';
  const eventKey = [...state.keys()].find(key => key.startsWith('pro_receipt_events/'));
  const event = state.get(eventKey);
  event.fingerprint = createHash('sha256').update(JSON.stringify([uid, jobId, companyId, contractId,
    known.contextEpoch, known.origin, known.destination, known.amountCents, 'BRL'])).digest('hex');
  const oldRow = JSON.stringify(row);
  const duplicate = await register({ ...known, attemptId: 'pro-1234567890123-legacy-event' }, { auth });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.receiptEventDuplicate, true);
  assert.equal(duplicate.tripId, original.tripId);
  assert.equal(tripCount(), 4);
  assert.equal(JSON.stringify(row), oldRow);
  checks++;
  console.log(JSON.stringify({ result: 'PASS', checks, transport: 'mocked-firestore',
    unknownAccepted: true, explicitConflictRejected: true, malformedCurrencyRejected: true,
    replayEvidenceVerified: true, legacyReplayPreserved: true,
    productionWrites: false, actualDeviceSnapshotUsed: false }, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
