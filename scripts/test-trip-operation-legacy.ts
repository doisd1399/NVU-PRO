import assert from "node:assert/strict";
import fs from "node:fs";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { Timestamp, doc, getDocFromServer, setDoc } from "firebase/firestore";
import { CanonicalTripOperationService } from "../src/application/trip/CanonicalTripOperationService";
import { FirebaseTripSyncAdapter } from "../src/services/sync/FirebaseTripSyncAdapter";

const projectId = "demo-nvu-v36-4-staging";
const uid = "legacy-operation-driver";
const companyId = "legacy-operation-company";
const jobId = "legacy-operation-job";
const tripId = "legacy-operation-trip-no-slot";
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Firestore Emulator is required.");
if (!String(process.env.GCLOUD_PROJECT || process.env.FIREBASE_CONFIG || "").includes(projectId)) {
  throw new Error(`This test is isolated to ${projectId}.`);
}

const env = await initializeTestEnvironment({
  projectId,
  firestore: { rules: fs.readFileSync("firestore.rules", "utf8") },
});
try {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users", uid), { role: "driver", companyId });
    await setDoc(doc(db, "trabalhos", jobId), {
      motoristaId: uid,
      empresaId: companyId,
      contratoId: "legacy-operation-contract",
      simuladorId: "truck-sim",
      status: "active",
      totalDeliveries: 12,
      progress: 1,
    });
    await setDoc(doc(db, "historico_viagens", tripId), {
      canonicalTripId: tripId,
      tripId,
      jobId,
      operationId: jobId,
      driverId: uid,
      motoristaId: uid,
      criadoPor: uid,
      companyId,
      empresaId: companyId,
      contratoId: "legacy-operation-contract",
      contractId: "legacy-operation-contract",
      simuladorId: "truck-sim",
      status: "concluida",
      valor: 125.5,
      completedAt: Timestamp.fromMillis(Date.now() - 60_000),
      source: "simple_auto",
      uploadedAt: Timestamp.fromMillis(Date.now() - 60_000),
      syncStatus: "synced",
      serverValidatedAt: Timestamp.fromMillis(Date.now() - 60_000),
      syncVersion: 3,
    });
    await setDoc(doc(db, "trabalhos", "legacy-slot-conflict-job"), {
      motoristaId: uid,
      empresaId: companyId,
      contratoId: "legacy-slot-conflict-contract",
      status: "active",
      totalDeliveries: 12,
      progress: 1,
    });
    await setDoc(doc(db, "historico_viagens", "legacy-slot-conflict-trip"), {
      canonicalTripId: "legacy-slot-conflict-trip",
      tripId: "legacy-slot-conflict-trip",
      jobId: "legacy-slot-conflict-job",
      operationId: "legacy-slot-conflict-job",
      driverId: uid,
      motoristaId: uid,
      criadoPor: uid,
      empresaId: companyId,
      contratoId: "legacy-slot-conflict-contract",
      status: "concluida",
      serverValidatedAt: Timestamp.fromMillis(Date.now() - 60_000),
      syncVersion: 1,
    });
    await setDoc(doc(db, "trip_operation_slots", "legacy-slot-conflict-trip"), {
      tripId: "legacy-slot-conflict-trip",
      jobId: "legacy-slot-conflict-job",
      driverId: uid,
      operationSlot: 1,
      deleted: true,
      deletedAt: Timestamp.fromMillis(Date.now() - 30_000),
    });
  });

  const db = env.authenticatedContext(uid).firestore();
  const getCurrentUser = () => ({ uid });
  const operationService = new CanonicalTripOperationService({ firestore: db, getCurrentUser });
  let reconciliationRequested = false;
  const adapter = new FirebaseTripSyncAdapter({
    firestore: db,
    getCurrentUser,
    reconcileOperation: async ({ jobId: requestedJobId }) => {
      assert.equal(requestedJobId, jobId);
      reconciliationRequested = true;
    },
  });

  const before = await operationService.readAuthoritativeOperationState(jobId, 12);
  assert.equal(before.currentCount, 1, "legacy operationId/motoristaId trip must be included exactly once");
  assert.equal(before.progress, 1);
  assert.equal(before.reconciliationRequired, false);

  const deletion = await adapter.delete({
    canonicalTripId: tripId,
    tripId,
    jobId,
    operationId: jobId,
    driverId: uid,
    companyId,
    contractId: "legacy-operation-contract",
  } as any);
  assert.equal(deletion.confirmed, true);
  const deletedTrip = await getDocFromServer(doc(db, "historico_viagens", tripId));
  const reconciledJob = await getDocFromServer(doc(db, "trabalhos", jobId));
  assert.equal(deletedTrip.data()?.deleted, true);
  assert.equal(deletedTrip.data()?.status, "DELETED");
  assert.equal(reconciledJob.data()?.progress, 1, "client deletion must not mutate the server projection counter");
  assert.equal(reconciliationRequested, true, "deletion must request server-side projection reconciliation");
  const after = await operationService.readAuthoritativeOperationState(jobId, 12);
  assert.equal(after.currentCount, 0);
  assert.equal(after.progress, 0);
  assert.equal(after.reconciliationRequired, false);
  console.log("PASS: authoritative progress includes operationId/motoristaId legacy records; common no-slot deletion tombstones and delegates projection reconciliation");

  await assert.rejects(
    adapter.delete({ canonicalTripId: "legacy-slot-conflict-trip", tripId: "legacy-slot-conflict-trip", operationId: "legacy-slot-conflict-job" } as any),
    /CANONICAL_TRIP_OPERATION_SLOT_INCONSISTENT/,
  );
  const conflictTrip = await getDocFromServer(doc(db, "historico_viagens", "legacy-slot-conflict-trip"));
  const conflictJob = await getDocFromServer(doc(db, "trabalhos", "legacy-slot-conflict-job"));
  assert.notEqual(conflictTrip.data()?.deleted, true);
  assert.equal(conflictJob.data()?.progress, 1);
  console.log("PASS: deleted slot + active trip inconsistency is rejected without changing trip or progress");
} finally {
  await env.cleanup();
}
