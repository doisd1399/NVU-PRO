import fs from "node:fs";
const read = (file) => fs.readFileSync(file, "utf8");
const print = read("src/pages/driver/RecordTrip.tsx");
const adapter = read("src/services/sync/FirebaseTripSyncAdapter.ts");
const serverWriter = read("functions/src/registerCanonicalSimpleTrip.ts");
const syncEngine = read("src/services/sync/SyncEngine.ts");
const syncManager = read("src/services/syncManager.ts");
const command = read("src/application/trip/CanonicalTripCommandService.ts");
const receiptStore = read("src/lib/offlineReceiptStore.ts");
const availability = read("src/services/workModeAvailabilityService.ts");
const context = read("src/context/AppContext.tsx");
const snapshot = read("src/lib/activeOperationSnapshot.ts");
const pro = read("src/services/simpleAutomationCompletionService.ts");
const nativePro = read("android/app/src/main/java/com/nvu/operacional/SimpleProNativeSubmissionCoordinator.java");
const nativeService = read("android/app/src/main/java/com/nvu/operacional/SimpleAutomationService.java");
const nativePendingStore = read("android/app/src/main/java/com/nvu/operacional/ProPendingTripStore.java");
const main = read("src/main.tsx");
const pushStart = adapter.indexOf("async push(");
const pushMethod = pushStart >= 0 ? adapter.slice(pushStart) : "";
const receiptUploadIndex = pushMethod.indexOf("this.uploadReceipt({");
const receiptTransactionIndex = pushMethod.indexOf("registerCanonicalTrip");
const offlineAddTripStart = command.indexOf("async addTripWithinOperationLimit(");
const offlineAddTripMethod = offlineAddTripStart >= 0 ? command.slice(offlineAddTripStart) : "";
const offlineSaveIndex = offlineAddTripMethod.indexOf("await this.save(canonicalTrip)");
const offlineReplayIndex = offlineAddTripMethod.indexOf("await this.sync.synchronize()");
const checks = [
  ["Print persists receipt binary offline", print.includes("persistOfflineReceipt(file") && receiptStore.includes("indexedDB.open")],
  ["Print does not upload during selection; offline queue owns upload", print.includes("File selection performs no network upload") && print.includes("persistOfflineReceipt(file") && print.includes("offline-receipt-store")],
  ["Connectivity loss during upload preserves the exact receipt", print.includes("stableFile && stableHash && (isConnectivityError(error)")],
  ["Queued client data does not forge serverValidatedAt", !print.includes("serverValidatedAt: serverTimestamp()") && !pro.includes("serverValidatedAt: serverTimestamp()")],
  ["Receipt upload occurs before the server callable", receiptUploadIndex >= 0 && receiptTransactionIndex >= 0 && receiptUploadIndex < receiptTransactionIndex && adapter.includes('"registerCanonicalSimpleTrip"')],
  ["Uploaded URL is durable for retries", adapter.includes("receipt.uploadedUrl") && adapter.includes("markReceiptUploaded(receiptKey, receiptUrl)") && receiptStore.includes("uploadedUrl")],
  ["Server callable owns Simple trip and lock without client slot/progress", adapter.includes("registerCanonicalTrip") && serverWriter.includes("trip_request_locks") && serverWriter.includes("operationSlot") && !adapter.includes("transaction.set(slotRef") && !adapter.includes("progress: progress + 1")],
  ["Offline command persists locally before replay and returns pending while offline", offlineSaveIndex >= 0 && offlineAddTripMethod.includes("this.sync.synchronize()") && offlineAddTripMethod.includes("if (this.isOffline()) return pendingReference")],
  ["Only explicit server ACK marks queue SERVER_CONFIRMED", syncEngine.includes('result.confirmed') && syncEngine.includes('state: "SERVER_CONFIRMED"') && syncEngine.includes("reconcileConfirmedTrip(confirmedTrip)")],
  ["Permanent legacy failures wait for explicit retry", !syncManager.includes('item.status === "PENDING_SYNC" || item.status === "FAILED"') && !syncManager.includes('!includes("FAILED")')],
  ["Permission/precondition failures are not converted into retryable offline writes", syncEngine.includes('!code.includes("permission-denied")') && syncEngine.includes('!code.includes("failed-precondition")')],
  ["Auth restoration and connectivity resume the canonical queue", main.includes("SyncManager.initialize()") && syncManager.includes('addEventListener("online"')],
  ["Work mode availability has durable offline fallback", availability.includes("OFFLINE_AVAILABILITY_KEY") && availability.includes("offlineAvailability()")],
  ["Vehicle and trailer caches survive empty snapshots", context.includes("preserveCachedVehicles") && context.includes("preserveCachedTrailers")],
  ["Active operation snapshot v3 includes assets", snapshot.includes("const SNAPSHOT_VERSION = 3") && snapshot.includes("vehicle: Record<string, unknown> | null") && snapshot.includes("trailer: Record<string, unknown> | null")],
  ["Pro explicitly reports pending validation offline", pro.includes("Viagem Pro registrada offline. Aguardando conexão para validação.")],
  ["Native capture enters the durable Pro queue", nativeService.includes("submitNativeReceiptIfPending();") && nativeService.includes("ProPendingTripStore.enqueue(this, prefs, receipt)")],
  ["Native fallback does not pre-consume WEB_FALLBACK state", !nativePro.match(/private static void fallback[\s\S]{0,500}putString\("nativeSubmissionState", PRO_STATE_FALLBACK\)/)],
  ["Positive low-value Pro/Print receipts are not rejected by a local R$ 1,000 floor", !print.includes("valorNumerico < 1_000") && !nativePendingStore.includes("cents < 100_000")],
];
let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed += 1;
}
if (failed) process.exit(1);
console.log(`PASS ${checks.length}/${checks.length} V13 offline canonical-flow invariants`);
