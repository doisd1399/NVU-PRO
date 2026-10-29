import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toProOperationHistoryRows } from "../src/lib/proOperationHistory.ts";
import { mergeTripDatasets } from "../src/lib/tripDatasetReconciliation.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/SimpleAutomationService.java");
const plugin = read("android/app/src/main/java/com/nvu/operacional/SimpleAutomationPlugin.java");
const bridge = read("src/components/SimpleAutomationCompletionBridge.tsx");
const launcher = read("src/services/simpleAutomationLauncher.ts");

assert.deepEqual(toProOperationHistoryRows([
  { id: "confirmed-a", origem: "A", destino: "B", normalizedValor: 2497, normalizedCurrency: "EUR", currencyStatus: "known", metricDate: new Date(2026, 8, 28) },
  { id: "", normalizedValor: 100, metricDate: new Date(2026, 8, 28) },
  { id: "zero-value", normalizedValor: 0, metricDate: new Date(2026, 8, 28) },
  { id: "invalid-date", normalizedValor: 100, metricDate: new Date(0) },
], { jobId: "job", companyId: "company", driverId: "driver" }).map(({ completedAt, ...trip }) => trip), [
  { tripId: "confirmed-a", jobId: "job", companyId: "company", driverId: "driver",
    origin: "A", destination: "B", amountCents: 249700, currency: "EUR" },
  { tripId: "zero-value", jobId: "job", companyId: "company", driverId: "driver",
    origin: "", destination: "", amountCents: 0, currency: "UNKNOWN" },
]);

const legacyTrip = { empresaId: "company", motoristaId: "driver", jobId: "job", contractId: "contract",
  completedAt: "2026-09-28T12:00:00.000Z", valor: 100, origem: "A", destino: "B", simulatorCode: "GTO" };
assert.equal(mergeTripDatasets([legacyTrip], [{ ...legacyTrip, empresaNome: "Empresa autorizada" }]).length, 1,
  "legacy identity must not depend on array position");
assert.equal(mergeTripDatasets([{ ...legacyTrip, origem: "A" }], [{ ...legacyTrip, origem: "C" }]).length, 2,
  "distinct legacy routes must remain distinct");

assert.match(plugin, /public void updateOperationHistory\(PluginCall call\)/);
assert.match(service, /!scope\.equals\(historyScopeKey\(preferences\.getString\("jobId"/);
assert.match(service, /whereEqualTo\("driverId", safeDriverId\)[\s\S]*?whereEqualTo\("jobId", safeJobId\)\.get\(Source\.SERVER\)/);
assert.match(service, /whereEqualTo\("motoristaId", safeDriverId\)\.get\(Source\.SERVER\)/);
assert.match(service, /if \(!task\.isSuccessful\(\)\) \{[\s\S]*?projeção mantida[\s\S]*?return;/);
assert.match(service, /historyUpdatedAt", 0L\) > projectionAtStart/);
assert.match(service, /historyReconcileGeneration", 0L\) != requestGeneration/);
assert.match(service, /historyLoadState", "SERVER"/);
assert.match(service, /historyReconcileRetryAt", dueAt/);
assert.match(service, /historyReconcileFailures", failures/);
assert.match(service, /addPendingHistoryEntries\(merged, scoped\)/);
assert.match(service, /if \(activeScope\) \{[\s\S]*?putString\("historyLoadState", "ACK"\)/);
assert.match(service, /authoritativeCount/);
assert.match(service, /Deleted\/remote-absent confirmed trips[\s\S]*?must never be resurrected/);
assert.match(service, /Histórico em sincronização\. O progresso da operação está preservado\./);
assert.match(bridge, /\(!operationHistoryReady && operationHistoryLoading\)/);
assert.doesNotMatch(bridge, /currentOperationTrips\.length === 0 && Number\(currentJob\.progress/);
assert.match(service, /profileJobProgress/);
assert.doesNotMatch(service, /nativeAckAt[^\n]*< 15_000L/);
assert.match(launcher, /await SimpleAutomation\.setContext\([\s\S]*?await publishHistory\(\);/);

console.log("pro-operation-history-sync: PASS scope, projection, legacy fields and offline preservation");
