import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const service = fs.readFileSync(path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java"), "utf8");
const permissionActivity = fs.readFileSync(path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoProjectionPermissionActivity.java"), "utf8");
const plugin = fs.readFileSync(path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java"), "utf8");
const setup = fs.readFileSync(path.join(root, "src/components/GtoObserverSetup.tsx"), "utf8");
const observerTypes = fs.readFileSync(path.join(root, "src/lib/gtoObserver.ts"), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(service.includes('return "Selecione um trabalho";'), "A mensagem pública da lista não foi substituída por Selecione um trabalho.");
assert(service.includes('private String freightListDetectedMessage(int rowCount)'), "O emissor central da mensagem da lista não existe.");
assert(service.includes('return "Selecione um trabalho";') && !service.includes('return "Lista de fretes detectada ✓ · " + freightOptionCountLabel(rowCount) + ".";'), "Ainda existe mensagem pública com quantidade de opções.");
assert(service.includes('// Operação atual é um painel permanente de acompanhamento.'), "O card não documenta a disponibilidade permanente da operação atual.");
assert(service.includes('if (!operationActionAdded) {'), "O botão Operação atual não é adicionado fora da viagem ativa/lista.");
assert(!service.includes('if (!operationActionAdded && !routeBoundary)'), "O card ainda oculta Operação atual na fronteira de nova lista.");
assert(service.includes('return promoteReplacementFreightCandidateToWaiting(fastHumanBoundary);'), "A lista confirmada não promove a sessão para WAITING_FREIGHT.");
assert(!service.includes('freightListIsInformationalOnly(\n                activeState, exactAcceptTouchConfirmed\n            )'), "A lista reaberta ainda pode ser tratada apenas como informativa.");
assert(service.includes('Button selectedOrigin = menuButton("Origem: " + selectedOriginValue);'), "A origem ainda exibe o texto Selecionada.");
assert(service.includes('putString("manualRouteSelectionStep", GtoManualRouteSelectionPolicy.ORIGIN_STEP)'), "A origem selecionada não pode ser reaberta para correção.");
assert(service.includes('consentHandoffPending'), "O retorno do consentimento não possui barreira de handoff.");
assert(service.includes('if (!projectionActive && (projectionPermissionAfterGtoOpenPending || consentHandoffPending)) return;'), "O serviço ainda pode marcar reautorização durante o handoff do consentimento.");
assert(permissionActivity.includes('putBoolean("projectionPermissionInFlight", true)'), "O callback de autorização não arma o handoff.");
assert(permissionActivity.includes('putLong("projectionConsentResultAt", resultAt)'), "O callback não registra a janela de handoff.");
assert(plugin.includes('status.put("projectionSessionBound"'), "O status não expõe a sessão vinculada à Web.");
assert(plugin.includes('status.put("projectionSurfacePending"'), "O status não expõe a superfície pendente à Web.");
assert(plugin.includes('status.put("projectionGrantValidated"'), "O status não expõe o grant validado à Web.");
assert(observerTypes.includes('projectionGrantValidated?: boolean;'), "O tipo Web não possui projectionGrantValidated.");
assert(setup.includes('!status.projectionSurfacePending') && setup.includes('!status.projectionGrantValidated'), "A Web ainda mostra reautorização enquanto o grant está sendo vinculado.");

console.log("GTO HF208 route/recovery UI contract: PASS");
console.log("- authorization handoff is protected");
console.log("- new freight list discards previous route boundary");
console.log("- public list message is Selecione um trabalho");
console.log("- operation action remains available at freight boundary");
console.log("- selected origin can be changed");
console.log("- Web hides stale reauthorization during accepted grant handoff");
