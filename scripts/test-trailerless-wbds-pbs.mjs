import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(`[trailerless-wbds-pbs] ${message}`);
};

const resolver = read("src/lib/resolveSimulator.ts");
assert(resolver.includes("export function isTrailerlessSimulator"), "o resolver central deve expor isTrailerlessSimulator");
assert(resolver.includes('aliases.has("wbds")') && resolver.includes('aliases.has("pbs")'), "WBDS e PBS devem ser identificados por aliases canônicos");
assert(resolver.includes("export const simulatorSupportsTrailers"), "a capacidade de reboque deve ter uma API central");

const surfaces = [
  ["src/pages/admin/ManageContract.tsx", "criação/edição de operação"],
  ["src/pages/admin/AssignJob.tsx", "designação de trabalho"],
  ["src/pages/admin/Fleet.tsx", "aba de reboques da frota"],
  ["src/pages/admin/Operations.tsx", "página de operações"],
  ["src/pages/admin/fleet/OperationsTab.tsx", "trabalhos ativos da empresa"],
  ["src/pages/admin/ContractDetailsPage.tsx", "detalhe da operação"],
  ["src/pages/admin/DriverProfileIsolated.tsx", "perfil administrativo do motorista"],
  ["src/pages/driver/Profile.tsx", "perfil próprio do motorista"],
  ["src/pages/driver/Dashboard.tsx", "operação atual do motorista"],
  ["src/pages/driver/RecordTrip.tsx", "lançamento de viagem"],
  ["src/pages/driver/TripHistory.tsx", "histórico de viagens"],
  ["src/components/OperationResultModal.tsx", "resultado da operação"],
];

for (const [relativePath, label] of surfaces) {
  const source = read(relativePath);
  assert(source.includes("isTrailerlessSimulator") || source.includes("showTrailer"), `${label} precisa aplicar a política central de trailer`);
}

const fleet = read("src/pages/admin/Fleet.tsx");
assert(fleet.includes('option.id !== "trailers"'), "Fleet deve esconder a opção Reboques para WBDS/PBS");
assert(fleet.includes("!trailerlessSimulator"), "Fleet deve impedir a montagem direta de TrailersTab");

const manageContract = read("src/pages/admin/ManageContract.tsx");
assert(manageContract.includes("trailerlessSimulator"), "ManageContract deve omitir Reboque Padrão e limpar trailerId");
const assignJob = read("src/pages/admin/AssignJob.tsx");
assert(assignJob.includes("trailerlessSimulator"), "AssignJob deve omitir trailer e limpar trailerId em WBDS/PBS");

for (const relativePath of [
  "src/pages/admin/Operations.tsx",
  "src/pages/admin/fleet/OperationsTab.tsx",
  "src/pages/admin/ContractDetailsPage.tsx",
]) {
  const source = read(relativePath);
  assert(source.includes("!job.trailerlessSimulator") || source.includes("!trailerlessSimulator"), `${relativePath} deve não renderizar trailer em trabalhos WBDS/PBS`);
}

const profile = read("src/pages/driver/Profile.tsx");
assert(profile.includes("jobTrailerlessSimulator"), "o histórico do perfil próprio deve reavaliar o simulador de cada operação");
const isolated = read("src/pages/admin/DriverProfileIsolated.tsx");
assert(isolated.includes("jobTrailerlessSimulator"), "o perfil administrativo deve reavaliar o simulador de cada operação");

const history = read("src/pages/driver/TripHistory.tsx");
assert(history.includes("showTrailer"), "TripHistory deve ocultar Reboque por viagem");
assert(history.includes("selectedTripTrailerlessSimulator"), "o modal do histórico deve ocultar Reboque em WBDS/PBS");

const operationResult = read("src/components/OperationResultModal.tsx");
assert(operationResult.includes("showTrailer"), "OperationResultModal deve receber a capacidade de trailer explicitamente");

console.log("[trailerless-wbds-pbs] PASS: WBDS/PBS não dependem nem exibem reboque nas superfícies auditadas; outros simuladores preservam o fluxo de trailer.");
