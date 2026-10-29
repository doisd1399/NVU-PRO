import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resetDocuments } from './mock-firestore.mjs';

const root = path.resolve(process.argv[2] || '../..');
const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const fromSource = (name) => import(pathToFileURL(path.join(root, name)).href);
const results = [];
async function check(id, name, kind, action) {
  await action(); results.push({ id, name, kind, outcome: 'verified' });
  console.log(`${'PASS'} ${id} ${name}`);
}
class MemoryStorage {
  map = new Map();
  get length() { return this.map.size; }
  key(index) { return [...this.map.keys()][index] || null; }
  getItem(key) { return this.map.get(key) ?? null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}
Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true });
Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true });
const ids = await fromSource('src/lib/vehiclePhotoIdentity.ts');
const store = await fromSource('src/services/vehiclePhotoStore.ts');
const { createVehiclePhotoSync } = await fromSource('src/services/vehiclePhotoSync.ts');
const photos = await fromSource('src/services/vehiclePhotoRepository.ts');
const identity = { userId: 'audit-driver-a', simulatorId: 'gto', vehicleId: 'audit-truck', vehicleName: 'Audit truck' };
const record = (extra = {}) => {
  const value = { ...identity, companyId: 'audit-company', revision: crypto.randomUUID(), imageDataUrl: 'data:image/png;base64,YQ==', posterDataUrl: 'data:image/png;base64,YQ==', contentType: 'image/png', status: 'pending', updatedAt: Date.now(), ...extra };
  return { ...value, key: ids.vehiclePhotoKey(value) };
};

