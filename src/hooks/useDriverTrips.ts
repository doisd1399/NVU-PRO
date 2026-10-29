import { useLayoutEffect, useState } from "react";
import { CanonicalTripQueryService } from "../application/trip/CanonicalTripQueryService";
import { getTripMetricDate } from "../lib/tripNormalizer";
import {
  isAuthTeardownActive,
  onAuthTeardown,
} from "../lib/authLifecycle";
import { filterTombstonedTrips } from "../lib/tripTombstones";
import { onCanonicalTripUpdated } from "../lib/CanonicalTripUpdateEvent";
import type { TripReadCoverage, TripReadCoverageStatus } from "../lib/tripReadCoverage";
import { fitHistoryCacheBudget } from "../lib/boundedHistoryCache";

type DriverTripsState = {
  trips: any[];
  loading: boolean;
  error: unknown | null;
  historyReady: boolean;
  coverage: TripReadCoverageStatus;
  readCoverage: TripReadCoverage | null;
  refreshing: boolean;
};

type DriverTripsEntry = DriverTripsState & {
  driverId: string;
  remoteReady: boolean;
  remoteTrips: any[];
  optimisticTrips: Map<string, any>;
  subscribers: Set<() => void>;
  unsubscribe: (() => void) | null;
  releaseTimer: ReturnType<typeof setTimeout> | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  retryAttempt: number;
  subscriptionGeneration: number;
  notifyQueued?: boolean;
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
  historyReady: false,
  coverage: "unknown",
  readCoverage: null,
  refreshing: false,
};

const tripIdentity = (trip: any): string =>
  String(trip?.physicalDocumentId || trip?.canonicalTripId || trip?.id || trip?.tripId || trip?.firestoreId || "").trim();

