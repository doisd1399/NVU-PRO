import assert from "node:assert/strict";
import admin from "../functions/node_modules/firebase-admin/lib/index.js";
import { reconcileOperationTripsCore } from "../functions/lib/reconcileOperationTrips.js";
import { decideReconciledProgress } from "../functions/lib/operationReconciliationPolicy.js";
import fs from "node:fs";

const projectId = "demo-nvu-v36-4-staging";
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("FIRESTORE_EMULATOR_HOST obrigatório");
admin.initializeApp({ projectId });
const db = admin.firestore();
const uid = "driver-emulator-412";
const now = new Date("2026-09-10T12:00:00.000Z");
const operationId = "operation-3-plus-9-412";
const operation = {
  driverId: uid, companyId: "company-412", contractId: "contract-412",
  assignedAt: new Date("2026-09-01T00:00:00.000Z"), status: "active",
  totalDeliveries: 12, progress: 3, operationReconciliationVersion: 2,
};

async function clearPrefix(prefix) {
  const snap = await db.collection(prefix).get();
  if (snap.empty) return;
  const batch = db.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}
async function seedThreePlusNine() {
  await clearPrefix("historico_viagens");
  await clearPrefix("trip_operation_slots");
  await clearPrefix("trabalhos");
  await clearPrefix("trip_reconciliation_audits");
  await db.collection("trabalhos").doc(operationId).set(operation);
  const batch = db.batch();
  for (let i = 1; i <= 12; i += 1) {
    const ref = db.collection("historico_viagens").doc(`trip-412-${i}`);
    const data = {
      driverId: uid, companyId: "company-412", contractId: "contract-412",
      status: "concluida", recordStatus: "concluida", source: "gto_auto",
      uploadedAt: new Date(now.getTime() + i * 1000), completedAt: now,
      serverValidatedAt: new Date(now.getTime() + i * 1000), operationSlot: i,
    };
    if (i <= 3) Object.assign(data, { jobId: operationId, operationId });
    batch.set(ref, data);
    if (i <= 3) batch.set(db.collection("trip_operation_slots").doc(ref.id), {
      jobId: operationId, operationId, driverId: uid, tripId: ref.id, operationSlot: i,
    });
  }
  await batch.commit();
}

await seedThreePlusNine();
const result = await reconcileOperationTripsCore(db, uid, operationId);
assert.equal(result.legacyRecoveredCount, 0, "viagens GTO sem jobId não podem receber vínculo automático");
assert.equal(result.confirmedCount, 3);
assert.equal(result.serverProgress, 3);
assert.equal(result.lifecycleStatus, "active");
const job = (await db.collection("trabalhos").doc(operationId).get()).data();
assert.equal(job.progress, 3);
assert.equal(job.operationReconciliationVersion, 4);
assert.equal(job.status, "active");
const allTrips = await db.collection("historico_viagens").where("driverId", "==", uid).get();
assert.equal(allTrips.size, 12);
assert.equal(allTrips.docs.filter((doc) => doc.data().jobId === operationId).length, 3);
assert.equal(allTrips.docs.filter((doc) => !doc.data().jobId).length, 9);
assert.equal(allTrips.docs.filter((doc) => Number(doc.data().operationSlot) > 12).length, 0);

// A: an incomplete query cannot downgrade persisted 12 to 3.
const incomplete = decideReconciledProgress({ reportedProgress: 12, confirmedCount: 3, safeDecreaseEvidence: false, hasConflict: false });
assert.equal(incomplete.nextProgress, 12);
assert.equal(incomplete.canRepairProgress, false);
// B: a proven deletion permits 12 -> 11.
const deletion = decideReconciledProgress({ reportedProgress: 12, confirmedCount: 11, safeDecreaseEvidence: true, hasConflict: false });
assert.equal(deletion.nextProgress, 11);
assert.equal(deletion.canRepairProgress, true);

// B2: after an exhaustive v4 server scan with no ambiguity, a stale denormalized
// counter must self-heal instead of leaving users permanently stuck at 2 vs 0.
const staleCounterId = "operation-stale-counter-412";
await db.collection("trabalhos").doc(staleCounterId).set({ ...operation, contractId: "contract-empty-412", totalDeliveries: 4, progress: 2, operationReconciliationVersion: 3 });
const staleCounterResult = await reconcileOperationTripsCore(db, uid, staleCounterId);
assert.equal(staleCounterResult.status, "repaired");
assert.equal(staleCounterResult.confirmedCount, 0);
assert.equal(staleCounterResult.serverProgress, 0);
assert.equal((await db.collection("trabalhos").doc(staleCounterId).get()).data().progress, 0);

