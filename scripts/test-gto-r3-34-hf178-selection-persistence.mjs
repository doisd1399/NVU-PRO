import fs from "node:fs";
import assert from "node:assert/strict";

const root = new URL("..", import.meta.url).pathname;
const servicePath = `${root}android/app/src/main/java/com/nvu/operacional/GtoObserverService.java`;
const policyPath = `${root}android/app/src/main/java/com/nvu/operacional/GtoSelectionInteractionPolicy.java`;
const service = fs.readFileSync(servicePath, "utf8");
const policy = fs.readFileSync(policyPath, "utf8");

const outsideStart = service.indexOf("private void handleOutsideTouch(");
assert.ok(outsideStart >= 0, "handleOutsideTouch deve existir");
const outsideEnd = service.indexOf("\n    private boolean confirmFreightAfterListExit", outsideStart);
assert.ok(outsideEnd > outsideStart, "bloco de ACTION_OUTSIDE deve ser delimitável");
const outside = service.slice(outsideStart, outsideEnd);

assert.ok(
  outside.includes("STATE_WAITING_FREIGHT.equals(state)")
    && outside.includes("lastFreightListSeenAt"),
  "o caminho deve reconhecer uma lista recente"
);
assert.match(outside, /armFastTouchPulseOnCaptureThread\(rawX, rawY, alternateX, alternateY\)/,
  "o primeiro toque deve armar a correlação nativa no mesmo evento");
assert.match(outside, /armSelectionProbe\(lastOutsideTouchAt\)/,
  "o primeiro toque deve armar a prova visual antes/depois");
assert.match(outside, /touch alone never confirms a row|toque.*nunca confirma/i,
  "o comentário/contrato deve preservar confirmação fail-closed");

const pulseStart = service.indexOf("private void armFastTouchPulseOnCaptureThread(float rawX");
const pulseEnd = service.indexOf("\n    private void clearFastTouchPulse", pulseStart);
assert.ok(pulseEnd > pulseStart, "pulso rápido deve ser delimitável");
const pulse = service.slice(pulseStart, pulseEnd);
assert.match(pulse, /STATE_WAITING_FREIGHT\.equals\(getTripState\(\)\)/,
  "pulso continua limitado ao estado de seleção inicial");
assert.match(pulse, /replacePendingSelectionTransaction\(transaction\)/,
  "candidato de toque exato deve gerar transação imutável pendente");

const commitStart = service.indexOf("private void commitVisualSelectedRow(");
const commitEnd = service.indexOf("\n    private void clearSelectionProbe", commitStart);
assert.ok(commitEnd > commitStart, "commit visual deve ser delimitável");
const commit = service.slice(commitStart, commitEnd);
assert.match(commit, /GtoSelectionEvidencePolicy\.mayConfirmSelection/,
  "commit deve exigir evidência de ação humana");
assert.match(commit, /persistSelectionIdentity\(row, \"TOUCH_LOCKED\"/,
  "identidade deve permanecer bloqueada antes da confirmação final");
assert.match(commit, /runPreciseSelectedRowOcr|runPreciseSelectedRowOcr\(transaction\)/,
  "OCR/validação da transação deve continuar depois do commit visual");

assert.match(policy, /mayArmFromFreshFreightList/,
  "a policy de seleção deve continuar sendo a única policy de armamento");
assert.match(policy, /listSeenAt|acceptButtonCount|generation/, 
  "o armamento deve manter frescor, geometria/lista e geração");

console.log("HF178 selection persistence gate: 9/9");
