import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(`[simple-automation] ${message}`);
};

const simple = read("src/lib/simpleAutomation.ts");
const selector = read("src/components/driver/SimpleCitySelector.tsx");
const manager = read("src/components/admin/SimpleCityManagerModal.tsx");
const nativeService = read("android/app/src/main/java/com/nvu/operacional/SimpleAutomationService.java");
const nativePlugin = read("android/app/src/main/java/com/nvu/operacional/SimpleAutomationPlugin.java");
const dashboard = read("src/pages/driver/Dashboard.tsx");
const driverLayout = read("src/layouts/DriverLayout.tsx");
const profile = read("src/pages/driver/Profile.tsx");
const rules = read("firestore.rules");
const receipt = read("src/services/simpleAutomationReceiptPolicy.ts");

for (const key of ["wtds", "wbds", "toe-3", "global-truck"]) {
  assert(simple.includes(`key: "${key}"`), `simulador ${key} não está no registro simples`);
}
assert(simple.includes("com.dynamicgames.worldtruckdrivingsimulator"), "package WTDS ausente");
assert(simple.includes("com.dynamicgames.worldbusdrivingsimulator"), "package WBDS ausente");
assert(simple.includes("com.WandaSoftware.TruckersofEurope3"), "package TOE 3 ausente");
assert(simple.includes("com.stargamesapps.gto"), "package Global Truck ausente");
assert(simple.indexOf('key: "wtds"') !== simple.indexOf('key: "wbds"'), "WTDS/WBDS foram mesclados");
assert(!simple.includes('key: "pbs"'), "PBS entrou antes da etapa aprovada");

assert(selector.includes("simpleCityInitials"), "seletor não constrói iniciais a partir das cidades");
assert(selector.includes("grid-cols-[1.75rem_minmax(0,1fr)]"), "iniciais não ficam em coluna compacta própria à esquerda");
assert(selector.includes("aria-pressed"), "filtro alfabético não tem estado acessível");
assert(manager.includes("simple_automation_cities"), "gerenciador não usa coleção isolada");
assert(manager.includes("Editar") || manager.includes("handleStartEdit"), "gerenciador não possui edição");
assert(manager.includes("Remover") || manager.includes("handleRemove"), "gerenciador não possui remoção");

assert(nativeService.includes("STATE_ROUTE_ORIGIN"), "serviço simples não tem origem");
assert(nativeService.includes("STATE_ROUTE_DESTINATION"), "serviço simples não tem destino");
assert(nativeService.includes("STATE_TRIP_ACTIVE"), "serviço simples não tem viagem ativa");
assert(nativeService.includes("ACTION_START_CAPTURE"), "finalização simples não arma captura explícita");
assert(!nativeService.includes("GtoObserverService"), "serviço simples depende do GtoObserverService");
assert(!nativeService.includes("UsageStatsManager"), "modo simples depende de Usage Access");
assert(nativePlugin.includes("ALLOWED_PACKAGES"), "plugin simples não usa allowlist");
assert(nativePlugin.includes("openSimulator"), "plugin simples não possui abertura controlada");

assert(dashboard.includes("isSimpleAutomationWork"), "Dashboard não possui branch simples");
assert(dashboard.includes("getSimpleAutomationSimulator(currentCompany, simulators as unknown[])"), "Dashboard não resolve o simulador pelo catálogo");
assert(dashboard.includes("const isGtoWork"), "Dashboard não possui decisão explícita de GTO");
assert(dashboard.includes("const isSimpleAutomationWork"), "Dashboard não possui decisão explícita de automático sem projeção");
assert(dashboard.includes("launchSimpleAutomation"), "Dashboard não chama o launcher simples");
assert(dashboard.includes("GtoWorkModeDialog"), "fluxo GTO foi removido ao adicionar modo simples");
assert(driverLayout.includes("SimpleAutomationCompletionBridge"), "retorno da captura simples não está ligado ao layout persistente do motorista");
assert(!dashboard.includes("SimpleAutomationCompletionBridge"), "Dashboard não deve montar um segundo bridge");
assert(profile.includes("GtoWorkModeDialog"), "Profile não exibe o diálogo matricial de modos");
assert(profile.includes('variant={isGtoWork ? "gto" : "simple"}'), "Profile não seleciona a variante correta do diálogo");
assert(profile.includes("getSimpleAutomationSimulator(currentActiveCompany, simulators as unknown[])"), "Profile não resolve o simulador pelo catálogo");
assert(profile.includes("launchSimpleAutomation"), "Profile não chama o launcher simples");

assert(rules.includes("match /simple_automation_cities/{simulatorKey}"), "regras da coleção simples ausentes");
assert(rules.includes("allow read: if isAuthenticated();"), "leitura simples não está limitada à sessão autenticada");
assert(rules.includes("canManageSimpleCities"), "mutação simples não tem função de autorização");
assert(receipt.includes("simpleReceiptTextHasAdBonus") || receipt.includes("DOBRAR"), "política anti-ADS ausente");
assert(receipt.includes('"reject"') && receipt.includes("hasRewardedValue"), "política não possui rejeição segura");

console.log("[simple-automation] isolation and contract gates passed");