await check('F01', 'opaque simulator ID is held until the catalog resolves', 'regression', async () => {
  const source = { simulatorId: 'AuditOpaqueDoc123456789' };
  const before = ids.resolveVehiclePhotoSimulatorId(source);
  const after = ids.resolveVehiclePhotoSimulatorId(source, [{ id: source.simulatorId, name: 'Global Truck Online' }]);
  assert.equal(before, ''); assert.equal(after, 'gto');
  assert.ok(!before && after);
});
await check('P01', 'photo keys isolate accounts, simulators and vehicles', 'protection', () => {
  for (const extra of [{ userId: 'audit-driver-b' }, { simulatorId: 'wtds' }, { vehicleId: 'audit-other' }]) {
    assert.notEqual(ids.vehiclePhotoKey(identity), ids.vehiclePhotoKey({ ...identity, ...extra }));
  }
});
await check('P02', 'failed photo upload preserves locally saved bytes', 'protection', async () => {
  const target = record({ vehicleId: 'audit-upload-failure' }); await store.putVehiclePhotoRecord(target);
  const sync = createVehiclePhotoSync({ currentUserId: () => identity.userId, upload: async () => { throw new Error('simulated-storage-denial'); }, writeMetadata: async () => { throw new Error('unexpected-write'); } });
  await assert.rejects(sync.sync(target), /simulated-storage-denial/);
  const pending = await store.getVehiclePhotoRecord(target);
  assert.equal(pending.status, 'pending'); assert.equal(pending.imageDataUrl, target.imageDataUrl);
  assert.equal(pending.failure.stage, 'upload'); assert.equal(pending.failure.attempts, 1);
});
await check('P03', 'metadata retry reuses an uploaded photo without a second upload', 'protection', async () => {
  const target = record({ vehicleId: 'audit-metadata-failure' }); await store.putVehiclePhotoRecord(target);
  let uploads = 0, writes = 0;
  const sync = createVehiclePhotoSync({ currentUserId: () => identity.userId, upload: async () => { uploads++; return 'https://photos.invalid/one.png'; }, writeMetadata: async () => { if (++writes === 1) throw new Error('simulated-metadata-denial'); } });
  await assert.rejects(sync.sync(target), /simulated-metadata-denial/);
  assert.equal((await store.getVehiclePhotoRecord(target)).status, 'pending');
  await sync.sync(target);
  assert.equal(uploads, 1); assert.equal(writes, 2); assert.equal((await store.getVehiclePhotoRecord(target)).status, 'synced');
});
await check('P04', 'changing accounts prevents the previous owner photo from uploading', 'protection', async () => {
  let uploaded = false;
  const target = record({ vehicleId: 'audit-account-switch' }); await store.putVehiclePhotoRecord(target);
  const sync = createVehiclePhotoSync({ currentUserId: () => 'audit-driver-b', upload: async () => { uploaded = true; return 'https://photos.invalid/two.png'; }, writeMetadata: async () => {} });
  await assert.rejects(sync.sync(target), /SESSION_CHANGED/); assert.equal(uploaded, false);
});
await check('F02', 'legacy users photo remains visible to owner but absent for another viewer', 'condition', async () => {
  resetDocuments({ users: { [identity.userId]: { vehiclePhotosV2: { [ids.vehiclePhotoDocumentKey(identity)]: { ...identity, url: 'https://photos.invalid/legacy.png' } } } } });
  assert.equal((await photos.readRemoteVehiclePhotoDetails({}, identity, identity.userId)).source, 'legacy');
  assert.equal(await photos.readRemoteVehiclePhotoDetails({}, identity, 'audit-viewer-b'), null);
});
await check('P05', 'flat published projection is readable by another viewer', 'protection', async () => {
  resetDocuments({ rankingVehiclePhotos: { [ids.rankingVehiclePhotoDocumentKey(identity)]: { ...identity, url: 'https://photos.invalid/published.png', revision: 'published' } } });
  assert.equal((await photos.readRemoteVehiclePhotoDetails({}, identity, 'audit-viewer-b')).url, 'https://photos.invalid/published.png');
});
await check('F10', 'synced local photo is discoverable for publication reconciliation', 'regression', async () => {
  const target = record({ vehicleId: 'audit-synced-unpublished', status: 'synced', remoteUrl: 'https://photos.invalid/existing.png' });
  await store.putVehiclePhotoRecord(target); resetDocuments({});
  assert.ok(await store.getVehiclePhotoRecord(target));
  assert.equal(await photos.readRemoteVehiclePhotoDetails({}, target, identity.userId), null);
  assert.equal((await store.listPendingVehiclePhotos(identity.userId, true)).some((row) => row.key === target.key), true);
});
await check('F03', 'ranking chooses operation within simulator scope', 'regression', async () => {
  resetDocuments({ trabalhos: {
    'audit-job-gto': { driverId: identity.userId, companyId: 'audit-company-gto', simulatorId: 'gto', vehicleId: 'audit-truck-gto', status: 'active', assignedAt: 100 },
    'audit-job-ets2': { driverId: identity.userId, companyId: 'audit-company-ets2', simulatorId: 'ets2', vehicleId: 'audit-truck-ets2', status: 'active', assignedAt: 200 },
  }, veiculos: { 'audit-truck-gto': { name: 'GTO truck' }, 'audit-truck-ets2': { name: 'ETS2 truck' } } });
  const { readRankingParticipantVehicle } = await fromSource('src/hooks/useRankingParticipantVehicle.ts');
  const got = await readRankingParticipantVehicle(identity.userId, '', { viewerId: 'audit-viewer-b', simulatorId: 'gto' });
  assert.equal(got.operation.id, 'audit-job-gto');
});
await check('F04', 'open photo hook listens for projection updates', 'static', () => {
  const hook = read('src/hooks/useVehiclePhoto.ts');
  assert.ok(hook.includes('onSnapshot('));
  assert.match(hook, /const onChange[^\n]+void applyLocal\(\)/);
  assert.match(hook, /if \(!remote\) \{ setRemoteStatus\(\{ key, value: "missing" \}\); setRemoteErrorCode\(null\); return; \}/);
});
await check('F05', 'two packaged Firestore rule files differ on ranking photo projection support', 'static', () => {
  assert.ok(read('firestore.rules').includes('match /rankingVehiclePhotos/'));
  assert.ok(!read('production-firestore.rules').includes('match /rankingVehiclePhotos/'));
  assert.equal(JSON.parse(read('PRODUCTION_BACKEND_COMPATIBILITY.json')).productionComparison, 'NOT_VERIFIED');
});
await check('F06', 'Web Simple completion includes immutable captured receiptText', 'static', () => {
  const source = read('src/services/simpleAutomationCompletionService.ts');
  const payload = source.slice(source.indexOf('const tripData: Record<string, unknown> = {'), source.indexOf('// Visual feedback'));
  assert.ok(source.includes('const receiptText = text(status.receiptText)'));
  assert.ok(/\breceiptText\b/.test(payload));
});
await check('F08', 'Web Pro evidence preserves explicit EUR currency', 'regression', async () => {
  const { validateProReceiptEvidence } = await fromSource('src/services/pro-universal/proReceiptAdapters.ts');
  const result = validateProReceiptEvidence('wtds', 'Resultados\nGanhos da Viagem: EUR 2.500,00\nDanos a Carga: 0%\nBônus Video ADS: 0\nTotal: EUR 2.500,00');
  assert.equal(result.validation.decision, 'accept');
  assert.equal(result.validation.currency, 'EUR'); assert.equal(result.evidence.currency, 'EUR');
});
await check('F09', 'Web sync adapter has alternative duplicate receipt ACK guard', 'static', () => {
  assert.match(read('functions/src/registerCanonicalSimpleTrip.ts'), /receiptEventDuplicate: true, tripId: acknowledgedId/);
  assert.match(read('src/services/sync/FirebaseTripSyncAdapter.ts'), /receiptEventDuplicate === true/);
});

