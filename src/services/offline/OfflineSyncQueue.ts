import { CanonicalTrip } from "../../domain/trip/CanonicalTrip";

export interface OfflineSyncTask {
  trip: CanonicalTrip;
  attempts: number;
  createdAt: string;
}

/**
 * Fila persistível de sincronização.
 * Mantém operações locais até confirmação do servidor.
 */
export class OfflineSyncQueue {
  private queue = new Map<string, OfflineSyncTask>();

  add(trip: CanonicalTrip) {
    this.queue.set(trip.tripId, {
      trip,
      attempts: 0,
      createdAt: new Date().toISOString()
    });
  }

  remove(id: string) {
    this.queue.delete(id);
  }

  list() {
    return Array.from(this.queue.values());
  }
}
