import { doc, getDoc, getDocFromServer, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../lib/firebase";
import {
  buildRankingAggregateDocumentId,
  RANKING_AGGREGATE_COMPATIBLE_SCHEMA_VERSIONS,
  parseRankingAggregateDocument,
  RANKING_AGGREGATES_COLLECTION,
  RankingAggregateDocument,
  RankingAggregatePeriodType,
} from "../lib/rankingAggregates";

export type EnsureRankingAggregateResult = {
  success: true;
  status: "ready" | "rebuilt" | "in_progress";
  periodKey: string;
  rebuiltDocuments?: number;
  sourceTrips?: number;
};

const ensureRequests = new Map<string, Promise<EnsureRankingAggregateResult>>();
const aggregateCache = new Map<
  string,
  { aggregate: RankingAggregateDocument; cachedAt: number }
>();
const aggregateWarmRequests = new Map<
  string,
  Promise<RankingAggregateDocument | null>
>();

export function invalidateRankingAggregateCaches(): void {
  aggregateCache.clear();
}

function aggregateDocumentId(simulatorId: string, periodKey: string) {
  return buildRankingAggregateDocumentId(simulatorId, periodKey);
}

function aggregateDocumentIds(simulatorId: string, periodKey: string) {
  return RANKING_AGGREGATE_COMPATIBLE_SCHEMA_VERSIONS.map((version) =>
    buildRankingAggregateDocumentId(simulatorId, periodKey, version),
  );
}

function matchesRequest(
  aggregate: RankingAggregateDocument | null,
  simulatorId: string,
  periodType: RankingAggregatePeriodType,
  periodKey: string,
) {
  return Boolean(
    aggregate &&
      aggregate.simulatorId === simulatorId &&
      aggregate.periodType === periodType &&
      aggregate.periodKey === periodKey,
  );
}

export function readCachedRankingAggregate(
  simulatorId: string,
  periodKey: string,
): RankingAggregateDocument | null {
  const key = aggregateDocumentId(simulatorId, periodKey);
  const cached = aggregateCache.get(key);
  if (cached) return cached.aggregate;
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(`nvu.ranking.aggregate.v501.${key}`) : null;
    const saved = raw ? JSON.parse(raw) : null;
    const aggregate = saved ? parseRankingAggregateDocument(saved.aggregate) : null;
    if (!aggregate || aggregate.simulatorId !== simulatorId || aggregate.periodKey !== periodKey) return null;
    aggregateCache.set(key, { aggregate, cachedAt: saved.cachedAt || 0 });
    return aggregate;
  } catch { return null; }
}

function writeCachedRankingAggregate(
  simulatorId: string,
  periodKey: string,
  aggregate: RankingAggregateDocument,
) {
  const key = aggregateDocumentId(simulatorId, periodKey), cachedAt = Date.now();
  aggregateCache.set(key, { aggregate, cachedAt });
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(`nvu.ranking.aggregate.v501.${key}`, JSON.stringify({ aggregate, cachedAt }));
      const keys = Object.keys(localStorage).filter(value => value.startsWith("nvu.ranking.aggregate.v501."));
      if (keys.length > 24) {
        keys.sort((a, b) => Number(JSON.parse(localStorage.getItem(a) || "{}").cachedAt || 0) - Number(JSON.parse(localStorage.getItem(b) || "{}").cachedAt || 0));
        keys.slice(0, keys.length - 24).forEach(value => localStorage.removeItem(value));
      }
    }
  } catch { /* A full confirmed memory snapshot remains usable when persistence is full. */ }
}

