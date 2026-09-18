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
check(service.includes('bubbleXBeforeMenuOpen') && service.includes('restoreBubbleAfterMenu'), 'Pro não restaura a posição após docking temporário do card.');
check(service.includes('chooseMenuSideForBubble(\n            bubbleX, bubbleWidth, menuWidth'), 'Pro não usa a assinatura correta da política geométrica do Max.');
check(service.includes('adjustProMenuLayoutAfterMeasure'), 'Pro não recalcula o card após a medição real do WindowManager.');
check(service.includes('availableMenuWidthForBubbleSide') && service.includes('menuParams.width = targetWidth'), 'Pro não limita a largura do card ao espaço lateral disponível.');
check(service.includes('GtoOverlayLayoutPolicy.overlaps'), 'Pro não mantém uma verificação final contra sobreposição do card e do botão.');
check(service.includes('menuView.addOnLayoutChangeListener'), 'Pro não reajusta o card quando o WindowManager muda a medida real do conteúdo.');
check(service.includes('FLAG_LAYOUT_IN_SCREEN'), 'Card e botão Pro podem usar espaços de coordenadas diferentes por falta de FLAG_LAYOUT_IN_SCREEN.');
check(service.includes('mainHandler.post(this::adjustProMenuLayoutAfterMeasure)'), 'Pro não agenda o reajuste do card depois de reancorar o botão.');
check(service.includes('int baseAnchoredY = GtoOverlayLayoutPolicy.centeredMenuYBesideBubble'), 'Pro não ancora verticalmente o card ao botão após a medição.');
check(service.includes('moveBubbleAwayFromStatusChip') && service.includes('restoreBubbleAfterStatusMessage'), 'Pro não reserva a faixa da mensagem nem restaura o bubble depois.');
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
console.log("[pro-overlay-visual-ux] posição normalizada, docking/restauração, mensagens sem sobreposição, botões compactos e bridge visual verificados");
