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
  collection(collection) { return { doc(id) { const path = p(collection, id); return { path, id, collection: nested => db.collection(`${path}/${nested}`), async get() { return snap(path, state.get(path)); } }; },
    where(key, op, value) { assert.equal(op, '=='); const filters = [[key, value]];
      const query = { collection, filters, where(k, operator, v) { assert.equal(operator, '=='); filters.push([k, v]); return query; } };
      return query; } }; },
  async runTransaction(callback) {
    const operations = [];
    const tx = { async get(ref) {
      if (Array.isArray(ref.filters)) return { docs: [...state.entries()]
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
const mocks = { 'firebase-admin': { firestore }, 'firebase-functions': {
  firestore: { document: () => ({ onWrite: handler => handler }) },
  region: () => ({ https: { onCall: (handler) => handler } }),
  https: { HttpsError }, logger: { info() {} },
} };
const load = Module._load;
Module._load = function(request, parent, isMain) { return mocks[request] || load.call(this, request, parent, isMain); };
const { registerGtoProReceipt: register } = require('../lib/registerGtoProReceipt.js');
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
  state.set(p('companyMembers', `${uid}_${companyId}`), { userId: uid, companyId, roles: ['driver'], status: 'active' });
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
(async () => {
  seed();
  const created = await register(req, { auth: { uid } });
  assert.equal(created.tripId, slotId(4));
  assert.equal(state.get(p('historico_viagens', slotId(4))).valorCents, 256300);
  assert.equal(state.get(p('historico_viagens', slotId(4))).currency, 'BRL');
  assert.equal(state.get(p('historico_viagens', slotId(4))).currencyEvidenceStatus, 'known');
  assert.equal(state.get(p('historico_viagens', slotId(4))).currencyEvidenceVersion, 1);
  assert.equal(state.get(p('trabalhos', jobId)).progress, 4);
  assert.ok(state.has(p('trip_operation_slots', slotId(4))));
  const after = writes;
  assert.equal((await register(req, { auth: { uid } })).duplicate, true);
  assert.equal(writes, after, 'lost ACK must not write again');
  await rejects('failed-precondition', { ...req, receiptText: req.receiptText + '\nOBS' });
  await rejects('invalid-argument', { ...req, driverId: 'other-driver' });
  await rejects('unauthenticated', req, null);
  seed();
  const unknownCurrency = await register({ ...req, currency: 'BRL', receiptText: 'VALOR A RECEBER 2.563,00' }, { auth: { uid } });
  const unknownTrip = state.get(p('historico_viagens', unknownCurrency.tripId));
  assert.equal(unknownCurrency.registered, true, 'currency UNKNOWN must not block the trip count');
  assert.equal(unknownTrip.currency, undefined, 'a simulator/client fallback must not persist as currency');
  assert.equal(unknownTrip.simpleReceiptCurrency, undefined);
  assert.equal(unknownTrip.currencyEvidenceStatus, 'unknown');
  assert.equal(state.get(p('trabalhos', jobId)).progress, 4, 'currency UNKNOWN still consumes exactly one confirmed operation slot');
  seed();
  const nativeUnknownCurrency = await register({ ...req, currency: '', origin: 'Cruz do Oeste', destination: 'Registro',
    receiptText: 'CONCLUÍDO\nVALOR A RECEBER:  2.563,00' }, { auth: { uid } });
  assert.equal(nativeUnknownCurrency.registered, true, 'the exact native no-currency receipt shape must be accepted');
  assert.equal(state.get(p('historico_viagens', nativeUnknownCurrency.tripId)).currencyEvidenceStatus, 'unknown');
  const afterUnknownAck = writes;
  assert.equal((await register({ ...req, currency: '', origin: 'Cruz do Oeste', destination: 'Registro',
    receiptText: 'CONCLUÍDO\nVALOR A RECEBER:  2.563,00' }, { auth: { uid } })).duplicate, true);
  assert.equal(writes, afterUnknownAck, 'a no-currency receipt keeps the same lost-ACK idempotency');
  for (const [patch, reason] of [
    [{ companyId: 'short' }, 'GTO_CONTEXT_INVALID'],
    [{ contextEpoch: '' }, 'GTO_CONTEXT_INVALID'],
    [{ destination: req.origin }, 'GTO_ROUTE_INVALID'],
    [{ receiptText: '' }, 'GTO_RECEIPT_INVALID'],
    [{ amountCents: req.amountCents + 1 }, 'GTO_AMOUNT_INVALID'],
    [{ receiptText: 'VALOR A RECEBER 2.563,00\nBONUS VIDEO ADS: 10,00' }, 'GTO_AMOUNT_INVALID'],
    [{ driverId: 'other-driver' }, 'DRIVER_SCOPE_MISMATCH'],
    [{ packageId: 'com.other.game' }, 'GTO_SIMULATOR_INVALID'],
    [{ bonusEvidence: 'APPLIED' }, 'GTO_BONUS_INVALID'],
    [{ previousTripId: 'nvu_other_job_4' }, 'GTO_PREVIOUS_TRIP_INVALID'],
  ]) {
    seed();
    await rejects('invalid-argument', { ...req, ...patch }, { uid }, reason);
  }
  seed();
  await rejects('invalid-argument', { ...req, currency: 'BRL', receiptText: 'VALOR A RECEBER EUR 2.563,00' },
    { uid }, 'GTO_CURRENCY_CONFLICT');
  seed();
  const ambiguousCurrency = await register({ ...req, currency: 'USD', receiptText: 'VALOR A RECEBER $ 2.563,00' }, { auth: { uid } });
  assert.equal(state.get(p('historico_viagens', ambiguousCurrency.tripId)).currencyEvidenceStatus, 'unknown', 'bare $ is not USD evidence');
  seed();
  assert.equal((await register({ ...req, receiptText: 'VALOR A RECEBER:\nR$ 2.563,00' }, { auth: { uid } })).registered, true);
  seed();
  await rejects('invalid-argument', { ...req, receiptText: req.receiptText + '\nBONUS VIDEO ADS: 10,00' });
  seed(4, 3);
  state.get(p('trabalhos', jobId)).lastValidatedTripId = legacyId;
  state.set(p('historico_viagens', legacyId), { jobId, driverId: uid, companyId, contractId,
    operationSlot: 4, gtoEntryMode: 'print', status: 'concluida', valorCents: 10100,
    source: 'gto_auto', uploadedAt: new Timestamp(), serverValidatedAt: new Timestamp() });
  state.set(p('trip_operation_slots', legacyId), { tripId: legacyId, jobId, driverId: uid, operationSlot: 4 });
  const registeredAfterPrint = await register(req, { auth: { uid } });
  assert.equal(registeredAfterPrint.reconciledLegacyPrint, false);
  assert.notEqual(state.get(p('historico_viagens', legacyId)).deleted, true);
  assert.equal(state.has(p('trip_operation_slots', legacyId)), true);
  assert.equal(registeredAfterPrint.tripId, slotId(5));
  assert.equal(registeredAfterPrint.progress, 5);
  assert.equal(state.get(p('trabalhos', jobId)).lastValidatedTripId, slotId(5));
  assert.equal(state.get(p('trabalhos', jobId)).lastDeletedTripId, undefined);
  const afterRepair = writes;
  assert.equal((await register(req, { auth: { uid } })).duplicate, true);
  assert.equal(writes, afterRepair);
  seed(4, 3);
  state.get(p('trabalhos', jobId)).lastValidatedTripId = legacyId;
  state.set(p('historico_viagens', legacyId), { jobId, driverId: uid, companyId, contractId,
    operationSlot: 4, gtoEntryMode: 'print', status: 'concluida', valorCents: 256300,
    source: 'gto_auto', uploadedAt: new Timestamp(), serverValidatedAt: new Timestamp() });
  assert.equal((await register(req, { auth: { uid } })).tripId, slotId(5), 'a valid prior Print cannot block Pro');
  seed(4, 3);
  state.get(p('trabalhos', jobId)).lastValidatedTripId = legacyId;
  state.set(p('historico_viagens', legacyId), { jobId, driverId: uid, companyId, contractId,
    operationSlot: 4, gtoEntryMode: 'print', status: 'concluida', valorCents: 10100,
    source: 'gto_auto', uploadedAt: new Timestamp(), serverValidatedAt: new Timestamp() });
  const registeredWithStaleExpectedProgress = await register({ ...req, expectedProgress: 4 }, { auth: { uid } });
  assert.equal(registeredWithStaleExpectedProgress.reconciledLegacyPrint, false);
  assert.equal(state.has(p('historico_viagens', slotId(5))), true);
  assert.notEqual(state.get(p('historico_viagens', legacyId)).deleted, true);
  seed(4, 3);
  for (let slot = 1; slot <= 3; slot += 1) {
    const id = `confirmed:${jobId}:${slot}`;
    const row = state.get(p('historico_viagens', id));
    delete row.serverValidatedAt;
    row.syncStatus = 'synced';
  }
  const registeredWithSyncedLegacyHistory = await register(req, { auth: { uid } });
  assert.equal(registeredWithSyncedLegacyHistory.registered, true,
    'sincronizado sem serverValidatedAt não deve bloquear a próxima viagem');
  assert.equal(registeredWithSyncedLegacyHistory.progress, 4);
  seed();
  const lowValue = await register({ ...req, amountCents: 10100,
    receiptText: 'VALOR A RECEBER R$ 101,00', expectedProgress: 3 }, { auth: { uid } });
  assert.equal(lowValue.registered, true, 'valor positivo abaixo de R$ 1.000 continua válido');
  seed();
  state.set(p('historico_viagens', 'other'), { jobId, operationSlot: 4, status: 'concluida' });
  await rejects('failed-precondition');
  seed();
  const previousTripId = slotId(5);
  state.set(p('historico_viagens', previousTripId), { jobId, driverId: uid, companyId, contractId,
    simpleReceiptCaptureAttemptId: attemptId, simpleReceiptCaptureContextEpoch: req.contextEpoch,
    simpleReceiptHash: createHash('sha256').update(req.receiptText).digest('hex'), valorCents: 256300,
    simpleReceiptCurrency: 'BRL',
    origem: req.origin, destino: req.destination, simulatorKey: 'global-truck', source: 'gto_auto',
    uploadedAt: new Timestamp(), serverValidatedAt: new Timestamp(), operationSlot: 5, operationSlotKey: previousTripId, status: 'concluida' });
  const oldAck = await register({ ...req, previousTripId }, { auth: { uid } });
  assert.equal(oldAck.tripId, previousTripId);
  assert.equal(oldAck.duplicate, true);
  assert.equal(state.has(p('historico_viagens', slotId(4))), false);
  seed();
  state.set(p('historico_viagens', slotId(4, null)), { jobId, driverId: uid, companyId, contractId,
    status: 'DELETED', deleted: true, operationSlot: 4 });
  state.set(p('trip_operation_slots', slotId(4, null)), { jobId, driverId: uid, tripId: slotId(4, null),
    deleted: true, operationSlot: 4 });
  const afterDeletion = await register({ ...req, attemptId: 'pro-1234567890123-next' }, { auth: { uid } });
  assert.equal(afterDeletion.registered, true, 'a deleted slot must not block a new receipt');
  assert.equal(afterDeletion.tripId, slotId(4, 'pro-1234567890123-next'));
  assert.equal(state.get(p('historico_viagens', slotId(4, null))).deleted, true,
    'the old tombstone must remain intact');
  assert.equal(state.get(p('historico_viagens', afterDeletion.tripId)).operationSlot, 4,
    'the next slot is rebuilt from confirmed history after a tombstone');
  assert.equal(state.get(p('trabalhos', jobId)).progress, 4,
    'the job projection is rebuilt from the four active confirmed trips');
  console.log('GTO_PRO_REGISTER_PASS create, replay, prior Print preserved, slot conflict, owner, exact old ACK');
})().catch((error) => { console.error(error); process.exitCode = 1; });
