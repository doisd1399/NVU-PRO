import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Counts the sequential database round trips of the real operationalCommand transaction (emulator) while every Firestore RPC
// is delayed. Each round trip costs ~170-250 ms between us-central1 and the São Paulo database, so fewer waves = faster cancel/start.
const projectId = "demo-nvu-v36-4-staging";
assert.ok(process.env.FIRESTORE_EMULATOR_HOST);
const require = createRequire(import.meta.url);
const admin = require("../functions/lib/firebaseAdmin");
if (!admin.apps.length) admin.initializeApp({ projectId });
const firestoreModule = require("../functions/node_modules/@google-cloud/firestore");
const { executeOperationalCommand } = require("../functions/lib/operationalCommands.js");
const { refreshCompanyAccess } = require("../functions/lib/companyAccess.js");
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
const owner = { auth: { uid: "owner-a", token: {} } }, driver = { auth: { uid: "driver-a", token: {} } };
const rows: [string, any][] = [
  ["frotas/a", { ownerId: "owner-a", userId: "owner-a", simulatorId: "GTO", status: "active", operationalCommandVersion: 1 }],
  ["users/owner-a", { companyId: "a", role: "admin", status: "active" }],
  ["users/driver-a", { role: "driver", companyId: "a", status: "active" }],
  ["companyMembers/driver-a_a", { userId: "driver-a", companyId: "a", roles: ["driver"], status: "active" }],
  ["simulator_members/driver-a_a", { userId: "driver-a", companyId: "a", roles: ["driver"], status: "active" }],
  ["contratos/contract-a", { companyId: "a", name: "Operação A", simulator: "GTO", mode: "simple", totalDeliveries: 1, deadlineDays: 3, trailerId: "trailer-a", status: "active" }],
  ["veiculos/vehicle-a", { companyId: "a", name: "Caminhão A", plate: "ABC", status: "available" }],
  ["reboques/trailer-a", { companyId: "a", name: "Reboque A", status: "available" }],
];
for (const [ref, data] of rows) await db.doc(ref).set(data);
for (const uid of ["owner-a", "driver-a"]) await refreshCompanyAccess(db, uid, "a");
let n = 0;
const run = (args: any, actor: any) => executeOperationalCommand(db, { ...args, requestId: `measure-${++n}` }, actor);
async function measure(label: string, call: () => Promise<any>) {
  rpcs = []; delaying = true; const started = performance.now();
  const result = await call(); const elapsed = performance.now() - started; delaying = false;
  const waves = Math.round(elapsed / DELAY_MS);
  console.log(JSON.stringify({ label, rpcCalls: rpcs.length, sequentialRoundTrips: waves, elapsedMs: Math.round(elapsed), assumedRttMs: DELAY_MS }));
  return { waves, result };
}
const assigned = await run({ action: "assign", companyId: "a", contractId: "contract-a", driverId: "driver-a", vehicleId: "vehicle-a", trailerId: "trailer-a" }, owner);
const start = await measure("start", () => run({ action: "start", companyId: "a", jobId: assigned.jobId }, driver));
assert.equal(start.result.job.status, "active");
const cancel = await measure("cancel", () => run({ action: "cancel", companyId: "a", jobId: assigned.jobId }, owner));
assert.equal(cancel.result.job.status, "cancelled");
// Regression guard. Before v36 a cancel took 8 sequential round trips and a start 12 (journal, company/actor/membership,
// authorization, job, driver state, contract, live jobs, assets... one after the other). They must not grow back.
assert.ok(cancel.waves <= 5, `cancel: ${cancel.waves} sequential round trips`);
assert.ok(start.waves <= 8, `start: ${start.waves} sequential round trips`);
console.log("MEASURE_OPERATIONAL_COMMAND_ROUNDTRIPS_DONE");
process.exit(0);
