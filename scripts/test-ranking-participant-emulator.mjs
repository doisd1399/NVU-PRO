import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

const projectId = "demo-nvu-v36-4-staging";
assert.equal(process.env.GCLOUD_PROJECT, projectId, "Only the disposable demo project is allowed");
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^127\.0\.0\.1:\d+$/);
const require = createRequire(new URL("../functions/package.json", import.meta.url));
const admin = require(process.cwd() + "/functions/lib/firebaseAdmin.js");
if (!admin.apps.length) admin.initializeApp({ projectId });
const ranking = require("./lib/rankingParticipantOperations.js");
const environment = await initializeTestEnvironment({ projectId, firestore: { rules: fs.readFileSync("firestore.rules", "utf8") } });
const db = admin.firestore();
const get = async path => (await db.doc(path).get());
const rowsOf = async uid => ((await get(`rankingParticipantOperations/${uid}`)).get("rows") || []);
const revisionOf = async uid => (await get(`rankingParticipantOperations/${uid}`)).get("revision");
const ctx = uid => ({ auth: uid ? { uid, token: {} } : undefined });
const clean = value => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
const job = (extra = {}) => clean({ companyId: "a", driverId: "p1", status: "active", vehicleId: "v1", vehicleName: "Scania", assignedAt: new Date("2026-10-01T10:00:00Z"),
  simulatorId: "gto", progress: 1, totalDeliveries: 5, contractName: "Segredo", contractSnapshot: { deliveries: [{ city: "X" }] }, dueAt: "2026-11-01", ...extra });
const seed = async (rows = []) => {
  await environment.clearFirestore();
  const batch = db.batch();
  [["veiculos/v1", { companyId: "a", name: "Scania R450", simulatorId: "gto" }], ["veiculos/v2", { companyId: "a", name: "Volvo FH" }], ...rows].forEach(([path, data]) => batch.set(db.doc(path), data));
  await batch.commit();
};
const results = [];
async function test(name, fn) {
  const started = performance.now();
  try { await fn(); results.push({ name, result: "PASS", seconds: +((performance.now() - started) / 1000).toFixed(3) }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, result: "FAIL", error: error.stack }); console.error(`FAIL ${name}`, error); }
}
const writeJob = async (id, data) => { await db.doc(`trabalhos/${id}`).set(data); };
const trigger = async (id, before, after) => ranking.syncRankingParticipantOperations.run(
  { before: { exists: before !== undefined, data: () => before }, after: { exists: after !== undefined, data: () => after } }, { params: { jobId: id } });

