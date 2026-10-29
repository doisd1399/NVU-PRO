import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDocFromServer } from "firebase/firestore";
import { buildCanonicalTripRegistrationRequest } from "../src/services/sync/CanonicalTripRegistrationRequest";
import { TripRegistrationService } from "../src/application/trip/TripRegistrationService";
import { FirebaseTripSyncAdapter } from "../src/services/sync/FirebaseTripSyncAdapter";
import { SyncEngine } from "../src/services/sync/SyncEngine";
import { OfflineDatabase } from "../src/services/offline/OfflineDatabase";
import { createEmulatorReceipt } from "./helpers/emulatorReceipt";

const projectId = "demo-nvu-v36-4-staging";
assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "An isolated Firestore Emulator is required");
assert.ok(String(process.env.GCLOUD_PROJECT || process.env.FIREBASE_CONFIG).includes(projectId));
for (const key of ["FIRESTORE_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST"]) {
  assert.match(String(process.env[key] || ""), /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/, `${key} must use loopback`);
}
const require = createRequire(import.meta.url);
const admin = require("../functions/lib/firebaseAdmin");
if (!admin.apps.length) admin.initializeApp({ projectId });
const db = admin.firestore();
db.settings({ host: process.env.FIRESTORE_EMULATOR_HOST, ssl: false });
const { registerCanonicalSimpleTrip: simple } = require("../functions/lib/registerCanonicalSimpleTrip.js");
const { registerGtoProReceipt: pro } = require("../functions/lib/registerGtoProReceipt.js");
const { reconcileOperationTrips: reconcile } = require("../functions/lib/reconcileOperationTrips.js");
const { completeCanonicalOperation: complete } = require("../functions/lib/completeCanonicalOperation.js");
const { readGtoReceiptAmountCents } = require("../functions/lib/gtoReceiptValidation.js");
const { settleCanonicalOperationCompletion: settleCompletion } = require("../functions/lib/finalizeCanonicalOperation.js");
const uid = "audit-driver-409", companyId = "audit-company-409", contractId = "audit-contract-409";
const auth = { uid };
const emulatorAddress = new URL(`http://${process.env.FIRESTORE_EMULATOR_HOST}`);
const environment = await initializeTestEnvironment({ projectId, firestore: {
  host: emulatorAddress.hostname, port: Number(emulatorAddress.port), rules: fs.readFileSync("firestore.rules", "utf8"),
} });
const driverDb = environment.authenticatedContext(uid).firestore();
let checks = 0;
const pass = (name: string) => { checks++; console.log(`PASS ${name}`); };
const get = async (collection: string, id: string) => (await db.collection(collection).doc(id).get()).data();
const seed = async (jobId: string, slots: number[] = [], total = 12, reportedCount = slots.length) => {
  await db.collection("users").doc(uid).set({ role: "driver", companyId, name: "Motorista teste" });
  // Fixtures mirror the canonical membership boundary introduced in 501.
  await db.collection("companyMembers").doc(`${uid}_${companyId}`).set({ userId:uid,companyId,status:"active",roles:["driver"] });
  await db.doc(`company_access/${companyId}/members/${uid}`).set({ userId:uid,companyId,status:"active",roles:["driver"] });
  await db.collection("frotas").doc(companyId).set({ companyId, simulatorId: "gto", companyName: "Empresa teste" });
  await db.collection("contratos").doc(contractId).set({ companyId, totalDeliveries: total, name: "Contrato teste" });
  await db.collection("trabalhos").doc(jobId).set({ companyId, driverId: uid, contractId,
    status: "active", progress: reportedCount, totalDeliveries: total,
    operationReconciliationVersion: 4, operationProgressReconciled: true,
    operationProjectionSource: "test-seed-canonical-v3" });
  for (const slot of slots) {
    const id = `${jobId}-history-${slot}`;
    await db.collection("historico_viagens").doc(id).set({ tripId: id, jobId, operationId: jobId,
      companyId, driverId: uid, contractId, operationSlot: slot, status: "concluida", source: "gto_auto",
      uploadedAt: admin.firestore.Timestamp.now(),
      serverValidatedAt: admin.firestore.Timestamp.now(), valor: 101, valorCents: 10100 });
  }
};
const print = (jobId: string, suffix: string, amount = 30515) => TripRegistrationService.register({
  tripId: `print:${jobId}:${uid}:${suffix}`, idempotencyKey: `print:${jobId}:${uid}:${suffix}`,
  companyId, empresaId: companyId, driverId: uid, motoristaId: uid, contractId, contratoId: contractId,
  jobId, operationId: jobId, origem: "Registro", destino: "Cruz do Oeste", valor: amount,
  source: "PRINT_PRO_REGISTRATION", status: "REGISTERED_LOCAL", empresaNome: "Client name",
  motoristaNome: "Client driver", simulatorId: "arbitrary-catalog-id", simulatorCode: "GTO",
  imageHash: `hash-${jobId}-${suffix}`, comprovanteUrl: `https://example.invalid/${jobId}/${suffix}.jpg`,
  criadoPor: uid, uploadedBy: uid, deviceId: "audit", valorBloqueadoPorDeteccao: true,
  gtoEntryMode: "print", gtoReceiptAnalyzed: true, gtoReceiptValidationMode: "ocr",
  gtoReceiptManualConfirmation: false, gtoRewardedAdDetected: false, gtoReceiptReviewRequired: false,
  receiptText: `Concluído\nValor a receber: R$ ${Number(amount).toLocaleString("pt-BR", {minimumFractionDigits:2})}\nDobrar valor (ADS)`,
  createdAtLocal: new Date(Date.now() - 86400000).toISOString(), completedAtLocal: new Date(Date.now() - 86400000).toISOString(),
} as any);
const gto = (jobId: string, attemptId: string, amountCents = 409900) => ({ driverId: uid,
  jobId, companyId, contractId, attemptId, contextEpoch: "global-truck:409:abcdef12",
  origin: "Lages", destination: "Faz Areia Dourada", simulatorKey: "global-truck", simulatorCode: "GTO",
  packageId: "com.stargamesapps.gto", amountCents, currency: "BRL", bonusEvidence: "OFFER_ONLY",
  receiptText: `Concluído\nValor a receber: R$ ${(amountCents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}\nReceber\nDobrar valor [ADS]`,
  capturedAt: Date.now() - 86400000,
});
const callPrint = async (trip: any) => {
  if (trip.comprovanteUrl?.startsWith("https://example.invalid/")) {
    trip.comprovanteUrl = await createEmulatorReceipt(admin, companyId, uid, trip.tripId);
  }
  return simple.run(buildCanonicalTripRegistrationRequest(trip, trip.comprovanteUrl), { auth });
};
const reject = async (action: () => Promise<any>, code: string) => assert.rejects(action, (error: any) => error.code === code);

