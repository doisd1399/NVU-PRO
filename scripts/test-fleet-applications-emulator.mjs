import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";

const projectId = "demo-nvu-v36-4-staging";
assert.equal(process.env.GCLOUD_PROJECT, projectId, "Only the disposable demo project is allowed");
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^127\.0\.0\.1:\d+$/);
const require = createRequire(new URL("../functions/package.json", import.meta.url));
const admin = require(process.cwd() + "/functions/lib/firebaseAdmin.js");
if (!admin.apps.length) admin.initializeApp({ projectId });
const { executeFleetMembershipCommand } = require("./lib/fleetMembership.js");
const { refreshCompanyAccess } = require("./lib/companyAccess.js");
const { rejectRecruitmentApplication } = require("./lib/adminOperations.js");
const environment = await initializeTestEnvironment({ projectId, firestore: { rules: fs.readFileSync("firestore.rules", "utf8") } });
const db = admin.firestore();
const ctx = (uid, token = {}) => ({ auth: { uid, token } });
let sequence = 0;
const command = (input, uid) => executeFleetMembershipCommand(db, { diagnosticId: `app-test-${++sequence}-${Date.now()}`, ...input }, ctx(uid));
const withdraw = (applicationId, uid = "driver-a", companyId = "a", extra = {}) => command({ action: "withdraw-application", companyId, applicationId, ...extra }, uid);
const approve = (applicationId, companyId = "a") => command({ action: "approve-application", companyId, applicationId }, companyId === "a" ? "owner-a" : "owner-b");
const failsWith = (fn, code, reason) => assert.rejects(fn, error => {
  assert.ok(String(error.code).includes(code), `expected ${code}, got ${error.code}: ${error.message}`);
  if (reason) assert.equal(error.details?.reasonCode, reason);
  return true;
});
const get = path => db.doc(path).get();
const snapshotOf = async paths => Object.fromEntries(await Promise.all(paths.map(async path => [path, JSON.stringify((await get(path)).data() ?? null)])));
const day = n => new Date(Date.UTC(2026, 9, 1 + n)).toISOString();
const application = (companyId, extra = {}) => ({ type: "driver_application", userId: "driver-a", email: "driver-a@example.com", companyId, status: "pending", isCurrent: true,
  flowVersion: 2, fullName: "Motorista A", whatsapp: "11999990000", createdAt: day(1), ...extra });

const seed = async (extra = []) => {
  await environment.clearFirestore();
  const rows = [
    ["frotas/a", { ownerId: "owner-a", userId: "owner-a", companyName: "Empresa A", simulatorId: "GTO", status: "active" }],
    ["frotas/b", { ownerId: "owner-b", userId: "owner-b", companyName: "Empresa B", simulatorId: "GTO", status: "active" }],
    ["users/owner-a", { name: "Dono A", companyId: "a", role: "admin", status: "active" }],
    ["users/owner-b", { name: "Dono B", companyId: "b", role: "admin", status: "active" }],
    ["users/driver-a", { name: "Motorista A", email: "driver-a@example.com", role: "driver", roles: ["driver"], status: "active", memberships: {},
      currentRecruitmentApplicationId: "app-a", currentRecruitmentCompanyId: "a", currentRecruitmentStatus: "pending", currentRecruitmentType: "driver_application" }],
    ["users/driver-b", { name: "Motorista B", email: "driver-b@example.com", role: "driver", roles: ["driver"], status: "active", memberships: {} }],
    ["recruitment_applications/app-a", application("a")],
    ["recruitment_applications/app-b", application("b", { createdAt: day(2) })],
    ...extra,
  ];
  const batch = db.batch();
  rows.forEach(([ref, data]) => batch.set(db.doc(ref), data));
  await batch.commit();
  for (const [uid, companyId] of [["owner-a", "a"], ["owner-b", "b"]]) await refreshCompanyAccess(db, uid, companyId);
};

const results = [];
async function test(name, setup, fn) {
  const started = performance.now();
  try {
    await seed(setup); await fn(); results.push({ name, result: "PASS", seconds: +((performance.now() - started) / 1000).toFixed(3) });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, result: "FAIL", error: error.stack });
    console.error(`FAIL ${name}`, error);
  }
}

