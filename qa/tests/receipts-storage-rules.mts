import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { getBytes, ref, uploadBytes } from 'firebase/storage';
// v73 — comprovante do pagamento (Pagamentos e Parcerias): só a gestão da empresa pagadora envia (imagem, uma vez, pagamento em aberto);
// leem quem enviou, a gestão e o motorista que recebe; ninguém mais.
const project = 'demo-nvu-v36-4-staging';
assert.equal(process.env.GCLOUD_PROJECT, project);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8085');
assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST, '127.0.0.1:9199');
const storageRules = fs.readFileSync('storage.rules', 'utf8'), firestoreRules = fs.readFileSync('firestore.rules', 'utf8');
// Mesma sondagem das outras suítes de Storage: o emulador de Storage nem sempre alcança o Firestore.
const probeEnv = await initializeTestEnvironment({ projectId: project, firestore: { rules: firestoreRules }, storage: { rules: storageRules } });
await probeEnv.withSecurityRulesDisabled(async context => { await setDoc(doc(context.firestore(), 'users', 'qa-pp-probe'), { status: 'active', accountStatus: 'active' }); });
let crossService = true;
try { await uploadBytes(ref(probeEnv.authenticatedContext('qa-pp-probe').storage(), 'profile-photos/qa-pp-probe/p.png'), new Uint8Array([1, 2, 3]), { contentType: 'image/png' }); }
catch { crossService = false; }
await probeEnv.cleanup();
if (!crossService) { console.log('SKIP: o emulador de Storage não alcança o Firestore neste ambiente; regras de parceria não puderam ser exercitadas aqui.'); process.exit(0); }
const env = await initializeTestEnvironment({ projectId: project, firestore: { rules: firestoreRules }, storage: { rules: storageRules } });
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
let checks = 0;
const run = async (name: string, fn: () => Promise<void>) => { await fn(); checks++; console.log('PASS', name); };
try {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const uid of ['drv', 'other-drv', 'mgr-a', 'mgr-b', 'mgr-x']) await setDoc(doc(db, 'users', uid), { status: 'active', accountStatus: 'active' });
    for (const [uid, company] of [['mgr-a', 'a'], ['mgr-b', 'b'], ['mgr-x', 'x']]) await setDoc(doc(db, 'company_access', company, 'members', uid), { userId: uid, companyId: company, status: 'active', roles: ['admin'] });
    await setDoc(doc(db, 'rewardPayments', 'rp_open'), { companyId: 'a', driverId: 'drv', status: 'pending' });
    await setDoc(doc(db, 'rewardPayments', 'rp_paid'), { companyId: 'a', driverId: 'drv', status: 'received' });
    await setDoc(doc(db, 'partnerships', 'po_ok'), { contractorCompanyId: 'a', executorCompanyId: 'b', driverId: 'drv', status: 'completed', payment: { status: 'pending' } });
    await setDoc(doc(db, 'partnerships', 'po_settled'), { contractorCompanyId: 'a', executorCompanyId: 'b', driverId: 'drv', status: 'completed', payment: { status: 'settled' } });
  });
  const as = (uid: string) => env.authenticatedContext(uid, { email: uid + '@example.test' }).storage();
  const reward = (uid: string, id = 'rp_open', name = '1.webp') => `reward-receipts/${id}/${uid}/${name}`, partner = (uid: string, id = 'po_ok', name = '1.webp') => `partnership-receipts/${id}/${uid}/${name}`;
  await run('Pagamentos: a gestão da empresa pagadora envia o comprovante (imagem, na própria pasta, pagamento em aberto)', async () => {
    await assertSucceeds(uploadBytes(ref(as('mgr-a'), reward('mgr-a')), png, { contentType: 'image/jpeg' }));
  });
  await run('Pagamentos: motorista, outra empresa, visitante, pasta alheia, PDF, sobrescrever e pagamento já fechado não enviam', async () => {
    await assertFails(uploadBytes(ref(as('drv'), reward('drv', 'rp_open', '2.webp')), png, { contentType: 'image/jpeg' }));
    await assertFails(uploadBytes(ref(as('mgr-x'), reward('mgr-x', 'rp_open', '2.webp')), png, { contentType: 'image/jpeg' }));
    await assertFails(uploadBytes(ref(as('mgr-a'), reward('mgr-x', 'rp_open', '2.webp')), png, { contentType: 'image/jpeg' }));
    await assertFails(uploadBytes(ref(env.unauthenticatedContext().storage(), reward('mgr-a', 'rp_open', '2.webp')), png, { contentType: 'image/jpeg' }));
    await assertFails(uploadBytes(ref(as('mgr-a'), reward('mgr-a', 'rp_open', '3.pdf')), png, { contentType: 'application/pdf' }));
    await assertFails(uploadBytes(ref(as('mgr-a'), reward('mgr-a')), png, { contentType: 'image/jpeg' }));
    await assertFails(uploadBytes(ref(as('mgr-a'), reward('mgr-a', 'rp_paid')), png, { contentType: 'image/jpeg' }));
  });
  await run('Pagamentos: leem quem enviou, a gestão e o motorista que recebe; estranhos e visitante não', async () => {
    for (const uid of ['mgr-a', 'drv']) assert.equal((await assertSucceeds(getBytes(ref(as(uid), reward('mgr-a'))))).byteLength, png.length, uid);
    await assertFails(getBytes(ref(as('other-drv'), reward('mgr-a')))); await assertFails(getBytes(ref(as('mgr-x'), reward('mgr-a'))));
    await assertFails(getBytes(ref(env.unauthenticatedContext().storage(), reward('mgr-a'))));
  });
  await run('Parcerias: a contratante envia enquanto o pagamento está pendente; a executora não envia', async () => {
    await assertSucceeds(uploadBytes(ref(as('mgr-a'), partner('mgr-a')), png, { contentType: 'image/webp' }));
    await assertFails(uploadBytes(ref(as('mgr-b'), partner('mgr-b', 'po_ok', '2.webp')), png, { contentType: 'image/webp' }));
    await assertFails(uploadBytes(ref(as('mgr-a'), partner('mgr-a', 'po_settled')), png, { contentType: 'image/webp' }));
    await assertFails(uploadBytes(ref(as('mgr-a'), partner('mgr-a', 'po_inexistente')), png, { contentType: 'image/webp' }));
  });
  await run('Parcerias: leem a gestão das duas empresas; estranhos e o motorista não', async () => {
    for (const uid of ['mgr-a', 'mgr-b']) assert.equal((await assertSucceeds(getBytes(ref(as(uid), partner('mgr-a'))))).byteLength, png.length, uid);
    await assertFails(getBytes(ref(as('mgr-x'), partner('mgr-a')))); await assertFails(getBytes(ref(as('drv'), partner('mgr-a'))));
    await assertFails(getBytes(ref(env.unauthenticatedContext().storage(), partner('mgr-a'))));
  });
  console.log(`${checks} verificações de Storage dos comprovantes passaram.`);
} finally { await env.cleanup(); }
