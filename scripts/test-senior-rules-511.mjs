import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDocFromServer, setDoc, updateDoc } from 'firebase/firestore';

assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8085');
const projectId = 'demo-nvu-v36-4-staging';
const env = await initializeTestEnvironment({ projectId, firestore: { rules: await fs.readFile('firestore.rules', 'utf8') } });
const uid = 'qa511-rules-senior', companyId = 'qa511-rules-private-fleet', results = [];
const seed = profile => env.withSecurityRulesDisabled(async context => {
  await setDoc(doc(context.firestore(), 'users', uid), { status: 'active', accountStatus: 'active', ...profile });
  await setDoc(doc(context.firestore(), 'frotas', companyId), { ownerId: 'another-owner', userId: 'another-owner', status: 'active', privateField: 'emulator fixture' });
});
const check = async (name, run) => {
  try { await run(); results.push({ name, status: 'PASS' }); console.log('PASS', name); }
  catch (error) { results.push({ name, status: 'FAIL', error: String(error.message) }); console.error('FAIL', name, error.message); }
};
try {
  for (const claims of [{ senior: true }, { isSenior: true }, { role: 'senior' }, { roles: ['senior'] }]) {
    const label = JSON.stringify(claims), db = env.authenticatedContext(uid, claims).firestore();
    await check(`Active Senior reads a private company: ${label}`, async () => {
      await seed({}); await assertSucceeds(getDocFromServer(doc(db, 'frotas', companyId)));
    });
    for (const [status, profile] of [
      ['suspended', { accountStatus: 'suspended' }],
      ['suspension marker', { suspension: { active: true } }],
      ['deleted', { deleted: true }],
      ['inactive', { status: 'inactive' }],
    ]) await check(`Cached Senior claim cannot read private company after ${status}: ${label}`, async () => {
      await seed(profile); await assertFails(getDocFromServer(doc(db, 'frotas', companyId)));
    });
    await check(`Blocked Senior cannot undo account moderation directly: ${label}`, async () => {
      await seed({ accountStatus: 'suspended' });
      await assertFails(updateDoc(doc(db, 'users', uid), { accountStatus: 'active' }));
    });
    await check(`Missing profile cannot use Senior authority: ${label}`, async () => {
      await env.withSecurityRulesDisabled(async context => {
        const { deleteDoc } = await import('firebase/firestore');
        await deleteDoc(doc(context.firestore(), 'users', uid));
      });
      await assertFails(getDocFromServer(doc(db, 'frotas', companyId)));
    });
  }
} finally {
  const output = process.env.NVU_TEST_OUTPUT || 'reports/homologation-511/senior-rules.json';
  await fs.mkdir(new URL('.', new URL(`../${output}`, import.meta.url)), { recursive: true });
  await fs.writeFile(output, JSON.stringify({ projectId, productionWrites: false, method: 'real Firestore Emulator and production rules; synthetic verified-claim fixtures', results }, null, 2) + '\n');
  await env.cleanup();
}
if (results.some(result => result.status === 'FAIL')) process.exitCode = 1;
else console.log('SENIOR_RULES_511_PASS', results.length);
