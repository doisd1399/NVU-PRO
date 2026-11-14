import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createEmulatorReceipt } from "./helpers/emulatorReceipt";

const projectId = "demo-nvu-v36-4-staging";
assert.ok(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_STORAGE_EMULATOR_HOST);
assert.ok(String(process.env.GCLOUD_PROJECT || process.env.FIREBASE_CONFIG).includes(projectId));
const require = createRequire(import.meta.url);
const admin = require("../functions/lib/firebaseAdmin");
if (!admin.apps.length) admin.initializeApp({ projectId });
const { registerCanonicalSimpleTrip: simple } = require("../functions/lib/registerCanonicalSimpleTrip.js");
const { registerGtoProReceipt: pro } = require("../functions/lib/registerGtoProReceipt.js");
const db = admin.firestore();
const uid = "stability-driver-410", companyId = "stability-company-410", contractId = "stability-contract-410";
const auth = { uid };
let checks = 0;
let completed = false;
const watchdog = setTimeout(() => { console.error("TRIP_STABILITY_INCOMPLETE", checks); process.exit(1); }, 90_000);
const pass = (name: string) => { checks++; console.log(`PASS ${name}`); };
const seed = async (jobId: string, total = 12) => {
  await db.collection("users").doc(uid).set({ companyId });
  // Fixtures mirror the canonical membership boundary introduced in 501.
  await db.collection("companyMembers").doc(`${uid}_${companyId}`).set({ userId:uid,companyId,status:"active",roles:["driver"] });
  await db.doc(`company_access/${companyId}/members/${uid}`).set({ userId:uid,companyId,status:"active",roles:["driver"] });
  await db.collection("frotas").doc(companyId).set({ simulatorId: "gto" });
  await db.collection("contratos").doc(contractId).set({ companyId, totalDeliveries: total });
  await db.collection("trabalhos").doc(jobId).set({ companyId, driverId: uid, contractId, status: "active",
    progress: 0, totalDeliveries: total, dueAt: new Date(Date.now() - 86400000).toISOString(),
    vehicleId: "assigned-vehicle-410", vehicleName: "Veículo da operação", trailerId: "assigned-trailer-410" });
};
const print = async (jobId: string, suffix: string) => ({ trip: {
  canonicalTripId: `print:${jobId}:${suffix}`, idempotencyKey: `print:${jobId}:${suffix}`,
  driverId: uid, companyId, contractId, jobId, origem: "Lages", destino: "Areia Dourada",
  valor: 4099, valorCents: 409900, simulatorCode: "GTO", source: "PRINT_PRO_REGISTRATION",
  gtoEntryMode: "print", gtoReceiptAnalyzed: true, gtoRewardedAdDetected: false,
  receiptText: "Concluído\nValor a receber: R$ 4.099,00\nDobrar valor (ADS)",
  imageHash: `original-hash-${jobId}-${suffix}`,
  comprovanteUrl: await createEmulatorReceipt(admin, companyId, uid, `${jobId}-${suffix}`),
}});
const reject = async (action: () => Promise<unknown>, code: string) => assert.rejects(action, (error: any) => error.code === code);
const proInput = (jobId: string, attemptId: string, capturedAt = Date.now(), currency = "BRL") => ({
  driverId: uid, companyId, contractId, jobId, attemptId, contextEpoch: "global-truck:410:abcdef12",
  origin: "Lages", destination: "Areia Dourada", amountCents: 409900, currency,
  simulatorKey: "global-truck", simulatorCode: "GTO", packageId: "com.stargamesapps.gto",
  receiptText: `Concluído\nValor a receber: ${currency} 4.099,00\nReceber\nDobrar valor [ADS]`, bonusEvidence: "OFFER_ONLY", capturedAt,
});

