/**
 * The two historical schemas are compatibility details, not two UI states.
 * Every consumer must receive one complete, deterministic dataset.
 */

export type TripSourceRecord = {
  id: string;
  [key: string]: any;
};

/**
 * A listener may only publish after both the canonical realtime query and the
 * legacy compatibility read have resolved. This is deliberately shared by
 * every viewport and every trip screen.
 */
export function areTripSourcesReady(
  canonicalReady: boolean,
  legacyReady: boolean,
): boolean {
  return canonicalReady && legacyReady;
}

/**
 * Merge the compatibility records first and the canonical records last.
 * A canonical document wins when the same Firestore id appears in both
 * sources. Map insertion order is stable, so mobile, desktop and native
 * WebViews render the same logical sequence for the same server snapshot.
 */
export function mergeTripSources<T extends TripSourceRecord>(
  canonicalTrips: readonly T[],
  legacyTrips: readonly T[],
): T[] {
  const merged = new Map<string, T>();
  legacyTrips.forEach((trip) => merged.set(trip.id, trip));
  canonicalTrips.forEach((trip) => merged.set(trip.id, trip));
  return Array.from(merged.values());
}
