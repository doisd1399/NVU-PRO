import assert from "node:assert/strict";
import { countFleetAssetUsage, resolveCurrentFleetUsageJobs } from "../src/lib/fleetUsage.ts";

const contracts = [
  {
    id: "contract-a",
    companyId: "company-a",
    trailerId: "trailer-1",
    totalDeliveries: 8,
  },
  {
    id: "contract-b",
    companyId: "company-b",
    trailerId: "trailer-1",
    totalDeliveries: 8,
  },
];

const members = [
  { id: "m1", companyId: "company-a", userId: "driver-1", roles: ["driver"], status: "active" },
  { id: "m2", companyId: "company-a", userId: "driver-2", roles: ["driver"], status: "active" },
  { id: "m3", companyId: "company-a", userId: "driver-3", roles: ["driver"], status: "active" },
  { id: "m4", companyId: "company-a", userId: "driver-4", roles: ["driver"], status: "pending" },
  { id: "m5", companyId: "company-a", userId: "driver-5", roles: ["driver"], status: "rejected" },
  { id: "m6", companyId: "company-a", userId: "driver-6", roles: ["driver"], status: "active" },
  { id: "m7", companyId: "company-b", userId: "driver-7", roles: ["driver"], status: "active" },
  { id: "m8", companyId: "company-a", userId: "driver-8", roles: ["driver"], status: "active" },
  { id: "m9", companyId: "company-a", userId: "driver-10", roles: ["driver"], status: "active" },
];

const jobs = [
  {
    id: "old-driver-1",
    companyId: "company-a",
    driverId: "driver-1",
    vehicleId: "truck-old",
    trailerId: "trailer-old",
    status: "active",
    assignedAt: "2026-09-01T08:00:00.000Z",
  },
  {
    id: "j1",
    companyId: "company-a",
    driverId: "driver-1",
    vehicleId: "truck-1",
    trailerId: "trailer-1",
    status: "active",
    assignedAt: "2026-09-09T08:00:00.000Z",
  },
  {
    id: "j2",
    companyId: "company-a",
    motoristaId: "driver-1",
    vehicle_id: "truck-1",
    trailer_id: "trailer-1",
    status: "pending",
    assignedAt: "2026-09-08T08:00:00.000Z",
  },
  {
    id: "j3",
    companyId: "company-a",
    motorista_id: "driver-2",
    vehicleId: "truck-1",
    trailerId: "trailer-1",
    status: "awaiting_completion",
    progress: 8,
    assignedAt: "2026-09-08T08:00:00.000Z",
  },
  {
    id: "j4",
    companyId: "company-a",
    assignedDriverId: "driver-3",
    vehicleId: "truck-1",
    trailerId: "trailer-1",
    status: "delayed",
    assignedAt: "2026-09-07T08:00:00.000Z",
  },
  {
    id: "j5",
    companyId: "company-a",
    driverId: "driver-4",
    vehicleId: "truck-1",
    trailerId: "trailer-1",
    status: "pending",
    assignedAt: "2026-09-09T07:00:00.000Z",
  },
  {
    id: "j6",
    companyId: "company-a",
    driverId: "driver-5",
    vehicleId: "truck-1",
    trailerId: "trailer-1",
    status: "active",
    assignedAt: "2026-09-09T06:00:00.000Z",
  },
  {
    id: "j7",
    companyId: "company-a",
    driverId: "driver-6",
    vehicleId: "truck-2",
    contractId: "contract-a",
    status: "active",
    assignedAt: "2026-09-09T09:00:00.000Z",
  },
  {
    id: "j8",
    companyId: "company-b",
    driverId: "driver-7",
    vehicleId: "truck-1",
    trailerId: "trailer-1",
    status: "active",
    assignedAt: "2026-09-09T09:00:00.000Z",
  },
  {
    id: "j9",
    companyId: "company-a",
    driverId: "driver-9",
    vehicleId: "truck-1",
    trailerId: "trailer-1",
    status: "active",
    assignedAt: "2026-09-09T09:00:00.000Z",
  },
  {
    id: "j10-pending-only",
    companyId: "company-a",
    driverId: "driver-10",
    vehicleId: "truck-pending",
    trailerId: "trailer-pending",
    status: "pending",
    assignedAt: "2026-09-10T09:00:00.000Z",
  },
];

