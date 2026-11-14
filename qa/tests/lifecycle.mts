import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {initializeTestEnvironment, assertFails, assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,getDoc} from 'firebase/firestore';
import {ref,uploadBytes} from 'firebase/storage';
import {createEmulatorReceipt} from '../../scripts/helpers/emulatorReceipt';
const project='demo-nvu-v36-4-staging';
assert.equal(process.env.GCLOUD_PROJECT,project);
for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST'])assert.match(process.env[key]||'',/^127\.0\.0\.1:\d+$/);
const require=createRequire(path.resolve('functions/package.json')),admin=require(path.resolve('functions/lib/firebaseAdmin.js'));
admin.initializeApp({projectId:project,storageBucket:project+'.appspot.com'});const db=admin.firestore();
const {manageFleetMembership}=require(path.resolve('functions/lib/fleetMembership.js'));
const {executeOperationalCommand}=require(path.resolve('functions/lib/operationalCommands.js'));
const {registerCanonicalSimpleTrip}=require(path.resolve('functions/lib/registerCanonicalSimpleTrip.js'));
const {completeCanonicalOperation}=require(path.resolve('functions/lib/completeCanonicalOperation.js'));
const env=await initializeTestEnvironment({projectId:project,firestore:{rules:fs.readFileSync('firestore.rules','utf8')},storage:{rules:fs.readFileSync('storage.rules','utf8')}});
const checks:string[]=[];const test=async(name:string,fn:()=>Promise<void>)=>{await fn();checks.push(name);console.log('PASS',name);};
const actor=(uid:string)=>({auth:{uid,token:{auth_time:Math.floor(Date.now()/1000)}}});
const owner='qa-owner001',otherOwner='qa-owner002',driver='qa-driver01',outsider='qa-outsider1',company='qa-company1',second='qa-company2',contract='qa-contract1';
try {
 await env.clearFirestore();await env.clearStorage();
 for(const uid of [owner,otherOwner,driver,outsider]){try{await admin.auth().createUser({uid,email:uid+'@example.test',password:'qa-disposable-password'});}catch(e:any){if(e.code!=='auth/uid-already-exists')throw e;}await db.doc('users/'+uid).set({name:uid,email:uid+'@example.test',status:'active',role:'driver',roles:['driver'],memberships:{}});}
 for(const [id,who]of [[company,owner],[second,otherOwner]])await db.doc('frotas/'+id).set({companyName:id,ownerId:who,userId:who,status:'active',simulatorId:'gto',operationalCommandVersion:1});
 await db.doc('users/'+driver).update({name:'Nome do provedor',authPhotoURL:'https://example.test/provider.png',status:'pending'});
 const application='qa-application1';await db.doc('recruitment_applications/'+application).set({type:'driver_application',userId:driver,email:driver+'@example.test',companyId:company,fullName:'Motorista Cadastro QA',applicationPhotoURL:'https://example.test/cadastro.png',whatsapp:'11999990000',status:'pending',isCurrent:true,createdAt:new Date().toISOString()});
 await test('Gestor aprova cadastro e confirma nome, foto e vínculo canônicos',async()=>{
  await manageFleetMembership.run({action:'approve-application',companyId:company,applicationId:application},actor(owner));
  const u=(await db.doc('users/'+driver).get()).data();assert.equal(u.name,'Motorista Cadastro QA');assert.equal(u.profilePhotoURL,'https://example.test/cadastro.png');
  assert.equal((await db.doc('recruitment_applications/'+application).get()).get('status'),'approved');
  const m=await db.collection('companyMembers').where('userId','==',driver).where('companyId','==',company).get();assert(m.docs.some((d:any)=>d.get('status')==='active'));
 });
 await test('Outra empresa não pode aprovar nem remover o motorista desta frota',async()=>{
  await assert.rejects(manageFleetMembership.run({action:'remove',companyId:company,targetUserId:driver},actor(otherOwner)),(e:any)=>e.code==='permission-denied');
 });
 await db.doc('contratos/'+contract).set({companyId:company,name:'Contrato QA',simulator:'GTO',simulatorId:'gto',mode:'simple',totalDeliveries:1,deadlineDays:3,status:'active'});
 await db.doc('veiculos/qa-vehicle01').set({companyId:company,name:'Veículo QA',plate:'QA00001',status:'available'});
 let jobId='';
 await test('Designação e início geram uma operação real e autenticada',async()=>{
  const assigned=await executeOperationalCommand(db,{action:'assign',requestId:'qa-assign001',companyId:company,contractId:contract,driverId:driver,vehicleId:'qa-vehicle01',trailerId:null},actor(owner));jobId=assigned.jobId;assert(jobId);
  await executeOperationalCommand(db,{action:'start',requestId:'qa-start0001',companyId:company,jobId},actor(driver));assert.equal((await db.doc('trabalhos/'+jobId).get()).get('status'),'active');
 });
 const url=await createEmulatorReceipt(admin,company,driver,'proof-one');
 const trip:any={tripId:'qa-trip00001',canonicalTripId:'qa-trip00001',idempotencyKey:'qa-trip00001',driverId:driver,companyId:company,contractId:contract,jobId,origem:'Origem QA',destino:'Destino QA',valor:101,valorCents:10100,simulatorCode:'GTO',source:'PRINT_PRO_REGISTRATION',imageHash:'qa-immutable-proof-one',gtoEntryMode:'print',gtoReceiptAnalyzed:true,gtoRewardedAdDetected:false,receiptText:'Concluído Valor a receber: R$ 101,00 Receber Dobrar valor (ADS)',comprovanteUrl:url};
 await test('Envios concorrentes e replay criam uma viagem, um slot e um progresso',async()=>{
  const results=await Promise.all([registerCanonicalSimpleTrip.run({trip},actor(driver)),registerCanonicalSimpleTrip.run({trip},actor(driver))]);assert(results.every(r=>r.registered===true));
  assert.equal((await db.collection('historico_viagens').where('jobId','==',jobId).get()).size,1);assert.equal((await db.collection('trip_operation_slots').where('jobId','==',jobId).get()).size,1);
  assert.equal((await db.doc('trabalhos/'+jobId).get()).get('progress'),1);assert.equal((await db.doc('historico_viagens/'+trip.tripId).get()).get('valorCents'),10100);
 });
 await test('Troca do valor e autoria forjada são recusadas sem mudar o histórico',async()=>{
  await assert.rejects(registerCanonicalSimpleTrip.run({trip:{...trip,valor:102,valorCents:10200,receiptText:'Valor a receber: R$ 102,00'}},actor(driver)));
  await assert.rejects(registerCanonicalSimpleTrip.run({trip},actor(outsider)),(e:any)=>e.code==='permission-denied');assert.equal((await db.doc('historico_viagens/'+trip.tripId).get()).get('valorCents'),10100);
 });
 await test('Histórico respeita conta e empresa nas regras reais do Firestore',async()=>{
  await assertSucceeds(getDoc(doc(env.authenticatedContext(driver).firestore(),'historico_viagens',trip.tripId)));
  await assertFails(getDoc(doc(env.authenticatedContext(outsider).firestore(),'historico_viagens',trip.tripId)));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'historico_viagens',trip.tripId)));
 });
 await test('Finalização explícita fecha a operação e o replay mantém o resultado',async()=>{
  assert.equal((await db.doc('trabalhos/'+jobId).get()).get('status'),'awaiting_completion');
  await completeCanonicalOperation.run({jobId},actor(driver));await completeCanonicalOperation.run({jobId},actor(driver));assert.equal((await db.doc('trabalhos/'+jobId).get()).get('status'),'completed');
 });
 // Another independent active membership must survive revocation in company 1.
 await db.doc('companyMembers/'+driver+'_'+second).set({userId:driver,companyId:second,status:'active',roles:['driver']});
 await db.doc('company_access/'+second+'/members/'+driver).set({userId:driver,companyId:second,status:'active',roles:['driver']});
 await test('Remoção revoga somente a empresa escolhida e preserva a viagem',async()=>{
  await manageFleetMembership.run({action:'remove',companyId:company,targetUserId:driver},actor(owner));
  assert.equal((await db.doc('company_access/'+company+'/members/'+driver).get()).get('status'),'removed');assert.equal((await db.doc('companyMembers/'+driver+'_'+second).get()).get('status'),'active');assert.equal((await db.doc('historico_viagens/'+trip.tripId).get()).exists,true);
 });
 await test('Motorista removido não envia novo comprovante para a frota anterior',async()=>{
  await assertFails(uploadBytes(ref(env.authenticatedContext(driver).storage(),`trip-receipts/${company}/${driver}/after-removal.png`),new Uint8Array([1,2]),{contentType:'image/png',customMetadata:{uploadedBy:driver}}));
 });
 fs.mkdirSync('qa/results/emulators',{recursive:true});fs.writeFileSync('qa/results/emulators/lifecycle.json',JSON.stringify({checks,method:'Código do servidor compilado, transações e regras reais em Auth/Firestore/Storage locais. Prova de Storage sintética; OCR real é coberto separadamente no navegador.',project},null,2));
 console.log('QA_LIFECYCLE_PASS',checks.length);
}finally{await env.cleanup();await db.terminate();}
