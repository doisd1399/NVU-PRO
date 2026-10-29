import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const source=process.cwd(), events=[],server=new Map();
const memory=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)}};
const storage=memory();
Object.defineProperty(globalThis,'localStorage',{value:storage,configurable:true});
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
Object.defineProperty(globalThis,'window',{value:{localStorage:storage,sessionStorage:memory(),dispatchEvent:e=>events.push(e.type),addEventListener(){},removeEventListener(){}},configurable:true});
globalThis.__audit={uid:'audit-driver',getDoc:async ref=>snapshot(ref.id),rejectRegistration:false,acks:[],saves:[]};
const snapshot=id=>({id,exists:()=>server.has(id),data:()=>server.get(id)});
const mocks={
 'src/lib/firebase.ts':'export const auth={get currentUser(){return {uid:globalThis.__audit.uid}}};export const db={},functions={};',
 'src/services/uploadService.ts':'export const uploadService={uploadImage:async()=>{throw new Error("unexpected upload")}};',
 'src/lib/offlineReceiptStore.ts':'export const getOfflineReceipt=async()=>null,markOfflineReceiptUploaded=async()=>{};',
 'src/repositories/CanonicalTripRepository.ts':'export const canonicalTripRepository={list:()=>[],applyServerSnapshot(){},applyLocalSyncState(){},settleEdit(){},rejectEdit(){},discardFailedLocalProjection(){}};',
 'src/application/trip/TripReconciliationService.ts':'export class TripReconciliationService {async reconcileConfirmedTrip(){}}',
 'src/lib/CanonicalTripUpdateEvent.ts':'export const emitCanonicalTripUpdated=()=>{};',
 'src/lib/tripTombstones.ts':'export const isTripTombstoned=()=>false;',
 'src/hooks/useTripHistory.ts':'export const publishTripHistoryOptimistically=()=>{};',
 'src/hooks/useDriverTrips.ts':'export const publishDriverTripOptimistically=()=>{};',
 'src/application/trip/CanonicalTripCommandService.ts':`export const canonicalTripCommandService={addTripWithinOperationLimit:async trip=>{globalThis.__audit.saves.push(trip);return {id:trip.tripId,offline:true,data:trip}}};`,
 'src/application/trip/CanonicalTripOperationService.ts':`export const canonicalTripOperationService={readAuthoritativeOperationState:()=>{throw new Error('remote preflight must not gate capture')},syncJobProgress:async()=>0};`,
 'src/lib/simpleAutomationNative.ts':`export const recordSimpleAutomationProTiming=()=>{};
 export const SimpleAutomation={acknowledgeReceipt:async input=>{globalThis.__audit.acks.push(input);return {}},showStatusMessage:async()=>{},refreshOperationSnapshot:async()=>{},refreshOperationState:async()=>{}};`,
};
const outfile=path.resolve('node_modules/.cache/audit-fixed/client.mjs');await fs.mkdir(path.dirname(outfile),{recursive:true});
await build({stdin:{contents:`export {SyncEngine} from './src/services/sync/SyncEngine';
export {FirebaseTripSyncAdapter} from './src/services/sync/FirebaseTripSyncAdapter';
export {OfflineDatabase} from './src/services/offline/OfflineDatabase';
export {TripRegistrationService} from './src/application/trip/TripRegistrationService';
export {completeSimpleAutomationReceipt} from './src/services/simpleAutomationCompletionService';
export {presentConfirmedOperationResult} from './src/services/operationCompletionPresentation';`,resolveDir:source,loader:'ts'},
outfile,bundle:true,format:'esm',platform:'node',packages:'external',plugins:[{name:'controlled-boundaries',setup(b){
 b.onResolve({filter:/^firebase\/firestore$/},()=>({path:'firestore',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export const doc=(_db,...p)=>({id:p.at(-1),path:p.join('/')});export const getDocFromServer=ref=>globalThis.__audit.getDoc(ref);export const serverTimestamp=()=>({serverTimestamp:true});export const runTransaction=async()=>{throw new Error('unexpected transaction')};`,loader:'js'}));
 b.onLoad({filter:/\/src\/.*\.[tj]sx?$/},({path:f})=>mocks[path.relative(source,f)]?{contents:mocks[path.relative(source,f)],loader:'ts'}:undefined);
}}]});
const {SyncEngine,FirebaseTripSyncAdapter,OfflineDatabase,TripRegistrationService,completeSimpleAutomationReceipt,presentConfirmedOperationResult}=await import(pathToFileURL(outfile));
const checks=[];const pass=name=>{checks.push(name);console.log('PASS',name)};
const record=(id,jobId='audit-job')=>TripRegistrationService.register({tripId:id,canonicalTripId:id,idempotencyKey:id,driverId:'audit-driver',companyId:'audit-company',contractId:'audit-contract',jobId,origem:'A',destino:'B',valor:100,valorCents:10000,source:'manual'});
const make=(timeout=80)=>{const store=memory(),database=new OfflineDatabase({storage:store});const adapter=new FirebaseTripSyncAdapter({firestore:{},serverReadTimeoutMs:timeout,getCurrentUser:()=>({uid:'audit-driver'}),registerCanonicalTrip:async request=>{
 if(__audit.rejectRegistration)throw Object.assign(new Error('permission denied'),{code:'functions/permission-denied'});
 const id=request.trip.tripId;server.set(id,{...request.trip,serverValidatedAt:new Date().toISOString()});return {data:{registered:true,tripId:id}};
}});const engine=new SyncEngine({storage:store,offlineDatabase:database,getCurrentUser:()=>({uid:'audit-driver'}),operationStartPending:()=>false,adapter,transportTimeoutMs:200});return {engine,adapter,database}};
const save=async(box,id,jobId)=>{const trip=record(id,jobId);box.database.save({trip,syncStatus:'PENDING_SYNC',syncVersion:1,clientUpdatedAt:new Date().toISOString()});await box.engine.enqueue(trip)};
{
 const requests=[];let repaired=0;
 const adapter=new FirebaseTripSyncAdapter({firestore:{},getCurrentUser:()=>({uid:'audit-driver'}),
 registerCanonicalTrip:async request=>{requests.push(JSON.stringify(request));if(requests.length===1)throw Object.assign(new Error('OPERATION_RECONCILIATION_REQUIRED'),{code:'functions/failed-precondition'});const id=request.trip.tripId;server.set(id,{...request.trip,serverValidatedAt:new Date().toISOString()});return {data:{registered:true,tripId:id}};},
 reconcileOperation:async({jobId})=>{assert.equal(jobId,'audit-job');repaired++;}});
 __audit.getDoc=async ref=>snapshot(ref.id);
 assert.equal((await adapter.push(record('orphan-repair'))).confirmed,true);assert.equal(repaired,1);assert.equal(requests.length,2);assert.equal(requests[0],requests[1]);
 server.clear();
 pass('An orphan reservation triggers one server repair and replays the unchanged request.');
}
{
 for(const code of ['functions/resource-exhausted','functions/aborted']){
 const store=memory(),database=new OfflineDatabase({storage:store});const engine=new SyncEngine({storage:store,offlineDatabase:database,getCurrentUser:()=>({uid:'audit-driver'}),operationStartPending:()=>false,adapter:{push:async()=>{throw Object.assign(new Error(code),{code})}}});
 await engine.enqueue(record(code));await engine.synchronize();assert.equal(engine.getResult(code).state,'PENDING_SYNC');clearTimeout(engine.retryTimer);
 }
 pass('Transient quota and transaction contention stay pending for retry rather than becoming final failures.');
}
{
 const box=make(30);let release;
 __audit.getDoc=ref=>ref.id==='slow'?new Promise(resolve=>release=()=>resolve(snapshot(ref.id))):Promise.resolve(snapshot(ref.id));
 await save(box,'slow');await save(box,'later');await save(box,'unrelated','audit-other-job');await box.engine.synchronize();
 assert.equal(server.has('slow'),true);assert.equal(box.engine.getResult('slow').state,'PENDING_SYNC');assert.equal(box.engine.getResult('later').state,'PENDING_SYNC');assert.equal(box.engine.getResult('unrelated').state,'SERVER_CONFIRMED');
 release();await new Promise(r=>setTimeout(r,5));assert.equal(box.engine.getResult('slow').state,'PENDING_SYNC');
 __audit.getDoc=async ref=>snapshot(ref.id);await box.engine.retryRegistration('slow');await box.engine.synchronize();
 assert.equal(box.engine.getResult('slow').state,'SERVER_CONFIRMED');assert.equal(box.engine.getResult('later').state,'SERVER_CONFIRMED');assert.equal(server.size,3);
 pass('A delayed post-commit read releases unrelated operations while preserving same-operation FIFO; its late reply cannot manufacture an ACK; replay confirms the same ID.');
}
{
 const box=make(30);__audit.getDoc=async()=>{throw Object.assign(new Error('temporary read denied'),{code:'permission-denied'})};await save(box,'accepted-read-denied');await box.engine.synchronize();
 assert.equal(box.engine.getResult('accepted-read-denied').state,'PENDING_SYNC');assert.equal(box.database.get('accepted-read-denied').trip.offlineSyncStatus,'server_received');
 let deletes=0;box.adapter.delete=async()=>{deletes++;throw new Error('remote check required')};
 await assert.rejects(()=>box.engine.deleteRemoteFirst('accepted-read-denied'),/remote check required/);assert.equal(deletes,1);assert.equal(server.has('accepted-read-denied'),true);
 __audit.getDoc=async ref=>snapshot(ref.id);await box.engine.retryRegistration('accepted-read-denied');await box.engine.synchronize();
 pass('A successful registration followed by denied reading remains pending; deleting it requires the remote path.');
}
{
 const box=make();await save(box,'recover-permission');__audit.rejectRegistration=true;await box.engine.synchronize();
 const proposal=box.engine.inspectFailedHistoryRegistrations('audit-company').rows[0];assert.equal(proposal.reason,'PERMISSION_DENIED');
 assert.equal(await box.engine.retryFailedHistoryRegistration({...proposal,driverId:'other-user'}),false);
 const oldKey=box.engine.getResult('recover-permission').trip.idempotencyKey;
 assert.equal(await box.engine.retryFailedHistoryRegistration(proposal),true);__audit.rejectRegistration=false;await box.engine.synchronize();
 assert.equal(box.engine.getResult('recover-permission').state,'SERVER_CONFIRMED');assert.equal(box.engine.getResult('recover-permission').trip.idempotencyKey,oldKey);
 pass('Explicit permission recovery revalidates the unchanged request; another account cannot recover it.');
}
{
 const box=make();await save(box,'unsent');const local=await box.engine.deleteRemoteFirst('unsent');assert.equal(local.localOnly,true);
 pass('A never-attempted local trip can still be discarded without a remote request.');
}
{
 const store=memory(),database=new OfflineDatabase({storage:store});let calls=0;
 const engine=new SyncEngine({storage:store,offlineDatabase:database,getCurrentUser:()=>({uid:'audit-driver'}),transportTimeoutMs:20,adapter:{push:async trip=>{
 calls++;if(trip.tripId==='hung')return new Promise(()=>{});return {confirmed:true,tripId:trip.tripId,data:{...trip,serverValidatedAt:new Date().toISOString()}};
 }}});
 await engine.enqueue(record('hung'));await engine.enqueue(record('healthy','healthy-job'));await engine.synchronize();
 assert.equal(engine.getResult('hung').state,'PENDING_SYNC');assert.equal(engine.getResult('healthy').state,'SERVER_CONFIRMED');assert.equal(calls,2);
 clearTimeout(engine.retryTimer);pass('A silent provider cannot hold an unrelated operation indefinitely.');
}
{
 for(const attempt of ['capture-one-503','capture-two-503']){
 const result=await completeSimpleAutomationReceipt({currentUser:{id:'audit-driver'},currentCompany:{id:'audit-company',companyName:'Empresa'},
 currentJob:{id:'audit-job',companyId:'audit-company',driverId:'audit-driver',contractId:'audit-contract',status:'active',totalDeliveries:5},
 currentContract:{id:'audit-contract',totalDeliveries:5},status:{simpleState:'CAPTURE_CAPTURED',captureAttemptId:attempt,
 captureContextEpoch:'global-truck:503:abcdef',contextEpoch:'global-truck:503:abcdef',captureSimulatorKey:'global-truck',simulatorKey:'global-truck',
 captureSimulatorCode:'GTO',simulatorCode:'GTO',capturePackageId:'com.stargamesapps.gto',packageId:'com.stargamesapps.gto',captureCompanyId:'audit-company',
 captureJobId:'audit-job',captureContractId:'audit-contract',captureOrigin:'Cidade A',captureDestination:'Cidade B',receiptCapturedAt:Date.now(),
 receiptText:'Concluído\nValor a receber: R$ 1.234,00\nDobrar valor (ADS)'}});
 assert.equal(result.submitted,true);assert.equal(result.pendingSync,true);
 }
 assert.equal(__audit.saves.length,2);assert.notEqual(__audit.saves[0].tripId,__audit.saves[1].tripId);
 assert.equal(__audit.acks.every(ack=>ack.pendingSync===true&&ack.captureAttemptId),true);
 pass('Distinct Pro captures with equal amounts queue without remote preflight and stable IDs are never described as server confirmation.');
}
{
 const entry={actorId:'audit-driver',companyId:'audit-company',jobId:'audit-job',kind:'finish',id:'finish:audit-job',state:'PENDING',createdAt:Date.now()};
 const input={uid:'audit-driver',companyId:'audit-company',entries:[entry],contracts:[],trips:[],acknowledge:()=>entry.resultPresented=true};
 assert.equal(presentConfirmedOperationResult(input),false);
 entry.state='CONFIRMED';entry.result={completed:true,job:{id:'audit-job',companyId:'audit-company',driverId:'audit-driver',contractId:'audit-contract',status:'completed',progress:1,totalDeliveries:1,createdAt:new Date().toISOString(),completedAt:new Date().toISOString()}};
 assert.equal(presentConfirmedOperationResult({...input,uid:'another-user'}),false);assert.equal(presentConfirmedOperationResult(input),true);
 assert.equal(presentConfirmedOperationResult(input),false);assert.equal(events.filter(x=>x==='nvu-operation-result-ready').length,1);
 pass('A queued finish never presents completion; the later real ACK publishes one scoped result and survives replay.');
}
await fs.mkdir('reports',{recursive:true});await fs.writeFile('reports/audit-trip-client-regressions.json',JSON.stringify({productionAccess:false,passed:checks.length,checks},null,2)+'\n');
console.log('AUDIT_TRIP_CLIENT_PASS',checks.length);
