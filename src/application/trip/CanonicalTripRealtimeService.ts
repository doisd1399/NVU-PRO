import { canonicalTripRepository } from "../../repositories/CanonicalTripRepository";
import { canonicalTripStore } from "../../lib/CanonicalTripStore";
import type { CanonicalTrip } from "../../domain/trip/CanonicalTrip";

export class CanonicalTripRealtimeService {
  private listeners = new Set<(trips: CanonicalTrip[]) => void>();
  /** Compatibility facade over the repository; it does not own another store. */
  private readonly offlineDatabase = {
    list: () => canonicalTripRepository.listIncludingDeleted().map((trip) => ({ trip })),
  };

  private snapshot(): CanonicalTrip[] {
    const localRecords = this.offlineDatabase.list();
    const canonical = canonicalTripStore.list();
    const ids = new Set([
      ...localRecords.map((record) => String(record.trip.canonicalTripId || record.trip.tripId || "")),
      ...canonical.map((trip) => String(trip.canonicalTripId || trip.tripId || "")),
    ]);
    return canonicalTripRepository.list().filter((trip) => ids.has(String(trip.canonicalTripId || trip.tripId || "")));
  }

  subscribe(listener: (trips: CanonicalTrip[]) => void) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  publish() {
    const snapshot = this.snapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}

export const canonicalTripRealtimeService = new CanonicalTripRealtimeService();
