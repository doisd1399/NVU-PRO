import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";

// Recompensas (fase 1) de ponta a ponta no emulador: callables reais, gatilho real e regras reais do Firestore.
const projectId = "demo-nvu-v36-4-staging";
assert.equal(process.env.GCLOUD_PROJECT, projectId, "Only the disposable demo project is allowed");
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^127\.0\.0\.1:\d+$/);
const require = createRequire(new URL("../functions/package.json", import.meta.url));
const admin = require(process.cwd() + "/functions/lib/firebaseAdmin.js");
if (!admin.apps.length) admin.initializeApp({ projectId });
const rewards = require("./lib/rewards.js");
const { refreshCompanyAccess } = require("./lib/companyAccess.js");
const environment = await initializeTestEnvironment({ projectId, firestore: { rules: fs.readFileSync("firestore.rules", "utf8") } });
const db = admin.firestore();
const ctx = uid => ({ auth: { uid, token: {} } });
const get = path => db.doc(path).get();
const failsWith = async (fn, code) => assert.rejects(fn, error => { assert.ok(String(error.code).includes(code), `expected ${code}, got ${error.code}: ${error.message}`); return true; });
const day = offset => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offset * 86_400_000));
let seq = 0;
const campaignData = (extra = {}) => ({ companyId: "a", name: "Semana de Ouro", startDate: day(-1), endDate: day(5), perTripCents: 2500, bonusCents: 20000, bonusGoalTrips: 3, budgetCents: 600000, audience: "all", driverIds: [], requestId: `req-${++seq}-${Date.now()}`, ...extra });
const create = (extra = {}, uid = "owner-a") => rewards.createRewardCampaign.run(campaignData(extra), ctx(uid));
const respond = (offerId, decision, uid) => rewards.respondRewardOffer.run({ offerId, decision }, ctx(uid));
const member = (uid, companyId) => [`companyMembers/${uid}_${companyId}`, { userId: uid, companyId, roles: ["driver"], status: "active" }];
const seed = async () => {
  await environment.clearFirestore();
  const rows = [
    ["frotas/a", { ownerId: "owner-a", userId: "owner-a", companyName: "DC Transportes", simulatorId: "GTO", status: "active", operationalCommandVersion: 1 }],
    ["frotas/b", { ownerId: "owner-b", userId: "owner-b", companyName: "CTS", simulatorId: "GTO", status: "active", operationalCommandVersion: 1 }],
    ["users/owner-a", { name: "Dono A", companyId: "a", role: "admin", status: "active" }], ["users/owner-b", { name: "Dono B", companyId: "b", role: "admin", status: "active" }],
    ["users/drv-1", { name: "Naylson Silva", role: "driver", roles: ["driver"], companyId: "a", status: "active" }], ["users/drv-2", { name: "Dudu Tv", role: "driver", roles: ["driver"], companyId: "a", status: "active" }],
    ["users/drv-b", { name: "Caio Lima", role: "driver", roles: ["driver"], companyId: "b", status: "active" }],
    member("drv-1", "a"), member("drv-2", "a"), member("drv-b", "b"),
  ];
  const batch = db.batch(); rows.forEach(([ref, data]) => batch.set(db.doc(ref), data)); await batch.commit();
  for (const [uid, companyId] of [["owner-a", "a"], ["owner-b", "b"], ["drv-1", "a"], ["drv-2", "a"], ["drv-b", "b"]]) await refreshCompanyAccess(db, uid, companyId).catch(() => undefined);
};
const trip = async (id, driverId, companyId, offsetMs, extra = {}) => db.doc(`historico_viagens/${id}`).set({ driverId, companyId, status: "completed", serverValidatedAt: admin.firestore.Timestamp.now(), completedAt: admin.firestore.Timestamp.fromMillis(Date.now() + offsetMs), valorCents: 999999, ...extra });
const fire = async tripId => { const after = (await get(`historico_viagens/${tripId}`)).data(); return rewards.syncRewardTrips.run({ before: { exists: false, data: () => undefined }, after: { exists: true, data: () => after } }, { params: { tripId } }); };
const results = [];
async function test(name, fn) {
  const started = performance.now();
  try { await seed(); await fn(); results.push({ name, result: "PASS" }); console.log(`PASS ${name} (${((performance.now() - started) / 1000).toFixed(1)}s)`); }
  catch (error) { results.push({ name, result: "FAIL", error: error.stack }); console.error(`FAIL ${name}`, error); }
}
try {
  await test("criar: só gestor; valida nome, datas, valores e motoristas; oferta para cada motorista ativo; repetir o pedido não duplica", async () => {
    await failsWith(() => create({}, "drv-1"), "permission-denied"); await failsWith(() => create({}, "owner-b"), "permission-denied");
    await failsWith(() => create({ name: "x" }), "invalid-argument"); await failsWith(() => create({ perTripCents: 0 }), "invalid-argument");
    await failsWith(() => create({ startDate: day(3), endDate: day(1) }), "invalid-argument"); await failsWith(() => create({ startDate: day(-9), endDate: day(-5) }), "invalid-argument");
    await failsWith(() => create({ bonusGoalTrips: 0 }), "invalid-argument"); await failsWith(() => create({ budgetCents: 100 }), "invalid-argument");
    await failsWith(() => create({ audience: "selected", driverIds: [] }), "invalid-argument"); await failsWith(() => create({ audience: "selected", driverIds: ["drv-b"] }), "failed-precondition");
    const data = campaignData(), first = await rewards.createRewardCampaign.run(data, ctx("owner-a"));
    assert.equal(first.drivers, 2); assert.equal((await rewards.createRewardCampaign.run(data, ctx("owner-a"))).replayed, true);
    const offers = await db.collection("rewardOffers").where("campaignId", "==", first.campaignId).get();
    assert.deepEqual(offers.docs.map(row => row.get("status")), ["pending", "pending"]); assert.deepEqual(offers.docs.map(row => row.get("driverName")).sort(), ["Dudu Tv", "Naylson Silva"]);
    assert.equal((await get(`rewardCampaigns/${first.campaignId}`)).get("driversCount"), 2);
    const notes = await db.collection("notifications").where("type", "==", "REWARD_OFFER").get(); assert.equal(notes.size, 2);
    const selected = await create({ audience: "selected", driverIds: ["drv-1"] }); assert.equal(selected.drivers, 1);
  });
  await test("responder: só o motorista dono; aceitar/recusar; repetir é idempotente; mudar de ideia depois não vale", async () => {
    const { campaignId } = await create(), offer = `${campaignId}_drv-1`;
    await failsWith(() => respond(offer, "accept", "drv-2"), "permission-denied"); await failsWith(() => respond(offer, "talvez", "drv-1"), "invalid-argument"); await failsWith(() => respond("rc_x_nada", "accept", "drv-1"), "not-found");
    assert.equal((await respond(offer, "accept", "drv-1")).status, "accepted"); assert.equal((await respond(offer, "accept", "drv-1")).replayed, true);
    assert.ok((await get(`rewardOffers/${offer}`)).get("acceptedAtMs") > 0); assert.equal((await get(`rewardCampaigns/${campaignId}`)).get("acceptedCount"), 1);
    await failsWith(() => respond(offer, "decline", "drv-1"), "failed-precondition");
    assert.equal((await respond(`${campaignId}_drv-2`, "decline", "drv-2")).status, "declined"); assert.equal((await get(`rewardCampaigns/${campaignId}`)).get("acceptedCount"), 1);
  });
  await test("ganho: conta só viagem confirmada, do motorista, da empresa, depois do aceite e no período; cada viagem uma vez; bônus na meta", async () => {
    const { campaignId } = await create(), offer = `${campaignId}_drv-1`;
    await trip("antes", "drv-1", "a", -60_000); await respond(offer, "accept", "drv-1"); // viagem anterior ao aceite não conta
    await trip("t1", "drv-1", "a", 1000); await fire("t1");
    await trip("t2", "drv-1", "a", 2000); await trip("pendente", "drv-1", "a", 2500, { status: "pending_sync", serverValidatedAt: null }); await trip("outra", "drv-1", "b", 2600); await trip("outro-motorista", "drv-2", "a", 2700);
    await fire("t2"); let row = (await get(`rewardOffers/${offer}`)).data();
    assert.deepEqual([row.trips, row.tripCents, row.bonusEarnedCents, row.totalCents, row.goalReached], [2, 5000, 0, 5000, false], "valor fixo por viagem, não o valor da viagem");
    await fire("t2"); assert.equal((await get(`rewardOffers/${offer}`)).get("trips"), 2, "repetir o gatilho não conta de novo");
    await trip("t3", "drv-1", "a", 3000); await fire("t3"); row = (await get(`rewardOffers/${offer}`)).data();
    assert.deepEqual([row.trips, row.bonusEarnedCents, row.totalCents, row.goalReached], [3, 20000, 27500, true], "meta de 3 viagens paga o bônus");
    const campaign = (await get(`rewardCampaigns/${campaignId}`)).data(); assert.deepEqual([campaign.accruedCents, campaign.tripsCount, campaign.capped], [27500, 3, false]);
    assert.equal((await get(`rewardOffers/${campaignId}_drv-2`)).get("trips"), 0, "quem não aceitou não ganha");
  });
  await test("teto: ao chegar no teto a campanha para de creditar, avisa o gestor e nada passa do teto", async () => {
    const { campaignId } = await create({ budgetCents: 6000, bonusCents: 0, bonusGoalTrips: 0 }), offer = `${campaignId}_drv-1`;
    await respond(offer, "accept", "drv-1");
    for (const [index, id] of ["c1", "c2", "c3"].entries()) { await trip(id, "drv-1", "a", 1000 * (index + 1)); await fire(id); }
    const campaign = (await get(`rewardCampaigns/${campaignId}`)).data(), row = (await get(`rewardOffers/${offer}`)).data();
    assert.deepEqual([campaign.accruedCents, campaign.capped, row.trips, row.totalCents], [5000, true, 2, 5000], "R$ 25 × 2 = 50 e a terceira passaria de R$ 60? 75 > 60");
    assert.ok((await db.collection("notifications").where("type", "==", "REWARD_CAP").get()).size >= 1);
  });
  await test("encerrar: só o gestor; ofertas sem resposta são canceladas; encerrada não credita mais", async () => {
    const { campaignId } = await create(); await respond(`${campaignId}_drv-1`, "accept", "drv-1");
    await failsWith(() => rewards.cancelRewardCampaign.run({ campaignId }, ctx("drv-1")), "permission-denied"); await failsWith(() => rewards.cancelRewardCampaign.run({ campaignId }, ctx("owner-b")), "permission-denied");
    await rewards.cancelRewardCampaign.run({ campaignId }, ctx("owner-a")); await rewards.cancelRewardCampaign.run({ campaignId }, ctx("owner-a"));
    assert.equal((await get(`rewardCampaigns/${campaignId}`)).get("status"), "cancelled"); assert.equal((await get(`rewardOffers/${campaignId}_drv-2`)).get("status"), "cancelled"); assert.equal((await get(`rewardOffers/${campaignId}_drv-1`)).get("status"), "accepted");
    await failsWith(() => respond(`${campaignId}_drv-2`, "accept", "drv-2"), "failed-precondition");
    await trip("depois", "drv-1", "a", 5000); await fire("depois"); assert.equal((await get(`rewardOffers/${campaignId}_drv-1`)).get("trips"), 0);
  });
  await test("regras do Firestore: gestão lê campanhas; motorista lê só a própria oferta; ninguém escreve do cliente", async () => {
    const { campaignId } = await create(); const offer = `${campaignId}_drv-1`;
    const read = (uid, path) => getDoc(doc(environment.authenticatedContext(uid).firestore(), ...path.split("/")));
    await assertSucceeds(read("owner-a", `rewardCampaigns/${campaignId}`)); await assertFails(read("drv-1", `rewardCampaigns/${campaignId}`)); await assertFails(read("owner-b", `rewardCampaigns/${campaignId}`));
    await assertSucceeds(read("drv-1", `rewardOffers/${offer}`)); await assertSucceeds(read("owner-a", `rewardOffers/${offer}`)); await assertFails(read("drv-2", `rewardOffers/${offer}`)); await assertFails(read("owner-b", `rewardOffers/${offer}`));
    const mine = uid => getDocs(query(collection(environment.authenticatedContext(uid).firestore(), "rewardOffers"), where("driverId", "==", uid)));
    assert.equal((await assertSucceeds(mine("drv-1"))).size, 1);
    await assertSucceeds(getDocs(query(collection(environment.authenticatedContext("owner-a").firestore(), "rewardCampaigns"), where("companyId", "==", "a")))); await assertFails(getDocs(query(collection(environment.authenticatedContext("owner-b").firestore(), "rewardCampaigns"), where("companyId", "==", "a"))));
    const ref = (uid, path) => doc(environment.authenticatedContext(uid).firestore(), ...path.split("/"));
    await assertFails(updateDoc(ref("drv-1", `rewardOffers/${offer}`), { status: "accepted", totalCents: 99999999 })); await assertFails(updateDoc(ref("owner-a", `rewardCampaigns/${campaignId}`), { budgetCents: 1 })); await assertFails(setDoc(ref("owner-a", "rewardCampaigns/rc_forjada"), { companyId: "a" }));
  });
} finally { await environment.cleanup(); }
const failed = results.filter(row => row.result !== "PASS");
console.log(`${results.length - failed.length}/${results.length} cenários de Recompensas passaram.`);
if (failed.length) process.exit(1);
