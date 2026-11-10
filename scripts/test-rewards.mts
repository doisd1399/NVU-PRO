/** Recompensas (fase 1): regras puras do servidor, paridade com o app e ligações entre arquivos. O fluxo com banco roda em scripts/test-rewards-emulator.mjs. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accrueRewards, campaignBudget as serverBudget, driverMaxCents as serverDriverMax, goalEstimate as serverGoalEstimate, dayBounds, estimateMaxCost as serverEstimate, normalizeCampaign } from "../functions/src/rewardPolicy.ts";
import { buildPayroll, offerCompleted as serverCompleted, dateBRT, maskPixKey, nextPaymentStatus, normalizeDispute, normalizeE2e, normalizePayDay, receiptNumber, weekdayBRT, type PaymentAction, type PaymentStatus } from "../functions/src/rewardPolicy.ts";
import { brText, buildPixBrCode, crc16, parsePixBrCode } from "../src/lib/pixBrCode.ts";
import { dateTimeText, formatPixKey, nextPayDayText, normalizePayment, pendingBalance } from "../src/lib/rewardPayments.ts";
import { campaignBudget, campaignState, driverMaxCents, goalEstimate, goalOf, estimateMaxCost, normalizeCampaign as clientCampaign, normalizeOffer, offerCompleted, periodText, rewardErrorMessage, termText } from "../src/lib/rewards.ts";

let checks = 0;
const test = (name: string, run: () => void) => { run(); checks++; console.log("PASS", name); };
const NOW = Date.parse("2026-11-10T15:00:00Z"), DAY = 86_400_000;
const input = (extra: Record<string, unknown> = {}) => ({ name: "Semana de Ouro", startDate: "2026-11-10", endDate: "2026-11-16", perTripCents: 2500, bonusCents: 20000, bonusGoalTrips: 20, budgetCents: 600000, audience: "all", driverIds: [], ...extra });
const rejects = (fn: () => unknown, pattern: RegExp) => assert.throws(fn, error => pattern.test(String((error as Error).message)));

test("Campanha válida: período em horário de Brasília, valores em centavos, bônus só com meta (e meta só com bônus)", () => {
  const c = normalizeCampaign(input({ name: "  Semana   de Ouro " }), NOW);
  assert.equal(c.name, "Semana de Ouro"); assert.deepEqual([c.perTripCents, c.bonusCents, c.bonusGoalTrips, c.budgetCents, c.audience], [2500, 20000, 20, 600000, "all"]);
  assert.deepEqual(dayBounds("2026-11-10", "2026-11-16"), { startMs: Date.parse("2026-11-10T03:00:00Z"), endMs: Date.parse("2026-11-17T02:59:59.999Z") }); assert.equal(c.startMs, Date.parse("2026-11-10T03:00:00Z"));
  assert.deepEqual([normalizeCampaign(input({ bonusCents: 0, bonusGoalTrips: 20 }), NOW).bonusGoalTrips, normalizeCampaign(input({ bonusCents: 0 }), NOW).bonusCents], [0, 0]);
});
test("Campanha inválida é recusada (nome, datas, período vencido ou longo demais, valores, teto, motoristas)", () => {
  for (const [extra, pattern] of [[{ name: "ab" }, /nome/], [{ startDate: "10/11" }, /datas/], [{ endDate: "2026-11-09" }, /antes do início/], [{ startDate: "2026-10-01", endDate: "2026-10-05" }, /já terminou/], [{ endDate: "2027-03-01" }, /no máximo/],
    [{ perTripCents: 0 }, /valor por viagem/], [{ perTripCents: 1.5 }, /valor por viagem/], [{ bonusGoalTrips: 0 }, /meta/], [{ budgetCents: 100 }, /teto/], [{ audience: "selected", driverIds: [] }, /ao menos um/]] as [Record<string, unknown>, RegExp][])
    rejects(() => normalizeCampaign(input(extra), NOW), pattern);
  rejects(() => normalizeCampaign(input({ audience: "selected", driverIds: Array.from({ length: 101 }, (_, i) => `d${i}`) }), NOW), /no máximo 100/);
});
test("Simulador: servidor e app calculam o custo máximo igual", () => {
  const terms = { perTripCents: 2500, bonusCents: 20000, bonusGoalTrips: 20 };
  for (const [drivers, trips] of [[8, 20], [8, 19], [1, 0], [3, 50]] as const) assert.deepEqual(estimateMaxCost(terms, drivers, trips), serverEstimate(terms, drivers, trips));
  assert.deepEqual(estimateMaxCost(terms, 8, 20), { tripsCents: 400000, bonusCents: 160000, totalCents: 560000 }, "8 × 20 × R$ 25 + 8 × R$ 200 = R$ 5.600");
  assert.equal(estimateMaxCost(terms, 8, 19).bonusCents, 0, "sem bater a meta, sem bônus");
});
const terms = { startMs: NOW - DAY, endMs: NOW + 5 * DAY, perTripCents: 2500, bonusCents: 20000, bonusGoalTrips: 3, budgetCents: 600000 };
const trips = (driverId: string, ...ats: number[]) => ats.map((at, index) => ({ id: `${driverId}-${index}-${at}`, driverId, at }));
test("Ganho: valor fixo por viagem, só depois do aceite e dentro do período; cada viagem uma vez", () => {
  const r = accrueRewards(terms, [{ driverId: "d1", acceptedAtMs: NOW }], [...trips("d1", NOW - 5000, NOW + 1000, NOW + 2000, NOW + 6 * DAY, 0), { id: "d1-1-" + (NOW + 1000), driverId: "d1", at: NOW + 1000 }, ...trips("d2", NOW + 1000)]);
  const row = r.drivers.get("d1")!; assert.deepEqual([row.trips, row.tripCents, row.bonusCents, row.totalCents, row.goalReached], [2, 5000, 0, 5000, false]); assert.equal(r.drivers.has("d2"), false, "quem não aceitou não entra");
  assert.deepEqual([r.accruedCents, r.tripsCount, r.capped], [5000, 2, false]);
});
test("Bônus: entra na viagem que completa a meta, uma vez só", () => {
  const r = accrueRewards(terms, [{ driverId: "d1", acceptedAtMs: 0 }], trips("d1", ...[1, 2, 3, 4, 5].map(n => NOW + n * 1000)));
  const row = r.drivers.get("d1")!; assert.deepEqual([row.trips, row.bonusCents, row.totalCents, row.goalReached], [5, 20000, 32500, true]);
});
test("Teto: a campanha para quando a próxima viagem (ou o bônus) passaria do teto; nada passa do teto", () => {
  const two = accrueRewards({ ...terms, budgetCents: 6000, bonusCents: 0, bonusGoalTrips: 0 }, [{ driverId: "d1", acceptedAtMs: 0 }], trips("d1", NOW + 1, NOW + 2, NOW + 3));
  assert.deepEqual([two.accruedCents, two.capped, two.drivers.get("d1")!.trips], [5000, true, 2]);
  const bonusStops = accrueRewards({ ...terms, budgetCents: 10000 }, [{ driverId: "d1", acceptedAtMs: 0 }], trips("d1", NOW + 1, NOW + 2, NOW + 3));
  assert.deepEqual([bonusStops.accruedCents, bonusStops.capped, bonusStops.drivers.get("d1")!.goalReached, bonusStops.drivers.get("d1")!.totalCents], [7500, true, false, 7500], "o bônus que não cabe não é pago");
  const shared = accrueRewards({ ...terms, budgetCents: 7500, bonusCents: 0, bonusGoalTrips: 0 }, [{ driverId: "a", acceptedAtMs: 0 }, { driverId: "b", acceptedAtMs: 0 }], [...trips("a", NOW + 1, NOW + 3), ...trips("b", NOW + 2, NOW + 4)]);
  assert.deepEqual([shared.drivers.get("a")!.trips, shared.drivers.get("b")!.trips, shared.accruedCents], [2, 1, 7500], "o teto é da campanha: quem completa primeiro leva");
});
test("App: leitura defensiva dos documentos, estados da campanha e período em texto", () => {
  const c = clientCampaign("rc_1", { companyId: "a", name: "Ouro", startMs: NOW - DAY, endMs: NOW + DAY, perTripCents: 2500, budgetCents: 600000, status: "active", acceptedCount: 2 });
  assert.deepEqual([c.name, c.perTripCents, c.bonusCents, c.capped, c.acceptedCount], ["Ouro", 2500, 0, false, 2]);
  assert.deepEqual([campaignState(c, NOW), campaignState(c, NOW + 3 * DAY), campaignState(c, NOW - 3 * DAY), campaignState({ ...c, capped: true }, NOW), campaignState({ ...c, status: "cancelled" }, NOW)], ["active", "ended", "scheduled", "capped", "cancelled"]);
  assert.equal(normalizeOffer("o", { status: "???" }).status, "pending"); assert.match(periodText(Date.parse("2026-11-10T12:00:00Z"), Date.parse("2026-11-16T12:00:00Z")), /^10 a 16 nov$/);
});
test("Ligações: funções exportadas, regiões, regras, rotas e entradas do menu", () => {
  const index = readFileSync("functions/src/index.ts", "utf8"), regions = readFileSync("src/lib/callableRegions.ts", "utf8"), rules = readFileSync("firestore.rules", "utf8"), app = readFileSync("src/App.tsx", "utf8");
  for (const name of ["createRewardCampaign", "respondRewardOffer", "cancelRewardCampaign"]) { assert.match(index, new RegExp(`\\b${name}\\b`)); assert.match(regions, new RegExp(`"${name}"`)); }
  assert.match(index, /syncRewardTrips/); assert.match(rules, /match \/rewardCampaigns\/\{campaignId\}/); assert.match(rules, /match \/rewardOffers\/\{offerId\}/);
  const block = rules.slice(rules.indexOf("match /rewardCampaigns"), rules.indexOf("// English aliases"));
  assert.equal((block.match(/allow create, update, delete: if false;/g) || []).length, 5, "o cliente nunca escreve campanhas, ofertas, dia de pagamento, chave Pix nem pagamentos"); assert.doesNotMatch(block, /allow (create|update|delete|write)(?!, update, delete: if false)/);
  assert.match(app, /path="recompensas" element=\{<LazyRoute><Rewards \/>/); assert.match(app, /path="recompensas" element=\{<LazyRoute><DriverRewards \/>/);
  assert.match(readFileSync("src/components/admin/management/ManagementDashboard.tsx", "utf8"), /id: "rewards", label: "Pagamentos"/); assert.match(readFileSync("src/pages/admin/fleet/OperationsTab.tsx", "utf8"), /"\/admin\/recompensas"/);
  assert.match(readFileSync("src/pages/driver/Dashboard.tsx", "utf8"), /<DriverRewardsEntry \/>/);
  const server = readFileSync("functions/src/rewards.ts", "utf8"); assert.match(server, /isTrustedServerConfirmedTrip/, "só viagem confirmada pelo servidor conta"); assert.match(server, /acceptedAtMs/);
  assert.match(readFileSync("scripts/qa/integration.mts", "utf8"), /test-rewards-emulator\.mjs/);
});

const offer = (extra: Record<string, unknown> = {}) => ({ id: "o1", campaignId: "c1", campaignName: "Semana de Ouro", driverId: "d1", totalCents: 7500, settledCents: 0, completed: true, ...extra }) as Parameters<typeof buildPayroll>[0][number];
test("Folha: cada motorista recebe o ganho ainda fora de folha; saldo zero ou negativo não entra; várias campanhas somam", () => {
  const lines = buildPayroll([offer(), offer({ id: "o2", campaignId: "c2", campaignName: "Meta", totalCents: 2500, settledCents: 1000 }), offer({ id: "o3", driverId: "d2", totalCents: 5000, settledCents: 5000 }), offer({ id: "o4", driverId: "d3", totalCents: 100, settledCents: 900 }), offer({ id: "o5", driverId: "d4", totalCents: 0 })]);
  assert.deepEqual(lines.map(line => [line.driverId, line.amountCents]), [["d1", 9000]]);
  assert.deepEqual(lines[0].items.map(item => [item.offerId, item.cents]), [["o1", 7500], ["o2", 1500]]);
  assert.deepEqual(buildPayroll([offer({ id: "o9", driverId: "z" }), offer({ id: "o8", driverId: "a" })]).map(line => line.driverId), ["a", "z"], "ordem estável");
  assert.deepEqual(buildPayroll([offer({ settledCents: 7500 })]), [], "o que já entrou em folha não entra de novo");
});
test("Pagamento: pago só de pendente/contestado; recebido só de pago; cancelar só antes de pago; recebido e cancelado são finais", () => {
  const all: PaymentStatus[] = ["pending", "paid", "received", "contested", "cancelled"];
  const table: Record<PaymentAction, Partial<Record<PaymentStatus, PaymentStatus>>> = { pay: { pending: "paid", contested: "paid" }, receive: { paid: "received" }, contest: { paid: "contested" }, cancel: { pending: "cancelled", contested: "cancelled" } };
  for (const action of Object.keys(table) as PaymentAction[]) for (const status of all) assert.equal(nextPaymentStatus(status, action), table[action][status] ?? null, `${action} em ${status}`);
});
test("Comprovante e entradas: número estável com data de Brasília, chave escondida, código E2E e motivo validados, dia da semana", () => {
  const at = Date.parse("2026-11-11T01:30:00Z"); // 10/11 22:30 em Brasília
  assert.match(receiptNumber("rp_1_d1", at), /^RC-20261110-[0-9A-F]{8}$/); assert.equal(receiptNumber("rp_1_d1", at), receiptNumber("rp_1_d1", at)); assert.notEqual(receiptNumber("rp_1_d1", at), receiptNumber("rp_1_d1", at + 1)); assert.notEqual(receiptNumber("rp_1_d1", at), receiptNumber("rp_1_d2", at));
  assert.equal(dateBRT(at), "2026-11-10"); assert.equal(weekdayBRT(at), 2, "terça em Brasília, mesmo já sendo quarta em UTC");
  assert.equal(maskPixKey("cpf", "52998224725"), "***.982.247-**"); assert.equal(maskPixKey("cnpj", "12345678000190"), "**.345.678/****-**"); assert.equal(maskPixKey("phone", "+5511912345678"), "+5511*****78");
  assert.equal(maskPixKey("email", "naylson@mail.com"), "na***@mail.com"); assert.equal(maskPixKey("random", "123e4567-e89b-12d3-a456-426614174000"), "123e4567-****-****-****-4000"); assert.equal(maskPixKey("cpf", ""), "");
  assert.equal(normalizeE2e(""), ""); assert.equal(normalizeE2e(" E123456789 0ABCDEF "), "E1234567890ABCDEF"); rejects(() => normalizeE2e("curto"), /10 a 40/); rejects(() => normalizeE2e("com espaço e símbolos!!!!"), /10 a 40/);
  assert.equal(normalizeDispute("  não   caiu "), "não caiu"); rejects(() => normalizeDispute("x"), /5 a 300/); rejects(() => normalizeDispute("a".repeat(301)), /5 a 300/);
  assert.equal(normalizePayDay("5"), 5); rejects(() => normalizePayDay(7), /dia da semana/); rejects(() => normalizePayDay("x"), /dia da semana/);
});
test("Pix copia e cola: CRC16 do padrão, campos obrigatórios, nome/cidade sem acento e valor com duas casas", () => {
  assert.equal(crc16("123456789"), "29B1", "vetor de teste do CRC16/CCITT-FALSE");
  const code = buildPixBrCode({ key: "52998224725", amountCents: 7550, name: "João da Silva Ávila Ferreira Junior", city: "São Paulo" }), parsed = parsePixBrCode(code);
  assert.ok(parsed.crcOk); assert.ok(code.startsWith("000201010211")); assert.equal(parsed.fields["54"], "75.50"); assert.equal(parsed.fields["53"], "986"); assert.equal(parsed.fields["58"], "BR"); assert.equal(parsed.fields["52"], "0000");
  assert.equal(parsed.fields["59"], "JOAO DA SILVA AVILA FERRE", "até 25 caracteres, sem acento"); assert.ok(parsed.fields["59"].length <= 25); assert.equal(parsed.fields["60"], "SAO PAULO");
  assert.deepEqual(parsePixBrCode(parsed.fields["26"]).fields, { "00": "br.gov.bcb.pix", "01": "52998224725" }); assert.equal(parsePixBrCode(parsed.fields["62"]).fields["05"], "***");
  assert.equal(parsePixBrCode(code.slice(0, -1) + (code.endsWith("0") ? "1" : "0")).crcOk, false, "alterar o código quebra o CRC");
  assert.equal(brText("  ", 25, "RECEBEDOR"), "RECEBEDOR"); assert.equal(parsePixBrCode(buildPixBrCode({ key: "+5511912345678", amountCents: 1, name: "A" })).fields["54"], "0.01");
  rejects(() => buildPixBrCode({ key: "", amountCents: 100, name: "A" }), /Chave Pix/); rejects(() => buildPixBrCode({ key: "x", amountCents: 0, name: "A" }), /Valor/); rejects(() => buildPixBrCode({ key: "x", amountCents: 1.5, name: "A" }), /Valor/);
});
test("App: leitura do pagamento, saldo da próxima folha, datas de Brasília e próximo dia de pagamento", () => {
  const payment = normalizePayment("p1", { companyId: "a", driverId: "d1", amountCents: 5000, status: "paid", items: [{ offerId: "o1", campaignName: "Semana", cents: 5000 }], receipt: { number: "RC-1", paidAtMs: 5, amountCents: 5000, campaigns: ["Semana"] }, createdAt: { seconds: 10 } });
  assert.deepEqual([payment.status, payment.items.length, payment.receipt?.number, payment.createdAtMs, normalizePayment("x", { status: "estranho" }).status], ["paid", 1, "RC-1", 10_000, "pending"]);
  const balance = pendingBalance([normalizeOffer("o1", { status: "accepted", driverId: "d1", driverName: "Ana", totalCents: 7500, settledCents: 2500 }), normalizeOffer("o2", { status: "accepted", driverId: "d1", driverName: "Ana", totalCents: 1000 }), normalizeOffer("o3", { status: "pending", driverId: "d2", totalCents: 900 }), normalizeOffer("o4", { status: "accepted", driverId: "d3", totalCents: 100, settledCents: 100 })]);
  assert.deepEqual([balance.totalCents, balance.rows.map(row => [row.driverId, row.cents])], [6000, [["d1", 6000]]]);
  assert.equal(dateTimeText(Date.parse("2026-11-10T17:32:00Z")), "10/11/2026 às 14:32"); assert.equal(dateTimeText(0), "—");
  assert.deepEqual([formatPixKey("cpf", "52998224725"), formatPixKey("cnpj", "12345678000190"), formatPixKey("phone", "+5511912345678"), formatPixKey("phone", "+551133334444"), formatPixKey("email", "a@b.co")], ["529.982.247-25", "12.345.678/0001-90", "+55 (11) 91234-5678", "+55 (11) 3333-4444", "a@b.co"]);
  const tuesday = Date.parse("2026-11-10T15:00:00Z"); assert.equal(nextPayDayText(2, tuesday), "hoje"); assert.equal(nextPayDayText(5, tuesday), "sexta, 13/11"); assert.equal(nextPayDayText(1, tuesday), "segunda, 16/11");
});
test("Ligações da fase 2: funções exportadas e nas regiões, regras, telas, QR e agendamento diário", () => {
  const index = readFileSync("functions/src/index.ts", "utf8"), regions = readFileSync("src/lib/callableRegions.ts", "utf8"), rules = readFileSync("firestore.rules", "utf8"), server = readFileSync("functions/src/rewardPayments.ts", "utf8");
  for (const name of ["setRewardPayDay", "setRewardPix", "generateRewardPayroll", "markRewardPaid", "confirmRewardReceived", "contestRewardPayment", "cancelRewardPayment"]) { assert.match(index, new RegExp(`\\b${name}\\b`)); assert.match(regions, new RegExp(`"${name}"`)); assert.match(server, new RegExp(`export const ${name} = functions\\.region\\(\\.\\.\\.CALLABLE_REGIONS\\)`)); }
  assert.match(index, /rewardPayDayTick/); assert.match(server, /schedule\("0 8 \* \* \*"\)\.timeZone\("America\/Sao_Paulo"\)/);
  for (const name of ["rewardSettings/{companyId}", "rewardPayees/{userId}", "rewardPayments/{paymentId}"]) assert.ok(rules.includes(`match /${name}`), name);
  assert.match(server, /where\("payrollId", "==", payrollId\)/, "a folha é idempotente pelo identificador"); assert.match(server, /settledCents: admin\.firestore\.FieldValue\.increment/); assert.match(server, /requireCompanyManager/); assert.doesNotMatch(server, /allow|CALLABLE_REGIONS\)\.https\.onRequest/);
  assert.match(readFileSync("src/components/rewards/PaymentParts.tsx", "utf8"), /qrcode-generator/); assert.match(readFileSync("package.json", "utf8"), /"qrcode-generator": "2\.0\.4"/);
  assert.match(readFileSync("src/pages/admin/Rewards.tsx", "utf8"), /PayrollTab[\s\S]*TransfersTab/); assert.match(readFileSync("src/pages/driver/Rewards.tsx", "utf8"), /ReceiptsTab/);
  assert.match(readFileSync("scripts/qa/integration.mts", "utf8"), /test-reward-payments-emulator\.mjs/);
});
test("Campanha por operação: operação e viagens por motorista; teto sai da conta; só conta viagem da operação e até o limite de cada motorista", () => {
  const c = normalizeCampaign(input({ contractId: " ct-1 ", maxTripsPerDriver: 20, budgetCents: undefined, bonusCents: 0, bonusGoalTrips: 0 }), NOW);
  assert.deepEqual([c.contractId, c.maxTripsPerDriver, c.budgetCents], ["ct-1", 20, 0], "sem teto informado, o servidor calcula");
  assert.equal(normalizeCampaign(input({ budgetCents: null }), NOW).budgetCents, 0); rejects(() => normalizeCampaign(input({ maxTripsPerDriver: 0 }), NOW), /viagens por motorista/); rejects(() => normalizeCampaign(input({ maxTripsPerDriver: 1001 }), NOW), /viagens por motorista/);
  assert.equal(serverBudget({ perTripCents: 2500, bonusCents: 0, maxTripsPerDriver: 20 }, 3), 150000); assert.equal(campaignBudget({ perTripCents: 2500, bonusCents: 0, maxTripsPerDriver: 20 }, 3), 150000, "servidor e app calculam igual");
  assert.equal(campaignBudget({ perTripCents: 2500, bonusCents: 20000, maxTripsPerDriver: 20 }, 2), 2 * (50000 + 20000));
  const terms = { startMs: 0, endMs: Number.MAX_SAFE_INTEGER, perTripCents: 2500, bonusCents: 0, bonusGoalTrips: 0, budgetCents: 1_000_000, contractId: "ct-1", maxTripsPerDriver: 2 };
  const trips = [{ id: "a", at: 10, contractId: "ct-1" }, { id: "b", at: 11, contractId: "ct-2" }, { id: "c", at: 12, contractId: "ct-1" }, { id: "d", at: 13, contractId: "ct-1" }, { id: "e", at: 14 }, { id: "f", at: 15, contractId: "ct-1" }].map(t => ({ driverId: "d1", ...t }));
  const result = accrueRewards(terms, [{ driverId: "d1", acceptedAtMs: 1 }, { driverId: "d2", acceptedAtMs: 1 }], [...trips, { id: "x", at: 20, driverId: "d2", contractId: "ct-1" }]);
  assert.deepEqual([result.drivers.get("d1")!.trips, result.drivers.get("d1")!.totalCents, result.drivers.get("d2")!.trips, result.tripsCount, result.accruedCents], [2, 5000, 1, 3, 7500], "outra operação e viagem sem operação não contam; limite por motorista; o outro motorista segue");
  assert.equal(accrueRewards({ ...terms, contractId: "", maxTripsPerDriver: 0 }, [{ driverId: "d1", acceptedAtMs: 1 }], trips).tripsCount, 6, "campanhas antigas (sem operação nem limite) continuam valendo");
  const offer = normalizeOffer("o", { contractId: "ct-1", contractName: "Cargas SP", maxTripsPerDriver: 20 }); assert.deepEqual([offer.contractName, offer.maxTripsPerDriver, normalizeOffer("o", {}).maxTripsPerDriver], ["Cargas SP", 20, 0]);
});
test("Mensagem de erro do servidor: sem código cru (\"internal [0]\"), texto útil do servidor preservado", () => {
  assert.match(rewardErrorMessage({ message: "internal [0]" }, "Não foi possível salvar o dia."), /^Não foi possível salvar o dia\. O servidor não respondeu/);
  assert.match(rewardErrorMessage({ message: "functions/internal: internal" }, "X."), /O servidor não respondeu/); assert.match(rewardErrorMessage({}, "Falhou."), /^Falhou\./);
  assert.equal(rewardErrorMessage({ message: "Escolha a operação da campanha." }, "X."), "Escolha a operação da campanha.");
});
test("Formulário da campanha: campos fora do componente (o teclado não fecha a cada letra), passos pedidos e sem bônus/teto digitados", () => {
  const page = readFileSync("src/pages/admin/Rewards.tsx", "utf8"), form = page.slice(page.indexOf("function NewCampaign("), page.indexOf("function CampaignDetail("));
  assert.doesNotMatch(form, /\bconst Field\s*=/, "componente declarado dentro de outro remonta os campos a cada letra e fecha o teclado");
  assert.match(page, /^const Field = /m);
  assert.deepEqual(["1. Operação", "2. Valor por viagem", "3. Meta de ganhos da operação", "4. Nome da campanha"].filter(label => !form.includes(label)), []);
  assert.match(form, /<DriverMultiSelect /, "seletor de motoristas igual ao do Encaminhar trabalho"); assert.match(readFileSync("src/components/rewards/DriverMultiSelect.tsx", "utf8"), /Selecionar todos[\s\S]*nvu-assignment-driver-list|nvu-assignment-driver-list[\s\S]*Selecionar todos/); assert.doesNotMatch(form, /Quem participa|b2p-seg/); assert.match(page, /audience: "selected", driverIds: picked/, "sempre envia os motoristas escolhidos"); assert.doesNotMatch(readFileSync("src/pages/admin/Rewards.tsx", "utf8") + readFileSync("src/pages/driver/Rewards.tsx", "utf8") + readFileSync("src/components/driver/DriverRewardsEntry.tsx", "utf8"), />Recompensas<|shell\("Recompensas"|label="Recompensas"|shell\("Salário"|label="Salário"|>Salário</, "o nome da área é Pagamentos"); assert.doesNotMatch(form, /Teto de investimento da campanha|Bônus da meta|Meta para o bônus/); assert.match(form, /AssignJobAssetPicker kind="contract"/, "seletor de operações já existente (busca, pastas e rolagem própria)"); assert.match(form, /Row label="Total de viagens" value=\{totalTrips\}/, "total de viagens = motoristas × viagens da operação (sem mostrar a conta)"); assert.match(form, /Row label="Estimativa da meta"/); assert.match(form, /goalEstimate\(goalCents, people\)/); assert.match(form, /Row label="Total a pagar"/); assert.doesNotMatch(form, /Total de viagens \(|Estimativa da meta \(|Total a pagar \(|1 operação de/, "sem cálculos escritos na tela"); assert.doesNotMatch(form, /type="date"|Início|label="Fim"|startDate|endDate/, "o prazo é o da operação: sem início e fim"); assert.doesNotMatch(form, /b2p-grid2/, "valor por viagem e meta empilhados"); assert.doesNotMatch(form, /changePerTrip|changeGoal|snapGoal/, "salário por viagem e meta no simulador são coisas diferentes: sem ligação"); assert.match(form, /payroll = totalTrips \* perTripCents/);  assert.doesNotMatch(form, /setTripsInput|label="[0-9]\. Viagens/, "o empresário não digita viagens: vêm da operação"); assert.doesNotMatch(form.slice(form.indexOf("onSend({"), form.indexOf("onSend({") + 300), /maxTripsPerDriver/, "o pedido não envia viagens"); assert.match(form, /OperationCardBody/, "prévia da operação igual à lista"); assert.match(readFileSync("src/components/admin/AssignJobAssetPicker.tsx", "utf8"), /<OperationCardBody name=\{contract\.name\}/, "a lista usa o mesmo cartão da prévia"); assert.match(form, /totalDeliveries/, "viagens vêm do total da operação");
  assert.match(page, /item\.status === "active" && item\.deleted !== true/, "só operações ativas");
});
test("Meta de ganhos da operação é separada do salário: soma os ganhos de todas as viagens da operação, não limita nem altera o pagamento; salário = viagens × salário por viagem", () => {
  assert.equal(normalizeCampaign(input({ goalCents: 30000 }), NOW).goalCents, 30000); assert.equal(normalizeCampaign(input({}), NOW).goalCents, 0); assert.equal(normalizeCampaign(input({ goalCents: 0 }), NOW).goalCents, 0);
  assert.equal(normalizeCampaign(input({ goalCents: 99_000_000 }), NOW).goalCents, 99_000_000, "a meta da operação pode ser maior que o salário: são coisas diferentes"); rejects(() => normalizeCampaign(input({ goalCents: 1.5 }), NOW), /meta de ganhos/); rejects(() => normalizeCampaign(input({ goalCents: -5 }), NOW), /meta de ganhos/);
  const terms = { startMs: 0, endMs: Number.MAX_SAFE_INTEGER, perTripCents: 2500, bonusCents: 0, bonusGoalTrips: 0, budgetCents: 1_000_000, contractId: "ct-1", maxTripsPerDriver: 12, goalCents: 700000 };
  const trips = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, driverId: "d1", at: 10 + i, contractId: "ct-1", valueCents: 150000 })), result = accrueRewards(terms, [{ driverId: "d1", acceptedAtMs: 1 }], trips), row = result.drivers.get("d1")!;
  assert.deepEqual([row.trips, row.tripCents, row.simCents, row.goalReached], [6, 15000, 900000, true], "salário 6 × R$ 25; ganhos da operação 6 × R$ 1.500 = R$ 9.000 ≥ meta R$ 7.000");
  const below = accrueRewards({ ...terms, goalCents: 2_000_000 }, [{ driverId: "d1", acceptedAtMs: 1 }], trips).drivers.get("d1")!; assert.deepEqual([below.goalReached, below.tripCents], [false, 15000], "meta não alcançada não muda o salário");
  assert.equal(accrueRewards({ ...terms, goalCents: 0 }, [{ driverId: "d1", acceptedAtMs: 1 }], trips).drivers.get("d1")!.goalReached, false, "sem meta definida");
  assert.equal(accrueRewards(terms, [{ driverId: "d1", acceptedAtMs: 1 }], [{ id: "x", driverId: "d1", at: 10, contractId: "ct-1" }]).drivers.get("d1")!.simCents, 0, "viagem sem valor no jogo soma zero");
  assert.deepEqual([serverDriverMax(terms), driverMaxCents(terms), serverBudget(terms, 3), campaignBudget(terms, 3)], [30000, 30000, 90000, 90000], "salário máximo = viagens × salário por viagem; a meta não entra na conta");
  assert.deepEqual([goalEstimate(60000, 2), goalEstimate(0, 5), goalEstimate(60000, 0), serverGoalEstimate(60000, 2)], [120000, 0, 0, 120000], "estimativa da meta = soma da meta de cada motorista (meta 600 × 2 = 1.200)");
  assert.deepEqual([goalOf({ goalCents: 0 }), goalOf({ goalCents: 7000 }), normalizeOffer("o", { goalCents: 7000, simCents: 1234 }).simCents], [0, 7000, 1234]);
  const people = 2, tripsPerDriver = 10; assert.equal(people * tripsPerDriver, 20, "1 operação de 10 viagens × 2 motoristas = 20 viagens no total"); assert.equal(campaignBudget({ perTripCents: 10, bonusCents: 0, maxTripsPerDriver: 12 }, 3), 360, "viagem de R$ 0,10: 36 viagens somam R$ 3,60");
});
test("Pagamento só de quem concluiu a operação; quem não concluiu fica para a folha seguinte; campanha sem datas vale o prazo da operação", () => {
  const lines = buildPayroll([offer({ completed: false }), offer({ id: "o2", driverId: "d2", totalCents: 5000 })]); assert.deepEqual(lines.map(line => [line.driverId, line.amountCents]), [["d2", 5000]], "d1 não concluiu: fica fora da folha");
  assert.deepEqual(buildPayroll([offer({ completed: false })]), []); assert.deepEqual(buildPayroll([offer({ completed: true })]).map(line => line.amountCents), [7500], "concluiu: entra na próxima folha (na mesma semana ou na seguinte)");
  const base = { totalCents: 0, trips: 0, maxTripsPerDriver: 10 };
  assert.deepEqual([serverCompleted({ ...base, trips: 9 }), serverCompleted({ ...base, trips: 10 }), serverCompleted({ ...base, trips: 11 }), serverCompleted({ totalCents: 500 }), serverCompleted({ totalCents: 0 })], [false, true, true, true, false], "concluiu = fez todas as viagens da operação; campanha antiga conta o que foi ganho");
  assert.deepEqual([{ ...base, trips: 9 }, { ...base, trips: 10 }, { totalCents: 500 }].map(offerCompleted), [false, true, true], "servidor e app iguais");
  const open = normalizeCampaign({ ...input({}), startDate: undefined, endDate: undefined, contractId: "ct-1" }, NOW); assert.deepEqual([open.openEnded, open.startMs, open.endMs - open.startMs], [true, NOW, 365 * DAY], "sem datas: aberta, a partir de agora"); assert.equal(normalizeCampaign(input({}), NOW).openEnded, false);
  rejects(() => normalizeCampaign({ ...input({}), endDate: undefined }, NOW), /datas/);
  assert.equal(termText({ openEnded: true, deadlineDays: 4, startMs: 0, endMs: 0 }), "prazo da operação: 4 dias"); assert.equal(termText({ openEnded: false, deadlineDays: 4, startMs: NOW, endMs: NOW + DAY }), periodText(NOW, NOW + DAY));
  const waiting = pendingBalance([normalizeOffer("a", { status: "accepted", driverId: "d1", driverName: "Ana", totalCents: 2500, perTripCents: 2500, maxTripsPerDriver: 4, trips: 1 }), normalizeOffer("b", { status: "accepted", driverId: "d2", driverName: "Beto", totalCents: 10000, perTripCents: 2500, maxTripsPerDriver: 4, trips: 4 })]);
  assert.deepEqual([waiting.rows.map(row => row.driverId), waiting.totalCents, waiting.waiting.map(row => [row.driverId, row.trips, row.of])], [["d2"], 10000, [["d1", 1, 4]]], "pronto para a folha × em andamento");
});
console.log(`${checks} verificações de Recompensas passaram.`);
