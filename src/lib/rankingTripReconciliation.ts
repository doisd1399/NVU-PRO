import type { RawTrip } from './tripNormalizer';
import { normalizeTrip } from './tripNormalizer';

/**
 * Filters ranking inputs through the same canonical validity rules used by
 * history. Aggregates must never count deleted/cancelled/invalid trips.
 */
export function reconcileRankingTrips(trips: readonly RawTrip[]): RawTrip[] {
  return trips.filter((trip) => normalizeTrip(trip).isValid);
}
