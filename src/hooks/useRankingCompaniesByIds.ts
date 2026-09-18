import { useEffect, useMemo, useState } from "react";
import {
  collection,
  documentId,
  getDocsFromServer,
  query,
  where,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import {
  isAuthTeardownActive,
  onAuthTeardown,
} from "../lib/authLifecycle";

export type RankingCompaniesState = {
  companies: any[];
  loading: boolean;
  refreshing: boolean;
  error: unknown | null;
  complete: boolean;
  serverConfirmed: boolean;
};

type RankingCompaniesEntry = {
  key: string;
  ids: string[];
  state: RankingCompaniesState;
  subscribers: Set<() => void>;
  request: Promise<void> | null;
  expiresAt: number;
  releaseTimer: ReturnType<typeof setTimeout> | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  retryAttempt: number;
  hasCompleteSnapshot: boolean;
  serverConfirmed: boolean;
};

const FIRESTORE_IN_LIMIT = 30;
const CACHE_TTL_MS = 120_000;
const CACHE_RELEASE_DELAY_MS = 120_000;
const RETRY_MAX_DELAY_MS = 30_000;
const cache = new Map<string, RankingCompaniesEntry>();
let teardownListenerAttached = false;

const EMPTY_STATE: RankingCompaniesState = {
  companies: [],
  loading: false,
  refreshing: false,
  error: null,
  complete: false,
  serverConfirmed: false,
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

function notify(entry: RankingCompaniesEntry) {
  entry.subscribers.forEach((subscriber) => subscriber());
}

function ensureTeardownListener() {
  if (teardownListenerAttached || typeof window === "undefined") return;
  teardownListenerAttached = true;
  onAuthTeardown(() => {
    cache.forEach((entry) => {
      if (entry.releaseTimer) clearTimeout(entry.releaseTimer);
      if (entry.retryTimer) clearTimeout(entry.retryTimer);
      entry.releaseTimer = null;
      entry.retryTimer = null;
      entry.retryAttempt = 0;
      entry.state = EMPTY_STATE;
      entry.hasCompleteSnapshot = false;
      entry.serverConfirmed = false;
      notify(entry);
      entry.subscribers.clear();
    });
    cache.clear();
  });
}

function findReusableSourceState(ids: string[]): RankingCompaniesState | null {
  if (ids.length === 0) return EMPTY_STATE;
  const requested = new Set(ids);
  let best: RankingCompaniesEntry | null = null;

  cache.forEach((candidate) => {
    if (
      candidate.ids.length < ids.length ||
      candidate.state.loading ||
      !candidate.hasCompleteSnapshot ||
      !candidate.serverConfirmed ||
      candidate.expiresAt <= Date.now()
    ) {
      return;
    }
    if (!ids.every((id) => candidate.ids.includes(id))) return;
    if (!best || candidate.ids.length < best.ids.length) best = candidate;
  });

  if (!best) return null;
  return {
    companies: best.state.companies.filter((company) =>
      requested.has(String(company?.id || "")),
    ),
    loading: false,
    refreshing: false,
    error: null,
    complete: true,
    serverConfirmed: true,
  };
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
  const entry: RankingCompaniesEntry = {
    key,
    ids,
    state:
      reusableSource || {
        companies: [],
        loading: ids.length > 0,
        refreshing: false,
        error: null,
        complete: false,
        serverConfirmed: false,
      },
    subscribers: new Set(),
    request: null,
    expiresAt: reusableSource ? Date.now() + CACHE_TTL_MS : 0,
    releaseTimer: null,
    retryTimer: null,
    retryAttempt: 0,
    hasCompleteSnapshot: Boolean(reusableSource),
    serverConfirmed: Boolean(reusableSource),
  };
  cache.set(key, entry);
  return entry;
}


function scheduleRetry(entry: RankingCompaniesEntry) {
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
      cache.get(entry.key) !== entry ||
      entry.request
    ) {
      return;
    }
    void loadEntry(entry);
  }, delay);
}

