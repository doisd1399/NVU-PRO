import fs from "node:fs";
const read = (p) => fs.readFileSync(p, "utf8");
const adapter = read("src/services/sync/FirebaseTripSyncAdapter.ts");
const realtime = read("src/application/trip/CanonicalTripRealtimeService.ts");
const main = read("src/main.tsx");
const tripRegistration = read("src/application/trip/TripRegistrationService.ts");
const query = read("src/application/trip/CanonicalTripQueryService.ts");
const coordinator = read("src/application/trip/TripRegistrationCoordinator.ts");
const operation = read("src/application/trip/CanonicalTripOperationService.ts");
const offline = read("src/services/offline/OfflineFirstTripRepository.ts");
const canonicalRepository = read("src/repositories/CanonicalTripRepository.ts");
const syncEngine = read("src/services/sync/SyncEngine.ts");
const offlineDatabase = read("src/services/offline/OfflineDatabase.ts");
const flow = read("src/services/operationalCompletionCoordinator.ts");
const store = read("src/lib/CanonicalTripStore.ts");
const checks = [
  ["Firebase writes canonical history collection", adapter.includes('doc(this.firestore, "historico_viagens", tripId)')],
  ["Simple/Print uses server callable before confirmation", adapter.includes("registerCanonicalSimpleTrip") && !adapter.includes("transaction.set(slotRef") && !adapter.includes("serverTrip.operationSlot")],
  ["Realtime listener is bootstrapped", main.includes("startCanonicalTripRealtimeSync()")],
  ["Realtime subscription hydrates local and confirmed records from one snapshot", realtime.includes("this.offlineDatabase.list()") && realtime.includes("this.snapshot()") && realtime.includes("canonicalTripStore.list()")],
  ["Registration coordinator constructs identity without premature side effects", coordinator.includes("TripRegistrationService.register(input)") && !coordinator.includes("canonicalTripStore.upsert")],
  ["Canonical registration persists one stable ID in tripId and canonicalTripId", tripRegistration.includes("canonicalTripId: tripId") && tripRegistration.includes("tripId,")],
  ["Canonical history projection deduplicates on canonicalTripId first", query.includes("trip.canonicalTripId || trip.tripId")],
  ["Canonical trip update event is wired into ranking and history-cache invalidation", main.includes("registerCanonicalTripCacheInvalidation()") && read("src/hooks/useRankingAggregate.ts").includes("onCanonicalTripUpdated")],
  ["Operation reads authoritative jobId-scoped server trips", operation.includes("getDocFromServer(jobRef)") && operation.includes("getDocsFromServer(canonicalQuery)") && operation.includes('where("jobId", "==", jobId)') && operation.includes("isCanonicalConfirmedTrip")],
  ["Local trip and outbox share one durable commit before store publication", offline.includes("return super.saveLocal(trip)") && canonicalRepository.indexOf("await this.queue.enqueueAndSave(record)") >= 0 && canonicalRepository.indexOf("await this.queue.enqueueAndSave(record)") < canonicalRepository.indexOf("canonicalTripStore.upsert(record.trip)") && syncEngine.includes("this.offlineDatabase.commitOutbox(queue, record)") && offlineDatabase.includes("JSON.stringify({ schemaVersion: SCHEMA_VERSION, records: data, outbox })") && offlineDatabase.includes("this.storage!.setItem(STORAGE_KEY, serialized)")],
  ["Canonical store marks remote deletion outside valid projections", store.includes('status: "DELETED"') && store.includes("deleted: true")],
  ["Runtime trace contains required stages", flow.includes("TRIP_CREATE_START") && flow.includes("TRIP_VALIDATION_RESULT") && flow.includes("TRIP_HISTORY_UPDATE")],
];
let failed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failed += 1;
}
if (failed) process.exit(1);
console.log(`canonical-runtime-contract: PASS ${checks.length}/${checks.length}`);
