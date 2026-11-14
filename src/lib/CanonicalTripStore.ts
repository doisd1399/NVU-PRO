import type { CanonicalTrip, TripStatus } from "../domain/trip/CanonicalTrip";
import { getCanonicalTripId, isCanonicalDeletedTrip } from "./tripCanonicalStore";

const revisionOf = (trip: Partial<CanonicalTrip>): number => {
  const syncVersion = Number(trip.syncVersion || 0);
  const updated = Date.parse(String(trip.updatedAt || trip.clientUpdatedAt || trip.createdAt || ""));
  return syncVersion * 1_000_000_000_000 + (Number.isFinite(updated) ? updated : 0);
};

/** In-memory projection owned by CanonicalTripRepository. */
export class CanonicalTripStore {
  private trips = new Map<string, CanonicalTrip>();

  upsert(trip: CanonicalTrip): CanonicalTrip {
    const id = getCanonicalTripId(trip);
    if (!id) throw new Error("CANONICAL_TRIP_ID_REQUIRED");
    const previous = this.trips.get(id);
    const previousDeleted = Boolean(previous && isCanonicalDeletedTrip(previous));
    const incomingDeleted = isCanonicalDeletedTrip(trip);
    if (previousDeleted && !incomingDeleted) return previous!;
    if (previous && revisionOf(trip) < revisionOf(previous)) return previous;
    this.trips.set(id, { ...trip, physicalDocumentId: trip.physicalDocumentId || undefined });
    return this.trips.get(id)!;
  }

  get(id: string): CanonicalTrip | undefined {
    return this.trips.get(String(id || "").trim());
  }

  /** Only a transaction ACK or an explicit rollback may replace a pending edit. */
  replaceAuthoritative(trip: CanonicalTrip): CanonicalTrip {
    const id = getCanonicalTripId(trip);
    if (!id) throw new Error("CANONICAL_TRIP_ID_REQUIRED");
    const previous = this.trips.get(id);
    if (previous && isCanonicalDeletedTrip(previous) && !isCanonicalDeletedTrip(trip)) return previous;
    this.trips.set(id, { ...trip, physicalDocumentId: trip.physicalDocumentId || undefined });
    return this.trips.get(id)!;
  }

  listIncludingDeleted(): CanonicalTrip[] {
    return Array.from(this.trips.values());
  }

  list(): CanonicalTrip[] {
    return this.listIncludingDeleted().filter((trip) => !isCanonicalDeletedTrip(trip));
  }

  remove(id: string): void {
    const normalizedId = String(id || "").trim();
    const trip = this.trips.get(normalizedId);
    if (!trip) return;
    const now = new Date().toISOString();
    this.trips.set(normalizedId, {
      ...trip,
      status: "DELETED" as TripStatus,
      recordStatus: "DELETED",
      deleted: true,
      deletedAt: now,
      updatedAt: now,
      clientUpdatedAt: now,
      syncVersion: Number(trip.syncVersion || 0) + 1,
    });
  }

  /** Forget a device-local projection without creating a deletion tombstone. */
  purge(id: string): void { this.trips.delete(String(id || "").trim()); }

  clear(): void { this.trips.clear(); }
}

export const canonicalTripStore = new CanonicalTripStore();
