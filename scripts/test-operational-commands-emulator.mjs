import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from "firebase/firestore";

const projectId = "demo-nvu-v36-4-staging";
assert.equal(process.env.GCLOUD_PROJECT, projectId, "Only the disposable demo project is allowed");
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^127\.0\.0\.1:\d+$/);
const require = createRequire(new URL("../functions/package.json", import.meta.url));
const admin = require(process.cwd()+"/functions/lib/firebaseAdmin.js");
if (!admin.apps.length) admin.initializeApp({ projectId });
const { executeOperationalCommand, prepareCompanyOperationalCommands, settleOperationalAssignment,
  operationalDriverStateId, operationalCompletionId } = require("./lib/operationalCommands.js");
const { completeCanonicalOperation } = require("./lib/completeCanonicalOperation.js");
const { registerGtoTrip } = require("./lib/gtoTrips.js");
const { settleCanonicalOperationCompletion } = require("./lib/finalizeCanonicalOperation.js");
const environment = await initializeTestEnvironment({ projectId, firestore: { rules: fs.readFileSync("firestore.rules", "utf8") } });
const db = admin.firestore();
const ctx = (uid, token = {}) => ({ auth: { uid, token } });
const owner = ctx("owner-a"), driver = ctx("driver-a"), driver2 = ctx("driver-b");
let sequence = 0;
const command = (args, actor = owner, requestId = `request-${++sequence}`) => executeOperationalCommand(db, { ...args, requestId }, actor);
const assign = (args = {}, actor = owner, requestId) => command({ action: "assign", companyId: "a", contractId: "contract-a", driverId: "driver-a",
  vehicleId: "vehicle-a", trailerId: "trailer-a", ...args }, actor, requestId);
