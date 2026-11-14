/**
 * Small in-memory sync lock used to prevent concurrent processing of the same
 * operation/trip. Persistence remains the responsibility of the queue/store.
 */
const activeLocks = new Set<string>();

export function acquireTripSyncLock(key: string): boolean {
  const normalized = String(key || "").trim();
  if (!normalized || activeLocks.has(normalized)) return false;
  activeLocks.add(normalized);
  return true;
}

export function releaseTripSyncLock(key: string): void {
  const normalized = String(key || "").trim();
  if (normalized) activeLocks.delete(normalized);
}
