import { useLayoutEffect, useState } from "react";
import { TripsRepository } from "../repositories/TripsRepository";
import { getTripMetricDate } from "../lib/tripNormalizer";
import {
  isAuthTeardownActive,
  onAuthTeardown,
} from "../lib/authLifecycle";
import {
  buildTripHistoryCacheScope,
  readTripHistoryCache,
  writeTripHistoryCache,
  type TripHistoryCacheScope,
} from "../lib/tripHistoryPersistentCache";
import {
  filterTombstonedTrips,
  isTripTombstoned,
} from "../lib/tripTombstones";

type TripHistoryState = {
  trips: any[];
  loading: boolean;
  refreshing: boolean;
  error: any;
};

type TripHistoryCacheEntry = TripHistoryState & {
  key: string;
  scope: TripHistoryCacheScope;
  remoteTrips: any[];
  optimisticTrips: Map<string, any>;
  listeners: Set<() => void>;
  unsubscribe: (() => void) | null;
  releaseTimer: ReturnType<typeof setTimeout> | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  retryAttempt: number;
};

const CACHE_RELEASE_DELAY_MS = 120_000;
const RETRY_MAX_DELAY_MS = 30_000;
const tripHistoryCache = new Map<string, TripHistoryCacheEntry>();

const EMPTY_STATE: TripHistoryState = {
  trips: [],
  loading: false,
  refreshing: false,
  error: null,
};

let teardownListenerAttached = false;

function scopeKey(scope: TripHistoryCacheScope): string {
  return buildTripHistoryCacheScope(scope);
}

function getInitialState(scope: TripHistoryCacheScope | null): TripHistoryState {
  if (!scope) return EMPTY_STATE;
  const persisted = readTripHistoryCache(scope);
  const trips = filterTombstonedTrips(persisted?.trips || []);
  return {
    trips,
    loading: trips.length === 0,
    refreshing: trips.length > 0,
    error: null,
  };
}

function tripIdentity(trip: any): string {
  const id = String(trip?.id || trip?.tripId || trip?.firestoreId || "").trim();
  return id;
}

function sortTrips(trips: any[]): any[] {
  return [...trips].sort((left, right) => {
    try {
      return getTripMetricDate(right).getTime() - getTripMetricDate(left).getTime();
    } catch {
      return 0;
    }
  });
}

function mergeRemoteAndOptimistic(
  remoteTrips: any[],
  optimisticTrips: Map<string, any>,
): any[] {
  const remoteIdentities = new Set(
    remoteTrips.map(tripIdentity).filter((identity) => Boolean(identity)),
  );
  for (const identity of optimisticTrips.keys()) {
    if (remoteIdentities.has(identity)) optimisticTrips.delete(identity);
  }

  const merged = new Map<string, any>();
  remoteTrips.forEach((trip, index) => {
    const identity = tripIdentity(trip) || `remote:${index}`;
    merged.set(identity, trip);
  });
  for (const [identity, trip] of optimisticTrips.entries()) {
    if (!merged.has(identity)) merged.set(identity, trip);
  }
  return filterTombstonedTrips(sortTrips(Array.from(merged.values())));
}

function writeVisibleCache(entry: TripHistoryCacheEntry): void {
  writeTripHistoryCache(entry.scope, entry.trips, (trip) => {
    try {
      return getTripMetricDate(trip).getTime();
    } catch {
      return 0;
    }
  });
}

function notify(entry: TripHistoryCacheEntry) {
  entry.listeners.forEach((listener) => listener());
}

function ensureTeardownListener() {
  if (teardownListenerAttached || typeof window === "undefined") return;
  teardownListenerAttached = true;
  onAuthTeardown(() => {
    for (const entry of tripHistoryCache.values()) {
      if (entry.releaseTimer) clearTimeout(entry.releaseTimer);
      if (entry.retryTimer) clearTimeout(entry.retryTimer);
      entry.releaseTimer = null;
      entry.retryTimer = null;
      entry.retryAttempt = 0;
      try {
        entry.unsubscribe?.();
      } catch {
        // Cleanup must never abort logout.
      }
      entry.unsubscribe = null;
      entry.remoteTrips = [];
      entry.optimisticTrips.clear();
      entry.trips = [];
      entry.loading = false;
      entry.refreshing = false;
      entry.error = null;
      notify(entry);
      entry.listeners.clear();
    }
    tripHistoryCache.clear();
  });
}