try {
  for (const value of [1, 10100, 99999, 409900, 3051500]) {
    assert.equal(readGtoReceiptAmountCents(gto("dummy-job", "dummy-attempt", value).receiptText), value);
  }
  assert.equal(readGtoReceiptAmountCents("Valor a receber R$ 4.099,00\nValor dobrado"), null);
  assert.equal(readGtoReceiptAmountCents("Valor a receber R$ 4.099,00\nBônus vídeo ADS: 10,00"), null);
  pass("ADS offer accepted; actual bonus rejected; positive low values preserved");

  const jobId = "audit-operation-409";
  await seed(jobId, Array.from({ length: 9 }, (_, i) => i + 1));
  const trip = print(jobId, "print10");
  const request = buildCanonicalTripRegistrationRequest(trip as any, (trip as any).comprovanteUrl);
  for (const key of ["status", "recordStatus", "deleted", "operationalIdentity", "createdAt", "syncStatus", "criadoPor", "deviceId", "gtoReceiptReviewRequired"]) {
    assert.equal(key in request.trip, false, key);
  }
  assert.equal(request.trip.valorCents, 3051500);
  const created = await callPrint(trip);
  assert.equal(created.confirmedTripCount, 10);
  const serverTrip = await get("historico_viagens", trip.tripId);
  assert.equal(serverTrip.valorCents, 3051500);
  assert.equal(serverTrip.empresaNome, "Empresa teste");
  assert.equal(serverTrip.createdAtLocal, (trip as any).createdAtLocal);
  assert.ok((await getDocFromServer(doc(driverDb, "historico_viagens", trip.tripId))).exists());
  pass("Actual Print payload accepted by callable; owner Rules, cents and offline dates preserved");

  await db.collection("trabalhos").doc(jobId).update({ lastValidatedTripId: trip.tripId, progress: 999 });
  const receipt = gto(jobId, "audit-attempt-11");
  const registered = await pro.run(receipt, { auth });
  assert.equal(registered.progress, 11);
  assert.equal((await get("historico_viagens", trip.tripId)).deleted, undefined);
  assert.equal((await pro.run(receipt, { auth })).duplicate, true);
  assert.equal((await callPrint(trip)).confirmedTripCount, 11);
  pass("Print → Pro and replay count from confirmed history; no prior trip replacement");

  const final = await callPrint(print(jobId, "final12", 101));
  assert.equal(final.confirmedTripCount, 12);
  assert.equal(final.jobStatus, "awaiting_completion");
  assert.equal((await get("trabalhos", jobId)).status, "awaiting_completion");
  assert.equal((await complete.run({ jobId }, { auth })).status, "completed");
  assert.equal(await settleCompletion(db, jobId), true);
  assert.equal((await get("trabalhos", jobId)).status, "completed");
  await reject(() => callPrint(print(jobId, "over-limit")), "failed-precondition");
  assert.equal((await pro.run(receipt, { auth })).progress, 12);
  pass("Final trip reaches manual completion gate; callable finalizes atomically; lost ACK remains idempotent; excess blocked");

  await reject(() => simple.run({ trip: { ...request.trip, status: "concluida" } }, { auth }), "invalid-argument");
  await reject(() => simple.run(request, { auth: { uid: "another-driver" } }), "permission-denied");
  await reject(() => simple.run(request, { auth: null }), "unauthenticated");
  await reject(() => simple.run({ trip: { ...request.trip, valorCents: 1 } }, { auth }), "invalid-argument");
  await db.collection("historico_viagens").doc(trip.tripId).update({ deleted: true, status: "DELETED" });
  await reject(() => callPrint(trip), "permission-denied");
  pass("Forbidden server fields, foreign actor, missing auth, amount mismatch and deleted replay blocked");

  const gapJob = "audit-gap-operation";
  await seed(gapJob, [1, 3]);
  const gap = await pro.run(gto(gapJob, "audit-gap-attempt"), { auth });
  assert.equal((await get("historico_viagens", gap.tripId)).operationSlot, 2);
  assert.equal(gap.progress, 3);
  pass("Deletion gap allocated without collision; slot is independent of counter");

  const orphanJob = "audit-orphan-operation";
  await seed(orphanJob, [1, 2], 12, 50);
  await db.collection("trip_operation_slots").doc("audit-orphan-7").set({ jobId: orphanJob,
    driverId: uid, companyId, contractId, tripId: "missing-audit-history", operationSlot: 7 });
  assert.equal((await reconcile.run({ jobId: orphanJob }, { auth })).status, "repaired");
  assert.equal((await get("trip_operation_slots", "audit-orphan-7")).deleted, true);
  await db.collection("trabalhos").doc(orphanJob).update({ status: "cancelled", progress: 90 });
  await reconcile.run({ jobId: orphanJob }, { auth });
  assert.equal((await get("trabalhos", orphanJob)).status, "cancelled");
  pass("Verified orphan reclaimed at arbitrary slot; cancelled operation never reopened");

  // Regression: a same-job row from an interrupted/old writer may exist without
  // canonical server proof. It must stay available for audit, but neither the row
  // nor its derived slot claim may permanently veto the next valid Pro receipt.
  const staleJob = "audit-stale-noncanonical-operation";
  await seed(staleJob, Array.from({ length: 10 }, (_, i) => i + 1), 12, 10);
  const staleTripId = `${staleJob}-stale-11`;
  await db.collection("historico_viagens").doc(staleTripId).set({
    tripId: staleTripId, canonicalTripId: staleTripId, jobId: staleJob, operationId: staleJob,
    companyId, driverId: uid, contractId, operationSlot: 11, status: "validation_failed",
    recordStatus: "validation_failed", source: "gto_auto", valor: 42538, valorCents: 4253800,
  });
  await db.collection("trip_operation_slots").doc(staleTripId).set({
    jobId: staleJob, driverId: uid, companyId, contractId, tripId: staleTripId, operationSlot: 11, schemaVersion: 4,
  });
  const repairedStale = await reconcile.run({ jobId: staleJob }, { auth });
  assert.notEqual(repairedStale.status, "conflict");
  assert.equal((await get("trip_operation_slots", staleTripId)).deleted, true);
  assert.equal((await get("historico_viagens", staleTripId)).deleted, undefined, "audit row must be preserved");
  const stale11 = await pro.run(gto(staleJob, "audit-stale-attempt-11", 911500), { auth });
  assert.equal(stale11.progress, 11);
  assert.equal((await get("historico_viagens", stale11.tripId)).operationSlot, 11);
  const stale12 = await pro.run(gto(staleJob, "audit-stale-attempt-12", 4253800), { auth });
  assert.equal(stale12.progress, 12);
  assert.equal(stale12.jobStatus, "awaiting_completion");
  assert.equal((await get("trabalhos", staleJob)).status, "awaiting_completion");
  assert.equal((await complete.run({ jobId: staleJob }, { auth })).status, "completed");
  assert.equal((await get("trabalhos", staleJob)).status, "completed");
  pass("Same-job noncanonical debris cannot deadlock slots 11/12; receipt is preserved and operation completes");

  const raceJob = "audit-race-operation";
  await seed(raceJob, [], 1);
  const race = await Promise.allSettled([callPrint(print(raceJob, "race-print")), pro.run(gto(raceJob, "audit-race-attempt"), { auth })]);
  assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await get("trabalhos", raceJob)).progress, 1);
  assert.equal((await db.collection("historico_viagens").where("jobId", "==", raceJob).get()).size, 1);
  pass("Concurrent Print/Pro cannot claim the last delivery twice");

  const toeJob = "audit-toe-operation";
  await seed(toeJob, [], 2);
  await db.doc(`frotas/${companyId}`).update({simulatorId:"toe3"});
  await db.doc(`contratos/${contractId}`).update({simulatorId:"toe3"});
  const toe = { ...request.trip, tripId: "toe-audit-trip", canonicalTripId: "toe-audit-trip",
    jobId: toeJob, operationId: toeJob, idempotencyKey: "toe-audit-attempt", source: "simple_auto",
    simpleAutomation: true, simulatorKey: "toe-3", simulatorCode: "TOE3", valor: 50, valorCents: 5000,
    simpleReceiptCurrency: "EUR", simpleReceiptResultScreenConfirmed: true, simpleReceiptBonusEvidence: "NONE", receiptText:"RENDA TOTAL: EUR 50,00" };
  for (const key of ["imageHash", "comprovanteUrl", "gtoEntryMode"]) delete toe[key as keyof typeof toe];
  assert.equal((await simple.run({ trip: toe }, { auth })).registered, true);
  pass("Native Simple payload and TOE3 EUR accepted without client status fields");

  const unknownCurrencyJob = "audit-toe-unknown-currency-operation";
  await seed(unknownCurrencyJob, [], 2);
  await db.doc(`frotas/${companyId}`).update({simulatorId:"toe3"});
  await db.doc(`contratos/${contractId}`).update({simulatorId:"toe3"});
  const toeUnknownCurrency = { ...toe, tripId: "toe-unknown-currency-trip", canonicalTripId: "toe-unknown-currency-trip",
    jobId: unknownCurrencyJob, operationId: unknownCurrencyJob, idempotencyKey: "toe-unknown-currency-attempt",
    simpleReceiptCaptureAttemptId: "toe-unknown-currency-capture", simpleReceiptCaptureContextEpoch: "toe-unknown-currency-epoch",
    simpleReceiptCapturedAt: Date.now(), simpleReceiptCurrency: "", receiptText: "RENDA TOTAL: 50,00" };
  const unknownCurrencyAck = await simple.run({ trip: toeUnknownCurrency }, { auth });
  const unknownCurrencyTrip = await get("historico_viagens", unknownCurrencyAck.tripId);
  assert.equal(unknownCurrencyAck.registered, true);
  assert.equal(unknownCurrencyAck.confirmedTripCount, 1);
  assert.equal(unknownCurrencyTrip.currency, undefined);
  assert.equal(unknownCurrencyTrip.simpleReceiptCurrency, undefined);
  assert.equal(unknownCurrencyTrip.currencyEvidenceStatus, "unknown");
  assert.equal(unknownCurrencyTrip.currencyEvidenceVersion, 1);
  assert.equal((await get("trabalhos", unknownCurrencyJob)).progress, 1);
  pass("Simple receipt with no currency token stays a confirmed counted trip; aliases omitted and UNKNOWN is server-marked");

  const queueJob = "audit-queue-operation";
  await seed(queueJob, [], 3);
  const queued = print(queueJob, "offline");
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value); } };
  let uploadConfirmed = false, loseAck = true;
  const adapter = new FirebaseTripSyncAdapter({ firestore: driverDb, getCurrentUser: () => auth,
    loadOfflineReceipt: async () => ({ key: "receipt-offline", userId: uid, companyId, blob: new Blob(["receipt"]), fileName: "receipt.png", contentType: "image/png" }),
    uploadReceipt: async () => createEmulatorReceipt(admin, companyId, uid, "receipt-offline"),
    markReceiptUploaded: async () => { uploadConfirmed = true; },
    registerCanonicalTrip: async (data) => { assert.equal(uploadConfirmed, true); return { data: await simple.run(data, { auth }) }; },
  });
  const engine = new SyncEngine({ storage, offlineDatabase: new OfflineDatabase({ storage }), getCurrentUser: () => auth,
    adapter: { push: async (value) => { const result = await adapter.push(value); if (loseAck) { loseAck = false; throw Object.assign(new Error("Lost ACK"), { code: "functions/unavailable" }); } return result; } } });
  await engine.enqueue({ ...queued, offlineReceiptKey: "receipt-offline", comprovanteUrl: "" } as any);
  await engine.synchronize();
  assert.equal(engine.getResult(queued.tripId)?.state, "PENDING_SYNC");
  const journal = JSON.parse(values.get(OfflineDatabase.storageKey)!);
  const queue = journal.outbox;
  assert.ok(Date.parse(queue[queued.tripId].retryAt) > Date.now(), "lost ACK must use backoff");
  queue[queued.tripId].retryAt = new Date(Date.now() - 1).toISOString();
  values.set(OfflineDatabase.storageKey, JSON.stringify({ ...journal, outbox: queue }));
  await engine.synchronize();
  assert.equal(engine.getResult(queued.tripId)?.state, "SERVER_CONFIRMED");
  assert.equal((await get("trabalhos", queueJob)).progress, 1);
  pass("Offline receipt upload precedes registration; lost ACK replays same identity once");

  const old = print(queueJob, "old-protocol");
  (old as any).comprovanteUrl = await createEmulatorReceipt(admin, companyId, uid, old.tripId);
  values.delete(OfflineDatabase.storageKey);
  values.set("nvu_sync_queue_v2", JSON.stringify({ [old.tripId]: { trip: old, operation: "UPSERT", state: "FAILED", attempts: 1, queuedAt: new Date().toISOString(), lastError: "functions/invalid-argument" } }));
  const recovering = new SyncEngine({ storage, offlineDatabase: new OfflineDatabase({ storage }), getCurrentUser: () => auth,
    adapter: new FirebaseTripSyncAdapter({ firestore: driverDb, getCurrentUser: () => auth, registerCanonicalTrip: async (data) => ({ data: await simple.run(data, { auth }) }) }) });
  await recovering.synchronize();
  assert.equal(recovering.getResult(old.tripId)?.state, "SERVER_CONFIRMED");
  pass("Previously rejected Print request recovers automatically after protocol update");

  const completionJob = "audit-completion-resources";
  await seed(completionJob, [], 1);
  await db.collection("frotas").doc(companyId).update({ ownerId: "audit-owner-409" });
  await db.collection("companyMembers").doc("audit-admin").set({ companyId, userId: "audit-admin-409", roles: ["admin"], status: "active" });
  await db.collection("companyMembers").doc("audit-inactive-admin").set({ companyId, userId: "audit-inactive-409", roles: ["admin"], status: "inactive" });
  await db.collection("veiculos").doc("audit-vehicle").set({ companyId, status: "in_use" });
  await db.collection("reboques").doc("audit-shared-trailer").set({ companyId, status: "in_use" });
  await db.collection("trabalhos").doc(completionJob).update({ vehicleId: "audit-vehicle", trailerId: "audit-shared-trailer" });
  await db.collection("contratos").doc("audit-other-contract").set({ companyId, trailerId: "audit-shared-trailer" });
  await db.collection("trabalhos").doc("audit-other-live-job").set({ companyId, contractId: "audit-other-contract", status: "active" });
  const finalPro = await pro.run(gto(completionJob, "audit-final-pro-attempt", 10100), { auth });
  assert.equal(finalPro.jobStatus, "awaiting_completion");
  assert.equal((await complete.run({ jobId: completionJob }, { auth })).status, "completed");
  assert.equal(await settleCompletion(db, completionJob), true);
  assert.equal((await get("veiculos", "audit-vehicle")).status, "available");
  assert.equal((await get("reboques", "audit-shared-trailer")).status, "in_use", "a shared resource remains occupied");
  const notifications = await db.collection("notifications").where("metadata.jobId", "==", completionJob).get();
  assert.equal(notifications.size, 2, "only the company owner and active admin are notified");
  await notifications.docs[0].ref.update({ read: true });
  assert.equal(await settleCompletion(db, completionJob), false);
  assert.equal((await notifications.docs[0].ref.get()).get("read"), true, "replay must not reset a read notification");
  pass("Final native Pro closes operation; server releases scoped vehicle, protects shared trailer and deduplicates corporate notices");

  const invalidCompletionJob = "audit-unconfirmed-completion";
  await seed(invalidCompletionJob, [], 1);
  await db.collection("trabalhos").doc(invalidCompletionJob).update({ status: "completed", operationStatusUpdatedByCanonicalGateway: true, vehicleId: "audit-vehicle" });
  await db.collection("veiculos").doc("audit-vehicle").update({ status: "in_use" });
  assert.equal(await settleCompletion(db, invalidCompletionJob), false);
  assert.equal((await get("veiculos", "audit-vehicle")).status, "in_use");
  pass("Unconfirmed counter/status cannot release operational resources");
  console.log(`TRIP_SUBMISSION_AUDIT_PASS ${checks} scenario groups on real Firestore Emulator`);
} finally {
  await environment.cleanup();
  await Promise.all(admin.apps.map((app: any) => app.delete()));
}
