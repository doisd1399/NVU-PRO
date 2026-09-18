import { useLayoutEffect, useState } from "react";
import { TripsRepository } from "../repositories/TripsRepository";
import { getTripMetricDate } from "../lib/tripNormalizer";
import {
  isAuthTeardownActive,
  onAuthTeardown,
} from "../lib/authLifecycle";
import { filterTombstonedTrips } from "../lib/tripTombstones";

type DriverTripsState = {
  trips: any[];
  loading: boolean;
  error: unknown | null;
};

type DriverTripsEntry = DriverTripsState & {
  driverId: string;
  optimisticTrips: Map<string, any>;
  subscribers: Set<() => void>;
  unsubscribe: (() => void) | null;
  releaseTimer: ReturnType<typeof setTimeout> | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  retryAttempt: number;
};

const RELEASE_DELAY_MS = 120_000;
const RETRY_MAX_DELAY_MS = 30_000;
const PERSISTED_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PERSISTED_TRIP_LIMIT = 180;
const PERSISTED_CACHE_PREFIX = "nvu.persisted.v2.driver-trips.";
const cache = new Map<string, DriverTripsEntry>();
let teardownAttached = false;

const EMPTY_STATE: DriverTripsState = {
  trips: [],
  loading: false,
  error: null,
};

const tripIdentity = (trip: any): string =>
  String(trip?.id || trip?.tripId || trip?.firestoreId || "").trim();

function mergeTrips(remoteTrips: any[], optimisticTrips: Map<string, any>): any[] {
  const merged = new Map<string, any>();
  remoteTrips.forEach((trip, index) => {
    const identity = tripIdentity(trip) || `remote:${index}`;
    merged.set(identity, trip);
    if (identity && optimisticTrips.has(identity)) optimisticTrips.delete(identity);
  });
  for (const [identity, trip] of optimisticTrips.entries()) {
    if (!merged.has(identity)) merged.set(identity, trip);
  }
  return filterTombstonedTrips(Array.from(merged.values()));
}

const persistedCacheKey = (driverId: string) =>
  `${PERSISTED_CACHE_PREFIX}${encodeURIComponent(driverId)}`;

const stripHeavyTripFields = (trip: any) => {
  const compact: Record<string, unknown> = {};
  Object.entries(trip || {}).forEach(([key, value]) => {
    if (typeof value === "string" && value.length > 40_000) return;
    compact[key] = value;
  });
  return compact;
};