/** Confirm the committed document after reconciliation, without a device-cache fallback. */
export async function readRankingAggregateFromServer(
  simulatorId: string,
  periodKey: string,
) {
  let lastError: unknown;
  for (const documentId of aggregateDocumentIds(simulatorId, periodKey)) {
    try {
      const snapshot = await getDocFromServer(
        doc(db, RANKING_AGGREGATES_COLLECTION, documentId),
      );
      if (!snapshot.exists()) continue;
      const aggregate = parseRankingAggregateDocument(snapshot.data());
      if (!aggregate || aggregate.simulatorId !== simulatorId || aggregate.periodKey !== periodKey) continue;
      writeCachedRankingAggregate(simulatorId, periodKey, aggregate!);
      return aggregate;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return null;
}

/**
 * Performs a bounded one-document warm-up. The ranking route can then render
 * the aggregate synchronously from memory while its realtime listener starts.
 */
export function warmRankingAggregate(
  simulatorId: string,
  periodType: RankingAggregatePeriodType,
  periodKey: string,
): Promise<RankingAggregateDocument | null> {
  const cached = readCachedRankingAggregate(simulatorId, periodKey);
  if (cached) return Promise.resolve(cached);

  const requestKey = `${simulatorId}|${periodType}|${periodKey}`;
  const existing = aggregateWarmRequests.get(requestKey);
  if (existing) return existing;

  const request = (async () => {
    for (const documentId of aggregateDocumentIds(simulatorId, periodKey)) {
      const snapshot = await getDoc(doc(db, RANKING_AGGREGATES_COLLECTION, documentId));
      if (!snapshot.exists()) continue;
      const aggregate = parseRankingAggregateDocument(snapshot.data());
      if (!matchesRequest(aggregate, simulatorId, periodType, periodKey)) continue;
      writeCachedRankingAggregate(simulatorId, periodKey, aggregate!);
      return aggregate;
    }
    return null;
  })()
    .finally(() => {
      aggregateWarmRequests.delete(requestKey);
    });

  aggregateWarmRequests.set(requestKey, request);
  return request;
}

export function listenRankingAggregate(
  simulatorId: string,
  periodType: RankingAggregatePeriodType,
  periodKey: string,
  onNext: (aggregate: RankingAggregateDocument | null) => void,
  onError?: (error: unknown) => void,
) {
  const cached = readCachedRankingAggregate(simulatorId, periodKey);
  if (cached) onNext(cached);

  const documentIds = aggregateDocumentIds(simulatorId, periodKey);
  const snapshots = new Map<string, { ready: boolean; aggregate: RankingAggregateDocument | null }>();
  const errors = new Map<string, unknown>();
  const publish = () => {
    for (const documentId of documentIds) {
      const aggregate = snapshots.get(documentId)?.aggregate || null;
      if (!matchesRequest(aggregate, simulatorId, periodType, periodKey)) continue;
      writeCachedRankingAggregate(simulatorId, periodKey, aggregate!);
      onNext(aggregate);
      return;
    }
    if (documentIds.every((id) => snapshots.get(id)?.ready)) {
      const error = documentIds.map((id) => errors.get(id)).find(Boolean);
      if (error) onError?.(error);
      else onNext(null);
    }
  };
  const unsubscribers = documentIds.map((documentId) =>
    onSnapshot(
      doc(db, RANKING_AGGREGATES_COLLECTION, documentId),
      (snapshot) => {
        const aggregate = snapshot.exists()
          ? parseRankingAggregateDocument(snapshot.data())
          : null;
        snapshots.set(documentId, { ready: true, aggregate });
        errors.delete(documentId);
        publish();
      },
      (error) => {
        snapshots.set(documentId, { ready: true, aggregate: null });
        errors.set(documentId, error);
        publish();
      },
    ),
  );
  return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
}

export function ensureRankingAggregate(
  simulatorId: string,
  periodType: RankingAggregatePeriodType,
  periodKey: string,
) {
  const requestKey = `${simulatorId}|${periodType}|${periodKey}`;
  const existing = ensureRequests.get(requestKey);
  if (existing) return existing;

  const callable = httpsCallable<
    {
      simulatorId: string;
      periodType: RankingAggregatePeriodType;
      periodKey: string;
    },
    EnsureRankingAggregateResult
  >(functions, "ensureRankingAggregates", { timeout: 20_000 });

  const request = callable({ simulatorId, periodType, periodKey })
    .then((result) => result.data)
    .finally(() => {
      // Keep only the in-flight request deduplicated. A later route entry may
      // legitimately retry after a deployment or transient Functions error.
      ensureRequests.delete(requestKey);
    });

  ensureRequests.set(requestKey, request);
  return request;
}
