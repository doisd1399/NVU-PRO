import assert from 'node:assert/strict';
import fs from 'node:fs';
class Store {
 values=new Map<string,string>();capacity=Infinity;
 get length(){return this.values.size} key(i:number){return [...this.values.keys()][i]??null}
 getItem(k:string){return this.values.get(k)??null}
 setItem(k:string,v:string){const bytes=[...this.values].reduce((n,[key,value])=>n+(key===k?0:value.length),0)+v.length;if(bytes>this.capacity)throw Object.assign(new Error('quota exhausted'),{name:'QuotaExceededError'});this.values.set(k,v)}
 removeItem(k:string){this.values.delete(k)}
}
const storage=new Store(),events=new EventTarget();
Object.defineProperty(globalThis,'localStorage',{value:storage,configurable:true});
Object.defineProperty(globalThis,'window',{value:{localStorage:storage,dispatchEvent:events.dispatchEvent.bind(events),addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)},configurable:true});
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
const [{OfflineDatabase},{SyncEngine},{CanonicalTripRepository},{CanonicalTripCommandService},{OfflineFirstCanonicalTripGateway},{TripRegistrationService},{canonicalTripStore},history,view]=await Promise.all([
 import('../src/services/offline/OfflineDatabase'),import('../src/services/sync/SyncEngine'),import('../src/repositories/CanonicalTripRepository'),import('../src/application/trip/CanonicalTripCommandService'),import('../src/application/trip/persistence/OfflineFirstCanonicalTripGateway'),import('../src/application/trip/TripRegistrationService'),import('../src/lib/CanonicalTripStore'),import('../src/lib/tripHistoryEngine'),import('../src/lib/pendingHistoryTrips')]);
