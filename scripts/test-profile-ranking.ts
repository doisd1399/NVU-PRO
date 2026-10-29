import assert from "node:assert/strict";
import {
  summarizeProfileRanking,
  buildProfileActivityCalendar,
  rankingCalendarDateKey,
} from "../src/lib/profileRanking.ts";
import {
  buildCompanyRankingFromAggregate,
  buildDriverRankingFromAggregate,
  mergeRankingCompanyCatalogs,
  RANKING_AGGREGATE_SCHEMA_VERSION,
  buildRankingAggregateDocumentId,
  parseRankingAggregateDocument,
  type RankingAggregateDocument,
} from "../src/lib/rankingAggregates.ts";
import {
  buildDriverRankingPageData,
  buildInternalDriverRankingPageData,
} from "../src/lib/rankingPageEngine.ts";
import {
  buildClassificationPeriods,
  resolvePerformanceInterval,
  resolvePreviousPerformanceInterval,
} from "../src/lib/performancePeriods.ts";
import { normalizeTrip } from "../src/lib/tripNormalizer.ts";
import { tripMatchesReadScope } from "../src/lib/tripReadScope.ts";

const simulators = [
  { id: "gto", name: "GTO" },
  { id: "wbds", name: "WBDS" },
];
const companies = [
  {
    id: "matecom",
    companyName: "MATECOM",
    simulatorId: "gto",
    status: "active",
  },
  { id: "cocal", companyName: "COCAL", simulatorId: "gto", status: "active" },
  {
    id: "tijoleira",
    companyName: "Tijoleira",
    simulatorId: "gto",
    status: "active",
  },
  {
    id: "dc",
    companyName: "DC Transportes",
    simulatorId: "gto",
    status: "active",
  },
  {
    id: "other-sim",
    companyName: "WBDS",
    simulatorId: "wbds",
    status: "active",
  },
  {
    id: "inactive",
    companyName: "Arquivada",
    simulatorId: "gto",
    status: "deleted",
  },
];
const aggregate: RankingAggregateDocument = {
  schemaVersion: RANKING_AGGREGATE_SCHEMA_VERSION,
  simulatorId: "gto",
  periodType: "mes",
  periodKey: "mes_2026-10",
  periodTimeZone: "America/Sao_Paulo",
  periodPolicy: "SAO_PAULO_CALENDAR",
  complete: true,
  sourceTripCount: 66,
  companies: {
    matecom: { val: 1192503, trips: 48 },
    cocal: { val: 126253, trips: 5 },
    tijoleira: { val: 125168, trips: 5 },
    dc: { val: 104873, trips: 8 },
    inactive: { val: 9999999, trips: 99 },
    "other-sim": { val: 9999999, trips: 99 },
  },
  drivers: {
    jose: { val: 634600, trips: 24, name: "José Macedo", companyId: "matecom" },
    thiago: {
      val: 497436,
      trips: 20,
      name: "Thiago Caetano",
      companyId: "matecom",
    },
    ferreira: {
      val: 126253,
      trips: 5,
      name: "José Ferreira",
      companyId: "cocal",
    },
    davi: { val: 104873, trips: 8, name: "Davi Canto", companyId: "dc" },
    archived: { val: 9999999, trips: 99, companyId: "inactive" },
    other: { val: 9999999, trips: 99, companyId: "other-sim" },
  },
};
Object.values(aggregate.companies).forEach((stat) => {
  stat.currencyTotals = { BRL: stat.val };
  stat.currencyTripCounts = { BRL: stat.trips };
  stat.currencySourceCounts = { SIMULATOR_REGISTRY: stat.trips };
});
Object.values(aggregate.drivers).forEach((stat) => {
  stat.currencyTotals = { BRL: stat.val };
  stat.currencyTripCounts = { BRL: stat.trips };
  stat.currencySourceCounts = { SIMULATOR_REGISTRY: stat.trips };
});
let passed = 0;
function test(name: string, run: () => void) {
  run();
  passed++;
  console.log(`PASS ${name}`);
}
const referenceDate = new Date("2026-10-04T12:00:00Z");
const range = resolvePerformanceInterval("Mês atual", undefined, referenceDate);
const trip = (
  id: string,
  companyId: string,
  driverId: string,
  val: number,
  simulatorId = "gto",
) =>
  normalizeTrip({
    id,
    companyId,
    driverId,
    simulatorId,
    status: "concluida",
    valor: val,
    completedAt: "2026-10-02T12:00:00Z",
  });