const readPersistedTrips = (driverId: string): any[] => {
  try {
    const raw = window.localStorage.getItem(persistedCacheKey(driverId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { trips?: any[]; cachedAt?: number };
    if (
      !Array.isArray(parsed.trips) ||
      typeof parsed.cachedAt !== "number" ||
      Date.now() - parsed.cachedAt > PERSISTED_CACHE_MAX_AGE_MS
    ) {
      window.localStorage.removeItem(persistedCacheKey(driverId));
      return [];
    }
    return filterTombstonedTrips(parsed.trips);
  } catch {
    return [];
  }
};

const writePersistedTrips = (driverId: string, trips: any[]) => {
  try {
    const compactTrips = [...trips]
      .sort(
        (a, b) =>
          getTripMetricDate(b).getTime() - getTripMetricDate(a).getTime(),
      )
      .slice(0, PERSISTED_TRIP_LIMIT)
      .map(stripHeavyTripFields);
    window.localStorage.setItem(
      persistedCacheKey(driverId),
      JSON.stringify({ trips: compactTrips, cachedAt: Date.now() }),
    );
  } catch {
    // Persistent cache is only an acceleration layer.
  }
};

function notify(entry: DriverTripsEntry) {
  entry.subscribers.forEach((subscriber) => subscriber());
}

function ensureTeardown() {
  if (teardownAttached || typeof window === "undefined") return;
  teardownAttached = true;
  onAuthTeardown(() => {
    cache.forEach((entry) => {
      if (entry.releaseTimer) clearTimeout(entry.releaseTimer);
      if (entry.retryTimer) clearTimeout(entry.retryTimer);
      entry.releaseTimer = null;
      entry.retryTimer = null;
      entry.retryAttempt = 0;
      try {
        entry.unsubscribe?.();
      } catch {
        // Cleanup is best-effort.
      }
      entry.unsubscribe = null;
      entry.subscribers.clear();
    });
    cache.clear();
    try {
      for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
        const key = window.localStorage.key(index);
        if (key?.startsWith(PERSISTED_CACHE_PREFIX)) {
          window.localStorage.removeItem(key);
        }
      }
    } catch {
      // Persistent cache cleanup is best-effort during teardown.
    }
  });
}

function scheduleRetry(driverId: string, entry: DriverTripsEntry) {
  if (
    isAuthTeardownActive() ||
    entry.retryTimer ||
    entry.subscribers.size === 0
  ) return;

  const delay = Math.min(
    RETRY_MAX_DELAY_MS,
    1_000 * 2 ** entry.retryAttempt,
  );
  entry.retryAttempt += 1;
  entry.retryTimer = setTimeout(() => {
    entry.retryTimer = null;
    if (
      isAuthTeardownActive() ||
      entry.subscribers.size === 0 ||
      cache.get(driverId) !== entry
    ) return;

    try {
      entry.unsubscribe?.();
    } catch {
      // Listener cleanup is best-effort before a retry.
    }
    entry.unsubscribe = null;
    entry.loading = entry.trips.length === 0;
    subscribeEntry(driverId, entry);
  }, delay);
}

function subscribeEntry(driverId: string, entry: DriverTripsEntry) {
  if (isAuthTeardownActive()) return;

  try {
    entry.unsubscribe = TripsRepository.listenDriverTrips(
      driverId,
      (trips) => {
        if (isAuthTeardownActive() || cache.get(driverId) !== entry) return;
        entry.retryAttempt = 0;
        if (entry.retryTimer) clearTimeout(entry.retryTimer);
        entry.retryTimer = null;
        entry.trips = mergeTrips(filterTombstonedTrips(trips), entry.optimisticTrips);
        entry.loading = false;
        entry.error = null;
        writePersistedTrips(driverId, entry.trips);
        notify(entry);
      },
      (error) => {
        if (isAuthTeardownActive() || cache.get(driverId) !== entry) return;
        console.warn("Error fetching driver trips:", error);
        try {
          entry.unsubscribe?.();
        } catch {
          // Firestore may already have closed the failed listener.
        }
        entry.unsubscribe = null;
        // Keep the most recent confirmed dataset visible. A failed legacy alias
        // query is retried instead of replacing the history with a partial or
        // false-empty result.
        entry.loading = entry.trips.length === 0;
        entry.error = error;
        notify(entry);
        scheduleRetry(driverId, entry);
      },
    );
  } catch (error) {
    if (isAuthTeardownActive() || cache.get(driverId) !== entry) return;
    console.warn("Error subscribing to driver trips:", error);
    entry.loading = entry.trips.length === 0;
    entry.error = error;
    notify(entry);
    scheduleRetry(driverId, entry);
  }
}

function ensureEntry(driverId: string) {
  ensureTeardown();
  const existing = cache.get(driverId);
  if (existing) {
    if (existing.releaseTimer) {
      clearTimeout(existing.releaseTimer);
      existing.releaseTimer = null;
    }
    if (!existing.unsubscribe && !existing.retryTimer) {
      subscribeEntry(driverId, existing);
    }
    return existing;
  }

  const persistedTrips = readPersistedTrips(driverId);
  const entry: DriverTripsEntry = {
    driverId,
    optimisticTrips: new Map(),
    trips: persistedTrips,
    // A non-empty persisted snapshot is immediately displayable. The live
    // listener still reconciles it in the background and can replace it with
    // the authoritative server dataset.
    loading: persistedTrips.length === 0,
    error: null,
    subscribers: new Set(),
    unsubscribe: null,
    releaseTimer: null,
    retryTimer: null,
    retryAttempt: 0,
  };
  cache.set(driverId, entry);
  subscribeEntry(driverId, entry);

  return entry;
}

function snapshot(entry: DriverTripsEntry): DriverTripsState {
  return {
    trips: entry.trips,
    loading: entry.loading,
    error: entry.error,
  };
}

export function publishDriverTripOptimistically(
  driverId: string,
  trip: any,
): void {
  if (isAuthTeardownActive()) return;
  const normalizedId = String(driverId || "").trim();
  const identity = tripIdentity(trip);
  if (!normalizedId || !identity) return;
  const entry = ensureEntry(normalizedId);
  entry.optimisticTrips.set(identity, trip);
  entry.trips = mergeTrips(entry.trips, entry.optimisticTrips);
  entry.loading = false;
  entry.error = null;
  writePersistedTrips(normalizedId, entry.trips);
  notify(entry);
}

export function removeDriverTripOptimistically(
  driverId: string,
  tripId: string,
): void {
  const entry = cache.get(String(driverId || "").trim());
  const normalizedId = String(tripId || "").trim();
  if (!entry || !normalizedId) return;
  entry.optimisticTrips.delete(normalizedId);
  entry.trips = entry.trips.filter((trip) => tripIdentity(trip) !== normalizedId);
  writePersistedTrips(entry.driverId, entry.trips);
  notify(entry);
}

export function useDriverTrips(
  driverId: string | null | undefined,
  options: { enabled?: boolean } = {},
) {
  ensureTeardown();
  const enabled = options.enabled !== false;
  const normalizedId = enabled ? String(driverId || "").trim() : "";
  const [state, setState] = useState<DriverTripsState>(() => {
    if (!normalizedId) return EMPTY_STATE;
    const existing = cache.get(normalizedId);
    if (existing) return snapshot(existing);
    const persistedTrips = readPersistedTrips(normalizedId);
    return {
      trips: persistedTrips,
      loading: persistedTrips.length === 0,
      error: null,
    };
  });

  useLayoutEffect(() => {
    if (!normalizedId || isAuthTeardownActive()) {
      setState(EMPTY_STATE);
      return;
    }

    const entry = ensureEntry(normalizedId);
    const update = () => setState(snapshot(entry));
    entry.subscribers.add(update);
    if (!entry.unsubscribe && !entry.retryTimer) {
      subscribeEntry(normalizedId, entry);
    }
    update();

    return () => {
      entry.subscribers.delete(update);
      if (entry.subscribers.size > 0) return;
      entry.releaseTimer = setTimeout(() => {
        entry.releaseTimer = null;
        if (entry.subscribers.size > 0) return;
        try {
          entry.unsubscribe?.();
        } catch {
          // Cleanup is best-effort.
        }
        entry.unsubscribe = null;
        if (entry.retryTimer) clearTimeout(entry.retryTimer);
        entry.retryTimer = null;
        entry.retryAttempt = 0;
        if (cache.get(normalizedId) === entry) cache.delete(normalizedId);
      }, RELEASE_DELAY_MS);
    };
  }, [normalizedId, enabled]);

  return state;
}