try {
  const job = "stability-print-410";
  await seed(job);
  const input = await print(job, "one");
  const missing = { trip: { ...input.trip } };
  delete (missing.trip as any).imageHash; delete (missing.trip as any).comprovanteUrl;
  await reject(() => simple.run(missing, { auth }), "invalid-argument");
  await reject(() => simple.run({ trip: { ...input.trip, comprovanteUrl: "https://example.invalid/not-an-image" } }, { auth }), "invalid-argument");
  pass("Print requires its existing image upload, without adding a driver step");
  const foreignUrl = await createEmulatorReceipt(admin, companyId, "other-driver-410", "foreign");
  await reject(() => simple.run({ trip: { ...input.trip, comprovanteUrl: foreignUrl } }, { auth }), "permission-denied");
  pass("Receipt ownership checked independently of client flags");
  const created = await simple.run({ trip: { ...input.trip, veiculoId: "foreign-vehicle", reboqueId: "foreign-trailer" } }, { auth });
  const row = (await db.collection("historico_viagens").doc(created.tripId).get()).data();
  assert.equal(row.veiculoId, "assigned-vehicle-410"); assert.equal(row.reboqueId, "assigned-trailer-410");
  assert.equal(created.confirmedTripCount, 1);
  pass("Assigned assets come from the operation; GTO registers without distance after visual deadline");
  const duplicate = { trip: { ...input.trip, canonicalTripId: `${input.trip.canonicalTripId}-changed`,
    idempotencyKey: `${input.trip.idempotencyKey}-changed`, imageHash: "different-client-hash" } };
  await reject(() => simple.run(duplicate, { auth }), "already-exists");
  pass("One Storage object cannot create another trip by changing request ID and hash");
  const storedKey = row.storageReceiptKey;
  const split = storedKey.indexOf("/");
  await admin.storage().bucket(storedKey.slice(0, split)).file(storedKey.slice(split + 1)).delete();
  const replay = await simple.run(input, { auth });
  assert.equal(replay.tripId, created.tripId); assert.equal(replay.confirmedTripCount, 1);
  pass("Lost ACK stays replayable after an old image becomes unavailable");

  const proJob = "stability-pro-410";
  await seed(proJob);
  const capture = proInput(proJob, "pro-original-410", Date.now() - 3000);
  const first = await pro.run(capture, { auth });
  const retry = await pro.run({ ...capture, attemptId: "pro-regenerated-410" }, { auth });
  assert.equal(first.tripId, retry.tripId); assert.equal(retry.progress, 1);
  assert.equal((await pro.run({ ...capture, attemptId: "pro-regenerated-410" }, { auth })).progress, 1);
  const next = await pro.run({ ...capture, attemptId: "pro-next-trip-410", capturedAt: capture.capturedAt + 1000 }, { auth });
  assert.notEqual(next.tripId, first.tripId); assert.equal(next.progress, 2);
  pass("Same Pro capture is idempotent; a new capture with identical route and value is allowed");
  await db.collection("historico_viagens").doc(first.tripId).update({ deleted: true, status: "DELETED" });
  await reject(() => pro.run({ ...capture, attemptId: "pro-deleted-replay-410" }, { auth }), "failed-precondition");
  pass("Capture retry never resurrects deleted history");
  await db.collection("users").doc(uid).set({ operationalSuspension: { endsAt: admin.firestore.Timestamp.fromMillis(Date.now() + 60000) } });
  await reject(() => pro.run(proInput(proJob, "pro-suspended-410"), { auth }), "permission-denied");
  await reject(async () => simple.run(await print(proJob, "suspended"), { auth }), "permission-denied");
  pass("Print and Pro use the same suspension formats");

  const simpleJob = "stability-simple-410";
  await seed(simpleJob);
  await db.doc(`frotas/${companyId}`).update({simulatorId:"toe3"});
  await db.doc(`contratos/${contractId}`).update({simulatorId:"toe3"});
  const capturedAt = Date.now() - 1000;
  const payload = { canonicalTripId: "simple-stability-410", idempotencyKey: "simple-stability-410",
    driverId: uid, companyId, contractId, jobId: simpleJob, origem: "A", destino: "B", valor: 6547, valorCents: 654700,
    source: "simple_auto", simpleAutomation: true, simulatorKey: "toe-3", simulatorCode: "TOE3",
    simpleReceiptCurrency: "USD", simpleReceiptResultScreenConfirmed: true, simpleReceiptBonusEvidence: "NONE",
    receiptText: "RENDA TOTAL: USD 6,547", simpleReceiptCaptureAttemptId: "simple-attempt-410",
    simpleReceiptCaptureContextEpoch: "toe-3:410:abcdefgh", simpleReceiptCapturedAt: capturedAt };
  const simpleFirst = await simple.run({ trip: payload }, { auth });
  const simpleRetry = await simple.run({ trip: { ...payload, canonicalTripId: "simple-retry-410", idempotencyKey: "simple-retry-410",
    simpleReceiptCaptureAttemptId: "simple-attempt-retry-410" } }, { auth });
  assert.equal(simpleRetry.tripId, simpleFirst.tripId); assert.equal(simpleRetry.confirmedTripCount, 1);
  assert.equal((await db.collection("historico_viagens").doc(simpleFirst.tripId).get()).get("simpleReceiptCurrency"), "USD");
  await reject(() => simple.run({ trip: { ...payload, valor: 1, valorCents: 100 } }, { auth }), "invalid-argument");
  pass("TOE3 currency may vary; original capture and receipt amount are preserved on retry");

  const raceJob = "stability-last-slot-410";
  await seed(raceJob, 1);
  const [one, two] = await Promise.all([print(raceJob, "one"), print(raceJob, "two")]);
  const race = await Promise.allSettled([simple.run(one, { auth }), simple.run(two, { auth })]);
  assert.equal(race.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await db.collection("trabalhos").doc(raceJob).get()).get("progress"), 1);
  assert.equal((await db.collection("trabalhos").doc(raceJob).get()).get("status"), "awaiting_completion");
  pass("Concurrent last-slot submissions commit one trip and reach the manual completion gate atomically");
  console.log(`TRIP_STABILITY_PASS ${checks} scenarios; no physical-device tests`);
  completed = true;
} finally { clearTimeout(watchdog); await admin.deleteApp(admin.app()); }
assert.equal(completed, true);
