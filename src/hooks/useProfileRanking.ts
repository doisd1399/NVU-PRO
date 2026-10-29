import { useMemo } from "react";
import { useRankingAggregate } from "./useRankingAggregate";
import { useRankingCompaniesByIds } from "./useRankingCompaniesByIds";
import { useRankingUsersRealtime } from "./useRankingUsersRealtime";
import { useTripsRealtime } from "./useTripsRealtime";
import {
  buildCompanyRankingFromAggregate,
  buildDriverRankingFromAggregate,
  buildRankingAggregatePeriodKey,
  mergeRankingCompanyCatalogs,
  type RankingAggregatePeriodType,
} from "../lib/rankingAggregates";
import {
  buildInternalDriverRankingPageData,
  getActiveInternalDriverIds,
} from "../lib/rankingPageEngine";
import { getCanonicalTripDriverId } from "../lib/tripIdentity";
import { resolveSimulatorId } from "../lib/resolveSimulator";
import {
  summarizeProfileRanking,
  type ProfileRankingScope,
} from "../lib/profileRanking";

export interface ProfileRankingQuery {
  participantId: string;
  companyId?: string | null;
  scope: ProfileRankingScope;
  simulatorId?: string;
  periodType: RankingAggregatePeriodType;
  start: Date;
  end: Date;
  companies: Record<string, unknown>[];
  simulators: Record<string, unknown>[];
  users?: Record<string, unknown>[];
  companyMembers?: Record<string, unknown>[];
  enabled?: boolean;
  internalSource?: Pick<
    ReturnType<typeof useTripsRealtime>,
    "trips" | "serverConfirmed" | "refreshing" | "error"
  >;
}

/** Same aggregate, eligibility, ordering and internal population as /ranking. */
export function useProfileRanking(query: ProfileRankingQuery) {
  const enabled = query.enabled !== false;
  const internal = query.scope === "internal";
  const simulatorId = resolveSimulatorId(
    { simulatorId: query.simulatorId },
    query.simulators,
    query.companies,
  );
  const supported = Boolean(
    simulatorId && simulatorId !== "all" && (!internal || query.companyId),
  );
  const aggregateState = useRankingAggregate({
    simulatorId,
    periodType: query.periodType,
    periodKey: buildRankingAggregatePeriodKey(query.periodType, query.start),
    enabled: enabled && supported && !internal,
    refreshOnRead: query.end.getTime() >= Date.now(),
  });
  const aggregate =
    aggregateState.status === "ready" ? aggregateState.aggregate : null;
  const aggregateCompanyIds = useMemo(() => {
    if (internal && query.companyId) return [query.companyId];
    if (!aggregate) return [];
    return Array.from(
      new Set(
        [
          ...Object.keys(aggregate.companies),
          ...Object.values(aggregate.drivers).map(
            (driver) => driver.companyId || "",
          ),
        ].filter(Boolean),
      ),
    ).sort();
  }, [aggregate, internal, query.companyId]);
  const companyState = useRankingCompaniesByIds(
    aggregateCompanyIds,
    enabled && supported && (internal || Boolean(aggregate)),
  );
  const companies = useMemo(() => {
    return mergeRankingCompanyCatalogs(
      query.companies,
      companyState.companies,
      companyState.complete && companyState.serverConfirmed
        ? aggregateCompanyIds
        : [],
    );
  }, [
    aggregateCompanyIds,
    companyState.companies,
    companyState.complete,
    companyState.serverConfirmed,
    query.companies,
  ]);
  const requestedTripState = useTripsRealtime({
    startDate: query.start,
    endDate: query.end,
    companyIds: query.companyId ? [query.companyId] : [],
    enabled: enabled && supported && internal && !query.internalSource,
    keepPreviousData: false,
  });
  const tripState = query.internalSource || requestedTripState;
  const participantIds = useMemo(() => {
    if (query.scope === "companies") return [];
    if (!internal)
      return aggregate ? Object.keys(aggregate.drivers).sort() : [];
    return Array.from(
      new Set(
        [
          ...getActiveInternalDriverIds(
            query.companyMembers || [],
            query.companyId || "",
          ),
          ...tripState.trips
            .filter((trip) => trip.isValid)
            .map((trip) => getCanonicalTripDriverId(trip) || ""),
        ].filter(Boolean),
      ),
    ).sort();
  }, [
    aggregate,
    internal,
    query.companyId,
    query.companyMembers,
    query.scope,
    tripState.trips,
  ]);
  const userState = useRankingUsersRealtime(
    participantIds,
    enabled && supported && query.scope !== "companies",
  );
  const users = useMemo(() => {
    const byId = new Map<string, Record<string, unknown>>();
    [...(query.users || []), ...userState.users].forEach((user) => {
      if (user.id) byId.set(String(user.id), user);
    });
    return Array.from(byId.values());
  }, [query.users, userState.users]);
  const ranking = useMemo(() => {
    if (!supported) return [];
    if (internal)
      return buildInternalDriverRankingPageData({
        trips: tripState.trips,
        startDate: query.start,
        endDate: query.end,
        companyId: query.companyId,
        simulatorId,
        companies,
        simulators: query.simulators,
        users,
        companyMembers: query.companyMembers,
      });
    if (!aggregate) return [];
    return query.scope === "companies"
      ? buildCompanyRankingFromAggregate(aggregate, companies, query.simulators)
      : buildDriverRankingFromAggregate(
          aggregate,
          users,
          companies,
          query.simulators,
          query.companyMembers,
        );
  }, [
    aggregate,
    companies,
    internal,
    query.companyId,
    query.companyMembers,
    query.end,
    query.scope,
    query.simulators,
    query.start,
    simulatorId,
    supported,
    tripState.trips,
    users,
  ]);
  const metadataReady =
    aggregateCompanyIds.length === 0 ||
    (companyState.complete &&
      companyState.serverConfirmed &&
      !companyState.loading);
  const error = internal
    ? tripState.error || (companyState.complete ? null : companyState.error)
    : aggregateState.error || (companyState.complete ? null : companyState.error);
  const ready = internal
    ? tripState.serverConfirmed &&
      metadataReady &&
      !tripState.refreshing &&
      !error
    : Boolean(aggregate && metadataReady && !error);
  const status = !enabled
    ? "idle"
    : !supported || error || aggregateState.status === "unavailable"
      ? "unavailable"
      : !internal && aggregateState.status === "missing"
        ? "missing"
      : ready
        ? "ready"
        : "loading";
  const summary = useMemo(
    () => summarizeProfileRanking(status === "ready" ? ranking : [], query.participantId),
    [status, ranking, query.participantId],
  );
  return {
    status,
    error,
    stale: Boolean((!internal && aggregateState.stale) || companyState.stale || companyState.refreshing || companyState.error),
    simulatorId,
    // Incomplete comparative data never produces a visible position or leader.
    summary,
  } as const;
}
