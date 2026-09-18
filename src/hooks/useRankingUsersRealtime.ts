import { useEffect, useMemo, useState } from "react";
import {
  collection,
  documentId,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import {
  isAuthTeardownActive,
  onAuthTeardown,
} from "../lib/authLifecycle";
import { warmRankingUserProfiles } from "../lib/rankingPhotoWarmup";

type RankingUsersState = {
  users: any[];
  loading: boolean;
  refreshing: boolean;
  error: unknown | null;
};

type RankingUsersEntry = {
  key: string;
  ids: string[];
  state: RankingUsersState;
  /**
   * Once a complete set of Firestore chunks has been observed, keep that
   * snapshot visible while a listener refreshes in the background. A section
   * switch can therefore reuse the already-hydrated superset without exposing
   * a partial user list (and without restarting the avatar loading state).
   */
  hasCompleteSnapshot: boolean;
  subscribers: Set<() => void>;
  unsubscribers: Array<() => void>;
  releaseTimer: ReturnType<typeof setTimeout> | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  retryAttempt: number;
  sourceMaps: Map<number, Map<string, any>>;
  readySources: Set<number>;
  failedSources: Set<number>;
};

const FIRESTORE_IN_LIMIT = 30;
const LISTENER_RELEASE_DELAY_MS = 120_000;
const RETRY_MAX_DELAY_MS = 30_000;
const cache = new Map<string, RankingUsersEntry>();
let teardownListenerAttached = false;

const EMPTY_STATE: RankingUsersState = {
  users: [],
  loading: false,
  refreshing: false,
  error: null,
};

function normalizeIds(ids: Array<string | null | undefined>) {
  return Array.from(
    new Set(ids.map((id) => String(id || "").trim()).filter(Boolean)),
  ).sort();
}

function chunkIds(ids: string[]) {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += FIRESTORE_IN_LIMIT) {
    chunks.push(ids.slice(index, index + FIRESTORE_IN_LIMIT));
  }
  return chunks;
}

function notify(entry: RankingUsersEntry) {
  entry.subscribers.forEach((subscriber) => subscriber());
}

function closeEntryListeners(entry: RankingUsersEntry) {
  entry.unsubscribers.forEach((unsubscribe) => {
    try {
      unsubscribe();
    } catch {
      // Cleanup is best-effort.
    }
  });
  entry.unsubscribers = [];
}

function stopEntry(entry: RankingUsersEntry) {
  closeEntryListeners(entry);
  if (entry.releaseTimer) clearTimeout(entry.releaseTimer);
  entry.releaseTimer = null;
  if (entry.retryTimer) clearTimeout(entry.retryTimer);
  entry.retryTimer = null;
  entry.retryAttempt = 0;
}

function ensureTeardownListener() {
  if (teardownListenerAttached || typeof window === "undefined") return;
  teardownListenerAttached = true;
  onAuthTeardown(() => {
    cache.forEach((entry) => {
      stopEntry(entry);
      entry.state = EMPTY_STATE;
      notify(entry);
      entry.subscribers.clear();
    });
    cache.clear();
  });
}

function scheduleRetry(entry: RankingUsersEntry) {
  if (
    isAuthTeardownActive() ||
    entry.retryTimer ||
    entry.subscribers.size === 0
  ) {
    return;
  }

  const delay = Math.min(
    RETRY_MAX_DELAY_MS,
    1_500 * 2 ** entry.retryAttempt,
  );
  entry.retryAttempt += 1;
  entry.retryTimer = setTimeout(() => {
    entry.retryTimer = null;
    if (
      isAuthTeardownActive() ||
      entry.subscribers.size === 0 ||
      cache.get(entry.key) !== entry
    ) {
      return;
    }

    // Firestore closes a listener after invoking its error callback. Restart
    // the bounded participant set as one unit so a failed chunk can never be
    // promoted to a complete ranking profile snapshot.
    closeEntryListeners(entry);
    openEntry(entry);
  }, delay);
}

