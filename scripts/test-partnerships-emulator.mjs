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
const offerData = (extra = {}) => ({ contractorCompanyId: "a", executorCompanyId: "b", operationName: "Operação 031", totalTrips: 5, vehicleRequirement: "Volvo FH",
  trailerRequirement: "Frigorífico", deadlineAt: new Date(Date.now() + 4 * DAY).toISOString(), conditions: "Veículo limpo.", goalAmountCents: 4_000_000, requestId: `req-${++seq}-${Date.now()}`, ...extra });
const createOffer = (uid = "owner-a", extra = {}) => partnerships.createPartnershipOffer.run(offerData(extra), ctx(uid));
const respond = (id, decision, uid = "owner-b") => partnerships.respondPartnershipOffer.run({ partnershipId: id, decision }, ctx(uid));
const designate = (id, extra = {}, uid = "owner-b") => partnerships.designatePartnershipDriver.run({ partnershipId: id, driverId: "drv-b", vehicleId: "veh-b", trailerId: "trl-b", ...extra }, ctx(uid));
const photo = (partnershipId, uid) => `https://firebasestorage.googleapis.com/v0/b/${projectId}.appspot.com/o/${encodeURIComponent(`partnership-start-photos/${partnershipId}/${uid}/1_v.webp`)}?alt=media&token=t`;

const company = (id, owner, extra = {}) => [`frotas/${id}`, { ownerId: owner, userId: owner, companyName: extra.companyName || id, simulatorId: "GTO", status: "active", operationalCommandVersion: 1, ...extra }];
const seed = async () => {
  await environment.clearFirestore();
  const rows = [
    company("a", "owner-a", { companyName: "DC Transportes" }), company("b", "owner-b", { companyName: "CTS" }), company("e", "owner-e", { companyName: "Euro", simulatorId: "ETS2" }),
    ["users/owner-a", { name: "Dono A", companyId: "a", role: "admin", status: "active" }], ["users/owner-b", { name: "Dono B", companyId: "b", role: "admin", status: "active" }],
    ["users/owner-e", { name: "Dono E", companyId: "e", role: "admin", status: "active" }],
    ["users/drv-b", { name: "Caio Lima", email: "caio@example.com", role: "driver", roles: ["driver"], companyId: "b", status: "active", memberships: { b: { role: "driver", roles: ["driver"], status: "active" } } }],
    ["companyMembers/drv-b_b", { userId: "drv-b", companyId: "b", roles: ["driver"], status: "active" }], ["simulator_members/drv-b_b", { userId: "drv-b", companyId: "b", roles: ["driver"], status: "active" }],
    ["users/drv-a", { name: "Motorista A", role: "driver", roles: ["driver"], companyId: "a", status: "active" }], ["companyMembers/drv-a_a", { userId: "drv-a", companyId: "a", roles: ["driver"], status: "active" }],
    ["users/stranger", { name: "Estranho", role: "driver", status: "active" }],
    ["veiculos/veh-b", { companyId: "b", name: "Volvo FH 540", plate: "CTS-12", status: "available" }], ["veiculos/veh-b2", { companyId: "b", name: "Scania 113", status: "available" }],
    ["veiculos/veh-a", { companyId: "a", name: "Volvo FH", status: "available" }],
    ["reboques/trl-b", { companyId: "b", name: "Frigorífico", status: "available" }],
  ];
  const batch = db.batch(); rows.forEach(([ref, data]) => batch.set(db.doc(ref), data)); await batch.commit();
  for (const [uid, companyId] of [["owner-a", "a"], ["owner-b", "b"], ["owner-e", "e"], ["drv-b", "b"], ["drv-a", "a"]]) await refreshCompanyAccess(db, uid, companyId);
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
    const again = await partnerships.createPartnershipOffer.run(data, ctx("owner-a"));
    assert.equal(again.partnershipId, first.partnershipId); assert.equal(again.replayed, true);
    assert.equal((await db.collection("partnerships").get()).size, 1);
    await failsWith(() => partnerships.createPartnershipOffer.run({ ...data, operationName: "Outro nome" }, ctx("owner-a")), "failed-precondition");
    assert.ok((await db.collection("notifications").where("companyId", "==", "b").get()).size >= 1, "a executora é avisada");
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

  await test("designar: motorista, veículo e reboque da executora, conforme a exigência; trabalho comum da executora com marcas de parceria", async () => {
    const { partnershipId } = await createOffer();
    await failsWith(() => designate(partnershipId), "failed-precondition");
    await respond(partnershipId, "accept");
    await failsWith(() => designate(partnershipId, {}, "owner-a"), "permission-denied");
    await failsWith(() => designate(partnershipId, { vehicleId: "veh-b2" }), "failed-precondition");
    await failsWith(() => designate(partnershipId, { vehicleId: "veh-a" }), "failed-precondition");
    await failsWith(() => designate(partnershipId, { trailerId: null }), "failed-precondition");
    await failsWith(() => designate(partnershipId, { driverId: "drv-a" }), "permission-denied"); // motorista de outra empresa
    assert.equal((await db.collection("trabalhos").get()).size, 0, "falhas não deixam trabalho para trás");
    const done = await designate(partnershipId);
    assert.equal(done.success, true);
    const p = (await get(`partnerships/${partnershipId}`)).data();
    assert.equal(p.driverId, "drv-b"); assert.equal(p.driverName, "Caio Lima"); assert.equal(p.jobId, done.jobId); assert.equal(p.status, "accepted");
    const job = (await get(`trabalhos/${done.jobId}`)).data();
    assert.equal(job.companyId, "b", "o trabalho é da executora"); assert.equal(job.driverId, "drv-b"); assert.equal(job.status, "pending");
    assert.equal(job.partnershipId, partnershipId); assert.equal(job.scoreCompanyId, "a"); assert.equal(job.contractorCompanyId, "a");
    const contract = (await get(`contratos/pc_${partnershipId}`)).data();
    assert.equal(contract.companyId, "b"); assert.equal(contract.partnership, true); assert.equal(contract.totalDeliveries, 5); assert.equal(contract.name, "Operação 031");
    assert.equal((await designate(partnershipId)).replayed, true, "designar o mesmo motorista de novo é idempotente");
    await failsWith(() => designate(partnershipId, { driverId: "drv-a" }), "failed-precondition");
    assert.equal((await db.collection("trabalhos").where("partnershipId", "==", partnershipId).get()).size, 1, "um único trabalho");
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
