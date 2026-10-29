/**
 * Canonical trip helpers. All consumers should use these helpers instead of
 * creating local identity/merge rules.
 */
export const getCanonicalTripId = (trip: any): string => {
  return String(
    trip?.physicalDocumentId ||
    trip?.canonicalTripId ||
    trip?.tripId ||
    trip?.idempotencyKey ||
    trip?.clientRequestId ||
    trip?.id ||
    trip?.firestoreId ||
    ""
  ).trim();
};

export const isCanonicalDeletedTrip = (trip: any): boolean =>
  trip?.deleted === true ||
  trip?.tripState === "DELETED" ||
  trip?.status === "DELETED" ||
  trip?.status === "CANCELLED" ||
  trip?.status === "CANCELADO" ||
  trip?.tripState === "CANCELLED" ||
  trip?.tripLifecycleStatus === "DELETED";

export const resolveCanonicalTrips = (trips: any[]): any[] => {
  const map = new Map<string, any>();
  for (const trip of trips || []) {
    if (isCanonicalDeletedTrip(trip)) continue;
    const id = getCanonicalTripId(trip) || `anonymous-${map.size}`;
    const previous = map.get(id);
    if (!previous) {
      map.set(id, trip);
      continue;
    }
    const previousTime = Date.parse(previous.updatedAt || previous.createdAtLocal || "") || 0;
    const currentTime = Date.parse(trip.updatedAt || trip.createdAtLocal || "") || 0;
    if (currentTime >= previousTime) map.set(id, trip);
  }
  return Array.from(map.values());
};
