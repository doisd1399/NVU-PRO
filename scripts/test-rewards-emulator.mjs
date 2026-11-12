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
const campaignData = (extra = {}) => ({ companyId: "a", vehicleId: "v-1", contractId: "ct-1", name: "Semana de Ouro", startDate: day(-1), endDate: day(5), perTripCents: 2500, bonusCents: 20000, bonusGoalTrips: 3, budgetCents: 600000, audience: "all", driverIds: [], requestId: `req-${++seq}-${Date.now()}`, ...extra });
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
    ["contratos/ct-1", { companyId: "a", name: "Cargas SP", status: "active", totalDeliveries: 10, deadlineDays: 5, simulator: "GTO" }], ["contratos/ct-2", { companyId: "a", name: "Curta", status: "active", totalDeliveries: 2, deadlineDays: 5, simulator: "GTO" }], ["contratos/ct-0", { companyId: "a", name: "Vazia", status: "active", totalDeliveries: 0 }], ["contratos/ct-d", { companyId: "a", name: "Com prazo", status: "active", totalDeliveries: 2, deadlineDays: 3, simulator: "GTO" }], ["contratos/ct-b", { companyId: "b", name: "Cargas B", status: "active" }], ["contratos/ct-x", { companyId: "a", name: "Apagada", status: "active", deleted: true }],
    ["veiculos/v-1", { companyId: "a", name: "Iveco S-Way", plate: "BLS-160", status: "available" }], ["veiculos/v-b", { companyId: "b", name: "Scania", status: "available" }],
    member("drv-1", "a"), member("drv-2", "a"), member("drv-b", "b"),
  ];
  const batch = db.batch(); rows.forEach(([ref, data]) => batch.set(db.doc(ref), data)); await batch.commit();
  for (const [uid, companyId] of [["owner-a", "a"], ["owner-b", "b"], ["drv-1", "a"], ["drv-2", "a"], ["drv-b", "b"]]) await refreshCompanyAccess(db, uid, companyId).catch(() => undefined);
};
const trip = async (id, driverId, companyId, offsetMs, extra = {}) => db.doc(`historico_viagens/${id}`).set({ driverId, companyId, status: "completed", contractId: "ct-1", serverValidatedAt: admin.firestore.Timestamp.now(), completedAt: admin.firestore.Timestamp.fromMillis(Date.now() + offsetMs), valorCents: 999999, ...extra });
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
  await test("operação e limite: exige operação da própria empresa e viagens por motorista; teto sai da conta; só conta viagem da operação e até o limite", async () => {
    await failsWith(() => create({ contractId: "" }), "invalid-argument"); await failsWith(() => create({ contractId: "ct-0" }), "invalid-argument"); // operação sem viagens
    await failsWith(() => create({ contractId: "ct-b" }), "failed-precondition"); await failsWith(() => create({ contractId: "ct-x" }), "failed-precondition"); await failsWith(() => create({ contractId: "nao-existe" }), "failed-precondition");
    await failsWith(() => create({ contractId: "ct-b" }, "drv-1"), "permission-denied"); await failsWith(() => create({ contractId: "ct-b" }, "owner-b"), "permission-denied"); // gestor de outra empresa não descobre nada
    const { campaignId } = await create({ contractId: "ct-2", budgetCents: undefined, bonusCents: 0, bonusGoalTrips: 0, maxTripsPerDriver: 999 }), campaign = (await get(`rewardCampaigns/${campaignId}`)).data();
    assert.deepEqual([campaign.contractId, campaign.contractName, campaign.maxTripsPerDriver, campaign.budgetCents], ["ct-2", "Curta", 2, 2 * 2 * 2500], "as viagens vêm da operação (2), não do pedido; teto = motoristas × viagens × valor");
    const offer = (await get(`rewardOffers/${campaignId}_drv-1`)).data(); assert.deepEqual([offer.contractName, offer.maxTripsPerDriver], ["Curta", 2]);
    const whole = await create({ budgetCents: undefined, bonusCents: 0, bonusGoalTrips: 0 }), derived = (await get(`rewardCampaigns/${whole.campaignId}`)).data();
    assert.deepEqual([derived.maxTripsPerDriver, derived.budgetCents], [10, 2 * 10 * 2500], "sem limite informado vale o total de viagens da operação (10): meta de valor = R$ 25 × 10 por motorista");
    await respond(`${campaignId}_drv-1`, "accept", "drv-1");
    await trip("o1", "drv-1", "a", 1000, { contractId: "ct-2" }); await trip("o-outra", "drv-1", "a", 1500, { contractId: "ct-1" }); await trip("o-sem", "drv-1", "a", 1600, { contractId: null }); await trip("o2", "drv-1", "a", 2000, { contractId: "ct-2" }); await trip("o3", "drv-1", "a", 3000, { contractId: "ct-2" });
    await fire("o3"); const row = (await get(`rewardOffers/${campaignId}_drv-1`)).data();
    assert.deepEqual([row.trips, row.totalCents], [2, 5000], "viagem de outra operação ou sem operação não conta; a terceira passa do limite de 2");
    assert.equal((await get(`rewardCampaigns/${campaignId}`)).get("capped"), false, "o limite por motorista não é o teto");
  });
  await test("meta de ganhos da operação: separada do salário; soma os ganhos das viagens da operação; não limita o pagamento nem o teto", async () => {
    await failsWith(() => create({ goalCents: -1, budgetCents: undefined }), "invalid-argument"); await failsWith(() => create({ goalCents: 1.5, budgetCents: undefined }), "invalid-argument");
    const { campaignId } = await create({ goalCents: 1_000_000, budgetCents: undefined, bonusCents: 0, bonusGoalTrips: 0 }), campaign = (await get(`rewardCampaigns/${campaignId}`)).data();
    assert.deepEqual([campaign.goalCents, campaign.maxTripsPerDriver, campaign.budgetCents], [1_000_000, 10, 2 * 10 * 2500], "viagens vêm da operação (10); teto do salário = 2 motoristas × 10 × R$ 25, a meta não entra");
    assert.equal((await get(`rewardOffers/${campaignId}_drv-1`)).get("goalCents"), 1_000_000); await respond(`${campaignId}_drv-1`, "accept", "drv-1");
    await trip("g1", "drv-1", "a", 1001, { valorCents: 400000 }); await fire("g1"); let row = (await get(`rewardOffers/${campaignId}_drv-1`)).data();
    assert.deepEqual([row.trips, row.totalCents, row.simCents, row.goalReached], [1, 2500, 400000, false], "salário R$ 25 por viagem; a operação gerou R$ 4.000, ainda abaixo da meta de R$ 10.000");
    for (const id of ["g2", "g3"]) { await trip(id, "drv-1", "a", 1000 + Number(id.slice(1)), { valorCents: 400000 }); await fire(id); }
    row = (await get(`rewardOffers/${campaignId}_drv-1`)).data(); assert.deepEqual([row.trips, row.totalCents, row.simCents, row.goalReached], [3, 7500, 1_200_000, true], "meta da operação alcançada (R$ 12.000 ≥ R$ 10.000); o salário continua sendo só viagens × R$ 25");
  });
  await test("prazo: conta a partir do encaminhamento; concluir no prazo vale; vencido sem concluir perde o pagamento e o motorista é avisado; viagem fora do prazo não conta", async () => {
    const { campaignId } = await create({ contractId: "ct-d", startDate: undefined, endDate: undefined }), offerId = `${campaignId}_drv-1`, other = `${campaignId}_drv-2`;
    assert.equal((await get(`rewardOffers/${offerId}`)).get("deadlineDays"), 3); const before = Date.now(); await respond(offerId, "accept", "drv-1"); await respond(other, "accept", "drv-2");
    let row = (await get(`rewardOffers/${offerId}`)).data(); assert.ok(row.deadlineMs > 0 && row.deadlineMs < before + 3 * 86_400_000 + 5000 && row.deadlineMs >= before - 60_000 + 3 * 86_400_000 && row.deadlineMs === row.openDeadlineMs, "prazo = o do trabalho encaminhado (encaminhamento + dias da operação), sem recomeçar no aceite");
    const job = (await get(`trabalhos/${row.jobId}`)).data(); assert.equal(Date.parse(job.dueAt), row.deadlineMs, "o mesmo prazo do trabalho");
    await trip("d1", "drv-1", "a", 1000, { contractId: "ct-d" }); await fire("d1"); await trip("d2", "drv-2", "a", 1100, { contractId: "ct-d" }); await trip("d3", "drv-2", "a", 1200, { contractId: "ct-d" }); await fire("d3");
    row = (await get(`rewardOffers/${other}`)).data(); assert.deepEqual([row.trips, row.totalCents, row.expired === true, row.openDeadlineMs], [2, 5000, false, undefined], "concluiu no prazo: vale e o prazo aberto some");
    // o prazo do drv-1 vence sem concluir (1 de 2 viagens)
    const limit = Date.now() + 1500; await db.doc(`rewardOffers/${offerId}`).update({ deadlineMs: limit, openDeadlineMs: limit }); await new Promise(resolve => setTimeout(resolve, 1700)); // as viagens já feitas estão dentro do prazo; depois dele, nada conta
    await rewards.rewardDeadlineTick.run({}); row = (await get(`rewardOffers/${offerId}`)).data();
    assert.deepEqual([row.expired, row.trips, row.totalCents, row.tripCents, row.lostCents, row.openDeadlineMs], [true, 1, 0, 0, 2500, undefined], "perdeu o pagamento (R$ 25 ganhos ficam como perdidos)"); assert.ok(row.expiredAtMs > 0);
    const note = await db.collection("notifications").where("type", "==", "REWARD_EXPIRED").get(); assert.equal(note.size, 1); assert.equal(note.docs[0].get("userId"), "drv-1"); assert.match(note.docs[0].get("message"), /perdeu o pagamento de R\$ 25,00/);
    await rewards.rewardDeadlineTick.run({}); assert.equal((await db.collection("notifications").where("type", "==", "REWARD_EXPIRED").get()).size, 1, "repetir a varredura não avisa de novo");
    // depois do prazo, concluir não adianta: viagem fora do prazo não conta e nada é pago
    await trip("d4", "drv-1", "a", 3000, { contractId: "ct-d" }); await fire("d4"); row = (await get(`rewardOffers/${offerId}`)).data(); assert.deepEqual([row.expired, row.trips, row.totalCents], [true, 1, 0], "viagem depois do prazo não conta");
    const campaign = (await get(`rewardCampaigns/${campaignId}`)).data(); assert.equal(campaign.accruedCents, 5000, "o que foi perdido não entra no total da campanha");
  });
  await test("aviso de prazo perto de vencer: avisa quem está a menos de 36 h, uma vez", async () => {
    const { campaignId } = await create({ contractId: "ct-d" }), offerId = `${campaignId}_drv-1`; await respond(offerId, "accept", "drv-1");
    await db.doc(`rewardOffers/${offerId}`).update({ deadlineMs: Date.now() + 20 * 3_600_000, openDeadlineMs: Date.now() + 20 * 3_600_000 });
    await rewards.rewardDeadlineTick.run({}); await rewards.rewardDeadlineTick.run({}); const soon = await db.collection("notifications").where("type", "==", "REWARD_DEADLINE_SOON").get();
    assert.equal(soon.size, 1); assert.equal(soon.docs[0].get("userId"), "drv-1"); assert.equal((await get(`rewardOffers/${offerId}`)).get("expired") === true, false);
  });
  await test("campanha sem datas: vale o prazo da operação (aberta a partir de agora); com datas continua valendo o período", async () => {
    const { campaignId } = await create({ startDate: undefined, endDate: undefined }), c = (await get(`rewardCampaigns/${campaignId}`)).data();
    assert.deepEqual([c.openEnded, c.deadlineDays, c.endMs - c.startMs], [true, 5, 365 * 86_400_000]); assert.equal((await get(`rewardOffers/${campaignId}_drv-1`)).get("openEnded"), true);
    await respond(`${campaignId}_drv-1`, "accept", "drv-1"); await trip("ab1", "drv-1", "a", 1000); await fire("ab1"); assert.equal((await get(`rewardOffers/${campaignId}_drv-1`)).get("trips"), 1);
    await failsWith(() => create({ startDate: day(0), endDate: undefined }), "invalid-argument");
    assert.equal((await get(`rewardCampaigns/${(await create({}) ).campaignId}`)).get("openEnded"), false);
  });
  await test("encaminhar: o trabalho entra na fila de cada motorista com o veículo escolhido; repetir não duplica; veículo de outra empresa ou em manutenção é recusado", async () => {
    await failsWith(() => create({ vehicleId: "" }), "invalid-argument"); await failsWith(() => create({ vehicleId: "v-b" }), "failed-precondition"); await failsWith(() => create({ vehicleId: "nao-existe" }), "failed-precondition");
    await db.doc("veiculos/v-1").update({ status: "maintenance" }); await failsWith(() => create({}), "failed-precondition"); await db.doc("veiculos/v-1").update({ status: "available" });
    const data = campaignData({ audience: "all" }), first = await rewards.createRewardCampaign.run(data, ctx("owner-a"));
    assert.deepEqual([first.drivers, first.failed.length], [2, 0]);
    const offers = (await db.collection("rewardOffers").where("campaignId", "==", first.campaignId).get()).docs;
    assert.equal(offers.length, 2); for (const offer of offers) {
      const row = offer.data(), job = (await get(`trabalhos/${row.jobId}`)).data();
      assert.deepEqual([row.status, row.vehicleId, row.vehicleName, Boolean(row.dispatchedAtMs)], ["pending", "v-1", "Iveco S-Way", true]);
      assert.deepEqual([job.status, job.driverId, job.vehicleId, job.contractId, job.companyId], ["pending", row.driverId, "v-1", "ct-1", "a"], "trabalho pendente na fila do motorista");
      assert.equal(Date.parse(job.dueAt), row.deadlineMs, "prazo do pagamento = prazo do trabalho");
    }
    const jobsBefore = (await db.collection("trabalhos").get()).size; const again = await rewards.createRewardCampaign.run(data, ctx("owner-a"));
    assert.equal(again.replayed, true); assert.equal((await db.collection("trabalhos").get()).size, jobsBefore, "repetir o pedido não cria outro trabalho");
    const notes = await db.collection("notifications").where("type", "==", "REWARD_OFFER").get(); assert.equal(notes.size, 2); assert.match(notes.docs[0].get("message"), /fila/);
  });
  await test("encaminhar: quem não pode receber sai da campanha com o motivo; se ninguém pode, a campanha é encerrada", async () => {
    await db.doc("users/drv-2").update({ status: "suspended", accountStatus: "suspended" });
    const partial = await create({ audience: "selected", driverIds: ["drv-1", "drv-2"] });
    assert.equal(partial.drivers, 1); assert.deepEqual(partial.failed.map(row => row.driverId), ["drv-2"]);
    assert.equal((await get(`rewardOffers/${partial.campaignId}_drv-2`)).get("status"), "cancelled"); assert.ok((await get(`rewardOffers/${partial.campaignId}_drv-2`)).get("dispatchError"));
    assert.equal((await get(`rewardOffers/${partial.campaignId}_drv-1`)).get("status"), "pending");
    const none = await create({ audience: "selected", driverIds: ["drv-2"] }); assert.equal(none.drivers, 0); assert.equal((await get(`rewardCampaigns/${none.campaignId}`)).get("status"), "cancelled");
  });
  await test("aceitar um trabalho encaminhado não recomeça o prazo; depois do prazo já não dá para aceitar", async () => {
    const { campaignId } = await create({ contractId: "ct-d" }), offerId = `${campaignId}_drv-1`, row = (await get(`rewardOffers/${offerId}`)).data();
    await respond(offerId, "accept", "drv-1"); assert.equal((await get(`rewardOffers/${offerId}`)).get("deadlineMs"), row.deadlineMs);
    const late = `${campaignId}_drv-2`; await db.doc(`rewardOffers/${late}`).update({ deadlineMs: Date.now() - 1000, openDeadlineMs: Date.now() - 1000 });
    await failsWith(() => respond(late, "accept", "drv-2"), "failed-precondition");
  });
  await test("editar: só gestor da empresa; nome, valor por viagem e meta; cada motorista é avisado; valor travado com pagamento gerado; versão antiga é recusada", async () => {
    const { campaignId } = await create({ contractId: "ct-2", budgetCents: undefined, bonusCents: 0, bonusGoalTrips: 0, goalCents: 10000 }), offerId = `${campaignId}_drv-1`;
    await respond(offerId, "accept", "drv-1");
    const edit = (patch, uid = "owner-a") => rewards.updateRewardCampaign.run({ campaignId, ...patch }, ctx(uid));
    await failsWith(() => edit({ name: "Novo nome" }, "drv-1"), "permission-denied"); await failsWith(() => edit({ name: "Novo nome" }, "owner-b"), "permission-denied");
    await failsWith(() => edit({}), "failed-precondition"); await failsWith(() => edit({ perTripCents: 0 }), "invalid-argument"); await failsWith(() => edit({ name: "x" }), "invalid-argument");
    await failsWith(() => edit({ name: "Outro", expectedRevision: 9 }), "aborted");
    const done = await edit({ name: "Semana nova", perTripCents: 4000, goalCents: 20000, expectedRevision: 1 }); assert.deepEqual([done.revision, done.notified], [2, 2]);
    const campaign = (await get(`rewardCampaigns/${campaignId}`)).data(), offer = (await get(`rewardOffers/${offerId}`)).data();
    assert.deepEqual([campaign.name, campaign.perTripCents, campaign.goalCents, campaign.revision, campaign.budgetCents], ["Semana nova", 4000, 20000, 2, 2 * 2 * 4000], "teto recalculado");
    assert.deepEqual([offer.name, offer.perTripCents, offer.goalCents, offer.revision], ["Semana nova", 4000, 20000, 2]); assert.match(offer.changeNote, /Valor por viagem: R\$ 25,00 → R\$ 40,00/);
    const notes = await db.collection("notifications").where("type", "==", "REWARD_UPDATED").get(); assert.equal(notes.size, 2); assert.match(notes.docs[0].get("message"), /alterou as condições de Semana nova/);
    await trip("e1", "drv-1", "a", 1000, { contractId: "ct-2", valorCents: 3000 }); await fire("e1"); assert.equal((await get(`rewardOffers/${offerId}`)).get("totalCents"), 4000, "viagem nova já vale o valor editado");
    await edit({ perTripCents: 5000 }); assert.equal((await get(`rewardOffers/${offerId}`)).get("totalCents"), 5000, "o novo valor vale para as viagens já feitas");
    await db.doc(`rewardOffers/${offerId}`).update({ settledCents: 5000 }); await failsWith(() => edit({ perTripCents: 6000 }), "failed-precondition"); await edit({ name: "Só o nome" });
    await rewards.cancelRewardCampaign.run({ campaignId }, ctx("owner-a")); await failsWith(() => edit({ name: "Depois de encerrada" }), "failed-precondition");
  });
  await test("encerrar campanha tira da fila os trabalhos ainda não iniciados e avisa o gestor quando o motorista conclui", async () => {
    const { campaignId } = await create({ contractId: "ct-2", budgetCents: undefined, bonusCents: 0, bonusGoalTrips: 0 }), jobs = (await db.collection("rewardOffers").where("campaignId", "==", campaignId).get()).docs.map(row => row.get("jobId"));
    assert.equal(jobs.length, 2); await respond(`${campaignId}_drv-1`, "accept", "drv-1");
    await trip("f1", "drv-1", "a", 1000, { contractId: "ct-2" }); await trip("f2", "drv-1", "a", 1100, { contractId: "ct-2" }); await fire("f2");
    const done = await db.collection("notifications").where("type", "==", "REWARD_COMPLETED").get(); assert.ok(done.size >= 1); assert.match(done.docs[0].get("message"), /concluiu a operação Curta no prazo/);
    await rewards.cancelRewardCampaign.run({ campaignId }, ctx("owner-a"));
    const statuses = await Promise.all(jobs.map(async id => (await get(`trabalhos/${id}`)).get("status"))); assert.deepEqual(statuses.sort(), ["cancelled", "pending"], "a oferta aceita segue; a sem resposta saiu da fila");
  });
  await test("excluir do histórico: só campanha cancelada e só o gestor; some das listas mas os dados ficam; repetir é inofensivo", async () => {
    const { campaignId } = await create({ contractId: "ct-2", budgetCents: undefined, bonusCents: 0, bonusGoalTrips: 0 }), hide = (uid = "owner-a") => rewards.hideRewardCampaign.run({ campaignId }, ctx(uid));
    await failsWith(() => hide("drv-1"), "permission-denied"); await failsWith(() => hide("owner-b"), "permission-denied"); await failsWith(() => rewards.hideRewardCampaign.run({ campaignId: "rc_nada" }, ctx("owner-a")), "not-found");
    await failsWith(() => hide(), "failed-precondition"); // em andamento: primeiro se encerra
    await rewards.cancelRewardCampaign.run({ campaignId }, ctx("owner-a")); await hide(); await hide();
    const row = (await get(`rewardCampaigns/${campaignId}`)).data(); assert.deepEqual([row.hidden, row.status, row.hiddenBy], [true, "cancelled", "owner-a"]);
    assert.equal((await db.collection("rewardOffers").where("campaignId", "==", campaignId).get()).size, 2, "as ofertas e os ganhos continuam guardados");
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
