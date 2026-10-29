import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
const project = 'demo-nvu-v36-4-staging';
assert.equal(process.env.GCLOUD_PROJECT, project);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8085');
const require = createRequire(path.resolve('functions/package.json'));
const admin = require(path.resolve('functions/lib/firebaseAdmin.js'));
if (!admin.apps.length) admin.initializeApp({ projectId: project });
const db = admin.firestore();
const { publicUserProfile, refreshPublicUser, readPrivateUserProfiles } = require(path.resolve('functions/lib/userProfiles.js'));
const env = await initializeTestEnvironment({ projectId: project, firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') } });
const checks: string[] = [];
const run = async (name: string, fn: () => Promise<void>) => { await fn(); checks.push(name); console.log('PASS', name); };
const client = (uid: string, extra: any = {}) => env.authenticatedContext(uid, { email: uid + '@example.test', email_verified: true, ...extra }).firestore();
const actor = (uid: string, extra: any = {}) => ({ auth: { uid, token: { email: uid + '@example.test', email_verified: true, auth_time: Math.ceil(Date.now() / 1000), ...extra } } });
const a = 'qa-sec-a', b = 'qa-sec-b', owner = 'qa-sec-owner', senior = 'qa-sec-senior', company = 'qa-sec-company';
const denied = (task: Promise<any>) => assert.rejects(task, (e: any) => e.code === 'permission-denied');
try {
 for (const uid of [a,b,owner,senior,'qa-sec-first']) {
   try { await admin.auth().createUser({ uid, email: uid+'@example.test', emailVerified: true, password: 'qa-only-password' }); }
   catch (e: any) { if (e.code !== 'auth/uid-already-exists') throw e; }
   if (uid !== 'qa-sec-first') await db.doc('users/'+uid).set({ name: uid, email: uid+'@example.test', status: 'active', roles: ['driver'], role: 'driver', whatsapp: '11900000000', password: 'synthetic-secret', privateSetting: 'never-public' });
 }
 await db.doc('frotas/'+company).set({ companyName:'QA Security',ownerId:owner,userId:owner,status:'active' });
 await db.doc(`company_access/${company}/members/${a}`).set({status:'active',roles:['driver']});
 await run('Only verified Senior can create/update/delete simulator catalog; updates keep valid schema', async () => {
   await db.doc('simulators/qa-sec').set({name:'QA',active:true});
   for (const task of [() => setDoc(doc(client(a),'simulators','qa-sec-new'),{name:'X',active:true}), () => updateDoc(doc(client(a),'simulators','qa-sec'),{active:false}), () => deleteDoc(doc(client(a),'simulators','qa-sec'))]) await assertFails(task());
   await assertSucceeds(setDoc(doc(client(senior,{senior:true}),'simulators','qa-sec-new'),{name:'QA',active:true}));
   await assertFails(updateDoc(doc(client(senior,{senior:true}),'simulators','qa-sec-new'),{name:'X'.repeat(121)}));
   await assertFails(setDoc(doc(client(senior,{senior:true}),'simulators','qa-sec-new'),{active:true}));
 });
 await run('Client cannot steal, forge or delete push ownership; own association stays readable', async () => {
   await db.doc('userDevices/qa-sec-device').set({userId:a,token:'synthetic'});
   await assertFails(updateDoc(doc(client(b),'userDevices','qa-sec-device'),{userId:b}));
   await assertFails(setDoc(doc(client(b),'userDevices','qa-sec-forged'),{userId:a,token:'synthetic'}));
   await assertFails(deleteDoc(doc(client(a),'userDevices','qa-sec-device')));
   await assertSucceeds(getDoc(doc(client(a),'userDevices','qa-sec-device')));
   await assertFails(getDoc(doc(client(b),'userDevices','qa-sec-device')));
 });
 await run('Private profile is owner-readable only, including against collection listing and Senior direct reads', async () => {
   await assertSucceeds(getDoc(doc(client(a),'users',a)));
   await assertFails(getDoc(doc(client(b),'users',a)));
   await assertFails(getDoc(doc(client(senior,{senior:true}),'users',a)));
   await assertFails(getDocs(collection(client(a),'users')));
   await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'users',a)));
 });
 await run('Public projection uses a whitelist and is authenticated/read-only', async () => {
   const input = (await db.doc('users/'+a).get()).data();
   const view = publicUserProfile(a,{...input,profilePhotoURL:'https://example.test/a.png',profilePhotoSource:'user_edit',memberships:{secret:{permissions:['all']}}});
   assert.equal(view.name,a);assert.equal(view.email,undefined);assert.equal(view.whatsapp,undefined);assert.equal(view.password,undefined);assert.equal(view.memberships,undefined);assert.equal(view.privateSetting,undefined);
   await refreshPublicUser(db,a);
   await assertSucceeds(getDoc(doc(client(b),'public_users',a)));
   await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'public_users',a)));
   await assertFails(setDoc(doc(client(a),'public_users',a),{name:'Forged'}));
 });
 await run('Public identity recovers exact approved NVU form without leaking private fields or foreign/revoked photos', async () => {
   const who='qa-sec-linked-photo', applicationId='qa-sec-photo-form';
   await db.doc('users/'+who).set({name:'Provider',status:'active',approvedIdentityVersion:2,approvedIdentityApplicationId:applicationId,profilePhotoURL:'https://lh3.googleusercontent.com/provider'});
   await db.doc('recruitment_applications/'+applicationId).set({userId:who,status:'approved',fullName:'Cadastro QA',applicationPhotoURL:'https://fixture.invalid/nvu.jpg',whatsapp:'private-contact'});
   await refreshPublicUser(db,who);let projection=(await db.doc('public_users/'+who).get()).data();
   assert.equal(projection.profilePhotoURL,'https://fixture.invalid/nvu.jpg');assert.equal(projection.whatsapp,undefined);
   await db.doc('users/'+who).update({profilePhotoSource:'user_edit',profilePhotoURL:''});await refreshPublicUser(db,who);assert.equal((await db.doc('public_users/'+who).get()).get('profilePhotoURL'),'');
   await db.doc('users/'+who).update({profilePhotoSource:'legacy'});await db.doc('recruitment_applications/'+applicationId).update({userId:b});await refreshPublicUser(db,who);assert.equal((await db.doc('public_users/'+who).get()).get('profilePhotoURL'),'');
   await db.doc('recruitment_applications/'+applicationId).update({userId:who,accessRevokedAt:admin.firestore.Timestamp.now()});await refreshPublicUser(db,who);assert.equal((await db.doc('public_users/'+who).get()).get('profilePhotoURL'),'');
   await db.doc('recruitment_applications/'+applicationId).update({accessRevokedAt:admin.firestore.FieldValue.delete(),type:'company_registration'});await refreshPublicUser(db,who);assert.equal((await db.doc('public_users/'+who).get()).get('profilePhotoURL'),'');
 });
 await run('Projection re-reads current edits and deletes stale public data after account deletion', async () => {
   await db.doc('users/'+a).update({name:'Edited QA',profileNameSource:'user_edit'});await refreshPublicUser(db,a);assert.equal((await db.doc('public_users/'+a).get()).get('name'),'Edited QA');
   await db.doc('users/'+a).update({deleted:true});await refreshPublicUser(db,a);await refreshPublicUser(db,a);assert.equal((await db.doc('public_users/'+a).get()).exists,false);
   await db.doc('users/'+a).update({deleted:false});await refreshPublicUser(db,a);
 });
 await run('A pending applicant cannot bootstrap fleet, activate account or assign admin membership atomically', async () => {
   const c=client(b),batch=writeBatch(c);
   batch.set(doc(c,'frotas','qa-sec-self-fleet'),{companyName:'Bypass',ownerId:b,userId:b,status:'active'});
   batch.update(doc(c,'users',b),{companyId:'qa-sec-self-fleet',roles:['admin','driver'],role:'admin',status:'active'});
   batch.set(doc(c,'companyMembers','qa-sec-self-member'),{companyId:'qa-sec-self-fleet',userId:b,status:'active',roles:['admin']});
   await assertFails(batch.commit());assert.equal((await db.doc('frotas/qa-sec-self-fleet').get()).exists,false);
   await assertFails(setDoc(doc(client('qa-sec-uncreated'),'users','qa-sec-uncreated'),{name:'X',role:'driver',status:'active',companyId:company}));
   await assertFails(updateDoc(doc(client(a),'users',a),{roles:['senior']}));
 });
 await run('Senior-approved fleet creation remains allowed and cannot be performed with a forged user role', async () => {
   await assertSucceeds(setDoc(doc(client(senior,{senior:true}),'frotas','qa-sec-approved'),{companyName:'Approved QA',ownerId:b,userId:b,status:'active'}));
   await assertFails(setDoc(doc(client(a),'frotas','qa-sec-role-forged'),{companyName:'No',ownerId:a,userId:a,status:'active'}));
 });
 await run('Only recipient can acknowledge popup/read; message, ownership and scope remain immutable', async () => {
   for(const source of ['notifications','notificacoes']) {
     await db.doc(`${source}/qa-sec-popup`).set({userId:a,companyId:company,type:'SYSTEM',read:false,lida:false,createdAt:admin.firestore.Timestamp.now()});
     await assertSucceeds(updateDoc(doc(client(a),source,'qa-sec-popup'),{read:true,lida:true,popupShownAt:serverTimestamp(),popupShownAtIso:new Date().toISOString()}));
     await assertFails(updateDoc(doc(client(b),source,'qa-sec-popup'),{read:true}));
     await assertFails(updateDoc(doc(client(a),source,'qa-sec-popup'),{userId:b}));
     await assertFails(updateDoc(doc(client(a),source,'qa-sec-popup'),{type:'RH_APPLICATION'}));
   }
 });
 await run('Unverified or user-editable e-mail cannot expose another applicant; UID and verified e-mail remain usable', async () => {
   await db.doc('recruitment_applications/qa-sec-mail').set({type:'company_registration',userId:'qa-sec-another',email:b+'@example.test',status:'pending'});
   await db.doc('users/'+a).update({email:b+'@example.test'});
   await assertFails(getDoc(doc(client(a),'recruitment_applications','qa-sec-mail')));
   await assertFails(getDoc(doc(client(b,{email_verified:false}),'recruitment_applications','qa-sec-mail')));
   await assertSucceeds(getDoc(doc(client(b),'recruitment_applications','qa-sec-mail')));
   await db.doc('recruitment_applications/qa-sec-uid').set({type:'company_registration',userId:b,email:'other@example.test',status:'pending'});
   await assertSucceeds(getDoc(doc(client(b,{email_verified:false}),'recruitment_applications','qa-sec-uid')));
   await assertFails(updateDoc(doc(client(b),'recruitment_applications','qa-sec-mail'),{status:'approved'}));
   await db.doc('users/'+a).update({email:a+'@example.test'});
 });
 await run('Private callable checks live authority, tenant scope and field exposure', async () => {
   await denied(readPrivateUserProfiles.run({ids:[a]},actor(b)));
   const own=await readPrivateUserProfiles.run({ids:[a]},actor(a));assert.equal(own.profiles[0].email,a+'@example.test');
   const managed=await readPrivateUserProfiles.run({ids:[a],companyId:company},actor(owner));assert.equal(managed.profiles[0].whatsapp,'11900000000');assert.equal(managed.profiles[0].password,undefined);assert.equal(managed.profiles[0].privateSetting,undefined);
   await denied(readPrivateUserProfiles.run({ids:[b],companyId:company},actor(owner)));
   await db.doc('recruitment_applications/qa-sec-contact-request').set({userId:b,companyId:company,status:'pending',type:'driver_application'});
   const candidate=await readPrivateUserProfiles.run({ids:[b],companyId:company},actor(owner));assert.equal(candidate.profiles[0].email,b+'@example.test');assert.equal(candidate.profiles[0].privateSetting,undefined);
   await db.doc('recruitment_applications/qa-sec-contact-request').delete();
   await denied(readPrivateUserProfiles.run({email:a+'@example.test'},actor(b,{email:a+'@example.test',email_verified:false})));
   const approved=await readPrivateUserProfiles.run({ids:[a]},actor(senior,{senior:true}));assert.equal(approved.profiles[0].email,a+'@example.test');
   await db.doc('users/'+senior).update({accountStatus:'suspended'});await denied(readPrivateUserProfiles.run({ids:[a]},actor(senior,{senior:true})));await db.doc('users/'+senior).update({accountStatus:'active'});
 });
 await run('First verified login recovers only its own legacy e-mail without requiring a preexisting profile', async () => {
   await db.doc('users/qa-sec-legacy').set({email:'qa-sec-first@example.test',name:'First QA',status:'pending'});
   const first=await readPrivateUserProfiles.run({email:'qa-sec-first@example.test'},actor('qa-sec-first'));assert.equal(first.profiles.length,1);assert.equal(first.profiles[0].name,'First QA');
 });
 await run('Ordered notification query returns recent records beyond the old arbitrary limit and rejects foreign scope', async () => {
   const batch=db.batch();for(let n=0;n<205;n++)batch.set(db.doc('notifications/qa-sec-order-'+String(n).padStart(3,'0')),{userId:a,read:false,createdAt:admin.firestore.Timestamp.fromMillis(Date.now()+n*1000)});await batch.commit();
   const rows=await getDocs(query(collection(client(a),'notifications'),where('userId','==',a),where('read','==',false),orderBy('createdAt','desc'),limit(200)));
   assert.equal(rows.docs[0].id,'qa-sec-order-204');assert.equal(rows.size,200);
   await assertFails(getDocs(query(collection(client(b),'notifications'),where('userId','==',a),orderBy('createdAt','desc'),limit(200))));
 });
 fs.writeFileSync('qa/results/emulators/security.json',JSON.stringify({project,checks,method:'Real Firestore rules and transactions, compiled backend, synthetic Auth users; no production reads or writes.'},null,2));
 console.log('QA_SECURITY_PASS',checks.length);
} finally { await env.cleanup();await db.terminate(); }
