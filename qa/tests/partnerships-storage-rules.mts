import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { getBytes, ref, uploadBytes } from 'firebase/storage';
// v44 — foto do veículo exigida para iniciar uma operação em parceria (B2P):
// só o motorista designado envia (uma vez, imagem, sem sobrescrever); leem ele e a gestão das duas empresas; ninguém mais.
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
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]), pid = 'po_abc123';
const path = (uid: string, name = '1_v.webp') => `partnership-start-photos/${pid}/${uid}/${name}`;
let checks = 0;
const run = async (name: string, fn: () => Promise<void>) => { await fn(); checks++; console.log('PASS', name); };
try {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const uid of ['drv', 'other-drv', 'mgr-a', 'mgr-b', 'mgr-x']) await setDoc(doc(db, 'users', uid), { status: 'active', accountStatus: 'active' });
    await setDoc(doc(db, 'users', 'blocked-drv'), { status: 'active', accountStatus: 'suspended' });
    for (const [uid, company] of [['mgr-a', 'a'], ['mgr-b', 'b'], ['mgr-x', 'x']]) await setDoc(doc(db, 'company_access', company, 'members', uid), { userId: uid, companyId: company, status: 'active', roles: ['admin'] });
    await setDoc(doc(db, 'partnerships', pid), { contractorCompanyId: 'a', executorCompanyId: 'b', driverId: 'drv', status: 'accepted' });
  });
  const as = (uid: string) => env.authenticatedContext(uid, { email: uid + '@example.test' }).storage();
  await run('o motorista designado envia a foto (imagem) na própria pasta', async () => {
    await assertSucceeds(uploadBytes(ref(as('drv'), path('drv')), png, { contentType: 'image/webp' }));
  });
  await run('outro motorista, gestor, visitante e conta suspensa não enviam; nem na pasta de outro', async () => {
    await assertFails(uploadBytes(ref(as('other-drv'), path('other-drv', '2.webp')), png, { contentType: 'image/webp' }));
    await assertFails(uploadBytes(ref(as('drv'), path('other-drv', '2.webp')), png, { contentType: 'image/webp' }));
    await assertFails(uploadBytes(ref(as('mgr-b'), path('mgr-b', '2.webp')), png, { contentType: 'image/webp' }));
    await assertFails(uploadBytes(ref(env.unauthenticatedContext().storage(), path('drv', '2.webp')), png, { contentType: 'image/webp' }));
  });
  await run('só imagem, sem sobrescrever, e só em parceria aceita/ativa existente', async () => {
    await assertFails(uploadBytes(ref(as('drv'), path('drv', '3.pdf')), png, { contentType: 'application/pdf' }));
    await assertFails(uploadBytes(ref(as('drv'), path('drv')), png, { contentType: 'image/webp' }));
    await assertFails(uploadBytes(ref(as('drv'), `partnership-start-photos/po_inexistente/drv/1.webp`), png, { contentType: 'image/webp' }));
    await env.withSecurityRulesDisabled(async context => { await setDoc(doc(context.firestore(), 'partnerships', 'po_done'), { contractorCompanyId: 'a', executorCompanyId: 'b', driverId: 'drv', status: 'completed' }); });
    await assertFails(uploadBytes(ref(as('drv'), 'partnership-start-photos/po_done/drv/1.webp'), png, { contentType: 'image/webp' }));
  });
  await run('leem: o motorista e a gestão da contratante e da executora; estranhos e visitante não', async () => {
    for (const uid of ['drv', 'mgr-a', 'mgr-b']) assert.equal((await assertSucceeds(getBytes(ref(as(uid), path('drv'))))).byteLength, png.length, uid);
    await assertFails(getBytes(ref(as('mgr-x'), path('drv')))); await assertFails(getBytes(ref(as('other-drv'), path('drv'))));
    await assertFails(getBytes(ref(env.unauthenticatedContext().storage(), path('drv'))));
  });
  console.log(`${checks} verificações de Storage das parcerias passaram.`);
} finally { await env.cleanup(); }
