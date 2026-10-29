import { TripEventBus } from '../../../domain/events/TripEventBus';
import { CanonicalTrip } from '../../../domain/trip/CanonicalTrip';

export class HistoryTripConsumer {
  static start(historyHandler?: (trip: CanonicalTrip) => void) {
    return TripEventBus.subscribe(event => {
      if (event.type !== 'TRIP_REGISTERED') return;
      historyHandler?.(event.trip);
    });
  }
}
