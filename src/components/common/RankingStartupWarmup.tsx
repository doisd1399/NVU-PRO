import { useEffect, useMemo, useRef } from "react";
import {
  useOperationalStore,
  useRankingFilterStore,
  useSessionStore,
} from "../../context/AppContext";
import { useCompanyStore } from "../../context/CompanyContext";
import { auth } from "../../lib/firebase";

import { preloadRoute } from "../../lib/routePreload";
import { useLiveCalendarReference } from "../../hooks/useLiveCalendarReference";
import { useTripsRealtime } from "../../hooks/useTripsRealtime";
import { useRankingUsersRealtime } from "../../hooks/useRankingUsersRealtime";
import {
  beginRankingWarmupSession,
  markRankingWarmupSourcesReady,
  registerRankingPhotoUrls,
  resolveRankingUserPhoto,
  warmRankingUserProfiles,
} from "../../lib/rankingPhotoWarmup";
import { getRuntimePerformanceProfile } from "../../lib/runtimePerformance";
import { resolveCompanySimulatorFilterValue } from "../../lib/simulatorOptions";
import { buildRankingAggregatePeriodKey, isRankingEligibleCompany } from "../../lib/rankingAggregates";
import {
  getRankingUtcCustomRange,
  getRankingUtcEndOfDay,
  getRankingUtcMonthlyRange,
  getRankingUtcStartOfDay,
  getRankingUtcWeeklyRange,
} from "../../lib/rankingPeriods";
import { warmRankingAggregate } from "../../repositories/RankingAggregateRepository";
import { warmRankingCompaniesByIds } from "../../hooks/useRankingCompaniesByIds";

/**
 * Keeps the Ranking's data and avatars warm while the user is still on the
 * workspace home. The component renders nothing; it exists so the first
 * Ranking click does not start Firestore/image work from inside the route.
 */
