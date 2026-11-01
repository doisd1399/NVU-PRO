import assert from "node:assert/strict";
import fs from "node:fs";
import { isPendingHistoryTrip, mergePendingHistoryTrips, tripSendStatus } from "../src/lib/pendingHistoryTrips.ts";

// A trip made offline (a receipt saved on the device) is a row of the operation history with its send status, never a
// warning card. These are the rows TripHistory builds from the native queue.
const nativeRow = (attemptId: string, queueStatus: string, offline = false) => ({
  id: `pending-pro-${attemptId}`, tripId: `pending-pro-${attemptId}`, canonicalTripId: `pending-pro-${attemptId}`,
  jobId: "job-1", operationId: "job-1", companyId: "company", empresaId: "company", driverId: "driver", motoristaId: "driver",
  origem: "Santos", destino: "Campinas", valor: 30845, valorCents: 3084500, status: "aguardando_envio",
  offlineSyncStatus: queueStatus === "SENDING" ? "syncing" : queueStatus === "FAILED" ? "validation_failed" : queueStatus === "AUTH_REQUIRED" ? "auth_required" : offline ? "awaiting_connection" : "pending_sync",
  createdAt: 1_762_000_000_000, completedAt: 1_762_000_000_000, createdAtLocal: new Date(1_762_000_000_000).toISOString(), completedAtLocal: new Date(1_762_000_000_000).toISOString(),
  pendingNativePro: true, localPendingRegistration: true, historyLocalCommandOnly: true, currency: "BRL",
});
const confirmed = (n: number) => ({ id: `trip-${n}`, canonicalTripId: `trip-${n}`, jobId: "job-1", companyId: "company", driverId: "driver", status: "confirmado",
  valor: 1000 + n, createdAt: 1_761_000_000_000 + n, completedAt: 1_761_000_000_000 + n, serverValidatedAt: 1_761_000_000_000 + n,
  tripSyncStatus: "SERVER_CONFIRMED", validationStatus: "approved" });

for (const [status, offline, expected] of [["WAITING", true, "pending"], ["WAITING", false, "pending"], ["SENDING", false, "sending"], ["FAILED", false, "failed"], ["AUTH_REQUIRED", false, "pending"]] as const) {
  const row = nativeRow("a1", status, offline);
  assert.equal(isPendingHistoryTrip(row), true, `${status}: shown as a pending history row`);
  assert.equal(tripSendStatus(row), expected, `${status}: send status`);
}
assert.equal(nativeRow("a1", "WAITING", true).offlineSyncStatus, "awaiting_connection", "offline wording");

// The row sits in the operation history next to the confirmed trips, and the server's row wins once it exists.
const history = [1, 2, 3].map(confirmed);
const merged = mergePendingHistoryTrips(history, [nativeRow("a1", "WAITING", true)]);
assert.equal(merged.length, 4); assert.equal(merged.filter(row => row.localPendingRegistration).length, 1);
assert.equal(mergePendingHistoryTrips(merged, [nativeRow("a1", "SENDING")]).length, 4, "the same attempt is one row");

// TripHistory: both the full history and the embedded "Viagens da operação" use the native rows, minus attempts the server already has.
const source = fs.readFileSync("src/pages/driver/TripHistory.tsx", "utf8");
assert.match(source, /const nativePendingRows = React\.useMemo\(/);
assert.match(source, /if \(embeddedJob && Array\.isArray\(canonicalOperationTripsOverride\)\) \{[\s\S]*?awaitingNative[\s\S]*?mergePendingHistoryTrips\(canonicalOperationTripsOverride, \[\.\.\.pendingHistoryTrips, \.\.\.awaitingNative\]\)/,
  "the embedded list shows the receipts waiting for the network");
assert.match(source, /observedAttempts = new Set\(canonicalOperationTripsOverride\.map/, "an attempt already confirmed is not shown again");
assert.match(source, /offline \? "awaiting_connection" : "pending_sync"/);
console.log("PENDING_HISTORY_ROWS_PASS");