function loadEntry(entry: RankingCompaniesEntry) {
  if (entry.request) return entry.request;
  if (isAuthTeardownActive()) return Promise.resolve();
  if (
    entry.expiresAt > Date.now() &&
    !entry.state.loading &&
    entry.hasCompleteSnapshot &&
    entry.serverConfirmed
  ) {
    return Promise.resolve();
  }

  const chunks = chunkIds(entry.ids);
  if (chunks.length === 0) {
    entry.state = EMPTY_STATE;
    entry.expiresAt = Date.now() + CACHE_TTL_MS;
    notify(entry);
    return Promise.resolve();
  }

  entry.state = {
    companies: entry.state.companies,
    loading: entry.state.companies.length === 0,
    refreshing: entry.state.companies.length > 0,
    error: null,
    complete: entry.hasCompleteSnapshot,
    serverConfirmed: entry.serverConfirmed,
  };
  notify(entry);

  entry.request = Promise.allSettled(
    chunks.map((ids) =>
      // Android persistence can satisfy getDocs from a stale/local catalog.
      // Only this bounded set is forced to the server for ranking identity.
      getDocsFromServer(
        query(collection(db, "frotas"), where(documentId(), "in", ids)),
      ),
    ),
  )
    .then((results) => {
      if (isAuthTeardownActive() || cache.get(entry.key) !== entry) return;

      const merged = new Map<string, any>();
      let firstError: unknown = null;

      results.forEach((result) => {
        if (result.status === "rejected") {
          firstError ||= result.reason;
          return;
        }
        result.value.docs.forEach((document) => {
          merged.set(document.id, { ...document.data(), id: document.id });
        });
      });

      const allSourcesSucceeded = results.every(
        (result) => result.status === "fulfilled",
      );

      if (allSourcesSucceeded) {
        entry.hasCompleteSnapshot = true;
        entry.serverConfirmed = true;
        entry.retryAttempt = 0;
        if (entry.retryTimer) clearTimeout(entry.retryTimer);
        entry.retryTimer = null;
        entry.state = {
          companies: Array.from(merged.values()),
          loading: false,
          refreshing: false,
          error: null,
          complete: true,
          serverConfirmed: true,
        };
        entry.expiresAt = Date.now() + CACHE_TTL_MS;
      } else {
        // Do not cache a successful subset as the requested company set. A
        // previous complete result may remain visible while this refresh is
        // retried; the first visit stays loading until every chunk settles.
        entry.state = {
          companies: entry.hasCompleteSnapshot
            ? entry.state.companies
            : Array.from(merged.values()),
          loading: !entry.hasCompleteSnapshot,
          refreshing: false,
          error:
            firstError ||
            new Error("Não foi possível confirmar todas as empresas do ranking."),
          complete: entry.hasCompleteSnapshot,
          serverConfirmed: entry.serverConfirmed,
        };
        if (!entry.hasCompleteSnapshot) entry.expiresAt = 0;
        // Retry only the same bounded participant set. The exponential backoff
        // prevents a weak/offline Android connection from issuing a server
        // confirmation every 1.5 seconds while the ranking remains open. A
        // previously complete snapshot stays visible during these retries.
        scheduleRetry(entry);
      }
      notify(entry);
    })
    .finally(() => {
      if (cache.get(entry.key) === entry) entry.request = null;
    });

  return entry.request;
}

function scheduleRelease(entry: RankingCompaniesEntry) {
  if (entry.releaseTimer) clearTimeout(entry.releaseTimer);
  entry.releaseTimer = setTimeout(() => {
    entry.releaseTimer = null;
    if (entry.subscribers.size > 0 || entry.request) return;
    if (entry.retryTimer) clearTimeout(entry.retryTimer);
    entry.retryTimer = null;
    entry.retryAttempt = 0;
    if (cache.get(entry.key) === entry) cache.delete(entry.key);
  }, CACHE_RELEASE_DELAY_MS);
}

/**
 * Warms the bounded company set referenced by a ranking aggregate without
 * mounting a React subscriber. A later route entry reuses the same cache.
 */
export function warmRankingCompaniesByIds(
  participantIds: Array<string | null | undefined> = [],
): Promise<void> {
  const normalizedIds = normalizeIds(participantIds);
  if (normalizedIds.length === 0 || isAuthTeardownActive()) {
    return Promise.resolve();
  }
  const entry = ensureEntry(normalizedIds);
  return loadEntry(entry) || Promise.resolve();
}

/**
 * Loads only company documents referenced by the selected ranking aggregate.
 * It uses bounded one-shot queries and a short cache instead of maintaining a
 * full-catalog listener or downloading every company on each page opening.
 */
export function useRankingCompaniesByIds(
  participantIds: Array<string | null | undefined> = [],
  enabled = true,
): RankingCompaniesState {
  ensureTeardownListener();
  const normalizedIds = useMemo(
    () => normalizeIds(participantIds),
    [participantIds.join("|")],
  );
  const key = normalizedIds.join("|");

  const [stateRecord, setStateRecord] = useState<{
    key: string;
    state: RankingCompaniesState;
  }>(() => ({
    key,
    state:
      !enabled || normalizedIds.length === 0
        ? EMPTY_STATE
        : cache.get(key)?.state ||
          findReusableSourceState(normalizedIds) || {
            companies: [],
            loading: true,
            refreshing: false,
            error: null,
            complete: false,
            serverConfirmed: false,
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
    loadEntry(entry);
    update();

    return () => {
      entry.subscribers.delete(update);
      if (entry.subscribers.size === 0) scheduleRelease(entry);
    };
  }, [enabled, key]);

  if (stateRecord.key !== key) {
    return !enabled || normalizedIds.length === 0
      ? EMPTY_STATE
      : findReusableSourceState(normalizedIds) || {
          companies: [],
          loading: true,
          refreshing: false,
          error: null,
          complete: false,
          serverConfirmed: false,
        };
  }

  return stateRecord.state;
}
