import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeTrip, NormalizedTrip } from "../lib/tripNormalizer";
import { TripsRepository } from "../repositories/TripsRepository";
import { auth } from "../lib/firebase";
import {
  isAuthTeardownActive,
  onAuthTeardown,
} from "../lib/authLifecycle";

type TripsRealtimeState = {
  trips: NormalizedTrip[];
  loading: boolean;
  refreshing: boolean;
  error: unknown | null;
};

export type TripsRealtimeOptions = {
  startDate?: Date;
  endDate?: Date;
  enabled?: boolean;
  keepPreviousData?: boolean;
  cacheScope?: string;
};

type TripsCacheEntry = {
  key: string;
  startDate: Date;
  endDate: Date;
  state: TripsRealtimeState;
  subscribers: Set<() => void>;
  unsubscribe: (() => void) | null;
  releaseTimer: ReturnType<typeof setTimeout> | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  retryAttempt: number;
  generation: number;
};

const LISTENER_RELEASE_DELAY_MS = 120_000;
const PERSISTED_RANGE_CACHE_PREFIX = "nvu.instant.v1.trips-range.";
const RANGE_CACHE_SCHEMA_VERSION = 1;
const rangeCache = new Map<string, TripsCacheEntry>();
let teardownListenerAttached = false;

const EMPTY_STATE: TripsRealtimeState = {
  trips: [],
  loading: false,
  refreshing: false,
  error: null,
};

function toValidDate(value: Date | undefined, fallback: Date) {
  if (!value || Number.isNaN(value.getTime())) return fallback;
  return value;
}

function getAuthenticatedSessionScope(): string {
  return auth.currentUser?.uid || "anonymous";
}

export function buildTripsRangeCacheKey(
  startDate: Date,
  endDate: Date,
  sessionScope = getAuthenticatedSessionScope(),
  cacheScope = "global",
) {
  return `global:${sessionScope}:${encodeURIComponent(cacheScope)}:${startDate.getTime()}:${endDate.getTime()}`;
}

const persistedRangeCacheKey = (cacheKey: string) =>
  `${PERSISTED_RANGE_CACHE_PREFIX}${encodeURIComponent(cacheKey)}`;

function readPersistedRangeTrips(cacheKey: string): NormalizedTrip[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(persistedRangeCacheKey(cacheKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as {
      version?: number;
      cachedAt?: number;
      trips?: Array<Record<string, unknown>>;
    };
    if (
      parsed.version !== RANGE_CACHE_SCHEMA_VERSION ||
      typeof parsed.cachedAt !== "number" ||
      !Number.isFinite(parsed.cachedAt) ||
      parsed.cachedAt <= 0 ||
      !Array.isArray(parsed.trips)
    ) {
      window.localStorage.removeItem(persistedRangeCacheKey(cacheKey));
      return [];
    }
    return parsed.trips
      .map((trip) => {
        const metricDate = new Date(String(trip.metricDate || ""));
        return Number.isNaN(metricDate.getTime())
          ? null
          : ({ ...trip, metricDate } as unknown as NormalizedTrip);
      })
      .filter((trip): trip is NormalizedTrip => Boolean(trip));
  } catch {
    return [];
  }
}

function writePersistedRangeTrips(cacheKey: string, trips: NormalizedTrip[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      persistedRangeCacheKey(cacheKey),
      JSON.stringify({
        version: RANGE_CACHE_SCHEMA_VERSION,
        cachedAt: Date.now(),
        trips: trips.slice(0, 500),
      }),
    );
  } catch {
    // Persisted range data is only a first-paint acceleration layer.
  }
}

function clearPersistedRangeTrips() {
  if (typeof window === "undefined") return;
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(PERSISTED_RANGE_CACHE_PREFIX)) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Best-effort cleanup during explicit auth teardown.
  }
}

function notify(entry: TripsCacheEntry) {
  entry.subscribers.forEach((subscriber) => subscriber());
}

