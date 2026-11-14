import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {executeFleetMembershipClient} from '../src/services/fleetMembershipClientCore';
const require=createRequire(import.meta.url),{makeEnv,Stamp}=require('./fixtures/fleet-membership-test-env.cjs');
const owner={auth:{uid:'owner516',token:{auth_time:2000000000}}},company='company516',driver='driver516',app='app516';
const googlePhoto='https://example.test/google-photo.png',formPhoto='https://example.test/form-photo.png';
const seed=()=>({
 'users/owner516':{name:'Responsável',status:'active',email:'owner516@example.test'},
 'users/driver516':{name:'Nome Google',profilePhotoURL:googlePhoto,authPhotoURL:googlePhoto,status:'pending',email:'driver516@example.test',memberships:{},currentRecruitmentApplicationId:app,currentRecruitmentType:'driver_application'},
 'frotas/company516':{companyName:'Empresa preservada',ownerId:'owner516',status:'active',logoUrl:'https://example.test/company-logo.png',simulatorId:'gto'},
 'recruitment_applications/app516':{type:'driver_application',status:'pending',isCurrent:true,userId:driver,email:'driver516@example.test',companyId:company,fullName:'Nome do Formulário',applicationPhotoURL:formPhoto,whatsapp:'11999990000',reason:'Dados originais',createdAt:Stamp.fromMillis(1)},
});
const approve={action:'approve-application',companyId:company,applicationId:app,diagnosticId:'approve516-first'};
const invoke=(e:any,p:any)=>e.load('fleetMembership').manageFleetMembership(p,owner);
const checks:string[]=[],metrics:any={};
const test=async(n:string,fn:()=>Promise<void>)=>{await fn();checks.push(n);console.log('PASS',n);};
const baseline=fs.readFileSync('verification/release-516/baseline-fleetMembership.cjs','utf8');
const baselineOptions={sources:{'fleetMembership.js':baseline}};
if(baseline)await test('Reproduces 515: approved form keeps Google name/photo in the live profile',async()=>{
 const e=makeEnv(seed(),baselineOptions);await invoke(e,approve);
 assert.equal(e.rows.get('users/'+driver).name,'Nome Google');assert.equal(e.rows.get('users/'+driver).profilePhotoURL,googlePhoto);
 assert.equal(e.rows.get('recruitment_applications/'+app).fullName,'Nome do Formulário');
});
await test('New approval adopts form identity atomically and preserves Google credentials and company identity',async()=>{
 const e=makeEnv(seed());await invoke(e,approve);const u=e.rows.get('users/'+driver);
 assert.equal(u.name,'Nome do Formulário');assert.equal(u.profilePhotoURL,formPhoto);assert.equal(u.whatsapp,'11999990000');assert.equal(u.authPhotoURL,googlePhoto);assert.equal(u.approvedIdentityVersion,2);
 assert.equal(e.rows.get('frotas/'+company).companyName,'Empresa preservada');assert.equal(e.rows.get('users/owner516').name,'Responsável');assert.equal(e.rows.get('recruitment_applications/'+app).reason,'Dados originais');
});
await test('Reapproval and self-repair of the same application preserve later user profile edits',async()=>{
 const e=makeEnv(seed());await invoke(e,approve);Object.assign(e.rows.get('users/'+driver),{name:'Editado depois',profilePhotoURL:'https://example.test/edited.png',profileNameSource:'user_edit',profilePhotoSource:'user_edit'});
 await invoke(e,{...approve,diagnosticId:'approve516-repeated'});
 await e.load('fleetMembership').approveFleetMemberCore(e.db,{auth:{uid:driver,token:{}}},{applicationId:app,repair:true});
 assert.equal(e.rows.get('users/'+driver).name,'Editado depois');assert.equal(e.rows.get('users/'+driver).profilePhotoURL,'https://example.test/edited.png');
});
await test('A fresh explicit application adopts its own identity instead of the previous form',async()=>{
 const e=makeEnv(seed());await invoke(e,approve);e.rows.get('users/'+driver).currentRecruitmentApplicationId='new516';e.rows.set('recruitment_applications/new516',{...seed()['recruitment_applications/app516'],fullName:'Novo formulário',applicationPhotoURL:'https://example.test/new.png',createdAt:Stamp.now()});
 await invoke(e,{...approve,applicationId:'new516',diagnosticId:'approve516-new-form'});assert.equal(e.rows.get('users/'+driver).name,'Novo formulário');assert.equal(e.rows.get('users/'+driver).profilePhotoURL,'https://example.test/new.png');
});
await test('Legacy approval is repaired once; later profile edits remain authoritative',async()=>{
 const e=makeEnv(seed());Object.assign(e.rows.get('users/'+driver),{approvedIdentityApplicationId:app,approvedIdentityName:'Nome do Formulário'});
 await invoke(e,approve);assert.equal(e.rows.get('users/'+driver).name,'Nome do Formulário');assert.equal(e.rows.get('users/'+driver).profilePhotoURL,formPhoto);
 Object.assign(e.rows.get('users/'+driver),{name:'Depois',profilePhotoURL:'https://example.test/later.png'});await invoke(e,{...approve,diagnosticId:'approve516-after-migrate'});assert.equal(e.rows.get('users/'+driver).name,'Depois');
});
await test('Receipt recovery confirms a committed approval while its original HTTP response remains pending',async()=>{
 const e=makeEnv(seed()),calls:string[]=[];const at=performance.now();
 const result=await executeFleetMembershipClient(approve as any,{ready:async()=>{},getUser:()=>({uid:'owner516',getIdToken:async()=>{}}),recoveryAfterMs:20,invoke:async p=>{calls.push(p.action as string);const r=await invoke(e,p);if(p.action==='approve-application')return new Promise(()=>{});return{data:r};}});
 assert.equal(result.success,true);assert.deepEqual(calls,['approve-application','command-status']);assert(performance.now()-at<1000);metrics.pendingResponseRecoveredMs=Math.round(performance.now()-at);
});
await test('NOT_FOUND never approves early or starts a second simultaneous mutation',async()=>{
 const e=makeEnv(seed()),calls:string[]=[];let finished=false;const p=executeFleetMembershipClient(approve as any,{ready:async()=>{},getUser:()=>({uid:'owner516',getIdToken:async()=>{}}),recoveryAfterMs:10,invoke:async input=>{calls.push(input.action as string);if(input.action==='approve-application')await new Promise(r=>setTimeout(r,60));return{data:await invoke(e,input)};}}).then(r=>{finished=true;return r;});
 await new Promise(r=>setTimeout(r,35));assert.equal(finished,false);assert.equal(e.rows.get('recruitment_applications/'+app).status,'pending');await p;assert.deepEqual(calls,['approve-application','command-status']);
});
await test('Normal fast approvals perform one request and cancel receipt polling',async()=>{
 const e=makeEnv(seed()),calls:any[]=[];await executeFleetMembershipClient(approve as any,{ready:async()=>{},getUser:()=>({uid:'owner516',getIdToken:async()=>{}}),recoveryAfterMs:10,invoke:async p=>{calls.push(p);return{data:await invoke(e,p)};}});await new Promise(r=>setTimeout(r,30));assert.equal(calls.length,1);
});
if(baseline)await test('Parallel authorization removes one read round and one duplicate document read under controlled latency',async()=>{
 const timings:any={};for(const [version,root]of[['515',baseline],['516',undefined]]){
  const e=makeEnv(seed(),{...(root?baselineOptions:{}),readDelayMs:70});const at=performance.now();await invoke(e,approve);timings[version]={elapsedMs:Math.round(performance.now()-at),reads:e.reads.length};
 }assert.equal(timings['515'].reads,10);assert.equal(timings['516'].reads,9);assert(timings['516'].elapsedMs<timings['515'].elapsedMs*.88);metrics.controlled70msReadLatency=timings;
});
fs.mkdirSync('reports/release-516',{recursive:true});fs.writeFileSync('reports/release-516/recruitment-core.json',JSON.stringify({passed:checks,checks:checks.length,metrics,productionBenchmark:false,method:'Actual compiled old/new backend and actual client core. Transactional fixture; 70ms artificial latency per read round, not a production measurement.'},null,2));
console.log('RECRUITMENT_516_PASS',checks.length);
