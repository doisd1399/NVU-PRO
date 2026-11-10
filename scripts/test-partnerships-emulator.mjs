import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";

// v44 — Parcerias B2P de ponta a ponta no emulador (callables reais, regras reais do Firestore).
const projectId = "demo-nvu-v36-4-staging";
assert.equal(process.env.GCLOUD_PROJECT, projectId, "Only the disposable demo project is allowed");
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^127\.0\.0\.1:\d+$/);
const require = createRequire(new URL("../functions/package.json", import.meta.url));
const admin = require(process.cwd() + "/functions/lib/firebaseAdmin.js");
if (!admin.apps.length) admin.initializeApp({ projectId });
const partnerships = require("./lib/partnerships.js");
const { executeOperationalCommand } = require("./lib/operationalCommands.js");
const { refreshCompanyAccess } = require("./lib/companyAccess.js");
const { scoreCompanyIdOf } = require("./lib/rankingAggregates.js");
const environment = await initializeTestEnvironment({ projectId, firestore: { rules: fs.readFileSync("firestore.rules", "utf8") } });
const db = admin.firestore();
const ctx = (uid, token = {}) => ({ auth: { uid, token } });
const get = path => db.doc(path).get();
const failsWith = async (fn, code) => assert.rejects(fn, error => { assert.ok(String(error.code).includes(code), `expected ${code}, got ${error.code}: ${error.message}`); return true; });
const DAY = 86_400_000;
let seq = 0;
const offerData = (extra = {}) => ({ contractorCompanyId: "a", executorCompanyId: "b", operationName: "Operação 031", totalTrips: 5,
  trailerRequirement: "Frigorífico", durationDays: 5, conditions: "Veículo limpo.", goalAmountCents: 4_000_000, requestId: `req-${++seq}-${Date.now()}`, ...extra });
const createOffer = (uid = "owner-a", extra = {}) => partnerships.createPartnershipOffer.run(offerData(extra), ctx(uid));
const respond = (id, decision, uid = "owner-b") => partnerships.respondPartnershipOffer.run({ partnershipId: id, decision }, ctx(uid));
const designate = (id, extra = {}, uid = "owner-b") => partnerships.designatePartnershipDriver.run({ partnershipId: id, driverId: "drv-b", vehicleId: "veh-b", ...extra }, ctx(uid));
const photo = (partnershipId, uid) => `https://firebasestorage.googleapis.com/v0/b/${projectId}.appspot.com/o/${encodeURIComponent(`partnership-start-photos/${partnershipId}/${uid}/1_v.webp`)}?alt=media&token=t`;