const legacyAggregate = (simulatorId: string, driverCurrency?: string) =>
  parseRankingAggregateDocument({
    schemaVersion: 4,
    simulatorId,
    periodType: "mes",
    periodKey: "mes_2026-10",
    periodTimeZone: "America/Sao_Paulo",
    periodPolicy: "SAO_PAULO_CALENDAR",
    complete: true,
    sourceTripCount: 10,
    companies: { dc: { val: 125373, trips: 10 } },
    drivers: {
      davi: {
        val: 125373,
        trips: 10,
        companyId: "dc",
        ...(driverCurrency ? { currency: driverCurrency } : {}),
      },
    },
  });

test("Agregado v4 de outubro recupera subtotal GTO/BRL sem reescrita", () => {
  const legacy = legacyAggregate("gto");
  assert.ok(legacy);
  assert.equal(legacy.schemaVersion, 4);
  assert.deepEqual(legacy.companies.dc.currencyTotals, { BRL: 125373 });
  assert.deepEqual(legacy.companies.dc.currencySourceCounts, { SIMULATOR_REGISTRY: 10 });
  assert.equal(legacy.drivers.davi.currencyTotals?.BRL, 125373);
  assert.deepEqual(
    [buildRankingAggregateDocumentId("gto", "mes_2026-10", 5), buildRankingAggregateDocumentId("gto", "mes_2026-10", 4)],
    ["v5__gto__mes_2026-10", "v4__gto__mes_2026-10"],
  );
  const oneCompany = [{ id: "dc", companyName: "DC Transportes", simulatorId: "gto", status: "active" }];
  const companyRow = buildCompanyRankingFromAggregate(legacy, oneCompany, simulators)[0];
  const driverRow = buildDriverRankingFromAggregate(legacy, [], oneCompany, simulators)[0];
  assert.equal(companyRow?.currency, "BRL");
  assert.equal(companyRow?.val, 125373);
  assert.equal(driverRow?.currency, "BRL");
  assert.equal(driverRow?.val, 125373);
});

test("ID opaco v4 mapeado pelo catálogo GTO recupera BRL para Empresa e Global", () => {
  const opaqueSimulatorId = "catalog-gto-id-opaque-001";
  const legacy = parseRankingAggregateDocument({
    schemaVersion: 4,
    simulatorId: opaqueSimulatorId,
    periodType: "mes",
    periodKey: "mes_2026-10",
    periodTimeZone: "America/Sao_Paulo",
    periodPolicy: "SAO_PAULO_CALENDAR",
    complete: true,
    sourceTripCount: 118,
    companies: { dc: { val: 125373, trips: 10 } },
    drivers: { davi: { val: 125373, trips: 10, companyId: "dc" } },
  });
  assert.ok(legacy);
  const catalog = [{ id: opaqueSimulatorId, name: "GTO" }];
  const fleet = [{ id: "dc", companyName: "DC Transportes", simulatorId: opaqueSimulatorId, status: "active" }];
  const companyRow = buildCompanyRankingFromAggregate(legacy, fleet, catalog)[0];
  const driverRow = buildDriverRankingFromAggregate(legacy, [], fleet, catalog)[0];
  assert.equal(companyRow?.currency, "BRL");
  assert.equal(companyRow?.val, 125373);
  assert.deepEqual(companyRow?.currencySourceCounts, { SIMULATOR_REGISTRY: 10 });
  assert.equal(driverRow?.currency, "BRL");
  assert.equal(driverRow?.val, 125373);
  assert.deepEqual(driverRow?.currencySourceCounts, { SIMULATOR_REGISTRY: 10 });
});

test("TOE3 legado resolve EUR; moeda explícita conflitante e simulador desconhecido não entram no subtotal", () => {
  const euro = legacyAggregate("toe3");
  assert.ok(euro);
  assert.deepEqual(euro.companies.dc.currencyTotals, { EUR: 125373 });
  assert.deepEqual(euro.companies.dc.currencySourceCounts, { SIMULATOR_REGISTRY: 10 });

  const conflict = legacyAggregate("gto", "EUR");
  assert.ok(conflict);
  assert.deepEqual(conflict.drivers.davi.currencyTotals, {});
  assert.equal(conflict.drivers.davi.currencyUnresolvedTrips, 10);
  assert.equal(conflict.drivers.davi.currencySourceCounts?.CONFLICT, 10);

  const unknown = legacyAggregate("simulator-new");
  assert.ok(unknown);
  assert.deepEqual(unknown.companies.dc.currencyTotals, {});
  assert.equal(unknown.companies.dc.currencyUnresolvedTrips, 0);
});

