import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relativePath) =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const appContext = read("src/context/AppContext.tsx");
const manager = read("src/components/admin/FleetAssetFolderManager.tsx");
const vehicles = read("src/pages/admin/fleet/VehiclesTab.tsx");
const trailers = read("src/pages/admin/fleet/TrailersTab.tsx");
const contracts = read("src/pages/admin/fleet/ContractsTab.tsx");
const assignJob = read("src/pages/admin/AssignJob.tsx");
const picker = read("src/components/admin/AssignJobAssetPicker.tsx");
const rules = read("firestore.rules");
const driverSources = [
  "src/pages/driver/Dashboard.tsx",
  "src/pages/driver/Profile.tsx",
  "src/layouts/DriverLayout.tsx",
].map(read);

assert.match(appContext, /interface Vehicle[\s\S]*sequenceId\?: string/);
assert.match(appContext, /interface Trailer[\s\S]*sequenceId\?: string/);
assert.match(appContext, /interface Sequence[\s\S]*scope\?: \"operations\" \| \"vehicles\" \| \"trailers\"/);
assert.match(appContext, /createSequence:[\s\S]*Promise<string \| null>/);
assert.match(appContext, /const relatedVehicles = vehicles\.filter/);
assert.match(appContext, /const relatedTrailers = trailers\.filter/);

assert.match(manager, /Criar pasta/);
assert.match(manager, /createAssetLabel/);
assert.match(manager, /assetSingularLabel/);
assert.match(manager, /selectedAsset/);
assert.match(manager, /scope/);
assert.match(manager, /Editar pasta/);
assert.match(manager, /Excluir pasta/);
assert.match(manager, /Editar pasta de/);
assert.doesNotMatch(manager, /Mover para pasta/);
assert.doesNotMatch(manager, /setMoveAssetId/);
assert.match(vehicles, /FleetAssetFolderManager/);
assert.match(vehicles, /scope=\"vehicles\"/);
assert.match(vehicles, /Registrar veículo/);
assert.match(vehicles, /Motorista ativo com operação atual/);
assert.match(vehicles, /resolveCurrentFleetUsageJobs/);
assert.match(vehicles, /renderUsageDetails/);
assert.match(trailers, /FleetAssetFolderManager/);
assert.match(trailers, /scope=\"trailers\"/);
assert.match(trailers, /Registrar reboque/);
assert.match(trailers, /Motorista ativo com operação atual/);
assert.match(trailers, /resolveCurrentFleetUsageJobs/);
assert.match(trailers, /renderUsageDetails/);
assert.match(contracts, /Criar operação/);
assert.match(contracts, /Criar pasta/);
assert.match(contracts, /selectedContractForDrivers/);
assert.match(contracts, /Motoristas atribuídos/);
assert.match(contracts, /scope: \"operations\"/);
assert.match(assignJob, /vehicles=\{availableVehicles\}[\s\S]*sequences=\{sequences\}/);
assert.match(picker, /const vehicleGroups = useMemo/);
assert.match(picker, /vehicle\.sequenceId === sequence\.id/);

for (const source of driverSources) {
  assert.doesNotMatch(source, /FleetAssetFolderManager|createSequence\(|updateSequence\(|deleteSequence\(|Criar pasta|Registrar veículo|Registrar reboque/);
}
assert.match(rules, /match \/sequencias\/\{id\} \{[\s\S]*allow create: if isAuthenticated\(\) &&[\s\S]*request\.resource\.data\.companyId is string[\s\S]*isCompanyManager\(request\.resource\.data\.companyId\)/);
assert.match(rules, /allow update: if isAuthenticated\(\) &&[\s\S]*isCompanyManager\(resource\.data\.companyId\)[\s\S]*request\.resource\.data\.companyId == resource\.data\.companyId/);
assert.match(rules, /allow delete: if isAuthenticated\(\) &&[\s\S]*isCompanyManager\(resource\.data\.companyId\)/);
assert.match(rules, /match \/veiculos\/\{id\} \{[\s\S]*isCompanyManager/);
assert.match(rules, /match \/reboques\/\{id\} \{[\s\S]*isCompanyManager/);

console.log("admin-folder-organization: PASS folder CRUD is administrative; driver remains receive-only");