try {
  await test("the server lists what it understands, so a client can hide what is not published", [], async () => {
    const result = await command({ action: "capabilities" }, "driver-a");
    assert.equal(result.success, true); assert.ok(result.capabilities.includes("withdraw-application")); assert.ok(result.capabilities.includes("leave"));
    await assert.rejects(executeFleetMembershipCommand(db, { action: "capabilities", diagnosticId: "cap-anon-0001" }, {}), error => String(error.code).includes("unauthenticated"));
  });

  await test("withdrawing closes only that application and leaves the others and the account alone", [], async () => {
    const otherBefore = await snapshotOf(["recruitment_applications/app-b", "users/owner-a"]);
    const result = await withdraw("app-a");
    assert.equal(result.withdrawn, true);
    const row = (await get("recruitment_applications/app-a")).data();
    assert.equal(row.status, "withdrawn"); assert.equal(row.isCurrent, false); assert.equal(row.withdrawnBy, "driver-a"); assert.ok(row.withdrawnAt);
    assert.deepEqual(await snapshotOf(["recruitment_applications/app-b", "users/owner-a"]), otherBefore);
    const user = (await get("users/driver-a")).data();
    assert.equal(user.status, "active"); assert.equal(user.currentRecruitmentApplicationId, undefined, "the pointer to the withdrawn application is cleared");
    assert.equal((await db.collection("companyMembers").get()).size, 0);
  });

  await test("a pointer that names another application is kept", [["users/driver-a", { currentRecruitmentApplicationId: "app-b", currentRecruitmentCompanyId: "b", currentRecruitmentStatus: "pending", currentRecruitmentType: "driver_application" }]], async () => {
    await db.doc("users/driver-a").set({ name: "Motorista A", email: "driver-a@example.com", role: "driver", roles: ["driver"], status: "active", memberships: {},
      currentRecruitmentApplicationId: "app-b", currentRecruitmentCompanyId: "b", currentRecruitmentStatus: "pending", currentRecruitmentType: "driver_application" });
    await withdraw("app-a");
    assert.equal((await get("users/driver-a")).get("currentRecruitmentApplicationId"), "app-b");
  });

  await test("only the applicant can withdraw; existence of foreign applications is not revealed", [], async () => {
    const before = await snapshotOf(["recruitment_applications/app-a"]);
    await failsWith(() => withdraw("app-a", "driver-b"), "not-found", "WITHDRAW_NOT_FOUND");
    await failsWith(() => withdraw("app-a", "owner-a"), "not-found", "WITHDRAW_NOT_FOUND");
    await failsWith(() => withdraw("app-a", "driver-a", "b"), "not-found", "WITHDRAW_NOT_FOUND");
    await failsWith(() => withdraw("does-not-exist"), "not-found", "WITHDRAW_NOT_FOUND");
    await failsWith(() => withdraw("../x"), "invalid-argument");
    assert.deepEqual(await snapshotOf(["recruitment_applications/app-a"]), before);
  });

  await test("a company registration is not an application and cannot be withdrawn here", [["recruitment_applications/reg-1", { type: "company_registration", userId: "driver-a", companyId: "a", status: "pending", companyName: "X" }]], async () => {
    await failsWith(() => withdraw("reg-1"), "not-found", "WITHDRAW_NOT_FOUND");
    assert.equal((await get("recruitment_applications/reg-1")).get("status"), "pending");
  });

  await test("an answered application cannot be withdrawn", [["recruitment_applications/done", application("a", { status: "approved", createdAt: day(0) })], ["recruitment_applications/no", application("a", { status: "rejected", createdAt: day(0) })]], async () => {
    await failsWith(() => withdraw("done"), "failed-precondition", "WITHDRAW_ALREADY_APPROVED");
    await failsWith(() => withdraw("no"), "failed-precondition", "WITHDRAW_ALREADY_ANSWERED");
    assert.equal((await get("recruitment_applications/done")).get("status"), "approved");
    assert.equal((await get("recruitment_applications/no")).get("status"), "rejected");
  });

  await test("suspended accounts keep their state", [], async () => {
    await db.doc("users/driver-a").update({ status: "suspended" });
    const before = await snapshotOf(["recruitment_applications/app-a", "users/driver-a"]);
    await failsWith(() => withdraw("app-a"), "permission-denied", "WITHDRAW_ACCOUNT_UNAVAILABLE");
    assert.deepEqual(await snapshotOf(Object.keys(before)), before);
  });

  await test("repeating is idempotent: same command id replays, a new one is a harmless success", [], async () => {
    const input = { action: "withdraw-application", companyId: "a", applicationId: "app-a", diagnosticId: "withdraw-replay-0001" };
    const first = await executeFleetMembershipCommand(db, input, ctx("driver-a"));
    const replay = await executeFleetMembershipCommand(db, input, ctx("driver-a"));
    assert.deepEqual(replay, first);
    const stamp = (await get("recruitment_applications/app-a")).get("withdrawnAt").toMillis();
    const again = await withdraw("app-a");
    assert.equal(again.withdrawn, true);
    assert.equal((await get("recruitment_applications/app-a")).get("withdrawnAt").toMillis(), stamp, "the first withdrawal time is kept");
    await failsWith(() => executeFleetMembershipCommand(db, { ...input, companyId: "b" }, ctx("driver-a")), "failed-precondition", "MEMBERSHIP_COMMAND_CONFLICT");
  });

  await test("nobody can approve or reject a withdrawn application", [], async () => {
    await withdraw("app-a");
    await failsWith(() => approve("app-a"), "failed-precondition");
    assert.equal((await get("recruitment_applications/app-a")).get("status"), "withdrawn");
    assert.equal((await db.collection("companyMembers").get()).size, 0);
    await assert.rejects(rejectRecruitmentApplication.run({ applicationId: "app-a" }, ctx("owner-a")), error => String(error.code).includes("failed-precondition"));
    assert.equal((await get("recruitment_applications/app-a")).get("status"), "withdrawn", "it must not turn into a rejection");
  });

  await test("two applications to different companies are independent: approving the first works while the second is pending", [], async () => {
    // The user pointer names the NEWER application (to company b); the older one to company a must still be approvable.
    await db.doc("users/driver-a").update({ currentRecruitmentApplicationId: "app-b", currentRecruitmentCompanyId: "b" });
    const result = await approve("app-a");
    assert.equal(result.success, true);
    assert.equal((await get("recruitment_applications/app-a")).get("status"), "approved");
    assert.equal((await get("recruitment_applications/app-b")).get("status"), "pending", "the other company's application is untouched");
    assert.equal((await get("company_access/a/members/driver-a")).get("status"), "active");
    const second = await approve("app-b", "b");
    assert.equal(second.success, true);
    const user = (await get("users/driver-a")).data();
    assert.deepEqual(Object.keys(user.memberships).sort(), ["a", "b"]);
    assert.equal((await get("company_access/b/members/driver-a")).get("status"), "active");
  });

  await test("a newer application to the same company replaces the older one", [["recruitment_applications/app-a2", application("a", { createdAt: day(5) })]], async () => {
    await failsWith(() => approve("app-a"), "failed-precondition");
    assert.equal((await db.collection("companyMembers").get()).size, 0);
    assert.equal((await approve("app-a2")).success, true);
  });

  await test("withdrawing the newer one makes the older one the only live application again", [["recruitment_applications/app-a2", application("a", { createdAt: day(5) })]], async () => {
    await withdraw("app-a2");
    assert.equal((await approve("app-a")).success, true);
  });

  await test("withdraw racing with approval: exactly one wins and the state is consistent", [], async () => {
    for (let round = 0; round < 8; round += 1) {
      await seed([]);
      const outcomes = await Promise.all([
        withdraw("app-a").then(() => "withdrawn", () => "withdraw-refused"),
        approve("app-a").then(() => "approved", () => "approve-refused"),
      ]);
      const status = (await get("recruitment_applications/app-a")).get("status");
      const member = (await db.collection("companyMembers").where("userId", "==", "driver-a").get()).size;
      if (status === "approved") { assert.equal(member, 1, `round ${round}`); assert.ok(outcomes.includes("approved")); assert.equal(outcomes[0], "withdraw-refused"); }
      else { assert.equal(status, "withdrawn", `round ${round}`); assert.equal(member, 0); assert.equal(outcomes[1], "approve-refused"); }
    }
  });

  await test("leaving a company does not rewrite a withdrawn application as rejected", [
    ["recruitment_applications/old", application("a", { status: "withdrawn", isCurrent: false, createdAt: day(0), withdrawnBy: "driver-a" })],
  ], async () => {
    await approve("app-a");
    await command({ action: "leave", companyId: "a" }, "driver-a");
    assert.equal((await get("recruitment_applications/old")).get("status"), "withdrawn");
    assert.equal((await get("recruitment_applications/app-a")).get("status"), "approved");
    assert.equal((await get("recruitment_applications/app-a")).get("accessRevokedReason"), "left_company");
  });

  await test("the applicant cannot write the closing state directly (rules)", [], async () => {
    const d = environment.authenticatedContext("driver-a").firestore();
    const { doc, updateDoc } = await import("firebase/firestore");
    await assert.rejects(updateDoc(doc(d, "recruitment_applications/app-a"), { status: "withdrawn" }));
  });
} finally {
  if (process.env.NVU_TEST_OUTPUT) fs.writeFileSync(process.env.NVU_TEST_OUTPUT, JSON.stringify({ projectId, results }, null, 2));
  await environment.cleanup(); await admin.deleteApp(admin.app());
}
console.log(`FLEET_APPLICATIONS_EMULATOR ${results.filter(x => x.result === "PASS").length}/${results.length} PASS`);
if (results.some(x => x.result !== "PASS")) process.exitCode = 1;