function scheduleEntryRelease(entry: TripHistoryCacheEntry) {
  if (isAuthTeardownActive()) return;
  if (entry.releaseTimer) clearTimeout(entry.releaseTimer);

  entry.releaseTimer = setTimeout(() => {
    entry.releaseTimer = null;
    if (entry.listeners.size > 0) return;

    try {
      entry.unsubscribe?.();
    } catch {
      // Cleanup is best-effort.
    }
    entry.unsubscribe = null;
    if (entry.retryTimer) clearTimeout(entry.retryTimer);
    entry.retryTimer = null;
    entry.retryAttempt = 0;
    if (tripHistoryCache.get(entry.key) === entry) {
      tripHistoryCache.delete(entry.key);
    }
  }, CACHE_RELEASE_DELAY_MS);
}

function scheduleHistoryRetry(entry: TripHistoryCacheEntry) {
  if (isAuthTeardownActive() || entry.retryTimer) return;

  const delay = Math.min(RETRY_MAX_DELAY_MS, 1_000 * 2 ** entry.retryAttempt);
  entry.retryAttempt += 1;
  entry.retryTimer = setTimeout(() => {
    entry.retryTimer = null;
    if (
      isAuthTeardownActive() ||
      entry.listeners.size === 0 ||
      tripHistoryCache.get(entry.key) !== entry
    ) {
      return;
    }
    try {
      entry.unsubscribe?.();
    } catch {
      // Cleanup is best-effort before retry.
    }
    entry.unsubscribe = null;
    entry.loading = entry.trips.length === 0;
    entry.refreshing = entry.trips.length > 0;
    subscribeEntry(entry);
  }, delay);
}

function subscribeEntry(entry: TripHistoryCacheEntry) {
  if (isAuthTeardownActive() || entry.unsubscribe) return;

  try {
    entry.unsubscribe = TripsRepository.listenCompanyTrips(
      entry.scope.companyId,
      (trips) => {
        if (isAuthTeardownActive()) return;
        entry.retryAttempt = 0;
        if (entry.retryTimer) clearTimeout(entry.retryTimer);
        entry.retryTimer = null;
        entry.remoteTrips = filterTombstonedTrips(trips);
        entry.trips = mergeRemoteAndOptimistic(entry.remoteTrips, entry.optimisticTrips);
        entry.loading = false;
        entry.refreshing = false;
        entry.error = null;
        writeVisibleCache(entry);
        notify(entry);
      },
      (error) => {
        if (isAuthTeardownActive()) return;
        console.warn("Error fetching trip history:", error);
        try {
          entry.unsubscribe?.();
        } catch {
          // Firestore may already have closed the failed listener.
        }
        entry.unsubscribe = null;
        entry.error = error;
        entry.loading = entry.trips.length === 0;
        entry.refreshing = entry.trips.length > 0;
        notify(entry);
        scheduleHistoryRetry(entry);
      },
    );
  } catch (error) {
    if (isAuthTeardownActive()) return;
    console.warn("Error subscribing to trip history:", error);
    entry.error = error;
    entry.loading = entry.trips.length === 0;
    entry.refreshing = entry.trips.length > 0;
    notify(entry);
    scheduleHistoryRetry(entry);
  }
}

function ensureEntry(scope: TripHistoryCacheScope): TripHistoryCacheEntry {
  ensureTeardownListener();
  const key = scopeKey(scope);
  const existing = tripHistoryCache.get(key);
  if (existing) {
    if (existing.releaseTimer) {
      clearTimeout(existing.releaseTimer);
      existing.releaseTimer = null;
    }
    if (!existing.unsubscribe && !existing.retryTimer) subscribeEntry(existing);
    return existing;
  }

  const initial = getInitialState(scope);
  const entry: TripHistoryCacheEntry = {
    key,
    scope,
    remoteTrips: initial.trips,
    optimisticTrips: new Map(),
    trips: initial.trips,
    loading: initial.loading,
    refreshing: initial.refreshing,
    error: initial.error,
    listeners: new Set(),
    unsubscribe: null,
    releaseTimer: null,
    retryTimer: null,
    retryAttempt: 0,
  };
  tripHistoryCache.set(key, entry);
  subscribeEntry(entry);
  return entry;
}

