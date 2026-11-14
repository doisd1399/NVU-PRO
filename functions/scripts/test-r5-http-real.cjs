const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const admin = require('../lib/firebaseAdmin');

const project = process.env.GCLOUD_PROJECT || 'demo-gto-r5-http';
const authBase = 'http://127.0.0.1:9099';
const callableBase = `http://127.0.0.1:5001/${project}/us-central1/registerGtoProReceipt`;
const db = admin.apps.length ? admin.firestore() : (admin.initializeApp({ projectId: project }), admin.firestore());
const ts = admin.firestore.Timestamp.now();

function request(url, { method = 'POST', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request({ hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search, method,
      headers: { ...headers, ...(body === undefined ? {} : { 'content-length': Buffer.byteLength(body) }) } }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => { let json; try { json = JSON.parse(text); } catch { json = text; } resolve({ status: res.statusCode, json }); });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function createUser(label) {
  const email = `${label}-${crypto.randomUUID()}@example.test`;
  const body = JSON.stringify({ email, password: 'StrongPass123!', returnSecureToken: true });
  const result = await request(`${authBase}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
    headers: { 'content-type': 'application/json' }, body,
  });
  assert.equal(result.status, 200, JSON.stringify(result.json));
  return { uid: result.json.localId, token: result.json.idToken };
}

function dataOf(response) { return response.json?.data ?? response.json?.result ?? response.json; }

async function call(token, data) {
  return request(callableBase, { headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ data }) });
}

async function countDocs() {
  const names = ['trabalhos', 'contratos', 'frotas', 'users', 'historico_viagens', 'pro_trip_attempts', 'pro_receipt_events', 'trip_operation_slots'];
  const counts = {};
  for (const name of names) counts[name] = (await db.collection(name).get()).size;
  return counts;
}

async function seedJob(uid, jobId, companyId, contractId) {
  const batch = db.batch();
  batch.set(db.collection('trabalhos').doc(jobId), { driverId: uid, companyId, contractId, progress: 3, totalDeliveries: 10,
    status: 'active', operationReconciliationVersion: 4, operationProgressReconciled: true, operationProjectionSource: 'r5-http-test' });
  batch.set(db.collection('contratos').doc(contractId), { companyId, totalDeliveries: 10 });
  batch.set(db.collection('frotas').doc(companyId), { simulatorId: 'gto', name: 'Empresa R5' });
  batch.set(db.collection('users').doc(uid), { name: 'Motorista R5' });
  for (let slot = 1; slot <= 3; slot += 1) {
    const id = `confirmed:${jobId}:${slot}`;
    batch.set(db.collection('historico_viagens').doc(id), { id, jobId, operationId: jobId, driverId: uid, companyId, contractId,
      operationSlot: slot, operationSlotKey: id, status: 'concluida', recordStatus: 'concluida', source: 'gto_auto',
      uploadedAt: ts, serverValidatedAt: ts });
  }
  await batch.commit();
}

function payload(uid, jobId, companyId, contractId, attemptId, overrides = {}) {
  return { jobId, companyId, contractId, driverId: uid, attemptId, contextEpoch: 'global-truck:1790660000000:r5http01',
    origin: 'Itapetuna', destination: 'Nova Macaé', simulatorKey: 'global-truck', simulatorCode: 'GTO',
    packageId: 'com.stargamesapps.gto', amountCents: 256300, currency: 'BRL', bonusEvidence: 'NONE',
    receiptText: 'VALOR A RECEBER R$ 2.563,00', expectedProgress: 3, ...overrides };
}

(async () => {
  const a = await createUser('r5-a');
  const b = await createUser('r5-b');
  const jobA = 'jobr5httpA12345678', companyA = 'companyr5httpA123', contractA = 'contractr5httpA123';
  const jobB = 'jobr5httpB12345678', companyB = 'companyr5httpB123', contractB = 'contractr5httpB123';
  await seedJob(a.uid, jobA, companyA, contractA);
  await seedJob(b.uid, jobB, companyB, contractB);

  const beforeProbe = await countDocs();
  for (const user of [a, b]) {
    const probe = await call(user.token, { compatibilityProbe: 'gto-contract-v2' });
    assert.equal(probe.status, 200, JSON.stringify(probe.json));
    if (!probe.json.data) console.log('CALLABLE_ENVELOPE_DEBUG=' + JSON.stringify(probe.json));
    const probeData = probe.json.data ?? probe.json.result ?? probe.json;
    assert.deepEqual(probeData, { compatible: true, callable: 'registerGtoProReceipt', contractVersion: 'gto-contract-v2', allowsUnknownCurrency: true, validationVersion: 2 });
  }
  const afterProbe = await countDocs();
  assert.deepEqual(afterProbe, beforeProbe, 'probe must not create Firestore documents');
  const oldProbe = await call(a.token, { compatibilityProbe: 'gto-contract-v1' });
  assert.equal(oldProbe.status, 400);
  assert.equal(oldProbe.json.error.details.reasonCode, 'GTO_PROTOCOL_UNSUPPORTED');
  const noAuth = await call('', { compatibilityProbe: 'gto-contract-v2' });
  assert.equal(noAuth.status, 401);

  const reqA = payload(a.uid, jobA, companyA, contractA, 'pro-r5-http-a-123456');
  const created = await call(a.token, reqA);
  assert.equal(created.status, 200, JSON.stringify(created.json));
  assert.equal(dataOf(created).registered, true);
  assert.equal(dataOf(created).progress, 4);
  const replay = await call(a.token, reqA);
  assert.equal(replay.status, 200, JSON.stringify(replay.json));
  assert.equal(dataOf(replay).duplicate, true);
  const foreign = await call(b.token, reqA);
  assert.equal(foreign.status, 400);
  assert.equal(foreign.json.error.details.reasonCode, 'DRIVER_SCOPE_MISMATCH');
  const conflict = await call(a.token, { ...reqA, attemptId: 'pro-r5-http-conflict-123', receiptText: 'VALOR A RECEBER EUR 2.563,00' });
  assert.equal(conflict.status, 400);
  assert.equal(conflict.json.error.details.reasonCode, 'GTO_CURRENCY_CONFLICT');

  const reqB = payload(b.uid, jobB, companyB, contractB, 'pro-r5-http-b-123456', { currency: '', origin: 'Cruz do Oeste', destination: 'Registro', receiptText: 'CONCLUÍDO\nVALOR A RECEBER:  2.563,00' });
  const unknown = await call(b.token, reqB);
  assert.equal(unknown.status, 200, JSON.stringify(unknown.json));
  assert.equal(dataOf(unknown).registered, true);
  assert.equal(dataOf(unknown).progress, 4);
  const unknownReplay = await call(b.token, reqB);
  assert.equal(unknownReplay.status, 200, JSON.stringify(unknownReplay.json));
  assert.equal(dataOf(unknownReplay).duplicate, true);

  console.log(JSON.stringify({ result: 'PASS', transport: 'real-http', auth: 'emulator-idTokens', firestore: 'emulator-transactions',
    owners: 2, probeNoWrites: true, oldVersionRejected: true, noAuthRejected: true, progress: '3/10->4/10',
    replayIdempotent: true, foreignOwnerRejected: true, currencyConflictRejected: true, unknownCurrencyRegistered: true }));
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