function stopEntry(entry: TripsCacheEntry) {
  try {
    entry.unsubscribe?.();
  } catch {
    // Listener cleanup is best-effort during route changes/logout.
  }
  entry.unsubscribe = null;

  if (entry.releaseTimer) clearTimeout(entry.releaseTimer);
  entry.releaseTimer = null;

  if (entry.retryTimer) clearTimeout(entry.retryTimer);
  entry.retryTimer = null;
  entry.retryAttempt = 0;
  entry.generation += 1;
}

function ensureTeardownListener() {
  if (teardownListenerAttached || typeof window === "undefined") return;
  teardownListenerAttached = true;

  onAuthTeardown(() => {
    rangeCache.forEach((entry) => {
      stopEntry(entry);
      entry.state = EMPTY_STATE;
      notify(entry);
      entry.subscribers.clear();
    });
    rangeCache.clear();
    clearPersistedRangeTrips();
  });
}

function openEntry(entry: TripsCacheEntry) {
  if (entry.unsubscribe || isAuthTeardownActive()) return;

  if (entry.releaseTimer) {
    clearTimeout(entry.releaseTimer);
    entry.releaseTimer = null;
  }
  if (entry.retryTimer) {
    clearTimeout(entry.retryTimer);
    entry.retryTimer = null;
  }

  const generation = entry.generation + 1;
  entry.generation = generation;

  entry.state = {
    ...entry.state,
    loading: entry.state.trips.length === 0,
    refreshing: entry.state.trips.length > 0,
    error: null,
  };
  notify(entry);

  entry.unsubscribe = TripsRepository.listenTripsByDateRange(
    entry.startDate,
    entry.endDate,
    (trips) => {
      if (
        isAuthTeardownActive() ||
        entry.generation !== generation ||
        rangeCache.get(entry.key) !== entry
      ) return;
      entry.retryAttempt = 0;
      const normalizedTrips = trips.map(normalizeTrip);
      entry.state = {
        trips: normalizedTrips,
        loading: false,
        refreshing: false,
        error: null,
      };
      writePersistedRangeTrips(entry.key, normalizedTrips);
      notify(entry);
    },
    (error) => {
      if (
        isAuthTeardownActive() ||
        entry.generation !== generation ||
        rangeCache.get(entry.key) !== entry
      ) return;
      console.warn("Erro ao carregar viagens do período:", error);

      try {
        entry.unsubscribe?.();
      } catch {
        // Firestore can already have closed a failed listener.
      }
      entry.unsubscribe = null;
      entry.state = {
        ...entry.state,
        loading: entry.state.trips.length === 0,
        refreshing: false,
        error,
      };
      notify(entry);

      if (entry.subscribers.size > 0 && !entry.retryTimer) {
        const delay = Math.min(30_000, 1_500 * 2 ** entry.retryAttempt);
        entry.retryAttempt += 1;
        entry.retryTimer = setTimeout(() => {
          entry.retryTimer = null;
          if (
            entry.subscribers.size > 0 &&
            !isAuthTeardownActive() &&
            entry.generation === generation &&
            rangeCache.get(entry.key) === entry
          ) {
            openEntry(entry);
          }
        }, delay);
      }
    },
  );
}

function ensureEntry(
  startDate: Date,
  endDate: Date,
  sessionScope = getAuthenticatedSessionScope(),
  cacheScope = "global",
): TripsCacheEntry {
  ensureTeardownListener();
  const key = buildTripsRangeCacheKey(startDate, endDate, sessionScope, cacheScope);
  const existing = rangeCache.get(key);
  if (existing) {
    if (existing.releaseTimer) {
      clearTimeout(existing.releaseTimer);
      existing.releaseTimer = null;
    }
    return existing;
  }

  const entry: TripsCacheEntry = {
    key,
    startDate,
    endDate,
    state: (() => {
      const persistedTrips = readPersistedRangeTrips(key);
      return {
        trips: persistedTrips,
        loading: persistedTrips.length === 0,
        refreshing: persistedTrips.length > 0,
        error: null,
      };
    })(),
    subscribers: new Set(),
    unsubscribe: null,
    releaseTimer: null,
    retryTimer: null,
    retryAttempt: 0,
    generation: 0,
  };
  rangeCache.set(key, entry);
  return entry;
}

