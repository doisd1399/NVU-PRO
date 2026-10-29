import { useLayoutEffect, useState } from "react";
import { CanonicalTripQueryService } from "../application/trip/CanonicalTripQueryService";
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
import { reconcileTrips } from "../lib/tripReconciliationEngine";
import type { TripReadCoverage, TripReadCoverageStatus } from "../lib/tripReadCoverage";
import { getCanonicalTripId } from "../lib/tripCanonicalStore";

type TripHistoryState = {
  trips: any[];
  loading: boolean;
  refreshing: boolean;
  error: any;
  coverage: TripReadCoverageStatus;
  readCoverage: TripReadCoverage | null;
  historyReady: boolean;
};

type TripHistoryCacheEntry = TripHistoryState & {
  key: string;
  scope: TripHistoryCacheScope;
  diagnosticOwnerDriverIds: string[];
  remoteTrips: any[];
  optimisticTrips: Map<string, any>;
  listeners: Set<() => void>;
  unsubscribe: (() => void) | null;
  releaseTimer: ReturnType<typeof setTimeout> | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  retryAttempt: number;
  subscriptionGeneration: number;
  notifyQueued?: boolean;
};

const CACHE_RELEASE_DELAY_MS = 120_000;
const RETRY_MAX_DELAY_MS = 30_000;
const tripHistoryCache = new Map<string, TripHistoryCacheEntry>();

const EMPTY_STATE: TripHistoryState = {
  trips: [],
  loading: false,
  refreshing: false,
  error: null,
  coverage: "unknown",
  readCoverage: null,
  historyReady: false,
};

let teardownListenerAttached = false;

function scopeKey(scope: TripHistoryCacheScope): string {
  return buildTripHistoryCacheScope(scope);
}

function getInitialState(scope: TripHistoryCacheScope | null): TripHistoryState {
  if (!scope) return EMPTY_STATE;
  const live = tripHistoryCache.get(scopeKey(scope));
  if (live) return getState(live);
  const persisted = readTripHistoryCache(scope);
  const trips = filterTombstonedTrips(persisted?.trips || []);
  const historyReady = trips.length > 0 || persisted?.complete === true;
  return {
    trips,
    loading: !historyReady,
    refreshing: true,
    error: null,
    coverage: "unknown",
    readCoverage: null,
    historyReady,
  };
}

function tripIdentity(trip: any): string {
  const id = getCanonicalTripId(trip);
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
    if (!merged.has(identity)) merged.set(identity, { ...trip, historyLocalCommandOnly: true });
  }
  return filterTombstonedTrips(sortTrips(reconcileTrips(Array.from(merged.values()))));
}

function writeVisibleCache(entry: TripHistoryCacheEntry): void {
  writeTripHistoryCache(entry.scope, entry.trips, (trip) => {
    try {
      return getTripMetricDate(trip).getTime();
    } catch {
      return 0;
    }
  }, { complete: entry.coverage === "complete" && entry.optimisticTrips.size === 0 });
}

function notify(entry: TripHistoryCacheEntry) {
  // One Firestore response emits coverage -> rows -> coverage synchronously.
  // Publish the resulting snapshot once, avoiding a visible refresh between them.
  if (entry.notifyQueued) return;
  entry.notifyQueued = true;
  queueMicrotask(() => {
    entry.notifyQueued = false;
    entry.listeners.forEach((listener) => listener());
  });
}

