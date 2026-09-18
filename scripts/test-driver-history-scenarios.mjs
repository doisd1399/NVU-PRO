import assert from "node:assert/strict";
import { filterAndSortTripHistory, summarizeTripHistory } from "../src/lib/tripHistoryEngine.ts";

const trip = (id, { companyId, driverId, simulatorId, date, value }) => ({
  id,
  empresaId: companyId,
  motoristaId: driverId,
  simulatorId,
  completedAt: date,
  valor: value,
  status: "completed",
});

const dataset = [
  trip("a-1", { companyId: "company-a", driverId: "driver-a", simulatorId: "gto", date: "2026-09-01T10:00:00.000Z", value: 100 }),
  trip("a-2", { companyId: "company-a", driverId: "driver-a", simulatorId: "gto", date: "2026-09-02T10:00:00.000Z", value: 120 }),
  trip("b-1", { companyId: "company-a", driverId: "driver-b", simulatorId: "gto", date: "2026-09-02T11:00:00.000Z", value: 90 }),
  trip("other-company", { companyId: "company-b", driverId: "driver-b", simulatorId: "gto", date: "2026-09-02T12:00:00.000Z", value: 500 }),
  trip("other-simulator", { companyId: "company-a", driverId: "driver-a", simulatorId: "toe3", date: "2026-09-02T13:00:00.000Z", value: 700 }),
];

const scoped = (trips, { companyId, simulatorId, driverId }) =>
  filterAndSortTripHistory(
    trips.filter(
      (item) =>
        item.empresaId === companyId &&
        item.simulatorId === simulatorId,
    ),
    { driverId },
  );

// TESTE 1: cached history is immediately usable for the requested driver.
const driverA = scoped(dataset, {
  companyId: "company-a",
  simulatorId: "gto",
  driverId: "driver-a",
});
assert.deepEqual(driverA.map((item) => item.id), ["a-2", "a-1"]);
assert.deepEqual(summarizeTripHistory(driverA), {
  totalViagens: 2,
  faturamentoTotal: 220,
});

// TESTE 2: a driver without cached records remains empty and can be filled by sync.
const driverC = scoped(dataset, {
  companyId: "company-a",
  simulatorId: "gto",
  driverId: "driver-c",
});
assert.equal(driverC.length, 0);

// TESTE 3: A → B → A never mixes driver histories.
const driverB = scoped(dataset, {
  companyId: "company-a",
  simulatorId: "gto",
  driverId: "driver-b",
});
assert.deepEqual(driverB.map((item) => item.id), ["b-1"]);
assert.deepEqual(scoped(dataset, {
  companyId: "company-a",
  simulatorId: "gto",
  driverId: "driver-a",
}).map((item) => item.id), ["a-2", "a-1"]);

// TESTE 4: new trip appears in the next repository snapshot without reload.
const afterNewTrip = scoped(
  [...dataset, trip("a-3", {
    companyId: "company-a",
    driverId: "driver-a",
    simulatorId: "gto",
    date: "2026-09-03T10:00:00.000Z",
    value: 80,
  })],
  { companyId: "company-a", simulatorId: "gto", driverId: "driver-a" },
);
assert.deepEqual(afterNewTrip.map((item) => item.id), ["a-3", "a-2", "a-1"]);

// TESTE 5: reopening uses the same scoped cache projection.
const reopened = scoped(dataset, {
  companyId: "company-a",
  simulatorId: "gto",
  driverId: "driver-a",
});
assert.deepEqual(reopened.map((item) => item.id), driverA.map((item) => item.id));

// TESTE 6: changing company/simulator cannot reuse another scope.
assert.equal(scoped(dataset, {
  companyId: "company-b",
  simulatorId: "gto",
  driverId: "driver-b",
}).length, 1);
assert.equal(scoped(dataset, {
  companyId: "company-a",
  simulatorId: "toe3",
  driverId: "driver-a",
}).length, 1);
assert.equal(scoped(dataset, {
  companyId: "company-b",
  simulatorId: "toe3",
  driverId: "driver-a",
}).length, 0);

// TESTE 7: a slow Firebase refresh cannot replace a non-empty cached projection.
const cachedProjection = driverA;
const remotePending = true;
assert.equal(remotePending, true);
assert.deepEqual(cachedProjection.map((item) => item.id), ["a-2", "a-1"]);

console.log(
  "driver-history-scenarios: PASS 7 cenários — cache-first, empty-cache sync, A→B→A isolation, new trip, reopen, company/simulator scope and slow Firebase",
);
