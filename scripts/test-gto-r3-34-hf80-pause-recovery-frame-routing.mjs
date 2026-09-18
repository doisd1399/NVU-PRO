import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const service = fs.readFileSync(path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java"), "utf8");
const policy = fs.readFileSync(path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoPauseScreenDetectionPolicy.java"), "utf8");

assert.ok(service.includes("boolean pauseRecoveryDuringForegroundLag"), "pause recovery tem rota própria no foreground lag");
assert.ok(service.includes("authorizedCaptureSessionAlive\n                && STATE_CONFIRMING_FREIGHT.equals(getTripState())"), "rota exige sessão MediaProjection autorizada e estado de confirmação");
assert.ok(service.includes("consumePauseRecoveryFrame(reader, callbackAt)"), "frame é consumido pelo pipeline pause-first");
assert.ok(service.includes("fastVisualDetector.analyze(\n                image, image.getWidth(), image.getHeight(), now"), "rota pause executa detector visual real");
assert.ok(service.includes("maybeAnnouncePausePrompt(image, now, hasList)"), "rota pause chama gate/prompt/OCR");
assert.ok(service.includes("schedulePauseScreenOcrIfDue(image, now)"), "OCR é reagendado após miss de um frame");
assert.ok(service.includes("if (pauseScreenDetectedAt > 0L || pausePromptVisible)"), "prompt ativo não cai no intervalo de repetição antes do OCR");
assert.ok(policy.includes('"ajustes"') && policy.includes('"cancelar frete"') && policy.includes('"chamar guincho"') && policy.includes('"voltar ao menu"'), "sinais reais do menu estão cobertos");
assert.ok(!service.includes("pauseRecoveryDuringForegroundLag) {\n                consumeCaptureStabilityFrame(reader)"), "pause não é desviado ao probe genérico");

console.log("PASS HF80: frame do pause não é descartado no foreground lag e a primeira releitura é alcançável.");
