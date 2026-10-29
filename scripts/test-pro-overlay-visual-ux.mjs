import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const service = fs.readFileSync(`${root}/android/app/src/main/java/com/nvu/operacional/SimpleAutomationService.java`, "utf8");
const plugin = fs.readFileSync(`${root}/android/app/src/main/java/com/nvu/operacional/SimpleAutomationPlugin.java`, "utf8");
const nativeContract = fs.readFileSync(`${root}/src/lib/simpleAutomationNative.ts`, "utf8");
const completion = fs.readFileSync(`${root}/src/services/simpleAutomationCompletionService.ts`, "utf8");

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

check(service.includes('bubbleProXNorm') && service.includes('bubbleProYNorm'), 'Pro não persiste posição normalizada própria.');
check(service.includes('bubbleGtoXNorm') && service.includes('maxOverlayPreferences'), 'Pro não reutiliza a posição normalizada salva pelo Max quando ainda não possui posição própria.');
check(service.includes('persistPreferredProBubblePosition') && service.includes('rebaseProBubbleLayoutForCurrentDisplay'), 'Pro não possui persistência/rebase seguro da posição.');
check(service.includes('NativeOverlayCardVisibility') && service.includes('cardVisibility.release(previous)'), 'Pro não oculta/restaura o botão por identidade do card.');
check(service.includes('bubbleX + bubbleWidth / 2 - width / 2'), 'Pro não calcula a posição independente do card.');
check(service.includes('adjustProMenuLayoutAfterMeasure'), 'Pro não recalcula o card após a medição real do WindowManager.');
check(service.includes('menuParams.width = width') && service.includes('safeHorizontalInsets'), 'Pro não respeita a largura da área segura.');
check(service.includes('NativeCompactMenuView.bindOutsideDismiss') && service.includes('FLAG_NOT_TOUCH_MODAL'), 'Card Pro não oferece fechamento por toque fora sem bloquear o simulador.');
check(service.includes('menuView.addOnLayoutChangeListener'), 'Pro não reajusta o card quando o WindowManager muda a medida real do conteúdo.');
check(service.includes('FLAG_LAYOUT_IN_SCREEN'), 'Card e botão Pro podem usar espaços de coordenadas diferentes por falta de FLAG_LAYOUT_IN_SCREEN.');
check(service.includes('mainHandler.post(this::adjustProMenuLayoutAfterMeasure)'), 'Pro não agenda o reajuste do card depois de reancorar o botão.');
check(service.includes('int y = GtoOverlayLayoutPolicy.centeredMenuYBesideBubble'), 'Pro não mantém o card dentro da área vertical segura.');
check(!service.includes('moveBubbleAwayFromStatusChip') && service.includes('bubbleCardVisibility.apply'), 'Pro ainda desloca o botão para mostrar mensagens.');
check(fs.readFileSync(`${root}/android/app/src/main/java/com/nvu/operacional/GtoOverlayLayoutPolicy.java`, 'utf8').includes('availableMenuWidthForBubbleSide'), 'Política geométrica não expõe largura lateral disponível.');
check(service.includes('showStatusChip(String text, long durationMs, boolean allowDuringCaptureHidden)'), 'Pro não possui caminho visual para mensagem durante o envio com card oculto.');
check(plugin.includes('showStatusMessage') && plugin.includes('status-message-shown'), 'Plugin não expõe mensagem visual nativa do Pro.');
check(nativeContract.includes('showStatusMessage(input: { message: string; durationMs?: number })'), 'Contrato TypeScript não expõe mensagem visual nativa.');
check(completion.includes('message: "Enviando viagem…"'), 'Completion Pro não informa o início do envio no overlay.');
check(service.includes('addActionRow(target, "Cancelar"') && service.includes('"Finalizar"'), 'Botões Pro não estão uniformes e compactados com textos curtos.');
check(service.includes('private Button infoMenuButton()') && service.includes('Abrir operação atual'), 'Ícone compacto de informações não abre a operação atual.');
check(!service.includes('chooseMenuSideForBubble(\n            bubbleX, bubbleX + bubbleWidth'), 'Pro ainda usa a assinatura incorreta que tratava X direito como largura.');

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("[pro-overlay-visual-ux] PASS");
console.log("[pro-overlay-visual-ux] posição normalizada, ocultação/restauração, mensagens sem sobreposição, botões compactos e bridge visual verificados");
