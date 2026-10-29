import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {ref,uploadBytes,getDownloadURL} from 'firebase/storage';
const projectId='demo-nvu-v36-4-staging';
assert.equal(process.env.GCLOUD_PROJECT,projectId);
for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST'])assert.match(process.env[key]||'',/^127\.0\.0\.1:\d+$/);
const require=createRequire(new URL('../functions/package.json',import.meta.url)),admin=require(path.resolve('functions/lib/firebaseAdmin.js'));
admin.initializeApp({projectId,storageBucket:`${projectId}.appspot.com`});const db=admin.firestore();
const {executeOperationalCommand}=require('./lib/operationalCommands');
const {manageFleetMembership}=require('./lib/fleetMembership');
const {getOperationalQueues,configureOperationalQueues}=require('./lib/operationalQueues');
const {registerGtoProReceipt:pro}=require('./lib/registerGtoProReceipt');
const {registerCanonicalSimpleTrip:simple}=require('./lib/registerCanonicalSimpleTrip');
const {completeCanonicalOperation:complete}=require('./lib/completeCanonicalOperation');
const {proReceiptEventKey}=require('./lib/tripReceiptPolicy');
const env=await initializeTestEnvironment({projectId,firestore:{rules:await fs.readFile('firestore.rules','utf8')},storage:{rules:await fs.readFile('storage.rules','utf8')}});
const owner='flow-owner-503',driver='flow-driver-503',other='flow-other-503',companyId='flow-company-503',contractId='flow-contract-503',vehicleId='flow-vehicle-503';
const actor=uid=>({auth:{uid,token:{}}});let seq=0;const checks=[];
const pass=name=>{checks.push(name);console.log('PASS',name)};
async function seed(total=3){await env.clearFirestore();await env.clearStorage();const batch=db.batch();
 batch.set(db.doc(`frotas/${companyId}`),{companyName:'Empresa correta',ownerId:owner,userId:owner,status:'active',simulatorId:'gto',operationalCommandVersion:1});
 for(const uid of [owner,driver,other]){const roles=uid===owner?['owner','admin','driver']:['driver'];batch.set(db.doc(`users/${uid}`),{name:uid,companyId,email:`${uid}@example.test`,status:'active',role:uid===owner?'admin':'driver',roles});batch.set(db.doc(`companyMembers/${uid}_${companyId}`),{userId:uid,companyId,roles,status:'active'});batch.set(db.doc(`company_access/${companyId}/members/${uid}`),{userId:uid,companyId,roles,status:'active'});}
 batch.set(db.doc(`contratos/${contractId}`),{companyId,name:'Contrato',simulatorId:'gto',simulator:'GTO',mode:'simple',totalDeliveries:total,deadlineDays:3,status:'active'});batch.set(db.doc(`veiculos/${vehicleId}`),{companyId,name:'Veículo',status:'available'});await batch.commit();
 const assigned=await executeOperationalCommand(db,{action:'assign',companyId,contractId,vehicleId,trailerId:null,driverId:driver,requestId:`assign-${++seq}`},actor(owner));
 await executeOperationalCommand(db,{action:'start',companyId,jobId:assigned.jobId,requestId:`start-${++seq}`},actor(driver));return assigned.jobId;}
