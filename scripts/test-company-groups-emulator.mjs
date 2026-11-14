import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";

// One company, several simulators: extra fleets created per simulator (same identity, own fleet) and the shared rename.
const projectId = "demo-nvu-v36-4-staging";
assert.equal(process.env.GCLOUD_PROJECT, projectId, "Only the disposable demo project is allowed");
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^127\.0\.0\.1:\d+$/);
const require = createRequire(new URL("../functions/package.json", import.meta.url));
const admin = require(process.cwd() + "/functions/lib/firebaseAdmin.js");
if (!admin.apps.length) admin.initializeApp({ projectId });
const { addCompanySimulatorsCore, renameCompanyGroupCore, deactivateCompanySimulatorsCore, companyGroupCapabilities, simulatorAliases } = require("./lib/companyGroups.js");
const { refreshCompanyAccess } = require("./lib/companyAccess.js");
const environment = await initializeTestEnvironment({ projectId, firestore: { rules: fs.readFileSync("firestore.rules", "utf8") } });
const db = admin.firestore();
const ctx = (uid, token = {}) => ({ auth: { uid, token } });
const add = (companyId, simulatorIds, uid = "owner-a", token = {}, extra = {}) => addCompanySimulatorsCore(db, ctx(uid, token), { companyId, simulatorIds, ...extra });
const rename = (companyId, companyName, uid = "owner-a", token = {}) => renameCompanyGroupCore(db, ctx(uid, token), { companyId, companyName });
const deactivate = (companyId, companyIds, uid = "owner-a", token = {}) => deactivateCompanySimulatorsCore(db, ctx(uid, token), { companyId, companyIds });
const failsWith = (fn, code, reason) => assert.rejects(fn, error => {
  assert.ok(String(error.code).includes(code), `expected ${code}, got ${error.code}: ${error.message}`);
  if (reason) assert.equal(error.details?.reasonCode, reason);
  return true;
});
const get = path => db.doc(path).get();
const idsOf = items => items.map(item => item.simulatorId).sort();

const source = { companyName: "DC Transportes", ownerName: "David Canto", email: "owner-a@example.com", ownerEmail: "owner-a@example.com", cnpj: "49.610.133/0001-79",
  whatsapp: "22998291399", logoUrl: "https://example.test/logo.png", logoStoragePath: "empresas/a/logo.jpg", ownerPhotoUrl: "https://example.test/owner.png",
  ownerId: "owner-a", userId: "owner-a", simulatorId: "gto", simulatorName: "GTO", status: "active", createdAt: "2026-05-27T00:00:00.000Z",
  operationalCommandVersion: 1, recruitmentSettings: { isActive: true, about: "Somos a DC" }, profileDescription: "Descrição só do ambiente atual" };
const seed = async (extra = []) => {
  await environment.clearFirestore();
  const rows = [
    ["frotas/a", source],
    ["users/owner-a", { name: "David Canto", role: "admin", status: "active", companyId: "a" }],
    ["users/manager-a", { name: "Gerente", role: "admin", status: "active", companyId: "a" }],
    ["users/driver-a", { name: "Motorista", role: "driver", status: "active", companyId: "a" }],
    ["users/senior", { name: "Sênior", role: "senior", status: "active" }],
    ["users/owner-z", { name: "Outro dono", role: "admin", status: "active", companyId: "z" }],
    ["frotas/z", { ...source, companyName: "Outra", ownerId: "owner-z", userId: "owner-z" }],
    ["companyMembers/a_owner-a", { companyId: "a", userId: "owner-a", roles: ["admin", "driver"], status: "active", permissions: ["admin", "owner"] }],
    ["companyMembers/a_manager-a", { companyId: "a", userId: "manager-a", roles: ["admin", "driver"], status: "active" }],
    ["simulators/gto", { name: "GTO", active: true }], ["simulators/ats", { name: "ATS", active: true }], ["simulators/ets-2", { name: "ETS 2", active: true }],
    ["simulators/wtds", { name: "WTDS", active: true }], ["simulators/off", { name: "Desligado", active: false }],
    ...extra,
  ];
  const batch = db.batch();
  rows.forEach(([ref, data]) => batch.set(db.doc(ref), data));
  await batch.commit();
  await refreshCompanyAccess(db, "owner-a", "a");
};

const results = [];
async function test(name, setup, fn) {
  const started = performance.now();
  try { await seed(setup); await fn(); results.push({ name, result: "PASS", seconds: +((performance.now() - started) / 1000).toFixed(3) }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, result: "FAIL", error: error.stack }); console.error(`FAIL ${name}`, error); }
}

