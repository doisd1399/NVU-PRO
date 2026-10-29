import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildCompanyRankingFromAggregate,
  buildDriverRankingFromAggregate,
  parseRankingAggregateDocument,
  RANKING_AGGREGATE_PERIOD_POLICY,
  RANKING_AGGREGATE_TIME_ZONE,
} from "../src/lib/rankingAggregates.ts";
import { buildRankingUtcPeriodKey, getRankingUtcMonthlyRange } from "../src/lib/rankingPeriods.ts";
import { isWorkModeAllowed, normalizeWorkModeAvailability } from "../src/lib/workModeAvailability.ts";

const root = new URL("..", import.meta.url).pathname;
const read = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

const backendBundles = [
  "ensureRankingAggregates_v15",
  "registerGtoTrip_v18",
  "syncGtoTripState_v10",
  "authenticateSeniorAccess_v10",
];
for (const bundle of backendBundles) {
  const aggregate = read(`backend_source/source_bundles/${bundle}/src/rankingAggregates.ts`);
  const calendar = read(`backend_source/source_bundles/${bundle}/src/rankingCalendar.ts`);
  assert.match(aggregate, /const SCHEMA_VERSION = 4;/, `${bundle}: schema v4`);
  assert.match(calendar, /RANKING_TIME_ZONE = "America\/Sao_Paulo"/, `${bundle}: timezone`);
  assert.match(calendar, /RANKING_PERIOD_POLICY = "SAO_PAULO_CALENDAR"/, `${bundle}: period policy`);
  assert.match(aggregate, /periodTimeZone: RANKING_TIME_ZONE/, `${bundle}: persisted timezone`);
  assert.match(aggregate, /periodPolicy: RANKING_PERIOD_POLICY/, `${bundle}: persisted policy`);
  assert.match(aggregate, /updateRankingAggregatesOnTripWrite/, `${bundle}: trip trigger`);
  assert.match(aggregate, /updateRankingAggregatesOnCompanyWrite/, `${bundle}: company trigger`);
  assert.match(aggregate, /updateRankingAggregatesOnSimulatorWrite/, `${bundle}: simulator trigger`);
}

