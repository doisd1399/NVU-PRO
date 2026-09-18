import { useEffect, useMemo, useState } from "react";
import {
  buildRankingAggregateDocumentId,
  rankingAggregateTimestampMs,
  RANKING_AGGREGATE_RECONCILE_AFTER_MS,
  RankingAggregateDocument,
  RankingAggregatePeriodType,
} from "../lib/rankingAggregates";
import {
  ensureRankingAggregate,
  listenRankingAggregate,
  readCachedRankingAggregate,
} from "../repositories/RankingAggregateRepository";

type RankingAggregateState = {
  key: string;
  aggregate: RankingAggregateDocument | null;
  status: "idle" | "loading" | "ready" | "unavailable";
  error: unknown | null;
};

const MISSING_AGGREGATE_FALLBACK_MS = 12_000;

const IDLE_STATE: RankingAggregateState = {
  key: "",
  aggregate: null,
  status: "idle",
  error: null,
};

export function useRankingAggregate(options: {
  simulatorId?: string;
  periodType?: RankingAggregatePeriodType;
  periodKey?: string;
  enabled?: boolean;
}) {
  const enabled = options.enabled === true;
  const simulatorId = String(options.simulatorId || "").trim();
  const periodType = options.periodType;
  const periodKey = String(options.periodKey || "").trim();
  const requestKey = useMemo(
    () =>
      enabled && simulatorId && periodType && periodKey
        ? buildRankingAggregateDocumentId(simulatorId, periodKey)
        : "",
    [enabled, periodKey, periodType, simulatorId],
  );

  const [state, setState] = useState<RankingAggregateState>(() =>
    requestKey
      ? (() => {
          const cached = readCachedRankingAggregate(simulatorId, periodKey);
          return cached
            ? { key: requestKey, aggregate: cached, status: "ready", error: null }
            : { key: requestKey, aggregate: null, status: "loading", error: null };
        })()
      : IDLE_STATE,
  );

  useEffect(() => {
    if (!requestKey || !periodType) {
      setState(IDLE_STATE);
      return;
    }

    let active = true;
    const cachedAggregate = readCachedRankingAggregate(simulatorId, periodKey);
    let aggregateReceived = Boolean(cachedAggregate);
    let ensureStarted = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    const clearFallbackTimer = () => {
      if (fallbackTimer) clearTimeout(fallbackTimer);
      fallbackTimer = null;
    };

    const markUnavailable = (error: unknown = null) => {
      if (!active || aggregateReceived) return;
      clearFallbackTimer();
      setState({ key: requestKey, aggregate: null, status: "unavailable", error });
    };

    const requestEnsure = () => {
      if (ensureStarted) return;
      ensureStarted = true;
      fallbackTimer = setTimeout(
        () => markUnavailable(new Error("Tempo limite ao consolidar ranking.")),
        MISSING_AGGREGATE_FALLBACK_MS,
      );

      void ensureRankingAggregate(simulatorId, periodType, periodKey)
        .then((result) => {
          if (!active || aggregateReceived) return;
          if (result.status === "ready" || result.status === "rebuilt") {
            // The callable commits before returning. Give the Firestore
            // listener a short window to deliver that committed document.
            clearFallbackTimer();
            fallbackTimer = setTimeout(() => markUnavailable(), 2_500);
          }
        })
        .catch((error) => markUnavailable(error));
    };

    setState(
      cachedAggregate
        ? {
            key: requestKey,
            aggregate: cachedAggregate,
            status: "ready",
            error: null,
          }
        : { key: requestKey, aggregate: null, status: "loading", error: null },
    );

    if (cachedAggregate) {
      const lastReconciledAt = rankingAggregateTimestampMs(
        cachedAggregate.lastReconciledAt,
      );
      if (
        !lastReconciledAt ||
        Date.now() - lastReconciledAt > RANKING_AGGREGATE_RECONCILE_AFTER_MS
      ) {
        void ensureRankingAggregate(simulatorId, periodType, periodKey).catch(
          () => undefined,
        );
      }
    }
    const unsubscribe = listenRankingAggregate(
      simulatorId,
      periodType,
      periodKey,
      (aggregate) => {
        if (!active) return;
        if (!aggregate) {
          requestEnsure();
          return;
        }

        aggregateReceived = true;
        clearFallbackTimer();
        setState({ key: requestKey, aggregate, status: "ready", error: null });

        const lastReconciledAt = rankingAggregateTimestampMs(
          aggregate.lastReconciledAt,
        );
        if (
          !lastReconciledAt ||
          Date.now() - lastReconciledAt >
            RANKING_AGGREGATE_RECONCILE_AFTER_MS
        ) {
          // A stale aggregate remains immediately usable. Reconciliation runs
          // in the background and never blocks or clears the visible ranking.
          void ensureRankingAggregate(simulatorId, periodType, periodKey).catch(
            () => undefined,
          );
        }
      },
      (error) => markUnavailable(error),
    );

    return () => {
      active = false;
      clearFallbackTimer();
      try {
        unsubscribe();
      } catch {
        // Listener cleanup is best-effort during rapid filter changes.
      }
    };
  }, [periodKey, periodType, requestKey, simulatorId]);

  if (!requestKey) return IDLE_STATE;
  if (state.key === requestKey) return state;
  const cached = readCachedRankingAggregate(simulatorId, periodKey);
  return cached
    ? { key: requestKey, aggregate: cached, status: "ready", error: null }
    : { key: requestKey, aggregate: null, status: "loading", error: null };
}
