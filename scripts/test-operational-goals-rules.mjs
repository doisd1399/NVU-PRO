import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Firestore Emulator required');
for (const file of ['firestore.rules','production-firestore.rules','production-firestore-rules-postdeploy.rules']) {
 const environment = await initializeTestEnvironment({ projectId: 'demo-nvu-v36-4-staging', firestore: { rules: fs.readFileSync(file, 'utf8') } });
 try {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db,'frotas','company-1'),{userId:'manager-1',ownerId:'manager-1'});
    await setDoc(doc(db,'frotas','company-2'),{userId:'manager-2',ownerId:'manager-2'});
    for (const [id,roles,status] of [['admin-member',['admin'],'active'],['owner-member',['owner'],'active'],['inactive',['admin'],'inactive'],['driver-1',['driver'],'active']]) {
      await setDoc(doc(db,'simulator_members',id+'_company-1'),{userId:id,companyId:'company-1',roles,status});
    }
    await setDoc(doc(db,'users','legacy'),{companyId:'company-1',role:'admin',status:'active'});
    await setDoc(doc(db,'users','foreign-admin'),{companyId:'company-2',roles:['admin'],status:'active'});
    await setDoc(doc(db,'operationalGoals','company-1__simulator-a__corrupt'),{companyId:'company-2',simulatorId:'simulator-a',targetAmount:1});
  });
  const db = id => environment.authenticatedContext(id).firestore();
  const manager = db('manager-1'), driver = db('driver-1'), foreign = db('manager-2');
  const goalId='company-1__simulator-a__20261001_20261031';
  const goal = doc(manager,'operationalGoals',goalId);
  const record={companyId:'company-1',simulatorId:'simulator-a',periodKey:'range:2026-10-01:2026-10-31',targetAmount:200000,currency:'BRL',updatedBy:'manager-1',updatedAt:serverTimestamp()};
  await assertSucceeds(getDoc(goal));
  await assertSucceeds(setDoc(goal,record));
  await assertSucceeds(getDoc(goal));
  for (const id of ['admin-member','owner-member','legacy']) {
    await assertSucceeds(getDoc(doc(db(id),'operationalGoals',goalId)));
    await assertSucceeds(updateDoc(doc(db(id),'operationalGoals',goalId),{targetAmount:250000,updatedBy:id,updatedAt:serverTimestamp()}));
  }
  for (const context of [driver,foreign,db('inactive'),db('foreign-admin'),environment.unauthenticatedContext().firestore()]) {
    await assertFails(getDoc(doc(context,'operationalGoals',goalId)));
    await assertFails(getDoc(doc(context,'operationalGoals','company-1__simulator-a__missing')));
    await assertFails(updateDoc(doc(context,'operationalGoals',goalId),{targetAmount:300000,updatedBy:'driver-1',updatedAt:serverTimestamp()}));
  }
  await assertSucceeds(updateDoc(goal,{targetAmount:250000,updatedBy:'manager-1',updatedAt:serverTimestamp()}));
  await assertFails(getDocs(collection(manager,'operationalGoals')));
  await assertFails(getDoc(doc(manager,'operationalGoals','company-1__simulator-a__corrupt')));
  await assertFails(setDoc(doc(manager,'operationalGoals','company-2__simulator-a__20261001_20261031'),record));
  await assertFails(setDoc(doc(manager,'operationalGoals','company-1__simulator-b__20261001_20261031'),record));
  await assertFails(setDoc(doc(manager,'operationalGoals','malformed'),record));
  for (const update of [{targetAmount:-1},{targetAmount:0},{currency:'EUR'},{companyId:'company-2'},{simulatorId:'simulator-b'},{periodKey:'changed'},{updatedBy:'profile-alias'},{extra:'not-allowed'}]) {
    await assertFails(updateDoc(goal,{updatedBy:'manager-1',updatedAt:serverTimestamp(),...update}));
  }
  await assertFails(setDoc(doc(manager,'operationalGoals','company-1__simulator-a__new'),{...record,extra:'not-allowed'}));
  console.log(`PASS ${file}: scoped owners/admins/legacy managers; no public, driver, inactive or cross-company access; immutable identity and valid goals.`);
 } finally { await environment.cleanup(); }
}