// C: a terminal operation is never reopened.
const terminalId = "operation-terminal-412";
await db.collection("trabalhos").doc(terminalId).set({ ...operation, status: "completed", progress: 3 });
const terminalResult = await reconcileOperationTripsCore(db, uid, terminalId);
assert.notEqual(terminalResult.lifecycleStatus, "active");
assert.equal((await db.collection("trabalhos").doc(terminalId).get()).data().status, "completed");

// D: the same legacy trip matching two operations remains unbound; the current
// operation may safely reconcile its own canonical count without attaching it.
const ambiguousA = "operation-ambiguous-a-412";
const ambiguousB = "operation-ambiguous-b-412";
await db.collection("trabalhos").doc(ambiguousA).set({ ...operation, status: "active", progress: 0 });
await db.collection("trabalhos").doc(ambiguousB).set({ ...operation, status: "active", progress: 0 });
const ambiguousRef = db.collection("historico_viagens").doc("trip-ambiguous-412");
await ambiguousRef.set({ driverId: uid, companyId: "company-412", contractId: "contract-412", status: "concluida", recordStatus: "concluida", source: "gto_auto", uploadedAt: now, completedAt: now });
const ambiguousResult = await reconcileOperationTripsCore(db, uid, ambiguousA);
assert.equal(ambiguousResult.status, "repaired");
assert.equal((await ambiguousRef.get()).data().jobId, undefined);

// E: a canonical row written by an older compatibility path without a slot
// claim must be incorporated into the v4 slot ledger automatically.
const slotUid = "driver-slot-ledger-412";
const slotJobId = "operation-slot-ledger-412";
const slotTripId = "trip-slot-ledger-412";
await db.collection("trabalhos").doc(slotJobId).set({
  driverId: slotUid, companyId: "company-slot-412", contractId: "contract-slot-412",
  assignedAt: new Date("2026-09-01T00:00:00.000Z"), status: "active",
  totalDeliveries: 4, progress: 0, operationReconciliationVersion: 4,
});
await db.collection("historico_viagens").doc(slotTripId).set({
  driverId: slotUid, motoristaId: slotUid, companyId: "company-slot-412", empresaId: "company-slot-412",
  contractId: "contract-slot-412", contratoId: "contract-slot-412",
  jobId: slotJobId, operationId: slotJobId, trabalhoId: slotJobId,
  status: "concluida", recordStatus: "concluida", source: "canonical_app",
  serverValidatedAt: now, uploadedAt: now, completedAt: now,
});
const slotRepair = await reconcileOperationTripsCore(db, slotUid, slotJobId);
assert.equal(slotRepair.status, "repaired");
assert.equal(slotRepair.confirmedCount, 1);
assert.equal(slotRepair.serverProgress, 1);
assert.equal(slotRepair.slotLedgerRepairedCount, 1);
const repairedSlotTrip = (await db.collection("historico_viagens").doc(slotTripId).get()).data();
const repairedSlotClaim = (await db.collection("trip_operation_slots").doc(slotTripId).get()).data();
assert.equal(repairedSlotTrip.operationSlot, 1);
assert.equal(repairedSlotTrip.operationSlotKey, slotTripId);
assert.equal(repairedSlotClaim.jobId, slotJobId);
assert.equal(repairedSlotClaim.operationSlot, 1);
assert.equal(repairedSlotClaim.schemaVersion, 4);

// F: Print, Pro, generic Web/offline and GTO must converge on the canonical server ledger.
const gtoSource = fs.readFileSync("functions/src/gtoTrips.ts", "utf8");
const proSource = fs.readFileSync("functions/src/registerGtoProReceipt.ts", "utf8");
const printSource = fs.readFileSync("functions/src/registerCanonicalSimpleTrip.ts", "utf8");
assert.match(gtoSource, /reconcileOperationTripsCore/);
assert.match(proSource, /operationReconciliationVersion: 4/);
assert.match(printSource, /operationReconciliationVersion: 4/);
assert.match(printSource, /const isGeneric = !isPrint && !isSimple/);

console.log("OPERATION_FINALIZATION_EMULATOR_PASS canonical 3/12; legacy-unbound 9 excluded; stale 2→0; missing slot ledger rebuilt; A-F invariants PASS; terminal preserved; ambiguity blocked");
await admin.deleteApp(admin.app());