const checks:string[]=[],engines:any[]=[];
const test=async(name:string,fn:()=>Promise<void>)=>{canonicalTripStore.clear();await fn();checks.push(name);console.log('PASS',name)};
const trip=(id='print-513',patch={})=>TripRegistrationService.register({tripId:id,idempotencyKey:id,companyId:'company513',driverId:'driver513',contractId:'contract513',jobId:'job513',recordStatus:'concluida',origem:'PR',destino:'SP',valor:10400,valorCents:1040000,currency:'BRL',imageHash:id,offlineReceiptKey:'receipt-'+id,createdAtLocal:'2026-10-24T20:00:00Z',...patch});
const ack=(t:any)=>({confirmed:true as const,tripId:t.tripId,data:{...t,serverValidatedAt:'2026-10-24T20:00:01Z'}});
function setup(push=async(t:any)=>ack(t),local=new Store()){
 const db=new OfflineDatabase({storage:local}),engine=new SyncEngine({offlineDatabase:db,storage:local,getCurrentUser:()=>({uid:'driver513'}),operationStartPending:()=>false,adapter:{push}}),repo=new CanonicalTripRepository({database:db,queue:engine});engines.push(engine);
 const command=new CanonicalTripCommandService(new OfflineFirstCanonicalTripGateway(repo as any),{getCurrentUser:()=>({uid:'driver513'}),isOffline:()=>false,sync:engine});return {db,engine,repo,command,local};
}
try {
await test('Print Save returns after the durable commit while an arbitrarily slow server is still held',async()=>{
 let release!:()=>void,started=false;const held=new Promise<void>(r=>release=r);const s=setup(async t=>{started=true;await held;return ack(t)});
 const begin=performance.now();const r=await s.command.addTripWithinOperationLimit(trip(),{waitForServerAck:false});const elapsed=performance.now()-begin;
 assert.equal(r.offline,true);assert(s.db.get(r.id));assert(s.engine.getResult(r.id));assert(elapsed<200,`Save waited ${elapsed}ms`);
 const rows=view.pendingRegistrationHistoryRows(s.engine.getOwnedHistoryRegistrations('company513'),false);
 assert.equal(rows.length,1);assert.equal(rows[0].valorCents,1040000);assert.equal(history.filterAndSortTripHistory(rows,{includePending:true}).length,1);
 release();await s.engine.synchronize();assert(started);
});
await test('Offline trip uses the normal history filter and row without entering confirmed gains or operation sequence',async()=>{
 const s=setup();await s.repo.saveLocal(trip());const rows=view.pendingRegistrationHistoryRows(s.engine.getOwnedHistoryRegistrations('company513'),true);
 assert.equal(view.tripSendStatus(rows[0]),'pending');assert.equal(rows[0].offlineSyncStatus,'awaiting_connection');
 assert.equal(history.filterAndSortTripHistory(rows,{}).length,0);const visible=history.filterAndSortTripHistory(rows,{includePending:true});assert.equal(visible.length,1);
 const sum=history.summarizeTripHistory(visible);assert.equal(sum.totalViagens,0);assert.equal(sum.moneyGroups.length,0);
 const {buildTripNumberMap}=await import('../src/lib/tripSequence');assert.equal(buildTripNumberMap(visible).size,0);
});
await test('Reload recovers the exact pending trip from the journal, without any React optimistic cache',async()=>{
 const s=setup();await s.repo.saveLocal(trip());canonicalTripStore.clear();
 const restored=setup(undefined,s.local);const rows=view.pendingRegistrationHistoryRows(restored.engine.getOwnedHistoryRegistrations('company513'),true);
 assert.equal(rows.length,1);assert.equal(rows[0].id,'print-513');assert.equal(rows[0].offlineReceiptKey,'receipt-print-513');
});
await test('A real ACK replaces pending on the same row before the Firestore history listener responds',async()=>{
 const s=setup();await s.repo.saveLocal(trip());const before=view.pendingRegistrationHistoryRows(s.engine.getOwnedHistoryRegistrations('company513'),true);await s.engine.synchronize();
 const rows=view.pendingRegistrationHistoryRows(s.engine.getOwnedHistoryRegistrations('company513'),false);assert.equal(rows.length,1);assert.equal(rows[0].id,before[0].id);assert.equal(view.tripSendStatus(rows[0]),'confirmed');
 const visible=history.filterAndSortTripHistory(rows,{includePending:true});assert.equal(visible.length,1);assert.equal(history.summarizeTripHistory(visible).totalViagens,1);
 assert.equal(s.engine.getOwnedPendingRegistrations('company513').length,0);
 const merged=view.mergePendingHistoryTrips([{...rows[0],historyReadEvidence:{version:1,collection:'historico_viagens',physicalDocumentId:rows[0].id,transport:'server'},physicalDocumentId:rows[0].id}],before);
 assert.equal(merged.length,1);assert.equal(view.tripSendStatus(merged[0]),'confirmed');
 const alias={...rows[0],id:'server-original',tripId:'server-original',canonicalTripId:'server-original',physicalDocumentId:'server-original'};const resolved=view.mergePendingHistoryTrips(before,[alias]);assert.equal(resolved.length,1);assert.equal(resolved[0].id,'server-original');
});
await test('Other owners, fleets, operations and fake confirmation flags are excluded',async()=>{
 const s=setup();await s.repo.saveLocal(trip());await s.repo.saveLocal(trip('other-company',{companyId:'other-company'}));await s.repo.saveLocal(trip('other-driver',{driverId:'other-driver'}));await s.repo.saveLocal(trip('other-job',{jobId:'other-job'}));
 const rows=view.pendingRegistrationHistoryRows(s.engine.getOwnedHistoryRegistrations('company513','job513'),true);assert.equal(rows.length,1);
 assert.equal(history.filterAndSortTripHistory(rows,{includePending:true,driverId:'other-driver'}).length,0);
 assert.equal(history.filterAndSortTripHistory(rows,{includePending:true,periodPreset:'data',customStartDate:'2026-10-23',customEndDate:'2026-10-23'}).length,0);
 assert.equal(view.pendingRegistrationHistoryRows([{state:'SERVER_CONFIRMED',trip:rows[0]}],false).length,0);
});
await test('Permanent refusal stays visible for review with unchanged money and receipt; it is never shown as sent',async()=>{
 const s=setup(async()=>{throw Object.assign(new Error('denied'),{code:'functions/invalid-argument',details:{retryable:false}})});await s.repo.saveLocal(trip());await s.engine.synchronize();
 const rows=view.pendingRegistrationHistoryRows(s.engine.getOwnedHistoryRegistrations('company513'),false);assert.equal(rows.length,1);assert.equal(view.tripSendStatus(rows[0]),'failed');assert.equal(rows[0].valorCents,1040000);assert.equal(rows[0].offlineReceiptKey,'receipt-print-513');
});
await test('An old post-acceptance read failure resumes the original attempt without changing its evidence',async()=>{
 const s=setup();await s.repo.saveLocal(trip());const saved=JSON.parse(s.local.getItem(OfflineDatabase.storageKey)!);
 Object.assign(saved.outbox['print-513'],{state:'FAILED',lastFailureStage:'SERVER_READ',lastError:'permission-denied: UNDETERMINED_SERVER_REJECTION: Missing permissions'});
 saved.records['print-513'].trip.offlineSyncStatus='server_received';saved.records['print-513'].syncStatus='CONFLICT';s.local.setItem(OfflineDatabase.storageKey,JSON.stringify(saved));
 await s.engine.synchronize();assert.equal(s.engine.getResult('print-513')?.state,'SERVER_CONFIRMED');assert.equal(s.engine.getResult('print-513')?.trip.valorCents,1040000);
 assert.equal(s.engine.getResult('print-513')?.trip.offlineReceiptKey,'receipt-print-513');
});
await test('Disposable caches can no longer consume the space needed to save a trip; Auth and existing pending work survive',async()=>{
 const local=new Store(),s=setup(undefined,local);await s.repo.saveLocal(trip('existing'));
 local.setItem('firebase:authUser','session-preserved');local.setItem('nvu.operation.outbox.v1','pending-start-preserved');local.setItem('unfamiliar-data','preserved');
 local.setItem('nvu-ranking-premium-v1:large','x'.repeat(29000));local.capacity=32000;await s.repo.saveLocal(trip('new'));
 assert(s.db.get('existing'));assert(s.db.get('new'));assert(s.engine.getResult('existing'));assert(s.engine.getResult('new'));
 assert.equal(local.getItem('firebase:authUser'),'session-preserved');assert.equal(local.getItem('nvu.operation.outbox.v1'),'pending-start-preserved');assert.equal(local.getItem('unfamiliar-data'),'preserved');assert.equal(local.getItem('nvu-ranking-premium-v1:large'),null);
});
await test('A genuine full device remains an explicit local-save failure and never claims acceptance',async()=>{
 const local=new Store(),s=setup(undefined,local);await s.repo.saveLocal(trip('existing'));const before=local.getItem(OfflineDatabase.storageKey);local.capacity=before!.length+5;
 await assert.rejects(()=>s.command.addTripWithinOperationLimit(trip('new'),{waitForServerAck:false}),(err:any)=>err.message==='OFFLINE_STORAGE_WRITE_FAILED'&&err.tripSyncStage==='LOCAL_COMMIT'&&err.storageFailureReason==='QUOTA');
 assert.equal(local.getItem(OfflineDatabase.storageKey),before);assert.equal(s.db.get('new'),undefined);
});
fs.mkdirSync('reports/release-513',{recursive:true});fs.writeFileSync('reports/release-513/trips.json',JSON.stringify({checks:checks.length,passed:checks,productionAccess:false,method:'Actual repository, atomic journal, command service, synchronizer, history filters, metric summaries; controlled server ACKs and shared quota'},null,2));console.log('TRIP_HISTORY_513_PASS',checks.length);
} finally {for(const engine of engines)if(engine.retryTimer)clearTimeout(engine.retryTimer)}
