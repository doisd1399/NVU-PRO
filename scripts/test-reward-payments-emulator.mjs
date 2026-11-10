import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";

// Recompensas (fase 2: folha, Pix, comprovante, confirmação e contestação) de ponta a ponta no emulador: callables reais, gatilho real e regras reais do Firestore.
const projectId = "demo-nvu-v36-4-staging";
assert.equal(process.env.GCLOUD_PROJECT, projectId, "Only the disposable demo project is allowed");
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^127\.0\.0\.1:\d+$/);
const require = createRequire(new URL("../functions/package.json", import.meta.url));
const admin = require(process.cwd() + "/functions/lib/firebaseAdmin.js");
if (!admin.apps.length) admin.initializeApp({ projectId });
const rewards = require("./lib/rewards.js");
const pay = require("./lib/rewardPayments.js");
const { refreshCompanyAccess } = require("./lib/companyAccess.js");
const environment = await initializeTestEnvironment({ projectId, firestore: { rules: fs.readFileSync("firestore.rules", "utf8") } });
const db = admin.firestore();
const ctx = uid => ({ auth: { uid, token: {} } });
const get = path => db.doc(path).get();
const failsWith = async (fn, code) => assert.rejects(fn, error => { assert.ok(String(error.code).includes(code), `expected ${code}, got ${error.code}: ${error.message}`); return true; });
const day = offset => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offset * 86_400_000));
let seq = 0;
const campaignData = (extra = {}) => ({ companyId: "a", contractId: "ct-1", name: "Semana de Ouro", startDate: day(-1), endDate: day(5), perTripCents: 2500, bonusCents: 20000, bonusGoalTrips: 3, budgetCents: 600000, audience: "all", driverIds: [], requestId: `req-${++seq}-${Date.now()}`, ...extra });
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
    ["contratos/ct-1", { companyId: "a", name: "Cargas SP", status: "active", totalDeliveries: 10, simulator: "GTO" }], ["contratos/ct-2", { companyId: "a", name: "Curta", status: "active", totalDeliveries: 2 }], ["contratos/ct-0", { companyId: "a", name: "Vazia", status: "active", totalDeliveries: 0 }], ["contratos/ct-b", { companyId: "b", name: "Cargas B", status: "active" }], ["contratos/ct-x", { companyId: "a", name: "Apagada", status: "active", deleted: true }],
    member("drv-1", "a"), member("drv-2", "a"), member("drv-b", "b"),
  ];
  const batch = db.batch(); rows.forEach(([ref, data]) => batch.set(db.doc(ref), data)); await batch.commit();
  for (const [uid, companyId] of [["owner-a", "a"], ["owner-b", "b"], ["drv-1", "a"], ["drv-2", "a"], ["drv-b", "b"]]) await refreshCompanyAccess(db, uid, companyId).catch(() => undefined);
};
const trip = async (id, driverId, companyId, offsetMs, extra = {}) => db.doc(`historico_viagens/${id}`).set({ driverId, companyId, status: "completed", contractId: "ct-2", serverValidatedAt: admin.firestore.Timestamp.now(), completedAt: admin.firestore.Timestamp.fromMillis(Date.now() + offsetMs), valorCents: 999999, ...extra });
const fire = async tripId => { const after = (await get(`historico_viagens/${tripId}`)).data(); return rewards.syncRewardTrips.run({ before: { exists: false, data: () => undefined }, after: { exists: true, data: () => after } }, { params: { tripId } }); };
const results = [];
async function test(name, fn) {
  const started = performance.now();
  try { await seed(); await fn(); results.push({ name, result: "PASS" }); console.log(`PASS ${name} (${((performance.now() - started) / 1000).toFixed(1)}s)`); }
  catch (error) { results.push({ name, result: "FAIL", error: error.stack }); console.error(`FAIL ${name}`, error); }
}
let tripSeq = 0;
/** Campanha aceita por drv-1 (n viagens) e, se pedido, por drv-2 (m viagens). */
const earn = async (drv1Trips, drv2Trips = 0, extra = {}) => {
  const { campaignId } = await create({ contractId: "ct-2", startDate: undefined, endDate: undefined, bonusCents: 0, bonusGoalTrips: 0, ...extra }); // operação de 2 viagens: 2 viagens = concluiu
  for (const [driver, count] of [["drv-1", drv1Trips], ["drv-2", drv2Trips]]) {
    if (!count) continue;
    await respond(`${campaignId}_${driver}`, "accept", driver);
    for (let i = 0; i < count; i++) { const id = `p${++tripSeq}`; await trip(id, driver, "a", 1000 + tripSeq); await fire(id); }
  }
  return campaignId;
};
const payroll = (uid = "owner-a", companyId = "a") => pay.generateRewardPayroll.run({ companyId, requestId: `pr-${++seq}-${Date.now()}` }, ctx(uid));
const payments = async () => (await db.collection("rewardPayments").get()).docs.map(row => ({ id: row.id, ...row.data() })).sort((a, b) => a.driverId.localeCompare(b.driverId));
const act = (name, paymentId, uid, extra = {}) => pay[name].run({ paymentId, ...extra }, ctx(uid));
try {
  await test("dia de pagamento e chave Pix: só o gestor define o dia; o motorista valida e salva a própria chave", async () => {
    await failsWith(() => pay.setRewardPayDay.run({ companyId: "a", payDay: 5 }, ctx("drv-1")), "permission-denied"); await failsWith(() => pay.setRewardPayDay.run({ companyId: "a", payDay: 5 }, ctx("owner-b")), "permission-denied");
    await failsWith(() => pay.setRewardPayDay.run({ companyId: "a", payDay: 9 }, ctx("owner-a")), "invalid-argument"); await failsWith(() => pay.setRewardPayDay.run({ companyId: "a", payDay: "x" }, ctx("owner-a")), "invalid-argument");
    const first = await create({ contractId: "ct-2" }); assert.equal((await get(`rewardOffers/${first.campaignId}_drv-1`)).get("payDay"), null, "sem dia combinado ainda");
    const set = await pay.setRewardPayDay.run({ companyId: "a", payDay: 5 }, ctx("owner-a")); assert.equal((await get("rewardSettings/a")).get("payDay"), 5); assert.equal(set.offers, 2);
    assert.equal((await get(`rewardOffers/${first.campaignId}_drv-1`)).get("payDay"), 5, "o motorista vê o dia de pagamento na própria oferta");
    const second = await create({ contractId: "ct-2" }); assert.equal((await get(`rewardOffers/${second.campaignId}_drv-2`)).get("payDay"), 5, "ofertas novas já nascem com o dia"); await pay.setRewardPayDay.run({ companyId: "a", payDay: 2 }, ctx("owner-a")); assert.equal((await get(`rewardOffers/${second.campaignId}_drv-2`)).get("payDay"), 2, "mudou o dia: ofertas abertas acompanham");
    await failsWith(() => pay.setRewardPix.run({ type: "cpf", key: "123" }, ctx("drv-1")), "invalid-argument"); await failsWith(() => pay.setRewardPix.run({ type: "cpf", key: "52998224725" }, {}), "unauthenticated");
    const saved = await pay.setRewardPix.run({ type: "phone", key: "(11) 91234-5678" }, ctx("drv-1")); assert.equal(saved.key, "+5511912345678");
    assert.deepEqual([(await get("rewardPayees/drv-1")).get("pixType"), (await get("rewardPayees/drv-1")).get("pixKey")], ["phone", "+5511912345678"]);
  });
  await test("folha: só o gestor; paga só quem concluiu a operação (os demais ficam para a folha seguinte); usa a chave Pix, avisa e não repete valores nem pagamentos", async () => {
    await pay.setRewardPix.run({ type: "cpf", key: "529.982.247-25" }, ctx("drv-1"));
    const campaignId = await earn(2, 1); // drv-1 concluiu (2 de 2 viagens = R$ 50); drv-2 fez 1 de 2 (R$ 25, em andamento)
    await failsWith(() => payroll("drv-1"), "permission-denied"); await failsWith(() => payroll("owner-b"), "permission-denied"); await failsWith(() => pay.generateRewardPayroll.run({ companyId: "a" }, ctx("owner-a")), "invalid-argument");
    const request = { companyId: "a", requestId: "fixo-1" }, first = await pay.generateRewardPayroll.run(request, ctx("owner-a"));
    assert.deepEqual([first.payments, first.totalCents, first.replayed], [1, 5000, false], "só quem concluiu entra na folha");
    const rows = await payments(); assert.deepEqual(rows.map(row => [row.driverId, row.amountCents, row.status, row.pixKey]), [["drv-1", 5000, "pending", "52998224725"]]);
    assert.deepEqual(rows[0].items.map(item => [item.campaignName, item.cents]), [["Semana de Ouro", 5000]]);
    assert.equal((await pay.generateRewardPayroll.run(request, ctx("owner-a"))).replayed, true); assert.equal((await payments()).length, 1, "repetir o pedido não duplica");
    const again = await payroll(); assert.deepEqual([again.payments, again.totalCents], [0, 0], "o que já está em folha não entra de novo; quem não concluiu continua de fora");
    assert.equal((await db.collection("notifications").where("type", "==", "REWARD_PAYROLL").get()).size, 1);
    // drv-2 conclui depois (2ª viagem): entra só na folha seguinte, com o valor todo
    const id = `p${++tripSeq}`; await trip(id, "drv-2", "a", 9000); await fire(id);
    const next = await payroll(); assert.deepEqual([next.payments, next.totalCents], [1, 5000]);
    assert.deepEqual((await payments()).map(row => [row.driverId, row.amountCents]), [["drv-1", 5000], ["drv-2", 5000]]);
    assert.equal((await get(`rewardCampaigns/${campaignId}`)).get("openEnded"), true, "campanha sem datas: vale o prazo da operação");
  });
  await test("prazo perdido: quem não concluiu no prazo não entra na folha, mesmo concluindo depois", async () => {
    await db.doc("contratos/ct-2").update({ deadlineDays: 3 });
    const campaignId = await earn(1, 0); // drv-1 fez 1 de 2 viagens
    const limit = Date.now() + 1500; await db.doc(`rewardOffers/${campaignId}_drv-1`).update({ deadlineMs: limit, openDeadlineMs: limit }); await new Promise(resolve => setTimeout(resolve, 1700));
    await rewards.rewardDeadlineTick.run({}); assert.equal((await get(`rewardOffers/${campaignId}_drv-1`)).get("expired"), true);
    const id = `p${++tripSeq}`; await trip(id, "drv-1", "a", 8000); await fire(id); // 2ª viagem, mas fora do prazo
    const result = await payroll(); assert.deepEqual([result.payments, result.totalCents], [0, 0], "perdeu o pagamento: só recebe quem concluiu a operação no prazo");
  });
  await test("pagar: só a gestão da empresa; gera comprovante com número e chave escondida; repetir não gera outro; recebido é final", async () => {
    await pay.setRewardPix.run({ type: "cpf", key: "52998224725" }, ctx("drv-1")); await earn(2); await payroll();
    const [row] = await payments(); assert.equal(row.amountCents, 5000);
    await failsWith(() => act("markRewardPaid", row.id, "drv-1"), "permission-denied"); await failsWith(() => act("markRewardPaid", row.id, "owner-b"), "permission-denied"); await failsWith(() => act("markRewardPaid", "nao-existe", "owner-a"), "not-found");
    await failsWith(() => act("markRewardPaid", row.id, "owner-a", { e2eId: "curto" }), "invalid-argument");
    await failsWith(() => act("confirmRewardReceived", row.id, "drv-1"), "failed-precondition"); // ainda não foi pago
    const paid = await act("markRewardPaid", row.id, "owner-a", { e2eId: "E1234567890ABCDEF" }); assert.equal(paid.status, "paid");
    const after = (await get(`rewardPayments/${row.id}`)).data();
    assert.equal(after.status, "paid"); assert.match(after.receipt.number, /^RC-\d{8}-[0-9A-F]{8}$/); assert.equal(after.receipt.amountCents, 5000); assert.equal(after.receipt.pixKeyMasked, "***.982.247-**"); assert.equal(after.receipt.e2eId, "E1234567890ABCDEF");
    assert.equal(after.receipt.payerName, "DC Transportes"); assert.equal(after.receipt.payeeName, "Naylson Silva"); assert.ok(!JSON.stringify(after.receipt).includes("52998224725"), "o comprovante não traz a chave inteira");
    assert.equal((await act("markRewardPaid", row.id, "owner-a")).replayed, true); assert.equal((await get(`rewardPayments/${row.id}`)).get("receipt.number"), after.receipt.number);
    assert.equal((await db.collection("notifications").where("type", "==", "REWARD_PAID").get()).size, 1);
    await failsWith(() => act("confirmRewardReceived", row.id, "drv-2"), "permission-denied"); await failsWith(() => act("confirmRewardReceived", row.id, "owner-a"), "permission-denied");
    assert.equal((await act("confirmRewardReceived", row.id, "drv-1")).status, "received"); assert.equal((await act("confirmRewardReceived", row.id, "drv-1")).replayed, true);
    assert.ok((await get(`rewardPayments/${row.id}`)).get("receivedAtMs") > 0); assert.equal((await db.collection("notifications").where("type", "==", "REWARD_RECEIVED").get()).size, 1);
    await failsWith(() => act("contestRewardPayment", row.id, "drv-1", { reason: "não caiu" }), "failed-precondition"); await failsWith(() => act("cancelRewardPayment", row.id, "owner-a"), "failed-precondition"); await failsWith(() => act("markRewardPaid", row.id, "owner-a"), "failed-precondition");
  });
  await test("contestar: só depois de pago, com motivo; a empresa paga de novo (novo comprovante) e o motorista confirma", async () => {
    await earn(2); await payroll(); const [row] = await payments();
    await failsWith(() => act("contestRewardPayment", row.id, "drv-1", { reason: "não caiu" }), "failed-precondition"); await act("markRewardPaid", row.id, "owner-a");
    await failsWith(() => act("contestRewardPayment", row.id, "drv-1", { reason: "x" }), "invalid-argument"); await failsWith(() => act("contestRewardPayment", row.id, "drv-2", { reason: "não caiu na conta" }), "permission-denied");
    const first = (await get(`rewardPayments/${row.id}`)).get("receipt.number");
    await act("contestRewardPayment", row.id, "drv-1", { reason: "O Pix não caiu na minha conta" });
    let now = (await get(`rewardPayments/${row.id}`)).data(); assert.deepEqual([now.status, now.contestReason], ["contested", "O Pix não caiu na minha conta"]);
    assert.equal((await db.collection("notifications").where("type", "==", "REWARD_CONTESTED").get()).size, 1);
    await failsWith(() => act("confirmRewardReceived", row.id, "drv-1"), "failed-precondition");
    await new Promise(resolve => setTimeout(resolve, 15)); await act("markRewardPaid", row.id, "owner-a"); now = (await get(`rewardPayments/${row.id}`)).data();
    assert.deepEqual([now.status, now.payAttempts, now.contestReason], ["paid", 2, undefined]); assert.notEqual(now.receipt.number, first, "novo pagamento, novo comprovante");
    assert.equal((await act("confirmRewardReceived", row.id, "drv-1")).status, "received");
  });
  await test("cancelar: só a gestão; devolve o valor ao saldo da próxima folha; chave nova vale para pagamento pendente", async () => {
    await earn(2); await payroll(); const [row] = await payments();
    await failsWith(() => act("cancelRewardPayment", row.id, "drv-1"), "permission-denied"); await failsWith(() => act("cancelRewardPayment", row.id, "owner-b"), "permission-denied");
    await pay.setRewardPix.run({ type: "email", key: "Naylson@Mail.com" }, ctx("drv-1")); assert.equal((await get(`rewardPayments/${row.id}`)).get("pixKey"), "naylson@mail.com", "a chave nova vale para o pagamento pendente");
    await act("cancelRewardPayment", row.id, "owner-a"); assert.equal((await act("cancelRewardPayment", row.id, "owner-a")).replayed, true);
    assert.equal((await get(`rewardPayments/${row.id}`)).get("status"), "cancelled"); const offer = (await db.collection("rewardOffers").where("driverId", "==", "drv-1").get()).docs[0];
    assert.equal(offer.get("settledCents"), 0); await failsWith(() => act("markRewardPaid", row.id, "owner-a"), "failed-precondition");
    const again = await payroll(); assert.deepEqual([again.payments, again.totalCents], [1, 5000], "o valor cancelado volta para a próxima folha");
    assert.equal((await db.collection("notifications").where("type", "==", "REWARD_CANCELLED").get()).size, 1);
  });
  await test("fechamento automático: no dia de pagamento (8h) monta a folha e avisa a gestão; outro dia não; repetir não duplica", async () => {
    await earn(2, 1); // só drv-1 concluiu
    const weekday = new Date(Date.now() - 3 * 3_600_000).getUTCDay(), other = (weekday + 1) % 7;
    await db.doc("rewardSettings/a").set({ companyId: "a", payDay: other }); await pay.rewardPayDayTick.run({}); assert.equal((await payments()).length, 0, "não é o dia de pagamento");
    await db.doc("rewardSettings/a").set({ companyId: "a", payDay: weekday }); await pay.rewardPayDayTick.run({});
    const rows = await payments(); assert.deepEqual(rows.map(row => [row.driverId, row.amountCents, row.source]), [["drv-1", 5000, "auto"]], "só quem concluiu");
    await pay.rewardPayDayTick.run({}); assert.equal((await payments()).length, 1, "rodar de novo no mesmo dia não duplica");
    const ready = await db.collection("notifications").where("type", "==", "REWARD_PAYROLL_READY").get(); assert.ok(ready.size >= 1); assert.match(ready.docs[0].get("message"), /R\$ 50,00 para 1 motorista/);
  });
  await test("regras do Firestore: gestão lê pagamentos da empresa; motorista só os próprios e a própria chave; ninguém escreve do cliente", async () => {
    await pay.setRewardPix.run({ type: "cpf", key: "52998224725" }, ctx("drv-1")); await earn(2, 2); await payroll(); const [mine, other] = await payments();
    const read = (uid, path) => getDoc(doc(environment.authenticatedContext(uid).firestore(), ...path.split("/")));
    await assertSucceeds(read("owner-a", `rewardPayments/${mine.id}`)); await assertSucceeds(read("drv-1", `rewardPayments/${mine.id}`)); await assertFails(read("drv-2", `rewardPayments/${mine.id}`)); await assertFails(read("owner-b", `rewardPayments/${mine.id}`)); await assertSucceeds(read("drv-2", `rewardPayments/${other.id}`));
    const list = (uid, field, value) => getDocs(query(collection(environment.authenticatedContext(uid).firestore(), "rewardPayments"), where(field, "==", value)));
    assert.equal((await assertSucceeds(list("drv-1", "driverId", "drv-1"))).size, 1); assert.equal((await assertSucceeds(list("owner-a", "companyId", "a"))).size, 2); await assertFails(list("drv-1", "companyId", "a")); await assertFails(list("owner-b", "companyId", "a")); await assertFails(list("drv-2", "driverId", "drv-1"));
    await assertSucceeds(read("drv-1", "rewardPayees/drv-1")); await assertFails(read("drv-2", "rewardPayees/drv-1")); await assertFails(read("owner-a", "rewardPayees/drv-1"));
    await pay.setRewardPayDay.run({ companyId: "a", payDay: 3 }, ctx("owner-a")); await assertSucceeds(read("owner-a", "rewardSettings/a")); await assertFails(read("drv-1", "rewardSettings/a")); await assertFails(read("owner-b", "rewardSettings/a"));
    const ref = (uid, path) => doc(environment.authenticatedContext(uid).firestore(), ...path.split("/"));
    await assertFails(updateDoc(ref("drv-1", `rewardPayments/${mine.id}`), { status: "received" })); await assertFails(updateDoc(ref("owner-a", `rewardPayments/${mine.id}`), { status: "paid" })); await assertFails(setDoc(ref("drv-1", "rewardPayees/drv-1"), { pixKey: "x" })); await assertFails(setDoc(ref("owner-a", "rewardSettings/a"), { payDay: 1 }));
  });
} finally { await environment.cleanup(); }
const failed = results.filter(row => row.result !== "PASS");
console.log(`${results.length - failed.length}/${results.length} cenários de pagamento de Recompensas passaram.`);
if (failed.length) process.exit(1);
