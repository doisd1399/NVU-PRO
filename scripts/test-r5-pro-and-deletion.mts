import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";

// All adapters below are injected. No real credentials, Firebase reads/writes,
// native bridge call or Android device is used.
process.env.VITE_USE_FIREBASE_EMULATORS = "true";
process.env.VITE_FIREBASE_PROJECT_ID = "demo-nvu-v36-4-staging";
const root = resolve(process.env.NVU_TEST_SOURCE_ROOT || ".");
const load = (path: string) => import(pathToFileURL(resolve(root, path)).href);
const values = new Map<string, string>();
const storage = { getItem: (k: string) => values.get(k) || null,
  setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
Object.assign(globalThis, { localStorage: storage });
Object.defineProperty(globalThis, "navigator", { value: { onLine: false }, configurable: true });
const { CanonicalTripCommandService } = await load("src/application/trip/CanonicalTripCommandService.ts");
const { CanonicalTripRepository } = await load("src/repositories/CanonicalTripRepository.ts");
const { OfflineDatabase } = await load("src/services/offline/OfflineDatabase.ts");
const { TripRegistrationService } = await load("src/application/trip/TripRegistrationService.ts");
const { SyncEngine } = await load("src/services/sync/SyncEngine.ts");
const { isTripTombstoned } = await load("src/lib/tripTombstones.ts");
const presentation = await load("src/lib/proPendingPresentation.ts");
const old = process.env.NVU_EXPECT_R4 === "true";
let localRemovals=0, serverDeletes=0, settled=0, unrelatedSyncs=0;
const now = "2026-10-08T10:41:08.000Z";
const rows = ["synthetic-driver-alpha", "synthetic-driver-beta"].map((driverId,index) => ({
  id: "synthetic-delete-trip-"+index, tripId: "synthetic-delete-trip-"+index,
  canonicalTripId: "synthetic-delete-trip-"+index, physicalDocumentId: "synthetic-delete-trip-"+index,
  jobId: "synthetic-job-"+index, contractId: "synthetic-contract-"+index, companyId: "synthetic-company-"+index,
  driverId, status: "DELETED", deleted: true, deletedAt: now, serverValidatedAt: now, valor: 5750, valorCents: 575000,
}));
for (const row of rows) {
  // Real cache already holds the tombstone delivered by the realtime listener.
  const repository = new CanonicalTripRepository({ database: new OfflineDatabase({ storage }) });
  repository.applyServerSnapshot(TripRegistrationService.register(row), now);
  const gateway = { async remove(id: string) { localRemovals++; await repository.deleteLocal(id, row.driverId); } };
  const sync = {
    async deleteRemoteFirst(id: string) { serverDeletes++; return { confirmed: true, tripId: id, data: row }; },
    async acknowledgeServerDeletion() { settled++; },
    async synchronize() { unrelatedSyncs++; throw new Error("UNRELATED_QUEUE_FAILURE"); },
    getResult() { return undefined; },
  };
  const command = new CanonicalTripCommandService(gateway, {
    getCurrentUser: () => ({ uid: row.driverId }), isOffline: () => false, sync,
  });
  if (old) {
    await assert.rejects(command.deleteTrip(row.id), /CANONICAL_TRIP_NOT_FOUND/);
  } else {
    await command.deleteTrip(row.id);
    assert.equal(isTripTombstoned(row.id), true);
  }
}
const pending = { driverId: "synthetic-driver-alpha", attemptId: "synthetic-pro-attempt",
  queueStatus: "FAILED", retryAllowed: false, contractRecoveryAvailable: true,
  reasonCode: "GTO_SERVER_CONTRACT_MISMATCH" };
if (old) {
  assert.equal(presentation.presentProPendingTrip(pending).blocked, true);
  assert.equal(presentation.presentProPendingTrip(pending).recoveryAvailable, undefined);
  const result = { baseline: "R4 434", confirmedRemoteDeletions: serverDeletes, spuriousNotFound: localRemovals,
    recoveryButtonBlocked: true, realServerRequests: 0 };
  console.log(JSON.stringify(result));
  if (process.env.NVU_TEST_OUTPUT) writeFileSync(process.env.NVU_TEST_OUTPUT, JSON.stringify(result,null,2)+"\n");
} else {
  assert.equal(localRemovals,0,"Do not repeat local deletion after durable ACK");
  assert.equal(unrelatedSyncs,0,"Other queue entries must not turn server success into a delete error");
  assert.equal(settled,2);
  assert.equal(presentation.canShowProPendingRetry(pending,pending.driverId,true),true);
  assert.equal(presentation.canShowProPendingRetry(pending,"foreign-driver",true),false);
  assert.equal(presentation.canShowProPendingRetry(pending,pending.driverId,false),false);
  assert.equal(presentation.canShowProPendingRetry({...pending,contractRecoveryAvailable:false},pending.driverId,true),false);
  assert.equal(presentation.canShowProPendingRetry({...pending,queueStatus:"SENDING",queueClaimedAt:Date.now()},pending.driverId,true),false);
  assert.equal(presentation.pendingRetryFeedback("retry-backend-update-required").kind,"warning");
  const deniedId="synthetic-delete-denied";
  const denied = new CanonicalTripCommandService({ async remove() { throw new Error("must not be called"); } }, {
    getCurrentUser: () => ({ uid:"synthetic-driver-alpha" }), isOffline:()=>false,
    sync:{ async deleteRemoteFirst() { throw Object.assign(new Error("permission-denied"), {code:"permission-denied"}); },
      async synchronize(){return {};},getResult(){return undefined;}},
  });
  await assert.rejects(denied.deleteTrip(deniedId),/permission-denied/);
  assert.equal(isTripTombstoned(deniedId),false);
  const invalidId="synthetic-delete-invalid-ack";
  const invalid = new CanonicalTripCommandService({ async remove() { throw new Error("must not be called"); } }, {
    getCurrentUser:()=>({uid:"synthetic-driver-alpha"}),isOffline:()=>false,
    sync:{ async deleteRemoteFirst(){return {confirmed:true,tripId:invalidId,data:{deleted:true}};},
      async synchronize(){return {};},getResult(){return undefined;}},
  });
  await assert.rejects(invalid.deleteTrip(invalidId),/SERVER_TRIP_DELETE_ACK_INVALID/);
  assert.equal(isTripTombstoned(invalidId),false);
  const legacyId="synthetic-legacy-physical-id";
  const legacyRow={physicalDocumentId:legacyId,id:legacyId,tripId:"old-alias",
    motoristaId:"synthetic-driver-alpha",empresaId:"synthetic-company-alpha",
    deleted:true,status:"DELETED",deletedAt:now,valor:5750};
  const legacy = new CanonicalTripCommandService({async remove(){throw new Error("legacy cache may be absent");}},{
    getCurrentUser:()=>({uid:"synthetic-driver-alpha"}),isOffline:()=>false,
    sync:{async deleteRemoteFirst(){return {confirmed:true,tripId:legacyId,data:legacyRow};},
      async synchronize(){throw new Error("unrelated");},getResult(){return undefined;}},
  });
  await legacy.deleteTrip(legacyId);
  assert.equal(isTripTombstoned(legacyId),true,"Legacy deletion can finish without inventing a job");
  let pushes=0, updates=0;
  const queueValues=new Map<string,string>();
  const queueStorage={getItem:(key:string)=>queueValues.get(key)||null,setItem:(key:string,v:string)=>{queueValues.set(key,v);}};
  const database=new OfflineDatabase({storage:queueStorage});
  const engine=new SyncEngine({storage:queueStorage,offlineDatabase:database,getCurrentUser:()=>({uid:rows[0].driverId}),
    adapter:{async push(){pushes++;throw new Error("must not re-register deleted receipt");},
      async update(){updates++;throw new Error("must not edit tombstoned receipt");}}});
  const trip=TripRegistrationService.register({...rows[0],deleted:false,status:"PENDING_SYNC"});
  await engine.enqueue(trip);
  await engine.acknowledgeServerDeletion(rows[0].id,rows[0]);
  assert.equal(engine.getResult(rows[0].id)?.operation,"DELETE");
  assert.equal(engine.getResult(rows[0].id)?.state,"SERVER_CONFIRMED");
  Object.assign(navigator,{onLine:true});
  await engine.synchronize();
  assert.equal(pushes,0);assert.equal(updates,0);
  const editedRow={...rows[1],id:"synthetic-edit-then-delete",physicalDocumentId:"synthetic-edit-then-delete",
    canonicalTripId:"synthetic-edit-then-delete",tripId:"synthetic-edit-then-delete"};
  const beforeEdit=TripRegistrationService.register({...editedRow,deleted:false,status:"concluida"});
  await engine.enqueueUpdate(beforeEdit,{origem:"New origin"},rows[0].driverId,1,beforeEdit);
  assert.equal(engine.getResult(editedRow.id)?.operation,"UPDATE");
  assert.ok(engine.getResult(editedRow.id)?.editId);
  await engine.acknowledgeServerDeletion(editedRow.id,editedRow);
  assert.equal(engine.getResult(editedRow.id)?.operation,"DELETE");
  assert.equal(engine.getResult(editedRow.id)?.editId,undefined);
  assert.equal(engine.getResult(editedRow.id)?.editPatch,undefined);
  await engine.synchronize();
  assert.equal(updates,0,"A queued edit cannot run after the server deletion ACK");
  const result={candidate:"R5 source",ownersTested:2,serverAckPreserved:true,
    repeatedLocalDeletes:localRemovals,unrelatedQueueSyncs:unrelatedSyncs,
    permissionDenialPreserved:true,invalidAckRejected:true,legacyWithoutJobPreserved:true,
    staleUpsertAndEditCancelled:true,explicitRecoveryVisible:true,foreignOwnerAndOfflineBlocked:true,
    realServerRequests:0,androidDeviceExecution:false};
  console.log(JSON.stringify(result,null,2));
  if(process.env.NVU_TEST_OUTPUT)writeFileSync(process.env.NVU_TEST_OUTPUT,JSON.stringify(result,null,2)+"\n");
}
