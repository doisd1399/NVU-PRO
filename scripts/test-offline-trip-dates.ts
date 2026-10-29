import assert from "node:assert/strict";
import fs from "node:fs";
import { getTripMetricDate, normalizeTrip } from "../src/lib/tripNormalizer";

const localIso = "2026-09-24T12:34:56.000-03:00";
const localDate = new Date(localIso);
const completedLocal = new Date("2026-09-24T14:34:56.000-03:00");
const serverDate = new Date("2026-09-25T01:00:00.000Z");

assert.equal(
  getTripMetricDate({ createdAtLocal: localIso, completedAtLocal: completedLocal, completedAt: serverDate }).getTime(),
  localDate.getTime(),
  "histórico deve preferir o instante local ao horário posterior de sincronização",
);
assert.equal(
  getTripMetricDate({ completedAtLocal: localIso, completedAt: new Date(0) }).getTime(),
  localDate.getTime(),
  "timestamp vazio do servidor não pode converter a viagem para 31/12/1969",
);
assert.equal(
  getTripMetricDate({ createdAtLocal: "invalid", completedAtLocal: localIso }).getTime(),
  localDate.getTime(),
  "data local de conclusão deve recuperar um campo de criação inválido",
);
for (const offlineSyncStatus of ["awaiting_connection", "uploading", "server_received", "validation_pending", "validation_failed"]) {
  assert.equal(
    normalizeTrip({ id: `local-${offlineSyncStatus}`, status: "concluida", createdAtLocal: localIso, offlineSyncStatus }).isValid,
    false,
    `${offlineSyncStatus} must remain visible but must not count as validated operation progress`,
  );
}
assert.equal(
  normalizeTrip({ id: "legacy-confirmed", status: "concluida", createdAtLocal: localIso }).isValid,
  true,
  "legacy/server trips without an offline pending marker remain compatible",
);

const queueSource = fs.readFileSync("src/lib/offlineTripQueue.ts", "utf8");
const syncSource = fs.readFileSync("src/application/trip/CanonicalTripSyncCommandService.ts", "utf8");
const recordSource = fs.readFileSync("src/pages/driver/RecordTrip.tsx", "utf8");
const proSource = fs.readFileSync("src/services/simpleAutomationCompletionService.ts", "utf8");
const firebaseAdapter = fs.readFileSync("src/services/sync/FirebaseTripSyncAdapter.ts", "utf8");
assert.match(queueSource, /createdAtLocal,\s*completedAtLocal,/);
assert.match(syncSource, /synchron/i);
assert.match(recordSource, /createdAtLocal: tripCompletedAtLocal/);
assert.match(recordSource, /completedAtLocal: tripCompletedAtLocal/);
assert.doesNotMatch(recordSource, /serverValidatedAt:\s*serverTimestamp\(\)/);
assert.match(proSource, /createdAtLocal: tripCompletedAtLocal/);
assert.match(proSource, /completedAtLocal: tripCompletedAtLocal/);
assert.doesNotMatch(proSource, /serverValidatedAt:\s*serverTimestamp\(\)/);
assert.match(firebaseAdapter, /registerCanonicalSimpleTrip/);
assert.doesNotMatch(firebaseAdapter, /serverValidatedAt:\s*serverTimestamp\(\)/);
assert.match(recordSource, /activeJobNextRouteIndex/);
assert.match(recordSource, /freshJobProgress \+ locallyReservedTrips/);

console.log("offline-trip-dates: PASS hora local, epoch, timestamps server e status pendente/falho excluído do progresso validado");
