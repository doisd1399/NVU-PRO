import fs from "node:fs";
import assert from "node:assert/strict";
const modal=fs.readFileSync("src/components/RankingParticipantPremiumModal.tsx","utf8");
const identity=fs.readFileSync("src/lib/resolveSimulator.ts","utf8");
const hook=fs.readFileSync("src/hooks/useVehiclePhoto.ts","utf8");
const service=fs.readFileSync("src/services/vehiclePhotoService.ts","utf8");
const transport=fs.readFileSync("src/services/photoDownload.ts","utf8");
const checks=[
 ["simulador deriva de operação, empresa e veículo explícitos",modal.includes("resolveVehiclePhotoOperationSimulatorId")&&modal.includes("operationCompany")&&modal.includes("[vehicle]")],
 ["perfil aceita currentRecruitmentSimulatorId",identity.includes("record.currentRecruitmentSimulatorId")],
 ["não resolve foto por nome/modelo",!modal.includes("vehicle?.name") || modal.includes("selectedVehicleId")],
 ["retry após autenticação",hook.includes("onAuthStateChanged")&&hook.includes("void applyRemote()")],
 ["retry após reconexão",hook.includes('addEventListener("online"')&&hook.includes("void applyRemote()")],
 ["listener é removido",hook.includes("stopAuth()")],
 ["loading é deduplicado",service.includes("const loading = new Map")&&service.includes("loading.has(key)")],
 ["falha de download não vira ausência",transport.includes("VEHICLE_PHOTO_DOWNLOAD_HTTP_")&&service.includes("downloadPhotoBlob")],
 ["cache é escopado por identidade",service.includes("vehiclePhotoKey(identity)")],
 ["projeção valida identidade completa",service.includes("readRemoteVehiclePhotoDetails(db, identity")],
];
for(const [name,ok] of checks){assert.ok(ok,name);console.log(`PASS ${name}`)}
console.log(`R9_RANKING_PHOTO_CONTRACT_PASS ${checks.length} checks`);
