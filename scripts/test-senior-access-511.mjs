import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';

// Actual production handlers, Firestore and Authentication emulators.
// Callable contexts are controlled fixtures; this does not test production IAM.
const projectId = 'demo-nvu-v36-4-staging';
assert.equal(process.env.GCLOUD_PROJECT, projectId);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8085');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = require(path.resolve('functions/lib/firebaseAdmin.js'));
if (!admin.apps.length) admin.initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
const db = admin.firestore(), auth = admin.auth();
const password = 'homologation-emulator-only-511';
process.env.SENIOR_PANEL_PASSWORD_HASH = createHash('sha256').update(`nvu-senior-v1:${password}`).digest('hex');
const { authenticateSeniorAccess } = require('../functions/lib/seniorAccess');
const { getSeniorMonthlyMetrics } = require('../functions/lib/rankingAggregates');
const { manageFleetMembership } = require('../functions/lib/fleetMembership');
const { auditCanonicalProductionData } = require('../functions/lib/index');
const { generateNvuNewsBackfill } = require('../functions/lib/nvuNewsBackfill');
const { syncCompanyApprovalNews } = require('../functions/lib/companyApprovalNews');
const results = [];
const actor = (uid, token = {}) => ({ auth: { uid, token: { auth_time: Math.floor(Date.now() / 1000) + 5, ...token } } });
const check = async (name, run) => {
  try { await run(); results.push({ name, status: 'PASS' }); console.log('PASS', name); }
  catch (error) { results.push({ name, status: 'FAIL', error: String(error.message) }); console.error('FAIL', name, error.message); }
};
const denied = run => assert.rejects(run, error => ['permission-denied', 'unauthenticated', 'failed-precondition'].includes(error.code));
async function seed(label, profile = {}, identity = {}) {
  const uid = `qa511-${label}`;
  try { await auth.deleteUser(uid); } catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
  await auth.createUser({ uid, ...identity });
  await auth.setCustomUserClaims(uid, { unrelatedClaim: 'preserved' });
  await db.doc(`users/${uid}`).set({ name: label, status: 'active', accountStatus: 'active', ...profile });
  await db.doc(`security_rate_limits/senior_${uid}`).delete();
  return uid;
}
try {
  await check('Anonymous access is rejected', () => denied(() => authenticateSeniorAccess.run({ password }, {})));
  await check('Active account receives the Senior claim and preserves existing claims', async () => {
    const uid = await seed('active');
    assert.equal((await authenticateSeniorAccess.run({ password }, actor(uid))).success, true);
    const claims = (await auth.getUser(uid)).customClaims;
    assert.equal(claims.senior, true); assert.equal(claims.unrelatedClaim, 'preserved');
  });
  for (const [label, profile, identity] of [
    ['suspended-status', { status: 'suspended' }, {}],
    ['suspended-account', { accountStatus: 'suspended', suspension: { active: true } }, {}],
    ['deleted', { deleted: true }, {}],
    ['disabled-auth', {}, { disabled: true }],
  ]) await check(`Senior password cannot activate an unavailable account: ${label}`, async () => {
    const uid = await seed(label, profile, identity), before = (await db.doc(`users/${uid}`).get()).data();
    await denied(() => authenticateSeniorAccess.run({ password }, actor(uid)));
    assert.equal((await auth.getUser(uid)).customClaims.senior, undefined);
    assert.deepEqual((await db.doc(`users/${uid}`).get()).data(), before);
  });
  await check('A profile missing from Firestore cannot be recreated through Senior authentication', async () => {
    const uid = await seed('missing'); await db.doc(`users/${uid}`).delete();
    await denied(() => authenticateSeniorAccess.run({ password }, actor(uid)));
    assert.equal((await db.doc(`users/${uid}`).get()).exists, false);
    assert.equal((await auth.getUser(uid)).customClaims.senior, undefined);
  });
  await check('A revoked session cannot acquire a new Senior claim', async () => {
    const uid = await seed('revoked'); await auth.revokeRefreshTokens(uid);
    await denied(() => authenticateSeniorAccess.run({ password }, actor(uid, { auth_time: 1 })));
    assert.equal((await auth.getUser(uid)).customClaims.senior, undefined);
  });
  await check('Five failed passwords block a subsequent correct password', async () => {
    const uid = await seed('rate-limit');
    for (let i = 0; i < 4; i++) await assert.rejects(() => authenticateSeniorAccess.run({ password: 'wrong' }, actor(uid)), { code: 'permission-denied' });
    await assert.rejects(() => authenticateSeniorAccess.run({ password: 'wrong' }, actor(uid)), { code: 'resource-exhausted' });
    await assert.rejects(() => authenticateSeniorAccess.run({ password }, actor(uid)), { code: 'resource-exhausted' });
    assert.equal((await auth.getUser(uid)).customClaims.senior, undefined);
  });
  await check('Suspended Senior cannot read monthly business metrics with a cached claim', async () => {
    const uid = await seed('metrics-suspended', { accountStatus: 'suspended' });
    await denied(() => getSeniorMonthlyMetrics.run({}, actor(uid, { senior: true })));
  });
  await check('Disabled Senior cannot read monthly business metrics with a cached claim', async () => {
    const uid = await seed('metrics-disabled', {}, { disabled: true });
    await denied(() => getSeniorMonthlyMetrics.run({}, actor(uid, { senior: true })));
  });
  await check('Active Senior can read the monthly metrics', async () => {
    const uid = await seed('metrics-active');
    assert.equal((await getSeniorMonthlyMetrics.run({}, actor(uid, { senior: true }))).success, true);
  });
  for (const [name, callable] of [
    ['canonical audit', auditCanonicalProductionData],
    ['news backfill', generateNvuNewsBackfill],
    ['company approval news', syncCompanyApprovalNews],
  ]) await check(`Suspended Senior cannot run ${name} with a cached claim`, async () => {
    const uid = await seed(`blocked-${name.replaceAll(' ', '-')}`, { accountStatus: 'suspended' });
    await denied(() => callable.run({}, actor(uid, { senior: true })));
  });
  await check('A removed legacy simulator row cannot grant a company role', async () => {
    const uid = await seed('legacy-role');
    await db.doc('frotas/qa511-fleet').set({ ownerId: 'qa511-another-owner', status: 'active' });
    await db.doc(`companyMembers/${uid}_qa511-fleet`).set({ userId: uid, companyId: 'qa511-fleet', roles: ['admin'], status: 'removed' });
    await denied(() => manageFleetMembership.run({ action: 'set-role', companyId: 'qa511-fleet', targetUserId: uid, role: 'admin' }, actor(uid)));
  });
} finally {
  const output = process.env.NVU_TEST_OUTPUT || 'reports/homologation-511/senior-access.json';
  await fs.mkdir(new URL('.', new URL(`../${output}`, import.meta.url)), { recursive: true });
  await fs.writeFile(output, JSON.stringify({ projectId, productionWrites: false, method: 'actual handlers; real Firestore/Auth emulators; controlled callable contexts', results }, null, 2) + '\n');
  await db.terminate();
}
if (results.some(result => result.status === 'FAIL')) process.exitCode = 1;
else console.log('SENIOR_ACCESS_511_PASS', results.length);