const workModeBackend = read("backend_source/source_bundles/suspendSeniorAccount_v4/src/workModeAvailability.ts");
assert.match(workModeBackend, /onCall\(async \(data, context\)/, "WorkMode must be callable");
assert.match(workModeBackend, /"ets2", "ats", "pbs"/, "Print matrix must match client simulator catalog");
const workModeClient = read("src/services/workModeAvailabilityService.ts");
assert.doesNotMatch(workModeClient, /runTransaction\(/, "client must not write WorkMode directly to Firestore");
assert.match(workModeClient, /httpsCallable[\s\S]*updateWorkModeAvailability/, "client must use the WorkMode callable");
assert.match(read("firestore.rules"), /match \/settings\/{settingId}[\s\S]*allow create, update: if false;/, "settings writes must be denied to clients");

const senior = read("src/services/seniorAccountAdministrationService.ts");
assert.doesNotMatch(senior, /suspendSeniorAccount[^\n]*companyId\?/, "suspend wrapper companyId required");
assert.doesNotMatch(senior, /reactivateSeniorAccount[^\n]*companyId\?/, "reactivate wrapper companyId required");
assert.doesNotMatch(senior, /deleteSeniorProfile[^\n]*companyId\?/, "delete wrapper companyId required");
for (const method of ["suspendSeniorAccount", "reactivateSeniorAccount", "deleteSeniorProfile"]) {
  const methodBlock = senior.slice(senior.indexOf(`export const ${method}`), senior.indexOf("\nexport const", senior.indexOf(`export const ${method}`) + 1) === -1 ? undefined : senior.indexOf("\nexport const", senior.indexOf(`export const ${method}`) + 1));
  assert.match(methodBlock, /companyId/, `${method}: companyId payload`);
}

const monthBoundary = new Date("2026-09-01T01:16:10.000Z");
const monthly = getRankingUtcMonthlyRange(monthBoundary);
assert.equal(monthly.start.toISOString(), "2026-08-01T03:00:00.000Z");
assert.equal(monthly.end.toISOString(), "2026-09-01T02:59:59.999Z");
assert.equal(buildRankingUtcPeriodKey("mes", monthBoundary), "mes_2026-08");

const aggregateFixture = {
  schemaVersion: 4,
  simulatorId: "gto",
  periodType: "mes",
  periodKey: "mes_2026-08",
  periodTimeZone: RANKING_AGGREGATE_TIME_ZONE,
  periodPolicy: RANKING_AGGREGATE_PERIOD_POLICY,
  periodClosed: true,
  complete: true,
  sourceTripCount: 3,
  companies: {
    "company-1": { trips: 2, val: 300, name: "Frota A" },
    "company-2": { trips: 1, val: 50, name: "Frota B" },
    "company-inactive": { trips: 99, val: 999, name: "Inativa" },
  },
  drivers: {
    "driver-1": { trips: 2, val: 300, companyId: "company-1", name: "Motorista Um" },
    "driver-2": { trips: 1, val: 50, companyId: "company-2", name: "Motorista Dois" },
  },
};
const aggregate = parseRankingAggregateDocument(aggregateFixture);
assert.ok(aggregate, "schema v4 São Paulo deve ser aceito pelo cliente");
assert.equal(parseRankingAggregateDocument({ ...aggregateFixture, periodTimeZone: "UTC", periodPolicy: "UTC_CALENDAR" }), null, "agregado UTC não pode ser consumido pelo cliente V30");

const companies = [
  { id: "company-1", companyName: "Frota A", status: "active", simulatorId: "gto" },
  { id: "company-2", companyName: "Frota B", status: "approved", simulatorId: "gto" },
  { id: "company-inactive", companyName: "Inativa", status: "deleted", simulatorId: "gto" },
];
const simulators = [{ id: "gto", name: "Global Truck Online" }];
const companyRanking = buildCompanyRankingFromAggregate(aggregate, companies, simulators);
assert.deepEqual(companyRanking.map(({ id, trips, val }) => ({ id, trips, val })), [
  { id: "company-1", trips: 2, val: 300 },
  { id: "company-2", trips: 1, val: 50 },
], "ranking global entre empresas deve exibir empresas, viagens e ganhos");
const driverRanking = buildDriverRankingFromAggregate(
  aggregate,
  [
    { id: "driver-1", name: "Motorista Um", companyId: "company-1" },
    { id: "driver-2", name: "Motorista Dois", companyId: "company-2" },
  ],
  companies,
  simulators,
  [
    { userId: "driver-1", companyId: "company-1", role: "driver", roles: ["driver"], status: "active", joinedAt: "2026-01-01" },
    { userId: "driver-2", companyId: "company-2", role: "driver", roles: ["driver"], status: "active", joinedAt: "2026-01-01" },
  ],
);
assert.deepEqual(driverRanking.map(({ id, trips, val, companyId }) => ({ id, trips, val, companyId })), [
  { id: "driver-1", trips: 2, val: 300, companyId: "company-1" },
  { id: "driver-2", trips: 1, val: 50, companyId: "company-2" },
], "ranking de motoristas deve exibir motoristas, viagens, ganhos e empresa");
assert.deepEqual(
  driverRanking.filter((entry) => entry.companyId === "company-1").map((entry) => entry.id),
  ["driver-1"],
  "ranking entre empresas deve respeitar o escopo da empresa selecionada",
);

const matrix = normalizeWorkModeAvailability({
  version: 7,
  print: { enabled: true, simulators: { gto: false } },
  pro: { enabled: false },
  max: { enabled: true },
});
assert.equal(isWorkModeAllowed(matrix, "print", "GTO"), false, "maintenance deve bloquear Print");
assert.equal(isWorkModeAllowed(matrix, "pro", "GTO"), false, "maintenance deve bloquear Pro");
assert.equal(isWorkModeAllowed(matrix, "max", "GTO"), true, "Max deve permanecer operacional quando liberado");

console.log("etapa29-reconciliation-contract: PASS ranking v4/Sao Paulo, global/company scopes, WorkMode callable matrix, Senior contracts");
