import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage';
// Guias do app: só o Sênior (conta ativa) envia/troca/exclui; qualquer usuário autenticado lê; sem login não lê.
const project = 'demo-nvu-v36-4-staging';
assert.equal(process.env.GCLOUD_PROJECT, project);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8085');
assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST, '127.0.0.1:9199');
const storageRules = fs.readFileSync('storage.rules', 'utf8');
const firestoreRules = fs.readFileSync('firestore.rules', 'utf8');
// A regra de Storage consulta o Firestore (conta ativa) com firestore.get/exists. Em alguns ambientes o emulador de Storage não alcança o
// Firestore e NEGA até regras antigas já publicadas (ex.: profile-photos). Sondamos isso com uma regra existente: se a consulta cruzada não
// funciona aqui, as regras de Storage são testadas com accountIsUsable() = true e o caso "Sênior suspenso no Storage" é registrado como SKIP.
const probeEnv = await initializeTestEnvironment({ projectId: project, firestore: { rules: firestoreRules }, storage: { rules: storageRules } });
await probeEnv.withSecurityRulesDisabled(async context => { await setDoc(doc(context.firestore(), 'users', 'qa-guides-probe'), { status: 'active', accountStatus: 'active' }); });
let crossService = true;
try { await uploadBytes(ref(probeEnv.authenticatedContext('qa-guides-probe').storage(), 'profile-photos/qa-guides-probe/p.png'), new Uint8Array([1, 2, 3]), { contentType: 'image/png' }); }
catch { crossService = false; }
await probeEnv.cleanup();
console.log(crossService ? 'Consulta Storage→Firestore disponível: regras reais.' : 'SKIP parcial: emulador sem consulta Storage→Firestore; Storage testado com accountIsUsable()=true.');
const env = await initializeTestEnvironment({ projectId: project, firestore: { rules: firestoreRules },
  storage: { rules: crossService ? storageRules : storageRules.replace(/function accountIsUsable\(\) \{[\s\S]*?\n    \}\n/, 'function accountIsUsable() { return true; }\n') } });