try {
  await test("a projection is built once from the history and carries only what the Ranking needs", async () => {
    await seed([["trabalhos/j1", job()], ["trabalhos/j2", job({ driverId: undefined, motoristaId: "p1", status: "completed", completedAt: new Date("2026-09-01"), assignedAt: new Date("2026-09-01"), vehicleId: "v2", vehicleName: "Volvo" })],
      ["trabalhos/j3", job({ status: "cancelled" })], ["trabalhos/j4", job({ driverId: "someone" })], ["trabalhos/j5", job({ status: "pending", startedAt: undefined })]]);
    await db.doc("trabalhos/j2").update({ driverId: admin.firestore.FieldValue.delete() }); await db.doc("trabalhos/j1").update({ startedAt: null });
    const answer = await ranking.ensureRankingParticipantOperations.run({ participantId: "p1" }, ctx("viewer"));
    assert.equal(answer.success, true); assert.equal(answer.schemaVersion, 1);
    const rows = await rowsOf("p1");
    assert.deepEqual(rows.map(row => row.id).sort(), ["j1", "j2"], "cancelled, pending-without-use and other drivers' jobs are not rows");
    const active = rows.find(row => row.id === "j1");
    assert.equal(active.vehicle.name, "Scania R450"); assert.equal(active.vehicle.simulatorId, "gto"); assert.equal(active.status, "active");
    const everything = JSON.stringify(rows);
    for (const secret of ["Segredo", "contractSnapshot", "dueAt", "progress", "totalDeliveries", "deliveries"]) assert(!everything.includes(secret), `${secret} must not be in the projection`);
    assert.equal((await get("rankingParticipantOperations/p1")).get("schemaVersion"), 1);
  });

  await test("asking again does not rebuild; invalid or anonymous requests are refused", async () => {
    await seed([["trabalhos/j1", job()]]);
    await ranking.ensureRankingParticipantOperations.run({ participantId: "p1" }, ctx("viewer"));
    const first = await revisionOf("p1");
    await ranking.ensureRankingParticipantOperations.run({ participantId: "p1" }, ctx("other"));
    assert.equal(await revisionOf("p1"), first);
    await assert.rejects(ranking.ensureRankingParticipantOperations.run({ participantId: "p1" }, ctx()), e => String(e.code).includes("unauthenticated"));
    for (const bad of ["", "a/b", "..", undefined]) await assert.rejects(ranking.ensureRankingParticipantOperations.run({ participantId: bad }, ctx("viewer")), e => String(e.code).includes("invalid-argument"));
  });

  await test("a participant without jobs gets an empty projection, so 'no vehicle' is a definite answer", async () => {
    await seed([]);
    const answer = await ranking.ensureRankingParticipantOperations.run({ participantId: "nobody" }, ctx("viewer"));
    assert.deepEqual(answer.rows, []);
    assert.deepEqual(await rowsOf("nobody"), []);
  });

  await test("job changes keep it current; progress-only updates are skipped", async () => {
    await seed([["trabalhos/j1", job()]]);
    await ranking.ensureRankingParticipantOperations.run({ participantId: "p1" }, ctx("viewer"));
    const base = await revisionOf("p1");
    // Progress and receipts change on every trip: no write at all.
    await writeJob("j1", job({ progress: 3, lastValidatedTripId: "t1" }));
    await trigger("j1", job(), job({ progress: 3, lastValidatedTripId: "t1" }));
    assert.equal(await revisionOf("p1"), base, "a progress-only update must not touch the projection");
    // A new operation, then a vehicle change.
    await writeJob("j9", job({ vehicleId: "v2", vehicleName: "Volvo", assignedAt: new Date("2026-10-05") }));
    await trigger("j9", undefined, job({ vehicleId: "v2", assignedAt: new Date("2026-10-05") }));
    assert.deepEqual((await rowsOf("p1")).map(row => row.id).sort(), ["j1", "j9"]);
    await writeJob("j9", job({ vehicleId: "v1", assignedAt: new Date("2026-10-05") }));
    await trigger("j9", job({ vehicleId: "v2", assignedAt: new Date("2026-10-05") }), job({ vehicleId: "v1", assignedAt: new Date("2026-10-05") }));
    assert.equal((await rowsOf("p1")).find(row => row.id === "j9").vehicleId, "v1");
    // Cancelling removes the row; deleting does too.
    await writeJob("j9", job({ status: "cancelled", assignedAt: new Date("2026-10-05") }));
    await trigger("j9", job({ assignedAt: new Date("2026-10-05") }), job({ status: "cancelled", assignedAt: new Date("2026-10-05") }));
    assert.deepEqual((await rowsOf("p1")).map(row => row.id), ["j1"]);
    await db.doc("trabalhos/j1").delete();
    await trigger("j1", job(), undefined);
    assert.deepEqual(await rowsOf("p1"), []);
  });

  await test("a job that changes driver updates both participants", async () => {
    await seed([["trabalhos/j1", job()]]);
    await ranking.ensureRankingParticipantOperations.run({ participantId: "p1" }, ctx("viewer"));
    await ranking.ensureRankingParticipantOperations.run({ participantId: "p2" }, ctx("viewer"));
    await writeJob("j1", job({ driverId: "p2" }));
    await trigger("j1", job(), job({ driverId: "p2" }));
    assert.deepEqual(await rowsOf("p1"), []); assert.deepEqual((await rowsOf("p2")).map(row => row.id), ["j1"]);
  });

  await test("with no projection yet, the first job event builds it from the whole history", async () => {
    await seed([["trabalhos/old", job({ status: "completed", assignedAt: new Date("2026-08-01"), completedAt: new Date("2026-08-02"), vehicleId: "v2" })], ["trabalhos/j1", job()]]);
    await trigger("j1", undefined, job());
    assert.deepEqual((await rowsOf("p1")).map(row => row.id).sort(), ["j1", "old"]);
  });

  await test("many jobs changing at once never lose a row", async () => {
    await seed([]);
    await ranking.ensureRankingParticipantOperations.run({ participantId: "p1" }, ctx("viewer"));
    const ids = Array.from({ length: 12 }, (_, i) => `r${i}`);
    await Promise.all(ids.map(async (id, i) => { await writeJob(id, job({ assignedAt: new Date(2026, 9, 1 + i) })); await trigger(id, undefined, job({ assignedAt: new Date(2026, 9, 1 + i) })); }));
    assert.deepEqual((await rowsOf("p1")).map(row => row.id).sort(), [...ids].sort());
  });

  await test("a long history is limited, and removing a row from a limited list rebuilds instead of guessing", async () => {
    const rows = Array.from({ length: 16 }, (_, i) => [`trabalhos/h${i}`, job({ status: "completed", assignedAt: new Date(2026, 0, 1 + i), completedAt: new Date(2026, 0, 2 + i) })]);
    await seed(rows);
    await ranking.ensureRankingParticipantOperations.run({ participantId: "p1" }, ctx("viewer"));
    const stored = await rowsOf("p1");
    assert.equal(stored.length, 10); assert.equal((await get("rankingParticipantOperations/p1")).get("truncated"), true);
    assert.equal(stored[0].id, "h15");
    // The newest is cancelled: the list must fall back to the older jobs that had been left out.
    await writeJob("h15", job({ status: "cancelled", assignedAt: new Date(2026, 0, 16) }));
    await trigger("h15", job({ status: "completed", assignedAt: new Date(2026, 0, 16), completedAt: new Date(2026, 0, 17) }), job({ status: "cancelled", assignedAt: new Date(2026, 0, 16) }));
    const after = await rowsOf("p1");
    assert.equal(after.length, 10); assert.equal(after[0].id, "h14"); assert(after.some(row => row.id === "h5"), "an older job left out earlier is back");
  });

  await test("renaming a vehicle refreshes the participants that used it", async () => {
    await seed([["trabalhos/j1", job()]]);
    await ranking.ensureRankingParticipantOperations.run({ participantId: "p1" }, ctx("viewer"));
    await db.doc("veiculos/v1").update({ name: "Scania Nova" });
    await ranking.syncRankingVehicleChange.run({ before: { data: () => ({ name: "Scania R450", simulatorId: "gto" }) }, after: { data: () => ({ name: "Scania Nova", simulatorId: "gto" }) } }, { params: { vehicleId: "v1" } });
    assert.equal((await rowsOf("p1"))[0].vehicle.name, "Scania Nova");
    const revision = await revisionOf("p1");
    await ranking.syncRankingVehicleChange.run({ before: { data: () => ({ name: "x", status: "available" }) }, after: { data: () => ({ name: "x", status: "in_use" }) } }, { params: { vehicleId: "v1" } });
    assert.equal(await revisionOf("p1"), revision, "a change unrelated to name/simulator does nothing");
  });

  await test("rules: any signed-in user reads it, nobody writes it, and anonymous users read nothing", async () => {
    await seed([["trabalhos/j1", job()]]);
    await ranking.ensureRankingParticipantOperations.run({ participantId: "p1" }, ctx("viewer"));
    const viewer = environment.authenticatedContext("someone-from-another-company").firestore();
    assert.equal((await getDoc(doc(viewer, "rankingParticipantOperations/p1"))).exists(), true);
    await assert.rejects(setDoc(doc(viewer, "rankingParticipantOperations/p1"), { rows: [] }));
    await assert.rejects(setDoc(doc(environment.authenticatedContext("p1").firestore(), "rankingParticipantOperations/p1"), { rows: [] }));
    await assert.rejects(getDoc(doc(environment.unauthenticatedContext().firestore(), "rankingParticipantOperations/p1")));
  });
} finally {
  if (process.env.NVU_TEST_OUTPUT) fs.writeFileSync(process.env.NVU_TEST_OUTPUT, JSON.stringify({ projectId, results }, null, 2));
  await environment.cleanup(); await admin.deleteApp(admin.app());
}
console.log(`RANKING_PARTICIPANT_EMULATOR ${results.filter(x => x.result === "PASS").length}/${results.length} PASS`);
if (results.some(x => x.result !== "PASS")) process.exitCode = 1;
