import assert from "node:assert/strict";
import { findLatestConsecutiveProDuplicate } from "../src/lib/proDuplicatePolicy";
import {
  resolveTripTrailerFields,
  resolveTripTrailerName,
} from "../src/lib/tripTrailer";
import {
  filterTombstonedTrips,
  markTripTombstoned,
} from "../src/lib/tripTombstones";

const scope = {
  jobId: "job-1",
  driverId: "driver-1",
  companyId: "company-1",
  simulatorKey: "GTO",
  amountCents: 530000,
};

const candidate = (overrides: Record<string, unknown> = {}) => ({
  id: "trip-1",
  jobId: scope.jobId,
  driverId: scope.driverId,
  companyId: scope.companyId,
  simulatorKey: scope.simulatorKey,
  amountCents: scope.amountCents,
  isValid: true,
  simpleAutomation: true,
  metricDateMs: 2,
  ...overrides,
});

assert.equal(
  findLatestConsecutiveProDuplicate([candidate()], scope)?.id,
  "trip-1",
  "a primeira viagem igual imediatamente anterior deve ser identificada como duplicata",
);
assert.equal(
  findLatestConsecutiveProDuplicate(
    [
      candidate({ id: "older-equal", amountCents: scope.amountCents, metricDateMs: 1 }),
      candidate({ id: "latest-different", amountCents: 420000, metricDateMs: 2 }),
    ],
    scope,
  ),
  null,
  "um valor igual antigo não deve bloquear depois de uma viagem diferente",
);
assert.equal(
  findLatestConsecutiveProDuplicate(
    [candidate({ simpleAutomation: false })],
    scope,
  ),
  null,
  "Print/Max não pode participar da guarda Pro",
);
assert.equal(
  findLatestConsecutiveProDuplicate(
    [candidate({ jobId: "other-job" })],
    scope,
  ),
  null,
  "outra operação não pode participar da guarda",
);

assert.deepEqual(
  resolveTripTrailerFields({
    simulatorKey: "GTO",
    job: { trailerId: "trailer-1" },
    contract: { trailerId: "trailer-2" },
    trailer: { id: "trailer-1", name: "Carreta A" },
  }),
  { reboqueId: "trailer-1", reboqueNome: "Carreta A" },
  "o trailer deve vir do asset resolvido da operação designada",
);
assert.equal(
  resolveTripTrailerName({
    trip: { contratoId: "contract-1", reboqueNome: "" },
    contracts: [{ id: "contract-1", trailerId: "trailer-1" }],
    trailers: [{ id: "trailer-1", name: "Baú 3 eixos" }],
  }),
  "Baú 3 eixos",
  "o card deve resolver o nome pelo contrato da operação quando a viagem não o persistiu",
);
assert.equal(
  resolveTripTrailerName({
    trip: { jobId: "job-1", reboqueId: "trailer-1", reboqueNome: "" },
    jobs: [{ id: "job-1", trailerId: "trailer-1" }],
    trailers: [{ id: "trailer-1", name: "Baú 3 eixos" }],
  }),
  "Baú 3 eixos",
  "o card deve resolver o nome pelo job e catálogo quando só o ID foi persistido",
);
assert.equal(
  resolveTripTrailerName({
    trip: { reboqueNome: "" },
    trailers: [{ id: "trailer-1", name: "Baú 3 eixos" }],
  }),
  "",
  "sem ID nem nome o card não pode inventar um reboque",
);
assert.deepEqual(
  resolveTripTrailerFields({ simulatorKey: "WBDS", trailer: { id: "trailer-1", name: "Carreta A" } }),
  { reboqueId: "", reboqueNome: "" },
  "WBDS deve permanecer sem trailer",
);
assert.deepEqual(
  resolveTripTrailerFields({ simulatorKey: "PBS", trailer: { id: "trailer-1", name: "Carreta A" } }),
  { reboqueId: "", reboqueNome: "" },
  "PBS deve permanecer sem trailer",
);

markTripTombstoned("deleted-trip");
assert.deepEqual(
  filterTombstonedTrips([
    { id: "deleted-trip", valor: 5300 },
    { id: "still-present", valor: 4200 },
  ]),
  [{ id: "still-present", valor: 4200 }],
  "uma viagem confirmadamente excluída não pode voltar de snapshot/cache antigo",
);

console.log("trip-consistency-regressions: PASS trailer propagation, historical trailer fallback, simulator isolation, consecutive duplicate policy");
