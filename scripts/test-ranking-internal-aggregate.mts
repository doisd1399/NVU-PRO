import assert from "node:assert/strict";
import {
  buildDriverRankingFromAggregate,
  buildInternalDriverRankingFromAggregate,
  type RankingAggregateDocument,
} from "../src/lib/rankingAggregates.ts";

// Ranking interno = ranking global filtrado pela empresa. Cobre o relato "Não foi possível carregar o ranking"
// no Interno (leitura direta das viagens da empresa) com a mesma fonte do Global (agregado do servidor).
const stat = (companyId: string, trips: number, brl: number, name: string) => ({
  trips, val: brl, companyId, name,
  currencyTotals: { BRL: brl }, currencyTripCounts: { BRL: trips }, currencyMissingValueTrips: 0, currencyUnresolvedTrips: 0,
});
const aggregate = {
  schemaVersion: 3, simulatorId: "gto", periodType: "monthly", periodKey: "2026-11", periodTimeZone: "UTC", periodPolicy: "utc",
  complete: true, sourceTripCount: 9, companies: {},
  drivers: {
    d1: stat("matecom", 4, 4000, "Ana Souza"), d2: stat("matecom", 3, 9000, "Bruno Lima"),
    d3: stat("outra", 2, 99000, "Carla Dias"), d4: stat("matecom", 1, 500, "Davi Rocha"),
  },
} as unknown as RankingAggregateDocument;
const companies = [
  { id: "matecom", companyName: "Matecom", simulatorId: "gto", status: "active" },
  { id: "outra", companyName: "Outra", simulatorId: "gto", status: "active" },
];
const simulators = [{ id: "gto", name: "GTO", currency: "BRL" }];
const noMembers: Record<string, unknown>[] = [];

const global = buildDriverRankingFromAggregate(aggregate, [], companies, simulators, noMembers);
assert.deepEqual(global.map((row) => row.id), ["d3", "d2", "d1", "d4"], "global ordena todos pela receita");

const internal = buildInternalDriverRankingFromAggregate(aggregate, [], companies, simulators, noMembers, "matecom");
assert.deepEqual(internal.map((row) => row.id), ["d2", "d1", "d4"], "interno só tem motoristas da empresa, na ordem do global");
assert.deepEqual(internal.map((row) => row.val), [9000, 4000, 500]);
assert.ok(internal.every((row) => row.companyId === "matecom" && row.companyName === "Matecom"));
// consistência com o Global: mesmos valores para o mesmo motorista
for (const row of internal) assert.equal(row.val, global.find((g) => g.id === row.id)?.val);

// empresa sem motoristas no período, empresa não informada e empresa desconhecida: lista vazia (nunca erro, nunca outra empresa)
assert.deepEqual(buildInternalDriverRankingFromAggregate(aggregate, [], companies, simulators, noMembers, "inexistente"), []);
assert.deepEqual(buildInternalDriverRankingFromAggregate(aggregate, [], companies, simulators, noMembers, ""), []);
// empresa inativa não aparece
const inactive = [{ ...companies[0], status: "inactive" }, companies[1]];
assert.deepEqual(buildInternalDriverRankingFromAggregate(aggregate, [], inactive, simulators, noMembers, "matecom"), []);
console.log("ranking interno pelo agregado: ok");
