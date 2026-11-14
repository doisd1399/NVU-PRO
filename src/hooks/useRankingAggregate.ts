import { useEffect, useMemo, useState } from "react";
import { periodFromKey, RANKING_HISTORY_WINDOW_DAYS, RANKING_RECENT_WINDOW_DAYS } from "../../functions/src/rankingCalendar";
import { buildRankingAggregateDocumentId, rankingAggregateTimestampMs, RANKING_AGGREGATE_RECONCILE_AFTER_MS,
  type RankingAggregateDocument, type RankingAggregatePeriodType } from "../lib/rankingAggregates";
import { ensureRankingAggregate, invalidateRankingAggregateCaches, listenRankingAggregate,
  readCachedRankingAggregate, readRankingAggregateFromServer } from "../repositories/RankingAggregateRepository";
import { onCanonicalTripUpdated } from "../lib/CanonicalTripUpdateEvent";

type RankingAggregateState = { key: string; aggregate: RankingAggregateDocument | null;
  status: "idle" | "loading" | "ready" | "unavailable" | "missing"; error: unknown | null;
  stale: boolean; refreshing: boolean; refreshError?: unknown };
const LOAD_TIMEOUT_MS = 12_000;
const IDLE_STATE: RankingAggregateState = { key: "", aggregate: null, status: "idle", error: null, stale: false, refreshing: false };

export function useRankingAggregate(options: { simulatorId?: string; periodType?: RankingAggregatePeriodType;
  periodKey?: string; enabled?: boolean; refreshOnRead?: boolean }) {
  const simulatorId = String(options.simulatorId || "").trim(), periodKey = String(options.periodKey || "").trim();
  const periodType = options.periodType, refreshOnRead = options.refreshOnRead === true;
  const requestKey = useMemo(() => options.enabled === true && simulatorId && periodType && periodKey
    ? buildRankingAggregateDocumentId(simulatorId, periodKey) : "", [options.enabled, simulatorId, periodType, periodKey]);
  const initial = (): RankingAggregateState => {
    if (!requestKey) return IDLE_STATE;
    const aggregate = readCachedRankingAggregate(simulatorId, periodKey);
    return { key: requestKey, aggregate, status: aggregate ? "ready" : "loading", error: null, stale: Boolean(aggregate), refreshing: true };
  };
  const [state, setState] = useState<RankingAggregateState>(initial);
  const [epoch, setEpoch] = useState(0);
  useEffect(() => onCanonicalTripUpdated(() => { invalidateRankingAggregateCaches(); setEpoch(value => value + 1); }), []);
  useEffect(() => {
    if (!requestKey || !periodType) { setState(IDLE_STATE); return; }
    let active = true, stopped = false, inFlight = false, pollAttempt = 0;
    let last = state.key === requestKey ? state.aggregate : null;
    last ||= readCachedRankingAggregate(simulatorId, periodKey);
    let poll: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();
    const period = periodFromKey(periodType, periodKey);
    const outsideRepairWindow = Boolean(period && period.start.getTime() < startedAt - RANKING_HISTORY_WINDOW_DAYS * 86400000);
    // An older server only knows the recent window: a refusal for an older, closed period means "not consolidated", not a failure.
    const olderThanRecent = Boolean(period && period.start.getTime() < startedAt - RANKING_RECENT_WINDOW_DAYS * 86400000);
    const publish = (aggregate: RankingAggregateDocument, stale: boolean) => {
      if (!active) return;
      last = aggregate;
      setState({ key: requestKey, aggregate, status: "ready", error: null, stale, refreshing: stale && !stopped });
    };
    const fail = (error: unknown) => {
      if (!active) return;
      stopped = true;
      if (poll) clearTimeout(poll);
      setState({ key: requestKey, aggregate: last, status: last ? "ready" : "unavailable",
        error: last ? null : error, stale: Boolean(last), refreshing: false, refreshError: error });
    };
    // This deadline starts at mount, before any SDK callback. It also bounds a silent listener.
    const deadline = setTimeout(() => fail(new Error("Tempo limite ao carregar a classificação.")), LOAD_TIMEOUT_MS);
    const requestEnsure = async () => {
      if (!active || stopped || inFlight) return;
      if (outsideRepairWindow) {
        stopped = true;
        clearTimeout(deadline);
        if (last) publish(last, true);
        else setState({ key: requestKey, aggregate: null, status: "missing", error: null, stale: false, refreshing: false });
        return;
      }
      inFlight = true;
      try {
        const result = await ensureRankingAggregate(simulatorId, periodType, periodKey);
        if (!active) return;
        if (result.status === "ready" || result.status === "rebuilt") {
          const confirmed = await readRankingAggregateFromServer(simulatorId, periodKey);
          if (confirmed) { stopped = true; clearTimeout(deadline); if (poll) clearTimeout(poll); publish(confirmed, false); return; }
        }
        if (!stopped) poll = setTimeout(() => { void requestEnsure(); }, Math.min(4_000, 1000 * 2 ** pollAttempt++));
      } catch (error) {
        if (olderThanRecent && String((error as { code?: unknown })?.code || "").replace(/^functions\//, "") === "failed-precondition") {
          stopped = true; clearTimeout(deadline);
          if (last) publish(last, true);
          else setState({ key: requestKey, aggregate: null, status: "missing", error: null, stale: false, refreshing: false });
          return;
        }
        fail(error);
      }
      finally { inFlight = false; }
    };
    setState({ key: requestKey, aggregate: last, status: last ? "ready" : "loading", error: null, stale: Boolean(last), refreshing: true });
    const unsubscribe = listenRankingAggregate(simulatorId, periodType, periodKey, aggregate => {
      if (!active) return;
      if (!aggregate) { void requestEnsure(); return; }
      const reconciled = rankingAggregateTimestampMs(aggregate.lastReconciledAt);
      // Closed history older than the recent window, reconciled after it ended, does not change: never re-ask for it.
      const settledHistory = Boolean(period && aggregate.complete && olderThanRecent && period.end.getTime() <= startedAt && reconciled >= period.end.getTime());
      const stale = !settledHistory && ((refreshOnRead && reconciled <= startedAt) || !reconciled || Date.now() - reconciled > RANKING_AGGREGATE_RECONCILE_AFTER_MS);
      publish(aggregate, stale);
      if (stale) void requestEnsure();
      else { stopped = true; clearTimeout(deadline); if (poll) clearTimeout(poll); }
    }, fail);
    // An open period must refresh even when the SDK stays silent and a previous snapshot exists.
    if (last && refreshOnRead) void requestEnsure();
    return () => { active = false; stopped = true; clearTimeout(deadline); if (poll) clearTimeout(poll); unsubscribe(); };
  }, [requestKey, simulatorId, periodType, periodKey, refreshOnRead, epoch]);
  if (!requestKey) return IDLE_STATE;
  return state.key === requestKey ? state : initial();
}
