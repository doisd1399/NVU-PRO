import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const servicePath = path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const pausePolicyPath = path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoPauseScreenDetectionPolicy.java");
const selectionPolicyPath = path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoSelectionEvidencePolicy.java");
const pluginPath = path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoObserverPlugin.java");
const typesPath = path.join(root, "src/lib/gtoObserver.ts");
const buildPath = path.join(root, "android/app/build.gradle");

const service = fs.readFileSync(servicePath, "utf8");
const pausePolicy = fs.readFileSync(pausePolicyPath, "utf8");
const selectionPolicy = fs.readFileSync(selectionPolicyPath, "utf8");
const plugin = fs.readFileSync(pluginPath, "utf8");
const types = fs.readFileSync(typesPath, "utf8");
const build = fs.readFileSync(buildPath, "utf8");
const currentVersionCode = Number((build.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const currentVersionName = (build.match(/versionName\s+"([^"]+)"/) || [])[1] || "";

function assertIncludes(source, value, label) {
  assert.ok(source.includes(value), `${label}: esperado ${JSON.stringify(value)}`);
}

assertIncludes(service, "⚠️ Abra o menu do simulador para confirmar os dados do frete.", "alerta exato");
assertIncludes(service, '"PAUSE_ACTION_REQUIRED"', "estágio de ação do pause");
assertIncludes(service, "private void maybeAnnouncePausePrompt(Image image, long now, boolean hasList)", "gatilho do alerta");
assertIncludes(service, "private void schedulePauseScreenOcrIfDue(Image image, long now)", "OCR de tela inteira");
assertIncludes(service, "PAUSE_SCREEN_CONFIRM_FRAMES = 2", "confirmação estável do detector de pause");
assertIncludes(service, "textRecognizer.process(InputImage.fromBitmap(finalBitmap, 0))", "OCR executado no frame de pause");
assertIncludes(service, '"carga", "carga transportada", "mercadoria"', "leitura de carga");
assertIncludes(service, '"origem", "empresa de origem"', "leitura de origem");
assertIncludes(service, '"destino", "cidade de destino", "destino final"', "leitura de destino");
assertIncludes(service, "firstReviewField(freight)", "validação completa dos campos");
assertIncludes(service, 'String source = "pause-menu-open"', "proveniência da abertura do pause");
assertIncludes(service, '"✅ Viagem validada · iniciando a viagem."', "mensagem final do fluxo");

const lockIndex = service.indexOf("if (!GtoAutoTripSync.lockSelectedFreight(this, prefs))", service.indexOf("private void confirmPauseFreight"));
const transitionIndex = service.indexOf("transitionConfirmedFreightToTripInProgress();", lockIndex);
assert.ok(lockIndex >= 0, "o frete do pause precisa passar pelo lock durável");
assert.ok(transitionIndex > lockIndex, "a viagem só pode iniciar depois do lock durável");

assertIncludes(pausePolicy, "return categories >= 2 || (explicitPauseWord && categories >= 1);", "detector conservador de pause");
assertIncludes(selectionPolicy, 's.contains("pause-menu-open")', "abertura explícita do pause como ação humana");
assertIncludes(plugin, 'status.put("pausePromptVisible"', "status nativo do alerta");
assertIncludes(plugin, 'status.put("pauseScreenDetected"', "status nativo da detecção");
assertIncludes(types, "pausePromptVisible?: boolean", "tipo do alerta");
assertIncludes(types, "pauseReadStatus?: string", "tipo do status de leitura");
assert.ok(currentVersionCode >= 177, `versionCode atual do release: ${currentVersionCode}`);
assert.ok(currentVersionName === "1.0.203", `versionName atual do release: ${currentVersionName}`);

console.log("PASS HF68: alerta, detecção de pause, OCR rotulado, validação, lock e transição verificados.");
