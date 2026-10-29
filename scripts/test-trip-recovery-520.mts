import assert from "node:assert/strict";
import fs from "node:fs";
class StorageDouble {
  values = new Map<string,string>(); failWrites = 0; writes = 0;
  getItem(k: string) { return this.values.get(k) ?? null; }
  setItem(k: string,v: string) { if (this.failWrites > 0) { this.failWrites--; throw new Error("InjectedDiskFailure"); } this.writes++; this.values.set(k,v); }
  removeItem(k: string) { this.values.delete(k); }
}
const globalStorage = new StorageDouble();
Object.defineProperty(globalThis,"localStorage",{value:globalStorage, configurable:true});
Object.defineProperty(globalThis,"window",{value:{localStorage:globalStorage,dispatchEvent:()=>true,addEventListener(){},removeEventListener(){}},configurable:true});
Object.defineProperty(globalThis,"navigator",{value:{onLine:true},configurable:true});
const {OfflineDatabase,readCanonicalOutboxSnapshot} = await import("../src/services/offline/OfflineDatabase");
const {SyncEngine} = await import("../src/services/sync/SyncEngine");
const {CanonicalTripRepository} = await import("../src/repositories/CanonicalTripRepository");
const {TripRegistrationService} = await import("../src/application/trip/TripRegistrationService");
const {canonicalTripStore} = await import("../src/lib/CanonicalTripStore");
const checks: string[] = [];
const engines: any[] = [];
const trip = (id:string,driverId="driver-505") => TripRegistrationService.register({tripId:id,canonicalTripId:id,idempotencyKey:id,
  driverId,companyId:"company-505",jobId:"job-505",contractId:"contract-505",valor:123.45,valorCents:12345,
  origem:"A",destino:"B",imageHash:"hash-"+id,offlineReceiptKey:"receipt-"+id,source:"PRINT_PRO_REGISTRATION"} as any);
