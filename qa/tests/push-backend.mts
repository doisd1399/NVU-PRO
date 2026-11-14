import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const project='demo-nvu-v36-4-staging';assert.equal(process.env.GCLOUD_PROJECT,project);assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8085');
const require=createRequire(path.resolve('functions/package.json')),admin=require(path.resolve('functions/lib/firebaseAdmin.js'));if(!admin.apps.length)admin.initializeApp({projectId:project,storageBucket:project+'.appspot.com'});
const db=admin.firestore(),{registerPushDevice,revokePushDevice,pushTokenHash}=require(path.resolve('functions/lib/pushDevices.js')),{createPushDispatcher}=require(path.resolve('functions/lib/pushDispatch.js'));
const triggers=require(path.resolve('functions/lib/index.js')),checks:string[]=[];
const actor=(uid:string)=>({auth:{uid,token:{auth_time:100}}}),request=(token:string,revision:number)=>({token,revision,protocolVersion:2,platform:'android',companyId:'push-company',activeProfile:'driver'});
const success=(tokens:string[])=>({successCount:tokens.length,failureCount:0,responses:tokens.map(()=>({success:true,messageId:'synthetic'}))});
const message={userId:'push-a',companyId:'push-company',title:'Aviso fictício',message:'Mensagem sintética',targetProfile:'driver'};
const device=(id:string,token=id,userId='push-a')=>db.doc('userDevices/'+id).set({userId,token,revision:1});
const clear=async()=>{for(const name of ['userDevices','pushTokenOwners','pushDispatches'])await db.recursiveDelete(db.collection(name));};
const test=async(name:string,run:()=>Promise<void>)=>{await clear();await run();checks.push(name);console.log('PASS',name);};
let time=Date.now();
try{
 await test('Callables reject unauthenticated, malformed and oversized input',async()=>{
  await assert.rejects(registerPushDevice.run(request('token',1),{}),(e:any)=>e.code==='unauthenticated');
  for(const data of [request('x'.repeat(4097),1),request('token',-1),{...request('token',1),extra:true},{...request('token',1),revision:'1'}])await assert.rejects(registerPushDevice.run(data,actor('push-a')),(e:any)=>e.code==='invalid-argument');
 });
 await test('New association fences an older registration and another account cannot revoke it',async()=>{
  const token='shared-token';await registerPushDevice.run(request(token,100),actor('push-a'));await registerPushDevice.run(request(token,300),actor('push-b'));
  assert.equal((await registerPushDevice.run(request(token,200),actor('push-a'))).stale,true);await revokePushDevice.run({tokenHash:pushTokenHash(token),revision:400},actor('push-a'));
  const rows=await db.collection('userDevices').where('token','==',token).get();assert.equal(rows.size,1);assert.equal(rows.docs[0].get('userId'),'push-b');
 });
 await test('Logout tombstone prevents delayed registration and legacy overwrite but allows a newer login',async()=>{
  const token='tombstone';await revokePushDevice.run({tokenHash:pushTokenHash(token),revision:200},actor('push-a'));
  assert.equal((await registerPushDevice.run(request(token,100),actor('push-a'))).stale,true);assert.equal((await db.collection('userDevices').get()).size,0);
  assert.equal((await registerPushDevice.run(request(token,300),actor('push-b'))).success,true);assert.equal((await registerPushDevice.run({token,platform:'android'},actor('push-a'))).obsoleteClient,true);
 });
 await test('Logout removes owned pre-v2 rows without deleting another device or account',async()=>{
  await device('legacy-own','same');await device('legacy-other-device','other');await device('legacy-foreign','same','push-b');
  await revokePushDevice.run({tokenHash:pushTokenHash('same'),revision:100},actor('push-a'));assert.equal((await db.doc('userDevices/legacy-own').get()).exists,false);assert((await db.doc('userDevices/legacy-other-device').get()).exists);assert((await db.doc('userDevices/legacy-foreign').get()).exists);
 });
 await test('Partial transient response retries only the failed token and completion deduplicates replay',async()=>{
  await device('a','token-a');await device('b','token-b');const calls:any[]=[];
  const dispatch=createPushDispatcher(db,async(value:any)=>{calls.push(value);if(calls.length===1)return{successCount:1,failureCount:1,responses:value.tokens.map((token:string)=>token==='token-a'?{success:true}:{success:false,error:{code:'messaging/server-unavailable'}})};return success(value.tokens);},()=>time);
  await assert.rejects(dispatch('notifications','partial',message),/TRANSIENT/);assert.equal((await db.doc('pushDispatches/partial').get()).get('status'),'retryable');
  time+=11000;await dispatch('notifications','partial',message);assert.deepEqual(calls[1].tokens,['token-b']);assert.equal(calls[0].android.notification.tag,calls[1].android.notification.tag);assert.equal(calls[0].data.sourceCollection,'notifications');
  await dispatch('notifications','partial',message);assert.equal(calls.length,2);assert.equal((await db.doc('pushDispatches/partial').get()).get('successCount'),2);
 });
 await test('Expired processing lease recovers; active lease is busy and very old dispatch expires',async()=>{
  await device('a');const calls:any[]=[];const dispatch=createPushDispatcher(db,async(v:any)=>{calls.push(v);return success(v.tokens);},()=>time);
  await db.doc('pushDispatches/abandoned').set({status:'processing',createdAt:admin.firestore.Timestamp.fromMillis(time-86400000)});await dispatch('notifications','abandoned',message);assert.equal(calls.length,1);
  await db.doc('pushDispatches/active').set({status:'processing',createdAt:admin.firestore.Timestamp.fromMillis(time),leaseExpiresAt:admin.firestore.Timestamp.fromMillis(time+60000)});await assert.rejects(dispatch('notifications','active',message),/busy/);assert.equal(calls.length,1);
  await db.doc('pushDispatches/old').set({status:'processing',createdAt:admin.firestore.Timestamp.fromMillis(time-8*86400000)});await dispatch('notifications','old',message);assert.equal((await db.doc('pushDispatches/old').get()).get('status'),'expired');assert.equal(calls.length,1);
 });
 await test('An invalid-token response cannot delete the token newly associated with a different account',async()=>{
  const token='moved-token';await registerPushDevice.run(request(token,100),actor('push-a'));
  const dispatch=createPushDispatcher(db,async()=>{await registerPushDevice.run(request(token,200),actor('push-b'));return{successCount:0,failureCount:1,responses:[{success:false,error:{code:'messaging/registration-token-not-registered'}}]};},()=>time);
  await dispatch('notifications','late-invalid',message);const rows=await db.collection('userDevices').where('token','==',token).get();assert.equal(rows.size,1);assert.equal(rows.docs[0].get('userId'),'push-b');
 });
 await test('201 recipients preserve the first successful batch when the last recipient needs retry',async()=>{
  const batch=db.batch();for(let i=0;i<201;i++)batch.set(db.doc('userDevices/batch-'+String(i).padStart(3,'0')),{userId:'push-a',token:'batch-token-'+i,revision:1});await batch.commit();const sizes:number[]=[];let fail=true;
  const dispatch=createPushDispatcher(db,async(v:any)=>{sizes.push(v.tokens.length);if(v.tokens.length===1&&fail){fail=false;return{successCount:0,failureCount:1,responses:[{success:false,error:{code:'messaging/quota-exceeded'}}]};}return success(v.tokens);},()=>time);
  await assert.rejects(dispatch('notifications','batch',message),/TRANSIENT/);time+=11000;await dispatch('notifications','batch',message);assert.deepEqual(sizes,[200,1,1]);assert.equal((await db.doc('pushDispatches/batch').get()).get('successCount'),201);
 });
 await test('A whole transport failure remains retryable and confirms only after recovery',async()=>{
  await device('transport');let fail=true,calls=0;
  const dispatch=createPushDispatcher(db,async(v:any)=>{calls++;if(fail)throw Error('synthetic transport unavailable');return success(v.tokens);},()=>time);
  await assert.rejects(dispatch('notifications','transport',message),/unavailable/);assert.equal((await db.doc('pushDispatches/transport').get()).get('status'),'retryable');
  fail=false;time+=11000;await dispatch('notifications','transport',message);assert.equal(calls,2);assert.equal((await db.doc('pushDispatches/transport').get()).get('status'),'completed');
 });
 await test('Invalid legacy duplicates cannot overflow the transaction write limit',async()=>{
  const batch=db.batch();for(let i=0;i<200;i++)for(let copy=0;copy<2;copy++)batch.set(db.doc('userDevices/duplicate-'+i+'-'+copy),{userId:'push-a',token:'duplicate-token-'+i,revision:1});await batch.commit();
  const dispatch=createPushDispatcher(db,async(v:any)=>({successCount:0,failureCount:v.tokens.length,responses:v.tokens.map(()=>({success:false,error:{code:'messaging/registration-token-not-registered'}}))}),()=>time);
  await dispatch('notifications','duplicates',message);assert.equal((await db.doc('pushDispatches/duplicates').get()).get('status'),'completed_with_failures');assert.equal((await db.collection('pushDispatches/duplicates/recipients').get()).size,200);assert.equal((await db.collection('userDevices').get()).size,150);
 });
 await test('Both existing notification onCreate triggers enable platform retry',async()=>{for(const name of ['pushOnNotificationCreated','pushOnLegacyNotificationCreated'])assert.deepEqual(triggers[name].__trigger.failurePolicy,{retry:{}});});
 fs.mkdirSync('qa/results/emulators',{recursive:true});fs.writeFileSync('qa/results/emulators/push-backend.json',JSON.stringify({checks,project,productionAccess:false,realPushSent:false,method:'Compiled callable/dispatcher code, real Firestore emulator transactions and controlled FCM transport.'},null,2)+'\n');console.log('PUSH_BACKEND_PASS',checks.length);
}finally{await db.terminate();}