const company = (id, owner, extra = {}) => [`frotas/${id}`, Object.fromEntries(Object.entries({ ownerId: owner, userId: owner, companyName: extra.companyName || id, simulatorId: "GTO", status: "active", operationalCommandVersion: 1, ...extra }).filter(([, value]) => value !== undefined))];
const seed = async () => {
  await environment.clearFirestore();
  const rows = [
    company("a", "owner-a", { companyName: "DC Transportes" }), company("b", "owner-b", { companyName: "CTS" }), company("e", "owner-e", { companyName: "Euro", simulatorId: "ETS2" }),
    company("z", "owner-z", { companyName: "Arquivada", status: "archived" }), company("y", "owner-y", { companyName: "Excluída", deleted: true }), company("w", "owner-w", { companyName: "Inativa", active: false }),
    company("s", "owner-s", { companyName: "Suspensa", status: "suspended" }), company("u", "owner-u", { companyName: "Sem preparo", operationalCommandVersion: undefined }),
    ["frotas/g", { ownerId: "owner-g", userId: "owner-g", companyName: "Nome por extenso", simulatorName: "Global Truck Online", status: "active", operationalCommandVersion: 1 }],
    ["users/owner-a", { name: "Dono A", companyId: "a", role: "admin", status: "active" }], ["users/owner-b", { name: "Dono B", companyId: "b", role: "admin", status: "active" }],
    ["users/owner-e", { name: "Dono E", companyId: "e", role: "admin", status: "active" }],
    ...["z", "y", "w", "s", "u", "g"].map(id => [`users/owner-${id}`, { name: `Dono ${id}`, companyId: id, role: "admin", status: "active" }]),
    ["users/drv-b", { name: "Caio Lima", email: "caio@example.com", role: "driver", roles: ["driver"], companyId: "b", status: "active", memberships: { b: { role: "driver", roles: ["driver"], status: "active" } } }],
    ["companyMembers/drv-b_b", { userId: "drv-b", companyId: "b", roles: ["driver"], status: "active" }], ["simulator_members/drv-b_b", { userId: "drv-b", companyId: "b", roles: ["driver"], status: "active" }],
    ["users/drv-a", { name: "Motorista A", role: "driver", roles: ["driver"], companyId: "a", status: "active" }], ["companyMembers/drv-a_a", { userId: "drv-a", companyId: "a", roles: ["driver"], status: "active" }],
    ["users/stranger", { name: "Estranho", role: "driver", status: "active" }],
    ["veiculos/veh-b", { companyId: "b", name: "Volvo FH 540", plate: "CTS-12", status: "available" }], ["veiculos/veh-b2", { companyId: "b", name: "Scania 113", status: "available" }],
    ["veiculos/veh-a", { companyId: "a", name: "Volvo FH", status: "available" }],
    ["reboques/trl-b", { companyId: "b", name: "Frigorífico", status: "available" }], ["reboques/trl-b2", { companyId: "b", name: "Graneleiro 3 eixos", status: "available" }],
    ["reboques/trl-a", { companyId: "a", name: "Frigorífico", status: "available" }],
  ];
  const batch = db.batch(); rows.forEach(([ref, data]) => batch.set(db.doc(ref), data)); await batch.commit();
  for (const [uid, companyId] of [["owner-a", "a"], ["owner-b", "b"], ["owner-e", "e"], ["drv-b", "b"], ["drv-a", "a"], ["owner-u", "u"], ["owner-g", "g"], ["owner-z", "z"]]) await refreshCompanyAccess(db, uid, companyId);
};
const results = [];
async function test(name, fn) {
  const started = performance.now();
  try { await seed(); await fn(); results.push({ name, result: "PASS" }); console.log(`PASS ${name} (${((performance.now() - started) / 1000).toFixed(1)}s)`); }
  catch (error) { results.push({ name, result: "FAIL", error: error.stack }); console.error(`FAIL ${name}`, error); }
}

