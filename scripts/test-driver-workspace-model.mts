import assert from "node:assert/strict";
import { filterAndSortTripHistory } from "../src/lib/tripHistoryEngine.ts";
import { driverDayKey, driverMonthRange, driverMonthOptions, driverResultPeriods, driverDailyResults, groupDriverTripsByDay } from "../src/lib/driverWorkspace.ts";

const raw = [
  { id: "previous", completedAt: "2026-10-01T02:59:59Z", valorCents: 500, currency: "BRL" },
  { id: "first", completedAt: "2026-10-01T03:00:00Z", valorCents: 1001, currency: "BRL" },
  { id: "second", completedAt: "2026-10-01T04:00:00Z", valorCents: 2, currency: "BRL" },
  { id: "eur", completedAt: "2026-10-02T15:00:00Z", valorCents: 2003, currency: "EUR" },
  { id: "unknown", completedAt: "2026-10-03T15:00:00Z", valorCents: 999 },
  { id: "deleted", completedAt: "2026-10-03T15:00:00Z", valorCents: 1000000, currency: "BRL", deleted: true },
  { id: "future", completedAt: "2026-11-01T03:00:00Z", valorCents: 300, currency: "USD" },
].map(trip => ({ status: "completed", driverId: "driver", companyId: "company", ...trip }));
const trips = filterAndSortTripHistory(raw, { periodPreset: "todos" });
assert.equal(trips.length, 6, "Deleted trips are excluded by the existing eligibility policy");
assert.equal(driverDayKey(new Date("2026-10-01T02:59:59Z")), "2026-09-30");
assert.equal(driverDayKey(new Date("2026-10-01T03:00:00Z")), "2026-10-01");
assert.deepEqual(driverMonthRange("2024-02"), { start: "2024-02-01", end: "2024-02-29" });
assert.deepEqual(driverMonthRange("2026-02"), { start: "2026-02-01", end: "2026-02-28" });
assert.equal(driverMonthRange("2026-13"), null);
assert.equal(driverMonthRange("invalid"), null);
const now = new Date("2026-10-17T15:00:00Z");
assert.deepEqual(driverMonthOptions(trips, now).map(item => item.id), ["2026-11", "2026-10", "2026-09"]);
const periods = driverResultPeriods(trips, "mensal", now);
const october = periods.find(item => item.id === "2026-10")!;
assert.equal(october.tripCount, 4);
assert.equal(october.moneyGroups.find(item => item.currency === "BRL")?.value, 10.03, "Centavos are preserved");
assert.equal(october.moneyGroups.find(item => item.currency === "EUR")?.value, 20.03);
assert.equal(october.moneyGroups.find(item => item.currencyStatus !== "known")?.value, null, "Unknown currency is never summed");
assert.equal(october.totalValue, 0, "Different currencies do not produce a misleading combined total");
assert.equal(periods.find(item => item.id === "2026-09")?.tripCount, 1);
const days = driverDailyResults(trips, "mensal", october.sortDate);
assert.deepEqual(days.map(day => day.id), ["2026-10-03", "2026-10-02", "2026-10-01"]);
assert.equal(days.reduce((sum, day) => sum + day.trips.length, 0), october.tripCount);
assert.equal(days[2].moneyGroups[0].value, 10.03);
assert.equal(groupDriverTripsByDay(trips).length, 5);
for (const period of ["mensal", "semanal"] as const) {
  const empty = driverResultPeriods([], period, now);
  assert.equal(empty.length, 1);
  assert.equal(empty[0].tripCount, 0);
  assert.deepEqual(empty[0].moneyGroups, []);
}
const weekly = filterAndSortTripHistory([
  { id: "before", completedAt: "2026-10-11T02:59:59Z", status: "completed" },
  { id: "inside", completedAt: "2026-10-11T03:00:00Z", status: "completed" },
  { id: "end", completedAt: "2026-10-18T02:59:59Z", status: "completed" },
  { id: "after", completedAt: "2026-10-18T03:00:00Z", status: "completed" },
], { periodPreset: "todos" });
assert.deepEqual(driverDailyResults(weekly, "semanal", now).flatMap(day => day.trips.map(trip => trip.id)).sort(), ["end", "inside"]);
console.log("PASS driver-workspace-model: historical periods, São Paulo day/week/month boundaries, centavos, separate currencies, deleted rows and empty states");
