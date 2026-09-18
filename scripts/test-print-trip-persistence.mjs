import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const repo = read("src/repositories/TripsRepository.ts");
const recordTrip = read("src/pages/driver/RecordTrip.tsx");
const pro = read("src/services/simpleAutomationCompletionService.ts");
const rules = read("firestore.rules");

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const start = repo.indexOf("static async addTripWithinOperationLimit");
const end = repo.indexOf("static async updateTrip", start);
assert(start >= 0 && end > start, "Método transacional do limite não encontrado");
const method = repo.slice(start, end);

assert(repo.includes("const operationSlotDocumentId"), "ID determinístico de slot não foi definido");
assert(method.includes("await TripsRepository.syncJobProgress(jobId)"), "Preflight server-side do limite foi removido");
assert(method.includes("runTransaction(db, async (transaction)"), "O limite não é mais protegido por transação");
assert(method.includes("const jobSnapshot = await transaction.get(jobRef)"), "A transação não lê o job autoritativo");
assert(method.includes("const existingSlot = await transaction.get(tripRef)"), "A transação não verifica a reserva do slot");
assert(method.includes('throw new Error("OPERATION_TRIP_SLOT_ALREADY_CLAIMED")'), "Colisão de slot não é fail-closed");
assert(method.includes("transaction.set(tripRef, {"), "A viagem não é criada na transação");
assert(!method.includes("transaction.update(jobRef"), "O cliente ainda tenta atualizar progress/status de trabalhos");
assert(!method.includes("transaction.set(tripRef, data)"), "O payload não inclui a identidade do slot reservado");

assert(recordTrip.includes("TripsRepository.addTripWithinOperationLimit"), "Print não usa a persistência com limite");
assert(pro.includes("TripsRepository.addTripWithinOperationLimit"), "Pro não usa a persistência com limite");
assert(rules.includes("allow create: if request.auth != null"), "Regra de criação de historico_viagens não foi encontrada");
assert(rules.includes("request.resource.data.diff(resource.data).affectedKeys().hasOnly([\n            'status',"), "Regra de trabalhos não documenta uma atualização de progress permissiva ao motorista");

console.log("PASS: Print/Pro registram por slot transacional sem atualizar trabalhos no cliente e mantêm o limite fail-closed");