function emitMergedState(entry: RankingUsersEntry) {
  const sourceCount = chunkIds(entry.ids).length;
  const completedSources = new Set([
    ...entry.readySources,
    ...entry.failedSources,
  ]).size;
  if (completedSources === 0) return;

  const merged = new Map<string, any>();
  entry.sourceMaps.forEach((source) => {
    source.forEach((user, id) => merged.set(id, user));
  });

  const allSourcesCompleted = completedSources >= sourceCount;
  if (!allSourcesCompleted) {
    /*
     * Progressive profile hydration: expose the merged chunk immediately while
     * keeping loading=true until every bounded source settles. RankingGlobal
     * can use these profiles to improve names/photos for the first 10 rows, but
     * must not treat this subset as a complete authoritative profile snapshot.
     * A previous complete snapshot still wins when it exists.
     */
    entry.state = {
      users: entry.hasCompleteSnapshot
        ? entry.state.users
        : Array.from(merged.values()),
      loading: !entry.hasCompleteSnapshot,
      refreshing: false,
      error: null,
    };
    notify(entry);
    return;
  }

  if (entry.failedSources.size > 0) {
    // A fulfilled subset must never become the reusable "complete" cache.
    // Preserve the last complete snapshot when one exists; on the first visit
    // keep the partial data non-authoritative while a bounded retry is queued.
    entry.state = {
      users: entry.hasCompleteSnapshot
        ? entry.state.users
        : Array.from(merged.values()),
      loading: !entry.hasCompleteSnapshot,
      refreshing: false,
      error: new Error("Não foi possível confirmar todos os perfis do ranking."),
    };
    notify(entry);
    scheduleRetry(entry);
    return;
  }

  entry.hasCompleteSnapshot = true;
  entry.retryAttempt = 0;
  if (entry.retryTimer) clearTimeout(entry.retryTimer);
  entry.retryTimer = null;
  entry.state = {
    users: Array.from(merged.values()),
    loading: false,
    refreshing: false,
    error: null,
  };
  notify(entry);
}

function openEntry(entry: RankingUsersEntry) {
  if (entry.unsubscribers.length > 0 || isAuthTeardownActive()) return;
  const chunks = chunkIds(entry.ids);

  if (chunks.length === 0) {
    entry.state = EMPTY_STATE;
    notify(entry);
    return;
  }

  entry.state = {
    ...entry.state,
    // A complete cached/superset snapshot is already safe to render. The
    // listener still refreshes it, but the refresh is intentionally invisible
    // to the ranking consumer until every chunk has settled.
    loading: !entry.hasCompleteSnapshot,
    refreshing: false,
    error: null,
  };
  entry.readySources.clear();
  entry.failedSources.clear();
  notify(entry);

  entry.unsubscribers = chunks.map((ids, sourceIndex) =>
    onSnapshot(
      query(
        collection(db, "users"),
        where(documentId(), "in", ids),
      ),
      (snapshot) => {
        if (isAuthTeardownActive()) return;
        const mappedUsers = snapshot.docs.map((document) => ({
          ...document.data(),
          id: document.id,
        }));
        entry.sourceMaps.set(
          sourceIndex,
          new Map(mappedUsers.map((user) => [String(user.id), user])),
        );
        // Start decoding as soon as a participant chunk arrives. RankingGlobal
        // still waits for the complete participant set before publishing its
        // snapshot, but this removes the profile-photo request from the
        // critical path after the final Firestore chunk.
        void warmRankingUserProfiles(mappedUsers, 8);
        entry.readySources.add(sourceIndex);
        entry.failedSources.delete(sourceIndex);
        emitMergedState(entry);
      },
      (error) => {
        if (isAuthTeardownActive()) return;
        console.warn("Erro ao carregar participantes do ranking:", error);
        entry.failedSources.add(sourceIndex);
        emitMergedState(entry);
      },
    ),
  );
}

