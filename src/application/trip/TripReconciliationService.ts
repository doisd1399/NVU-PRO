import type { CanonicalTrip } from "../../domain/trip/CanonicalTrip";
import { canonicalTripStore } from "../../lib/CanonicalTripStore";
import { canonicalTripRealtimeService } from "./CanonicalTripRealtimeService";
import { TripEventBus } from "../../domain/events/TripEventBus";
import { createTripRegisteredEvent } from "../../domain/events/TripRegisteredEvent";
import { operationReconciliationService } from "../../services/operationReconciliationService";
import { rankingProjectionService } from "../ranking/RankingProjectionService";

export interface TripReconciliationHandlers {
  updateOperation?: (trip: CanonicalTrip) => void | Promise<void>;
  updateHistory?: (trip: CanonicalTrip) => void | Promise<void>;
  updateEarnings?: (trip: CanonicalTrip) => void | Promise<void>;
}

/** Canonical confirmation fan-out for all derived projections. */
export class TripReconciliationService {
  constructor(private readonly handlers: TripReconciliationHandlers = {}) {}

  async reconcileConfirmedTrip(trip: CanonicalTrip) {
    canonicalTripStore.upsert(trip);
    canonicalTripRealtimeService.publish();
    operationReconciliationService.reconcileAfterTripChange(trip);
    rankingProjectionService.invalidate(trip.deleted ? "TRIP_DELETED" : "SERVER_CONFIRMED");
    TripEventBus.publish(createTripRegisteredEvent(trip));
    await this.handlers.updateOperation?.(trip);
    await this.handlers.updateHistory?.(trip);
    await this.handlers.updateEarnings?.(trip);
    return { reconciled: true, tripId: trip.tripId, timestamp: new Date().toISOString() };
  }
}