const count = (assetId, kind, companyId = "company-a") =>
  countFleetAssetUsage({ jobs, members, contracts, assetId, kind, companyId });

assert.equal(
  count("truck-1", "vehicle"),
  2,
  "deve contar somente os membros ativos com atribuição corrente: driver-1 e driver-3",
);
assert.equal(
  count("truck-old", "vehicle"),
  0,
  "uma atribuição antiga do mesmo motorista não pode contar em dois veículos",
);
assert.equal(
  count("truck-2", "vehicle"),
  1,
  "veículo deve contar o membro ativo pelo job correspondente",
);
assert.equal(
  count("trailer-1", "trailer"),
  3,
  "reboque deve considerar vínculos diretos e o vínculo pelo contrato da mesma empresa",
);
assert.equal(
  count("trailer-old", "trailer"),
  0,
  "reboque antigo do mesmo motorista não pode permanecer em uso simultaneamente",
);
assert.equal(
  count("truck-1", "vehicle", "company-b"),
  1,
  "escopo de empresa deve excluir jobs de outra empresa e usar o membro ativo correto",
);
assert.equal(count("missing", "vehicle"), 0, "ativo inexistente deve retornar zero");
assert.equal(
  count("truck-pending", "vehicle"),
  0,
  "atribuição pending não é operação atual e não pode contar como uso",
);
assert.equal(
  count("trailer-pending", "trailer"),
  0,
  "reboque de atribuição pending não é uso atual",
);

const currentJobs = resolveCurrentFleetUsageJobs({
  jobs,
  members,
  contracts,
  companyId: "company-a",
});
assert.deepEqual(
  currentJobs.map((job) => job.id).sort(),
  ["j1", "j4", "j7"].sort(),
  "deve retornar uma atribuição corrente por motorista ativo, excluir pending, órfãos e encerrados",
);

const liveMembers = [
  {
    companyId: "company-live",
    userId: "driver-live",
    roles: ["driver"],
    status: "active",
  },
];
const liveJobs = [
  {
    id: "live-current-operation",
    companyId: "company-live",
    driverId: "driver-live",
    vehicleId: "vehicle-volvo-nh12",
    trailerId: "trailer-bitrem-graneleiro-4",
    status: "active",
    progress: 7,
    assignedAt: "2026-09-10T09:00:00.000Z",
  },
  {
    id: "legacy-fh16-operation",
    companyId: "company-live",
    driverId: "driver-not-current",
    vehicleId: "vehicle-volvo-fh16",
    trailerId: "trailer-rodotrem",
    status: "active",
    assignedAt: "2026-09-09T09:00:00.000Z",
  },
  {
    id: "legacy-scania-operation",
    companyId: "company-live",
    driverId: "driver-not-current-2",
    vehicleId: "vehicle-scania-g",
    trailerId: "trailer-bau-3-eixos",
    status: "active",
    assignedAt: "2026-09-08T09:00:00.000Z",
  },
];

assert.equal(
  countFleetAssetUsage({
    jobs: liveJobs,
    members: liveMembers,
    companyId: "company-live",
    assetId: "vehicle-volvo-nh12",
    kind: "vehicle",
  }),
  1,
  "a operação corrente live deve contar um motorista no Volvo Nh 12",
);
assert.equal(
  countFleetAssetUsage({
    jobs: liveJobs,
    members: liveMembers,
    companyId: "company-live",
    assetId: "trailer-bitrem-graneleiro-4",
    kind: "trailer",
  }),
  1,
  "a operação corrente live deve contar um motorista no Bitrem Graneleiro 4 eixos",
);
assert.equal(
  countFleetAssetUsage({
    jobs: liveJobs,
    members: liveMembers,
    companyId: "company-live",
    assetId: "vehicle-volvo-fh16",
    kind: "vehicle",
  }),
  0,
  "job de outro funcionário não atual não pode aparecer no uso live",
);

console.log(
  "fleet-usage-count: PASS operação corrente live, membros ativos, atribuição corrente, deduplicação, aliases, jobs órfãos, contrato de reboque e escopo de empresa",
);
