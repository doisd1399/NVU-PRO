import fs from "node:fs";
import assert from "node:assert/strict";

const service = fs.readFileSync(
  new URL("../android/app/src/main/java/com/nvu/operacional/GtoObserverService.java", import.meta.url),
  "utf8",
);
const policy = fs.readFileSync(
  new URL("../android/app/src/main/java/com/nvu/operacional/GtoOperationCardPolicy.java", import.meta.url),
  "utf8",
);

assert.match(
  service,
  /if \(!operationActionAdded\) \{[\s\S]{0,500}menuButton\(operationSummaryExpanded \? "Voltar ao frete atual" : "Operação atual"\)/,
  "Operação atual deve permanecer disponível fora e dentro da lista de fretes",
);
assert.doesNotMatch(
  service,
  /if \(!operationActionAdded && !routeBoundary\)/,
  "O card não pode ocultar Operação atual na fronteira WAITING_FREIGHT/manual route",
);

for (const label of ["\\nStatus ", "\\nObservador ", "\\nSincronização "]) {
  assert.doesNotMatch(service, new RegExp(label), `Campo técnico ainda renderizado no card: ${label}`);
}
assert.doesNotMatch(
  service,
  /operationCore\s*\+\s*"\\nStatus|operationCore\s*\+\s*"\\nObservador|operationCore\s*\+\s*"\\nSincronização/,
  "Resumo operacional não pode concatenar os campos técnicos",
);

assert.match(
  service,
  /else if \(isVisualFreightContextConfirmed\(System\.currentTimeMillis\(\)\)\)\s*\{[\s\S]{0,220}helper\.setText\("Selecione um trabalho"\)/,
  "A mensagem pública deve depender da lista visualmente confirmada",
);
assert.doesNotMatch(
  service,
  /else if \(detected > 0 \|\| visualDetected >= 2\)\s*\{[\s\S]{0,120}Selecione um trabalho/,
  "Contagem/realtime não pode reemitir a mensagem da lista",
);

for (const field of ["Viagens ", "Veículo ", "Reboque ", "Progresso "]) {
  assert.match(policy, new RegExp(field), `Resumo central deve manter o campo operacional: ${field}`);
}
for (const field of ["Status ", "Observador ", "Sincronização "]) {
  assert.doesNotMatch(policy, new RegExp(`\\\\n${field}`), `Resumo central não pode renderizar o campo técnico: ${field}`);
}

console.log("GTO operation-card UI contract: PASS");
console.log("- Operação atual permanente");
console.log("- Status técnico removido da superfície");
console.log("- Selecione um trabalho condicionado à lista visual");
console.log("- Resumo operacional preservado");

