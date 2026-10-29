import type { CanonicalTrip } from "../../domain/trip/CanonicalTrip";
import { OfflineDatabase } from "./OfflineDatabase";
import { syncEngine, type SyncEngine } from "../sync/SyncEngine";
import { CanonicalTripRepository } from "../../repositories/CanonicalTripRepository";

/** Compatibility name retained for callers; authority is CanonicalTripRepository. */
export class OfflineFirstTripRepository extends CanonicalTripRepository {
  // CanonicalTripRepository commits record and outbox atomically through SyncEngine.
  private readonly syncEngineInstance: SyncEngine;

  constructor(database = new OfflineDatabase(), syncEngineInstance = syncEngine) {
    super({ database, queue: syncEngineInstance });
    this.syncEngineInstance = syncEngineInstance;
  }

  async saveLocal(trip: CanonicalTrip): Promise<CanonicalTrip> {
    return super.saveLocal(trip);
  }

  async deleteLocal(tripId: string, actorUserId?: string): Promise<void> {
    return super.deleteLocal(tripId, actorUserId);
  }
}
