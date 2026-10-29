import assert from "node:assert/strict";
import fs from "node:fs";
import { resolve } from "node:path";
import { filterTripsBySimulator, groupMetricsByCompany } from "../src/lib/metricsEngine";
import { buildDriverRankingPageData } from "../src/lib/rankingPageEngine";
import { normalizeTrip } from "../src/lib/tripNormalizer";
import { filterAndSortTripHistory, summarizeTripHistory } from "../src/lib/tripHistoryEngine";
import { buildSimulatorSelectorOptions } from "../src/lib/simulatorOptions";

const root = process.cwd();
const fixturePath = resolve(root, "staging/fixtures/v36.4-multi-company.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
assert.equal(fixture.syntheticOnly, true, "fixture precisa estar marcado como sintético");
assert.equal(fixture.companies.length, 6, "seis empresas sintéticas esperadas");
assert.equal(fixture.drivers.length, 8, "oito motoristas sintéticos esperados");

const companies = fixture.companies;
const simulators = fixture.simulators;
const users = fixture.drivers.map(({ id, name }: { id: string; name: string }) => ({ id, name }));
const companyMembers = fixture.drivers.map((driver: { id: string; companyId: string }) => ({
  userId: driver.id,
  companyId: driver.companyId,
  role: "driver",
  status: "active",
  joinedAt: "2026-01-01T00:00:00.000Z",
}));
const labels: Record<string, string> = {
  gto: "GTO",
  wtds: "WTDS",
  toe3: "TOE 3",
  ats: "ATS",
  ets2: "ETS2",
};
const trips = fixture.trips.map((trip: Record<string, unknown>) => {
  const driver = fixture.drivers.find((item: { id: string }) => item.id === trip.driverId);
  assert.ok(driver, `motorista da fixture não existe: ${trip.driverId}`);
  const company = companies.find((item: { id: string }) => item.id === trip.companyId);
  assert.ok(company, `empresa da fixture não existe: ${trip.companyId}`);
  return normalizeTrip({
    id: String(trip.id),
    tripId: String(trip.id),
    status: "completed",
    deleted: false,
    completedAt: "2026-09-20T12:00:00.000Z",
    createdAt: "2026-09-20T12:00:00.000Z",
    valor: Number(trip.value),
    companyId: String(trip.companyId),
    empresaId: String(trip.companyId),
    empresaNome: company.name,
    driverId: String(trip.driverId),
    motoristaId: String(trip.driverId),
    motoristaNome: driver.name,
    simulatorId: String(trip.simulatorId),
    simulatorName: labels[String(trip.simulatorId)],
  });
});
assert.equal(trips.filter((trip: { isValid: boolean }) => trip.isValid).length, 12);

const selector = buildSimulatorSelectorOptions(simulators, companies);
for (const simulatorId of ["gto", "wtds", "toe3", "ats", "ets2"]) {
  const option = selector.find((item) => item.value === simulatorId || item.aliases.includes(simulatorId));
  assert.ok(option, `simulador ausente no seletor: ${simulatorId}`);
  const selectedTrips = filterTripsBySimulator(trips, simulatorId, companies, simulators);
  assert.equal(selectedTrips.length, simulatorId === "gto" ? 8 : 1, `${simulatorId}: contagem filtrada incorreta`);
  assert.ok(selectedTrips.every((trip: Record<string, unknown>) => trip.simulatorId === simulatorId));
  console.log(`PASS simulator ${simulatorId.toUpperCase()}: selector + filter (${selectedTrips.length} synthetic trip(s))`);
}

const dateRange = {
  startDate: new Date("2026-09-01T00:00:00.000Z"),
  endDate: new Date("2026-09-30T23:59:59.999Z"),
};
const rankingInputs = {
  trips,
  ...dateRange,
  simulatorId: "gto",
  companies,
  simulators,
  users,
  companyMembers,
};
const globalRanking = buildDriverRankingPageData({ ...rankingInputs, scope: "global" });
assert.deepEqual(globalRanking.map((item) => item.id), [
  "driver-aurora-1",
  "driver-boreal-1",
  "driver-aurora-2",
  "driver-boreal-2",
]);
assert.deepEqual(globalRanking.map((item) => item.val), [265, 185, 110, 100]);
assert.equal(globalRanking.length, 4, "ranking global precisa unificar as duas empresas");
console.log("PASS ranking global: 4 synthetic drivers across 2 companies, ordered by earnings");

const companyRankingCatalog = [
  ...companies,
  { id: "company-empty", companyName: "Frota sem viagens", simulatorId: "gto", status: "active" },
  { id: "company-deleted", companyName: "Frota removida", simulatorId: "gto", status: "deleted" },
];
const companyRanking = groupMetricsByCompany(
  trips,
  dateRange.startDate,
  dateRange.endDate,
  "gto",
  companyRankingCatalog,
  simulators,
);
assert.equal(companyRanking.find((item) => item.id === "company-empty")?.trips, 0);
assert.equal(companyRanking.find((item) => item.id === "company-empty")?.val, 0);
assert.equal(companyRanking.some((item) => item.id === "company-deleted"), false);
console.log("PASS company ranking: eligible zero-activity company retained; deleted company excluded");

const auroraRanking = buildDriverRankingPageData({
  ...rankingInputs,
  scope: "internal",
  companyId: "company-aurora",
});
assert.deepEqual(auroraRanking.map((item) => item.id), ["driver-aurora-1", "driver-aurora-2"]);
assert.ok(auroraRanking.every((item) => item.companyId === "company-aurora"));
const borealRanking = buildDriverRankingPageData({
  ...rankingInputs,
  scope: "internal",
  companyId: "company-boreal",
});
assert.deepEqual(borealRanking.map((item) => item.id), ["driver-boreal-1", "driver-boreal-2"]);
assert.ok(borealRanking.every((item) => item.companyId === "company-boreal"));
console.log("PASS internal rankings: companies isolated; no cross-company totals");

for (const driver of fixture.drivers as Array<{ id: string; companyId: string }>) {
  const history = filterAndSortTripHistory(trips, { driverId: driver.id });
  assert.equal(history.length, driver.expectedTripCount, `${driver.id}: contagem do histórico incorreta`);
  assert.ok(history.every((trip) => trip.motoristaId === driver.id));
  assert.ok(history.every((trip) => trip.empresaId === driver.companyId));
  const summary = summarizeTripHistory(history);
  assert.equal(summary.totalViagens, driver.expectedTripCount);
  assert.ok(summary.faturamentoTotal > 0);
}
console.log("PASS driver history: 8 distinct profiles; 12 synthetic trips; company scope preserved");

const seniorPanelCompanies = companies.map((company: { id: string }) => company.id);
assert.equal(seniorPanelCompanies.length, 6);
assert.equal(new Set(companyMembers.map((item: { userId: string }) => item.userId)).size, 8);
console.log("PASS senior panel fixture: 6 companies and 8 active synthetic driver memberships");
console.log("PASS V36.4 staging fixture matrix: 5 simulators, 6 companies, 8 drivers, 12 synthetic trips");
