import { TripRegistrationService } from "./TripRegistrationService";
import type { CanonicalTrip } from "../../domain/trip/CanonicalTrip";
import { createTripRegisteredEvent, type TripRegisteredEvent } from "../../domain/events/TripRegisteredEvent";
import { canonicalTripCommandService } from "./CanonicalTripCommandService";

export class ProTripFinalizationService {
  static finalize(input: Partial<CanonicalTrip>): { trip: CanonicalTrip; event: TripRegisteredEvent } {
    const trip = TripRegistrationService.register({
      ...input,
      source: input.source || "PRO",
      operationId: input.operationId || input.jobId,
    });
    return { trip, event: createTripRegisteredEvent(trip) };
  }

  static async finalizeAndPersist(input: Partial<CanonicalTrip>): Promise<CanonicalTrip> {
    const { trip } = this.finalize(input);
    const result = await canonicalTripCommandService.addTripWithinOperationLimit(trip);
    return (result?.data || trip) as CanonicalTrip;
  }
}