export default function RankingStartupWarmup() {
  const runtime = useMemo(getRuntimePerformanceProfile, []);
  const { authInitialized, sessionReady, currentUser } = useSessionStore();
  const {
    allCompanies,
    companies: profileCompanies,
    activeCompanyId,
    companiesLoading,
  } = useCompanyStore();
  const { users: knownUsers, simulators } = useOperationalStore();
  const {
    globalPeriodPreset: periodPreset,
    globalStartDateStr: startDateStr,
    globalEndDateStr: endDateStr,
  } = useRankingFilterStore();
  const referenceDate = useLiveCalendarReference("utc");
  const uid = currentUser?.id || "";
  const authenticatedForUid =
    Boolean(uid) && auth.currentUser?.uid === uid;
  const enabled =
    authInitialized &&
    sessionReady &&
    authenticatedForUid;

  const activeCompany = useMemo(() => {
    const companyPool = [...allCompanies, ...profileCompanies].filter(
      (company) => isRankingEligibleCompany(company as Record<string, unknown>),
    );
    return companyPool.find(
      (company: any) => String(company?.id || "") === activeCompanyId,
    );
  }, [activeCompanyId, allCompanies, profileCompanies]);
  const activeSimulatorId = useMemo(
    () =>
      resolveCompanySimulatorFilterValue(
        activeCompany as Record<string, unknown> | undefined,
        simulators as Record<string, unknown>[],
        [...allCompanies, ...profileCompanies].filter((company) =>
          isRankingEligibleCompany(company as Record<string, unknown>),
        ) as Record<string, unknown>[],
      ),
    [activeCompany, allCompanies, profileCompanies, simulators],
  );
  const aggregatePeriodType =
    periodPreset === "semana" || periodPreset === "mes"
      ? periodPreset
      : null;
  const aggregatePeriodKey = useMemo(
    () =>
      aggregatePeriodType
        ? buildRankingAggregatePeriodKey(aggregatePeriodType, referenceDate)
        : "",
    [aggregatePeriodType, referenceDate],
  );

  useEffect(() => {
    if (
      !enabled ||
      !activeSimulatorId ||
      !aggregatePeriodType ||
      !aggregatePeriodKey
    ) {
      return;
    }

    let cancelled = false;
    void warmRankingAggregate(
      activeSimulatorId,
      aggregatePeriodType,
      aggregatePeriodKey,
    )
      .then((aggregate) => {
        if (cancelled || !aggregate) return;
        return warmRankingCompaniesByIds(Object.keys(aggregate.companies));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [
    activeSimulatorId,
    aggregatePeriodKey,
    aggregatePeriodType,
    enabled,
  ]);

  const rankingRange = useMemo(() => {
    if (periodPreset === "semana") return getRankingUtcWeeklyRange(referenceDate);
    if (periodPreset === "mes") return getRankingUtcMonthlyRange(referenceDate);
    if (startDateStr && endDateStr) {
      return getRankingUtcCustomRange(startDateStr, endDateStr);
    }
    if (startDateStr || endDateStr) {
      const fallback = getRankingUtcMonthlyRange(referenceDate);
      return {
        start: startDateStr
          ? getRankingUtcStartOfDay(startDateStr)
          : fallback.start,
        end: endDateStr ? getRankingUtcEndOfDay(endDateStr) : fallback.end,
      };
    }
    return getRankingUtcMonthlyRange(referenceDate);
  }, [endDateStr, periodPreset, referenceDate, startDateStr]);

  // Warm the exact bounded range used by the visible ranking, including the
  // default current week/month path. The visible hook shares this cache, so
  // navigation can paint the first canonical snapshot instead of starting cold.
  const shouldWarmTrips = enabled;
  const { trips, loading: tripsLoading, refreshing: tripsRefreshing } =
    useTripsRealtime({
      startDate: rankingRange.start,
      endDate: rankingRange.end,
      enabled: shouldWarmTrips,
      keepPreviousData: true,
    });

  // The startup listener deliberately uses all simulators. A simulator
  // selection is a client-side filter on the same bounded trip range, so this
  // single participant set covers Entre empresas, Interno and Global. Keep the
  // ID set identical to the global page's canonical participant query; that
  // lets the visible hook reuse the already-hydrated shared entry.
  const participantIds = useMemo(() => {
    const ids = new Set<string>();
    trips.forEach((trip: any) => {
      if (!trip?.isValid) return;
      const driverId = trip.motoristaId || trip.driverId;
      if (driverId) ids.add(String(driverId));
    });
    return Array.from(ids).sort();
  }, [trips]);

  const {
    users: rankingUsers,
    loading: rankingUsersLoading,
    refreshing: rankingUsersRefreshing,
  } = useRankingUsersRealtime(participantIds, shouldWarmTrips);

  // Start the route chunk and the account-scoped readiness barrier as soon as
  // authentication is confirmed. This is intentionally not idle-scheduled.
  useEffect(() => {
    if (!enabled || !uid) return;
    beginRankingWarmupSession(uid);
    void preloadRoute("/ranking").catch(() => undefined);
  }, [enabled, uid]);

  const photoUrls = useMemo(() => {
    const urls = new Set<string>();
    const add = (value: unknown) => {
      if (typeof value !== "string") return;
      const normalized = value.trim();
      if (normalized) urls.add(normalized);
    };

    allCompanies.forEach((company: any) => {
      add(company.logoUrl);
      add(company.logoURL);
      add(company.companyLogoURL);
      add(company.logo);
    });
    [...knownUsers, ...rankingUsers].forEach((user: any) =>
      add(resolveRankingUserPhoto(user)),
    );
    return Array.from(urls).slice(
      0,
      runtime.constrained ? 8 : runtime.mobileViewport ? 24 : 96,
    );
  }, [
    allCompanies,
    knownUsers,
    rankingUsers,
    runtime.constrained,
    runtime.mobileViewport,
  ]);

  const photoSignature = photoUrls.join("|");
  const registeredPhotoSignatureRef = useRef("");
  useEffect(() => {
    if (!enabled || !uid || !photoSignature) return;
    if (registeredPhotoSignatureRef.current === photoSignature) return;
    registeredPhotoSignatureRef.current = photoSignature;

    // Register the mapping before the request starts so the route itself can
    // reuse it if the user taps while the final batch is still settling.
    const concurrency = runtime.constrained
      ? 1
      : runtime.mobileViewport
        ? 3
        : 8;
    void warmRankingUserProfiles(
      [...knownUsers, ...rankingUsers].slice(
        0,
        runtime.constrained ? 8 : runtime.mobileViewport ? 24 : 96,
      ),
      concurrency,
    );
    void registerRankingPhotoUrls(uid, photoUrls, concurrency);
  }, [
    enabled,
    knownUsers,
    photoSignature,
    photoUrls,
    rankingUsers,
    runtime.constrained,
    runtime.mobileViewport,
    uid,
  ]);

  const sourceReady =
    enabled &&
    !companiesLoading &&
    (!shouldWarmTrips ||
      (!tripsLoading &&
        !tripsRefreshing &&
        (!participantIds.length ||
          (!rankingUsersLoading && !rankingUsersRefreshing))));

  useEffect(() => {
    if (!sourceReady || !uid) return;
    markRankingWarmupSourcesReady(uid);
  }, [sourceReady, uid]);

  return null;
}