function scheduleRelease(entry: TripsCacheEntry) {
  if (entry.releaseTimer) clearTimeout(entry.releaseTimer);

  entry.releaseTimer = setTimeout(() => {
    entry.releaseTimer = null;
    if (entry.subscribers.size > 0) return;

    stopEntry(entry);
    if (rangeCache.get(entry.key) === entry) {
      rangeCache.delete(entry.key);
    }
  }, LISTENER_RELEASE_DELAY_MS);
}

/**
 * Starts the shared listener before a ranking screen is opened.
 * The entry remains available for the normal release window, so the first
 * visible render can reuse already-hydrated trips instead of showing a full
 * loading state. This is intentionally best-effort and keeps the same scoped
 * date-range query used by mounted consumers.
 */
export function preloadTripsRange(startDate: Date, endDate: Date): void {
  if (isAuthTeardownActive()) return;

  const first = Math.min(startDate.getTime(), endDate.getTime());
  const last = Math.max(startDate.getTime(), endDate.getTime());
  const entry = ensureEntry(new Date(first), new Date(last));
  openEntry(entry);

  if (entry.subscribers.size === 0) {
    scheduleRelease(entry);
  }
}

/**
 * Shared realtime trip range.
 *
 * Unlike the previous global collection listener, each mounted ranking or
 * performance surface opens only the bounded ranges it actually needs. Profile
 * cards may share one current/previous range and one five-period classification
 * range through the same cache. Results are retained for two minutes and the
 * previous snapshot stays visible while a new range is hydrated.
 */
export function useTripsRealtime(options: TripsRealtimeOptions = {}) {
  ensureTeardownListener();

  const enabled = options.enabled !== false;
  const keepPreviousData = options.keepPreviousData !== false;
  const cacheScope = options.cacheScope || "global";
  const startMs = toValidDate(options.startDate, new Date(0)).getTime();
  const endMs = toValidDate(options.endDate, new Date()).getTime();

  const sessionScope = getAuthenticatedSessionScope();
  const normalizedRange = useMemo(() => {
    const first = Math.min(startMs, endMs);
    const last = Math.max(startMs, endMs);
    const startDate = new Date(first);
    const endDate = new Date(last);
    return {
      startDate,
      endDate,
      key: buildTripsRangeCacheKey(startDate, endDate, sessionScope, cacheScope),
    };
  }, [cacheScope, endMs, sessionScope, startMs]);

  const visibleSessionScopeRef = useRef(sessionScope);
  const [visibleState, setVisibleState] = useState<TripsRealtimeState>(() => {
    if (!enabled) return EMPTY_STATE;
    const cached = rangeCache.get(normalizedRange.key);
    return cached?.state || {
      trips: [],
      loading: true,
      refreshing: false,
      error: null,
    };
  });

  useEffect(() => {
    const canKeepPreviousSessionData =
      visibleSessionScopeRef.current === sessionScope;
    visibleSessionScopeRef.current = sessionScope;

    if (!enabled || isAuthTeardownActive()) {
      setVisibleState(EMPTY_STATE);
      return;
    }

    const entry = ensureEntry(
      normalizedRange.startDate,
      normalizedRange.endDate,
      sessionScope,
      cacheScope,
    );

    const updateState = () => {
      const nextState = entry.state;
      setVisibleState((previousState) => {
        if (
          keepPreviousData &&
          canKeepPreviousSessionData &&
          nextState.loading &&
          previousState.trips.length > 0
        ) {
          return {
            ...previousState,
            loading: false,
            refreshing: true,
            error: nextState.error,
          };
        }
        return nextState;
      });
    };

    entry.subscribers.add(updateState);
    openEntry(entry);
    updateState();

    return () => {
      entry.subscribers.delete(updateState);
      if (entry.subscribers.size === 0) scheduleRelease(entry);
    };
  }, [cacheScope, enabled, keepPreviousData, normalizedRange.key, sessionScope]);

  return visibleState;
}
