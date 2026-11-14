import type { CanonicalTrip } from "../../domain/trip/CanonicalTrip";
import type { OperationalIdentity } from "../../domain/operation/OperationalIdentity";
import { isCanonicalConfirmedTrip } from "../../../functions/src/isCanonicalConfirmedTrip";

export type CanonicalOperationProjection = {
  operationId: string;
  driverId: string;
  companyId: string;
  contractId: string;
  totalDeliveries: number;
  confirmedTrips: CanonicalTrip[];
  confirmedTripIds: string[];
  confirmedTripCount: number;
  remainingTrips: number;
  nextSlot: number | null;
  status: "pending" | "active" | "delayed" | "completed" | "cancelled" | "awaiting_completion";
  nextAllowedAction: "WAIT_FOR_OPERATION" | "RECORD_TRIP" | "FINALIZE_OPERATION" | "OPERATION_COMPLETE";
  projectionStale: boolean;
};

const text = (value: unknown) => String(value ?? "").trim();
const tripId = (trip: CanonicalTrip) => text(trip.canonicalTripId || trip.tripId || trip.id || trip.idempotencyKey);
const matchesOperationScope = (trip: any, identity: OperationalIdentity): boolean => {
  return isCanonicalConfirmedTrip(trip, identity);
};

export function buildOperationProjection(input: {
  identity: OperationalIdentity;
  operation: Record<string, unknown>;
  confirmedHistory: CanonicalTrip[];
  projectionHints?: { progress?: unknown; slots?: unknown; snapshot?: unknown };
}): CanonicalOperationProjection {
  const { identity, operation, confirmedHistory } = input;
  const unique = new Map<string, CanonicalTrip>();
  for (const trip of confirmedHistory) {
    const id = tripId(trip);
    if (!id || !matchesOperationScope(trip, identity)) continue;
    unique.set(id, trip);
  }
  const confirmedTrips = [...unique.values()];
  const confirmedTripCount = confirmedTrips.length;
  const rawTotal = Number(operation.totalDeliveries || 0);
  const totalDeliveries = Number.isFinite(rawTotal) ? Math.max(0, Math.floor(rawTotal)) : 0;
  const operationStatus = text(operation.status || "active").toLowerCase();
  const targetReached = totalDeliveries > 0 && confirmedTripCount >= totalDeliveries;
  // Only an acknowledged lifecycle transition can finish an operation. A full
  // ledger makes it ready for manual completion; an incomplete local cache
  // cannot undo a server-confirmed completion or cancellation.
  const status = operationStatus === "cancelled" ? "cancelled" :
    operationStatus === "completed" ? "completed" :
    operationStatus === "pending" ? "pending" :
    targetReached || operationStatus === "awaiting_completion" ? "awaiting_completion" :
    operationStatus === "delayed" ? "delayed" : "active";
  const closed = status === "completed" || status === "cancelled";
  const readyToFinalize = status === "awaiting_completion";
  return {
    operationId: identity.operationId,
    driverId: identity.driverId,
    companyId: identity.companyId,
    contractId: identity.contractId,
    totalDeliveries,
    confirmedTrips,
    confirmedTripIds: confirmedTrips.map(tripId),
    confirmedTripCount,
    remainingTrips: totalDeliveries > 0 ? Math.max(0, totalDeliveries - confirmedTripCount) : 0,
    nextSlot: closed || readyToFinalize || status === "pending" ? null : confirmedTripCount + 1,
    status,
    nextAllowedAction: status === "pending" ? "WAIT_FOR_OPERATION" : closed ? "OPERATION_COMPLETE" : readyToFinalize ? "FINALIZE_OPERATION" : "RECORD_TRIP",
    projectionStale: input.projectionHints !== undefined && (
      Number(input.projectionHints.progress) !== confirmedTripCount ||
      (Array.isArray(input.projectionHints.slots) && input.projectionHints.slots.length !== confirmedTripCount)
    ),
  };
}