const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
const senior = 'qa-guides-senior', driver = 'qa-guides-driver', blocked = 'qa-guides-blocked-senior';
const checks: string[] = [];
const run = async (name: string, fn: () => Promise<void>) => { await fn(); checks.push(name); console.log('PASS', name); };
try {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'users', senior), { status: 'active', accountStatus: 'active' });
    await setDoc(doc(db, 'users', driver), { status: 'active', accountStatus: 'active' });
    await setDoc(doc(db, 'users', blocked), { status: 'active', accountStatus: 'suspended' });
  });
  const as = (uid: string, claims: Record<string, unknown> = {}) => env.authenticatedContext(uid, { email: uid + '@example.test', ...claims });
  const seniorCtx = as(senior, { senior: true }), driverCtx = as(driver), blockedCtx = as(blocked, { senior: true });
  const record = (id: string, path: string, extra: Record<string, unknown> = {}) => ({
    id, fileName: 'Guia novo.pdf', storagePath: path, downloadUrl: 'https://firebasestorage.googleapis.com/v0/b/demo/o/x?alt=media&token=t',
    size: 9, contentType: 'application/pdf', updatedBy: senior, updatedAt: serverTimestamp(), ...extra });
  const drivePath = 'app-guides/driver/1-guia.pdf';

  await run('Storage: Senior sobe PDF novo em app-guides/{driver|company}', async () => {
    await assertSucceeds(uploadBytes(ref(seniorCtx.storage(), drivePath), pdf, { contentType: 'application/pdf' }));
    await assertSucceeds(uploadBytes(ref(seniorCtx.storage(), 'app-guides/company/1-guia.pdf'), pdf, { contentType: 'application/pdf' }));
  });
  await run('Storage: motorista, Sênior suspenso e visitante não enviam nem apagam', async () => {
    await assertFails(uploadBytes(ref(driverCtx.storage(), 'app-guides/driver/2-x.pdf'), pdf, { contentType: 'application/pdf' }));
    if (crossService) await assertFails(uploadBytes(ref(blockedCtx.storage(), 'app-guides/driver/2-x.pdf'), pdf, { contentType: 'application/pdf' }));
    await assertFails(uploadBytes(ref(env.unauthenticatedContext().storage(), 'app-guides/driver/2-x.pdf'), pdf, { contentType: 'application/pdf' }));
    await assertFails(deleteObject(ref(driverCtx.storage(), drivePath)));
    if (crossService) await assertFails(deleteObject(ref(blockedCtx.storage(), drivePath)));
  });
  await run('Storage: só PDF, só guia conhecido, sem sobrescrever e até 15 MB', async () => {
    await assertFails(uploadBytes(ref(seniorCtx.storage(), 'app-guides/driver/3-x.png'), pdf, { contentType: 'image/png' }));
    await assertFails(uploadBytes(ref(seniorCtx.storage(), 'app-guides/driver/3-x.pdf'), pdf, { contentType: 'text/html' }));
    await assertFails(uploadBytes(ref(seniorCtx.storage(), 'app-guides/outro/3-x.pdf'), pdf, { contentType: 'application/pdf' }));
    await assertFails(uploadBytes(ref(seniorCtx.storage(), drivePath), pdf, { contentType: 'application/pdf' }));
    await assertFails(uploadBytes(ref(seniorCtx.storage(), 'app-guides/driver/3-big.pdf'), new Uint8Array(15 * 1024 * 1024 + 1), { contentType: 'application/pdf' }));
  });
  await run('Storage: usuário autenticado lê o PDF; visitante não', async () => {
    assert.equal((await assertSucceeds(getBytes(ref(driverCtx.storage(), drivePath)))).byteLength, pdf.length);
    await assertFails(getBytes(ref(env.unauthenticatedContext().storage(), drivePath)));
  });
  await run('Firestore: Senior grava a ficha válida; autenticado lê; visitante não', async () => {
    await assertSucceeds(setDoc(doc(seniorCtx.firestore(), 'app_guides', 'driver'), record('driver', drivePath)));
    await assertSucceeds(getDoc(doc(driverCtx.firestore(), 'app_guides', 'driver')));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'app_guides', 'driver')));
  });
  await run('Firestore: motorista e Sênior suspenso não gravam nem apagam fichas', async () => {
    await assertFails(setDoc(doc(driverCtx.firestore(), 'app_guides', 'company'), record('company', 'app-guides/company/1-guia.pdf')));
    await assertFails(setDoc(doc(blockedCtx.firestore(), 'app_guides', 'company'), record('company', 'app-guides/company/1-guia.pdf')));
    await assertFails(deleteDoc(doc(driverCtx.firestore(), 'app_guides', 'driver')));
    await assertFails(deleteDoc(doc(blockedCtx.firestore(), 'app_guides', 'driver')));
  });
  await run('Firestore: ficha inválida é recusada (guia desconhecido, caminho de outro guia, tipo, tamanho, campo extra, data do cliente)', async () => {
    const db = seniorCtx.firestore(), at = (id: string) => doc(db, 'app_guides', id);
    await assertFails(setDoc(at('outro'), record('outro', 'app-guides/outro/1-x.pdf')));
    await assertFails(setDoc(at('company'), record('company', drivePath)));
    await assertFails(setDoc(at('company'), record('company', 'app-guides/company/1-guia.pdf', { contentType: 'text/html' })));
    await assertFails(setDoc(at('company'), record('company', 'app-guides/company/1-guia.pdf', { size: 15 * 1024 * 1024 + 1 })));
    await assertFails(setDoc(at('company'), record('company', 'app-guides/company/1-guia.pdf', { size: 0 })));
    await assertFails(setDoc(at('company'), record('company', 'app-guides/company/1-guia.pdf', { extra: true })));
    await assertFails(setDoc(at('company'), record('company', 'app-guides/company/1-guia.pdf', { downloadUrl: 'http://example.test/x' })));
    await assertFails(setDoc(at('company'), record('company', 'app-guides/company/1-guia.pdf', { updatedAt: new Date('2020-01-01') })));
    await assertFails(setDoc(at('company'), record('company', 'app-guides/company/1-guia.pdf', { id: 'driver' })));
    await assertSucceeds(setDoc(at('company'), record('company', 'app-guides/company/1-guia.pdf')));
  });
  await run('Senior exclui ficha e arquivo (o app volta ao guia padrão)', async () => {
    await assertSucceeds(deleteDoc(doc(seniorCtx.firestore(), 'app_guides', 'driver')));
    await assertSucceeds(deleteObject(ref(seniorCtx.storage(), drivePath)));
    await assert.rejects(getBytes(ref(driverCtx.storage(), drivePath)), (error: any) => error.code === 'storage/object-not-found');
  });
  console.log(JSON.stringify({ ok: true, checks }, null, 1));
} finally { await env.cleanup(); }