function getState(entry: TripHistoryCacheEntry): TripHistoryState {
  return {
    trips: entry.trips,
    loading: entry.loading,
    refreshing: entry.refreshing,
    error: entry.error,
  };
}

type HookState = {
  scopeKey: string;
  value: TripHistoryState;
};

/**
 * Publishes a server-created trip into the single local history store before
 * the Firestore listener echoes it back. The event is keyed by the Firestore
 * document id, so reconciliation removes the optimistic copy exactly once.
 */
export function publishTripHistoryOptimistically(
  scope: TripHistoryCacheScope,
  trip: any,
): void {
  if (isAuthTeardownActive()) return;
  const identity = tripIdentity(trip);
  if (!identity || !scope.userId || !scope.companyId || isTripTombstoned(identity)) return;

  const entry = ensureEntry(scope);
  entry.optimisticTrips.set(identity, trip);
  entry.trips = mergeRemoteAndOptimistic(entry.remoteTrips, entry.optimisticTrips);
  entry.loading = false;
  entry.refreshing = true;
  entry.error = null;
  writeVisibleCache(entry);
  notify(entry);
}

export function updateTripHistoryOptimistically(
  scope: TripHistoryCacheScope,
  tripId: string,
  patch: Record<string, unknown>,
): void {
  const key = scopeKey(scope);
  const normalizedId = String(tripId || "").trim();
  if (!key || !normalizedId) return;
  const entry = tripHistoryCache.get(key);
  if (!entry) return;
  const applyPatch = (trip: any) =>
    tripIdentity(trip) === normalizedId ? { ...trip, ...patch } : trip;
  entry.remoteTrips = entry.remoteTrips.map(applyPatch);
  entry.trips = entry.trips.map(applyPatch);
  writeVisibleCache(entry);
  notify(entry);
}

export function removeTripHistoryOptimistically(
  scope: TripHistoryCacheScope,
  tripId: string,
): void {
  const key = scopeKey(scope);
  const normalizedId = String(tripId || "").trim();
  if (!key || !normalizedId) return;
  const entry = tripHistoryCache.get(key);
  if (!entry) return;
  entry.remoteTrips = entry.remoteTrips.filter((trip) => tripIdentity(trip) !== normalizedId);
  entry.optimisticTrips.delete(normalizedId);
  entry.trips = mergeRemoteAndOptimistic(entry.remoteTrips, entry.optimisticTrips);
  entry.refreshing = false;
  writeVisibleCache(entry);
  notify(entry);
}

export function useTripHistory(
  companyId: string | null | undefined,
  options: { enabled?: boolean; userId?: string | null } = {},
) {
  ensureTeardownListener();
  const enabled = options.enabled !== false;
  const userId = String(options.userId || "").trim();
  const normalizedCompanyId = String(companyId || "").trim();
  const scope = enabled && userId && normalizedCompanyId
    ? { userId, companyId: normalizedCompanyId }
    : null;
  const normalizedScopeKey = scope ? scopeKey(scope) : "";
  const [state, setState] = useState<HookState>(() => ({
    scopeKey: normalizedScopeKey,
    value: getInitialState(scope),
  }));

  useLayoutEffect(() => {
    if (!scope || isAuthTeardownActive()) {
      setState({ scopeKey: "", value: EMPTY_STATE });
      return;
    }

    const entry = ensureEntry(scope);
    const updateState = () =>
      setState({ scopeKey: entry.key, value: getState(entry) });

    entry.listeners.add(updateState);
    if (!entry.unsubscribe && !entry.retryTimer) subscribeEntry(entry);
    updateState();

    return () => {
      entry.listeners.delete(updateState);
      if (entry.listeners.size === 0) scheduleEntryRelease(entry);
    };
  }, [normalizedCompanyId, normalizedScopeKey, scope?.userId]);

  const visibleState = state.scopeKey === normalizedScopeKey
    ? state.value
    : getInitialState(scope);

  return {
    historicoTrips: visibleState.trips,
    loading: visibleState.loading,
    refreshing: visibleState.refreshing,
    error: visibleState.error,
  };
}
