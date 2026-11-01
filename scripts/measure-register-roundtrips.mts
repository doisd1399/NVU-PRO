import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Counts the database round trips of the real registerGtoProReceipt (emulator) and simulates the cross-continent latency by
// delaying every Firestore RPC. Sequential round trips = the elapsed time divided by the delay. Used before/after speed changes.
const projectId = "demo-nvu-v36-4-staging";
assert.ok(process.env.FIRESTORE_EMULATOR_HOST);
const require = createRequire(import.meta.url);
const admin = require("../functions/lib/firebaseAdmin");
if (!admin.apps.length) admin.initializeApp({ projectId });
const firestoreModule = require("../functions/node_modules/@google-cloud/firestore");
const { registerGtoProReceipt: pro } = require("../functions/lib/registerGtoProReceipt.js");
const DELAY_MS = Number(process.env.RTT_MS || 100);
let rpcs: string[] = [], delaying = false;
const FirestoreClass = firestoreModule.Firestore;
const originalRequest = FirestoreClass.prototype.request, originalStream = FirestoreClass.prototype.requestStream;
FirestoreClass.prototype.request = function (method: string, ...rest: any[]) {
  if (!delaying) return originalRequest.call(this, method, ...rest);
  rpcs.push(method); return new Promise(resolve => setTimeout(resolve, DELAY_MS)).then(() => originalRequest.call(this, method, ...rest));
};
FirestoreClass.prototype.requestStream = function (method: string, ...rest: any[]) {
  if (!delaying) return originalStream.call(this, method, ...rest);
  rpcs.push(method);
  return new Promise(resolve => setTimeout(resolve, DELAY_MS)).then(() => originalStream.call(this, method, ...rest));
};
const db = admin.firestore();
const uid = "measure-driver", companyId = "measure-company", contractId = "measure-contract", auth = { uid };
const seed = async (jobId: string) => {
  await db.collection("users").doc(uid).set({ companyId });
  await db.collection("companyMembers").doc(`${uid}_${companyId}`).set({ userId: uid, companyId, status: "active", roles: ["driver"] });
  await db.doc(`company_access/${companyId}/members/${uid}`).set({ userId: uid, companyId, status: "active", roles: ["driver"] });
  await db.collection("frotas").doc(companyId).set({ simulatorId: "gto" });
  await db.collection("contratos").doc(contractId).set({ companyId, totalDeliveries: 12 });
  await db.collection("trabalhos").doc(jobId).set({ companyId, driverId: uid, contractId, status: "active", progress: 0, totalDeliveries: 12,
    operationReconciliationVersion: 4, dueAt: new Date(Date.now() - 86400000).toISOString(), vehicleId: "v", vehicleName: "V", trailerId: "t" });
};
const input = (jobId: string, attemptId: string) => ({ driverId: uid, companyId, contractId, jobId, attemptId, contextEpoch: "global-truck:410:abcdef12",
  origin: "Lages", destination: "Areia Dourada", amountCents: 409900, currency: "BRL", simulatorKey: "global-truck", simulatorCode: "GTO",
  packageId: "com.stargamesapps.gto", receiptText: "Concluído\nValor a receber: BRL 4.099,00\nReceber\nDobrar valor [ADS]", bonusEvidence: "OFFER_ONLY", capturedAt: Date.now() });
async function measure(label: string, call: () => Promise<any>) {
  rpcs = []; delaying = true; const started = performance.now();
  const result = await call(); const elapsed = performance.now() - started; delaying = false;
  const waves = Math.round(elapsed / DELAY_MS);
  console.log(JSON.stringify({ label, rpcCalls: rpcs.length, sequentialRoundTrips: waves, elapsedMs: Math.round(elapsed), assumedRttMs: DELAY_MS, duplicate: result.duplicate }));
  return { rpcs: rpcs.length, waves, result };
}
const job = `measure-job-${Date.now()}`;
await seed(job);
const first = await measure("new trip", () => pro.run(input(job, "attempt-measure-0001"), { auth }));
assert.equal(first.result.registered, true); assert.equal(first.result.duplicate, false);
const replay = await measure("replay of the same attempt (lost ACK)", () => pro.run(input(job, "attempt-measure-0001"), { auth }));
assert.equal(replay.result.duplicate, true);
const second = await measure("second trip of the operation", () => pro.run(input(job, "attempt-measure-0002"), { auth }));
assert.equal(second.result.duplicate, false);
// Regression guard: registering a trip used to take 11 sequential round trips (14 on the first call of an instance) and 6 for a replay.
// Each one costs ~170-250 ms between us-central1 and the São Paulo database, so these ceilings protect the speed gained.
assert.ok(first.waves <= 9, `first call: ${first.waves} sequential round trips`);
assert.ok(second.waves <= 6, `steady state: ${second.waves} sequential round trips`);
assert.ok(replay.waves <= 6, `replay: ${replay.waves} sequential round trips`);
console.log("MEASURE_REGISTER_ROUNDTRIPS_DONE");
process.exit(0);
