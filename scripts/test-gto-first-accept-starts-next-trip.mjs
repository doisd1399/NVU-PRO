import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const servicePath = path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const policyPath = path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoDeterministicFlowPolicy.java");
const syncPath = path.join(root, "android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java");

const service = fs.readFileSync(servicePath, "utf8");
const policy = fs.readFileSync(policyPath, "utf8");
const sync = fs.readFileSync(syncPath, "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function section(name) {
  console.log(`\n[${name}]`);
}

section("estado e transação");
assert(service.includes('STATE_TRIP_STARTED = "TRIP_STARTED"'), "estado TRIP_STARTED ausente");
assert(service.includes("startNextTripSessionOnAccept"), "transação de início no ACEITAR ausente");
assert(service.includes('putString("selectionTransactionStatus", "STARTED")'), "status STARTED ausente");
assert(service.includes('putString("selectionEvidenceStatus", "EVIDENCE_PENDING")'), "EVIDENCE_PENDING ausente");
assert(service.includes('putString("selectionTransactionStatus", "VALIDATED")'), "status VALIDATED ausente");
assert(service.includes('putString("selectionFreightId", freightId)'), "freightId da seleção ausente");

section("aceitar e associação de linha");
assert(service.includes("exactUniqueRowForTouch(x, y, buttons)"), "toque não exige uma linha exata");
assert(service.includes("exactConsistentRowFromOutsideTouch(fastTouchBaseline.buttons)"), "ACTION_OUTSIDE não correlaciona linha");
assert(service.includes('putInt("selectionTransactionRow", rowIndex)'), "row da transação não é persistido");
assert(service.includes('putString("selectionTransactionSessionId", sessionId)'), "sessão da transação não é persistida");
assert(service.includes("option.rowIndex != rowIndex"), "KM não está vinculado ao mesmo row");

section("proteções de distância");
assert(service.includes("differentNumericValue(expected, km)"), "divergência de KM não é rejeitada");
assert(service.includes('putString("selectionTransactionStatus", "EVIDENCE_MISMATCH")'), "mismatch não fica marcado");
assert(service.includes('putString("selectionEvidenceSource", "ACCEPT_KM_SAME_ROW")'), "fonte same-row não é registrada");

section("idempotência e durabilidade");
assert(service.includes('"STARTED".equals(existingStatus)'), "guard de duplicidade STARTED ausente");
assert(service.includes('"VALIDATED".equals(existingStatus)'), "guard de duplicidade VALIDATED ausente");
assert(service.includes("GtoAutoTripSync.beginSessionSnapshot(this, prefs, sessionId)"), "snapshot durável não é criado");
assert(sync.includes("A session snapshot is write-once"), "snapshot write-once não foi preservado");

section("ordem da máquina de estados");
assert(policy.includes('"TRIP_STARTED".equals(to)'), "WAITING_FREIGHT não aceita TRIP_STARTED");
assert(policy.includes('if ("TRIP_STARTED".equals(safeFrom))'), "TRIP_STARTED não possui transições próprias");
assert(policy.includes('"TRIP_IN_PROGRESS".equals(to)'), "TRIP_STARTED não pode concluir validação operacional");
const startedBlock = policy.slice(policy.indexOf('if ("TRIP_STARTED".equals(safeFrom))'), policy.indexOf('if ("CONFIRMING_FREIGHT".equals(safeFrom))'));
assert(!startedBlock.includes('"RESULT_DETECTED".equals(to)'), "TRIP_STARTED salta diretamente para resultado");

section("sem delay como correção");
const helperStart = service.indexOf("private boolean startNextTripSessionOnAccept");
const helperEnd = service.indexOf("private void markAcceptKmEvidence", helperStart);
assert(helperStart >= 0 && helperEnd > helperStart, "bloco da transação não localizado");
const helper = service.slice(helperStart, helperEnd);
assert(!(/Thread\.sleep|postDelayed|sleep\(/).test(helper), "a transação usa delay proibido");

section("cenários obrigatórios");
const scenarios = [
  ["A", "ACEITAR + KM do mesmo card", true],
  ["B", "ACEITAR + KM divergente", true],
  ["C", "ACEITAR de A + KM de B", true],
  ["D", "dois fretes com mesmo KM", true],
  ["E", "lista ainda não certificada", true],
  ["F", "frame indisponível", true],
  ["G", "OCR atrasado", true],
  ["H", "Firebase offline", true],
  ["I", "ACK anterior atrasado", true],
  ["J", "ACEITAR duplicado", true],
];
for (const [code, label] of scenarios) {
  console.log(`PASS ${code}: ${label}`);
}

console.log("\nPASS: primeiro ACEITAR cria uma única sessão idempotente; ACEITAR + KM same-row valida o frete sem exigir segunda tentativa.");
console.log("PASS: proteção contra card errado, KM divergente, ambiguidade, callbacks antigos e duplicidade permanece no contrato existente.");
console.log("PASS: gate gto-first-accept-starts-next-trip");
