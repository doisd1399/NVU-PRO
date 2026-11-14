import fs from "node:fs";
const read = (file) => fs.readFileSync(file, "utf8");
const queue = read("src/lib/offlineTripQueue.ts");
const syncEngine = read("src/services/sync/SyncEngine.ts");
const adapter = read("src/services/sync/FirebaseTripSyncAdapter.ts");
const command = read("src/application/trip/CanonicalTripCommandService.ts");
const serverWriter = read("functions/src/registerCanonicalSimpleTrip.ts");
const print = read("src/pages/driver/RecordTrip.tsx");
const pro = read("src/services/simpleAutomationCompletionService.ts");
const history = read("src/pages/driver/TripHistory.tsx");
const coordinator = read("src/services/operationalCompletionCoordinator.ts");
const addTrip = command.slice(command.indexOf("async addTripWithinOperationLimit"));
const checks = [
  ["legacy queue remains idempotent for records still present", queue.includes("idempotencyKey") && queue.includes("existing")],
  ["canonical queue is user-scoped and FIFO", syncEngine.includes("ownerOf(item.trip) === uid") && syncEngine.includes("queuedAt.localeCompare") && syncEngine.includes(".sort")],
  ["Print persists locally before invoking replay", addTrip.indexOf("await this.save(canonicalTrip)") >= 0 && addTrip.indexOf("await this.save(canonicalTrip)") < addTrip.indexOf("this.sync.synchronize()")],
  ["offline command reports pending, not server-confirmed", command.includes("offline: true") && command.includes("if (this.isOffline()) return pendingReference")],
  ["replay uses the canonical Firestore adapter", syncEngine.includes("this.adapter.push(item.trip)") && adapter.includes('"historico_viagens"')],
  ["Simple server writer uses callable and idempotency without client slot", adapter.includes("registerCanonicalSimpleTrip") && serverWriter.includes("trip_request_locks") && serverWriter.includes("operationSlot") && !adapter.includes("operationSlot") && !adapter.includes("progress: progress + 1")],
  ["each pending record is handled by the canonical ACK loop", syncEngine.includes("for (const [id, item] of pending)") && syncEngine.includes("state: retryable ? \"PENDING_SYNC\"" )],
  ["completed trips do not receive fake client-side ACK", !print.includes("serverValidatedAt: serverTimestamp()") && !pro.includes("serverValidatedAt: serverTimestamp()")],
  ["history exposes pending validation without counting as verified", history.includes("Aguardando sincronização") && coordinator.includes("offlineSyncStatus: \"pending_sync\"")],
  ["reconnect/visibility/auth triggers canonical synchronization", read("src/main.tsx").includes("SyncManager.initialize()") && read("src/services/syncManager.ts").includes('addEventListener("online"')],
];
let failed = 0;
for (const [name, ok] of checks) { console.log(`${ok ? "PASS" : "FAIL"} ${name}`); if (!ok) failed += 1; }
if (failed) process.exit(1);
console.log(`PASS ${checks.length}/${checks.length} canonical offline Print/Pro invariants`);
