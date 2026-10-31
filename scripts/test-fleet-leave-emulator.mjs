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
const leave = (uid = "driver-a", extra = {}) => member({ action: "leave", companyId: "a", ...extra }, uid);
const preview = (uid = "driver-a", companyId = "a") => member({ action: "leave-preview", companyId }, uid);
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

try {
  await test("preview writes nothing and reports what the exit would do", [[job("job-pending", { status: "pending" }), job("job-active", { status: "active" })]], async () => {
    const watched = ["trabalhos/job-pending", "trabalhos/job-active", "veiculos/vehicle-a", "reboques/trailer-a", "users/driver-a",
      "companyMembers/driver-a_a", "company_access/a/members/driver-a", "simulator_members/driver-a_a", "recruitment_applications/app-a"];
    const before = await snapshotOf(watched);
    const result = await preview();
    assert.equal(result.canLeave, true); assert.equal(result.jobsToCancel, 2); assert.equal(result.awaitingCompletion, 0);
    assert.equal(result.companyName, "DC Transportes");
    assert.deepEqual(await snapshotOf(watched), before);
    assert.equal((await db.collection("fleet_membership_commands").get()).size, 0, "a preview must not create a receipt");
  }, 0);

  await test("leave cancels pending/active/delayed jobs, releases the assets and keeps trips and the other company", [[
    job("job-pending", { status: "pending" }), job("job-active", { status: "active" }), job("job-delayed", { status: "delayed", vehicleId: "vehicle-a2", trailerId: null }),
    job("job-done", { status: "completed" }), job("job-b", { companyId: "b", status: "active", vehicleId: "vehicle-b" }),
  ], [["historico_viagens/trip-1", trip], ["operationalDriverStates/" + operationalDriverStateId("a", "driver-a"), { currentJobId: "job-active" }],
    ["veiculos/vehicle-b", { companyId: "b", status: "in_use" }]]], async () => {
    await db.doc("veiculos/vehicle-a2").update({ status: "in_use" });
    const result = await leave();
    assert.equal(result.left, true); assert.equal(result.cancelledJobs, 3);
    for (const id of ["job-pending", "job-active", "job-delayed"]) {
      const row = (await get(`trabalhos/${id}`)).data();
      assert.equal(row.status, "cancelled"); assert.equal(row.cancelledBy, "driver-a"); assert.equal(row.cancelReason, "driver_left_company");
      assert.equal(row.operationalRevision, 2);
    }
    assert.equal((await get("trabalhos/job-done")).get("status"), "completed", "a completed job is history and is never touched");
    assert.equal((await get("trabalhos/job-b")).get("status"), "active", "another company's job is untouched");
    assert.equal((await get("veiculos/vehicle-a")).get("status"), "available");
    assert.equal((await get("veiculos/vehicle-a2")).get("status"), "available");
    assert.equal((await get("reboques/trailer-a")).get("status"), "available");
    assert.equal((await get("veiculos/vehicle-b")).get("status"), "in_use");
    assert.equal((await get(`operationalDriverStates/${operationalDriverStateId("a", "driver-a")}`)).get("currentJobId"), null);
    assert.deepEqual((await get("historico_viagens/trip-1")).data(), trip, "registered trips are preserved as they were");
    // This company's link is gone...
    assert.equal((await get("companyMembers/driver-a_a")).exists, false);
    assert.equal((await get("simulator_members/driver-a_a")).exists, false);
    const tombstone = (await get("company_access/a/members/driver-a")).data();
    assert.equal(tombstone.status, "removed"); assert.equal(tombstone.reason, "left_company"); assert.equal(tombstone.revokedBy, "driver-a");
    // ...and the other one, and the account itself, are not.
    assert.equal((await get("companyMembers/driver-a_b")).exists, true);
    assert.equal((await get("simulator_members/driver-a_b")).exists, true);
    assert.equal((await get("company_access/b/members/driver-a")).get("status"), "active");
    const user = (await get("users/driver-a")).data();
    assert.equal(user.status, "active", "leaving must not turn the account into a pending one");
    assert.deepEqual(Object.keys(user.memberships), ["b"]);
    assert.equal(user.companyId, null); assert.equal(user.driverProfileEnabled, true);
    assert.equal(user.currentRecruitmentApplicationId, undefined);
    assert.equal((await get("recruitment_applications/app-a")).get("isCurrent"), false);
    assert.equal((await get("recruitment_applications/app-a")).get("accessRevokedReason"), "left_company");
    assert.equal((await get("recruitment_applications/app-a")).get("status"), "approved");
    assert.equal((await get("recruitment_applications/app-b")).get("isCurrent"), true, "the application to the other company is untouched");
    const audit = await db.collection("audit_senior_employee_actions").where("action", "==", "leave_fleet").get();
    assert.equal(audit.size, 1); assert.equal(audit.docs[0].get("actorUid"), "driver-a");
  });

  await test("a vehicle still used by another running job stays in use", [[
    job("job-mine", { status: "active" }), job("job-theirs", { driverId: "driver-b", motoristaId: "driver-b", status: "active" }),
  ]], async () => {
    await leave();
    assert.equal((await get("trabalhos/job-mine")).get("status"), "cancelled");
    assert.equal((await get("trabalhos/job-theirs")).get("status"), "active");
    assert.equal((await get("veiculos/vehicle-a")).get("status"), "in_use");
    assert.equal((await get("reboques/trailer-a")).get("status"), "in_use");
  });

  await test("a job waiting for completion blocks the exit and nothing is written", [[job("job-ready", { status: "awaiting_completion" }), job("job-active", { status: "active" })]], async () => {
    const watched = ["trabalhos/job-ready", "trabalhos/job-active", "veiculos/vehicle-a", "users/driver-a", "companyMembers/driver-a_a", "company_access/a/members/driver-a"];
    const before = await snapshotOf(watched);
    const view = await preview();
    assert.equal(view.canLeave, false); assert.equal(view.blocker, "LEAVE_AWAITING_COMPLETION"); assert.equal(view.awaitingCompletion, 1);
    await failsWith(() => leave(), "failed-precondition", "LEAVE_AWAITING_COMPLETION");
    assert.deepEqual(await snapshotOf(watched), before);
    assert.equal((await db.collection("fleet_membership_commands").get()).size, 0);
  });

  await test("the owner cannot leave", [[]], async () => {
    await failsWith(() => leave("owner-a"), "failed-precondition", "LEAVE_OWNER");
    assert.equal((await preview("owner-a")).blocker, "LEAVE_OWNER");
    assert.equal((await get("company_access/a/members/owner-a")).get("status"), "active");
  });

  await test("a caller cannot name another account as the one leaving", [[job("job-active", {})]], async () => {
    await failsWith(() => leave("driver-b", { targetUserId: "driver-a" }), "permission-denied");
    await failsWith(() => leave("admin-a", { targetUserId: "driver-a" }), "permission-denied");
    await failsWith(() => executeFleetMembershipCommand(db, { action: "leave", companyId: "a", diagnosticId: "leave-anon-0001" }, {}), "unauthenticated");
    assert.equal((await get("companyMembers/driver-a_a")).exists, true);
    assert.equal((await get("trabalhos/job-active")).get("status"), "active");
  });

  await test("leaving a company the account is not linked to is refused", [[]], async () => {
    await failsWith(() => leave("driver-b", { companyId: "b" }), "failed-precondition", "LEAVE_NOT_LINKED");
    await failsWith(() => leave("driver-a", { companyId: "missing" }), "failed-precondition", "LEAVE_NOT_LINKED");
    assert.equal((await get("companyMembers/driver-b_a")).exists, true);
  });

  await test("a suspended account cannot use the exit to escape and nothing changes", [[job("job-active", {})]], async () => {
    await db.doc("users/driver-a").update({ status: "suspended", suspension: { active: true } });
    const before = await snapshotOf(["users/driver-a", "trabalhos/job-active", "companyMembers/driver-a_a", "company_access/a/members/driver-a"]);
    await failsWith(() => leave(), "permission-denied", "LEAVE_ACCOUNT_UNAVAILABLE");
    await failsWith(() => preview(), "permission-denied", "LEAVE_ACCOUNT_UNAVAILABLE");
    assert.deepEqual(await snapshotOf(Object.keys(before)), before);
  });

  await test("an administrator who also drives loses every role in that company, and only there", [[]], async () => {
    await db.doc("users/admin-a").update({ roles: ["admin", "driver"], memberships: { a: { role: "admin", roles: ["admin", "driver"], status: "active" } } });
    await db.doc("simulator_members/admin-a_a").set({ userId: "admin-a", companyId: "a", roles: ["admin", "driver"], status: "active" });
    const result = await member({ action: "leave", companyId: "a" }, "admin-a");
    assert.equal(result.left, true);
    assert.equal((await get("companyMembers/admin-a_a")).exists, false);
    assert.equal((await get("company_access/a/members/admin-a")).get("status"), "removed");
    const user = (await get("users/admin-a")).data();
    assert.equal(user.role, "driver"); assert.deepEqual(user.roles, ["driver"]); assert.equal(user.status, "active"); assert.equal(user.companyId, null);
    assert.equal((await get("company_access/a/members/owner-a")).get("status"), "active");
  });

  await test("replaying the same command is idempotent and a reused reference for another company conflicts", [[job("job-active", {})]], async () => {
    const input = { action: "leave", companyId: "a", diagnosticId: "leave-replay-0001" };
    const first = await executeFleetMembershipCommand(db, input, ctx("driver-a"));
    const again = await executeFleetMembershipCommand(db, input, ctx("driver-a"));
    assert.deepEqual(again, first);
    assert.equal((await db.collection("audit_senior_employee_actions").where("action", "==", "leave_fleet").get()).size, 1);
    const status = await executeFleetMembershipCommand(db, { action: "command-status", commandAction: "leave", companyId: "a", diagnosticId: "leave-replay-0001" }, ctx("driver-a"));
    assert.equal(status.commandStatus, "COMPLETED");
    await failsWith(() => executeFleetMembershipCommand(db, { ...input, companyId: "b" }, ctx("driver-a")), "failed-precondition", "MEMBERSHIP_COMMAND_CONFLICT");
    // A new reference after the exit is a harmless success: nothing is cancelled twice or resurrected.
    const later = await leave();
    assert.equal(later.left, true); assert.equal(later.cancelledJobs, 0);
    assert.equal((await get("trabalhos/job-active")).get("operationalRevision"), 2);
  });

  await test("the old approval cannot bring the access back; a new application and approval can", [[]], async () => {
    await leave();
    await failsWith(() => member({ action: "approve-application", companyId: "a", applicationId: "app-a" }, "owner-a"), "failed-precondition");
    assert.equal((await get("company_access/a/members/driver-a")).get("status"), "removed");
    assert.equal((await get("companyMembers/driver-a_a")).exists, false);
    await db.doc("recruitment_applications/app-new").set({ userId: "driver-a", email: "driver-a@example.com", companyId: "a", status: "pending", isCurrent: true,
      type: "driver_application", createdAt: new Date(Date.now() + 5_000), fullName: "Motorista A" });
    await member({ action: "approve-application", companyId: "a", applicationId: "app-new" }, "owner-a").then(
      async () => { assert.equal((await get("company_access/a/members/driver-a")).get("status"), "active"); },
      error => { throw error; });
  });

  await test("a new approval keeps what the driver edited and only fills what is empty", [[]], async () => {
    await db.doc("users/driver-a").update({ name: "Meu Nome", profileNameSource: "user_edit", whatsapp: "11911112222" });
    await leave();
    await db.doc("recruitment_applications/app-new").set({ userId: "driver-a", email: "driver-a@example.com", companyId: "a", status: "pending", isCurrent: true,
      type: "driver_application", createdAt: new Date(Date.now() + 5_000), fullName: "Nome do formulário", whatsapp: "11900000000" });
    await member({ action: "approve-application", companyId: "a", applicationId: "app-new" }, "owner-a");
    const user = (await get("users/driver-a")).data();
    assert.equal(user.name, "Meu Nome"); assert.equal(user.whatsapp, "11911112222"); assert.equal(user.driverProfileEnabled, true);
    assert.equal(user.companyId, "a"); assert.equal(user.status, "active");
  });

  await test("the owner and administrators are notified once, with the number of cancelled jobs", [[job("job-active", {})]], async () => {
    await member({ action: "leave", companyId: "a", diagnosticId: "leave-notify-0001" }, "driver-a");
    const rows = await db.collection("notifications").where("type", "==", "DRIVER_LEFT_COMPANY").get();
    assert.deepEqual(rows.docs.map(row => row.get("userId")).sort(), ["admin-a", "owner-a"]);
    assert.match(rows.docs[0].get("message"), /Motorista A saiu da empresa; 1 trabalho foi cancelado\./);
    await executeFleetMembershipCommand(db, { action: "leave", companyId: "a", diagnosticId: "leave-notify-0001" }, ctx("driver-a"));
    assert.equal((await db.collection("notifications").where("type", "==", "DRIVER_LEFT_COMPANY").get()).size, 2, "a replay does not notify again");
  });

  await test("a legacy job that only carries motoristaId is closed as well", [[job("job-legacy", { driverId: "placeholder", status: "active" })]], async () => {
    await db.doc("trabalhos/job-legacy").update({ driverId: admin.firestore.FieldValue.delete() });
    assert.equal((await preview()).jobsToCancel, 1);
    await leave();
    assert.equal((await get("trabalhos/job-legacy")).get("status"), "cancelled");
  });

  await test("an assignment racing with the exit never leaves an open job behind a revoked access", [[]], async () => {
    for (let round = 0; round < 6; round += 1) {
      await seed([], []);
      await db.doc("veiculos/vehicle-a").update({ status: "available" });
      await db.doc("reboques/trailer-a").update({ status: "available" });
      const assign = executeOperationalCommand(db, { action: "assign", companyId: "a", contractId: "contract-a", driverId: "driver-a", vehicleId: "vehicle-a",
        trailerId: "trailer-a", requestId: `race-${round}-${Date.now()}` }, ctx("owner-a")).then(() => "assigned", () => "refused");
      const exit = leave().then(() => "left", () => "blocked");
      const [, exitResult] = await Promise.all([assign, exit]);
      if (exitResult === "blocked") { await leave(); }
      const open = (await db.collection("trabalhos").where("driverId", "==", "driver-a").get()).docs.filter(row => !["cancelled", "completed"].includes(row.get("status")));
      assert.equal(open.length, 0, `round ${round}: no open job may survive the exit`);
      assert.equal((await get("company_access/a/members/driver-a")).get("status"), "removed");
      assert.equal((await get("veiculos/vehicle-a")).get("status"), "available", `round ${round}: vehicle released`);
    }
  });

  await test("the client cannot grant itself the personal-profile flag, leave a company or delete the barrier", [[]], async () => {
    const d = client("driver-a");
    await assert.rejects(updateDoc(doc(d, "users/driver-a"), { driverProfileEnabled: true }));
    await assert.rejects(updateDoc(doc(d, "users/driver-a"), { companyId: null }));
    await assert.rejects(setDoc(doc(d, "company_access/a/members/driver-a"), { status: "removed" }));
  });
} finally {
  if (process.env.NVU_TEST_OUTPUT) fs.writeFileSync(process.env.NVU_TEST_OUTPUT, JSON.stringify({ projectId, results }, null, 2));
  await environment.cleanup(); await admin.deleteApp(admin.app());
}
console.log(`FLEET_LEAVE_EMULATOR ${results.filter(x => x.result === "PASS").length}/${results.length} PASS`);
if (results.some(x => x.result !== "PASS")) process.exitCode = 1;