const capture=(jobId,attemptId=`attempt-flow-${++seq}`,capturedAt=Date.now()-3000)=>({driverId:driver,companyId,contractId,jobId,attemptId,capturedAt,contextEpoch:'global-truck:503:abcdef',origin:'Cidade A',destination:'Cidade B',amountCents:123400,currency:'BRL',bonusEvidence:'OFFER_ONLY',receiptText:'Concluído\nValor a receber: R$ 1.234,00\nDobrar valor (ADS)',simulatorKey:'global-truck',simulatorCode:'GTO',packageId:'com.stargamesapps.gto'});
const web=(c,id=`simple_${driver}_web_${++seq}`)=>({trip:{tripId:id,idempotencyKey:id,driverId:driver,companyId,contractId,jobId:c.jobId,origem:c.origin,destino:c.destination,valor:c.amountCents/100,valorCents:c.amountCents,source:'simple_auto',simpleAutomation:true,simulatorKey:'global-truck',simulatorCode:'GTO',simpleReceiptCurrency:'BRL',simpleReceiptResultScreenConfirmed:true,simpleReceiptBonusEvidence:'OFFER_ONLY',receiptText:c.receiptText,simpleReceiptCapturedAt:c.capturedAt,simpleReceiptCaptureAttemptId:`web-${c.attemptId}`,simpleReceiptCaptureContextEpoch:c.contextEpoch}});
const ledger=async jobId=>{const [history,slots,job]=await Promise.all([db.collection('historico_viagens').where('jobId','==',jobId).get(),db.collection('trip_operation_slots').where('jobId','==',jobId).get(),db.doc(`trabalhos/${jobId}`).get()]);assert.equal(history.size,slots.size);assert.equal(job.get('progress'),history.size);return history.size};
async function receipt(name,uid=driver){const bytes=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZK0AAAAASUVORK5CYII=','base64'));const storage=env.authenticatedContext(uid).storage(`gs://${projectId}.appspot.com`);const target=ref(storage,`trip-receipts/${companyId}/${uid}/${name}.png`);await uploadBytes(target,bytes,{contentType:'image/png',customMetadata:{uploadedBy:uid}});const raw=new URL(await getDownloadURL(target));return `https://firebasestorage.googleapis.com${raw.pathname}${raw.search}`;}
const print=async(jobId,id)=>({trip:{tripId:id,idempotencyKey:id,driverId:driver,companyId,contractId,jobId,origem:'Cidade A',destino:'Cidade B',valor:1234,valorCents:123400,source:'PRINT_PRO_REGISTRATION',simulatorCode:'GTO',gtoEntryMode:'print',gtoReceiptAnalyzed:true,gtoRewardedAdDetected:false,imageHash:`hash-${id}`,comprovanteUrl:await receipt(id),receiptText:'Concluído\nValor a receber: R$ 1.234,00\nDobrar valor (ADS)'}});
try{
 {
 const jobId=await seed(),c=capture(jobId);const first=await pro.run(c,actor(driver));const recovered=await simple.run(web(c),actor(driver));assert.equal(recovered.tripId,first.tripId);assert.equal(recovered.receiptEventDuplicate,true);assert.equal(await ledger(jobId),1);
 pass('Native Pro -> Web replay recognizes the same captured event without an extra slot.');
 const key=proReceiptEventKey([driver,companyId,contractId,jobId,'global-truck',c.contextEpoch],c.capturedAt);
 const old=createHash('sha256').update(JSON.stringify([driver,jobId,companyId,contractId,c.contextEpoch,c.origin,c.destination,c.amountCents,'known','BRL'])).digest('hex');
 await db.doc(`pro_receipt_events/${key}`).update({fingerprint:old});
 assert.equal((await simple.run(web(c),actor(driver))).tripId,first.tripId);assert.equal(await ledger(jobId),1);
 pass('An event saved by the 503 native fingerprint remains replayable, with full ledger validation.');
 await assert.rejects(()=>simple.run(web({...c,amountCents:99900,receiptText:'Valor a receber: R$ 999,00'}),actor(driver)),e=>e.code==='failed-precondition');assert.equal(await ledger(jobId),1);
 pass('Changing the value of an existing capture is rejected without touching its confirmed trip.');
 }
 {
 const jobId=await seed(),c=capture(jobId);const first=await simple.run(web(c),actor(driver));const recovered=await pro.run(c,actor(driver));assert.equal(recovered.tripId,first.tripId);assert.equal(await ledger(jobId),1);
 assert.equal((await pro.run({...c,previousTripId:first.tripId},actor(driver))).tripId,first.tripId);
 pass('Web -> native Pro adoption, then a lost native ACK retry, keep one Web canonical ID.');
 const next=await pro.run({...c,attemptId:'another-real-capture',capturedAt:c.capturedAt+1000},actor(driver));assert.notEqual(next.tripId,first.tripId);assert.equal(await ledger(jobId),2);
 pass('A different capture with the same route and value is a legitimate second journey.');
 }
 {
 const jobId=await seed(),c=capture(jobId);const replies=await Promise.all(Array.from({length:6},()=>pro.run(c,actor(driver))));assert.equal(new Set(replies.map(x=>x.tripId)).size,1);assert.equal(await ledger(jobId),1);
 assert.equal((await db.doc(`historico_viagens/${replies[0].tripId}`).get()).get('empresaNome'),'Empresa correta');
 pass('Six simultaneous native retries register exactly one trip, one slot and the correct company name.');
 }
 {
 const jobId=await seed();
 const basic={tripId:'forged-manual-gto',idempotencyKey:'forged-manual-gto',driverId:driver,companyId,contractId,jobId,
 origem:'Cidade A',destino:'Cidade B',valor:1234,valorCents:123400,source:'manual',simulatorKey:'gto'};
 await assert.rejects(()=>simple.run({trip:basic},actor(driver)),e=>e.code==='invalid-argument');
 await assert.rejects(()=>simple.run({trip:{...basic,simulatorKey:'wtds'}},actor(driver)),e=>e.code==='invalid-argument');
 assert.equal(await ledger(jobId),0);
 pass('A new GTO registration cannot bypass receipt analysis by using manual source or another simulator alias.');
 }
 {
 const jobId=await seed(2),p=await print(jobId,'print-flow-1');const first=await simple.run(p,actor(driver));assert.equal(first.registered,true);assert.equal(await ledger(jobId),1);assert.equal((await simple.run(p,actor(driver))).tripId,first.tripId);
 pass('Print uses a real authorized Storage Emulator upload, verifies object metadata and replays idempotently.');
 await assert.rejects(()=>simple.run({trip:{...p.trip,tripId:'altered-amount',idempotencyKey:'altered-amount',valor:50,valorCents:5000}},actor(driver)),e=>e.code==='invalid-argument');
 await assert.rejects(()=>simple.run({trip:{...p.trip,tripId:'bonus-forged',idempotencyKey:'bonus-forged',receiptText:p.trip.receiptText+'\nValor dobrado'}},actor(driver)),e=>e.code==='invalid-argument');assert.equal(await ledger(jobId),1);
 pass('Forged Print amount and applied-bonus evidence are rejected independently of client flags.');
 await assert.rejects(()=>simple.run({trip:{...p.trip,tripId:'duplicate-image',idempotencyKey:'duplicate-image',imageHash:'changed-client-hash'}},actor(driver)),e=>e.code==='already-exists');
 const p2=await print(jobId,'print-flow-2');await simple.run(p2,actor(driver));assert.equal(await ledger(jobId),2);assert.equal((await db.doc(`trabalhos/${jobId}`).get()).get('status'),'awaiting_completion');
 pass('A Storage receipt cannot create another trip; the final distinct Print only reaches awaiting_completion.');
 const finalized=await complete.run({jobId},actor(driver));assert.equal(finalized.completed,true);assert.equal((await complete.run({jobId},actor(driver))).alreadyCompleted,true);
 const counts=await ledger(jobId);await assert.rejects(()=>pro.run(capture(jobId),actor(driver)),e=>e.code==='failed-precondition');assert.equal(await ledger(jobId),counts);
 pass('Explicit finalization is idempotent and a late new Pro receipt cannot reopen the completed operation.');
 }
 {
 const jobId=await seed(2),captures=Array.from({length:4},(_,i)=>capture(jobId,`capacity-attempt-${i}`,Date.now()-6000+i*1000));const results=await Promise.allSettled(captures.map(c=>pro.run(c,actor(driver))));assert.equal(results.filter(x=>x.status==='fulfilled').length,2);assert.equal(await ledger(jobId),2);
 pass('Concurrent different captures cannot exceed the physical operation capacity.');
 }
 {
 const jobId=await seed();await db.doc(`users/${driver}`).update({accountStatus:'suspended'});
 await assert.rejects(()=>getOperationalQueues.run({companyId,driverId:driver,kind:'driver'},actor(driver)),e=>e.code==='permission-denied');
 await assert.rejects(()=>pro.run(capture(jobId),actor(driver)),e=>e.code==='permission-denied');
 await db.doc(`users/${owner}`).update({suspension:{active:true}});
 await assert.rejects(()=>configureOperationalQueues.run({companyId,action:'saveVehicles',vehicleIds:[vehicleId],expectedRevision:0,requestId:'suspended-config'},actor(owner)),e=>e.code==='permission-denied');
 pass('Suspended users and managers are refused consistently by trip registration and queue configuration.');
 }
 {
 const jobId=await seed();await db.doc(`users/${driver}`).update({status:'inactive'});
 await assert.rejects(()=>getOperationalQueues.run({companyId,driverId:driver,kind:'driver'},actor(driver)),e=>e.code==='permission-denied');
 await assert.rejects(()=>pro.run(capture(jobId),actor(driver)),e=>e.code==='permission-denied');
 await assert.rejects(()=>receipt('inactive-receipt'),e=>e.code==='storage/unauthorized');
 pass('A legacy inactive account cannot use trip registration, queue access or Storage upload.');
 await db.doc(`users/${driver}`).update({status:'pending',companyId:'another-primary-company'});
 assert.equal((await pro.run(capture(jobId),actor(driver))).registered,true);
 await getOperationalQueues.run({companyId,driverId:driver,kind:'driver'},actor(driver));
 pass('Primary-company pending status does not revoke a different valid canonical membership.');
 }
 {
 await seed();await db.doc(`companyMembers/${driver}_${companyId}`).update({roles:['admin','driver']});await db.doc('companyMembers/legacy-duplicate-role').set({userId:driver,companyId,status:'active',roles:['admin','driver']});
 await manageFleetMembership.run({action:'set-role',companyId,targetUserId:driver,role:'driver'},actor(owner));
 const members=await db.collection('companyMembers').where('userId','==',driver).where('companyId','==',companyId).get();assert.equal(members.size,1);assert.deepEqual(members.docs[0].get('roles'),['driver']);
 await assert.rejects(()=>manageFleetMembership.run({action:'remove',companyId,targetUserId:other},actor(driver)),e=>e.code==='permission-denied');
 await manageFleetMembership.run({action:'remove',companyId,targetUserId:driver},actor(owner));
 await assert.rejects(()=>getOperationalQueues.run({companyId,driverId:driver,kind:'driver'},actor(driver)),e=>e.code==='permission-denied');
 pass('Atomic demotion removes duplicate admin authority; removed users cannot access the operational queue.');
 }
}finally{await fs.mkdir('reports',{recursive:true});await fs.writeFile('reports/audit-trip-server-regressions.json',JSON.stringify({projectId,productionAccess:false,realHandlers:true,fixtureAuthentication:true,passed:checks.length,checks},null,2)+'\n');await env.cleanup();await Promise.all(admin.apps.map(app=>app.delete()));}
console.log('AUDIT_TRIP_SERVER_PASS',checks.length);
