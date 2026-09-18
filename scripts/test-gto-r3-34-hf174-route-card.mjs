import fs from "node:fs";

const root = process.cwd();
const servicePath = "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java";
const service = fs.readFileSync(servicePath, "utf8");
const checks = [];
const check = (ok, message) => {
  checks.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"} ${message}`);
};

const selectionStart = service.indexOf("private void beginManualRouteSelection");
const selectionEnd = service.indexOf("private void applyManualRouteSelection", selectionStart);
const selection = selectionStart >= 0 && selectionEnd > selectionStart
  ? service.slice(selectionStart, selectionEnd)
  : "";
const routeSelectorStart = service.indexOf("private void addManualRouteSelector");
const routeSelectorEnd = service.indexOf("private void applyManualFreightReviewField", routeSelectorStart);
const routeSelector = routeSelectorStart >= 0 && routeSelectorEnd > routeSelectorStart
  ? service.slice(routeSelectorStart, routeSelectorEnd)
  : "";
const openStart = service.indexOf("private void openMenu");
const openEnd = service.indexOf("private void populateMenuContents", openStart);
const openMenu = openStart >= 0 && openEnd > openStart ? service.slice(openStart, openEnd) : "";
const alertStart = service.indexOf("private void clearRouteProgressAlert");
const alertEnd = service.indexOf("private void openMenu", alertStart);
const routeAlert = alertStart >= 0 && alertEnd > alertStart ? service.slice(alertStart, alertEnd) : "";
const statusStart = service.indexOf("private String statusLabel");
const statusEnd = service.indexOf("private String freightOptionsToJson", statusStart);
const status = statusStart >= 0 && statusEnd > statusStart ? service.slice(statusStart, statusEnd) : "";

check(selection.includes('putString("selectionConfirmationStatus", "ROUTE_SELECTION_REQUIRED")'),
  "seleção confirmada entra diretamente no estado de rota manual");
check(selection.includes('putString("manualRouteSelectionStep", GtoManualRouteSelectionPolicy.ORIGIN_STEP)'),
  "primeiro passo é sempre Origem");
check(selection.includes('if (menuView != null) refreshMenuContents();') && selection.includes('else openMenu();'),
  "card abre imediatamente após a confirmação do frete");
check(!selection.includes('showStatusChip("Frete identificado. Selecione primeiro a origem da rota."'),
  "mensagem intermediária antiga não é exibida");
check(!routeSelector.includes("Lista fixa e ordenada") && !routeSelector.includes("Nenhuma leitura de"),
  "card não exibe a descrição técnica de lista/OCR");
check(routeSelector.includes("Registre a origem da rota") && routeSelector.includes("Registre o destino da rota"),
  "card exibe os textos amigáveis de Origem e Destino");
check(routeSelector.includes("Etapa 1/2 · Origem")
  && routeSelector.includes("Etapa 2/2 · Destino")
  && routeSelector.includes("manualRouteSelectionStep"),
  "card identifica explicitamente as etapas 1/2 e 2/2");
check(service.includes("manualRouteScrollView")
  && service.includes("GtoSelectionInteractionPolicy.shouldRestoreRouteScroll")
  && service.includes("routeScroll.post(() -> routeScroll.scrollTo(0, restoreScrollY));"),
  "rolagem é preservada no mesmo passo sem reset automático");
check(service.includes("manualRouteScrollView = null")
  && service.includes("manualRouteScrollStep = \"\"")
  && routeSelector.includes("manualRouteScrollStep = step"),
  "rolagem é isolada ao trocar passo, frete ou fechar menu");
check(service.includes("GtoSelectionInteractionPolicy.mayArmFromFreshFreightList")
  && service.includes("before/after transaction")
  && service.includes("semantic/OCR checks still remain required"),
  "primeiro toque usa janela visual recente sem bypass de commit");
check(routeSelector.includes("Origem selecionada: ")
  && routeSelector.includes("selectedOrigin.setBackground")
  && routeSelector.includes("selectedOrigin.setContentDescription"),
  "card mostra a origem selecionada com destaque antes do passo de Destino");
check(routeAlert.includes('"FREIGHT_ROUTE_REQUIRED"') && routeAlert.includes("⚠️ Registre os dados da rota"),
  "alerta de rota usa uma única mensagem persistente");
check(openMenu.includes("ACTION_OUTSIDE") && openMenu.includes("showManualRoutePendingAlert()"),
  "toque fora minimiza o card e mostra o alerta de rota");
check(openMenu.includes("clearManualRoutePendingAlert()"),
  "abrir o card limpa o alerta de rota");
check(status.includes('if (STATE_CONFIRMING_FREIGHT.equals(state) && isManualRouteSelectionPending())')
  && status.includes('return "";'),
  "status técnico do frete fica oculto durante a rota manual");
check(!service.includes("Frete selecionado · revisão necessária"),
  "título de revisão antiga não aparece no card");
check(!service.includes("Lista fixa e ordenada. Nenhuma leitura de destino será usada."),
  "descrição antiga de destino não aparece no card");
check(service.includes('"FREIGHT_SELECTED"') && service.includes("!isManualRouteContractEnabled()"),
  "mensagem antiga só permanece protegida para compatibilidade inativa");

const passed = checks.filter(Boolean).length;
console.log(`${passed}/${checks.length} HF174 route-card checks passed.`);
if (passed !== checks.length) process.exit(1);