function ensureTeardownListener() {
  if (teardownListenerAttached || typeof window === "undefined") return;
  teardownListenerAttached = true;
  window.addEventListener("nvu-offline-trip-status", (rawEvent) => {
    const detail = (rawEvent as CustomEvent<any>).detail || {};
    const id = String(detail.id || "").trim();
    if (!id) return;
    for (const entry of tripHistoryCache.values()) {
      const trip = entry.optimisticTrips.get(id);
      if (!trip) continue;
      entry.optimisticTrips.set(id, {
        ...trip,
        offlineSyncStatus: String(detail.offlineSyncStatus || trip.offlineSyncStatus || "awaiting_connection"),
        offlineSyncError: String(detail.errorMessage || ""),
      });
      entry.trips = mergeRemoteAndOptimistic(entry.remoteTrips, entry.optimisticTrips);
      writeVisibleCache(entry);
      notify(entry);
    }
  });
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
      entry.coverage = "unknown";
      entry.readCoverage = null;
      entry.subscriptionGeneration += 1;
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
    entry.subscriptionGeneration += 1;
    // Release network work, retain a bounded last snapshot for instant Back.
    const idle = [...tripHistoryCache.values()].filter(item => !item.listeners.size && !item.unsubscribe && !item.optimisticTrips.size);
    for (const item of idle.slice(0, Math.max(0, idle.length - 6))) tripHistoryCache.delete(item.key);
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
    entry.loading = !entry.historyReady;
    entry.refreshing = entry.trips.length > 0;
    subscribeEntry(entry);
  }, delay);
}

function subscribeEntry(entry: TripHistoryCacheEntry) {
  if (isAuthTeardownActive() || entry.unsubscribe) return;
  const generation = ++entry.subscriptionGeneration;
  const isCurrent = () => !isAuthTeardownActive() &&
    tripHistoryCache.get(entry.key) === entry && generation === entry.subscriptionGeneration;
  entry.coverage = "unknown";
  entry.readCoverage = null;
  entry.loading = !entry.historyReady;
  entry.refreshing = entry.trips.length > 0;
  notify(entry);

  try {
    const stop = CanonicalTripQueryService.listenCompanyTrips(
      entry.scope.companyId,
      (trips) => {
        if (!isCurrent()) return;
        entry.remoteTrips = filterTombstonedTrips(trips);
        // Wait for all aliases before replacing a usable snapshot. The first
        // alias can be empty or contain only a fraction of the previous rows.
        if (entry.historyReady && entry.coverage !== "complete") return;
        entry.trips = mergeRemoteAndOptimistic(entry.remoteTrips, entry.optimisticTrips);
        entry.historyReady ||= entry.trips.length > 0 || entry.coverage === "complete";
        entry.loading = !entry.historyReady;
        entry.refreshing = entry.coverage !== "complete";
        writeVisibleCache(entry);
        notify(entry);
      },
      (error) => {
        if (!isCurrent()) return;
        console.warn("Error fetching trip history:", error);
        // Keep successful aliases alive until the scheduled retry replaces this
        // generation. An error in one source must not discard another response.
        entry.error = error;
        entry.coverage = "partial";
        entry.trips = mergeRemoteAndOptimistic([...entry.trips, ...entry.remoteTrips], entry.optimisticTrips);
        entry.historyReady ||= entry.trips.length > 0;
        entry.loading = !entry.historyReady;
        entry.refreshing = entry.trips.length > 0;
        notify(entry);
        scheduleHistoryRetry(entry);
      },
      (coverage) => {
        if (!isCurrent()) return;
        entry.readCoverage = coverage;
        entry.coverage = coverage.projectionMode === "scoped-history" ? coverage.status
          : coverage.status === "complete" && entry.optimisticTrips.size > 0 ? "partial" : coverage.status;
        entry.loading = !entry.historyReady;
        entry.refreshing = entry.coverage !== "complete";
        if (coverage.status === "complete") {
          entry.trips = mergeRemoteAndOptimistic(entry.remoteTrips, entry.optimisticTrips);
          entry.historyReady = true;
          entry.loading = false;
          entry.error = null;
          entry.retryAttempt = 0;
          if (entry.retryTimer) clearTimeout(entry.retryTimer);
          entry.retryTimer = null;
          writeVisibleCache(entry);
        }
        notify(entry);
      },
      entry.diagnosticOwnerDriverIds,
    );
    if (!isCurrent()) stop();
    else entry.unsubscribe = stop;
  } catch (error) {
    if (isAuthTeardownActive()) return;
    console.warn("Error subscribing to trip history:", error);
    entry.error = error;
    entry.coverage = "partial";
    entry.loading = !entry.historyReady;
    entry.refreshing = entry.trips.length > 0;
    notify(entry);
    scheduleHistoryRetry(entry);
  }
}

