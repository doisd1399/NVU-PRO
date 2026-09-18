import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../lib/firebase";
import {
  buildRankingAggregateDocumentId,
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
const AGGREGATE_CACHE_TTL_MS = 10 * 60 * 1000;

function aggregateDocumentId(simulatorId: string, periodKey: string) {
  return buildRankingAggregateDocumentId(simulatorId, periodKey);
}

export function readCachedRankingAggregate(
  simulatorId: string,
  periodKey: string,
): RankingAggregateDocument | null {
  const key = aggregateDocumentId(simulatorId, periodKey);
  const cached = aggregateCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > AGGREGATE_CACHE_TTL_MS) {
    aggregateCache.delete(key);
    return null;
  }
  return cached.aggregate;
}

function writeCachedRankingAggregate(
  simulatorId: string,
  periodKey: string,
  aggregate: RankingAggregateDocument,
) {
  aggregateCache.set(aggregateDocumentId(simulatorId, periodKey), {
    aggregate,
    cachedAt: Date.now(),
  });
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

  const request = getDoc(
    doc(
      db,
      RANKING_AGGREGATES_COLLECTION,
      aggregateDocumentId(simulatorId, periodKey),
    ),
  )
    .then((snapshot) => {
      if (!snapshot.exists()) return null;
      const aggregate = parseRankingAggregateDocument(snapshot.data());
      if (!aggregate) return null;
      writeCachedRankingAggregate(simulatorId, periodKey, aggregate);
      return aggregate;
    })
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

  const documentId = buildRankingAggregateDocumentId(simulatorId, periodKey);
  return onSnapshot(
    doc(db, RANKING_AGGREGATES_COLLECTION, documentId),
    (snapshot) => {
      if (!snapshot.exists()) {
        onNext(null);
        return;
      }
      const aggregate = parseRankingAggregateDocument(snapshot.data());
      if (!aggregate) {
        onNext(null);
        return;
      }
      writeCachedRankingAggregate(simulatorId, periodKey, aggregate);
      onNext(aggregate);
    },
    onError,
  );
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
  >(functions, "ensureRankingAggregates");

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
