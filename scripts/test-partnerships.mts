/**
 * v44 — Parcerias B2P: regras puras (servidor e cliente) e consistência entre os dois lados.
 * O fluxo completo com banco (oferta → aceite → designação → foto → viagem → ranking) roda no emulador:
 * scripts/test-partnerships-emulator.mjs.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildLedger, matchesRequirement as serverMatches, mayTransition, normalizeOffer, partnershipContractId, partnershipTripFields,
  statusFromJob, verifyStartPhotoUrl,
} from "../functions/src/partnershipPolicy.ts";
import {
  emptyDraft, formatMoney, initialsOf, isPartnershipContract, matchesRequirement, normalizePartnership, paceOf, parseMoneyToCents, pipsFor,
  remainingText, resultsOf, roleIn, sectionFor, statusText, validateDraft,
} from "../src/lib/partnerships.ts";

let checks = 0;
const test = (name: string, run: () => void) => { run(); checks++; console.log("PASS", name); };
const NOW = Date.parse("2026-11-09T12:00:00Z"), DAY = 86_400_000;
const offer = (extra: Record<string, unknown> = {}) => ({ contractorCompanyId: "dc", executorCompanyId: "cts", operationName: "Operação 031", totalTrips: 20, vehicleRequirement: "Volvo FH",
  trailerRequirement: "Frigorífico", deadlineAt: new Date(NOW + 4 * DAY).toISOString(), conditions: "Veículo limpo.", goalAmountCents: 4_000_000, requestId: "r1", ...extra });
const rejects = (fn: () => unknown, pattern: RegExp) => assert.throws(fn, error => pattern.test(String((error as Error).message)));

// ───────────── servidor: validação da oferta ─────────────
test("Oferta válida é normalizada (texto limpo, prazo em ISO, meta em centavos)", () => {
  const result = normalizeOffer(offer({ operationName: "  Operação   031 " }), NOW, false);
  assert.equal(result.operationName, "Operação 031");
  assert.equal(result.goalAmountCents, 4_000_000);
  assert.equal(result.trailerRequirement, "Frigorífico");
});
test("Simulador sem reboque nunca guarda exigência de reboque", () => assert.equal(normalizeOffer(offer(), NOW, true).trailerRequirement, null));
test("Empresa não pode propor para si mesma", () => rejects(() => normalizeOffer(offer({ executorCompanyId: "dc" }), NOW, false), /outra empresa/));
test("Nome curto, viagens fora de 1–500, veículo vazio e prazo inválido são recusados", () => {
  rejects(() => normalizeOffer(offer({ operationName: "ab" }), NOW, false), /nome da operação/);
  for (const totalTrips of [0, 501, 1.5, "x"]) rejects(() => normalizeOffer(offer({ totalTrips }), NOW, false), /entre 1 e 500/);
  rejects(() => normalizeOffer(offer({ vehicleRequirement: "" }), NOW, false), /veículo exigido/);
  rejects(() => normalizeOffer(offer({ deadlineAt: "amanhã" }), NOW, false), /prazo final/);
  rejects(() => normalizeOffer(offer({ deadlineAt: new Date(NOW - DAY).toISOString() }), NOW, false), /futuro/);
  rejects(() => normalizeOffer(offer({ deadlineAt: new Date(NOW + 121 * DAY).toISOString() }), NOW, false), /120 dias/);
});
test("Condições aceitam até 300 caracteres e a meta é opcional e positiva", () => {
  assert.equal(normalizeOffer(offer({ conditions: "a".repeat(300) }), NOW, false).conditions.length, 300);
  rejects(() => normalizeOffer(offer({ conditions: "a".repeat(301) }), NOW, false), /300 caracteres/);
  assert.equal(normalizeOffer(offer({ goalAmountCents: null }), NOW, false).goalAmountCents, null);
  assert.equal(normalizeOffer(offer({ goalAmountCents: "" }), NOW, false).goalAmountCents, null);
  rejects(() => normalizeOffer(offer({ goalAmountCents: -5 }), NOW, false), /meta/);
  rejects(() => normalizeOffer(offer({ goalAmountCents: 10.5 }), NOW, false), /meta/);
});
test("Identificadores com barra ou vazios são recusados (sem caminho de documento forjado)", () => {
  rejects(() => normalizeOffer(offer({ executorCompanyId: "a/b" }), NOW, false), /inválid/);
  rejects(() => normalizeOffer(offer({ requestId: "" }), NOW, false), /inválid/);
});

// ───────────── servidor: exigência de veículo/reboque, estados e foto ─────────────
test("Exigência de veículo ignora acento/caixa e aceita o nome contido; recusa outro modelo", () => {
  assert.equal(serverMatches("volvo fh", "Volvo FH 540"), true);
  assert.equal(serverMatches("Frigorífico", "frigorifico"), true);
  assert.equal(serverMatches("Volvo FH", "Scania 113"), false);
  assert.equal(serverMatches("", "qualquer"), true);
});
test("Cliente e servidor aplicam a MESMA regra de exigência", () => {
  for (const [req, name] of [["Volvo FH", "Volvo FH 540"], ["Frigorífico", "frigorifico"], ["Volvo FH", "Scania 113"], ["Graneleiro", "Graneleiro 4 eixos"], ["", "x"], ["Tanque", "Ta"]] as const)
    assert.equal(matchesRequirement(req, name), serverMatches(req, name), `${req} × ${name}`);
});
test("O estado da parceria segue o trabalho e nunca volta atrás", () => {
  assert.equal(statusFromJob("pending"), "accepted");
  for (const status of ["active", "delayed", "awaiting_completion"]) assert.equal(statusFromJob(status), "active");
  assert.equal(statusFromJob("completed"), "completed"); assert.equal(statusFromJob("cancelled"), "cancelled"); assert.equal(statusFromJob("weird"), null);
  assert.equal(mayTransition("active", "accepted"), false);
  assert.equal(mayTransition("accepted", "active"), true);
  for (const closed of ["completed", "declined", "cancelled"] as const) assert.equal(mayTransition(closed, "active"), false, closed);
  assert.equal(mayTransition("pending", "declined"), true);
});
test("Foto de início: só a URL do próprio motorista, desta parceria, em HTTPS do Storage", () => {
  const url = (path: string, host = "firebasestorage.googleapis.com") => `https://${host}/v0/b/app.appspot.com/o/${encodeURIComponent(path)}?alt=media&token=t`;
  assert.notEqual(verifyStartPhotoUrl(url("partnership-start-photos/po_1/u1/1_a.webp"), "po_1", "u1"), "");
  assert.equal(verifyStartPhotoUrl(url("partnership-start-photos/po_1/u2/1_a.webp"), "po_1", "u1"), "", "foto de outro motorista");
  assert.equal(verifyStartPhotoUrl(url("partnership-start-photos/po_2/u1/1_a.webp"), "po_1", "u1"), "", "foto de outra parceria");
  assert.equal(verifyStartPhotoUrl(url("profile-photos/u1/a.webp"), "po_1", "u1"), "", "outro caminho do Storage");
  assert.equal(verifyStartPhotoUrl(url("partnership-start-photos/po_1/u1/../u2/a.webp"), "po_1", "u1"), "", "travessia de pasta");
  assert.equal(verifyStartPhotoUrl("http://firebasestorage.googleapis.com/v0/b/x/o/partnership-start-photos%2Fpo_1%2Fu1%2Fa", "po_1", "u1"), "", "sem HTTPS");
  assert.equal(verifyStartPhotoUrl("https://evil.example/partnership-start-photos/po_1/u1/a.webp", "po_1", "u1"), "", "host estranho");
  assert.equal(verifyStartPhotoUrl("", "po_1", "u1"), ""); assert.equal(verifyStartPhotoUrl(undefined, "po_1", "u1"), "");
});

// ───────────── servidor: livro de viagens (cada viagem conta uma vez) ─────────────
const scope = { operationId: "job1", driverId: "drv", companyId: "cts", contractId: partnershipContractId("po_1") };
const trip = (id: string, cents: number, at: number, extra: Record<string, unknown> = {}) => ({ id, data: { jobId: "job1", serverValidatedAt: 1, operationId: "job1", driverId: "drv", companyId: "cts", contractId: scope.contractId,
  status: "concluida", valorCents: cents, completedAt: at, partnershipId: "po_1", ...extra } });
test("Livro: viagens confirmadas contam uma vez, em ordem, com média e melhor viagem", () => {
  const ledger = buildLedger([trip("t2", 200_000, 2000), trip("t1", 100_000, 1000), trip("t1", 100_000, 1000), trip("t3", 300_000, 3000)], scope);
  assert.equal(ledger.progress, 3); assert.equal(ledger.earningsCents, 600_000); assert.equal(ledger.bestCents, 300_000); assert.equal(ledger.averageCents, 200_000);
  assert.deepEqual(ledger.entries.map(entry => [entry.n, entry.tripId]), [[1, "t1"], [2, "t2"], [3, "t3"]]);
});
test("Livro: viagem pendente, de outra operação ou de outro motorista não entra", () => {
  const ledger = buildLedger([trip("ok", 100_000, 1000), trip("pend", 50_000, 2000, { status: "pending_sync" }), trip("other", 70_000, 3000, { jobId: "job2" }), trip("drv2", 70_000, 4000, { driverId: "x" })], scope);
  assert.equal(ledger.progress, 1); assert.equal(ledger.earningsCents, 100_000);
});
test("Marcadores de pontuação só existem quando o trabalho é de parceria", () => {
  assert.deepEqual(partnershipTripFields({ partnershipId: "po_1", scoreCompanyId: "dc", contractorCompanyId: "dc" }), { partnershipId: "po_1", scoreCompanyId: "dc", contractorCompanyId: "dc" });
  assert.deepEqual(partnershipTripFields({ contractId: "c" }), {}); assert.deepEqual(partnershipTripFields({ partnershipId: "po_1" }), {});
});

// ───────────── cliente ─────────────
const doc = (extra: Record<string, unknown> = {}) => normalizePartnership("po_1", { status: "active", contractorCompanyId: "dc", executorCompanyId: "cts", contractorName: "DC Transportes", executorName: "CTS", operationName: "Operação 031",
  totalTrips: 20, progress: 8, deadlineMs: NOW + 3 * DAY, createdAt: NOW - 2 * DAY, jobId: "job1", goalAmountCents: 4_000_000, currency: "BRL", ...extra });
test("Documento incompleto não derruba a tela (valores padrão seguros)", () => {
  const p = normalizePartnership("po_x", {});
  assert.equal(p.status, "pending"); assert.equal(p.totalTrips, 0); assert.deepEqual(p.ledger, []); assert.equal(p.goalAmountCents, null); assert.equal(p.jobId, null);
});
test("Seção por papel: convite e designação pedem ação da executora; contratante só aguarda", () => {
  assert.equal(sectionFor(doc({ status: "pending", jobId: null }), "cts"), "action");
  assert.equal(sectionFor(doc({ status: "pending", jobId: null }), "dc"), "waiting");
  assert.equal(sectionFor(doc({ status: "accepted", jobId: null }), "cts"), "action");
  assert.equal(sectionFor(doc({ status: "accepted", jobId: "j" }), "cts"), "running");
  assert.equal(sectionFor(doc({ status: "active" }), "dc"), "running");
  assert.equal(sectionFor(doc({ status: "completed" }), "dc"), "done");
  assert.equal(sectionFor(doc({ status: "declined" }), "dc"), "closed");
  assert.equal(roleIn(doc(), "dc"), "contractor"); assert.equal(roleIn(doc(), "cts"), "executor"); assert.equal(roleIn(doc(), "zzz"), null);
});
test("Textos de estado", () => {
  assert.equal(statusText(doc({ status: "pending", jobId: null }), "executor"), "Responder oferta");
  assert.equal(statusText(doc({ status: "pending", jobId: null }), "contractor"), "Aguardando CTS");
  assert.equal(statusText(doc({ status: "accepted", jobId: null }), "executor"), "Designar motorista");
  assert.equal(statusText(doc({ status: "completed" }), "contractor"), "Concluída");
});
test("Ritmo do prazo: no ritmo, atenção, abaixo e vencido", () => {
  assert.equal(paceOf(doc({ progress: 8 }), NOW).tone, "good");
  assert.equal(paceOf(doc({ progress: 1, createdAt: NOW - 3 * DAY, deadlineMs: NOW + 1 * DAY }), NOW).tone, "late");
  assert.equal(paceOf(doc({ progress: 2, totalTrips: 20, createdAt: NOW - DAY, deadlineMs: NOW + 2 * DAY }), NOW).tone, "warn");
  assert.equal(paceOf(doc({ deadlineMs: NOW - 1 }), NOW).label, "Prazo vencido");
  assert.equal(paceOf(doc({ status: "completed" }), NOW).label, "Concluída");
});
test("Tempo restante e pips da rota", () => {
  assert.equal(remainingText(NOW + 2 * DAY + 5 * 3_600_000, NOW), "2 dias e 5 h"); assert.equal(remainingText(NOW + 3 * 3_600_000 + 10 * 60_000, NOW), "3 h 10 min");
  assert.equal(remainingText(NOW - 1, NOW), "Prazo encerrado"); assert.equal(remainingText(NOW + 90_000, NOW), "1 min");
  assert.equal(pipsFor(8, 20), 8); assert.equal(pipsFor(20, 20), 20); assert.equal(pipsFor(30, 20), 20); assert.equal(pipsFor(1, 0), 0);
});
test("Dinheiro: entrada digitada vira centavos; exibição em R$ sem centavos desnecessários", () => {
  assert.equal(parseMoneyToCents("40.000"), 4_000_000); assert.equal(parseMoneyToCents("12.500,50"), 1_250_050); assert.equal(parseMoneyToCents("12500,5"), 1_250_050);
  assert.equal(parseMoneyToCents("40000"), 4_000_000); assert.equal(parseMoneyToCents(""), null); assert.equal(parseMoneyToCents("abc"), null); assert.equal(parseMoneyToCents("0"), null);
  assert.match(formatMoney(4_176_000, "BRL").replace(/\s/g, " "), /^R\$ 41\.760$/);
});
test("Resultados: ganhos, % da meta (sem meta = nulo), média, melhor viagem e barras", () => {
  const ledger = [{ n: 1, at: 1, cents: 100_000, tripId: "" }, { n: 2, at: 2, cents: 300_000, tripId: "" }];
  const r = resultsOf(doc({ ledger, goalAmountCents: 800_000, totalTrips: 2, progress: 2 }));
  assert.equal(r.earningsCents, 400_000); assert.equal(r.goalPercent, 50); assert.equal(r.averageCents, 200_000); assert.equal(r.bestCents, 300_000); assert.equal(r.bestN, 2);
  assert.deepEqual(r.bars.map(bar => bar.height), [33, 100]);
  assert.equal(resultsOf(doc({ ledger, goalAmountCents: null })).goalPercent, null);
});
test("Formulário: mesmas regras do servidor antes de enviar", () => {
  const ok: ReturnType<typeof emptyDraft> = { ...emptyDraft("cts"), operationName: "Operação 031", totalTrips: "20", vehicleRequirement: "Volvo FH", trailerRequirement: "Frigorífico",
    deadlineAt: new Date(NOW + 4 * DAY).toISOString(), conditions: "", goal: "40.000" };
  assert.equal(validateDraft(ok, NOW, false), "");
  assert.match(validateDraft({ ...ok, executorCompanyId: "" }, NOW, false), /parceira/);
  assert.match(validateDraft({ ...ok, totalTrips: "0" }, NOW, false), /entre 1 e 500/);
  assert.match(validateDraft({ ...ok, deadlineAt: "" }, NOW, false), /prazo/);
  assert.match(validateDraft({ ...ok, conditions: "a".repeat(301) }, NOW, false), /300/);
  assert.match(validateDraft({ ...ok, goal: "abc" }, NOW, false), /meta/);
  assert.equal(validateDraft({ ...ok, trailerRequirement: "" }, NOW, true), "");
});
test("Siglas das empresas (DC Transportes → DC, CTS → CT, Rota Sul → RS)", () => {
  assert.equal(initialsOf("DC Transportes"), "DC"); assert.equal(initialsOf("CTS"), "CT"); assert.equal(initialsOf("Rota Sul"), "RS"); assert.equal(initialsOf(""), "··");
});
test("Contratos ocultos de parceria são reconhecidos (pc_, partnership, partnershipId)", () => {
  assert.equal(isPartnershipContract({ id: "pc_po_1" }), true); assert.equal(isPartnershipContract({ id: "x", partnership: true }), true);
  assert.equal(isPartnershipContract({ id: "x", partnershipId: "po_1" }), true); assert.equal(isPartnershipContract({ id: "c1" }), false); assert.equal(isPartnershipContract(null), false);
});

// ───────────── contratos entre arquivos ─────────────
test("Prefixos do cliente e do servidor coincidem e a regra de início exige a foto", () => {
  assert.equal(partnershipContractId("po_1"), "pc_po_1");
  const commands = readFileSync("functions/src/operationalCommands.ts", "utf8");
  assert.match(commands, /verifyStartPhotoUrl/); assert.match(commands, /partnershipId/);
  const app = readFileSync("src/context/AppContext.tsx", "utf8");
  assert.match(app, /Anexe a foto do veículo para iniciar esta operação em parceria/);
});
test("Perfil da empresa não foi tocado por esta versão (instrução do usuário)", () => {
  for (const file of ["src/components/driver/ProfileResultsCard.tsx", "src/pages/PublicProfile.tsx"]) assert.doesNotMatch(readFileSync(file, "utf8"), /[Pp]artnership|B2P|Parcerias/, file);
});
console.log(`${checks} verificações de Parcerias B2P passaram.`);