function mergeTrips(remoteTrips: any[], optimisticTrips: Map<string, any>): any[] {
  const merged = new Map<string, any>();
  remoteTrips.forEach((trip, index) => {
    const identity = tripIdentity(trip) || `remote:${index}`;
    merged.set(identity, trip);
    if (identity && optimisticTrips.has(identity)) optimisticTrips.delete(identity);
  });
  for (const [identity, trip] of optimisticTrips.entries()) {
    if (!merged.has(identity)) merged.set(identity, { ...trip, historyLocalCommandOnly: true });
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

const readPersistedTrips = (driverId: string): { trips: any[]; historyReady: boolean } => {
  try {
    const raw = window.localStorage.getItem(persistedCacheKey(driverId));
    if (!raw) return { trips: [], historyReady: false };
    const parsed = JSON.parse(raw) as { trips?: any[]; cachedAt?: number };
    if (
      !Array.isArray(parsed.trips) ||
      typeof parsed.cachedAt !== "number" ||
      Date.now() - parsed.cachedAt > PERSISTED_CACHE_MAX_AGE_MS
    ) {
      window.localStorage.removeItem(persistedCacheKey(driverId));
      return { trips: [], historyReady: false };
    }
    return { trips: filterTombstonedTrips(parsed.trips), historyReady: true };
  } catch {
    return { trips: [], historyReady: false };
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
      JSON.stringify({ trips: fitHistoryCacheBudget(compactTrips), cachedAt: Date.now() }),
    );
  } catch {
    // Persistent cache is only an acceleration layer.
  }
};

function notify(entry: DriverTripsEntry) {
  if (entry.notifyQueued) return;
  entry.notifyQueued = true;
  queueMicrotask(() => {
    entry.notifyQueued = false;
    entry.subscribers.forEach((subscriber) => subscriber());
  });
}

function ensureTeardown() {
  if (teardownAttached || typeof window === "undefined") return;
  teardownAttached = true;
  onCanonicalTripUpdated((trip) => {
    if (!trip?.deleted) return;
    cache.forEach((entry) => {
      const visible = filterTombstonedTrips(entry.trips);
      if (visible.length === entry.trips.length) return;
      entry.trips = visible;
      entry.historyReady = true;
      entry.loading = false;
      writePersistedTrips(entry.driverId, visible);
      notify(entry);
    });
  });
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
      entry.subscriptionGeneration += 1;
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
  if (isAuthTeardownActive() || entry.unsubscribe) return;
  const generation = ++entry.subscriptionGeneration;
  const isCurrent = () => !isAuthTeardownActive() &&
    cache.get(driverId) === entry && generation === entry.subscriptionGeneration;
  entry.coverage = "unknown";
  entry.readCoverage = null;
  entry.refreshing = true;
  notify(entry);

  try {
    const stop = CanonicalTripQueryService.listenDriverTrips(
      driverId,
      (trips) => {
        if (!isCurrent()) return;
        entry.remoteTrips = filterTombstonedTrips(trips);
        if (entry.historyReady && entry.coverage !== "complete") return;
        entry.trips = mergeTrips(entry.remoteTrips, entry.optimisticTrips);
        entry.historyReady = entry.historyReady || entry.trips.length > 0;
        entry.loading = !entry.historyReady;
        if (entry.historyReady) writePersistedTrips(driverId, entry.trips);
        notify(entry);
      },
      (error) => {
        if (!isCurrent()) return;
        console.warn("Error fetching driver trips:", error);
        // The other identity query can still deliver historical rows. Preserve
        // it until the retry timer replaces this generation.
        // Keep the most recent confirmed dataset visible. A failed legacy alias
        // query is retried instead of replacing the history with a partial or
        // false-empty result.
        entry.trips = mergeTrips([...entry.trips, ...entry.remoteTrips], entry.optimisticTrips);
        entry.historyReady ||= entry.trips.length > 0;
        entry.loading = !entry.historyReady;
        entry.error = error;
        entry.coverage = "partial";
        entry.refreshing = true;
        notify(entry);
        scheduleRetry(driverId, entry);
      },
      () => {
        if (!isCurrent()) return;
        entry.remoteReady = true;
        entry.historyReady ||= entry.trips.length > 0;
        entry.loading = !entry.historyReady;
        notify(entry);
      },
      (coverage) => {
        if (!isCurrent()) return;
        entry.readCoverage = coverage;
        entry.coverage = coverage.projectionMode === "scoped-history" ? coverage.status
          : coverage.status === "complete" && entry.optimisticTrips.size > 0 ? "partial" : coverage.status;
        entry.refreshing = entry.coverage !== "complete";
        if (coverage.status === "complete") {
          entry.trips = mergeTrips(entry.remoteTrips, entry.optimisticTrips);
          entry.historyReady = true;
          entry.loading = false;
          entry.error = null;
          entry.retryAttempt = 0;
          if (entry.retryTimer) clearTimeout(entry.retryTimer);
          entry.retryTimer = null;
          writePersistedTrips(driverId, entry.trips);
        }
        notify(entry);
      },
    );
    if (!isCurrent()) stop();
    else entry.unsubscribe = stop;
  } catch (error) {
    if (isAuthTeardownActive() || cache.get(driverId) !== entry) return;
    console.warn("Error subscribing to driver trips:", error);
    entry.loading = !entry.historyReady;
    entry.error = error;
    entry.coverage = "partial";
    entry.refreshing = true;
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

  const persisted = readPersistedTrips(driverId);
  const entry: DriverTripsEntry = {
    driverId,
    remoteReady: false,
    remoteTrips: [],
    optimisticTrips: new Map(),
    trips: persisted.trips,
    // A non-empty persisted snapshot is immediately displayable. The live
    // listener still reconciles it in the background and can replace it with
    // the authoritative server dataset.
    loading: !persisted.historyReady,
    error: null,
    historyReady: persisted.historyReady,
    coverage: "unknown",
    readCoverage: null,
    refreshing: true,
    subscribers: new Set(),
    unsubscribe: null,
    releaseTimer: null,
    retryTimer: null,
    retryAttempt: 0,
    subscriptionGeneration: 0,
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
    historyReady: entry.historyReady,
    coverage: entry.coverage,
    readCoverage: entry.readCoverage,
    refreshing: entry.refreshing,
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
  entry.historyReady = true;
  entry.coverage = "partial";
  entry.refreshing = true;
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
  const getInitialState = (): DriverTripsState => {
    if (!normalizedId) return EMPTY_STATE;
    const existing = cache.get(normalizedId);
    if (existing) return snapshot(existing);
    const persisted = readPersistedTrips(normalizedId);
    return {
      trips: persisted.trips,
      loading: !persisted.historyReady,
      error: null,
      historyReady: persisted.historyReady,
      coverage: "unknown",
      readCoverage: null,
      refreshing: true,
    };
  };
  const [state, setState] = useState(() => ({ driverId: normalizedId, value: getInitialState() }));

  useLayoutEffect(() => {
    if (!normalizedId || isAuthTeardownActive()) {
      setState({ driverId: "", value: EMPTY_STATE });
      return;
    }

    const entry = ensureEntry(normalizedId);
    const update = () => {
      const value = snapshot(entry);
      setState(previous => previous.driverId === normalizedId && Object.keys(value).every(key => previous.value[key as keyof DriverTripsState] === value[key as keyof DriverTripsState])
        ? previous : { driverId: normalizedId, value });
    };
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
        entry.subscriptionGeneration += 1;
        const idle = [...cache.values()].filter(item => !item.subscribers.size && !item.unsubscribe && !item.optimisticTrips.size);
        for (const item of idle.slice(0, Math.max(0, idle.length - 6))) cache.delete(item.driverId);
      }, RELEASE_DELAY_MS);
    };
  }, [normalizedId, enabled]);

  // Do not expose the previous driver's projection before the scope effect runs.
  return state.driverId === normalizedId ? state.value : getInitialState();
}
