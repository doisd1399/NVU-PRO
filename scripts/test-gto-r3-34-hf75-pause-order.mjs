import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");

const reviewStart = service.indexOf("private void enterFreightReview");
const reviewEnd = service.indexOf("private void clearManualReviewStageForPauseRecovery", reviewStart);
const review = service.slice(reviewStart, reviewEnd);
assert.ok(review.includes("if (isPauseRecoveryField(required))"), "campos críticos devem entrar no pause");
assert.ok(review.includes("clearManualReviewStageForPauseRecovery()"), "estágio manual antigo deve ser removido");
assert.ok(review.includes('putBoolean("pauseManualFallbackAllowed", false)'), "manual deve iniciar bloqueado");
assert.ok(review.indexOf("clearManualReviewStageForPauseRecovery") < review.indexOf("FREIGHT_REVIEW_REQUIRED"), "pause deve preceder revisão manual");

const pauseStart = service.indexOf("private void maybeAnnouncePausePrompt");
const pauseEnd = service.indexOf("private void clearPauseReadState", pauseStart);
const pause = service.slice(pauseStart, pauseEnd);
assert.ok(pause.includes('"PAUSE_ACTION_REQUIRED"'), "alerta de pause deve ser o primeiro estágio");
assert.ok(pause.includes("playPauseActionVoice"), "áudio deve acompanhar o alerta de pause");
assert.ok(pause.includes("firstPromptEmission"), "áudio não deve repetir a cada frame");

const frameStart = service.indexOf("private void onImageAvailable");
const frameEnd = service.indexOf("private boolean isCurrentAnalysisOcr", frameStart);
const frame = service.slice(frameStart, frameEnd);
assert.ok(frame.includes("pauseRecoveryFlow"), "CONFIRMING_FREIGHT deve entrar no fluxo pause");
assert.ok(frame.includes("maybeAnnouncePausePrompt(image, now, currentFreightListVisible)"), "frame pipeline deve emitir o alerta gated");
assert.ok(frame.includes("generic review/OCR path that previously exposed manual entry first"), "fluxo genérico deve ser bloqueado durante recuperação");
assert.ok(frame.indexOf("pauseRecoveryFlow") < frame.indexOf("long interval = analysisIntervalForState"), "pause deve ocorrer antes do OCR/revisão genérico");

const manualStart = service.indexOf("private void applyManualFreightReviewField");
const manualEnd = service.indexOf("private void commitReviewedFreight", manualStart);
const manual = service.slice(manualStart, manualEnd);
assert.ok(manual.includes("pauseManualFallbackAllowed"), "manual deve exigir fallback armado");
assert.ok(manual.includes("Prioridade: abra o menu de pause"), "manual precoce deve ser bloqueado");
assert.ok(service.includes("PAUSE_OCR_MANUAL_FALLBACK_ATTEMPTS"), "fallback deve depender de tentativas OCR");
assert.ok(service.includes("PAUSE_OCR_MANUAL_FALLBACK_AFTER_MS"), "fallback deve depender de tempo OCR");

console.log("PASS HF75: ordem alerta+áudio → pause OCR → fallback manual verificada.");
