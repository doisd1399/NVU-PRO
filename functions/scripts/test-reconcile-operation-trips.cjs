const assert = require('node:assert/strict');
const Module = require('node:module');
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const state = new Map();
const owner = 'driver-1', jobId = 'job-1', companyId = 'company-1', contractId = 'contract-1';
const key = (collection, id) => `${collection}/${id}`;
const snap = (path, data) => ({ id: path.split('/').slice(1).join('/'), ref: { path, id: path.split('/').slice(1).join('/') }, exists: data !== undefined,
  data: () => data, get: (name) => data?.[name] });
const db = { collection(collection) { return {
  doc(id) { return { path: key(collection, id), id }; },
  where(name, op, value) { assert.equal(op, '=='); return { collection, name, value }; },
}; }, async runTransaction(callback) {
  const writes = [];
  const tx = {
    async get(ref) {
      if (ref.collection) return { docs: [...state.entries()]
        .filter(([path, value]) => path.startsWith(`${ref.collection}/`) && value[ref.name] === ref.value)
        .map(([path, value]) => snap(path, value)) };
      return snap(ref.path, state.get(ref.path));
    },
    update(ref, value) { writes.push(['update', ref.path, value]); },
    create(ref, value) { writes.push(['create', ref.path, value]); },
    set(ref, value, options = {}) { writes.push(['set', ref.path, value, options]); },
  };
  const result = await callback(tx);
  for (const [operation, path, value, options] of writes) {
    if (operation === 'create') assert.equal(state.has(path), false);
    if (operation === 'set' && options?.merge) state.set(path, { ...state.get(path), ...value });
    else state.set(path, operation === 'update' ? { ...state.get(path), ...value } : value);
  }
  return result;
} };
const firestore = () => db;
firestore.FieldValue = { serverTimestamp: () => new Date(), delete: () => undefined };
const mocks = { 'firebase-admin': { firestore }, 'firebase-functions': {
  region: () => ({ https: { onCall: (handler) => handler } }), https: { HttpsError },
} };
const original = Module._load;
Module._load = function(request, parent, isMain) { return mocks[request] || original.call(this, request, parent, isMain); };
const reconcile = require('../lib/reconcileOperationTrips.js').reconcileOperationTrips;
Module._load = original;
function seed(withSixth = false, progress = 6, status = 'active', count = withSixth ? 6 : 5) {
  state.clear();
  state.set(key('trabalhos', jobId), { driverId: owner, companyId, contractId,
    progress, totalDeliveries: 12, lastValidatedTripId: 'nvu_missing_6',
    operationProgressReconciled: true, status });
  for (let slot = 1; slot <= count; slot++) {
    const tripId = withSixth && slot === 6 ? 'nvu_missing_6' : `nvu_trip_${slot}`;
    state.set(key('historico_viagens', tripId), { jobId, operationId: jobId,
      driverId: owner, companyId, contractId, status: 'concluida', source: 'gto_auto',
      uploadedAt: new Date(), completedAt: new Date(), serverValidatedAt: new Date(), operationSlot: slot });
    state.set(key('trip_operation_slots', tripId), { jobId, driverId: owner, tripId, operationSlot: slot });
  }
}
(async () => {
  seed(true);
  const recovered = await reconcile({ jobId }, { auth: { uid: owner } });
  assert.ok(['consistent', 'repaired'].includes(recovered.status));
  assert.equal(recovered.tripIds.length, 6);
  assert.equal(state.get(key('trabalhos', jobId)).progress, 6);

  seed(false, 10, 'active', 1);
  for (let slot = 2; slot <= 10; slot += 1) {
    const tripId = `legacy_gto_${slot}`;
    state.set(key('historico_viagens', tripId), { jobId, operationId: jobId,
      driverId: owner, companyId, contractId, status: 'concluida',
      source: 'gto_auto', uploadedBy: owner, uploadedAt: new Date(),
      gtoTripSessionId: `session-${slot}`, operationSlot: slot });
    if (slot === 2) {
      const legacy = state.get(key('historico_viagens', tripId));
      delete legacy.uploadedBy;
      delete legacy.gtoTripSessionId;
      delete legacy.companyId;
      delete legacy.contractId;
      delete legacy.empresaId;
      delete legacy.contratoId;
      delete legacy.driverId;
      legacy.criadoPor = owner;
    }
    state.set(key('trip_operation_slots', tripId), { jobId, driverId: owner,
      tripId, operationSlot: slot });
  }
  state.get(key('trabalhos', jobId)).lastValidatedTripId = 'legacy_gto_10';
  const legacyRecovered = await reconcile({ jobId }, { auth: { uid: owner } });
  assert.ok(['consistent', 'repaired'].includes(legacyRecovered.status),
    'viagens GTO legadas criadas pelo servidor devem contar como confirmadas');
  assert.equal(legacyRecovered.confirmedCount, 10);
  assert.equal(legacyRecovered.serverProgress, 10);

  seed(false);
  const repaired = await reconcile({ jobId }, { auth: { uid: owner } });
  assert.equal(repaired.status, 'repaired');
  assert.equal(repaired.serverProgress, 5);
  assert.equal(state.get(key('trabalhos', jobId)).lastValidatedTripId, 'nvu_trip_5');
  assert.ok([...state.keys()].some(path => path.startsWith(`trip_reconciliation_audits/${jobId}_nvu_missing_6_`)));
  assert.ok(['consistent', 'repaired'].includes((await reconcile({ jobId }, { auth: { uid: owner } })).status));

  seed(false);
  state.set(key('trip_operation_slots', 'nvu_missing_6'), { jobId, driverId: owner,
    tripId: 'nvu_missing_6', operationSlot: 6 });
  assert.equal((await reconcile({ jobId }, { auth: { uid: owner } })).status, 'repaired');
  assert.equal(state.get(key('trip_operation_slots', 'nvu_missing_6')).deleted, true,
    'the proven orphan claim must be tombstoned transactionally');
  assert.equal(state.get(key('trabalhos', jobId)).progress, 5);

  seed(false);
  state.set(key('trip_operation_slots', 'unrelated_orphan'), { jobId, driverId: owner,
    tripId: 'unrelated_orphan', operationSlot: 7 });
  assert.equal((await reconcile({ jobId }, { auth: { uid: owner } })).status, 'repaired');
  assert.equal(state.get(key('trip_operation_slots', 'unrelated_orphan')).deleted, true, 'a verified missing receipt can release any slot');
  assert.equal(state.get(key('trabalhos', jobId)).progress, 5);
  seed(false);
  state.set(key('trip_operation_slots', 'ambiguous_orphan'), { jobId, driverId: owner,
    tripId: 'outside-operation', operationSlot: 7 });
  state.set(key('historico_viagens', 'outside-operation'), { jobId: 'another-job', driverId: owner, companyId, contractId, status: 'concluida' });
  assert.equal((await reconcile({ jobId }, { auth: { uid: owner } })).status, 'conflict');
  assert.equal(state.get(key('trabalhos', jobId)).progress, 6, 'a claim referencing an active trip outside this operation remains blocked');
  seed(false);
  state.set(key('trabalhos', jobId), { ...state.get(key('trabalhos', jobId)), lastValidatedTripId: undefined });
  state.set(key('trip_operation_slots', 'nvu_missing_6'), { operationId: jobId, driverId: owner,
    tripId: 'nvu_missing_6', operationSlot: 6 });
  assert.equal((await reconcile({ jobId }, { auth: { uid: owner } })).status, 'repaired',
    'a nova tentativa deve reparar slot órfão mesmo sem ponteiro');
  assert.equal(state.get(key('trabalhos', jobId)).progress, 5);
  seed(false);
  assert.equal((await reconcile({ jobId }, { auth: { uid: owner } })).status, 'repaired',
    'contador stale deve ser corrigido mesmo quando todos os slots válidos permanecem');
  assert.equal(state.get(key('trabalhos', jobId)).progress, 5);
  seed(false);
  for (const [path] of [...state]) {
    if (path.startsWith('historico_viagens/') || path.startsWith('trip_operation_slots/')) state.delete(path);
  }
  assert.equal((await reconcile({ jobId }, { auth: { uid: owner } })).status, 'repaired',
    'operação reaberta sem histórico confirmado deve voltar a zero sem intervenção');
  assert.equal(state.get(key('trabalhos', jobId)).progress, 0);
  seed(false, 0, 'active', 9);
  assert.equal((await reconcile({ jobId }, { auth: { uid: owner } })).status, 'repaired',
    'contador zero com nove viagens confirmadas deve ser recuperado');
  assert.equal(state.get(key('trabalhos', jobId)).progress, 9);
  seed(false, 12, 'completed', 5);
  assert.ok(['repaired', 'consistent'].includes((await reconcile({ jobId }, { auth: { uid: owner } })).status),
    'limite stale com histórico abaixo do total deve preservar a operação terminal');
  assert.equal(state.get(key('trabalhos', jobId)).progress, 5);
  assert.equal(state.get(key('trabalhos', jobId)).status, 'completed');
  await assert.rejects(reconcile({ jobId }, { auth: { uid: 'another' } }),
    (error) => error.code === 'permission-denied');
  console.log('RECONCILE_OPERATION_TRIPS_PASS recovered, safe repair, orphan conflict and authorization');
})().catch((error) => { console.error(error); process.exitCode = 1; });
