import { TripEventBus } from '../../../domain/events/TripEventBus';
import { CanonicalTrip } from '../../../domain/trip/CanonicalTrip';

export class OperationTripConsumer {
  static start(operationHandler?: (trip: CanonicalTrip) => void) {
    return TripEventBus.subscribe(event => {
      if (event.type !== 'TRIP_REGISTERED') return;
      operationHandler?.(event.trip);
    });
  }
}