const start = (jobId, actor = driver, requestId) => command({ action: "start", companyId: "a", jobId }, actor, requestId);
const cancel = jobId => command({ action: "cancel", companyId: "a", jobId });
const state = uid => db.doc(`operationalDriverStates/${operationalDriverStateId("a", uid)}`);
const progress = (uid = "driver-a") => db.doc(`driverOperationCompletions/${operationalCompletionId("a", uid, "contract-a")}`);
const denied = (fn, code = "permission-denied") => assert.rejects(fn, error => String(error.code).includes(code));
const client = uid => environment.authenticatedContext(uid).firestore();
const seed = async () => {
  await environment.clearFirestore();
  const rows = [
    ["frotas/a", { ownerId: "owner-a", userId: "owner-a", simulatorId: "GTO", status: "active", operationalCommandVersion: 1 }],
    ["frotas/b", { ownerId: "owner-b", userId: "owner-b", simulatorId: "GTO", operationalCommandVersion: 1 }],
    ["frotas/legacy", { ownerId: "owner-a", userId: "owner-a", simulatorId: "GTO" }],
    ["sequencias/a", { companyId: "a", name: "A" }], ["sequencias/b", { companyId: "b", name: "B" }],
    ["users/owner-a", { companyId: "a", role: "admin", status: "active" }],
    ["users/owner-b", { companyId: "b", role: "admin", status: "active" }],
    ["users/profile-admin-a", { companyId: "a", role: "admin", status: "active" }],
    ["companyMembers/profile-admin-a_a", { companyId: "a", userId: "profile-admin-a", roles: ["admin", "driver"], status: "active" }],
    ["users/member-admin", { companyId: "a", role: "driver", status: "active" }],
    ["users/senior", { role: "driver", status: "active" }],
    ["companyMembers/member-admin-a", { companyId: "a", userId: "member-admin", roles: ["admin"], status: "active" }],
    ["contratos/contract-a", { companyId: "a", name: "Operação A", simulator: "GTO", mode: "simple", totalDeliveries: 1, deadlineDays: 3, trailerId: "trailer-a", status: "active" }],
    ["contratos/contract-b", { companyId: "b", name: "Operação B", simulator: "GTO", mode: "simple", totalDeliveries: 1, deadlineDays: 3, status: "active" }],
    ["veiculos/vehicle-a", { companyId: "a", name: "Caminhão A", plate: "ABC", status: "available" }],
    ["veiculos/vehicle-a2", { companyId: "a", name: "Caminhão 2", status: "available" }],
    ["veiculos/vehicle-b", { companyId: "b", name: "Caminhão B", status: "available" }],
    ["reboques/trailer-a", { companyId: "a", name: "Reboque A", status: "available" }],
    ["reboques/trailer-b", { companyId: "b", name: "Reboque B", status: "available" }],
  ];
  for (const uid of ["driver-a", "driver-b"]) rows.push(
    [`users/${uid}`, { role: "driver", companyId: "a", status: "active" }],
    [`companyMembers/${uid}_a`, { userId: uid, companyId: "a", roles: ["driver"], status: "active" }],
    [`simulator_members/${uid}_a`, { userId: uid, companyId: "a", roles: ["driver"], status: "active" }],
  );
  const batch = db.batch();
  rows.forEach(([ref, data]) => batch.set(db.doc(ref), data));
  await batch.commit();
  // The Functions emulator is not started: explicitly run the real 501
  // projection that would be produced by membership triggers in production.
  const { refreshCompanyAccess } = require("./lib/companyAccess.js");
  for (const uid of ["owner-a", "driver-a", "driver-b", "member-admin", "profile-admin-a"])
    if ((await db.doc(`users/${uid}`).get()).exists) await refreshCompanyAccess(db, uid, "a");

};
const addReceipt = async (jobId, uid = "driver-a") => db.doc(`historico_viagens/trip-${jobId}`).set({
  jobId, operationId: jobId, companyId: "a", empresaId: "a", driverId: uid, motoristaId: uid, contractId: "contract-a",
  status: "concluida", recordStatus: "concluida", source: "gto_auto", operationSlot: 1, operationSlotKey: `trip-${jobId}`,
  serverValidatedAt: new Date(), uploadedAt: new Date(), completedAt: new Date(),
});
const results = [];
async function test(name, fn) {
  const started = performance.now();
  try {
    await seed(); await fn(); results.push({ name, result: "PASS", seconds: +((performance.now() - started) / 1000).toFixed(3) });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, result: "FAIL", error: error.stack });
    console.error(`FAIL ${name}`, error);
  }
}
try {
  await test("scope: canonical company admin cannot edit or take over another company", async () => {
    const a = client("profile-admin-a");
    await updateDoc(doc(a, "sequencias/a"), { name: "Within scope" });
    await denied(() => updateDoc(doc(a, "sequencias/b"), { name: "Attack" }));
    await denied(() => updateDoc(doc(a, "frotas/b"), { ownerId: "profile-admin-a" }));
    await denied(() => updateDoc(doc(a, "users/profile-admin-a"), { companyId: "b" }));
    await denied(() => assign({ companyId: "b", contractId: "contract-b" }, ctx("profile-admin-a")));
  });
  await test("opt-in: dry-run is read-only, server activation is scoped and client flag changes denied", async () => {
    const before = (await db.doc("frotas/legacy").get()).data();
    const check = await prepareCompanyOperationalCommands.run({ companyId: "legacy" }, owner);
    assert.equal(check.ready, true); assert.equal(check.enabled, false);
    assert.deepEqual((await db.doc("frotas/legacy").get()).data(), before);
    await denied(() => prepareCompanyOperationalCommands.run({ companyId: "b", enable: true }, owner));
    await denied(() => updateDoc(doc(client("owner-a"), "frotas/legacy"), { operationalCommandVersion: 1 }));
    await prepareCompanyOperationalCommands.run({ companyId: "legacy", enable: true }, owner);
    assert.equal((await db.doc("frotas/legacy").get()).get("operationalCommandVersion"), 1);
    await db.doc("frotas/legacy").update({ operationalCommandVersion: 2 });
    await denied(() => prepareCompanyOperationalCommands.run({ companyId: "legacy", enable: true }, owner), "failed-precondition");
  });
  await test("opt-in: conflicting executions and noncanonical scopes prevent activation", async () => {
    const base = { companyId: "legacy", driverId: "driver-a", contractId: "contract-a", vehicleId: "vehicle-a", status: "active" };
    await Promise.all([db.doc("trabalhos/old-1").set(base), db.doc("trabalhos/old-2").set(base),
      db.doc("trabalhos/old-3").set({ ...base, status: "pending", vehicleId: null, veiculoId: "vehicle-a" }),
      db.doc("trabalhos/old-4").set({ ...base, status: " active " })]);
    const check = await prepareCompanyOperationalCommands.run({ companyId: "legacy" }, owner);
    assert.equal(check.ready, false); assert.equal(check.conflicts[0].jobIds.length, 3);
    assert.deepEqual(check.invalidScopes.sort(), ["old-3", "old-4"]);
    await denied(() => prepareCompanyOperationalCommands.run({ companyId: "legacy", enable: true }, owner), "failed-precondition");
    assert.equal((await db.doc("frotas/legacy").get()).get("operationalCommandVersion"), undefined);
  });
  await test("idempotency: concurrent retries allocate exactly one job and review demand once", async () => {
    await db.doc("jobDemands/demand-a").set({ companyId: "a", driverId: "driver-a", status: "pending" });
    const replies = await Promise.all([assign({}, owner, "same-request"), assign({}, owner, "same-request")]);
    assert.equal(replies[0].jobId, replies[1].jobId);
    assert.equal((await db.collection("trabalhos").get()).size, 1);
    assert.equal((await state("driver-a").get()).get("assignmentRevision"), 1);
    assert.equal((await db.doc("jobDemands/demand-a").get()).get("status"), "reviewed");
    await denied(() => assign({ vehicleId: "vehicle-a2" }, owner, "same-request"), "failed-precondition");
    assert.equal((await assign({}, owner, "same-request")).replayed, true);
  });
  await test("manual dispatch: multiple pending jobs and intentional repeat remain supported", async () => {
    const first = await assign(), second = await assign();
    assert.notEqual(first.jobId, second.jobId);
    await start(first.jobId);
    const third = await assign(); assert.equal(third.job.status, "pending");
    assert.equal((await state("driver-a").get()).get("currentJobId"), first.jobId);
    await denied(() => start(second.jobId), "failed-precondition");
  });
  await test("authority: driver, foreign manager and unauthenticated dispatch are rejected", async () => {
    await denied(() => assign({}, driver)); await denied(() => assign({}, ctx("owner-b")));
    await denied(() => executeOperationalCommand(db, {}, {}), "unauthenticated");
    assert.equal((await assign({}, ctx("member-admin"))).job.status, "pending");
    assert.equal((await assign({}, ctx("senior", { senior: true }))).job.status, "pending");
  });
  await test("eligibility: inactive canonical membership defeats stale active projection", async () => {
    const job = await assign();
    await db.doc("companyMembers/driver-a_a").update({ status: "inactive" });
    await denied(() => start(job.jobId)); await denied(() => assign());
    assert.equal((await db.doc(`trabalhos/${job.jobId}`).get()).get("status"), "pending");
  });
  await test("eligibility: suspended and inactive accounts cannot receive/start work", async () => {
    const job = await assign();
    await db.doc("users/driver-a").update({ operationalSuspendedUntil: admin.firestore.Timestamp.fromMillis(Date.now() + 600_000) });
    await denied(() => start(job.jobId));
    await db.doc("users/driver-a").update({ operationalSuspendedUntil: admin.firestore.FieldValue.delete(), status: "inactive" });
    await denied(() => start(job.jobId)); await denied(() => assign());
  });
  await test("maintenance: starts are paused if all compatible work modes are disabled", async () => {
    const job = await assign();
    await db.doc("settings/system").set({ workModeAvailability: { print: { enabled: false }, pro: { enabled: false }, max: { enabled: false } } });
    await denied(() => start(job.jobId), "failed-precondition");
    assert.equal((await db.doc(`trabalhos/${job.jobId}`).get()).get("status"), "pending");
  });
  await test("resources: foreign operation/vehicle/trailer and maintenance are rejected", async () => {
    await denied(() => assign({ contractId: "contract-b" }), "failed-precondition");
    await denied(() => assign({ vehicleId: "vehicle-b" }), "failed-precondition");
    await denied(() => assign({ trailerId: "trailer-b" }), "failed-precondition");
    const job = await assign();
    await db.doc("veiculos/vehicle-a").update({ status: "maintenance" });
    await denied(() => start(job.jobId), "failed-precondition");
    await db.doc("veiculos/vehicle-a").update({ status: "available" });
    await db.doc("reboques/trailer-a").update({ status: "maintenance" });
    await denied(() => start(job.jobId), "failed-precondition");
  });
  await test("snapshot: mode, target, route, name, trailer and vehicle stay fixed after catalog edit", async () => {
    const job = await assign();
    await db.doc("contratos/contract-a").update({ name: "Edited", mode: "detailed", totalDeliveries: 2, deadlineDays: 1,
      deliveries: [{ origin: "X", destination: "Y" }, { origin: "Y", destination: "Z" }], trailerId: null });
    await db.doc("veiculos/vehicle-a").update({ name: "Renamed" });
    const result = await start(job.jobId);
    assert.equal(result.job.contractSnapshot.mode, "simple"); assert.equal(result.job.totalDeliveries, 1);
    assert.equal(result.job.contractNameSnapshot, "Operação A"); assert.equal(result.job.trailerId, "trailer-a");
    assert.equal(result.job.vehicleId, "vehicle-a"); assert.equal(result.job.vehicleName, "Caminhão A");
    assert.equal(result.job.dueAt, job.job.dueAt);
  });
  await test("snapshot: invalid route/target/deadline never creates a partial assignment", async () => {
    await db.doc("contratos/contract-a").update({ mode: "detailed", totalDeliveries: 2, deliveries: [{ origin: "X", destination: "Y" }] });
    await denied(() => assign(), "failed-precondition");
    await db.doc("contratos/contract-a").update({ mode: "simple", totalDeliveries: 0 });
    await denied(() => assign(), "failed-precondition");
    await db.doc("contratos/contract-a").update({ totalDeliveries: 1 });
    await denied(() => assign({ deadlineDays: -1 }), "invalid-argument");
    assert.equal((await db.collection("trabalhos").get()).size, 0);
  });
  await test("GTO writer: edited catalog cannot change assigned mode, capacity, name or null trailer", async () => {
    await db.doc("contratos/contract-a").update({ trailerId: null });
    const a = await assign({ trailerId: null }); await start(a.jobId);
    await db.doc("contratos/contract-a").update({ name: "Changed", mode: "detailed", totalDeliveries: 9, trailerId: "trailer-a" });
    const payload = { contractVersion: 18, sessionId: "managed-gto-session-1", driverId: "driver-a", companyId: "a", jobId: a.jobId,
      contractId: "contract-a", contractMode: "simple", vehicleId: "vehicle-a", cargo: "Grãos", companyRoute: "A/B", originCompany: "A",
      destinationCompany: "B", origin: "São Paulo", destination: "Curitiba", distanceKm: "100", offeredValue: "2000", finalValue: 2000,
      rawText: "Grãos São Paulo Curitiba 100 km 2000", selectedRow: 0, completionStatus: "CONFIRMED_NORMAL", completedAtClient: Date.now() };
    const fields = ["cargo", "companyRoute", "originCompany", "destinationCompany", "origin", "destination", "distanceKm", "offeredValue", "rawText", "selectedRow"];
    payload.freightFingerprint = createHash("sha256").update(fields.map(key => `${key}=${String(payload[key]).length}:${payload[key]}|`).join("")).digest("hex");
    const result = await registerGtoTrip.run(payload, driver);
    assert.equal(result.created, true); assert.equal(result.jobStatus, "awaiting_completion");
    const saved = (await db.doc(`historico_viagens/${result.tripId}`).get()).data();
    assert.equal(saved.reboqueId, ""); assert.equal(saved.contratoNumero, "Operação A");
    assert.equal((await db.doc(`trabalhos/${a.jobId}`).get()).get("operationalRevision"), 3);
    await completeCanonicalOperation.run({ jobId: a.jobId }, driver);
    assert.equal((await progress().get()).get("completed"), true);
    assert.equal((await registerGtoTrip.run(payload, driver)).duplicate, true);
  });
  await test("snapshot: WBDS has no inherited trailer and unsupported simulator fails closed", async () => {
    await db.doc("frotas/a").update({ simulatorId: "WBDS" });
    await db.doc("contratos/contract-a").update({ simulator: "WBDS" });
    const result = await assign({ trailerId: null }); assert.equal(result.job.trailerId, null);
    assert.equal((await start(result.jobId)).job.trailerId, null);
    await db.doc("frotas/a").update({ simulatorId: "unknown" });
    await denied(() => assign({ trailerId: null }), "failed-precondition");
  });
  await test("concurrency: two different starts yield one active execution and one guard", async () => {
    const a = await assign(), b = await assign();
    const outcomes = await Promise.allSettled([start(a.jobId), start(b.jobId)]);
    assert.equal(outcomes.filter(x => x.status === "fulfilled").length, 1);
    const jobs = await db.collection("trabalhos").where("status", "==", "active").get();
    assert.equal(jobs.size, 1); assert.equal((await state("driver-a").get()).get("currentJobId"), jobs.docs[0].id);
    assert.equal((await db.doc("veiculos/vehicle-a").get()).get("status"), "in_use");
    assert.equal((await db.doc("reboques/trailer-a").get()).get("status"), "in_use");
  });
  await test("start: wrong actor, cross-company and stale unaccounted guard are rejected", async () => {
    const a = await assign();
    await denied(() => start(a.jobId, driver2)); await denied(() => start(a.jobId, owner));
    await denied(() => command({ action: "start", companyId: "b", jobId: a.jobId }, driver), "not-found");
    await state("driver-a").set({ companyId: "a", driverId: "driver-a", currentJobId: "missing" });
    await denied(() => start(a.jobId), "failed-precondition");
  });
  await test("cancellation: shared vehicle/trailer remain in use until the last driver ends", async () => {
    const a = await assign(), b = await assign({ driverId: "driver-b" });
    await start(a.jobId); await start(b.jobId, driver2);
    await cancel(a.jobId);
    assert.equal((await db.doc("veiculos/vehicle-a").get()).get("status"), "in_use");
    assert.equal((await state("driver-a").get()).get("currentJobId"), null);
    await cancel(b.jobId);
    assert.equal((await db.doc("veiculos/vehicle-a").get()).get("status"), "available");
    assert.equal((await db.doc("reboques/trailer-a").get()).get("status"), "available");
  });
  await test("race: cancel and start cannot leave a cancelled job allocated", async () => {
    const a = await assign();
    await Promise.allSettled([start(a.jobId), cancel(a.jobId)]);
    assert.equal((await db.doc(`trabalhos/${a.jobId}`).get()).get("status"), "cancelled");
    assert.ok(!(await state("driver-a").get()).get("currentJobId"));
    assert.equal((await db.doc("veiculos/vehicle-a").get()).get("status"), "available");
  });
  await test("cancellation replay does not clear a subsequent execution or maintenance status", async () => {
    const a = await assign(); await start(a.jobId); await cancel(a.jobId);
    const b = await assign(); await start(b.jobId);
    await cancel(a.jobId);
    assert.equal((await state("driver-a").get()).get("currentJobId"), b.jobId);
    await db.doc("veiculos/vehicle-a").update({ status: "maintenance" });
    await cancel(b.jobId);
    assert.equal((await db.doc("veiculos/vehicle-a").get()).get("status"), "maintenance");
  });
  const changeVehicle = (jobId, vehicleId, actor = owner, requestId, companyId = "a") => command({ action: "changeVehicle", companyId, jobId, vehicleId }, actor, requestId);
  await test("changeVehicle: a running job moves to the new vehicle; the old one is released; deliveries and deadline are untouched", async () => {
    const a = await assign(); await start(a.jobId);
    const before = (await db.doc(`trabalhos/${a.jobId}`).get()).data();
    const result = await changeVehicle(a.jobId, "vehicle-a2");
    const job = (await db.doc(`trabalhos/${a.jobId}`).get()).data();
    assert.equal(job.vehicleId, "vehicle-a2"); assert.equal(job.previousVehicleId, "vehicle-a"); assert.equal(job.vehicleChangedBy, "owner-a");
    for (const key of ["status", "driverId", "contractId", "totalDeliveries", "dueAt", "trailerId", "companyId"]) assert.deepEqual(job[key] ?? null, before[key] ?? null, key);
    assert.equal(result.job.vehicleId, "vehicle-a2");
    assert.equal((await db.doc("veiculos/vehicle-a2").get()).get("status"), "in_use");
    assert.equal((await db.doc("veiculos/vehicle-a").get()).get("status"), "available");
    assert.equal((await state("driver-a").get()).get("currentJobId"), a.jobId, "The driver keeps the same running operation");
  });
  await test("changeVehicle: a shared vehicle stays in use while another running job still links it", async () => {
    const a = await assign(), b = await assign({ driverId: "driver-b" });
    await start(a.jobId); await start(b.jobId, driver2);
    await changeVehicle(a.jobId, "vehicle-a2");
    assert.equal((await db.doc("veiculos/vehicle-a").get()).get("status"), "in_use");
    assert.equal((await db.doc(`trabalhos/${b.jobId}`).get()).get("vehicleId"), "vehicle-a");
  });
  await test("changeVehicle: replay with the same request id applies once; refused vehicles, foreign data and finished jobs change nothing", async () => {
    const a = await assign(); await start(a.jobId);
    await changeVehicle(a.jobId, "vehicle-a2", owner, "same-request");
    const again = await changeVehicle(a.jobId, "vehicle-a2", owner, "same-request");
    assert.equal(again.replayed, true);
    assert.equal((await db.doc(`trabalhos/${a.jobId}`).get()).get("operationalRevision") > 0, true);
    await denied(() => changeVehicle(a.jobId, "vehicle-a2"), "failed-precondition"); // already the current vehicle
    await denied(() => changeVehicle(a.jobId, "vehicle-b"), "failed-precondition"); // vehicle of another company
    await db.doc("veiculos/vehicle-a").update({ status: "maintenance" });
    await denied(() => changeVehicle(a.jobId, "vehicle-a"), "failed-precondition"); // in maintenance
    await denied(() => changeVehicle(a.jobId, "missing"), "failed-precondition");
    await denied(() => changeVehicle(a.jobId, "vehicle-a2", owner, undefined, "b"), "not-found"); // a job of company a is not reachable through company b
    await denied(() => changeVehicle(a.jobId, "vehicle-a2", ctx("owner-b"), undefined, "b"), "not-found"); // nor by the manager of company b
    await cancel(a.jobId);
    await db.doc("veiculos/vehicle-a").update({ status: "available" });
    await denied(() => changeVehicle(a.jobId, "vehicle-a"), "failed-precondition"); // cancelled job
    assert.equal((await db.doc(`trabalhos/${a.jobId}`).get()).get("vehicleId"), "vehicle-a2");
  });
  await test("changeVehicle: only a manager of the company; the driver, a stranger and an anonymous caller are refused; clients cannot write the link", async () => {
    const a = await assign(); await start(a.jobId);
    await denied(() => changeVehicle(a.jobId, "vehicle-a2", driver));
    await denied(() => changeVehicle(a.jobId, "vehicle-a2", ctx("owner-b")));
    await denied(() => changeVehicle(a.jobId, "vehicle-a2", {}), "unauthenticated");
    await denied(() => updateDoc(doc(client("owner-a"), `trabalhos/${a.jobId}`), { vehicleId: "vehicle-a2" }));
    assert.equal((await db.doc(`trabalhos/${a.jobId}`).get()).get("vehicleId"), "vehicle-a");
  });
  await test("completion: unproven legacy completed flag and bare progress are not server proof", async () => {
    const a = await assign(); await start(a.jobId);
    await db.doc(`trabalhos/${a.jobId}`).update({ progress: 1 });
    await denied(() => completeCanonicalOperation.run({ jobId: a.jobId }, driver), "failed-precondition");
    await db.doc(`trabalhos/${a.jobId}`).update({ status: "completed", operationalCommandVersion: admin.firestore.FieldValue.delete() });
    await denied(() => completeCanonicalOperation.run({ jobId: a.jobId }, driver), "failed-precondition");
    assert.equal((await progress().get()).exists, false);
  });
  await test("completion: concurrent explicit confirmation writes proof and releases guard atomically", async () => {
    const a = await assign(); await start(a.jobId); await addReceipt(a.jobId);
    const replies = await Promise.all([completeCanonicalOperation.run({ jobId: a.jobId }, driver), completeCanonicalOperation.run({ jobId: a.jobId }, driver)]);
    assert.equal(replies.filter(x => !x.alreadyCompleted).length, 1);
    assert.equal((await state("driver-a").get()).get("currentJobId"), null);
    const proof = (await progress().get()).data(); assert.equal(proof.completed, true); assert.equal(proof.proofJobId, a.jobId);
    assert.equal((await db.doc(`trabalhos/${a.jobId}`).get()).get("operationalRevision"), 3);
    const b = await assign(); await start(b.jobId);
    await completeCanonicalOperation.run({ jobId: a.jobId }, driver);
    assert.equal((await state("driver-a").get()).get("currentJobId"), b.jobId);
    await denied(() => completeCanonicalOperation.run({ jobId: a.jobId }, driver2));
    await denied(() => cancel(a.jobId), "failed-precondition");
  });
  await test("completion effects: replay deduplicates notifications and preserves another running user", async () => {
    const a = await assign(), b = await assign({ driverId: "driver-b" });
    await start(a.jobId); await start(b.jobId, driver2); await addReceipt(a.jobId);
    await completeCanonicalOperation.run({ jobId: a.jobId }, driver);
    assert.equal(await settleCanonicalOperationCompletion(db, a.jobId), true);
    assert.equal(await settleCanonicalOperationCompletion(db, a.jobId), false);
    assert.equal((await db.doc("veiculos/vehicle-a").get()).get("status"), "in_use");
    // Owner plus the two canonical admins in this fixture, each exactly once.
    assert.equal((await db.collection("notifications").where("metadata.jobId", "==", a.jobId).get()).size, 3);
  });
  await test("completion effects: a managed pending assignment does not retain an unused resource", async () => {
    const a = await assign(), pending = await assign();
    await start(a.jobId); await addReceipt(a.jobId);
    await completeCanonicalOperation.run({ jobId: a.jobId }, driver);
    await settleCanonicalOperationCompletion(db, a.jobId);
    assert.equal((await db.doc("veiculos/vehicle-a").get()).get("status"), "available");
    assert.equal((await db.doc("reboques/trailer-a").get()).get("status"), "available");
    await start(pending.jobId);
    assert.equal((await db.doc("veiculos/vehicle-a").get()).get("status"), "in_use");
  });
  await test("archive: remove from listing preserves job, completion proof and source contract", async () => {
    const a = await assign(); await start(a.jobId); await addReceipt(a.jobId);
    await completeCanonicalOperation.run({ jobId: a.jobId }, driver);
    const result = await command({ action: "archive", companyId: "a", jobId: a.jobId });
    assert.equal(result.job.archived, true); assert.equal(result.job.status, "completed");
    assert.equal((await progress().get()).get("completed"), true);
    assert.equal((await db.doc("contratos/contract-a").get()).exists, true);
    const b = await assign(); await denied(() => command({ action: "archive", companyId: "a", jobId: b.jobId }), "failed-precondition");
  });
  await test("replay after completion/archive returns the original intent plus current state without reallocation", async () => {
    const a = await assign({}, owner, "recovered-assignment"); await start(a.jobId); await addReceipt(a.jobId);
    await completeCanonicalOperation.run({ jobId: a.jobId }, driver);
    await command({ action: "archive", companyId: "a", jobId: a.jobId });
    const replay = await assign({}, owner, "recovered-assignment");
    assert.equal(replay.job.status, "pending"); assert.equal(replay.currentJob.status, "completed");
    assert.equal(replay.currentJob.archived, true); assert.equal((await db.collection("trabalhos").get()).size, 1);
  });
  await test("completion history: an intentional repeated contract preserves first proof date", async () => {
    const a = await assign(); await start(a.jobId); await addReceipt(a.jobId); await completeCanonicalOperation.run({ jobId: a.jobId }, driver);
    const first = (await progress().get()).get("firstCompletedAt").toMillis();
    const b = await assign(); await start(b.jobId); await addReceipt(b.jobId); await completeCanonicalOperation.run({ jobId: b.jobId }, driver);
    const latest = (await progress().get()).data();
    assert.equal(latest.firstCompletedAt.toMillis(), first); assert.equal(latest.proofJobId, b.jobId);
    assert.equal(latest.completed, true); assert.ok(latest.lastCompletedAt.toMillis() >= first);
  });
  await test("assignment effects: duplicate trigger delivery emits only one driver notification", async () => {
    const a = await assign();
    const replies = await Promise.all([settleOperationalAssignment(db, a.jobId), settleOperationalAssignment(db, a.jobId)]);
    assert.equal(replies.filter(Boolean).length, 1);
    assert.equal((await db.collection("notifications").where("metadata.jobId", "==", a.jobId).get()).size, 1);
  });
  await test("rules: managed lifecycle, identity, physical deletion and server journals are immutable to clients", async () => {
    const a = await assign(), d = client("driver-a"), m = client("owner-a");
    for (const patch of [{ status: "active" }, { vehicleId: "vehicle-a2" }, { progress: 1 }, { operationalCommandVersion: 0 }]) {
      await denied(() => updateDoc(doc(d, "trabalhos", a.jobId), patch));
      await denied(() => updateDoc(doc(m, "trabalhos", a.jobId), patch));
    }
    await denied(() => deleteDoc(doc(m, "trabalhos", a.jobId)));
    for (const collection of ["operationalDriverStates", "operationalCommandRequests", "driverOperationCompletions"]) {
      await denied(() => setDoc(doc(m, collection, "fabricated"), { companyId: "a", driverId: "driver-a", actorId: "owner-a" }));
    }
    assert.equal((await getDoc(doc(d, "operationalDriverStates", operationalDriverStateId("a", "driver-a")))).exists(), true);
    await denied(() => getDoc(doc(client("owner-b"), "operationalDriverStates", operationalDriverStateId("a", "driver-a"))));
  });
  await test("rules: legacy compatibility permits scoped pending create/start while denying forged completion and reopening", async () => {
    await db.doc("frotas/a").update({ operationalCommandVersion: admin.firestore.FieldValue.delete() });
    const m = client("owner-a"), d = client("driver-a");
    const base = { companyId: "a", driverId: "driver-a", contractId: "contract-a", vehicleId: "vehicle-a", trailerId: "trailer-a", status: "pending", progress: 0 };
    await setDoc(doc(m, "trabalhos/legacy-ok"), base);
    await updateDoc(doc(d, "trabalhos/legacy-ok"), { status: "active" });
    await denied(() => setDoc(doc(m, "trabalhos/forged"), { ...base, status: "completed", progress: 1 }));
    await denied(() => setDoc(doc(m, "trabalhos/foreign"), { ...base, contractId: "contract-b" }));
    await denied(() => setDoc(doc(m, "trabalhos/tagged"), { ...base, operationalCommandVersion: 1 }));
    await denied(() => updateDoc(doc(m, "trabalhos/legacy-ok"), { vehicleId: "vehicle-a2" }));
    await updateDoc(doc(m, "trabalhos/legacy-ok"), { status: "cancelled" });
    await denied(() => updateDoc(doc(m, "trabalhos/legacy-ok"), { status: "active" }));
    await setDoc(doc(m, "trabalhos/inactive"), base);
    await db.doc("users/driver-a").update({ status: "inactive" });
    await denied(() => updateDoc(doc(d, "trabalhos/inactive"), { status: "active" }));
  });
} finally {
  if (process.env.NVU_TEST_OUTPUT) fs.writeFileSync(process.env.NVU_TEST_OUTPUT, JSON.stringify({ projectId, results }, null, 2));
  await environment.cleanup(); await admin.deleteApp(admin.app());
}
console.log(`OPERATIONAL_COMMANDS_EMULATOR ${results.filter(x => x.result === "PASS").length}/${results.length} PASS`);
if (results.some(x => x.result !== "PASS")) process.exitCode = 1;