const ack = (t:any) => ({confirmed:true as const,tripId:t.tripId,data:{...t,serverValidatedAt:"2026-10-23T15:00:00.000Z"}});
function setup(push=(async(t:any)=>ack(t)), storage=new StorageDouble(), uid=()=>({uid:"driver-505"})) {
  canonicalTripStore.clear();
  const database = new OfflineDatabase({storage});
  const engine = new SyncEngine({storage,offlineDatabase:database,getCurrentUser:uid,operationStartPending:()=>false,adapter:{push},transportTimeoutMs:100});
  engines.push(engine);
  return {database,engine,storage,repo:new CanonicalTripRepository({database,queue:engine})};
}
async function test(name:string, fn:()=>Promise<void>|void) { await fn(); checks.push(name); console.log("PASS",name); }
const record = (t:any) => ({trip:t,syncStatus:"PENDING_SYNC" as const,syncVersion:1,clientUpdatedAt:"2026-10-23T10:00:00Z"});
try {
await test("single durable write contains both registration and outbox",async()=>{
 const s=setup(); await s.repo.saveLocal(trip("atomic")); const env=JSON.parse(s.storage.getItem(OfflineDatabase.storageKey)!);
 assert.ok(env.records.atomic); assert.ok(env.outbox.atomic); assert.equal(s.storage.writes,1);
});
await test("failed atomic commit exposes neither record nor send command",async()=>{
 const s=setup();s.storage.failWrites=1;await assert.rejects(()=>s.repo.saveLocal(trip("failed-atomic")),/OFFLINE_STORAGE_WRITE_FAILED/);
 assert.equal(s.database.list().length,0); assert.equal(s.engine.getPending().length,0);
});
await test("observer exception cannot prevent queue persistence or send",async()=>{
 const s=setup();s.repo.subscribe(()=>{throw new Error("render-crash");});
 await s.repo.saveLocal(trip("observer"));await s.engine.synchronize();assert.equal(s.engine.getResult("observer")?.state,"SERVER_CONFIRMED");
});
await test("504 orphan is reconstructed and sent automatically after restart",async()=>{
 const storage=new StorageDouble();storage.setItem(OfflineDatabase.storageKey,JSON.stringify({schemaVersion:2,records:{orphan:record(trip("orphan"))}}));
 let sent=0;const s=setup(async t=>{sent++;return ack(t)},storage);await s.engine.synchronize();assert.equal(sent,1);assert.equal(s.engine.getResult("orphan")?.state,"SERVER_CONFIRMED");
});
await test("other owner's orphan remains preserved and unsent",async()=>{
 const s=setup();s.database.save(record(trip("foreign-orphan","other")));await s.engine.synchronize();assert.equal(s.engine.getResult("foreign-orphan"),undefined);assert.ok(s.database.get("foreign-orphan"));
});
await test("old temporary FAILED entries recover with the original identifier",async()=>{
 const storage=new StorageDouble();const t=trip("old-temporary");storage.setItem("nvu_sync_queue_v2",JSON.stringify({[t.tripId]:{trip:t,state:"FAILED",lastError:"functions/unavailable:provider down",attempts:2,queuedAt:"2026-10-20T00:00:00Z"}}));
 const s=setup(undefined,storage);await s.engine.synchronize();assert.equal(s.engine.getResult(t.tripId)?.state,"SERVER_CONFIRMED");assert.equal(s.storage.getItem("nvu_sync_queue_v2"),null);
});
await test("permanent authorization rejection is retained without automatic retry",async()=>{
 let calls=0;const s=setup(async()=>{calls++;throw Object.assign(new Error("membership removed"),{code:"functions/permission-denied",details:{retryable:false}})});
 await s.repo.saveLocal(trip("permission"));await s.engine.synchronize();await s.engine.synchronize();assert.equal(calls,1);assert.equal(s.engine.getResult("permission")?.state,"FAILED");assert.ok(s.database.get("permission"));
});
await test("explicit server non-retryable overrides a transport-looking code",async()=>{
 let calls=0;const s=setup(async()=>{calls++;throw Object.assign(new Error("review"),{code:"functions/internal",details:{retryable:false}})});
 await s.repo.saveLocal(trip("nonretry"));await s.engine.synchronize();await s.engine.synchronize();assert.equal(calls,1);
});
await test("lost server response retries the same attempt and creates one ledger row",async()=>{
 const ledger=new Map();let first=true,calls=0;const s=setup(async t=>{calls++;ledger.set(t.tripId,t);if(first){first=false;throw Object.assign(new Error("lost ack"),{code:"functions/unavailable"});}return ack(t)});
 await s.repo.saveLocal(trip("lost-ack"));await s.engine.synchronize();assert.equal(s.engine.getResult("lost-ack")?.state,"PENDING_SYNC");
 await s.engine.retryRegistration("lost-ack");await s.engine.synchronize();assert.equal(ledger.size,1);assert.equal(calls,2);assert.equal(s.engine.getResult("lost-ack")?.trip.offlineReceiptKey,"receipt-lost-ack");
});
await test("restart resumes abandoned in-flight lease",async()=>{
 const storage=new StorageDouble(),t=trip("lease");storage.setItem("nvu_sync_queue_v2",JSON.stringify({lease:{trip:t,state:"SYNCING",attempts:1,queuedAt:"2026-10-20T00:00:00Z",syncingAt:"2026-10-20T00:00:00Z"}}));
 const s=setup(undefined,storage);await s.engine.synchronize();assert.equal(s.engine.getResult("lease")?.state,"SERVER_CONFIRMED");
});
await test("a nonexpired in-flight lease schedules eventual recovery",async()=>{
 const storage=new StorageDouble(),t=trip("live-lease");storage.setItem("nvu_sync_queue_v2",JSON.stringify({"live-lease":{trip:t,state:"SYNCING",attempts:1,queuedAt:new Date().toISOString(),syncingAt:new Date().toISOString()}}));
 const s=setup(undefined,storage);await s.engine.synchronize();assert.ok((s.engine as any).retryTimer);assert.equal(s.engine.getResult("live-lease")?.state,"SYNCING");
});
await test("offline registration remains durable then sends when connectivity returns",async()=>{
 let calls=0;const s=setup(async t=>{calls++;return ack(t)});(navigator as any).onLine=false;
 await s.repo.saveLocal(trip("offline"));await s.engine.synchronize();assert.equal(calls,0);(navigator as any).onLine=true;await s.engine.synchronize();assert.equal(calls,1);
});
await test("two concurrent taps preserve a single immutable attempt",async()=>{
 const s=setup();await Promise.all([s.repo.saveLocal(trip("tap")),s.repo.saveLocal(trip("tap"))]);assert.equal(s.engine.getPending().length,1);assert.equal(s.database.list().length,1);
});
await test("reusing an attempt with altered evidence is rejected",async()=>{
 const s=setup();await s.repo.saveLocal(trip("conflict"));await assert.rejects(()=>s.repo.saveLocal({...trip("conflict"),valor:999,valorCents:99900}),/ATTEMPT_CONFLICT/);
});
await test("a malformed old trip does not block a later valid trip",async()=>{
 const s=setup(async t=>{if(t.tripId==="bad")throw Object.assign(new Error("invalid"),{code:"functions/invalid-argument"});return ack(t)});
 await s.repo.saveLocal(trip("bad"));await s.repo.saveLocal(trip("good"));await s.engine.synchronize();assert.equal(s.engine.getResult("bad")?.state,"FAILED");assert.equal(s.engine.getResult("good")?.state,"SERVER_CONFIRMED");
});
await test("supported schema 1 upgrades without erasing receipt or command",async()=>{
 const storage=new StorageDouble();storage.setItem(OfflineDatabase.storageKey,JSON.stringify({schemaVersion:1,records:{schema1:record(trip("schema1"))}}));
 const s=setup(undefined,storage);await s.engine.synchronize();assert.equal(s.engine.getResult("schema1")?.trip.imageHash,"hash-schema1");assert.equal(JSON.parse(storage.getItem(OfflineDatabase.storageKey)!).schemaVersion,2);
});
await test("corrupt local bytes are preserved for recovery",async()=>{
 const storage=new StorageDouble();storage.setItem(OfflineDatabase.storageKey,"{broken");const s=setup(undefined,storage);await assert.rejects(()=>s.repo.saveLocal(trip("never")));assert.equal(storage.getItem(OfflineDatabase.storageKey),"{broken");
});
await test("confirmed history is compacted while every pending record survives",async()=>{
 const s=setup(), rows=[];for(let i=0;i<290;i++)rows.push({...record(trip("confirmed-"+i)),syncStatus:"SERVER_CONFIRMED" as const});rows.push(record(trip("keep-pending")) as any);
 s.database.saveMany(rows);assert.ok(s.database.get("keep-pending"));assert.equal(s.database.list().filter(r=>r.syncStatus==="SERVER_CONFIRMED").length,250);
});
await test("late server ACK cannot be lost after a local acknowledgement write failure",async()=>{
 let calls=0;const s=setup(async t=>{calls++;s.storage.failWrites=1;return ack(t)});await s.repo.saveLocal(trip("ack-disk"));await s.engine.synchronize();assert.equal(s.engine.getResult("ack-disk")?.state,"PENDING_SYNC");assert.equal(calls,1);
});
await test("deduplicated server alias does not recreate an orphan on the next synchronization",async()=>{
 let calls=0;const s=setup(async t=>{calls++;return {confirmed:true,tripId:"original-server-id",data:{...t,serverValidatedAt:"2026-10-23T15:00:00Z"}}});
 await s.repo.saveLocal(trip("alias-local"));await s.engine.synchronize();await s.engine.synchronize();assert.equal(calls,1);assert.equal(s.database.get("alias-local"),undefined);assert.ok(s.database.get("original-server-id"));
});
await test("account switch during a batch never sends the next owner's pending trip",async()=>{
 let uid="driver-505",calls=0;const s=setup(async t=>{calls++;uid="other";return ack(t)},new StorageDouble(),()=>({uid}));await s.repo.saveLocal(trip("switch-a"));await s.repo.saveLocal(trip("switch-b"));await s.engine.synchronize();assert.equal(calls,1);assert.equal(s.engine.getResult("switch-b")?.state,"PENDING_SYNC");
});
await test("read-only diagnostics use the migrated durable outbox",async()=>{
 const s=setup();await s.repo.saveLocal(trip("diagnostic"));assert.equal(readCanonicalOutboxSnapshot(s.storage).diagnostic.state,"PENDING_SYNC");
});
await test("transient failure retries automatically without a tap or reload",async()=>{
 let calls=0;const s=setup(async t=>{if(++calls===1)throw Object.assign(new Error("temporary outage"),{code:"functions/unavailable"});return ack(t)});
 await s.repo.saveLocal(trip("automatic-timer"));await s.engine.synchronize();await new Promise(r=>setTimeout(r,1500));
 assert.equal(calls,2);assert.equal(s.engine.getResult("automatic-timer")?.state,"SERVER_CONFIRMED");
});
await test("transport deadline releases a stuck attempt and automatic retry completes it",async()=>{
 let calls=0;const s=setup(async t=>{if(++calls===1)return await new Promise(()=>{});return ack(t)});
 await s.repo.saveLocal(trip("hung-request"));await s.engine.synchronize();await new Promise(r=>setTimeout(r,1500));assert.equal(calls,2);assert.equal(s.engine.getResult("hung-request")?.state,"SERVER_CONFIRMED");
});
await test("quota recovery compacts only acknowledged data and saves the pending receipt",async()=>{
 const storage=new StorageDouble();const s=setup(undefined,storage);s.database.saveMany(Array.from({length:40},(_,i)=>({...record(trip("quota-confirmed-"+i)),syncStatus:"SERVER_CONFIRMED"})) as any);
 const threshold=storage.getItem(OfflineDatabase.storageKey)!.length;const normalSet=storage.setItem.bind(storage);
 storage.setItem=(k,v)=>{if(v.length>threshold)throw Object.assign(new Error("QuotaExceededError"),{name:"QuotaExceededError"});normalSet(k,v);};
 await s.repo.saveLocal(trip("quota-pending"));assert.ok(s.database.get("quota-pending"));assert.equal(s.engine.getResult("quota-pending")?.state,"PENDING_SYNC");
});
await test("two supervisors share one live claim across browser tabs",async()=>{
 const storage=new StorageDouble();let calls=0;const push=async(t:any)=>{calls++;await new Promise(r=>setTimeout(r,30));return ack(t)};
 const a=setup(push,storage),b=setup(push,storage);let serial=Promise.resolve();
 (navigator as any).locks={request:(_key:string,fn:()=>any)=>{const result=serial.then(fn);serial=result.then(()=>{});return result;}};
 try {await a.repo.saveLocal(trip("two-tabs"));await Promise.all([a.engine.synchronize(),b.engine.synchronize()]);assert.equal(calls,1);}finally{delete (navigator as any).locks;}
});
await test("concurrent changed payload cannot split the record from its send command",async()=>{
 const s=setup();const a=trip("payload-race"),b={...trip("payload-race"),valor:999,valorCents:99900};
 const results=await Promise.allSettled([s.repo.saveLocal(a),s.repo.saveLocal(b)]);assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
 assert.equal(s.database.get("payload-race")?.trip.valor,s.engine.getResult("payload-race")?.trip.valor);
});
await test("new acknowledgement of an old pending trip survives confirmed-queue compaction",async()=>{
 const s=setup();const q:any={};for(let i=0;i<130;i++)q["old-confirmed-"+i]={trip:trip("old-confirmed-"+i),state:"SERVER_CONFIRMED",queuedAt:"2026-10-20T00:00:00Z"};
 q["old-pending"]={trip:trip("old-pending"),state:"PENDING_SYNC",attempts:0,queuedAt:"2020-01-01T00:00:00Z"};s.database.commitOutbox(q);
 await s.engine.synchronize();assert.equal(s.engine.getResult("old-pending")?.state,"SERVER_CONFIRMED");
});
await test("unknown authorization pause resumes only after an affirmative server access check",async()=>{
 let calls=0,allowed=false;const s=setup(async t=>{calls++;return ack(t)});await s.repo.saveLocal(trip("authorization-probe"));
 const q=s.database.readOutbox();q["authorization-probe"]={...q["authorization-probe"],state:"FAILED",lastError:"functions/permission-denied:temporary rules issue"};s.database.commitOutbox(q);
 (s.engine as any).adapter.authorizeRecovery=async()=>allowed;
 await s.engine.synchronize();await (s.engine as any).authorizationRecovery;assert.equal(calls,0);assert.equal(s.engine.getResult("authorization-probe")?.state,"FAILED");
 const q2=s.database.readOutbox();q2["authorization-probe"].lastAuthorizationProbeAt=0;s.database.commitOutbox(q2);allowed=true;
 await s.engine.synchronize();await (s.engine as any).authorizationRecovery;await s.engine.synchronize();assert.equal(calls,1);assert.equal(s.engine.getResult("authorization-probe")?.state,"SERVER_CONFIRMED");
});
await test("selecting a replacement receipt cannot delete pending or orphaned evidence",async()=>{
 const {isOfflineReceiptReferenced}=await import("../src/lib/offlineReceiptStore");const s=setup();await s.repo.saveLocal(trip("receipt-protection"));
 assert.equal(isOfflineReceiptReferenced("receipt-receipt-protection",s.storage),true);
 const journal=JSON.parse(s.storage.getItem(OfflineDatabase.storageKey)!);delete journal.outbox["receipt-protection"];s.storage.setItem(OfflineDatabase.storageKey,JSON.stringify(journal));
 assert.equal(isOfflineReceiptReferenced("receipt-receipt-protection",s.storage),true);
 assert.equal(isOfflineReceiptReferenced("unreferenced-image",s.storage),false);
 s.storage.setItem(OfflineDatabase.storageKey,"{broken");assert.equal(isOfflineReceiptReferenced("receipt-receipt-protection",s.storage),true);
});
await test("a slow old authorization repair does not block a freshly saved receipt", async () => {
  let release!: (allowed:boolean) => void; let sent = false;
  const s = setup(async t => { if(t.tripId === "fresh-520") sent = true; return ack(t); });
  await s.repo.saveLocal(trip("paused-520"));
  const q = s.database.readOutbox();
  q["paused-520"] = { ...q["paused-520"], state: "FAILED", lastError: "functions/permission-denied: old permission failure" };
  s.database.commitOutbox(q);
  (s.engine as any).adapter.authorizeRecovery = () => new Promise<boolean>(resolve => { release = resolve; });
  await s.repo.saveLocal(trip("fresh-520"));
  try {
    await s.engine.synchronize();
    assert.equal(sent, true);
    assert.equal(s.engine.getResult("paused-520")?.state, "FAILED");
    assert.equal(s.engine.getResult("fresh-520")?.state, "SERVER_CONFIRMED");
  } finally { release?.(false); await (s.engine as any).authorizationRecovery; }
});
fs.mkdirSync("reports/release-520",{recursive:true});fs.writeFileSync("reports/release-520/trip-recovery.json",JSON.stringify({productionAccess:false,transport:"controlled fault injection, actual repository/database/sync engine",checks:checks.length,passed:checks},null,2));
console.log("TRIP_RECOVERY_520_PASS",checks.length);
} finally { for(const engine of engines) if(engine.retryTimer) clearTimeout(engine.retryTimer); }
