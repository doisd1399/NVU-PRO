export type TripHistoryCacheScope = {
  userId: string;
  companyId: string;
};

export type TripHistoryCacheRecord<T = any> = {
  version: 2;
  scope: string;
  cachedAt: number;
  trips: T[];
};

const CACHE_VERSION = 2 as const;
const CACHE_PREFIX = "nvu.trips.v2:";
const MAX_TRIPS = 240;

function normalizePart(value: unknown): string {
  return String(value || "").trim();
}

export function buildTripHistoryCacheScope(
  scope: TripHistoryCacheScope,
): string {
  const userId = normalizePart(scope.userId);
  const companyId = normalizePart(scope.companyId);
  if (!userId || !companyId) return "";
  return `user:${encodeURIComponent(userId)}:company:${encodeURIComponent(companyId)}`;
}

function cacheKey(scopeKey: string): string {
  return `${CACHE_PREFIX}${encodeURIComponent(scopeKey)}`;
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isValidTripRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function readTripHistoryCache<T = any>(
  scope: TripHistoryCacheScope,
): TripHistoryCacheRecord<T> | null {
  const scopeKey = buildTripHistoryCacheScope(scope);
  const targetStorage = storage();
  if (!scopeKey || !targetStorage) return null;

  try {
    const raw = targetStorage.getItem(cacheKey(scopeKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TripHistoryCacheRecord<T>>;
    if (
      parsed.version !== CACHE_VERSION ||
      parsed.scope !== scopeKey ||
      typeof parsed.cachedAt !== "number" ||
      !Number.isFinite(parsed.cachedAt) ||
      parsed.cachedAt <= 0 ||
      !Array.isArray(parsed.trips) ||
      parsed.trips.some((trip) => !isValidTripRecord(trip))
    ) {
      targetStorage.removeItem(cacheKey(scopeKey));
      return null;
    }
    return {
      version: CACHE_VERSION,
      scope: scopeKey,
      cachedAt: parsed.cachedAt,
      trips: parsed.trips.slice(0, MAX_TRIPS) as T[],
    };
  } catch {
    try {
      targetStorage.removeItem(cacheKey(scopeKey));
    } catch {
      // Corrupt storage is non-fatal and must never break the History page.
    }
    return null;
  }
}

export function writeTripHistoryCache<T = any>(
  scope: TripHistoryCacheScope,
  trips: T[],
  getSortTime?: (trip: T) => number,
): void {
  const scopeKey = buildTripHistoryCacheScope(scope);
  const targetStorage = storage();
  if (!scopeKey || !targetStorage || !Array.isArray(trips)) return;

  try {
    const safeTrips = [...trips]
      .filter(isValidTripRecord)
      .sort((left, right) => {
        if (!getSortTime) return 0;
        return getSortTime(right as T) - getSortTime(left as T);
      })
      .slice(0, MAX_TRIPS);
    const record: TripHistoryCacheRecord<T> = {
      version: CACHE_VERSION,
      scope: scopeKey,
      cachedAt: Date.now(),
      trips: safeTrips,
    };
    targetStorage.setItem(cacheKey(scopeKey), JSON.stringify(record));
  } catch {
    // localStorage is an acceleration layer; React/Firestore remain authoritative.
  }
}

export function removeTripHistoryCache(scope: TripHistoryCacheScope): void {
  const scopeKey = buildTripHistoryCacheScope(scope);
  const targetStorage = storage();
  if (!scopeKey || !targetStorage) return;
  try {
    targetStorage.removeItem(cacheKey(scopeKey));
  } catch {
    // Best-effort cleanup.
  }
}

export function clearTripHistoryCacheForUser(userId: string): void {
  const normalizedUserId = normalizePart(userId);
  const targetStorage = storage();
  if (!normalizedUserId || !targetStorage) return;
  const prefix = `${CACHE_PREFIX}${encodeURIComponent(`user:${normalizedUserId}:`)}`;
  try {
    for (let index = targetStorage.length - 1; index >= 0; index -= 1) {
      const key = targetStorage.key(index);
      if (key?.startsWith(prefix)) targetStorage.removeItem(key);
    }
  } catch {
    // Best-effort cleanup during explicit logout.
  }
}

export function clearTripHistoryCacheForScope(scopeKey: string): void {
  const targetStorage = storage();
  if (!scopeKey || !targetStorage) return;
  try {
    targetStorage.removeItem(cacheKey(scopeKey));
  } catch {
    // Best-effort cleanup.
  }
}

export const tripHistoryCacheContract = {
  version: CACHE_VERSION,
  prefix: CACHE_PREFIX,
  maxTrips: MAX_TRIPS,
} as const;
