import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const native = fs.readFileSync(`${root}android/app/src/main/java/com/nvu/operacional/SimpleAutomationService.java`, "utf8");
const completion = fs.readFileSync(`${root}src/services/simpleAutomationCompletionService.ts`, "utf8");
const repository = fs.readFileSync(`${root}src/repositories/TripsRepository.ts`, "utf8");

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(native.includes("CAPTURE_MAX_OCR_ATTEMPTS = 2"), "native OCR deve ter no máximo um retry de frame vazio");
assert(native.includes("boolean readable = ocrText != null && !ocrText.trim().isEmpty()"), "handoff nativo deve ocorrer no primeiro OCR legível");
assert(!native.includes("boolean ready = isLikelyResultReceiptText(ocrText)"), "native não pode esperar marker semântico específico do simulador");
assert(completion.includes("capturedSimulatorKey"), "simulador deve vir do snapshot nativo");
assert(completion.includes("operationWillClose") && completion.includes("deferOperationReconciliation: !operationWillClose"), "reconciliação deve permanecer fora do caminho crítico, exceto no fechamento terminal");
assert(completion.includes("void SimpleAutomation.showStatusMessage"), "feedback visual não pode ser aguardado antes do addDoc");
assert(completion.includes("void SimpleAutomation.refreshOperationSnapshot") || completion.includes("void SimpleAutomation.refreshOperationState"), "refresh do overlay não pode bloquear o acknowledge");

const stateStart = repository.indexOf("static async readAuthoritativeOperationState");
const stateEnd = repository.indexOf("static async syncJobProgress", stateStart);
assert(stateStart >= 0 && stateEnd > stateStart, "método de estado autoritativo deve existir");
const stateBody = repository.slice(stateStart, stateEnd);
assert(!stateBody.includes("historico_viagens"), "preflight Pro não pode enumerar histórico antes do addDoc");
assert(stateBody.includes("jobData.progress"), "preflight deve usar progresso do trabalho como autoridade rápida");

console.log("pro-post-capture-fastpath: PASS native handoff, snapshot simulator, lightweight preflight and terminal-aware UX/reconciliation");