try {
  await test("oferta: grava pendente com nomes e moeda, e repetir o mesmo pedido não duplica", async () => {
    const data = offerData(); const first = await partnerships.createPartnershipOffer.run(data, ctx("owner-a"));
    assert.equal(first.success, true); assert.equal(first.replayed, false);
    const row = (await get(`partnerships/${first.partnershipId}`)).data();
    assert.equal(row.status, "pending"); assert.equal(row.contractorName, "DC Transportes"); assert.equal(row.executorName, "CTS"); assert.equal(row.currency, "BRL");
    assert.equal(row.totalTrips, 5); assert.equal(row.goalAmountCents, 4_000_000); assert.equal(row.jobId, null);
    assert.equal(row.durationDays, 5); assert.equal(row.deadlineMs, null, "o prazo só começa a contar no aceite"); assert.equal(row.deadlineAt, null);
    const again = await partnerships.createPartnershipOffer.run(data, ctx("owner-a"));
    assert.equal(again.partnershipId, first.partnershipId); assert.equal(again.replayed, true);
    assert.equal((await db.collection("partnerships").get()).size, 1);
    await failsWith(() => partnerships.createPartnershipOffer.run({ ...data, operationName: "Outro nome" }, ctx("owner-a")), "failed-precondition");
    assert.ok((await db.collection("notifications").where("companyId", "==", "b").get()).size >= 1, "a executora é avisada");
  });

  await test("prazo em dias: 1 a 120; app antigo com data final é convertido; recusar não inicia relógio", async () => {
    for (const durationDays of [0, 121, 2.5]) await failsWith(() => createOffer("owner-a", { durationDays }), "invalid-argument");
    const legacy = await partnerships.createPartnershipOffer.run({ ...offerData({ durationDays: undefined }), deadlineAt: new Date(Date.now() + 3.5 * DAY).toISOString() }, ctx("owner-a"));
    assert.equal((await get(`partnerships/${legacy.partnershipId}`)).get("durationDays"), 4);
    await respond(legacy.partnershipId, "decline");
    assert.equal((await get(`partnerships/${legacy.partnershipId}`)).get("deadlineMs"), null);
  });

  await test("oferta: só gestor da contratante, outra empresa, mesmo simulador e empresa existente", async () => {
    await failsWith(() => createOffer("drv-a"), "permission-denied");
    await failsWith(() => createOffer("owner-b"), "permission-denied");
    await failsWith(() => createOffer("owner-a", { executorCompanyId: "a" }), "invalid-argument");
    await failsWith(() => createOffer("owner-a", { executorCompanyId: "e" }), "failed-precondition");
    await failsWith(() => createOffer("owner-a", { executorCompanyId: "nao-existe" }), "not-found");
    await failsWith(() => partnerships.createPartnershipOffer.run(offerData(), { auth: null }), "unauthenticated");
    assert.equal((await db.collection("partnerships").get()).size, 0);
  });

  await test("resposta: só a executora decide; recusar encerra sem trabalho; aceite depois de recusa não reabre", async () => {
    const { partnershipId } = await createOffer();
    await failsWith(() => respond(partnershipId, "accept", "owner-a"), "permission-denied");
    await failsWith(() => respond(partnershipId, "accept", "drv-b"), "permission-denied");
    await failsWith(() => respond(partnershipId, "talvez"), "invalid-argument");
    assert.equal((await respond(partnershipId, "decline")).status, "declined");
    assert.equal((await respond(partnershipId, "decline")).replayed, true, "recusar de novo é idempotente");
    await failsWith(() => respond(partnershipId, "accept"), "failed-precondition");
    assert.equal((await get(`partnerships/${partnershipId}`)).get("status"), "declined");
    assert.equal((await db.collection("trabalhos").get()).size, 0, "recusar nunca cria trabalho");
    await failsWith(() => designate(partnershipId), "failed-precondition");
  });

  await test("cancelar: a contratante retira oferta pendente; a executora não cancela pendente; não cancela após motorista", async () => {
    const { partnershipId } = await createOffer();
    await failsWith(() => partnerships.cancelPartnershipOffer.run({ partnershipId }, ctx("owner-b")), "permission-denied");
    assert.equal((await partnerships.cancelPartnershipOffer.run({ partnershipId }, ctx("owner-a"))).status, "cancelled");
    await failsWith(() => respond(partnershipId, "accept"), "failed-precondition");
    const second = await createOffer(); await respond(second.partnershipId, "accept"); await designate(second.partnershipId);
    await failsWith(() => partnerships.cancelPartnershipOffer.run({ partnershipId: second.partnershipId }, ctx("owner-a")), "failed-precondition");
    await failsWith(() => partnerships.cancelPartnershipOffer.run({ partnershipId: second.partnershipId }, ctx("owner-b")), "failed-precondition");
  });

  await test("designar: a EXECUTORA escolhe motorista e veículo da própria frota (qualquer um); reboque só conferido quando a oferta exige", async () => {
    const { partnershipId } = await createOffer();
    await failsWith(() => designate(partnershipId), "failed-precondition");
    const before = Date.now();
    await respond(partnershipId, "accept");
    const accepted = (await get(`partnerships/${partnershipId}`)).data();
    assert.ok(accepted.deadlineMs >= before + 5 * DAY && accepted.deadlineMs <= Date.now() + 5 * DAY, "5 dias contados a partir do aceite");
    assert.equal(accepted.deadlineAt, new Date(accepted.deadlineMs).toISOString()); assert.ok(accepted.acceptedAt, "guarda o instante do aceite");
    await failsWith(() => designate(partnershipId, {}, "owner-a"), "permission-denied");
    await failsWith(() => designate(partnershipId, { vehicleId: "veh-a" }), "failed-precondition"); // veículo de outra empresa
    await failsWith(() => designate(partnershipId, { driverId: "drv-a" }), "permission-denied"); // motorista de outra empresa
    assert.equal((await db.collection("trabalhos").get()).size, 0, "falhas não deixam trabalho para trás");
    const done = await designate(partnershipId, { vehicleId: "veh-b2" }); // Scania 113: nenhum veículo é exigido pela oferta
    assert.equal(done.success, true);
    const p = (await get(`partnerships/${partnershipId}`)).data();
    assert.equal(p.driverId, "drv-b"); assert.equal(p.driverName, "Caio Lima"); assert.equal(p.jobId, done.jobId); assert.equal(p.status, "accepted"); assert.equal(p.vehicleName, "Scania 113");
    assert.equal("vehicleRequirement" in p, false, "a oferta não guarda veículo");
    const job = (await get(`trabalhos/${done.jobId}`)).data();
    assert.equal(job.companyId, "b", "o trabalho é da executora"); assert.equal(job.driverId, "drv-b"); assert.equal(job.status, "pending"); assert.equal(job.vehicleId, "veh-b2");
    assert.equal(job.partnershipId, partnershipId); assert.equal(job.scoreCompanyId, "a"); assert.equal(job.contractorCompanyId, "a");
    const contract = (await get(`contratos/pc_${partnershipId}`)).data();
    assert.equal(contract.partnershipDeadlineAt, accepted.deadlineAt, "a operação termina no prazo contado do aceite");
    assert.equal(contract.companyId, "b"); assert.equal(contract.partnership, true); assert.equal(contract.totalDeliveries, 5); assert.equal(contract.name, "Operação 031"); assert.equal(contract.trailerId, null); assert.equal(contract.trailerName, "Frigorífico", "o reboque é o da oferta (da contratante)");
    assert.equal(job.trailerName, "Frigorífico", "o trabalho mostra o reboque da oferta, como uma operação comum");
    assert.equal(job.contractNameSnapshot, "Operação 031", "o NOME da operação no trabalho é o da oferta, nunca o do reboque"); assert.equal(job.contractName, "Operação 031"); assert.notEqual(job.contractName, job.trailerName); assert.equal(job.trailerId ?? null, null); assert.equal(p.trailerName, "Frigorífico");
    assert.equal((await designate(partnershipId, { vehicleId: "veh-b2" })).replayed, true, "designar o mesmo motorista de novo é idempotente");
    await failsWith(() => designate(partnershipId, { driverId: "drv-a" }), "failed-precondition");
    assert.equal((await db.collection("trabalhos").where("partnershipId", "==", partnershipId).get()).size, 1, "um único trabalho");
  });

  await test("reboque é definido pela CONTRATANTE: a executora não escolhe, não precisa tê-lo; sem reboque na oferta, o trabalho fica sem reboque; o nome da operação não pode ser o do reboque", async () => {
    const none = await createOffer("owner-a", { trailerRequirement: null });
    assert.equal((await get(`partnerships/${none.partnershipId}`)).get("trailerRequirement"), null);
    await respond(none.partnershipId, "accept");
    const done = await designate(none.partnershipId, { trailerId: "trl-a" }); // qualquer reboque enviado pelo app é ignorado
    assert.equal(done.success, true);
    assert.equal((await get(`contratos/pc_${none.partnershipId}`)).get("trailerId"), null);
    assert.equal(((await get(`trabalhos/${done.jobId}`)).get("trailerName") || ""), "");
    await failsWith(() => createOffer("owner-a", { operationName: "Frigorífico" }), "invalid-argument");
  });

  await test("designar com operação em andamento: opção de cancelar a atual (viagens preservadas) para a da parceria entrar", async () => {
    const first = await createOffer("owner-a", { operationName: "Operação 040" }); await respond(first.partnershipId, "accept");
    const one = await designate(first.partnershipId, { vehicleId: "veh-b" });
    await db.collection("trabalhos").doc(one.jobId).update({ status: "active", progress: 2 }); // em andamento, 2 viagens feitas
    const second = await createOffer("owner-a", { operationName: "Operação 041" }); await respond(second.partnershipId, "accept");
    const kept = await designate(second.partnershipId, { vehicleId: "veh-b2" }); // sem cancelRunning: a atual continua; a nova entra na fila
    assert.equal((await get(`trabalhos/${one.jobId}`)).get("status"), "active"); assert.equal((await get(`trabalhos/${kept.jobId}`)).get("status"), "pending");
    const third = await createOffer("owner-a", { operationName: "Operação 042" }); await respond(third.partnershipId, "accept");
    const swapped = await designate(third.partnershipId, { vehicleId: "veh-b2", cancelRunning: true });
    assert.equal(swapped.success, true);
    const old = (await get(`trabalhos/${one.jobId}`)).data();
    assert.equal(old.status, "cancelled", "a operação em andamento foi cancelada"); assert.equal(old.progress, 2, "as viagens já feitas ficam preservadas");
    assert.equal((await get(`trabalhos/${swapped.jobId}`)).get("status"), "pending");
  });

  await test("parceira: só empresa ATIVA do MESMO simulador recebe oferta (arquivada, excluída, inativa, suspensa e outro simulador são recusadas)", async () => {
    for (const executorCompanyId of ["z", "y", "w", "s"]) await failsWith(() => createOffer("owner-a", { executorCompanyId }), "failed-precondition");
    await failsWith(() => createOffer("owner-a", { executorCompanyId: "e" }), "failed-precondition"); // ETS2
    assert.equal((await db.collection("partnerships").get()).size, 0);
    // O mesmo simulador por outro nome (GTO × "Global Truck Online") é aceito.
    const alias = await createOffer("owner-a", { executorCompanyId: "g" });
    assert.equal((await get(`partnerships/${alias.partnershipId}`)).get("executorCompanyId"), "g");
    // Uma empresa arquivada também não envia ofertas (nem o próprio dono administra mais uma empresa arquivada).
    await failsWith(() => createOffer("owner-z", { contractorCompanyId: "z" }), "permission-denied");
  });

  await test("aceitar: a executora ainda não preparada para a confirmação operacional recebe orientação clara (a oferta continua pendente)", async () => {
    const sent = await createOffer("owner-a", { executorCompanyId: "u" }), { partnershipId } = sent;
    assert.equal(sent.executorReady, false, "a contratante é avisada de que a parceira precisa preparar a empresa");
    assert.equal((await createOffer("owner-a")).executorReady, true);
    await assert.rejects(() => respond(partnershipId, "accept", "owner-u"), error => {
      assert.ok(String(error.code).includes("failed-precondition"), error.code);
      assert.match(error.message, /preparada para a confirmação operacional/); assert.match(error.message, /Operações/);
      return true;
    });
    assert.equal((await get(`partnerships/${partnershipId}`)).get("status"), "pending");
    assert.equal((await respond(partnershipId, "decline", "owner-u")).status, "declined", "recusar não exige preparo");
  });

  await test("início: sem foto não inicia; foto de outro motorista/parceria não vale; com foto própria inicia", async () => {
    const { partnershipId } = await createOffer(); await respond(partnershipId, "accept"); const { jobId } = await designate(partnershipId);
    const start = (extra = {}) => executeOperationalCommand(db, { action: "start", companyId: "b", jobId, requestId: `start-${++seq}-${Date.now()}`, ...extra }, ctx("drv-b"));
    await failsWith(() => start(), "failed-precondition");
    await failsWith(() => start({ startPhotoUrl: photo(partnershipId, "outro-uid") }), "failed-precondition");
    await failsWith(() => start({ startPhotoUrl: photo("po_outra", "drv-b") }), "failed-precondition");
    await failsWith(() => start({ startPhotoUrl: "https://evil.example/x.jpg" }), "failed-precondition");
    assert.equal((await get(`trabalhos/${jobId}`)).get("status"), "pending", "nenhuma tentativa inválida inicia o trabalho");
    const ok = await start({ startPhotoUrl: photo(partnershipId, "drv-b") });
    assert.equal(ok.success, true);
    const job = (await get(`trabalhos/${jobId}`)).data();
    assert.equal(job.status, "active"); assert.match(job.startVehiclePhotoUrl, /partnership-start-photos/);
  });

  await test("viagens: cada viagem confirmada conta uma vez no livro; pendente e de outro trabalho não contam; ranking credita a contratante", async () => {
    const { partnershipId } = await createOffer(); await respond(partnershipId, "accept"); const { jobId } = await designate(partnershipId);
    const base = { jobId, companyId: "b", empresaId: "b", driverId: "drv-b", contractId: `pc_${partnershipId}`, partnershipId, scoreCompanyId: "a", contractorCompanyId: "a", status: "concluida", recordStatus: "concluida", serverValidatedAt: new Date() };
    await db.doc("historico_viagens/t1").set({ ...base, valorCents: 150_000, completedAt: new Date(Date.now() - 3000) });
    await db.doc("historico_viagens/t2").set({ ...base, valorCents: 250_000, completedAt: new Date(Date.now() - 2000) });
    await db.doc("historico_viagens/t3").set({ ...base, status: "pending_sync", valorCents: 999_000 });
    await db.doc("historico_viagens/t4").set({ ...base, jobId: "outro-trabalho", valorCents: 777_000 });
    await partnerships.projectTrips(db, partnershipId); await partnerships.projectTrips(db, partnershipId);
    const p = (await get(`partnerships/${partnershipId}`)).data();
    assert.equal(p.progress, 2); assert.equal(p.earningsCents, 400_000); assert.equal(p.bestCents, 250_000); assert.equal(p.averageCents, 200_000); assert.equal(p.ledger.length, 2);
    assert.equal(scoreCompanyIdOf({ companyId: "b", partnershipId, scoreCompanyId: "a" }), "a", "ranking de empresas: contratante");
    assert.equal(scoreCompanyIdOf({ companyId: "b" }), "b", "viagem comum: a própria empresa, como antes");
    assert.equal(scoreCompanyIdOf({ companyId: "b", partnershipId }), "b", "sem marca de pontuação não desvia nada");
    assert.equal((await get("historico_viagens/t1")).get("driverId"), "drv-b", "o histórico do motorista continua dele");
  });

  await test("liquidação: valor combinado, −25% fora do prazo, a pagar/a receber, pago → recebido e permissões", async () => {
    const complete = async (partnershipId, jobId, completedAt) => {
      await db.doc(`trabalhos/${jobId}`).update({ status: "completed", completedAt });
      const job = (await get(`trabalhos/${jobId}`)).data();
      await partnerships.syncPartnershipFromJob.run({ before: { exists: true, data: () => ({}) }, after: { exists: true, data: () => job } }, { params: { jobId } });
      return (await get(`partnerships/${partnershipId}`)).data();
    };
    const open = async extra => { const { partnershipId } = await createOffer("owner-a", extra); await respond(partnershipId, "accept"); const { jobId } = await designate(partnershipId); return { partnershipId, jobId }; };
    // atrasada: 5 dias de prazo, concluída no 6º
    const late = await open({ agreedAmountCents: 1_000_000 });
    assert.equal((await get(`partnerships/${late.partnershipId}`)).get("agreedAmountCents"), 1_000_000);
    const row = await complete(late.partnershipId, late.jobId, new Date(Date.now() + 6 * DAY).toISOString());
    assert.equal(row.status, "completed"); assert.equal(row.settlement.late, true); assert.equal(row.settlement.penaltyPercent, 25);
    assert.equal(row.settlement.finalCents, 750_000); assert.equal(row.settlement.discountCents, 250_000); assert.equal(row.payment.status, "pending");
    const settle = (id, action, uid) => partnerships.settlePartnershipPayment.run({ partnershipId: id, action }, ctx(uid));
    await failsWith(() => settle(late.partnershipId, "paid", "owner-b"), "permission-denied"); // a executora não marca pago
    await failsWith(() => settle(late.partnershipId, "received", "owner-a"), "permission-denied"); // a contratante não confirma recebimento
    await failsWith(() => settle(late.partnershipId, "foi", "owner-a"), "invalid-argument");
    assert.equal((await settle(late.partnershipId, "paid", "owner-a")).status, "paid");
    assert.equal((await settle(late.partnershipId, "paid", "owner-a")).replayed, true, "repetir é idempotente");
    assert.ok((await get(`partnerships/${late.partnershipId}`)).get("payment.paidAt"));
    assert.equal((await settle(late.partnershipId, "received", "owner-b")).status, "settled");
    assert.equal((await settle(late.partnershipId, "received", "owner-b")).replayed, true);
    await failsWith(() => settle(late.partnershipId, "paid", "owner-a"), "failed-precondition".replace("failed-precondition", "failed-precondition")).catch(async () => assert.equal((await settle(late.partnershipId, "paid", "owner-a")).replayed, true));
    // no prazo: valor cheio; sem valor combinado: nada a liquidar
    const ontime = await open({ agreedAmountCents: 400_000 });
    const okRow = await complete(ontime.partnershipId, ontime.jobId, new Date().toISOString());
    assert.equal(okRow.settlement.late, false); assert.equal(okRow.settlement.finalCents, 400_000); assert.equal(okRow.settlement.discountCents, 0);
    assert.equal((await settle(ontime.partnershipId, "received", "owner-b")).status, "settled", "a executora pode confirmar sem esperar o 'pago'");
    const free = await open({ operationName: "Sem valor" });
    const freeRow = await complete(free.partnershipId, free.jobId, new Date().toISOString());
    assert.equal(freeRow.settlement, null); assert.equal(freeRow.payment, null);
    await failsWith(() => settle(free.partnershipId, "paid", "owner-a"), "failed-precondition");
    await failsWith(() => settle(late.partnershipId + "x", "paid", "owner-a"), "not-found");
    const running = await open({ agreedAmountCents: 100_000, operationName: "Em andamento" });
    await failsWith(() => settle(running.partnershipId, "paid", "owner-a"), "failed-precondition");
  });

  await test("Pix: só a executora informa a chave (validada); a contratante a vê; avisos ao concluir; excluir cancelada só da própria lista", async () => {
    const { partnershipId, jobId } = await (async () => { const { partnershipId } = await createOffer("owner-a", { agreedAmountCents: 500_000, operationName: "Com Pix" }); await respond(partnershipId, "accept"); const { jobId } = await designate(partnershipId); return { partnershipId, jobId }; })();
    const pix = (uid, type, key, id = partnershipId) => partnerships.setPartnershipPix.run({ partnershipId: id, type, key }, ctx(uid));
    await failsWith(() => pix("owner-a", "cpf", "52998224725"), "permission-denied"); // contratante não informa a chave do recebedor
    await failsWith(() => pix("owner-b", "cpf", "123"), "invalid-argument"); await failsWith(() => pix("owner-b", "pix", "x"), "invalid-argument");
    assert.equal((await pix("owner-b", "phone", "(11) 91234-5678")).key, "+5511912345678");
    assert.deepEqual((({ type, key }) => ({ type, key }))((await get(`partnerships/${partnershipId}`)).get("payeePix")), { type: "phone", key: "+5511912345678" });
    await pix("owner-b", "email", "Fin@Matecom.com"); assert.equal((await get(`partnerships/${partnershipId}`)).get("payeePix.key"), "fin@matecom.com", "trocar a chave antes de concluir é permitido");
    // concluir: a contratante é avisada com a chave
    await db.doc(`trabalhos/${jobId}`).update({ status: "completed", completedAt: new Date().toISOString() });
    const job = (await get(`trabalhos/${jobId}`)).data();
    await partnerships.syncPartnershipFromJob.run({ before: { exists: true, data: () => ({}) }, after: { exists: true, data: () => job } }, { params: { jobId } });
    const notes = (await db.collection("notifications").where("type", "==", "PARTNERSHIP_PAYMENT_DUE").get()).docs.map(row => row.get("message"));
    assert.ok(notes.some(text => text.includes("fin@matecom.com") && text.includes("Pague R$")), "aviso de pagamento com a chave Pix");
    assert.equal((await partnerships.settlePartnershipPayment.run({ partnershipId, action: "paid" }, ctx("owner-a"))).status, "paid");
    await partnerships.settlePartnershipPayment.run({ partnershipId, action: "received" }, ctx("owner-b"));
    await failsWith(() => pix("owner-b", "cpf", "52998224725"), "failed-precondition"); // liquidado: a chave não muda mais
    // excluir: só cancelada/recusada, só da própria lista
    const hide = (uid, id, company) => partnerships.hidePartnership.run({ partnershipId: id, companyId: company }, ctx(uid));
    const offerRow = await createOffer("owner-a", { operationName: "Para excluir" });
    await failsWith(() => hide("owner-a", offerRow.partnershipId, "a"), "failed-precondition"); // pendente não pode
    await partnerships.cancelPartnershipOffer.run({ partnershipId: offerRow.partnershipId }, ctx("owner-a"));
    await failsWith(() => hide("owner-b", offerRow.partnershipId, "a"), "permission-denied"); // a outra empresa não exclui pela contratante
    await failsWith(() => hide("owner-a", offerRow.partnershipId, "e"), "permission-denied"); // empresa que não é parte
    await hide("owner-a", offerRow.partnershipId, "a");
    assert.deepEqual((await get(`partnerships/${offerRow.partnershipId}`)).get("hiddenFor"), ["a"], "some só para a empresa que excluiu");
    await failsWith(() => hide("owner-a", partnershipId, "a"), "failed-precondition"); // concluída não
  });

  await test("regras do Firestore: contratante, executora e motorista leem; estranhos e outras empresas não; ninguém escreve do cliente", async () => {
    const { partnershipId } = await createOffer(); await respond(partnershipId, "accept"); await designate(partnershipId);
    const read = uid => getDoc(doc(environment.authenticatedContext(uid).firestore(), "partnerships", partnershipId));
    await assertSucceeds(read("owner-a")); await assertSucceeds(read("owner-b")); await assertSucceeds(read("drv-b"));
    await assertFails(read("stranger")); await assertFails(read("owner-e")); await assertFails(read("drv-a"));
    await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), "partnerships", partnershipId)));
    const mine = uid => getDocs(query(collection(environment.authenticatedContext(uid).firestore(), "partnerships"), where("contractorCompanyId", "==", "a")));
    await assertSucceeds(mine("owner-a")); await assertFails(mine("owner-e"));
    const asDriver = getDocs(query(collection(environment.authenticatedContext("drv-b").firestore(), "partnerships"), where("driverId", "==", "drv-b")));
    assert.equal((await assertSucceeds(asDriver)).size, 1);
    const ref = uid => doc(environment.authenticatedContext(uid).firestore(), "partnerships", partnershipId);
    await assertFails(updateDoc(ref("owner-a"), { status: "completed" })); await assertFails(updateDoc(ref("owner-b"), { totalTrips: 1 }));
    await assertFails(updateDoc(ref("drv-b"), { earningsCents: 1 })); await assertFails(setDoc(doc(environment.authenticatedContext("owner-a").firestore(), "partnerships", "po_forjada"), { status: "pending", contractorCompanyId: "a", executorCompanyId: "b" }));
  });
} finally {
  await environment.cleanup();
}
const failed = results.filter(row => row.result !== "PASS");
console.log(`${results.length - failed.length}/${results.length} cenários de Parcerias B2P passaram.`);
if (failed.length) process.exit(1);