test("v5 conserva subtotais BRL/EUR separados sem agregá-los em val", () => {
  const mixed = parseRankingAggregateDocument({
    schemaVersion: 5,
    simulatorId: "gto",
    periodType: "mes",
    periodKey: "mes_2026-10",
    periodTimeZone: "America/Sao_Paulo",
    periodPolicy: "SAO_PAULO_CALENDAR",
    complete: true,
    sourceTripCount: 2,
    companies: {
      dc: {
        val: 0,
        trips: 2,
        currencyTotals: { BRL: 100, EUR: 80 },
        currencyTripCounts: { BRL: 1, EUR: 1 },
        currencySourceCounts: { SIMULATOR_REGISTRY: 1, EXPLICIT_FIELD: 1 },
      },
    },
    drivers: {},
  });
  assert.ok(mixed);
  const row = buildCompanyRankingFromAggregate(
    mixed,
    [{ id: "dc", companyName: "DC Transportes", simulatorId: "gto", status: "active" }],
    simulators,
  )[0];
  assert.equal(row?.val, 0);
  assert.deepEqual(row?.currencyBreakdown?.map((item) => [item.currency, item.value]), [["BRL", 100], ["EUR", 80]]);
  assert.deepEqual(row?.currencySourceCounts, { SIMULATOR_REGISTRY: 1, EXPLICIT_FIELD: 1 });
});

test("política e fuso incompatíveis são rejeitados; período correto usa calendário São Paulo", () => {
  const valid = legacyAggregate("gto");
  assert.ok(valid);
  assert.equal(valid.periodKey, "mes_2026-10");
  const wrongPolicy = { ...valid, periodPolicy: "UTC_CALENDAR" };
  const wrongZone = { ...valid, periodTimeZone: "UTC" };
  assert.equal(parseRankingAggregateDocument(wrongPolicy as unknown as Record<string, unknown>), null);
  assert.equal(parseRankingAggregateDocument(wrongZone as unknown as Record<string, unknown>), null);
});

