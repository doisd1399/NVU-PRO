/** Recompensas (fase 1): regras puras do servidor, paridade com o app e ligações entre arquivos. O fluxo com banco roda em scripts/test-rewards-emulator.mjs. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accrueRewards, dayBounds, estimateMaxCost as serverEstimate, normalizeCampaign } from "../functions/src/rewardPolicy.ts";
import { campaignState, estimateMaxCost, normalizeCampaign as clientCampaign, normalizeOffer, periodText } from "../src/lib/rewards.ts";

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
  assert.equal((block.match(/allow create, update, delete: if false;/g) || []).length, 2, "o cliente nunca escreve campanhas nem ofertas"); assert.doesNotMatch(block, /allow (create|update|delete|write)(?!, update, delete: if false)/);
  assert.match(app, /path="recompensas" element=\{<LazyRoute><Rewards \/>/); assert.match(app, /path="recompensas" element=\{<LazyRoute><DriverRewards \/>/);
  assert.match(readFileSync("src/components/admin/management/ManagementDashboard.tsx", "utf8"), /id: "rewards", label: "Recompensas"/); assert.match(readFileSync("src/pages/admin/fleet/OperationsTab.tsx", "utf8"), /"\/admin\/recompensas"/);
  assert.match(readFileSync("src/pages/driver/Dashboard.tsx", "utf8"), /<DriverRewardsEntry \/>/);
  const server = readFileSync("functions/src/rewards.ts", "utf8"); assert.match(server, /isTrustedServerConfirmedTrip/, "só viagem confirmada pelo servidor conta"); assert.match(server, /acceptedAtMs/);
  assert.match(readFileSync("scripts/qa/integration.mts", "utf8"), /test-rewards-emulator\.mjs/);
});
console.log(`${checks} verificações de Recompensas passaram.`);
