import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc } from "firebase/firestore";

const projectId = "demo-nvu-v36-4-staging";
assert.equal(process.env.GCLOUD_PROJECT, projectId, "Only the disposable demo project is allowed");
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^127\.0\.0\.1:\d+$/);
const require = createRequire(new URL("../functions/package.json", import.meta.url));
const admin = require(process.cwd() + "/functions/lib/firebaseAdmin.js");
if (!admin.apps.length) admin.initializeApp({ projectId });
const { executeFleetMembershipCommand } = require("./lib/fleetMembership.js");
const { executeOperationalCommand, operationalDriverStateId } = require("./lib/operationalCommands.js");
const { refreshCompanyAccess } = require("./lib/companyAccess.js");
const environment = await initializeTestEnvironment({ projectId, firestore: { rules: fs.readFileSync("firestore.rules", "utf8") } });
const db = admin.firestore();
const ctx = (uid, token = {}) => ({ auth: { uid, token } });
let sequence = 0;
const member = (input, uid) => executeFleetMembershipCommand(db, { diagnosticId: `leave-test-${++sequence}-${Date.now()}`, ...input }, ctx(uid));
const removal = (target = "driver-a", by = "owner-a", extra = {}) => member({ action: "remove", companyId: "a", targetUserId: target, ...extra }, by);
const failsWith = async (fn, code, reason) => assert.rejects(fn, error => {
  assert.ok(String(error.code).includes(code), `expected ${code}, got ${error.code}: ${error.message}`);
  if (reason) assert.equal(error.details?.reasonCode, reason);
  return true;
});
const get = async path => (await db.doc(path).get());
const client = uid => environment.authenticatedContext(uid).firestore();
const snapshotOf = async paths => Object.fromEntries(await Promise.all(paths.map(async path => [path, JSON.stringify((await get(path)).data() ?? null)])));

const job = (id, data) => ({ id, ref: `trabalhos/${id}`, data: { companyId: "a", driverId: "driver-a", motoristaId: "driver-a", contractId: "contract-a",
  vehicleId: "vehicle-a", trailerId: "trailer-a", status: "active", operationalCommandVersion: 1, operationalRevision: 1, totalDeliveries: 2, ...data } });
const seed = async (jobs = [], extra = []) => {
  await environment.clearFirestore();
  const rows = [
    ["frotas/a", { ownerId: "owner-a", userId: "owner-a", companyName: "DC Transportes", simulatorId: "GTO", status: "active", operationalCommandVersion: 1 }],
    ["frotas/b", { ownerId: "owner-b", userId: "owner-b", companyName: "Outra", simulatorId: "GTO", status: "active", operationalCommandVersion: 1 }],
    ["users/owner-a", { name: "Dono", companyId: "a", role: "admin", status: "active" }],
    ["users/owner-b", { name: "Dono B", companyId: "b", role: "admin", status: "active" }],
    ["users/admin-a", { name: "Gestor", companyId: "a", role: "admin", status: "active" }],
    ["companyMembers/admin-a_a", { companyId: "a", userId: "admin-a", roles: ["admin", "driver"], status: "active" }],
    ["users/driver-a", { name: "Motorista A", email: "driver-a@example.com", role: "driver", roles: ["driver"], companyId: "a", status: "active",
      memberships: { a: { role: "driver", roles: ["driver"], status: "active" }, b: { role: "driver", roles: ["driver"], status: "active" } },
      currentRecruitmentApplicationId: "app-a", currentRecruitmentCompanyId: "a", currentRecruitmentStatus: "approved", currentRecruitmentType: "driver_application" }],
    ["companyMembers/driver-a_a", { userId: "driver-a", companyId: "a", roles: ["driver"], status: "active" }],
    ["companyMembers/driver-a_b", { userId: "driver-a", companyId: "b", roles: ["driver"], status: "active" }],
    ["simulator_members/driver-a_a", { userId: "driver-a", companyId: "a", roles: ["driver"], status: "active" }],
    ["simulator_members/driver-a_b", { userId: "driver-a", companyId: "b", roles: ["driver"], status: "active" }],
    ["users/driver-b", { name: "Motorista B", role: "driver", roles: ["driver"], companyId: "a", status: "active" }],
    ["companyMembers/driver-b_a", { userId: "driver-b", companyId: "a", roles: ["driver"], status: "active" }],
    ["simulator_members/driver-b_a", { userId: "driver-b", companyId: "a", roles: ["driver"], status: "active" }],
    ["recruitment_applications/app-a", { userId: "driver-a", email: "driver-a@example.com", companyId: "a", status: "approved", isCurrent: true,
      approvalAuthorityVersion: 1, createdAt: new Date(Date.now() - 86_400_000) }],
    ["recruitment_applications/app-b", { userId: "driver-a", email: "driver-a@example.com", companyId: "b", status: "approved", isCurrent: true,
      approvalAuthorityVersion: 1, createdAt: new Date(Date.now() - 86_400_000) }],
    ["contratos/contract-a", { companyId: "a", name: "Operação A", simulator: "GTO", mode: "simple", totalDeliveries: 2, deadlineDays: 3, trailerId: "trailer-a", status: "active" }],
    ["veiculos/vehicle-a", { companyId: "a", name: "Caminhão A", plate: "ABC", status: "in_use" }],
    ["veiculos/vehicle-a2", { companyId: "a", name: "Caminhão 2", status: "available" }],
    ["reboques/trailer-a", { companyId: "a", name: "Reboque A", status: "in_use" }],
    ...jobs.map(row => [row.ref, row.data]), ...extra,
  ];
  const batch = db.batch();
  rows.forEach(([ref, data]) => batch.set(db.doc(ref), data));
  await batch.commit();
  for (const [uid, companyId] of [["owner-a", "a"], ["admin-a", "a"], ["driver-a", "a"], ["driver-a", "b"], ["driver-b", "a"]]) await refreshCompanyAccess(db, uid, companyId);
};