function ensureEntry(scope: TripHistoryCacheScope, diagnosticOwnerDriverIds?: string[]): TripHistoryCacheEntry {
  ensureTeardownListener();
  const key = scopeKey(scope);
  const existing = tripHistoryCache.get(key);
  if (existing) {
    if (existing.releaseTimer) {
      clearTimeout(existing.releaseTimer);
      existing.releaseTimer = null;
    }
    if (diagnosticOwnerDriverIds) {
      const nextOwners = [...new Set(diagnosticOwnerDriverIds.map((id) => String(id || "").trim()).filter(Boolean))].sort();
      // Diagnostic aliases do not change the Firestore query or authorization.
      // Keep its array identity so the existing adapter sees additions without
      // restarting both company queries when another history consumer mounts.
      for (const owner of nextOwners) if (!existing.diagnosticOwnerDriverIds.includes(owner)) existing.diagnosticOwnerDriverIds.push(owner);
    }
    if (!existing.unsubscribe && !existing.retryTimer) subscribeEntry(existing);
    return existing;
  }

  const initial = getInitialState(scope);
  const entry: TripHistoryCacheEntry = {
    key,
    scope,
    diagnosticOwnerDriverIds: [...new Set((diagnosticOwnerDriverIds || []).map((id) => String(id || "").trim()).filter(Boolean))].sort(),
    remoteTrips: initial.trips,
    optimisticTrips: new Map(),
    trips: initial.trips,
    loading: initial.loading,
    refreshing: initial.refreshing,
    error: initial.error,
    coverage: initial.coverage,
    readCoverage: initial.readCoverage,
    historyReady: initial.historyReady,
    listeners: new Set(),
    unsubscribe: null,
    releaseTimer: null,
    retryTimer: null,
    retryAttempt: 0,
    subscriptionGeneration: 0,
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
    coverage: entry.coverage,
    readCoverage: entry.readCoverage,
    historyReady: entry.historyReady,
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
  entry.historyReady = true;
  entry.refreshing = true;
  entry.coverage = "partial";
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
  entry.refreshing = entry.coverage !== "complete";
  writeVisibleCache(entry);
  notify(entry);
}

export function useTripHistory(
  companyId: string | null | undefined,
  options: { enabled?: boolean; userId?: string | null; diagnosticOwnerDriverIds?: string[] } = {},
) {
  ensureTeardownListener();
  const enabled = options.enabled !== false;
  const userId = String(options.userId || "").trim();
  const normalizedCompanyId = String(companyId || "").trim();
  const diagnosticOwnerDriverIds = [...new Set((options.diagnosticOwnerDriverIds || []).map((id) => String(id || "").trim()).filter(Boolean))].sort();
  const diagnosticOwnerKey = diagnosticOwnerDriverIds.join("|");
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

    const entry = ensureEntry(scope, diagnosticOwnerDriverIds);
    const updateState = () => {
      const value = getState(entry);
      setState(previous => previous.scopeKey === entry.key && Object.keys(value).every(key => previous.value[key as keyof TripHistoryState] === value[key as keyof TripHistoryState])
        ? previous : { scopeKey: entry.key, value });
    };

    entry.listeners.add(updateState);
    if (!entry.unsubscribe && !entry.retryTimer) subscribeEntry(entry);
    updateState();

    return () => {
      entry.listeners.delete(updateState);
      if (entry.listeners.size === 0) scheduleEntryRelease(entry);
    };
  }, [normalizedCompanyId, normalizedScopeKey, scope?.userId, diagnosticOwnerKey]);

  const visibleState = state.scopeKey === normalizedScopeKey
    ? state.value
    : getInitialState(scope);

  return {
    historicoTrips: visibleState.trips,
    loading: visibleState.loading,
    refreshing: visibleState.refreshing,
    error: visibleState.error,
    coverage: visibleState.coverage,
    readCoverage: visibleState.readCoverage,
    historyReady: visibleState.historyReady,
  };
}