function ensureEntry(ids: string[]) {
  ensureTeardownListener();
  const key = ids.join("|");
  const existing = cache.get(key);
  if (existing) {
    if (existing.releaseTimer) {
      clearTimeout(existing.releaseTimer);
      existing.releaseTimer = null;
    }
    return existing;
  }

  const reusableSource = findReusableSourceState(ids);
  const entry: RankingUsersEntry = {
    key,
    ids,
    state: reusableSource || {
        users: [],
        loading: ids.length > 0,
        refreshing: false,
        error: null,
      },
    hasCompleteSnapshot: Boolean(reusableSource),
    subscribers: new Set(),
    unsubscribers: [],
    releaseTimer: null,
    retryTimer: null,
    retryAttempt: 0,
    sourceMaps: new Map(),
    readySources: new Set(),
    failedSources: new Set(),
  };
  cache.set(key, entry);
  return entry;
}

/**
 * The startup warm-up subscribes to the complete global participant set. An
 * internal ranking is a subset of that exact set, so reuse the already
 * server-hydrated profiles on its first render while the narrower listener
 * refreshes in the background. This removes a second initials/photo cycle
 * when switching ranking sections.
 */
function findReusableSourceState(ids: string[]): RankingUsersState | null {
  if (ids.length === 0) return EMPTY_STATE;
  const requested = new Set(ids);
  let best: RankingUsersEntry | null = null;
  cache.forEach((candidate) => {
    if (
      candidate.ids.length < ids.length ||
      candidate.state.users.length === 0 ||
      candidate.state.loading ||
      !candidate.hasCompleteSnapshot
    ) {
      return;
    }
    if (!ids.every((id) => candidate.ids.includes(id))) return;
    if (!best || candidate.ids.length < best.ids.length) best = candidate;
  });
  if (!best) return null;
  return {
    users: best.state.users.filter((user) =>
      requested.has(String(user?.id || "")),
    ),
    loading: false,
    refreshing: false,
    error: null,
  };
}

function scheduleRelease(entry: RankingUsersEntry) {
  if (entry.releaseTimer) clearTimeout(entry.releaseTimer);
  entry.releaseTimer = setTimeout(() => {
    entry.releaseTimer = null;
    if (entry.subscribers.size > 0) return;
    stopEntry(entry);
    if (cache.get(entry.key) === entry) cache.delete(entry.key);
  }, LISTENER_RELEASE_DELAY_MS);
}

/**
 * Loads only user documents that actually participate in the visible driver
 * ranking. The old implementation listened to the entire users collection.
 */
export function useRankingUsersRealtime(
  participantIds: Array<string | null | undefined> = [],
  enabled = true,
): RankingUsersState {
  ensureTeardownListener();
  const normalizedIds = useMemo(
    () => normalizeIds(participantIds),
    [participantIds.join("|")],
  );
  const key = normalizedIds.join("|");

  const [stateRecord, setStateRecord] = useState<{
    key: string;
    state: RankingUsersState;
  }>(() => ({
    key,
    state:
      !enabled || normalizedIds.length === 0
        ? EMPTY_STATE
        : cache.get(key)?.state ||
          findReusableSourceState(normalizedIds) || {
            users: [],
            loading: true,
            refreshing: false,
            error: null,
          },
  }));

  useEffect(() => {
    if (!enabled || normalizedIds.length === 0 || isAuthTeardownActive()) {
      setStateRecord({ key, state: EMPTY_STATE });
      return;
    }

    const entry = ensureEntry(normalizedIds);
    const update = () => setStateRecord({ key, state: entry.state });
    entry.subscribers.add(update);
    openEntry(entry);
    // Each Firestore chunk warms its profiles in `openEntry`. Repeating the
    // same warmup here on every mount duplicates queue work when a cached or
    // reusable participant snapshot is already available.
    update();

    return () => {
      entry.subscribers.delete(update);
      if (entry.subscribers.size === 0) scheduleRelease(entry);
    };
  }, [enabled, key]);

  // Never expose the previous participant set for one render after filters
  // change. That stale frame could publish names/photos from another ranking
  // before the new Firestore chunks mark themselves as loading.
  if (stateRecord.key !== key) {
    return !enabled || normalizedIds.length === 0
      ? EMPTY_STATE
      : findReusableSourceState(normalizedIds) || {
          users: [],
          loading: true,
          refreshing: false,
          error: null,
        };
  }

  return stateRecord.state;
}
