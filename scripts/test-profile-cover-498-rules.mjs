import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage';
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error('Firestore and Storage emulators required');
const environment = await initializeTestEnvironment({ projectId: 'demo-nvu-v36-4-staging',
  firestore: { rules: await fs.readFile('firestore.rules', 'utf8') }, storage: { rules: await fs.readFile('storage.rules', 'utf8') },
});
const results = [], image = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
const owner = environment.authenticatedContext('owner'), driver = environment.authenticatedContext('driver'), other = environment.authenticatedContext('other');
const manager = environment.authenticatedContext('manager'), legacy = environment.authenticatedContext('legacy'), senior = environment.authenticatedContext('senior', { senior: true }), anonymous = environment.unauthenticatedContext();
const cover = (context, scope, profileId, uploaderId, file = 'cover.png') => ref(context.storage(), `profile-covers/${scope}/${profileId}/${uploaderId}/${file}`);
const upload = (context, scope, profileId, uploaderId, file, bytes = image, contentType = 'image/png') => uploadBytes(cover(context, scope, profileId, uploaderId, file), bytes, { contentType });
const check = async (name, run) => { await run(); results.push(name); console.log('PASS', name); };
try {
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'frotas', 'company'), { ownerId: 'owner', userId: 'owner', companyName: 'Empresa' });
    for (const [uid, role, companyId] of [['owner','admin','company'],['driver','driver','company'],['other','driver','foreign'],['manager','driver','company'],['legacy','admin','company'],['senior','driver',null]]) await setDoc(doc(db, 'users', uid), { role, roles: [role], status: 'active', companyId });
    for (const [uid, roles] of [['owner',['owner','admin','driver']],['driver',['driver']],['manager',['admin','driver']],['legacy',['admin','driver']]])
      await setDoc(doc(db,'company_access','company','members',uid),{userId:uid,companyId:'company',status:'active',roles});
    await setDoc(doc(db, 'simulator_members', 'manager_company'), { userId: 'manager', companyId: 'company', status: 'active', roles: ['admin'] });
    await setDoc(doc(db, 'simulator_members', 'driver_company'), { userId: 'driver', companyId: 'company', status: 'active', roles: ['driver'] });
  });
  await check('Motorista envia capa própria independentemente do simulador/veículo', () => assertSucceeds(upload(driver,'driver','driver','driver','own.png')));
  await check('Outro usuário lê os mesmos bytes da capa publicada', async () => assert.deepEqual(new Uint8Array(await assertSucceeds(getBytes(cover(other,'driver','driver','driver','own.png')))), image));
  await check('Leitura pública da imagem de identidade também funciona', () => assertSucceeds(getBytes(cover(anonymous,'driver','driver','driver','own.png'))));
  await check('Usuário anônimo não envia capa', () => assertFails(upload(anonymous,'driver','driver','driver','anon.png')));
  await check('Outro motorista não envia para identidade alheia', () => assertFails(upload(other,'driver','driver','other','foreign.png')));
  await check('UID do caminho não pode ser falsificado', () => assertFails(upload(other,'driver','other','driver','spoof.png')));
  await check('Dono da empresa envia capa da empresa', () => assertSucceeds(upload(owner,'company','company','owner','owner.png')));
  await check('Administrador com vínculo ativo envia capa da empresa', () => assertSucceeds(upload(manager,'company','company','manager','manager.png')));
  await check('Administrador legado migrado permanece limitado à sua empresa', async () => { await assertSucceeds(upload(legacy,'company','company','legacy','legacy.png')); await assertFails(upload(legacy,'company','foreign','legacy','foreign.png')); });
  await check('Sênior com claim verificado envia capa da empresa', () => assertSucceeds(upload(senior,'company','company','senior','senior.png')));
  await check('Motorista não altera capa da empresa', () => assertFails(upload(driver,'company','company','driver','driver.png')));
  await check('Empresa estrangeira e escopo inválido são negados', async () => { await assertFails(upload(other,'company','company','other','foreign.png')); await assertFails(upload(driver,'vehicle','driver','driver','bad.png')); });
  await check('Formato não imagem e arquivo acima do limite são negados', async () => { await assertFails(upload(driver,'driver','driver','driver','text.txt',image,'text/plain')); await assertFails(upload(driver,'driver','driver','driver','big.png',new Uint8Array(2_000_001))); });
  await check('Arquivos publicados são imutáveis', async () => { await assertFails(upload(driver,'driver','driver','driver','own.png')); await assertFails(deleteObject(cover(driver,'driver','driver','driver','own.png'))); });
  await check('Metadados pessoais confirmados são lidos por outros usuários', async () => {
    await assertSucceeds(updateDoc(doc(driver.firestore(),'users','driver'),{profileCoverURL:'https://example.test/cover.png',profileCoverRevision:'r1'}));
    const snapshot = await assertSucceeds(getDoc(doc(other.firestore(),'users','driver'))); assert.equal(snapshot.data().profileCoverRevision,'r1');
  });
  await check('Administrador da empresa não substitui capa pessoal alheia', () => assertFails(updateDoc(doc(owner.firestore(),'users','driver'),{profileCoverURL:'https://example.test/foreign.png'})));
  await check('Metadados da empresa seguem autorização administrativa existente', async () => {
    await assertSucceeds(updateDoc(doc(manager.firestore(),'frotas','company'),{profileCoverURL:'https://example.test/company.png',profileCoverRevision:'r1'}));
    assert.equal((await assertSucceeds(getDoc(doc(manager.firestore(),'frotas','company')))).data().profileCoverRevision,'r1');
    await assertFails(getDoc(doc(other.firestore(),'frotas','company')));
    await assertFails(updateDoc(doc(other.firestore(),'frotas','company'),{profileCoverURL:'https://example.test/foreign.png'}));
  });
  await fs.writeFile('reports/profile-cover-498-rules.json', JSON.stringify({ suite:'profile-cover-498-rules',emulatorOnly:true,passed:results.length,checks:results },null,2)+'\n');
  console.log(`PROFILE_COVER_498_RULES_PASS ${results.length} checks`);
} finally { await environment.cleanup(); }
