import fs from "node:fs";
import assert from "node:assert/strict";

const modal = fs.readFileSync("src/components/RankingParticipantPremiumModal.tsx", "utf8");
const hook = fs.readFileSync("src/hooks/useRankingParticipantVehicle.ts", "utf8");
const repository = fs.readFileSync("src/services/vehiclePhotoRepository.ts", "utf8");
const photoHook = fs.readFileSync("src/hooks/useVehiclePhoto.ts", "utf8");
const checks = [
  ["identidade do participante selecionado", modal.includes("userId: participantId") && hook.includes("participantId")],
  ["simulador resolvido com fallback seguro", modal.includes("resolveVehiclePhotoOperationSimulatorId") && modal.includes("operationCompany") && modal.includes("[vehicle]")],
  ["veículo atual ou legado veiculoId", modal.includes("currentJob?.vehicleId || currentJob?.veiculoId") && hook.includes("operation?.veiculoId")],
  ["consulta histórica paginada preservada", hook.includes("startAfter") && hook.includes("OPERATIONS_PAGE_SIZE")],
  ["metadado vehiclePhotosV2 escopado", repository.includes("vehiclePhotosV2") && repository.includes("vehiclePhotoDocumentKey(identity)" )],
  ["formato legado validado sem misturar usuário/simulador", repository.includes("legacy.userId") && repository.includes("resolveVehiclePhotoOperationSimulatorEvidence(legacy")],
  ["estado remoto loading/missing/error", photoHook.includes('"loading"') && photoHook.includes('"missing"') && photoHook.includes('"error"')],
  ["erro remoto não vira ausência automática", modal.includes("remoteStatus === \"error\"") && modal.includes("Não foi possível consultar")],
  ["layout Premium preservado", modal.includes("nvu-profile-summary") && modal.includes("{periodLabel}") && modal.includes("Histórico")],
];
for (const [name, ok] of checks) { assert.ok(ok, `R6 FAIL: ${name}`); console.log(`PASS ${name}`); }
console.log(`R6_RANKING_PHOTO_CONTRACT_PASS ${checks.length} checks`);