test("Motorista usa a classificação global por ganhos e o concorrente correto", () => {
  const ranking = buildDriverRankingFromAggregate(
    aggregate,
    [],
    companies,
    simulators,
  );
  const summary = summarizeProfileRanking(ranking, "davi");
  assert.equal(summary.position, 4);
  assert.equal(summary.total, 4);
  assert.equal(summary.current?.val, 104873);
  assert.equal(summary.current?.trips, 8);
  assert.equal(summary.next?.id, "ferreira");
  assert.equal(summary.gapToNext, 21380);
  assert.equal(Number(summary.leaderRatio?.toFixed(1)), 16.5);
});
test("Empresa usa ganhos globais reais; não completa concorrentes com zero local", () => {
  const ranking = buildCompanyRankingFromAggregate(
    aggregate,
    companies,
    simulators,
  );
  const summary = summarizeProfileRanking(ranking, "dc");
  assert.equal(summary.position, 4);
  assert.equal(summary.next?.id, "tijoleira");
  assert.equal(summary.gapToNext, 20295);
  assert.equal(Number(summary.leaderRatio?.toFixed(1)), 8.8);
  assert.equal(summary.leader?.val, 1192503);
});
test("Empresas inativas e de outro simulador ficam fora das duas populações", () => {
  const global = buildDriverRankingFromAggregate(
    aggregate,
    [],
    companies,
    simulators,
  );
  const company = buildCompanyRankingFromAggregate(
    aggregate,
    companies,
    simulators,
  );
  assert.ok(!global.some((row) => ["archived", "other"].includes(row.id)));
  assert.ok(!company.some((row) => ["inactive", "other-sim"].includes(row.id)));
});
test("Interno tem a mesma população para perfil e página, incluindo colega sem viagens", () => {
  const params = {
    trips: [
      trip("dc-1", "dc", "davi", 104873),
      trip("dc-2", "dc", "colleague", 150000),
      trip("other", "matecom", "jose", 634600),
    ],
    startDate: range.start,
    endDate: range.end,
    companyId: "dc",
    simulatorId: "gto",
    companies,
    simulators,
    users: [
      { id: "davi", name: "Davi Canto" },
      { id: "colleague", name: "Colega Acima" },
      { id: "zero", name: "Colega Sem Viagens" },
    ],
    companyMembers: ["davi", "colleague", "zero"].map((id) => ({
      userId: id,
      companyId: "dc",
      status: "active",
      roles: ["driver"],
    })),
  };
  const ranking = buildInternalDriverRankingPageData(params);
  assert.deepEqual(
    ranking.map((row) => row.id),
    ["colleague", "davi", "zero"],
  );
  const summary = summarizeProfileRanking(ranking, "davi");
  assert.equal(summary.position, 2);
  assert.equal(summary.gapToNext, 45127);
  const raw = buildDriverRankingPageData({ ...params, scope: "internal" });
  assert.equal(raw.find((row) => row.id === "davi")?.val, summary.current?.val);
  assert.equal(raw.find((row) => row.id === "davi")?.currency, "BRL");
  assert.equal(raw.find((row) => row.id === "davi")?.currencyBreakdown?.[0]?.currencySource, "SIMULATOR_REGISTRY");
  assert.equal(summarizeProfileRanking(ranking, "zero").hasActivity, false);
});
test("Ranking Interno preserva subtotal EUR e fonte do registry para TOE3", () => {
  const euroCompanies = [...companies, { id: "euro-fleet", companyName: "Frota Euro", simulatorId: "toe3", status: "active" }];
  const euroRow = buildDriverRankingPageData({
    trips: [trip("euro-1", "euro-fleet", "davi", 9000, "toe3")],
    startDate: range.start,
    endDate: range.end,
    scope: "internal",
    companyId: "euro-fleet",
    simulatorId: "toe3",
    companies: euroCompanies,
    simulators: [...simulators, { id: "toe3", name: "TOE3" }],
    users: [{ id: "davi", name: "Davi Canto" }],
    companyMembers: [{ userId: "davi", companyId: "euro-fleet", status: "active", role: "driver" }],
  })[0];
  assert.equal(euroRow?.currency, "EUR");
  assert.equal(euroRow?.currencyTotals?.EUR, 9000);
  assert.equal(euroRow?.currencyBreakdown?.[0]?.currencySource, "SIMULATOR_REGISTRY");
});
test("Ranking Interno resolve GTO pelo catálogo quando a viagem só guarda ID opaco", () => {
  const opaqueSimulatorId = "catalog-gto-id-opaque-001";
  const company = { id: "dc", companyName: "DC Transportes", simulatorId: opaqueSimulatorId, status: "active" };
  const row = buildDriverRankingPageData({
    trips: [trip("gto-opaque", "dc", "davi", 125373, opaqueSimulatorId)],
    startDate: range.start,
    endDate: range.end,
    scope: "internal",
    companyId: "dc",
    simulatorId: opaqueSimulatorId,
    companies: [company],
    simulators: [{ id: opaqueSimulatorId, name: "GTO" }],
    users: [{ id: "davi", name: "Davi Canto" }],
    companyMembers: [{ userId: "davi", companyId: "dc", status: "active", role: "driver" }],
  })[0];
  assert.equal(row?.trips, 1);
  assert.equal(row?.currency, "BRL");
  assert.equal(row?.currencyTotals?.BRL, 125373);
  assert.equal(row?.currencyBreakdown?.[0]?.currencySource, "SIMULATOR_REGISTRY");
});
test("Documento de empresa ausente no servidor não reaparece pelo catálogo antigo", () => {
  const confirmed = mergeRankingCompanyCatalogs(
    companies,
    companies.filter((company) => company.id !== "dc"),
    ["dc"],
  );
  assert.ok(!confirmed.some((company) => company.id === "dc"));
  const ranking = buildCompanyRankingFromAggregate(
    aggregate,
    confirmed,
    simulators,
  );
  assert.equal(summarizeProfileRanking(ranking, "dc").current, null);
  assert.deepEqual(
    buildInternalDriverRankingPageData({
      trips: [],
      companyId: "dc",
      companies: confirmed,
    }),
    [],
  );
});
test("Viagens não viram score nem ultrapassam maiores ganhos", () => {
  const changed = structuredClone(aggregate);
  changed.drivers.davi.trips = 2000;
  const ranking = buildDriverRankingFromAggregate(
    changed,
    [],
    companies,
    simulators,
  );
  assert.equal(summarizeProfileRanking(ranking, "davi").position, 4);
});
test("Empate conserva a ordem do ranking e representa diferença financeira zero", () => {
  const summary = summarizeProfileRanking(
    [
      { id: "first", name: "Primeiro", val: 100, trips: 2, currency: "BRL" },
      { id: "second", name: "Segundo", val: 100, trips: 1, currency: "BRL" },
    ],
    "second",
  );
  assert.equal(summary.position, 2);
  assert.equal(summary.gapToNext, 0);
  assert.equal(summary.leaderRatio, 100);
});
test("Vazio, ausente, único participante e ganhos zero não geram NaN", () => {
  assert.equal(summarizeProfileRanking([], "davi").position, null);
  assert.equal(
    summarizeProfileRanking(
      [{ id: "zero", name: "Zero", val: 0, trips: 0 }],
      "zero",
    ).isLeader,
    false,
  );
  const single = summarizeProfileRanking(
    [{ id: "davi", name: "Davi", val: 0, trips: 1 }],
    "davi",
  );
  assert.equal(single.total, 1);
  assert.equal(single.activeParticipants, 1);
  assert.equal(single.leaderRatio, null);
  assert.equal(
    summarizeProfileRanking(
      [{ id: "other", name: "Outro", val: 100, trips: 1 }],
      "davi",
    ).current,
    null,
  );
});
test("Repositório local respeita empresa, motorista, aliases e interseção de escopos", () => {
  assert.equal(
    tripMatchesReadScope(
      { empresaId: "dc", motoristaId: "davi" },
      { companyId: "dc" },
    ),
    true,
  );
  assert.equal(
    tripMatchesReadScope(
      { companyId: "matecom", driverId: "davi" },
      { companyId: "dc" },
    ),
    false,
  );
  assert.equal(
    tripMatchesReadScope(
      { companyId: "dc", driverId: "other" },
      { driverId: "davi" },
    ),
    false,
  );
  assert.equal(
    tripMatchesReadScope(
      { companyId: "dc", driverId: "davi" },
      { companyIds: ["dc", "cocal"], driverId: "davi" },
    ),
    true,
  );
  assert.equal(
    tripMatchesReadScope(
      { companyId: "cocal", driverId: "davi" },
      { companyId: "dc", driverId: "davi" },
    ),
    false,
  );
  assert.equal(
    tripMatchesReadScope({ companyId: "dc", driverId: "davi" }, {}),
    false,
  );
});
test("Outubro compara setembro e histórico mensal começa no mês corrente", () => {
  const previous = resolvePreviousPerformanceInterval(
    "Mês atual",
    range,
    referenceDate,
  );
  assert.equal(previous.start.toISOString(), "2026-09-01T03:00:00.000Z");
  assert.equal(previous.end.toISOString(), "2026-10-01T02:59:59.999Z");
  const history = buildClassificationPeriods("Mensal", referenceDate, 5);
  assert.equal(history[0].start.toISOString(), range.start.toISOString());
  assert.equal(history[1].label, "Set 2026");
  assert.equal(history[4].label, "Jun 2026");
});
test("Personalizado compara o mesmo número de dias no calendário de Brasília", () => {
  const custom = resolvePerformanceInterval(
    "Personalizado",
    { from: new Date(2026, 9, 1), to: new Date(2026, 9, 3) },
    referenceDate,
  );
  const previous = resolvePreviousPerformanceInterval(
    "Personalizado",
    custom,
    referenceDate,
  );
  assert.equal(previous.start.toISOString(), "2026-09-28T03:00:00.000Z");
  assert.equal(previous.end.toISOString(), "2026-10-01T02:59:59.999Z");
  assert.equal(
    previous.end.getTime() - previous.start.getTime(),
    custom.end.getTime() - custom.start.getTime(),
  );
});
test("Calendário de outubro tem 31 dias e viagem noturna pertence a 31/10", () => {
  const late = normalizeTrip({
    id: "late",
    status: "concluida",
    valor: 1,
    completedAt: "2026-11-01T01:30:00Z",
  });
  const calendar = buildProfileActivityCalendar(
    range.start,
    range.end,
    [late],
    referenceDate,
  );
  assert.equal(calendar.length, 31);
  assert.equal(calendar[0].weekday, 4);
  assert.equal(calendar.at(-1)?.key, "2026-10-31");
  assert.equal(calendar.at(-1)?.trips, 1);
  assert.equal(
    rankingCalendarDateKey(new Date("2026-10-01T02:00:00Z")),
    "2026-09-30",
  );
});
console.log(`profile-ranking: ${passed} scenarios passed`);
