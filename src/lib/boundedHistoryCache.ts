/** Cache only full records within a small budget; never truncate the live view. */
export const HISTORY_CACHE_MAX_CODE_UNITS = 256 * 1024;

export function fitHistoryCacheBudget<T>(trips: T[]): T[] {
  const result: T[] = [];
  let characters = 1024; // Reserve space for the envelope and array separators.
  for (const trip of trips) {
    try {
      const serialized = JSON.stringify(trip);
      if (!serialized || characters + serialized.length + 1 > HISTORY_CACHE_MAX_CODE_UNITS) continue;
      characters += serialized.length + 1;
      result.push(trip);
    } catch {
      // A non-cacheable record still remains in the authoritative read view.
    }
  }
  return result;
}
