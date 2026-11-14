import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import { executeFleetMembershipClient } from '../src/services/fleetMembershipClientCore';
const require=createRequire(import.meta.url);
const {makeEnv,Stamp}=require('./fixtures/fleet-membership-test-env.cjs');
const actor={auth:{uid:'owner513',token:{auth_time:2000000000}}};
const ctx=(uid:string)=>({auth:{uid,token:{auth_time:2000000000}}});
const seed=()=>({
 'users/owner513':{status:'active',email:'owner@example.test'},
 'users/driver513':{status:'pending',email:'driver@example.test',companyId:null,memberships:{}},
 'users/outsider513':{status:'active',email:'outsider@example.test'},
 'frotas/company513':{ownerId:'owner513',userId:'owner513',companyName:'Company 513',simulatorId:'gto'},
 'recruitment_applications/application513':{type:'driver_application',status:'pending',userId:'driver513',email:'driver@example.test',companyId:'company513',createdAt:Stamp.fromMillis(1)},
});
const approve={action:'approve-application',companyId:'company513',applicationId:'application513',diagnosticId:'approval-513'};
const remove={action:'remove',companyId:'company513',targetUserId:'driver513',diagnosticId:'removal-513'};
const equalData=(a:any,b:any)=>assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)));
const checks:string[]=[];
const test=async(name:string,fn:()=>Promise<void>)=>{await fn();checks.push(name);console.log('PASS',name)};
const command=(e:any,input:any,context=actor)=>e.load('fleetMembership').manageFleetMembership(input,context);
const receiptRows=(e:any)=>[...e.rows.keys()].filter((key:string)=>key.startsWith('fleet_membership_commands/'));
await test('Existing candidate with no company is approved atomically; ACK receipt, membership and notification agree',async()=>{
 const e=makeEnv(seed());const r=await command(e,approve);assert.equal(r.success,true);assert.equal(r.membershipProtocolVersion,513);
 assert.equal(e.rows.get('users/driver513').companyId,'company513');assert.equal(e.rows.get('company_access/company513/members/driver513').status,'active');
 assert.equal(e.rows.get('recruitment_applications/application513').status,'approved');assert.equal(receiptRows(e).length,1);
 assert(e.rows.has('notifications/MEMBERSHIP_APPROVED_application513'));
});
await test('Repeated approval returns the first ACK and performs no second mutation or notification',async()=>{
 const e=makeEnv(seed());const first=await command(e,approve),writes=e.transactionStats.writes;equalData(await command(e,approve),first);assert.equal(e.transactionStats.writes,writes);assert.equal(receiptRows(e).length,1);
});
await test('Removal revokes duplicate memberships, simulator rows, legacy applications and requests, preserving another fleet and trips',async()=>{
 const e=makeEnv(seed());await command(e,approve);
 e.rows.set('companyMembers/duplicate',{userId:'driver513',companyId:'company513',roles:['admin','driver'],status:'active'});
 e.rows.set('simulator_members/duplicate',{userId:'driver513',companyId:'company513',status:'active'});
 e.rows.set('solicitacoes_motoristas/legacy',{motoristaId:'driver513',empresaId:'company513',status:'approved'});
 e.rows.set('historico_viagens/preserved',{driverId:'driver513',companyId:'company513',valor:10400,status:'concluida'});
 e.rows.get('users/driver513').memberships.other={roles:['driver'],status:'active'};
 const r=await command(e,remove);assert.equal(r.success,true);
 assert(!e.rows.has('companyMembers/duplicate'));assert(!e.rows.has('simulator_members/duplicate'));
 assert(!e.rows.has('companyMembers/driver513_company513'));assert.equal(e.rows.get('company_access/company513/members/driver513').status,'removed');
 assert.equal(e.rows.get('recruitment_applications/application513').status,'rejected');assert.equal(e.rows.get('solicitacoes_motoristas/legacy').status,'rejected');
 assert(e.rows.get('users/driver513').memberships.other);assert(e.rows.has('historico_viagens/preserved'));
});
await test('An old removal replay after a new explicit approval cannot remove the driver again',async()=>{
 const e=makeEnv(seed());await command(e,approve);const removed=await command(e,remove);
 e.rows.set('recruitment_applications/new513',{type:'driver_application',status:'pending',isCurrent:true,userId:'driver513',email:'driver@example.test',companyId:'company513',createdAt:Stamp.fromMillis(Date.now()+1000)});
 await command(e,{...approve,applicationId:'new513',diagnosticId:'approval-new513'});
 const writes=e.transactionStats.writes;equalData(await command(e,remove),removed);assert.equal(e.transactionStats.writes,writes);
 assert.equal(e.rows.get('company_access/company513/members/driver513').status,'active');
});
await test('An old approval replay after removal cannot restore access',async()=>{
 const e=makeEnv(seed());const original=await command(e,approve);await command(e,remove);equalData(await command(e,approve),original);
 assert.equal(e.rows.get('company_access/company513/members/driver513').status,'removed');
});
await test('Status is actor-scoped and cannot expose another actor receipt',async()=>{
 const e=makeEnv(seed());const r=await command(e,approve);const query={...approve,action:'command-status',commandAction:approve.action};
 equalData((await command(e,query)).result,r);assert.equal((await command(e,query,ctx('outsider513'))).commandStatus,'NOT_FOUND');
 e.rows.get('users/owner513').accountStatus='suspended';await assert.rejects(()=>command(e,query),(err:any)=>err.code==='permission-denied');
});
await test('Reusing a command ID for a different action is rejected without writes',async()=>{
 const e=makeEnv(seed());await command(e,approve);const writes=e.transactionStats.writes;
 await assert.rejects(()=>command(e,{...remove,diagnosticId:approve.diagnosticId}),(err:any)=>err.details?.reasonCode==='MEMBERSHIP_COMMAND_CONFLICT');assert.equal(e.transactionStats.writes,writes);
});
await test('A failed transaction creates neither a membership nor an ACK receipt',async()=>{
 const e=makeEnv(seed());e.failNextCommit();await assert.rejects(()=>command(e,approve));assert.equal(e.rows.get('users/driver513').companyId,null);assert.equal(receiptRows(e).length,0);
 assert.equal((await command(e,{...approve,action:'command-status',commandAction:approve.action})).commandStatus,'NOT_FOUND');
});
await test('Unauthorized approval, self-removal and sole-owner removal remain refused',async()=>{
 const e=makeEnv(seed());await assert.rejects(()=>command(e,approve,ctx('outsider513')),(err:any)=>err.code==='permission-denied'&&String(err.message).includes(approve.diagnosticId));
 await assert.rejects(()=>command(e,{...remove,targetUserId:'owner513'}),(err:any)=>err.code==='failed-precondition');
 assert.equal(receiptRows(e).length,0);
});
await test('Lost approval response is recovered by reading the real server receipt, without another mutation',async()=>{
 const e=makeEnv(seed()),calls:any[]=[];let first=true;
 const user={uid:'owner513',getIdToken:async()=>{}};
 const r=await executeFleetMembershipClient(approve as any,{ready:async()=>{},getUser:()=>user,invoke:async(input:any)=>{
  calls.push(input);const result=await command(e,input);if(first){first=false;throw {code:'functions/internal'}}return {data:result};
 }});
 assert.equal(r.success,true);equalData(calls.map(x=>x.action),['approve-application','command-status']);assert.equal(receiptRows(e).length,1);
});
await test('Pre-commit transport failure retries only after NOT_FOUND, using the exact same command ID',async()=>{
 const e=makeEnv(seed()),calls:any[]=[];e.failNextCommit();const user={uid:'owner513',getIdToken:async()=>{}};
 const r=await executeFleetMembershipClient(approve as any,{ready:async()=>{},getUser:()=>user,invoke:async(input:any)=>{calls.push(input);return {data:await command(e,input)}}});
 assert.equal(r.success,true);equalData(calls.map(x=>x.action),['approve-application','command-status','approve-application']);assert(calls.every(x=>x.diagnosticId===approve.diagnosticId));assert.equal(receiptRows(e).length,1);
});
await test('Refusals are not retried and a changed account cannot receive or replay an ACK',async()=>{
 let calls=0;let user:any={uid:'owner513',getIdToken:async()=>{user={uid:'other'}}};
 await assert.rejects(()=>executeFleetMembershipClient(remove as any,{ready:async()=>{},getUser:()=>user,invoke:async()=>{calls++;throw {code:'functions/unauthenticated'}}}));assert.equal(calls,1);
 user={uid:'owner513',getIdToken:async()=>{}};calls=0;
 await assert.rejects(()=>executeFleetMembershipClient(remove as any,{ready:async()=>{},getUser:()=>user,invoke:async()=>{calls++;throw {code:'functions/permission-denied'}}}));assert.equal(calls,1);
});
await test('A mismatched company ACK is never shown as success',async()=>{
 await assert.rejects(()=>executeFleetMembershipClient(remove as any,{ready:async()=>{},getUser:()=>({uid:'owner513',getIdToken:async()=>{}}),invoke:async()=>({data:{success:true,companyId:'other'}})}),(err:any)=>err.code==='MEMBERSHIP_ACK_INVALID');
});
fs.mkdirSync('reports/release-513',{recursive:true});fs.writeFileSync('reports/release-513/fleet.json',JSON.stringify({checks:checks.length,passed:checks,productionAccess:false,method:'Actual compiled callable and client core; transactional Firestore boundaries with rollback, undefined-value validation and all reads before writes'},null,2));
console.log('FLEET_RELIABILITY_513_PASS',checks.length);
