import { getTripMetricAssessment } from "./tripMetricPolicy";
import { isTripTombstoned } from "./tripTombstones";
import { isCanonicalConfirmedTrip } from "../../functions/src/isCanonicalConfirmedTrip";

const identity = (trip: any) => String(trip?.physicalDocumentId || trip?.canonicalTripId || trip?.tripId || trip?.id || "").trim();

/** Display permission only. This never grants metric or operation eligibility. */
export function isPendingHistoryTrip(trip: any): boolean {
  const assessment = getTripMetricAssessment(trip);
  return trip?.localPendingRegistration === true && !assessment.eligible &&
    !assessment.deletedOrCanceled && assessment.valid && Boolean(identity(trip)) &&
    !isTripTombstoned(identity(trip));
}

/** The journal and its command are already durable before a row is exposed. */
export function pendingRegistrationHistoryRows(items: any[], offline: boolean): any[] {
  return items.map(item => {
    const id = identity(item.trip);
    if (item.state === "SERVER_CONFIRMED" && isCanonicalConfirmedTrip(item.trip, {
      operationId: item.trip.jobId, driverId: item.trip.driverId, companyId: item.trip.companyId, contractId: item.trip.contractId,
    })) return { ...item.trip, id, historyLocalCommandOnly: false, localPendingRegistration: false };
    if (item.state === "SERVER_CONFIRMED") return null;
    const failed = item.state === "FAILED" || item.state === "CONFLICT";
    return { ...item.trip, id, tripId: id, canonicalTripId: id,
      localPendingRegistration: true, historyLocalCommandOnly: true,
      offlineSyncStatus: failed ? "validation_failed" : item.state === "SYNCING" ? "syncing" : offline ? "awaiting_connection" : "pending_sync",
      offlineSyncError: item.lastError || "", tripSyncStage: item.lastFailureStage || "",
    };
  }).filter(trip => trip && !isTripTombstoned(identity(trip)) && (isPendingHistoryTrip(trip) || getTripMetricAssessment(trip).eligible));
}

/** Replace by the same physical identity; a server observation wins over an old command. */
export function mergePendingHistoryTrips(history: any[], pending: any[]): any[] {
  const rows = new Map<string, any>();
  const capturedEvidence = (trip: any) => {
    const scope = [trip.driverId || trip.motoristaId, trip.companyId || trip.empresaId, trip.jobId];
    return scope.every(Boolean) && trip.imageHash ? JSON.stringify([...scope, trip.imageHash]) : "";
  };
  history.forEach((trip, index) => rows.set(identity(trip) || `historical:${index}`, trip));
  for (const trip of pending) {
    const id = identity(trip), evidence = capturedEvidence(trip);
    const existing = rows.has(id) ? [id, rows.get(id)] as const
      : evidence ? [...rows.entries()].find(([, row]) => capturedEvidence(row) === evidence) : undefined;
    if (existing && getTripMetricAssessment(existing[1]).eligible) continue;
    if (id) { if (existing && existing[0] !== id) rows.delete(existing[0]); rows.set(id, trip); }
  }
  return [...rows.values()];
}

export function tripSendStatus(trip: any): "pending" | "sending" | "failed" | "confirmed" {
  if (!isPendingHistoryTrip(trip)) return "confirmed";
  return trip.offlineSyncStatus === "validation_failed" ? "failed"
    : ["syncing", "uploading"].includes(trip.offlineSyncStatus) ? "sending" : "pending";
}