try {
  await test("the server lists what it understands, so a client can hide what is not published", [], async () => {
    assert.deepEqual(companyGroupCapabilities().capabilities, ["add-simulators", "rename", "deactivate-simulators"]);
    assert.equal(companyGroupCapabilities().success, true);
  });

  await test("simulator spellings of one simulator are recognised as the same", [], async () => {
    assert.ok(simulatorAliases("global-truck-online").has("gto"));
    assert.ok(simulatorAliases("Euro Truck Simulator 2").has("ets-2"));
    assert.ok(!simulatorAliases("ats").has("gto"));
  });

  await test("the owner adds simulators: one fleet each, same identity, own fleet, owner as administrator", [], async () => {
    const before = (await get("frotas/a")).data();
    const result = await add("a", ["ats", "ets-2"]);
    assert.deepEqual(idsOf(result.created), ["ats", "ets-2"]); assert.equal(result.existing.length, 0); assert.equal(result.skipped.length, 0);
    assert.equal(result.groupId, "a");
    for (const item of result.created) {
      const fleet = (await get(`frotas/${item.companyId}`)).data();
      for (const field of ["companyName", "ownerName", "email", "ownerEmail", "cnpj", "whatsapp", "logoUrl", "logoStoragePath", "ownerPhotoUrl"]) assert.equal(fleet[field], source[field], field);
      assert.equal(fleet.ownerId, "owner-a"); assert.equal(fleet.userId, "owner-a"); assert.equal(fleet.status, "active");
      assert.equal(fleet.simulatorId, item.simulatorId); assert.equal(fleet.simulatorName, item.simulatorName);
      assert.equal(fleet.companyGroupId, "a"); assert.equal(fleet.sourceCompanyId, "a"); assert.equal(fleet.addedBy, "owner-a");
      // Operational state and settings of the first fleet are not copied: each simulator starts clean.
      assert.equal(fleet.operationalCommandVersion, undefined); assert.equal(fleet.recruitmentSettings, undefined); assert.equal(fleet.profileDescription, undefined);
      const member = (await get(`companyMembers/${item.companyId}_owner-a`)).data();
      assert.deepEqual(member.roles, ["admin", "driver"]); assert.equal(member.status, "active"); assert.ok(member.permissions.includes("owner"));
      const simulatorMember = (await get(`simulator_members/owner-a_${item.companyId}`)).data();
      assert.equal(simulatorMember.simulatorId, item.simulatorId); assert.equal(simulatorMember.isEligible, true);
    }
    const after = (await get("frotas/a")).data();
    assert.deepEqual({ ...after, companyGroupId: undefined }, { ...before, companyGroupId: undefined }, "the first fleet changes only by getting its group id");
    assert.equal(after.companyGroupId, "a");
  });

  await test("the new fleets work with the real rules: the owner reads and manages them, a stranger does not", [], async () => {
    const result = await add("a", ["ats"]);
    const id = result.created[0].companyId;
    await refreshCompanyAccess(db, "owner-a", id);
    const { doc, getDoc, setDoc } = await import("firebase/firestore");
    const owner = environment.authenticatedContext("owner-a").firestore();
    assert.equal((await getDoc(doc(owner, `frotas/${id}`))).data().simulatorName, "ATS");
    await setDoc(doc(owner, `veiculos/v-${id}`), { companyId: id, name: "Scania G" });
    const stranger = environment.authenticatedContext("owner-z").firestore();
    await assert.rejects(getDoc(doc(stranger, `frotas/${id}`)));
    await assert.rejects(setDoc(doc(stranger, `veiculos/x-${id}`), { companyId: id, name: "Intruso" }));
  });

  await test("a simulator the company already has is skipped, also under another spelling; repeating the command is safe", [], async () => {
    await db.doc("frotas/a").update({ simulatorId: "global-truck-online", simulatorName: "Global Truck Online" });
    const first = await add("a", ["gto", "ats"]);
    assert.deepEqual(idsOf(first.created), ["ats"]); assert.deepEqual(first.skipped, [{ simulatorId: "gto", reason: "already-in-group" }]);
    const again = await add("a", ["ats", "gto"]);
    assert.equal(again.created.length, 0); assert.deepEqual(again.skipped.map(item => item.reason), ["already-in-group", "already-in-group"]);
    const fleets = await db.collection("frotas").where("companyGroupId", "==", "a").get();
    assert.equal(fleets.size, 2, "no duplicate fleets");
  });

  await test("unknown and switched-off simulators are skipped, the valid ones are still created", [], async () => {
    const result = await add("a", ["nope", "off", "wtds"]);
    assert.deepEqual(idsOf(result.created), ["wtds"]);
    assert.deepEqual(result.skipped.sort((a, b) => a.simulatorId.localeCompare(b.simulatorId)), [{ simulatorId: "nope", reason: "unknown-simulator" }, { simulatorId: "off", reason: "inactive-simulator" }]);
  });

  await test("a deleted fleet does not block adding its simulator again (the new one gets a fresh id)", [], async () => {
    const first = await add("a", ["ats"]);
    await db.doc(`frotas/${first.created[0].companyId}`).update({ deleted: true, status: "deleted" });
    const second = await add("a", ["ats"]);
    assert.equal(second.created.length, 1); assert.notEqual(second.created[0].companyId, first.created[0].companyId);
    assert.equal((await get(`frotas/${second.created[0].companyId}`)).get("status"), "active");
  });

  await test("only the owner (or a Senior) can add; managers, drivers and strangers cannot", [], async () => {
    const before = (await db.collection("frotas").get()).size;
    await failsWith(() => add("a", ["ats"], "manager-a"), "permission-denied", "GROUP_OWNER_ONLY");
    await failsWith(() => add("a", ["ats"], "driver-a"), "permission-denied", "GROUP_OWNER_ONLY");
    await failsWith(() => add("a", ["ats"], "owner-z"), "permission-denied", "GROUP_OWNER_ONLY");
    await assert.rejects(addCompanySimulatorsCore(db, {}, { companyId: "a", simulatorIds: ["ats"] }), error => String(error.code).includes("unauthenticated"));
    assert.equal((await db.collection("frotas").get()).size, before, "nothing was created");
    const senior = await add("a", ["ats"], "senior", { senior: true }, { registrationId: "reg-1" });
    assert.equal(senior.created.length, 1);
    assert.equal((await get(`frotas/${senior.created[0].companyId}`)).get("sourceRegistrationId"), "reg-1");
    assert.equal((await get(`frotas/${senior.created[0].companyId}`)).get("ownerId"), "owner-a", "the owner stays the owner when a Senior adds the fleet");
  });

  await test("a suspended owner and an unavailable company are refused", [], async () => {
    await db.doc("users/owner-a").update({ status: "suspended" });
    await failsWith(() => add("a", ["ats"]), "permission-denied", "GROUP_ACCOUNT_UNAVAILABLE");
    await db.doc("users/owner-a").update({ status: "active" });
    await db.doc("frotas/a").update({ deleted: true });
    await failsWith(() => add("a", ["ats"]), "failed-precondition", "GROUP_COMPANY_UNAVAILABLE");
    await failsWith(() => add("missing", ["ats"]), "not-found", "GROUP_COMPANY_NOT_FOUND");
  });

  await test("malformed requests are refused", [], async () => {
    await failsWith(() => add("a", []), "invalid-argument", "GROUP_NO_SIMULATOR");
    await failsWith(() => add("a", "ats"), "invalid-argument", "GROUP_NO_SIMULATOR");
    await failsWith(() => add("a", Array.from({ length: 13 }, (_, i) => `s${i}`)), "invalid-argument", "GROUP_TOO_MANY");
    await failsWith(() => add("../a", ["ats"]), "invalid-argument");
    await failsWith(() => add("a", ["a/b"]), "invalid-argument");
  });

  await test("renaming writes the new name to every fleet of the company and to no other company", [], async () => {
    const created = await add("a", ["ats", "ets-2"]);
    const otherBefore = JSON.stringify((await get("frotas/z")).data());
    const result = await rename("a", "  DC   Logística  ");
    assert.equal(result.companyName, "DC Logística"); assert.equal(result.updated, 3);
    for (const id of ["a", ...created.created.map(item => item.companyId)]) assert.equal((await get(`frotas/${id}`)).get("companyName"), "DC Logística");
    assert.equal(JSON.stringify((await get("frotas/z")).data()), otherBefore);
    // Renaming from any fleet of the group reaches the same set.
    const again = await rename(created.created[0].companyId, "DC Cargas");
    assert.equal(again.updated, 3); assert.equal((await get("frotas/a")).get("companyName"), "DC Cargas");
    assert.equal((await rename("a", "DC Cargas")).updated, 0, "same name: nothing to write");
  });

  await test("rename: owner or Senior only, name required, deleted fleets untouched, a lone company works", [], async () => {
    await failsWith(() => rename("a", "Novo", "manager-a"), "permission-denied", "GROUP_OWNER_ONLY");
    await failsWith(() => rename("a", "Novo", "owner-z"), "permission-denied", "GROUP_OWNER_ONLY");
    await failsWith(() => rename("a", "   "), "invalid-argument", "GROUP_NAME_REQUIRED");
    await failsWith(() => rename("a", "x".repeat(201)), "invalid-argument", "GROUP_NAME_TOO_LONG");
    assert.equal((await get("frotas/a")).get("companyName"), "DC Transportes");
    const lone = await rename("a", "Só Eu"); assert.equal(lone.updated, 1); assert.equal(lone.groupId, "a");
    const created = await add("a", ["ats"]);
    await db.doc(`frotas/${created.created[0].companyId}`).update({ deleted: true, status: "deleted" });
    assert.equal((await rename("a", "Depois", "senior", { senior: true })).updated, 1);
    assert.equal((await get(`frotas/${created.created[0].companyId}`)).get("companyName"), "Só Eu", "a deleted fleet keeps its history");
  });

  await test("deactivating a simulator archives its fleet without deleting anything; the company keeps working in the others", [], async () => {
    const created = await add("a", ["ats", "ets-2"]);
    const ats = created.created.find(item => item.simulatorId === "ats").companyId;
    await db.doc(`trips/t1`).set({ companyId: ats, amount: 10 });
    const result = await deactivate("a", [ats]);
    assert.deepEqual(result.deactivated.map(item => item.simulatorId), ["ats"]); assert.equal(result.remaining, 2); assert.deepEqual(result.alreadyInactive, []);
    const fleet = (await get(`frotas/${ats}`)).data();
    assert.equal(fleet.status, "archived"); assert.equal(fleet.deactivatedForSimulator, true); assert.equal(fleet.deactivatedBy, "owner-a");
    assert.equal(fleet.companyName, "DC Transportes", "identity and data stay");
    assert.equal((await get("trips/t1")).get("amount"), 10, "history untouched");
    assert.equal((await get(`companyMembers/${ats}_owner-a`)).get("status"), "active", "membership rows are kept so the fleet can come back");
    assert.equal((await get("frotas/a")).get("status"), "active");
    // Repeating the command is harmless.
    const again = await deactivate("a", [ats]); assert.deepEqual(again.alreadyInactive, [ats]); assert.equal(again.deactivated.length, 0);
    // A deactivated fleet is not part of rename, and does not block the same simulator from the "taken" list.
    assert.equal((await rename("a", "DC Nova")).updated, 2);
    assert.equal((await get(`frotas/${ats}`)).get("companyName"), "DC Transportes");
  });

  await test("adding the simulator again brings the same fleet back (with the current identity), not a second one", [], async () => {
    const created = await add("a", ["ats"]);
    const ats = created.created[0].companyId;
    await deactivate("a", [ats]);
    await rename("a", "DC Renovada");
    const back = await add("a", ["ats"]);
    assert.equal(back.created.length, 0); assert.deepEqual(back.reactivated.map(item => item.companyId), [ats]);
    const fleet = (await get(`frotas/${ats}`)).data();
    assert.equal(fleet.status, "active"); assert.equal(fleet.deactivatedForSimulator, undefined); assert.equal(fleet.deactivatedBy, undefined);
    assert.equal(fleet.companyName, "DC Renovada", "name was brought up to date");
    assert.equal(fleet.reactivatedBy, "owner-a");
    const fleets = await db.collection("frotas").where("companyGroupId", "==", "a").get();
    assert.equal(fleets.size, 2, "no extra fleet was created");
  });

  await test("deactivation is refused for the last simulator, with an operation open, for strangers and for non members of the group", [], async () => {
    const created = await add("a", ["ats"]);
    const ats = created.created[0].companyId;
    await failsWith(() => deactivate("a", ["a", ats]), "failed-precondition", "GROUP_LAST_SIMULATOR");
    await db.doc("trabalhos/open1").set({ companyId: ats, status: "in_progress" });
    await failsWith(() => deactivate("a", [ats]), "failed-precondition", "GROUP_OPEN_OPERATIONS");
    assert.equal((await get(`frotas/${ats}`)).get("status"), "active");
    await db.doc("trabalhos/open1").update({ status: "completed" });
    await failsWith(() => deactivate("a", [ats], "manager-a"), "permission-denied", "GROUP_OWNER_ONLY");
    await failsWith(() => deactivate("a", ["z"]), "invalid-argument", "GROUP_NOT_IN_GROUP");
    await failsWith(() => deactivate("a", []), "invalid-argument", "GROUP_NO_SIMULATOR");
    assert.equal((await deactivate("a", [ats], "senior", { senior: true })).deactivated.length, 1);
  });
} finally {
  if (process.env.NVU_TEST_OUTPUT) fs.writeFileSync(process.env.NVU_TEST_OUTPUT, JSON.stringify({ projectId, results }, null, 2));
  await environment.cleanup(); await admin.deleteApp(admin.app());
}
console.log(`COMPANY_GROUPS_EMULATOR ${results.filter(x => x.result === "PASS").length}/${results.length} PASS`);
if (results.some(x => x.result !== "PASS")) process.exitCode = 1;
