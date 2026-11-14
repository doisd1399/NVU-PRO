import type { CanonicalTrip } from "../../../domain/trip/CanonicalTrip";
import type { CanonicalTripPersistenceGateway } from "./CanonicalTripPersistenceGateway";
import { OfflineFirstTripRepository } from "../../../services/offline/OfflineFirstTripRepository";

/** Official write gateway. It always commits to CanonicalTripRepository first. */
export class OfflineFirstCanonicalTripGateway implements CanonicalTripPersistenceGateway {
  constructor(private readonly repository = new OfflineFirstTripRepository()) {}

  async save(trip: CanonicalTrip): Promise<CanonicalTrip> {
    return this.repository.saveLocal(trip);
  }

  async update(trip: CanonicalTrip): Promise<CanonicalTrip> {
    return this.repository.updateLocal({ ...trip, updatedAt: new Date().toISOString() });
  }

  async editFields(tripId: string, patch: Record<string, unknown>, actorUserId: string): Promise<CanonicalTrip> {
    return this.repository.editFieldsLocal(tripId, patch, actorUserId);
  }

  async remove(tripId: string, actorUserId?: string): Promise<void> {
    return this.repository.deleteLocal(tripId, actorUserId);
  }
}

export const offlineFirstCanonicalTripGateway = new OfflineFirstCanonicalTripGateway();
