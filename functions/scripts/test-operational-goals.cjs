const assert = require('node:assert/strict');
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.GCLOUD_PROJECT?.startsWith('demo-')) throw Error('Isolated Firestore Emulator required');
const admin = require('../lib/firebaseAdmin');
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
const goal = require('../lib/operationalGoals').manageOperationalGoal;
const run = (data, context) => goal.run(data, context);
const context = (uid, token = {}) => ({ auth: { uid, token } });
const input = (action = 'read', targetAmount = 200000.50, companyId = 'goal-company') => ({ action, companyId, simulatorId: 'gto', documentId: `${companyId}__gto__20261001_20261031`, ...(action === 'save' ? { targetAmount } : {}) });
const denied = async (data, actor, code = 'permission-denied') => assert.rejects(run(data, actor), error => error.code === code);
(async () => {
 const batch = db.batch();
 batch.set(db.doc('frotas/goal-company'), { ownerId: 'goal-owner' });
 batch.set(db.doc('frotas/goal-other'), { ownerId: 'goal-other-owner' });
 for (const [uid, roles, status] of [['goal-admin',['admin'],'active'],['goal-member-owner',['owner'],'active'],['goal-driver',['driver'],'active'],['goal-revoked',['admin'],'inactive'],['goal-blocked',['admin'],'active']]) {
   batch.set(db.collection('companyMembers').doc(), { userId: uid, companyId: 'goal-company', roles, status });
 }
 for(const uid of ['goal-owner','goal-other-owner','goal-admin','goal-member-owner','goal-driver','goal-revoked','goal-stranger']) batch.set(db.doc('users/'+uid),{status:'active',accountStatus:'active'});
 batch.set(db.doc('users/goal-blocked'), { status: 'blocked' });
 batch.set(db.doc('users/goal-revoked'), { companyId:'goal-company', roles:['admin'], status:'active' });
 batch.set(db.doc('simulator_members/goal-revoked_goal-company'), { userId:'goal-revoked', companyId:'goal-company', roles:['admin'], status:'active' });
 batch.set(db.doc('users/goal-legacy'), { companyId:'goal-company', role:'admin', status:'active' });
 await batch.commit();
 const owner = context('goal-owner'), manager = context('goal-admin');
 assert.equal((await run(input(), owner)).exists, false);
 const saved = await run(input('save'), manager);
 assert.equal(saved.targetAmount, 200000.50);
 assert.equal(saved.periodKey, 'range:2026-10-01:2026-10-31');
 assert.equal((await run(input(), manager)).targetAmount, 200000.50);
 const { initializeTestEnvironment, assertFails } = require('@firebase/rules-unit-testing');
 const client = require('firebase/firestore');
 const ruleEnvironment = await initializeTestEnvironment({ projectId:process.env.GCLOUD_PROJECT });
 await assertFails(client.getDoc(client.doc(ruleEnvironment.authenticatedContext('goal-admin').firestore(),'operationalGoals',input().documentId)));
 await ruleEnvironment.cleanup();
 const ref = db.doc('operationalGoals/' + input().documentId), before = (await ref.get()).updateTime;
 await run(input('save'), manager);
 assert.equal((await ref.get()).updateTime.toMillis(), before.toMillis(), 'Identical retry performs no write');
 await run(input('save',250000), context('goal-member-owner'));
 await denied(input('save',260000), context('goal-legacy'));
 await db.doc('company_access/goal-company/members/goal-admin').set({status:'removed',revokedAt:admin.firestore.Timestamp.now()});
 await denied(input(),manager);await denied(input('save'),manager);await db.doc('company_access/goal-company/members/goal-admin').delete();
 await db.doc('users/goal-admin').update({accountStatus:'suspended'});await denied(input(),manager);await db.doc('users/goal-admin').update({accountStatus:'active'});
 await db.doc('frotas/goal-company').update({deleted:true});await denied(input(),manager);await db.doc('frotas/goal-company').update({deleted:false});
 for (const uid of ['goal-driver','goal-revoked','goal-blocked','goal-other-owner','goal-stranger']) {
   await denied(input(), context(uid)); await denied(input('save'), context(uid));
 }
 await denied(input(), {}, 'unauthenticated');
 await denied({...input(),uid:'goal-owner',roles:['admin'],memberships:[{roles:['admin'],status:'active'}]},context('goal-stranger'));
 await denied(input('save',1,'goal-other'), manager);
 for (const data of [{...input(),documentId:'goal-other__gto__20261001_20261031'}, {...input(),documentId:'goal-company__gto__20260230_20260301'}, {...input(),documentId:'goal-company__gto__20261031_20261001'}, ...[0,-1,NaN,1e15+1,'1.000,00'].map(targetAmount=>input('save',targetAmount))]) await denied(data, owner, 'invalid-argument');
 await ref.set({companyId:'goal-other',simulatorId:'gto',periodKey:'range:2026-10-01:2026-10-31',currency:'BRL',targetAmount:1});
 await denied(input(),owner,'failed-precondition');
 console.log('OPERATIONAL_GOALS_489_EMULATOR_PASS canonical random-ID memberships without derived index; legacy-only roles denied; revocation tombstone, accountStatus, archived company, isolation, amounts, dates, real persistence and idempotent retry');
})().then(async()=>{await db.terminate();}).catch(error=>{console.error(error);process.exit(1);});
