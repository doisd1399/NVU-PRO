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
const fs = require('node:fs');
const vm = require('node:vm');
const { FieldValue } = require('firebase-admin/firestore');
const runtimePath = process.env.FIREBASE_TOOLS_RUNTIME_PATH;
assert.ok(runtimePath, 'FIREBASE_TOOLS_RUNTIME_PATH must identify the installed Emulator worker');
const runtimeSource = fs.readFileSync(runtimePath, 'utf8');
const start = runtimeSource.indexOf('class Proxied {');
const end = runtimeSource.indexOf('async function resolveDeveloperNodeModule', start);
assert.ok(start >= 0 && end > start, 'Expected actual worker Proxied class');
const Proxied = vm.runInNewContext(runtimeSource.slice(start, end) + '; Proxied');
const adminProxy = new Proxied({ firestore })
  .when('firestore', target => Proxied.getOriginal(target, 'firestore')).finalize();
assert.equal(adminProxy.firestore.FieldValue, undefined, 'Worker proxy drops function statics');
// Firebase Admin FieldValue is the actual SDK export, not a harness fallback.
const mocks = { 'firebase-admin': adminProxy, 'firebase-functions': {
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

(async () => {
  seed();
  state.get(p('trabalhos', jobId)).totalDeliveries = 10;
  state.get(p('contratos', contractId)).totalDeliveries = 10;
  const input = { ...req, origin: 'Nova Macaé', destination: 'Agro Grão', amountCents: 575000,
    currency: '', receiptText: 'CONCLUÍDO\nVALOR A RECEBER: 5.750,00', capturedAt: Date.now() - 1000 };
  delete input.expectedProgress;
  if (process.env.GTO_EXPECT_LEGACY_ERROR === 'true') {
    await assert.rejects(register(input, { auth: { uid } }), error => {
      assert.equal(error.constructor.name, 'TypeError');
      assert.match(error.message, /serverTimestamp/);
      return true;
    });
    assert.equal(writes, 0);
    console.log(JSON.stringify({ result: 'PASS', case: 'legacy namespace worker error reproduced',
      actualFieldValueSDK: true, workerProxySource: true, database: 'mocked', callableHTTP: false, productionWrites: false }, null, 2));
    return;
  }
  const first = await register(input, { auth: { uid } });
  assert.equal(first.registered, true);
  assert.equal(first.progress, 4);
  assert.equal(first.total, 10);
  const trip = state.get(p('historico_viagens', first.tripId));
  assert.equal(trip.valorCents, 575000);
  assert.equal(trip.currencyEvidenceStatus, 'unknown');
  assert.equal(trip.serverValidatedAt.isEqual(FieldValue.serverTimestamp()), true);
  assert.equal(trip.uploadedAt.isEqual(FieldValue.serverTimestamp()), true);
  const before = writes;
  const replay = await register(input, { auth: { uid } });
  assert.equal(replay.tripId, first.tripId);
  assert.equal(replay.duplicate, true);
  assert.equal(writes, before);
  assert.equal([...state.keys()].filter(key => key.startsWith('historico_viagens/')).length, 4);
  console.log(JSON.stringify({ result: 'PASS', case: 'register and replay with real SDK sentinel',
    progress: '3/10 -> 4/10', duplicateReplay: true, sameTripId: true,
    actualFieldValueSDK: true, workerProxySource: true, database: 'mocked', callableHTTP: false, productionWrites: false }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
