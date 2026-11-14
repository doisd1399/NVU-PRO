import { CanonicalTrip } from '../trip/CanonicalTrip';

export type TripEventType = 'TRIP_REGISTERED';

export interface TripRegisteredEvent {
  type: TripEventType;
  trip: CanonicalTrip;
  createdAt: string;
}

export function createTripRegisteredEvent(trip: CanonicalTrip): TripRegisteredEvent {
  return {
    type: 'TRIP_REGISTERED',
    trip,
    createdAt: new Date().toISOString(),
  };
}