const results = [];
async function test(name, setup, fn) {
  const started = performance.now();
  try {
    await seed(...(setup || [])); await fn(); results.push({ name, result: "PASS", seconds: +((performance.now() - started) / 1000).toFixed(3) });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, result: "FAIL", error: error.stack });
    console.error(`FAIL ${name}`, error);
  }
}
const trip = { jobId: "job-active", companyId: "a", empresaId: "a", driverId: "driver-a", motoristaId: "driver-a", status: "concluida", recordStatus: "concluida", value: 1234 };

// Relato: o trabalho do Dudu TV (motorista da Tijoleira) apareceu na DC Transportes. Ele foi removido da DC, mas "Remover da frota" só
// encerrava o vínculo: os trabalhos abertos dele na DC continuavam abertos (veículo "em uso", contados pela empresa, ninguém os listava).
try {
  await test("remove cancels pending/active/delayed/awaiting jobs of that company, releases the assets and keeps trips and the other company", [[
    job("job-pending", { status: "pending" }), job("job-active", { status: "active" }), job("job-delayed", { status: "delayed", vehicleId: "vehicle-a2", trailerId: null }),
    job("job-wait", { status: "awaiting_completion", vehicleId: "vehicle-a2", trailerId: null }),
    job("job-done", { status: "completed" }), job("job-b", { companyId: "b", status: "active", vehicleId: "vehicle-b" }),
  ], [["historico_viagens/trip-1", trip], ["operationalDriverStates/" + operationalDriverStateId("a", "driver-a"), { currentJobId: "job-active" }],
    ["veiculos/vehicle-b", { companyId: "b", status: "in_use" }]]], async () => {
    await db.doc("veiculos/vehicle-a2").update({ status: "in_use" });
    const result = await removal();
    assert.equal(result.removed, true); assert.equal(result.cancelledJobs, 4);
    assert.deepEqual([...result.cancelledJobIds].sort(), ["job-active", "job-delayed", "job-pending", "job-wait"]);
    for (const id of ["job-pending", "job-active", "job-delayed", "job-wait"]) {
      const row = (await get(`trabalhos/${id}`)).data();
      assert.equal(row.status, "cancelled", id); assert.equal(row.cancelledBy, "owner-a"); assert.equal(row.cancelReason, "removed_from_fleet");
      assert.equal(row.operationalRevision, 2);
    }
    assert.equal((await get("trabalhos/job-done")).get("status"), "completed", "history is never touched");
    assert.equal((await get("trabalhos/job-b")).get("status"), "active", "another company's job is untouched");
    assert.equal((await get("veiculos/vehicle-a")).get("status"), "available");
    assert.equal((await get("veiculos/vehicle-a2")).get("status"), "available");
    assert.equal((await get("reboques/trailer-a")).get("status"), "available");
    assert.equal((await get("veiculos/vehicle-b")).get("status"), "in_use");
    assert.equal((await get(`operationalDriverStates/${operationalDriverStateId("a", "driver-a")}`)).get("currentJobId"), null);
    assert.deepEqual((await get("historico_viagens/trip-1")).data(), trip, "registered trips are preserved");
    assert.equal((await get("company_access/a/members/driver-a")).get("status"), "removed");
    assert.equal((await get("companyMembers/driver-a_a")).exists, false);
    assert.equal((await get("companyMembers/driver-a_b")).exists, true, "the other company link stays");
    const audit = await db.collection("audit_senior_employee_actions").where("action", "==", "remove_from_fleet").get();
    assert.equal(audit.size, 1); assert.equal(audit.docs[0].get("actorUid"), "owner-a"); assert.equal(audit.docs[0].get("cancelledJobIds").length, 4);
  });

  await test("a vehicle still used by another running job of the company stays in use", [[
    job("job-mine", { status: "active" }), job("job-theirs", { driverId: "driver-b", motoristaId: "driver-b", status: "active" }),
  ]], async () => {
    await removal();
    assert.equal((await get("trabalhos/job-mine")).get("status"), "cancelled");
    assert.equal((await get("trabalhos/job-theirs")).get("status"), "active");
    assert.equal((await get("veiculos/vehicle-a")).get("status"), "in_use", "shared vehicle is not released under the other driver");
  });

  await test("removing a driver without open jobs still works and reports zero", [[job("job-done", { status: "completed" })]], async () => {
    const result = await removal();
    assert.equal(result.removed, true); assert.equal(result.cancelledJobs, 0);
    assert.equal((await get("trabalhos/job-done")).get("status"), "completed");
  });

  await test("a repeated removal finishes the cleanup of a job left open by an earlier removal", [[job("job-orphan", { status: "delayed" })]], async () => {
    await removal();
    await db.doc("trabalhos/job-orphan").update({ status: "delayed", cancelledAt: null });   // as an old removal left it
    const again = await removal();
    assert.equal(again.removed, true); assert.equal(again.cancelledJobs, 1);
    assert.equal((await get("trabalhos/job-orphan")).get("status"), "cancelled");
  });

  await test("too many open jobs are refused with a clear message and nothing changes", [[...Array.from({ length: 26 }, (_, index) => job(`job-${index}`, { status: "pending" }))]], async () => {
    const before = await snapshotOf(["trabalhos/job-0", "company_access/a/members/driver-a", "companyMembers/driver-a_a"]);
    await failsWith(() => removal(), "failed-precondition");
    assert.deepEqual(await snapshotOf(["trabalhos/job-0", "company_access/a/members/driver-a", "companyMembers/driver-a_a"]), before);
  });

  await test("only a manager of the company can remove; a driver of the company cannot", [[job("job-active", { status: "active" })]], async () => {
    await failsWith(() => removal("driver-a", "driver-b"), "permission-denied");
    assert.equal((await get("trabalhos/job-active")).get("status"), "active");
  });
} finally {
  if (process.env.NVU_TEST_OUTPUT) fs.writeFileSync(process.env.NVU_TEST_OUTPUT, JSON.stringify({ projectId, results }, null, 2));
  await environment.cleanup(); await admin.deleteApp(admin.app());
}
console.log(`FLEET_REMOVE_JOBS_EMULATOR ${results.filter(x => x.result === "PASS").length}/${results.length} PASS`);
if (results.some(x => x.result !== "PASS")) process.exitCode = 1;
