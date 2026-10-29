/**
 * Motor de reconciliação canônica de viagens.
 * Mantém histórico, ranking e operação usando a mesma regra de identidade.
 */
import { getCanonicalTripId, isCanonicalDeletedTrip } from './tripCanonicalStore';

export type CanonicalTripLifecycle =
  | 'LOCAL_ONLY'
  | 'SYNCING'
  | 'SERVER_RECEIVED'
  | 'VALIDATED'
  | 'CANCELLED'
  | 'DELETED';

const deletedStates = new Set([
  'DELETED', 'deleted', 'CANCELLED', 'CANCELADO', 'cancelled',
]);

export function getTripLifecycle(trip: any): CanonicalTripLifecycle {
  if (isCanonicalDeletedTrip(trip) || deletedStates.has(String(trip?.status || trip?.tripState))) {
    return 'DELETED';
  }
  const status = String(trip?.tripLifecycleStatus || trip?.offlineSyncStatus || '').toUpperCase();
  if (status.includes('PENDING') || status.includes('SYNC')) return 'SYNCING';
  if (status.includes('SERVER')) return 'SERVER_RECEIVED';
  if (status.includes('VALID')) return 'VALIDATED';
  return trip?.id ? 'VALIDATED' : 'LOCAL_ONLY';
}

export function reconcileTrips(...sources: any[][]): any[] {
  const map = new Map<string, any>();
  for (const list of sources.flat()) {
    if (!list) continue;
    const id = getCanonicalTripId(list);
    if (!id) continue;
    if (getTripLifecycle(list) === 'DELETED') {
      map.delete(id);
      continue;
    }
    const previous = map.get(id);
    map.set(id, previous ? { ...previous, ...list, tripLifecycleStatus: getTripLifecycle(list) } : {
      ...list,
      tripLifecycleStatus: getTripLifecycle(list),
    });
  }
  return Array.from(map.values());
}

export function shouldRevalidatePendingTrip(trip: any, maxAgeMs = 5 * 60 * 1000): boolean {
  const state = getTripLifecycle(trip);
  if (state !== 'SYNCING' && state !== 'SERVER_RECEIVED') return false;
  const updated = new Date(trip?.updatedAt || trip?.createdAt || 0).getTime();
  return !updated || Date.now() - updated > maxAgeMs;
}
