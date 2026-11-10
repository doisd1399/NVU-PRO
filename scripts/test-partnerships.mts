/**
 * v44 — Parcerias B2P: regras puras (servidor e cliente) e consistência entre os dois lados.
 * O fluxo completo com banco (oferta → aceite → designação → foto → viagem → ranking) roda no emulador:
 * scripts/test-partnerships-emulator.mjs.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildLedger, isPartnerAvailable, matchesRequirement as serverMatches, mayTransition, normalizeOffer, partnershipContractId, partnershipTripFields,
  statusFromJob, verifyStartPhotoUrl,
} from "../functions/src/partnershipPolicy.ts";
import { computeSettlement as serverSettlement, nextPayment } from "../functions/src/partnershipPolicy.ts";
import { partnerCandidates } from "../src/lib/partnerCandidates.ts";
import {
  clampDays, clampTrips, computeSettlement, emptyDraft, walletEntries, walletTotals, formatDays, formatMoney, initialsOf, isPartnershipContract, lastVehicleOf, matchesRequirement, normalizePartnership,
  offerHint, offerSummary, paceOf, parseMoneyToCents, partnershipAlerts, perTripCents, pipsFor, remainingText, resultsOf, roleIn, sectionFor, statusText, suggestOperationName, validateDraft,
} from "../src/lib/partnerships.ts";

let checks = 0;
const test = (name: string, run: () => void) => { run(); checks++; console.log("PASS", name); };
const NOW = Date.parse("2026-11-09T12:00:00Z"), DAY = 86_400_000;
const offer = (extra: Record<string, unknown> = {}) => ({ contractorCompanyId: "dc", executorCompanyId: "cts", operationName: "Operação 031", totalTrips: 20,
  trailerRequirement: "Frigorífico", durationDays: 5, conditions: "Veículo limpo.", goalAmountCents: 4_000_000, requestId: "r1", ...extra });
const rejects = (fn: () => unknown, pattern: RegExp) => assert.throws(fn, error => pattern.test(String((error as Error).message)));

// ───────────── servidor: validação da oferta ─────────────
test("Oferta válida é normalizada (texto limpo, prazo em dias, meta em centavos)", () => {
  const result = normalizeOffer(offer({ operationName: "  Operação   031 " }), NOW, false);
  assert.equal(result.operationName, "Operação 031");
  assert.equal(result.goalAmountCents, 4_000_000);
  assert.equal(result.trailerRequirement, "Frigorífico");
});
test("A oferta não leva veículo: quem escolhe é a executora (campo enviado por app antigo é ignorado)", () => {
  const result = normalizeOffer(offer({ vehicleRequirement: "Volvo FH" }), NOW, false) as Record<string, unknown>;
  assert.equal("vehicleRequirement" in result, false);
  assert.deepEqual(Object.keys(result).sort(), ["agreedAmountCents", "conditions", "contractorCompanyId", "durationDays", "executorCompanyId", "goalAmountCents", "operationName", "requestId", "totalTrips", "trailerRequirement"]);
});
test("Prazo em dias: aceita 1 a 120 e NÃO guarda data (o relógio começa no aceite)", () => {
  assert.equal(normalizeOffer(offer({ durationDays: 1 }), NOW, false).durationDays, 1); assert.equal(normalizeOffer(offer({ durationDays: "120" }), NOW, false).durationDays, 120);
  assert.equal("deadlineAt" in normalizeOffer(offer(), NOW, false), false);
});
test("App antigo que ainda envia data final: convertida em dias (arredondando para cima)", () => {
  assert.equal(normalizeOffer(offer({ durationDays: undefined, deadlineAt: new Date(NOW + 4.2 * DAY).toISOString() }), NOW, false).durationDays, 5);
  rejects(() => normalizeOffer(offer({ durationDays: undefined, deadlineAt: "amanhã" }), NOW, false), /prazo em dias/);
  rejects(() => normalizeOffer(offer({ durationDays: undefined, deadlineAt: new Date(NOW + 200 * DAY).toISOString() }), NOW, false), /entre 1 e 120 dias/);
});
test("Reboque é opcional: sem exigência a oferta vale e guarda nulo", () => {
  assert.equal(normalizeOffer(offer({ trailerRequirement: "" }), NOW, false).trailerRequirement, null);
  assert.equal(normalizeOffer(offer({ trailerRequirement: undefined }), NOW, false).trailerRequirement, null);
});
test("Simulador sem reboque nunca guarda exigência de reboque", () => assert.equal(normalizeOffer(offer(), NOW, true).trailerRequirement, null));
test("Empresa não pode propor para si mesma", () => rejects(() => normalizeOffer(offer({ executorCompanyId: "dc" }), NOW, false), /outra empresa/));
test("Nome curto, viagens fora de 1–500 e prazo em dias inválido são recusados", () => {
  rejects(() => normalizeOffer(offer({ operationName: "ab" }), NOW, false), /nome da operação/);
  for (const totalTrips of [0, 501, 1.5, "x"]) rejects(() => normalizeOffer(offer({ totalTrips }), NOW, false), /entre 1 e 500/);
  for (const durationDays of [0, -1, 121, 2.5, "x"]) rejects(() => normalizeOffer(offer({ durationDays }), NOW, false), /entre 1 e 120 dias/);
  rejects(() => normalizeOffer(offer({ durationDays: undefined }), NOW, false), /entre 1 e 120 dias/);
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
  totalTrips: 20, progress: 8, deadlineMs: NOW + 3 * DAY, createdAt: NOW - 2 * DAY, acceptedAt: NOW - 2 * DAY, durationDays: 5, jobId: "job1", goalAmountCents: 4_000_000, currency: "BRL", ...extra });
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
  assert.equal(paceOf(doc({ progress: 1, createdAt: NOW - 9 * DAY, acceptedAt: NOW - 3 * DAY, deadlineMs: NOW + 1 * DAY }), NOW).tone, "late");
  assert.equal(paceOf(doc({ progress: 2, totalTrips: 20, createdAt: NOW - 9 * DAY, acceptedAt: NOW - DAY, deadlineMs: NOW + 2 * DAY }), NOW).tone, "warn");
  assert.equal(paceOf(doc({ deadlineMs: NOW - 1 }), NOW).label, "Prazo vencido");
  assert.equal(paceOf(doc({ status: "completed" }), NOW).label, "Concluída");
  assert.equal(paceOf(doc({ status: "pending", deadlineMs: null, acceptedAt: null, jobId: null }), NOW).tone, "idle", "antes do aceite o relógio não corre");
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
  const ok: ReturnType<typeof emptyDraft> = { ...emptyDraft("cts"), operationName: "Operação 031", totalTrips: "20", trailerRequirement: "Frigorífico",
    durationDays: "5", conditions: "", goal: "40.000" };
  assert.equal(validateDraft(ok, NOW, false), "");
  assert.equal(validateDraft({ ...ok, trailerRequirement: "" }, NOW, false), "", "reboque é opcional");
  assert.deepEqual(Object.keys(ok).sort(), ["agreed", "conditions", "durationDays", "executorCompanyId", "goal", "operationName", "totalTrips", "trailerRequirement"], "o formulário não tem veículo");
  assert.match(validateDraft({ ...ok, executorCompanyId: "" }, NOW, false), /parceira/);
  assert.match(validateDraft({ ...ok, totalTrips: "0" }, NOW, false), /entre 1 e 500/);
  assert.match(validateDraft({ ...ok, durationDays: "" }, NOW, false), /entre 1 e 120 dias/); assert.match(validateDraft({ ...ok, durationDays: "121" }, NOW, false), /120 dias/);
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

// ───────────── apoio às telas: nome, viagens, prazo, resumo e sugestões ─────────────
test("Nome sugerido da operação: maior número da própria empresa + 1, com 3 dígitos", () => {
  const rows = [{ contractorCompanyId: "dc", operationName: "Operação 031" }, { contractorCompanyId: "dc", operationName: "Operação 7" }, { contractorCompanyId: "outra", operationName: "Operação 099" }];
  assert.equal(suggestOperationName(rows, "dc"), "Operação 032");
  assert.equal(suggestOperationName([], "dc"), "Operação 001");
  assert.equal(suggestOperationName([{ contractorCompanyId: "dc", operationName: "Safra" }, { contractorCompanyId: "dc", operationName: "Colheita" }], "dc"), "Operação 003");
  assert.equal(suggestOperationName(rows, "nova"), "Operação 001");
});
test("Viagens: o contador fica entre 1 e 500, mesmo com valor inválido", () => {
  assert.equal(clampTrips(0), 1); assert.equal(clampTrips(501), 500); assert.equal(clampTrips(12.6), 13); assert.equal(clampTrips(Number.NaN), 1); assert.equal(clampTrips(-4), 1);
});
test("Prazo em dias: limites, texto no singular/plural", () => {
  assert.equal(clampDays(0), 1); assert.equal(clampDays(121), 120); assert.equal(clampDays(4.6), 5); assert.equal(clampDays(Number.NaN), 1);
  assert.equal(formatDays(1), "1 dia"); assert.equal(formatDays(5), "5 dias");
});
test("Meta por viagem e resumo de uma linha da oferta", () => {
  assert.equal(perTripCents(4_000_000, 12), 333_333); assert.equal(perTripCents(null, 12), null); assert.equal(perTripCents(4_000_000, 0), null);
  const draft = { ...emptyDraft("cts"), operationName: "Operação 077", totalTrips: "12", durationDays: "5" };
  assert.equal(offerSummary(draft, "CTS Logística"), "CTS Logística · 12 viagens · 5 dias");
  assert.equal(offerSummary({ ...draft, totalTrips: "1", durationDays: "1" }, ""), "Sem parceira · 1 viagem · 1 dia");
});
test("Dica do rodapé: diz a primeira pendência e some quando a oferta está pronta", () => {
  const NOW2 = Date.parse("2026-11-09T12:00:00Z");
  const ready = { ...emptyDraft("cts"), operationName: "Operação 077", totalTrips: "12", durationDays: "5" };
  assert.equal(offerHint(ready, NOW2, false), "");
  assert.equal(offerHint({ ...ready, executorCompanyId: "" }, NOW2, false), "Escolha a empresa parceira");
  assert.equal(offerHint({ ...ready, operationName: "ab" }, NOW2, false), "Dê um nome à operação");
  assert.equal(offerHint({ ...ready, totalTrips: "0" }, NOW2, false), "Informe de 1 a 500 viagens");
  assert.equal(offerHint({ ...ready, durationDays: "" }, NOW2, false), "Defina o prazo em dias (1 a 120)");
  assert.equal(offerHint({ ...ready, durationDays: "200" }, NOW2, false), "Defina o prazo em dias (1 a 120)");
  assert.equal(offerHint({ ...ready, conditions: "a".repeat(301) }, NOW2, false), "Revise os dados da oferta");
});
test("Designação: sugere o último veículo da própria frota que o motorista usou", () => {
  const own = new Set(["v1", "v2"]);
  const jobs = [{ driverId: "d1", vehicleId: "v1", assignedAt: "2026-11-01T10:00:00Z" }, { driverId: "d1", vehicleId: "v2", assignedAt: "2026-11-05T10:00:00Z" }, { driverId: "d1", vehicleId: "fora", assignedAt: "2026-11-08T10:00:00Z" },
    { driverId: "d2", vehicleId: "v1", assignedAt: "2026-11-09T10:00:00Z" }, { driverId: "d1", vehicleId: "v1", createdAt: "2026-11-03T10:00:00Z" }];
  assert.equal(lastVehicleOf(jobs, "d1", own), "v2"); assert.equal(lastVehicleOf(jobs, "d2", own), "v1"); assert.equal(lastVehicleOf(jobs, "d3", own), null);
});
// ───────────── empresas parceiras: ativas e do mesmo simulador ─────────────
test("Empresa parceira disponível: ativa, não excluída, não arquivada/suspensa (mesma regra do servidor e do catálogo)", () => {
  assert.equal(isPartnerAvailable({ status: "active" }), true); assert.equal(isPartnerAvailable({}), true);
  for (const bad of [{ deleted: true }, { isDeleted: true }, { softDeleted: true }, { active: false }, { isActive: false }, { status: "archived" }, { status: "Suspended" },
    { status: "inactive" }, { status: "pending" }, { status: "rejected" }, { status: "blocked" }, { status: "disabled" }, { status: "deleted" }]) assert.equal(isPartnerAvailable(bad), false, JSON.stringify(bad));
  assert.equal(isPartnerAvailable(null), false);
});
const sims = [{ id: "sim-gto", name: "GTO", key: "gto" }, { id: "sim-ets2", name: "Euro Truck Simulator 2", key: "ets2" }];
const co = (id: string, extra: Record<string, unknown> = {}) => ({ id, companyName: `Empresa ${id}`, simulatorId: "gto", status: "active", ...extra });
test("Lista de parceiras: só empresas ATIVAS do MESMO simulador, outra empresa, em ordem (já parceiras primeiro)", () => {
  const all = [co("me"), co("a"), co("b", { companyName: "Beta" }), co("c", { simulatorId: "ets2" }), co("d", { status: "archived" }), co("e", { deleted: true }), co("f", { active: false }),
    co("g", { status: "suspended" }), co("h", { simulatorId: undefined, simulatorName: "Global Truck Online" }), co("i", { simulatorId: "GTO", companyName: "Alfa" }), co("j", { companyName: "" })];
  const result = partnerCandidates({ ownCompany: all[0], allCompanies: all, simulators: sims, history: [{ contractorCompanyId: "me", executorCompanyId: "b", updatedAtMs: 5 }] });
  assert.equal(result.simulatorId.length > 0, true);
  assert.deepEqual(result.list.map(item => item.id), ["b", "i", "a", "h"], "b já é parceira; depois Alfa(i), Empresa a, Empresa h");
  assert.equal(result.list[0].partnered, true); assert.equal(result.list[1].partnered, false);
  for (const hidden of ["me", "c", "d", "e", "f", "g", "j"]) assert.equal(result.list.some(item => item.id === hidden), false, `${hidden} não pode aparecer`);
});
test("Lista de parceiras: o simulador é comparado pela identidade canônica (GTO = Global Truck Online)", () => {
  const own = co("me", { simulatorId: undefined, simulatorName: "Global Truck Online" });
  const all = [own, co("x", { simulatorId: "global-truck-online" }), co("y", { simulatorId: "gto" }), co("z", { simulatorId: "ets-2", simulatorName: "ETS2" })];
  assert.deepEqual(partnerCandidates({ ownCompany: own, allCompanies: all, simulators: sims, history: [] }).list.map(item => item.id).sort(), ["x", "y"]);
});
test("Lista de parceiras: sem identificar o simulador da empresa logada, não oferece ninguém (o servidor também recusaria)", () => {
  const own = { id: "me", companyName: "Sem simulador", status: "active" };
  assert.deepEqual(partnerCandidates({ ownCompany: own, allCompanies: [own, co("a")], simulators: sims, history: [] }), { simulatorId: "", simulatorLabel: "", list: [] });
  assert.equal(partnerCandidates({ ownCompany: null, allCompanies: [co("a")], simulators: sims, history: [] }).list.length, 0);
});
test("A página lê o catálogo PÚBLICO de empresas (allCompanies) e não só as empresas do usuário", () => {
  const page = readFileSync("src/pages/admin/Partnerships.tsx", "utf8");
  assert.match(page, /allCompanies/); assert.match(page, /loadCompanyCatalog/); assert.match(page, /partnerCandidates\(\{[^}]*allCompanies/);
  assert.doesNotMatch(page, /candidates\s*=\s*[^;]*\bcompanies\b(?!\.find)/, "a lista de parceiras não pode partir de `companies`");
});
test("Nenhuma tela, serviço ou regra do servidor trata veículo como parte da oferta", () => {
  for (const file of ["functions/src/partnershipPolicy.ts", "functions/src/partnerships.ts", "src/lib/partnerships.ts", "src/services/partnershipService.ts", "src/pages/admin/Partnerships.tsx", "src/components/partnerships/NewOfferScreen.tsx", "src/components/partnerships/DesignateScreen.tsx",
    "src/components/partnerships/PanelParts.tsx", "src/components/partnerships/WalletScreen.tsx", "src/components/partnerships/DetailScreens.tsx", "src/components/partnerships/shared.tsx"])
    assert.doesNotMatch(readFileSync(file, "utf8"), /vehicleRequirement|Veículo exigido|veículo exigido/, file);
});

// ───────────── indicador da Central ─────────────
test("Indicador da linha Parcerias B2P: ações pendentes + novidades desde a última visita (progresso não conta)", () => {
  const r = (status: string, extra: Record<string, unknown> = {}) => ({ status: status as any, jobId: null as string | null, contractorCompanyId: "dc", executorCompanyId: "cts", updatedAtMs: 1000, ...extra });
  assert.deepEqual(partnershipAlerts([], "dc", 0), { toAnswer: 0, news: 0, total: 0, label: "" });
  const rows = [r("pending"), r("accepted"), r("declined"), r("completed"), r("cancelled"), r("active")];
  const dc = partnershipAlerts(rows, "dc", 0);
  assert.equal(dc.toAnswer, 0, "a contratante não responde a própria oferta"); assert.equal(dc.news, 4, "aceita, recusada, concluída e cancelada são novidades; andamento não");
  assert.equal(dc.label, "4 novidades");
  const cts = partnershipAlerts(rows, "cts", 0);
  assert.equal(cts.toAnswer, 2, "oferta recebida e oferta aceita sem motorista"); assert.equal(cts.news, 2, "concluída e cancelada"); assert.equal(cts.label, "2 para responder · 2 novidades");
  assert.equal(partnershipAlerts(rows, "cts", 2000).news, 0, "depois de ver, as novidades somem; ações pendentes continuam");
  assert.equal(partnershipAlerts(rows, "cts", 2000).toAnswer, 2);
  assert.equal(partnershipAlerts(rows, "outra", 0).total, 0);
  assert.equal(partnershipAlerts([r("completed")], "dc", 0).label, "1 novidade");
});

// ───────────── valor do acordo, liquidação e carteira ─────────────
test("Valor do acordo: opcional, centavos positivos; o campo antigo de valor não existe sem ele", () => {
  assert.equal(normalizeOffer(offer(), NOW, false).agreedAmountCents, null);
  assert.equal(normalizeOffer(offer({ agreedAmountCents: 1_200_000 }), NOW, false).agreedAmountCents, 1_200_000);
  for (const bad of [0, -1, 1.5, "abc"]) rejects(() => normalizeOffer(offer({ agreedAmountCents: bad }), NOW, false), /valor do acordo/);
});
test("Liquidação: no prazo = valor combinado; fora do prazo = menos 25% (servidor e app calculam igual)", () => {
  const deadline = NOW + 5 * DAY;
  for (const fn of [serverSettlement, computeSettlement]) {
    const ok = fn(1_000_000, deadline, deadline - 1)!;
    assert.deepEqual([ok.late, ok.penaltyPercent, ok.discountCents, ok.finalCents], [false, 0, 0, 1_000_000]);
    assert.equal(fn(1_000_000, deadline, deadline)!.late, false, "no instante do prazo ainda é no prazo");
    const late = fn(1_000_000, deadline, deadline + 1)!;
    assert.deepEqual([late.late, late.penaltyPercent, late.discountCents, late.finalCents], [true, 25, 250_000, 750_000]);
    assert.equal(fn(333_333, deadline, deadline + DAY)!.finalCents, 250_000, "arredonda em centavos (249.999,75 → 250.000)");
    assert.equal(fn(333_333, deadline, deadline + DAY)!.discountCents + fn(333_333, deadline, deadline + DAY)!.finalCents, 333_333);
    assert.equal(fn(null, deadline, NOW), null); assert.equal(fn(0, deadline, NOW), null);
  }
  for (const [agreed, done] of [[1_000_000, NOW + 6 * DAY], [77_777, NOW], [5, NOW + 9 * DAY]]) assert.deepEqual(serverSettlement(agreed, NOW + 5 * DAY, done), computeSettlement(agreed, NOW + 5 * DAY, done));
});
test("Pagamento: contratante marca pago (só pendente); executora confirma recebido (pendente ou pago); nada volta atrás", () => {
  assert.equal(nextPayment("pending", "paid"), "paid"); assert.equal(nextPayment("paid", "paid"), null); assert.equal(nextPayment("settled", "paid"), null);
  assert.equal(nextPayment("pending", "received"), "settled"); assert.equal(nextPayment("paid", "received"), "settled"); assert.equal(nextPayment("settled", "received"), null);
});
const wp = (extra: Record<string, unknown>) => normalizePartnership("po_w", { status: "completed", contractorCompanyId: "dc", executorCompanyId: "cts", contractorName: "DC", executorName: "CTS", operationName: "Operação", totalTrips: 10, progress: 10,
  agreedAmountCents: 1_000_000, currency: "BRL", createdAt: NOW - 9 * DAY, updatedAt: NOW, ...extra });
test("Carteira: contratante vê INVESTIMENTOS, executora vê GANHOS; previsto, a pagar/receber, pago e liquidado", () => {
  const done = (payment: string, finalCents = 750_000, late = true) => wp({ settlement: { agreedCents: 1_000_000, late, penaltyPercent: late ? 25 : 0, discountCents: 1_000_000 - finalCents, finalCents, deadlineMs: NOW - DAY, completedAtMs: NOW }, payment: { status: payment } });
  const rows = [wp({ id: "a", status: "active", agreedAmountCents: 500_000 }), done("pending"), done("paid", 1_000_000, false), done("settled"), wp({ status: "pending" }), wp({ status: "declined" }), wp({ agreedAmountCents: null, status: "active" })];
  const dc = walletEntries(rows, "dc"), cts = walletEntries(rows, "cts");
  assert.deepEqual(dc.map(e => e.kind), ["investimento", "investimento", "investimento", "investimento"]); assert.deepEqual(cts.map(e => e.kind), ["ganho", "ganho", "ganho", "ganho"]);
  assert.deepEqual(dc.map(e => e.status).sort(), ["a_pagar", "liquidado", "pago", "previsto"]); assert.deepEqual(cts.map(e => e.status).sort(), ["a_receber", "liquidado", "pago", "previsto"]);
  const pay = walletTotals(dc), gain = walletTotals(cts);
  assert.equal(pay.toPayCents, 750_000); assert.equal(pay.paidCents, 1_000_000 + 750_000); assert.equal(pay.forecastInvestCents, 500_000);
  assert.equal(gain.toReceiveCents, 750_000 + 1_000_000, "a receber inclui o que a contratante já marcou como pago e ainda falta confirmar"); assert.equal(gain.receivedCents, 750_000); assert.equal(gain.forecastGainCents, 500_000);
  assert.equal(gain.netCents, 750_000); assert.equal(pay.netCents, -(1_000_000 + 750_000) + 0);
  assert.equal(walletEntries(rows, "outra").length, 0);
  assert.equal(dc.find(e => e.status === "a_pagar")!.discountCents, 250_000); assert.equal(dc.find(e => e.status === "a_pagar")!.late, true);
});
test("Formulário: valor do acordo inválido é recusado antes de enviar", () => {
  const ok: ReturnType<typeof emptyDraft> = { ...emptyDraft("cts"), operationName: "Operação 031", totalTrips: "20", durationDays: "5", agreed: "12.000" };
  assert.equal(validateDraft(ok, NOW, false), ""); assert.match(validateDraft({ ...ok, agreed: "abc" }, NOW, false), /valor do acordo/); assert.equal(validateDraft({ ...ok, agreed: "" }, NOW, false), "");
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
