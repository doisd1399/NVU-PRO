import { buildCanonicalOperationProjection } from "./canonicalOperationProjection";

type Data = Record<string, any>;

export function rebuildOperationProjection(input: { physicalJobId: string; operation: Data; confirmedTrips: readonly Data[] }) {
  const liveTrips = input.confirmedTrips
    .filter((trip) => trip.deleted !== true && trip.tombstone !== true && trip.recordStatus !== "deleted" && trip.status !== "DELETED")
    .map((trip, index) => ({ id: String(trip.id ?? trip.tripId ?? `trip-${index}`), data: trip }));
  return buildCanonicalOperationProjection({ physicalJobId: input.physicalJobId, operation: input.operation, confirmedHistory: liveTrips });
}
