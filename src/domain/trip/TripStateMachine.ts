import { TripStatus } from './CanonicalTrip';

const transitions: Record<TripStatus, TripStatus[]> = {
  CREATED: ['CAPTURED','REGISTERED_LOCAL','DELETED'],
  CAPTURED: ['REGISTERED_LOCAL','DELETED'],
  REGISTERED_LOCAL: ['PENDING_SYNC','SERVER_CONFIRMED','DELETED'],
  PENDING_SYNC: ['SYNCING','DELETED'],
  SYNCING: ['SERVER_CONFIRMED','PENDING_SYNC','DELETED'],
  SERVER_CONFIRMED: ['HISTORY_CONFIRMED','DELETED'],
  HISTORY_CONFIRMED: ['DELETED'],
  DELETED: []
};

export function canTransition(from: TripStatus, to: TripStatus) {
  return transitions[from]?.includes(to) ?? false;
}