// Real client normalization + outbound contract tests, without Firebase writes.
await check('X01', 'Web registration keeps the exact receipt bytes, amount and attempt ID', 'regression', async () => {
  const { TripRegistrationService } = await fromSource('src/application/trip/TripRegistrationService.ts');
  const text = 'Resultados\nGanhos da Viagem: EUR 2.500,00\nDanos a Carga: 0%\nBônus Video ADS: 0\nTotal: EUR 2.500,00';
  const original = { tripId: 'simple_audit_attempt_001', idempotencyKey: 'simple:job-a:driver-a:attempt001',
    driverId: 'driver-a', companyId: 'company-a', contractId: 'contract-a', jobId: 'job-a',
    simulatorId: 'wtds', simulatorKey: 'wtds', simpleAutomation: true, valor: 2500, valorCents: 250000,
    simpleReceiptCurrency: 'EUR', simpleReceiptResultScreenConfirmed: true, simpleReceiptBonusEvidence: 'ZERO_LABEL',
    receiptText: text };
  const canonical = TripRegistrationService.register(original);
  assert.equal(canonical.receiptText, text);
  assert.equal(canonical.valorCents, 250000);
  assert.equal(canonical.tripId, original.tripId);
  const { buildCanonicalTripRegistrationRequest } = await fromSource('src/services/sync/CanonicalTripRegistrationRequest.ts');
  const request = buildCanonicalTripRegistrationRequest(canonical, '');
  assert.equal(request.trip.receiptText, text); assert.equal(request.trip.valorCents, 250000);
  assert.equal(request.trip.tripId, original.tripId);
});
await check('X02', 'ambiguous Web receipt remains UNKNOWN, not simulator default BRL', 'regression', async () => {
  const { validateProReceiptEvidence } = await fromSource('src/services/pro-universal/proReceiptAdapters.ts');
  const value = validateProReceiptEvidence('wtds', 'Resultados\nGanhos da Viagem: 2.500,00\nDanos a Carga: 0%\nBônus Video ADS: 0\nTotal: 2.500,00');
  assert.equal(value.validation.currency, 'UNKNOWN'); assert.equal(value.evidence.currency, 'UNKNOWN');
});
await check('X03', 'simulator isolation does not use an unrelated newest operation', 'regression', async () => {
  resetDocuments({ trabalhos: {
    'audit-gto-operation': { driverId: identity.userId, companyId: 'company-a', simulatorId: 'gto', vehicleId: 'vehicle-a', status: 'completed', completedAt: 180 },
    'audit-ets-operation': { driverId: identity.userId, companyId: 'company-b', simulatorId: 'ets2', vehicleId: 'vehicle-b', status: 'active', assignedAt: 200 },
  }, veiculos: { 'vehicle-a': { name: 'A' }, 'vehicle-b': { name: 'B' } } });
  const { readRankingParticipantVehicle } = await fromSource('src/hooks/useRankingParticipantVehicle.ts');
  const result = await readRankingParticipantVehicle(identity.userId, 'company-a', {viewerId:'unique-x03', simulatorId:'gto'});
  assert.equal(result.operation?.id, 'audit-gto-operation');
  assert.equal(result.vehicle?.id, 'vehicle-a');
});
// Execute the archived backend's real compiled preflight. Firebase wrappers and
// database access are replaced; a sentinel forbids all database/network actions.
class HttpsError extends Error { constructor(code, message, details) { super(message); this.code = code; this.details = details; } }
const funcs = { https: { HttpsError }, region: () => ({ https: { onCall: (handler) => handler } }) };
const originalLoad = Module._load;
Module._load = function(specifier, parent, isMain) {
  if (specifier === 'firebase-functions') return funcs;
  if (specifier === 'firebase-admin/firestore') return { FieldValue: { serverTimestamp() { throw new Error('AUDIT_DATABASE_BOUNDARY'); } } };
  if (specifier === 'firebase-admin') return { firestore() { throw new Error('AUDIT_DATABASE_BOUNDARY'); } };
  return originalLoad.call(this, specifier, parent, isMain);
};
let register;
try { register = createRequire(import.meta.url)(path.join(root, 'functions/lib/registerCanonicalSimpleTrip.js')).registerCanonicalSimpleTrip; }
finally { Module._load = originalLoad; }
const trip = { tripId: 'audit-trip', canonicalTripId: 'audit-trip', idempotencyKey: 'audit-idempotency', driverId: identity.userId, companyId: 'audit-company', contractId: 'audit-contract', jobId: 'audit-job', origem: 'Audit origin', destino: 'Audit destination', valor: 100, valorCents: 10000, simulatorKey: 'wtds', simpleAutomation: true, simpleReceiptResultScreenConfirmed: true, simpleReceiptBonusEvidence: 'NONE' };
const invoke = (extra) => register({ trip: { ...trip, ...extra } }, { auth: { uid: identity.userId } });
for (const [id, extra] of [['V01', { simpleReceiptResultScreenConfirmed: false }], ['V02', { simpleReceiptBonusEvidence: '' }], ['V03', { simpleReceiptBonusEvidence: 'POSITIVE' }]]) {
  await check(id, 'backend reproduces exact screenshot evidence rejection', 'validation', async () => {
    await assert.rejects(invoke(extra), (e) => e.message === 'Evidência Simple não confirmada.' && e.code === 'invalid-argument' && e.details.retryable === false);
  });
}
await check('V04', 'valid Simple flags pass the evidence gate', 'validation', () => assert.rejects(invoke({}), /AUDIT_DATABASE_BOUNDARY/));
await check('V05', 'server rejects a different authenticated driver', 'protection', () => assert.rejects(invoke({ driverId: 'audit-other-driver' }), (e) => e.code === 'permission-denied'));
await check('V06', 'server rejects a receipt amount different from the submitted cents', 'protection', () => assert.rejects(invoke({ receiptText: 'TOTAL R$ 90,00' }), /ganho do recibo/));
await check('F07', 'Simple request without receiptText reaches the database boundary', 'regression', () => assert.rejects(invoke({}), /AUDIT_DATABASE_BOUNDARY/));

const summary = { status: 'SYNTHETIC_OFFLINE_TESTS_ONLY', base: '1.0.463', sourceArchive: 'NVU-PRO-1.0.463-ranking-ajustes-source.zip', sourceSha256: process.env.NVU_AUDIT_SOURCE_SHA256 || '', verifiedCases: results.length, productionCalls: 0, firestoreRealCalls: 0, storageRealCalls: 0, reactLifecycleExecuted: false, photoStorageRoute: 'real localStorage fallback; IndexedDB not exercised', backendRoute: 'archived compiled preflight; Firebase wrappers and database are doubles', results };
fs.writeFileSync(path.join(here, 'regression-results.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ verifiedCases: results.length, regressionsVerified: results.filter((r) => r.kind === 'regression').length, productionCalls: 0 }));
