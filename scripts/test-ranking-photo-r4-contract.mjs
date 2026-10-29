import fs from "node:fs";
import assert from "node:assert/strict";

const modal = fs.readFileSync("src/components/RankingParticipantPremiumModal.tsx", "utf8");
const hook = fs.readFileSync("src/hooks/useRankingParticipantVehicle.ts", "utf8");
const repository = fs.readFileSync("src/services/vehiclePhotoRepository.ts", "utf8");
const rules = fs.readFileSync("firestore.rules", "utf8");
const checks = [
  ["operação direta do participante selecionado", hook.includes('where(field, "==", participantId)') && modal.includes("useRankingParticipantVehicle")],
  ["não depende somente de jobs do RankingGlobal", hook.includes('collection(db, "trabalhos")') && modal.includes("localCurrentJob")],
  ["veículo atual recuperado por ID", hook.includes('doc(db, "veiculos", vehicleId)') && hook.includes("operation?.vehicleId")],
  ["seleção canônica recebe operações encerradas para filtrar atribuições antigas", hook.includes("selectCurrentOperationJob") && hook.includes("allJobs") && !hook.includes("allJobs.filter((job) => isRunningJobStatus")],
  ["respostas antigas descartadas ao trocar participante", hook.includes("cancelled") && hook.includes("if (cancelled) return")],
  ["cache com TTL e invalidação", hook.includes("CACHE_TTL_MS") && hook.includes("invalidateRankingParticipantVehicle")],
  ["identidade remota escopada", repository.includes("rankingVehiclePhotoDocumentKey(identity)") && repository.includes("cache.get(cacheKey)") && repository.includes("viewerId ||")],
  ["estado de permissão não confundido com ausência", modal.includes('permission-denied') && modal.includes("leitura autorizada")],
  ["permissão autenticada sem abertura pública", rules.includes('match /users/{userId}') && rules.includes('allow read: if isAuthenticated()') && rules.includes('match /trabalhos/{id}')],
  ["layout Premium preservado", modal.includes("nvu-profile-summary") && modal.includes("{periodLabel}") && modal.includes('Histórico de classificações')],
];
for (const [name, ok] of checks) { assert.ok(ok, `R4 FAIL: ${name}`); console.log(`PASS ${name}`); }
console.log(`R4_RANKING_PHOTO_CONTRACT_PASS ${checks.length} checks`);
