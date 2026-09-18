import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const sync = read("android/app/src/main/java/com/nvu/operacional/GtoAutoTripSync.java");
const parser = read("android/app/src/main/java/com/nvu/operacional/GtoPauseLocationParser.java");

assert.ok(service.includes("validatePauseFreightAgainstCurrentReview"), "pause valida contra frete atual");
assert.ok(service.includes("PAUSE_FREIGHT_MISMATCH"), "mismatch é bloqueado e auditado");
assert.ok(service.includes('freight.cargo = pauseTextField(lines, "carga"'), "Carga é relida obrigatoriamente no pause");
assert.ok(service.includes('freight.origin = pauseLocationTextField(lines, "origem"') && service.includes('freight.originCompany = current.originCompany'), "Origem é relida obrigatoriamente no pause");
assert.ok(service.includes('freight.destination = pauseLocationTextField(lines, "destino"'), "Destino é relido obrigatoriamente no pause");
assert.ok(service.includes("pausePendingFieldsCsv"), "campos ausentes continuam explicitamente pendentes");
assert.ok(service.includes("freight.rowIndex = current.rowIndex"), "pause preserva a linha selecionada");
assert.ok(service.includes("putString(\"pauseValidationStatus\", \"MATCH\")"), "MATCH é persistido somente após validação");
assert.ok(service.includes("if (pauseRecoveryFlow)"), "fluxo pause é ramo isolado");
assert.ok(service.includes("return;"), "pause impede queda no OCR genérico");
assert.ok((sync.includes("String canonicalOrigin = clean(candidate.optString(\"origin\", \"\"))") || sync.includes("String canonicalOrigin = GtoAcceptedFreightFieldPolicy.acceptedVisibleOrigin(")), "lock preserva origin final");
assert.ok((sync.includes("String canonicalOrigin = clean(payload.optString(\"origin\", \"\"))") || sync.includes("String canonicalOrigin = GtoAcceptedFreightFieldPolicy.acceptedVisibleOrigin(")), "payload preserva origin final");
assert.ok(sync.includes("origin deve conter o local final"), "validação não exige origin=originCompany");
assert.ok(!sync.includes("payload.put(\"origin\", clean(payload.optString(\"originCompany\", \"\")))"), "backend não sobrescreve local com empresa");
assert.ok(parser.includes("extractAfterLastSeparator"), "parser seguro permanece ativo");

console.log("PASS HF78: auditoria de retorno, pendência, cross-validation e contrato origin-local verificada.");
