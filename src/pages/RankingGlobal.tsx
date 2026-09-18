import React, {
  memo,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronLeft, Trophy, ChevronDown, List as ListIcon, Building2, Users, Globe2, ChevronRight, Crown, Calendar, X, Menu } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useOperationalStore, useRankingFilterStore, useSessionStore } from "../context/AppContext";
import { useNotificationStore } from "../context/NotificationsContext";
import { useCompanyStore } from "../context/CompanyContext";
import { useTripsRealtime } from "../hooks/useTripsRealtime";
import { groupMetricsByCompany, filterTripsBySimulator } from "../lib/metricsEngine";
import { preloadImages } from "../lib/imageCache";
import { StableImage } from "../components/common/StableImage";
import { NotificationCenter } from "../components/NotificationCenter";
import { resolveDriverPhoto } from "../lib/resolveDriverPhoto";
import { cn } from "../lib/utils";
import { buildDriverRankingPageData } from "../lib/rankingPageEngine";
import { useRankingUsersRealtime } from "../hooks/useRankingUsersRealtime";
import { useRankingCompaniesByIds } from "../hooks/useRankingCompaniesByIds";
import { useLiveCalendarReference } from "../hooks/useLiveCalendarReference";
import { useRankingAggregate } from "../hooks/useRankingAggregate";
import {
  warmRankingPhotosForIds,
  warmRankingUserProfiles,
} from "../lib/rankingPhotoWarmup";
import {
  buildSimulatorSelectorOptions,
  companyMatchesSimulatorOption,
  findSimulatorOption,
  resolveCompanySimulatorFilterValue,
} from "../lib/simulatorOptions";
import {
  buildCompanyRankingFromAggregate,
  buildDriverRankingFromAggregate,
  buildRankingAggregatePeriodKey,
  isRankingEligibleCompany,
  type RankingAggregatePeriodType,
} from "../lib/rankingAggregates";
import {
  formatRankingMonthLabel,
  getRankingUtcCustomRange,
  getRankingUtcEndOfDay,
  getRankingUtcMonthlyRange,
  getRankingUtcStartOfDay,
  getRankingUtcWeeklyRange,
} from "../lib/rankingPeriods";
import { getRuntimePerformanceProfile } from "../lib/runtimePerformance";

const freezeRankingSnapshot = (items: any[]) =>
  items.map((item) => ({ ...item }));

const BRL_FORMATTER = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const formatRankingCurrency = (value: number) => BRL_FORMATTER.format(value);
const getRankingInitials = (name: string) =>
  name?.substring(0, 2).toUpperCase() || "UN";

const ALL_SIMULATORS_VALUE = "all";
const ALL_SIMULATORS_LABEL = "Todos os simuladores";
// Warm the podium and the first scroll window only. Lower rows remain lazy so
// ranking data is not held behind dozens of image decodes.
const RANKING_CRITICAL_IMAGE_LIMIT = 24;
const RANKING_IMAGE_CONCURRENCY = 6;

const getRankingImagePreloadConfig = () => {
  const runtime = getRuntimePerformanceProfile();
  return {
    criticalLimit: runtime.constrained
      ? 6
      : runtime.mobileViewport
        ? 12
        : RANKING_CRITICAL_IMAGE_LIMIT,
    concurrency: runtime.constrained
      ? 2
      : runtime.mobileViewport
        ? 3
        : RANKING_IMAGE_CONCURRENCY,
    deferredLimit: runtime.constrained
      ? 0
      : runtime.mobileViewport
        ? 24
        : 96,
    allowBroadWarmup: !runtime.constrained,
    mobileViewport: runtime.mobileViewport,
    // Images must never block the first ranking paint. They warm in parallel
    // and StableImage keeps fixed dimensions while the browser/WebView decodes.
    gateInitialPublishOnImages: false,
  };
};

type RankingSnapshotCacheEntry = {
  cachedAt: number;
  items: any[];
};

// Ranking snapshots are short-lived, UID-scoped first-paint accelerators.
// They are never authoritative: the realtime path still reconciles and replaces
// them. A short TTL prevents a cold WebView from showing an old classification
// while avoiding the blank/skeleton cycle on every app restart.
const RANKING_CACHE_TTL_MS = 2 * 60 * 1000;
const RANKING_PERSISTED_CACHE_TTL_MS = 15 * 60 * 1000;
const RANKING_PERSISTED_CACHE_PREFIX = "nvu.ranking.snapshot.v2.";
const RANKING_CACHE_LIMIT = 16;
const rankingSnapshotCache = new Map<string, RankingSnapshotCacheEntry>();
let lastRankingSnapshot: RankingSnapshotCacheEntry | null = null;

const readRankingSnapshot = (key: string): any[] => {
  const cached = rankingSnapshotCache.get(key);
  if (cached && Date.now() - cached.cachedAt <= RANKING_CACHE_TTL_MS) {
    return cached.items;
  }
  if (cached) rankingSnapshotCache.delete(key);

  if (typeof window === "undefined") return [];
  try {
    const storageKey = `${RANKING_PERSISTED_CACHE_PREFIX}${encodeURIComponent(key)}`;
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RankingSnapshotCacheEntry;
    if (
      !parsed ||
      typeof parsed.cachedAt !== "number" ||
      Date.now() - parsed.cachedAt > RANKING_PERSISTED_CACHE_TTL_MS ||
      !Array.isArray(parsed.items)
    ) {
      window.localStorage.removeItem(storageKey);
      return [];
    }
    const persisted = {
      cachedAt: parsed.cachedAt,
      items: parsed.items.slice(0, 200),
    };
    rankingSnapshotCache.set(key, persisted);
    return persisted.items;
  } catch {
    return [];
  }
};

const readLastRankingSnapshot = (): any[] => {
  if (
    !lastRankingSnapshot ||
    Date.now() - lastRankingSnapshot.cachedAt > RANKING_CACHE_TTL_MS
  ) {
    lastRankingSnapshot = null;
    return [];
  }
  return lastRankingSnapshot.items;
};

const writeRankingSnapshot = (key: string, items: any[]) => {
  const compactItems = items.slice(0, 200).map((item) => ({
    id: item.id,
    name: item.name,
    logo: item.logo,
    val: item.val,
    trips: item.trips,
  }));
  const entry = { cachedAt: Date.now(), items: compactItems };
  rankingSnapshotCache.delete(key);
  rankingSnapshotCache.set(key, entry);
  lastRankingSnapshot = entry;

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(
        `${RANKING_PERSISTED_CACHE_PREFIX}${encodeURIComponent(key)}`,
        JSON.stringify(entry),
      );
    } catch {
      // The in-memory snapshot remains sufficient when storage is unavailable.
    }
  }

  while (rankingSnapshotCache.size > RANKING_CACHE_LIMIT) {
    const oldestKey = rankingSnapshotCache.keys().next().value;
    if (!oldestKey) break;
    rankingSnapshotCache.delete(oldestKey);
  }
};

const rankingImageUrls = (
  items: any[],
  limit = getRankingImagePreloadConfig().criticalLimit,
) =>
  items
    .slice(0, limit)
    .map((item) => item?.logo)
    .filter((url): url is string => typeof url === "string" && Boolean(url.trim()));

const preloadRankingSnapshotImages = (items: any[]) => {
  const config = getRankingImagePreloadConfig();
  return preloadImages(
    rankingImageUrls(items, config.criticalLimit),
    config.concurrency,
    "auto",
  );
};

export function preloadLastRankingSnapshotImages(): Promise<void> {
  return preloadRankingSnapshotImages(readLastRankingSnapshot());
}

type RankingListItemProps = {
  item: any;
  actualRank: number;
  critical: boolean;
};

const RankingListItem = memo(function RankingListItem({
  item,
  actualRank,
  critical,
}: RankingListItemProps) {
  let rankStyle = "bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-400";
  let itemBorderColor = "border-gray-100 dark:border-[#2A2F3A]";

  if (actualRank === 1) {
    rankStyle = "bg-yellow-50 text-yellow-600 border border-yellow-200 dark:bg-yellow-500/20 dark:text-yellow-500 dark:border-yellow-500/30 shadow-sm dark:shadow-[0_0_10px_rgba(250,204,21,0.2)]";
    itemBorderColor = "border-yellow-200/50 dark:border-yellow-500/20";
  } else if (actualRank === 2) {
    rankStyle = "bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-300/20 dark:text-slate-300 dark:border-slate-300/30 shadow-sm";
  } else if (actualRank === 3) {
    rankStyle = "bg-orange-50 text-orange-600 border border-orange-200 dark:bg-orange-500/20 dark:text-orange-400 dark:border-orange-500/30 shadow-sm";
  }

  const initials = getRankingInitials(String(item?.name || ""));
  const logo = item?.logo;

  return (
    <div
      key={item.id}
      style={{ contentVisibility: "auto", containIntrinsicSize: "76px" }}
      className={`flex items-center justify-between gap-3 p-3 sm:p-4 bg-white dark:bg-[#1A1D24] rounded-2xl hover:bg-gray-50 dark:hover:bg-[#1F232B] transition-colors border ${itemBorderColor} hover:border-gray-200 dark:hover:border-[#3A4050] shadow-sm group cursor-pointer`}
    >
      <div className="flex items-center gap-3 w-full max-w-[65%]">
        <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-[13px] sm:text-sm font-black shrink-0 ${rankStyle}`}>
          {actualRank}º
        </div>
        {logo ? (
          <StableImage
            src={logo}
            alt={item.name}
            loading={critical ? "eager" : "lazy"}
            decoding="async"
            fetchPriority={critical ? "high" : "low"}
            preload={critical}
            hideFallbackWhenCached
            hideFallbackWhileLoading
            wrapperClassName="w-9 h-9 sm:w-12 sm:h-12 rounded-full bg-white shrink-0 shadow-sm border border-gray-100 dark:border-gray-800"
            className="object-cover"
            fallback={<span className="h-full w-full bg-gray-100 dark:bg-slate-800 flex items-center justify-center text-gray-400 dark:text-slate-400 font-bold">{initials}</span>}
          />
        ) : (
          <div className="w-9 h-9 sm:w-12 sm:h-12 rounded-full bg-gray-100 dark:bg-slate-800 border-2 border-gray-200 dark:border-slate-700 flex items-center justify-center shrink-0 shadow-sm text-gray-400 dark:text-slate-400 font-bold">
            {initials}
          </div>
        )}
        <div className="flex flex-col min-w-0 pr-1">
          <p className="text-sm sm:text-base font-bold text-gray-900 dark:text-white line-clamp-2 leading-tight">{item.name}</p>
          <div className="mt-1">
            <span className="text-[11px] sm:text-xs text-gray-500 dark:text-slate-400 font-medium bg-gray-100 dark:bg-slate-800/50 px-1.5 py-0.5 rounded-md whitespace-nowrap">{item.trips} viagens</span>
          </div>
        </div>
      </div>
      <div className="flex flex-col items-end shrink-0 pl-2">
        <span className="text-[10px] text-gray-400 dark:text-slate-500 font-semibold mb-0.5 whitespace-nowrap">Ganhos totais</span>
        <p className="text-[14px] sm:text-lg font-black text-green-600 dark:text-green-500 tracking-tight">{formatRankingCurrency(item.val)}</p>
      </div>
    </div>
  );
});

export default function RankingGlobal() {
  const navigate = useNavigate();
  const rankingImageConfig = useMemo(getRankingImagePreloadConfig, []);
  const { currentUser } = useSessionStore();
  const { notifications, markNotificationAsRead } = useNotificationStore();
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const {
    activeCompanyId,
    allCompanies,
    companies: profileCompanies,
    companiesLoading,
    companyCatalogLoaded,
    companyCatalogAttempted,
    loadCompanyCatalog,
    allCompanyMembers,
  } = useCompanyStore();
  const {
    simulators,
    simulatorsLoading,
    users: knownUsers,
  } = useOperationalStore();
  const {
    globalPeriodPreset: periodPreset,
    setGlobalPeriodPreset: setPeriodPreset,
    globalStartDateStr: startDateStr,
    setGlobalStartDateStr: setStartDateStr,
    globalEndDateStr: endDateStr,
    setGlobalEndDateStr: setEndDateStr,
  } = useRankingFilterStore();

  const catalogCompanies = (allCompanies || []) as any[];
  const profileCompanyPool = useMemo(() => {
    const map = new Map<string, any>();
    [
      ...catalogCompanies,
      ...((profileCompanies || []) as any[]),
    ].forEach((company) => {
      if (company?.id) map.set(String(company.id), company);
    });
    return Array.from(map.values());
  }, [catalogCompanies, profileCompanies]);

  const rankingCompanyPool = useMemo(
    () => profileCompanyPool.filter((company) => isRankingEligibleCompany(company)),
    [profileCompanyPool],
  );
  const headerCompany = profileCompanyPool.find((company) => company.id === activeCompanyId) || profileCompanyPool[0] || null;

  const simulatorOptions = useMemo(
    () =>
      buildSimulatorSelectorOptions(
        simulators as Record<string, unknown>[],
        rankingCompanyPool,
      ),
    [rankingCompanyPool, simulators],
  );

  const activeCompany = useMemo(
    () =>
      profileCompanyPool.find((company) => company.id === activeCompanyId) ||
      profileCompanyPool.find(
        (company) => company.id === (currentUser as any)?.companyId,
      ),
    [activeCompanyId, currentUser, profileCompanyPool],
  );

  const profileSimulatorCandidates = useMemo(() => {
    const user = currentUser as any;
    const companySimulator = resolveCompanySimulatorFilterValue(
      activeCompany,
      simulators as Record<string, unknown>[],
      rankingCompanyPool,
    );

    return Array.from(
      new Set(
        [
          companySimulator,
          activeCompany?.simulatorId,
          activeCompany?.simuladorId,
          activeCompany?.simulatorName,
          activeCompany?.simuladorNome,
          activeCompany?.simulator,
          user?.currentRecruitmentSimulatorId,
          user?.simulatorId,
          user?.simuladorId,
          user?.simulatorName,
          user?.simuladorNome,
          user?.simulator,
        ]
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      ),
    );
  }, [activeCompany, currentUser, rankingCompanyPool, simulators]);

  const preferredProfileSimulator = useMemo(() => {
    for (const candidate of profileSimulatorCandidates) {
      const option = findSimulatorOption(candidate, simulatorOptions);
      if (option) return option;
    }
    return undefined;
  }, [profileSimulatorCandidates, simulatorOptions]);

  const preferredProfileSimulatorValue =
    preferredProfileSimulator?.value || "";
  const profileSimulatorSourceKey = [
    currentUser?.id || "anonymous",
    activeCompany?.id || activeCompanyId || (currentUser as any)?.companyId || "",
    preferredProfileSimulatorValue || profileSimulatorCandidates.join("~"),
  ].join("|");

  // Start with the active profile's simulator whenever the session cache is
  // already hydrated. When it is not, keep the selector pending until the
  // profile/company catalogs finish loading instead of briefly showing an
  // incorrect cross-simulator ranking.
  const [simulator, setSimulator] = useState<string>(
    () => preferredProfileSimulatorValue,
  );
  const simulatorSelectionModeRef = useRef<"pending" | "auto" | "user">(
    preferredProfileSimulatorValue ? "auto" : "pending",
  );
  const autoSimulatorSourceRef = useRef("");
  const [rankingType, setRankingType] = useState<"entre" | "interno" | "global">("entre");
  const [viewType, setViewType] = useState<"podio" | "lista">("podio");
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");

  const [showDatePicker, setShowDatePicker] = useState(false);
  const referenceDate = useLiveCalendarReference("utc");

  const rankingRange = useMemo(() => {
    if (periodPreset === "semana") return getRankingUtcWeeklyRange(referenceDate);
    if (periodPreset === "mes") return getRankingUtcMonthlyRange(referenceDate);

    if (startDateStr && endDateStr) {
      return getRankingUtcCustomRange(startDateStr, endDateStr);
    }

    const fallback = getRankingUtcMonthlyRange(referenceDate);
    if (startDateStr || endDateStr) {
      return {
        start: startDateStr
          ? getRankingUtcStartOfDay(startDateStr)
          : fallback.start,
        end: endDateStr
          ? getRankingUtcEndOfDay(endDateStr)
          : fallback.end,
      };
    }

    return fallback;
  }, [endDateStr, periodPreset, referenceDate, startDateStr]);

  const aggregatePeriodType = useMemo<RankingAggregatePeriodType | undefined>(
    () =>
      periodPreset === "semana" || periodPreset === "mes"
        ? periodPreset
        : undefined,
    [periodPreset],
  );
  const aggregatePeriodKey = useMemo(
    () =>
      aggregatePeriodType
        ? buildRankingAggregatePeriodKey(aggregatePeriodType, referenceDate)
        : "",
    [aggregatePeriodType, referenceDate],
  );
  // Open periods are mutable. Every operational surface reads the live
  // historico_viagens dataset, so using a precomputed document here can show
  // stale totals after a deletion, moderation action or missed backend
  // trigger. Aggregates remain useful for closed periods, whose result is
  // immutable; the current week/month always uses the same bounded live
  // source as profiles, dashboards and Histórico de Viagens.
  const isOpenRankingPeriod = rankingRange.end.getTime() >= Date.now();
  const aggregateEligible = Boolean(
    aggregatePeriodType &&
      aggregatePeriodKey &&
      simulator &&
      simulator !== ALL_SIMULATORS_VALUE &&
      rankingType !== "interno" &&
      !isOpenRankingPeriod,
  );
  const rankingAggregateState = useRankingAggregate({
    simulatorId: simulator,
    periodType: aggregatePeriodType,
    periodKey: aggregatePeriodKey,
    enabled: aggregateEligible,
  });
  const consolidatedAggregate =
    rankingAggregateState.status === "ready"
      ? rankingAggregateState.aggregate
      : null;
  const standardCollectiveRanking = Boolean(
    aggregatePeriodType && rankingType !== "interno",
  );
  const useTripFallback =
    isOpenRankingPeriod ||
    !standardCollectiveRanking ||
    simulator === ALL_SIMULATORS_VALUE ||
    rankingAggregateState.status === "unavailable";

  // Standard weekly/monthly rankings read only the companies referenced by
  // the selected aggregate. The complete `frotas` catalog remains a guarded
  // fallback for custom periods, "Todos os simuladores" and deployments where
  // the aggregate Function is not available yet.
  const aggregateCompanyIds = useMemo(() => {
    if (!consolidatedAggregate) return [] as string[];
    const ids = new Set<string>(Object.keys(consolidatedAggregate.companies));
    Object.values(consolidatedAggregate.drivers).forEach((driver: { companyId?: string }) => {
      const companyId = String(driver.companyId || "").trim();
      if (companyId) ids.add(companyId);
    });
    return Array.from(ids).sort();
  }, [consolidatedAggregate]);

  const {
    companies: aggregateCompanies,
    loading: aggregateCompaniesLoading,
    refreshing: aggregateCompaniesRefreshing,
    error: aggregateCompaniesError,
    complete: aggregateCompaniesComplete,
    serverConfirmed: aggregateCompaniesServerConfirmed,
  } = useRankingCompaniesByIds(
    aggregateCompanyIds,
    Boolean(consolidatedAggregate),
  );

  // A failed bounded confirmation must not trigger a collection-wide
  // fallback. Keep the aggregate gated until its exact company IDs are
  // server-confirmed; this avoids turning a transient Android read failure
  // into an expensive full `frotas` scan.
  const effectiveTripFallback = useTripFallback;
  const aggregateForRanking = consolidatedAggregate;

  const companies = useMemo(() => {
    const byId = new Map<string, any>();
    [
      ...catalogCompanies,
      ...((profileCompanies || []) as any[]),
      ...aggregateCompanies,
    ].forEach((company) => {
      const id = String(company?.id || "").trim();
      if (id) byId.set(id, company);
    });
    return Array.from(byId.values()).filter((company) =>
      isRankingEligibleCompany(company),
    );
  }, [aggregateCompanies, catalogCompanies, profileCompanies]);

  const companyCatalogRetryRef = useRef(0);
  useEffect(() => {
    if (!effectiveTripFallback || companyCatalogLoaded) {
      companyCatalogRetryRef.current = 0;
      return;
    }

    let cancelled = false;
    const delay = companyCatalogAttempted
      ? Math.min(12_000, 1_500 * 2 ** companyCatalogRetryRef.current)
      : 0;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      companyCatalogRetryRef.current = Math.min(
        companyCatalogRetryRef.current + 1,
        3,
      );
      void loadCompanyCatalog(companyCatalogAttempted).catch(() => undefined);
    }, delay);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    companyCatalogAttempted,
    companyCatalogLoaded,
    effectiveTripFallback,
    loadCompanyCatalog,
  ]);

  const rankingCacheKey = useMemo(
    () =>
      [
        currentUser?.id || "anonymous",
        rankingType,
        simulator,
        rankingType === "interno" ? selectedCompanyId || activeCompanyId || "" : "",
        rankingRange.start.getTime(),
        rankingRange.end.getTime(),
        isOpenRankingPeriod ? "live" : "closed",
      ].join("|"),
    [
      activeCompanyId,
      currentUser?.id,
      rankingRange.end,
      rankingRange.start,
      rankingType,
      selectedCompanyId,
      simulator,
      isOpenRankingPeriod,
    ],
  );
  const [visibleRankingSnapshot, setVisibleRankingSnapshot] = useState<{
    key: string;
    signature: string;
    items: any[];
  }>(() => {
    const exact = readRankingSnapshot(rankingCacheKey);
    const immediateItems = rankingImageConfig.gateInitialPublishOnImages
      ? []
      : freezeRankingSnapshot(exact);
    return {
      key: rankingCacheKey,
      signature: immediateItems
        .map((item) =>
          [item.id, item.name, item.logo || "", item.val, item.trips].join("~"),
        )
        .join("|"),
      // Mobile favors immediate information. StableImage reserves the final
      // dimensions and hides its fallback while decoding, so rows can paint
      // now without producing an initials -> photo or layout-shift flash.
      items: immediateItems,
    };
  });
  const visibleRankingKeyRef = useRef(rankingCacheKey);
  const publishedRankingRef = useRef<{
    key: string;
    signature: string | null;
  }>({
    key: rankingCacheKey,
    signature: null,
  });

  useEffect(() => {
    const keyChanged = visibleRankingKeyRef.current !== rankingCacheKey;
    if (keyChanged) {
      // A snapshot from another simulator/period must never remain visible
      // after the filter changes. Keep the stable empty podium until the exact
      // snapshot (if any) has its critical photos ready.
      visibleRankingKeyRef.current = rankingCacheKey;
      publishedRankingRef.current = { key: rankingCacheKey, signature: null };
      setVisibleRankingSnapshot({
        key: rankingCacheKey,
        signature: "",
        items: [],
      });
    }

    const exact = readRankingSnapshot(rankingCacheKey);
    if (exact.length === 0) return;

    let cancelled = false;
    const snapshot = freezeRankingSnapshot(exact);
    const signature = snapshot
      .map((item) =>
        [item.id, item.name, item.logo || "", item.val, item.trips].join("~"),
      )
      .join("|");

    const publish = () => {
      if (
        cancelled ||
        visibleRankingKeyRef.current !== rankingCacheKey ||
        (publishedRankingRef.current.key === rankingCacheKey &&
          publishedRankingRef.current.signature !== null)
      ) {
        return;
      }
      publishedRankingRef.current = {
        key: rankingCacheKey,
        signature,
      };
      setVisibleRankingSnapshot({
        key: rankingCacheKey,
        signature,
        items: snapshot,
      });
    };

    if (rankingImageConfig.gateInitialPublishOnImages) {
      void preloadRankingSnapshotImages(snapshot).then(publish);
    } else {
      publish();
      void preloadRankingSnapshotImages(snapshot);
    }

    return () => {
      cancelled = true;
    };
  }, [rankingCacheKey, rankingImageConfig.gateInitialPublishOnImages]);

  const {
    trips,
    loading: tripsLoading,
    refreshing: tripsRefreshing,
    error: tripsError,
  } = useTripsRealtime({
    startDate: rankingRange.start,
    endDate: rankingRange.end,
    enabled: effectiveTripFallback,
    keepPreviousData: true,
  });

  const rankingComputationInput = useMemo(
    () => ({
      trips,
      rankingType,
      simulator,
      selectedCompanyId,
      startDate: rankingRange.start,
      endDate: rankingRange.end,
      companies,
      simulators: simulators as Record<string, unknown>[],
      consolidatedAggregate: aggregateForRanking,
    }),
    [
      companies,
      rankingRange.end,
      rankingRange.start,
      rankingType,
      selectedCompanyId,
      simulator,
      simulators,
      trips,
      aggregateForRanking,
    ],
  );
  // The cached/empty frame can commit immediately after the route click. Large
  // trip aggregation then runs in React's interruptible background render
  // instead of delaying the first visible ranking frame.
  // The startup warm-up now hydrates the shared trip/user caches before this
  // route is revealed. Use the current input on the first render instead of
  // intentionally yielding an `undefined` frame, which used to create an
  // empty podium before the already-ready photos could be attached.
  const deferredRankingInput = useDeferredValue(rankingComputationInput);
  const rankingComputationReady =
    deferredRankingInput === rankingComputationInput;
  const preparedRankingTrips = useMemo(() => {
    if (deferredRankingInput?.consolidatedAggregate) return [];
    if (!deferredRankingInput?.simulator) return [];
    const eligibleCompanyIds = new Set(
      deferredRankingInput.companies
        .map((company: any) => String(company?.id || "").trim())
        .filter(Boolean),
    );
    return filterTripsBySimulator(
      deferredRankingInput.trips,
      deferredRankingInput.simulator,
      deferredRankingInput.companies,
      deferredRankingInput.simulators,
    ).filter((trip: any) => {
      const companyId = String(
        trip?.empresaId || trip?.companyId || trip?.company_id || "",
      ).trim();
      return Boolean(companyId) && eligibleCompanyIds.has(companyId);
    });
  }, [deferredRankingInput]);

  const activeInternalDriverIds = useMemo(() => {
    if (rankingType !== "interno" || !selectedCompanyId) return [] as string[];
    return Array.from(
      new Set(
        (allCompanyMembers || [])
          .filter((member: any) => {
            if (String(member?.companyId || "") !== selectedCompanyId) return false;
            if (String(member?.status || "").toLowerCase() !== "active") return false;
            const roles = Array.isArray(member?.roles)
              ? member.roles.map((role: unknown) => String(role).toLowerCase())
              : [];
            return roles.includes("driver") || String(member?.role || "").toLowerCase() === "driver";
          })
          .map((member: any) => String(member?.userId || "").trim())
          .filter(Boolean),
      ),
    ).sort();
  }, [allCompanyMembers, rankingType, selectedCompanyId]);

  const rankingParticipantIds = useMemo(() => {
    if (!deferredRankingInput?.simulator) return [] as string[];
    if (deferredRankingInput.rankingType === "entre") return [] as string[];

    if (
      deferredRankingInput.rankingType === "global" &&
      deferredRankingInput.consolidatedAggregate
    ) {
      return Object.keys(
        deferredRankingInput.consolidatedAggregate.drivers,
      ).sort();
    }

    const ids = new Set<string>(
      deferredRankingInput.rankingType === "interno"
        ? activeInternalDriverIds
        : [],
    );
    preparedRankingTrips.forEach((trip: any) => {
      if (!trip.isValid) return;
      const tripCompanyId = trip.empresaId || trip.companyId || trip.company_id;
      if (
        deferredRankingInput.rankingType === "interno" &&
        deferredRankingInput.selectedCompanyId &&
        tripCompanyId !== deferredRankingInput.selectedCompanyId
      )
        return;

      const driverId = trip.motoristaId || trip.driverId;
      if (driverId) ids.add(String(driverId));
    });
    return Array.from(ids).sort();
  }, [activeInternalDriverIds, deferredRankingInput, preparedRankingTrips]);

  const {
    users,
    loading: usersLoading,
    refreshing: usersRefreshing,
    error: usersError,
  } = useRankingUsersRealtime(
    rankingParticipantIds,
    Boolean(
      deferredRankingInput &&
        deferredRankingInput.rankingType !== "entre",
      ),
  );

  // AppContext already has the active company's users in most sessions. Warm
  // those URLs immediately (rather than waiting for an idle callback), while
  // the scoped ranking hook handles participants outside that company.
  useEffect(() => {
    if (!rankingImageConfig.allowBroadWarmup) return;
    void warmRankingUserProfiles(
      (knownUsers as any[]).slice(0, rankingImageConfig.criticalLimit),
      rankingImageConfig.concurrency,
    );
  }, [knownUsers, rankingImageConfig]);

  useEffect(() => {
    void warmRankingPhotosForIds(
      rankingParticipantIds.slice(0, rankingImageConfig.criticalLimit),
      rankingImageConfig.concurrency,
    );
  }, [rankingImageConfig, rankingParticipantIds]);

  // Initialize with current month for fallback
  useEffect(() => {
    if (!startDateStr && !endDateStr) {
      const { start: firstDay, end: lastDay } =
        getRankingUtcMonthlyRange(referenceDate);
      const pad = (n: number) => n.toString().padStart(2, "0");
      setStartDateStr(
        `${firstDay.getUTCFullYear()}-${pad(firstDay.getUTCMonth() + 1)}-${pad(firstDay.getUTCDate())}`,
      );
      setEndDateStr(
        `${lastDay.getUTCFullYear()}-${pad(lastDay.getUTCMonth() + 1)}-${pad(lastDay.getUTCDate())}`,
      );
    }
  }, [
    endDateStr,
    referenceDate,
    setEndDateStr,
    setStartDateStr,
    startDateStr,
  ]);

  const formatDateBR = (isoString: string) => {
    if (!isoString) return "";
    const [year, month, day] = isoString.split("-");
    return `${day}/${month}/${year}`;
  };

  // When opening, if it's internal ranking, auto-select active company
  useEffect(() => {
    if (rankingType === "interno" && !selectedCompanyId && activeCompanyId) {
      setSelectedCompanyId(activeCompanyId);
    }
  }, [rankingType, activeCompanyId, selectedCompanyId]);

  // Every time the logged profile/company changes, initialize the ranking with
  // that profile's simulator. A manual selection remains untouched while the
  // same profile is active, including an intentional "Todos os simuladores".
  useEffect(() => {
    const sourceChanged =
      autoSimulatorSourceRef.current !== profileSimulatorSourceKey;

    if (sourceChanged) {
      autoSimulatorSourceRef.current = profileSimulatorSourceKey;
      simulatorSelectionModeRef.current = "pending";
    }

    if (!sourceChanged && simulatorSelectionModeRef.current === "user") return;

    if (preferredProfileSimulatorValue) {
      simulatorSelectionModeRef.current = "auto";
      setSimulator((current) =>
        current === preferredProfileSimulatorValue
          ? current
          : preferredProfileSimulatorValue,
      );
      return;
    }

    if (companiesLoading || simulatorsLoading) {
      if (sourceChanged) setSimulator("");
      return;
    }

    simulatorSelectionModeRef.current = "auto";
    setSimulator(ALL_SIMULATORS_VALUE);
  }, [
    companiesLoading,
    preferredProfileSimulatorValue,
    profileSimulatorSourceKey,
    simulatorsLoading,
  ]);

  // Reconcile legacy aliases after the catalog is loaded. This keeps a
  // selected simulator stable even when old profiles store a name while the
  // selector uses the canonical Firestore simulator ID.
  useEffect(() => {
    if (!simulator || simulator === ALL_SIMULATORS_VALUE) return;

    const resolvedOption = findSimulatorOption(simulator, simulatorOptions);
    if (resolvedOption) {
      if (resolvedOption.value !== simulator) setSimulator(resolvedOption.value);
      return;
    }

    if (companiesLoading || simulatorsLoading) return;

    setSimulator(
      preferredProfileSimulatorValue ||
        simulatorOptions[0]?.value ||
        ALL_SIMULATORS_VALUE,
    );
  }, [
    companiesLoading,
    preferredProfileSimulatorValue,
    simulator,
    simulatorOptions,
    simulatorsLoading,
  ]);

  const filteredCompaniesForDropdown = useMemo(() => {
    if (!simulator) return [];
    if (simulator === ALL_SIMULATORS_VALUE) return companies;
    return companies.filter((company) =>
      companyMatchesSimulatorOption(company, simulator, simulatorOptions),
    );
  }, [companies, simulator, simulatorOptions]);

  useEffect(() => {
    if (rankingType === "interno" && selectedCompanyId) {
       const isValid = filteredCompaniesForDropdown.some(c => c.id === selectedCompanyId);
       if (!isValid) {
         setSelectedCompanyId(filteredCompaniesForDropdown.length > 0 ? filteredCompaniesForDropdown[0].id : "");
       }
    }
  }, [simulator, rankingType, filteredCompaniesForDropdown, selectedCompanyId]);

  const calculatedRankingData = useMemo(() => {
    if (!deferredRankingInput?.simulator) return [];

    if (deferredRankingInput.consolidatedAggregate) {
      if (deferredRankingInput.rankingType === "entre") {
        return buildCompanyRankingFromAggregate(
          deferredRankingInput.consolidatedAggregate,
          deferredRankingInput.companies,
          deferredRankingInput.simulators,
        );
      }
      if (deferredRankingInput.rankingType === "global") {
        return buildDriverRankingFromAggregate(
          deferredRankingInput.consolidatedAggregate,
          users,
          deferredRankingInput.companies,
          deferredRankingInput.simulators,
          (allCompanyMembers as unknown) as Record<string, unknown>[],
        );
      }
    }

    if (deferredRankingInput.rankingType === "entre") {
      return groupMetricsByCompany(
        deferredRankingInput.trips,
        deferredRankingInput.startDate,
        deferredRankingInput.endDate,
        deferredRankingInput.simulator,
        deferredRankingInput.companies,
        deferredRankingInput.simulators,
      );
    }

    const driverRanking = buildDriverRankingPageData({
      trips: preparedRankingTrips,
      startDate: deferredRankingInput.startDate,
      endDate: deferredRankingInput.endDate,
      scope:
        deferredRankingInput.rankingType === "interno"
          ? "internal"
          : "global",
      companyId:
        deferredRankingInput.rankingType === "interno"
          ? deferredRankingInput.selectedCompanyId
          : undefined,
      // The input was already filtered by the canonical simulator boundary in
      // `preparedRankingTrips`; keep the simulator ID for identity checks but
      // avoid a second full scan in the shared engine.
      simulatorId: deferredRankingInput.simulator,
      tripsAlreadyFilteredBySimulator: true,
      companies: deferredRankingInput.companies,
      simulators: deferredRankingInput.simulators,
      users,
      companyMembers: (allCompanyMembers as unknown) as Record<string, unknown>[],
    });

    if (deferredRankingInput.rankingType !== "interno") return driverRanking;

    const usersById = new Map(
      users.map((user: any) => [String(user?.id || ""), user] as const),
    );
    const existingIds = new Set(driverRanking.map((item) => item.id));
    const selectedCompany = deferredRankingInput.companies.find(
      (company: any) => String(company?.id || "") === deferredRankingInput.selectedCompanyId,
    );
    const companyName = String(
      selectedCompany?.companyName || selectedCompany?.name || "",
    );
    const zeroActivityDrivers = activeInternalDriverIds
      .filter((id) => !existingIds.has(id))
      .map((id) => {
        const user = usersById.get(id) as any;
        const fullName = String(user?.name || "Motorista Desconhecido").trim();
        return {
          id,
          name: fullName.split(/\s+/).slice(0, 2).join(" "),
          logo: String(
            user?.profilePhotoURL ||
              user?.photoURL ||
              user?.photoUrl ||
              user?.avatar ||
              "",
          ),
          trips: 0,
          val: 0,
          companyId: deferredRankingInput.selectedCompanyId,
          companyName,
        };
      });

    return [...driverRanking, ...zeroActivityDrivers].sort((a, b) => {
      if (b.val !== a.val) return b.val - a.val;
      if (b.trips !== a.trips) return b.trips - a.trips;
      const nameOrder = a.name.localeCompare(b.name, "pt-BR", {
        sensitivity: "base",
        numeric: true,
      });
      return nameOrder || a.id.localeCompare(b.id);
    });
  }, [
    activeInternalDriverIds,
    allCompanyMembers,
    deferredRankingInput,
    preparedRankingTrips,
    users,
  ]);

  const internalSelectionReady =
    rankingType !== "interno" ||
    Boolean(selectedCompanyId) ||
    filteredCompaniesForDropdown.length === 0;
  const hasComputedRankingProjection = calculatedRankingData.length > 0;
  const participantProfilesReady =
    deferredRankingInput?.rankingType === "entre" ||
    // Cold start may paint a trustworthy projection from canonical trip data.
    // Profile documents still reconcile in the background and replace names/
    // photos when complete; they no longer block the first useful frame.
    hasComputedRankingProjection ||
    Boolean(
      deferredRankingInput &&
        !usersLoading &&
        !usersRefreshing,
    );
  const simulatorSelectionReady =
    Boolean(simulator) ||
    (!simulatorsLoading && simulatorOptions.length === 0);
  const aggregateSourceReady = Boolean(aggregateForRanking);
  const aggregateCompaniesReady =
    !aggregateSourceReady ||
    (aggregateCompaniesComplete === true &&
      aggregateCompaniesServerConfirmed === true &&
      !aggregateCompaniesLoading &&
      !aggregateCompaniesRefreshing);
  const fallbackCompaniesReady =
    !effectiveTripFallback || (companyCatalogLoaded && !companiesLoading);
  const tripSourceReady =
    effectiveTripFallback &&
    fallbackCompaniesReady &&
    !tripsLoading &&
    !tripsRefreshing;
  const rankingSourcesReady =
    rankingComputationReady &&
    simulatorSelectionReady &&
    ((aggregateSourceReady && aggregateCompaniesReady) || tripSourceReady) &&
    internalSelectionReady &&
    participantProfilesReady;
  const preparedLiveRanking = rankingSourcesReady;
  const liveRankingData = useMemo(
    () => freezeRankingSnapshot(calculatedRankingData),
    [calculatedRankingData],
  );
  const liveRankingSignature = useMemo(
    () =>
      liveRankingData
        .map((item) =>
          [item.id, item.name, item.logo || "", item.val, item.trips].join("~"),
        )
        .join("|"),
    [liveRankingData],
  );
  const rankingData =
    visibleRankingSnapshot.key === rankingCacheKey &&
    visibleRankingSnapshot.items.length > 0
      ? visibleRankingSnapshot.items
      : liveRankingData;
  // A non-empty projection from the exact simulator/period is sufficient for
  // first paint. Full source readiness remains the reconciliation boundary,
  // not the visual gate; this prevents the Android WebView from showing the
  // synchronization skeleton while aliases/profile chunks are still settling.
  const rankingReady = rankingData.length > 0 || preparedLiveRanking;

  useEffect(() => {
    if (!preparedLiveRanking) return;
    if (
      publishedRankingRef.current.key === rankingCacheKey &&
      publishedRankingRef.current.signature === liveRankingSignature
    ) {
      return;
    }

    let cancelled = false;
    const snapshot = freezeRankingSnapshot(liveRankingData);
    const publish = () => {
      if (cancelled) return;
      if (visibleRankingKeyRef.current !== rankingCacheKey) return;
      publishedRankingRef.current = {
        key: rankingCacheKey,
        signature: liveRankingSignature,
      };
      visibleRankingKeyRef.current = rankingCacheKey;
      setVisibleRankingSnapshot({
        key: rankingCacheKey,
        signature: liveRankingSignature,
        items: snapshot,
      });
      writeRankingSnapshot(rankingCacheKey, snapshot);
    };

    if (rankingImageConfig.gateInitialPublishOnImages) {
      void preloadRankingSnapshotImages(snapshot).finally(publish);
    } else {
      publish();
      void preloadRankingSnapshotImages(snapshot);
    }

    return () => {
      cancelled = true;
    };
  }, [
    liveRankingData,
    liveRankingSignature,
    preparedLiveRanking,
    rankingImageConfig.gateInitialPublishOnImages,
    rankingCacheKey,
  ]);

  useEffect(() => {
    if (!rankingReady || rankingImageConfig.deferredLimit <= 0) return;
    const deferredLogos = rankingData
      .slice(
        rankingImageConfig.criticalLimit,
        rankingImageConfig.deferredLimit,
      )
      .map((item) => item.logo)
      .filter(Boolean) as string[];
    if (deferredLogos.length === 0) return;

    const idleApi = window as Window & {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number },
      ) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let idleId: number | null = null;
    const timer = window.setTimeout(() => {
      const warm = () =>
        void preloadImages(
          deferredLogos,
          rankingImageConfig.mobileViewport ? 2 : 3,
          "low",
        );
      if (idleApi.requestIdleCallback) {
        idleId = idleApi.requestIdleCallback(warm, {
          timeout: rankingImageConfig.mobileViewport ? 4200 : 1600,
        });
      } else {
        warm();
      }
    }, rankingImageConfig.mobileViewport ? 2600 : 450);

    return () => {
      window.clearTimeout(timer);
      if (idleId !== null) idleApi.cancelIdleCallback?.(idleId);
    };
  }, [rankingData, rankingImageConfig, rankingReady]);

  const rankingLoadError =
    aggregateCompaniesError ||
    rankingAggregateState.error ||
    tripsError ||
    usersError;
  const rankingErrorNoticeKeysRef = useRef(new Set<string>());
  const [rankingErrorNoticeKey, setRankingErrorNoticeKey] = useState("");

  useEffect(() => {
    if (
      !rankingLoadError ||
      rankingReady ||
      calculatedRankingData.length > 0 ||
      rankingErrorNoticeKeysRef.current.has(rankingCacheKey)
    ) {
      return;
    }
    rankingErrorNoticeKeysRef.current.add(rankingCacheKey);
    setRankingErrorNoticeKey(rankingCacheKey);
  }, [calculatedRankingData.length, rankingCacheKey, rankingLoadError, rankingReady]);

  const showRankingErrorNotice =
    rankingErrorNoticeKey === rankingCacheKey &&
    !rankingReady &&
    calculatedRankingData.length === 0;

  const formatCurrency = (val: number) => BRL_FORMATTER.format(val);

  const getInitials = (name: string) => {
    return name?.substring(0, 2).toUpperCase() || "UN";
  };

  const renderLogo = (
    item: any,
    size: "lg" | "md" | "sm" = "md",
    critical = true,
  ) => {
    const sizeClasses = {
      lg: "w-14 h-14 sm:w-16 sm:h-16",
      md: "w-11 h-11 sm:w-14 sm:h-14",
      sm: "w-9 h-9 sm:w-12 sm:h-12"
    };

    if (item.logo) {
      return (
        <StableImage
          src={item.logo}
          alt={item.name}
          loading={critical ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={critical ? "high" : "low"}
          preload={critical}
          hideFallbackWhenCached
          hideFallbackWhileLoading
          wrapperClassName={`${sizeClasses[size]} rounded-full bg-white shrink-0 shadow-sm border border-gray-100 dark:border-gray-800`}
          className="object-cover"
          fallback={
            <span className={`h-full w-full bg-gray-100 dark:bg-slate-800 flex items-center justify-center text-gray-400 dark:text-slate-400 font-bold ${size === "lg" ? "text-lg" : "text-base"}`}>
              {getInitials(item.name)}
            </span>
          }
        />
      );
    }
    return (
      <div className={`${sizeClasses[size]} rounded-full bg-gray-100 dark:bg-slate-800 border-2 border-gray-200 dark:border-slate-700 flex items-center justify-center shrink-0 shadow-sm text-gray-400 dark:text-slate-400 font-bold ${size === "lg" ? "text-lg" : "text-base"}`}>
        {getInitials(item.name)}
      </div>
    );
  };

  return (
    <div className="nvu-ranking-page min-h-screen bg-gray-50 dark:bg-[#0F1115] text-gray-900 dark:text-slate-200 font-sans pb-10">
      <header className="nvu-ranking-app-header flex items-center justify-between px-4 z-30 bg-white dark:bg-[#09090b] border-b border-gray-100 dark:border-[#2A2F3A] text-gray-900 dark:text-white">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("nvu-open-shell-menu"))}
            aria-label="Abrir menu do aplicativo"
            className="rounded-lg p-1.5 text-gray-600 transition-colors hover:bg-gray-100 dark:text-slate-200 dark:hover:bg-white/10"
          >
            <Menu size={24} />
          </button>
          <span className="text-[20px] font-extrabold leading-none tracking-[-0.06em]">NVU</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <NotificationCenter
            notifications={notifications}
            onRead={markNotificationAsRead}
            isOpen={isNotificationsOpen}
            onToggle={() => setIsNotificationsOpen((open) => !open)}
            onClose={() => setIsNotificationsOpen(false)}
            buttonClassName="relative rounded-full p-2 text-gray-600 transition-colors hover:bg-gray-100 dark:text-slate-200 dark:hover:bg-white/10"
            onOpen={(notification) => {
              const type = notification.type ?? notification.tipo;
              navigate(type === "NEW_OPERATION" ? "/driver" : currentUser?.roles?.includes("admin") ? "/admin/fleet" : "/driver/profile");
            }}
          />
          <button
            type="button"
            onClick={() => navigate(currentUser?.roles?.includes("admin") ? "/admin/fleet" : "/driver/profile")}
            aria-label="Abrir perfil"
            className="flex items-center rounded-full transition-opacity hover:opacity-80"
          >
            {headerCompany?.logoUrl ? (
              <StableImage
                src={headerCompany.logoUrl}
                alt="Perfil da empresa"
                loading="eager"
                decoding="async"
                fetchPriority="high"
                wrapperClassName="h-9 w-9 shrink-0 rounded-full border border-gray-200 bg-gray-100 dark:border-[#2A2F3A] dark:bg-[#18181b]"
                className="object-cover"
                referrerPolicy="no-referrer"
                fallback={<span className="flex h-full w-full items-center justify-center bg-slate-900 text-xs font-bold text-white">NV</span>}
              />
            ) : resolveDriverPhoto(currentUser) ? (
              <StableImage
                src={resolveDriverPhoto(currentUser)}
                alt="Perfil do usuário"
                loading="eager"
                decoding="async"
                fetchPriority="high"
                wrapperClassName="h-9 w-9 shrink-0 rounded-full border border-gray-200 bg-gray-100 dark:border-[#2A2F3A] dark:bg-[#18181b]"
                className="object-cover"
                referrerPolicy="no-referrer"
                fallback={<span className="flex h-full w-full items-center justify-center bg-slate-900 text-xs font-bold text-white">NV</span>}
              />
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white dark:bg-[#18181b]">{String(currentUser?.name || "NV").slice(0, 2).toUpperCase()}</span>
            )}
          </button>
        </div>
      </header>

      {/* Ranking title bar */}
      <div className="nvu-ranking-header flex items-center justify-between bg-gray-50 px-4 pb-4 pt-3 transition-colors dark:bg-[#0F1115]">
        <button onClick={() => navigate(-1)} className="rounded-full p-2 transition-colors hover:bg-gray-200 dark:hover:bg-white/5" aria-label="Voltar">
          <ChevronLeft size={24} className="text-gray-600 dark:text-slate-300" />
        </button>
        <div className="flex-1 text-center">
          <h1 className="text-lg font-bold leading-tight text-gray-900 dark:text-white">Ranking Global</h1>
          <p className="text-xs font-medium text-gray-500 dark:text-slate-400">Classificação por ganhos</p>
        </div>
        <div className="p-2">
          <Trophy size={22} className="text-yellow-500" />
        </div>
      </div>

      <div className="px-4 space-y-4 max-w-lg mx-auto pt-6">
        {/* Controls Layout */}
        <div className="flex items-end justify-between gap-3">
          {/* Simulador */}
          <div className="space-y-1.5 flex-1">
            <label className="text-xs font-semibold text-gray-700 dark:text-slate-400 px-1">Simulador</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400 dark:text-slate-400">
                <Building2 size={14} />
              </div>
              <select
                value={simulator}
                onChange={(e) => {
                  const nextSimulator = e.target.value;
                  simulatorSelectionModeRef.current = "user";
                  setSimulator(nextSimulator);
                }}
                className="w-full h-10 bg-white dark:bg-[#1A1D24] border border-gray-200 dark:border-[#2A2F3A] text-gray-800 dark:text-slate-200 text-sm rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 block pl-9 pr-9 py-1 transition-colors outline-none appearance-none font-medium shadow-sm"
              >
                {!simulator && (
                  <option value="" disabled>
                    Identificando simulador do perfil...
                  </option>
                )}
                <option value={ALL_SIMULATORS_VALUE}>
                  {ALL_SIMULATORS_LABEL}
                </option>
                {simulatorOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-gray-400 dark:text-slate-400">
                <ChevronDown size={14} />
              </div>
            </div>
          </div>

          <button 
            onClick={() => setShowDatePicker(true)}
            className="w-10 h-10 shrink-0 bg-white dark:bg-[#1A1D24] flex items-center justify-center rounded-xl border border-gray-200 dark:border-[#2A2F3A] shadow-sm text-gray-500 dark:text-slate-400 hover:text-blue-500 transition-colors"
          >
            <Calendar size={18} />
          </button>
        </div>

        {/* Date Period Indicator */}
        <div className="flex items-center justify-center px-1">
          <p className="text-[11px] font-medium text-gray-500 dark:text-slate-400 bg-gray-100 dark:bg-[#1A1D24] px-3 py-1 rounded-full border border-gray-200 dark:border-[#2A2F3A]">
            Período: {periodPreset === "semana" ? "Semana Atual" : periodPreset === "mes" ? formatRankingMonthLabel(referenceDate) : (startDateStr || endDateStr) ? `${startDateStr ? formatDateBR(startDateStr) : "Início"} até ${endDateStr ? formatDateBR(endDateStr) : "Hoje"}` : "Sem filtro de data"}
          </p>
        </div>

        {showRankingErrorNotice && (
          <div className="rounded-xl border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-800 dark:text-amber-200">
            Não foi possível atualizar todos os dados agora. Estamos tentando novamente; o ranking será exibido assim que houver uma projeção válida.
          </div>
        )}

        {/* Tipo de Ranking */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-700 dark:text-slate-400 px-1">Tipo de ranking</label>
          <div className="flex bg-white dark:bg-[#1A1D24] border border-gray-200 dark:border-[#2A2F3A] rounded-xl p-1 shadow-sm h-10">
            <button
              onClick={() => setRankingType("entre")}
              className={`flex-1 min-w-0 flex items-center justify-center gap-1 py-1 px-1 rounded-lg text-[10px] sm:text-xs font-bold transition-colors ${
                rankingType === "entre" ? "bg-gray-100 dark:bg-[#283142] text-blue-600 dark:text-blue-400 shadow-sm border border-gray-200 dark:border-transparent" : "text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200"
              }`}
            >
              <Building2 size={13} className="shrink-0" />
              <span className="truncate">Entre empresas</span>
            </button>
            <button
              onClick={() => setRankingType("interno")}
              className={`flex-1 min-w-0 flex items-center justify-center gap-1 py-1 px-1 rounded-lg text-[10px] sm:text-xs font-bold transition-colors ${
                rankingType === "interno" ? "bg-gray-100 dark:bg-[#283142] text-blue-600 dark:text-blue-400 shadow-sm border border-gray-200 dark:border-transparent" : "text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200"
              }`}
            >
              <Users size={13} className="shrink-0" />
              Interno
            </button>
            <button
              onClick={() => setRankingType("global")}
              className={`flex-1 min-w-0 flex items-center justify-center gap-1 py-1 px-1 rounded-lg text-[10px] sm:text-xs font-bold transition-colors ${
                rankingType === "global" ? "bg-gray-100 dark:bg-[#283142] text-blue-600 dark:text-blue-400 shadow-sm border border-gray-200 dark:border-transparent" : "text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200"
              }`}
            >
              <Globe2 size={13} className="shrink-0" />
              Global
            </button>
          </div>
        </div>

        {/* Selected Company Dropdown when Interno */}
        {rankingType === "interno" && (
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-700 dark:text-slate-400 px-1">Selecione a empresa</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400 dark:text-slate-400">
                <Building2 size={14} />
              </div>
              <select
                value={selectedCompanyId}
                onChange={(e) => {
                  const companyId = e.target.value;
                  setSelectedCompanyId(companyId);
                }}
                className="w-full h-10 bg-white dark:bg-[#1A1D24] border border-gray-200 dark:border-[#2A2F3A] text-gray-800 dark:text-slate-200 text-sm rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 block pl-9 pr-9 py-1 transition-colors outline-none appearance-none font-medium shadow-sm"
              >
                <option value="">Selecione...</option>
                {filteredCompaniesForDropdown.map(c => (
                  <option key={c.id} value={c.id}>{c.name || c.companyName}</option>
                ))}
              </select>
              <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-gray-400 dark:text-slate-400">
                <ChevronDown size={14} />
              </div>
            </div>
          </div>
        )}

        {/* Visualização */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-700 dark:text-slate-400 px-1">Visualização</label>
          <div className="flex bg-white dark:bg-[#1A1D24] border border-gray-200 dark:border-[#2A2F3A] rounded-xl p-1 shadow-sm h-10">
            <button
              onClick={() => setViewType("podio")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1 rounded-lg text-xs font-bold transition-colors ${
                viewType === "podio" ? "bg-gray-100 dark:bg-[#283142] text-yellow-600 dark:text-yellow-500 shadow-sm border border-gray-200 dark:border-transparent" : "text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200"
              }`}
            >
              <Trophy size={16} />
              Pódio
            </button>
            <button
              onClick={() => setViewType("lista")}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-colors ${
                viewType === "lista" ? "bg-gray-100 dark:bg-[#283142] text-gray-800 dark:text-slate-200 shadow-sm border border-gray-200 dark:border-transparent" : "text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200"
              }`}
            >
              <ListIcon size={14} />
              Lista
            </button>
          </div>
        </div>

        <div className="mt-6 sm:mt-8">
          {rankingReady ? (
            <>
          {viewType === "podio" && (
            <div className="relative pt-6 pb-2 w-full max-w-full">
              <div className="absolute inset-0 flex justify-center -translate-y-4 pointer-events-none opacity-35 dark:opacity-45">
                <div
                  className="w-48 h-48 sm:w-64 sm:h-64 rounded-full"
                  style={{
                    background:
                      "radial-gradient(circle, rgba(234,179,8,0.32) 0%, rgba(234,179,8,0.08) 48%, transparent 72%)",
                  }}
                />
              </div>

              <div className="flex items-end justify-center gap-1.5 sm:gap-3 relative z-10 mx-auto w-full px-1">
                {/* 2nd Place */}
                <div className="flex-1 flex flex-col items-center max-w-[120px] sm:max-w-[140px]">
                  <div className="bg-white dark:bg-[#1C2028] border border-gray-200 dark:border-[#3C475A] rounded-xl sm:rounded-2xl p-2 sm:p-3 w-full flex flex-col items-center shadow-md dark:shadow-lg dark:shadow-blue-900/10 relative overflow-hidden group min-h-[140px] sm:min-h-[160px]">
                    <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-slate-300 to-slate-500 opacity-80 dark:opacity-50"></div>
                    <div className="bg-slate-500 dark:bg-slate-700/80 text-white text-[10px] sm:text-xs font-bold px-2 py-0.5 rounded-full mb-2 shadow-[0_0_10px_rgba(100,116,139,0.3)] dark:shadow-[0_0_10px_rgba(200,200,200,0.3)] border border-slate-300 dark:border-slate-500/50">2º</div>
                    
                    {rankingData[1] ? (
                      <>
                        {renderLogo(rankingData[1], "md")}
                        <h3 className="text-gray-900 dark:text-white text-[11px] sm:text-[13px] font-bold mt-2 text-center w-full px-0.5 line-clamp-2 leading-tight">{rankingData[1].name}</h3>
                        <p className="text-blue-600 dark:text-blue-300 font-extrabold text-[12px] sm:text-sm mt-0.5 shrink-0 whitespace-nowrap">{formatCurrency(rankingData[1].val)}</p>
                        <div className="flex items-center gap-1 mt-1.5 bg-gray-50 dark:bg-black/40 border border-gray-100 dark:border-none px-1.5 py-0.5 rounded-md w-full justify-center">
                          <span className="text-[9px] sm:text-[10px] text-gray-500 dark:text-slate-300 whitespace-nowrap font-medium">{rankingData[1].trips} viagens</span>
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col items-center justify-center flex-1 py-2 h-full">
                         <span className="text-[10px] sm:text-xs text-gray-400 dark:text-slate-500 font-medium text-center">Sem classificação</span>
                      </div>
                    )}
                  </div>
                  {/* Podium base */}
                  <div className="w-[85%] h-5 sm:h-7 bg-gradient-to-b from-slate-200 to-slate-300 dark:from-slate-400/80 dark:to-slate-600/30 rounded-t-lg sm:rounded-t-xl mt-[-2px] -z-10 dark:shadow-[inset_0_2px_4px_rgba(255,255,255,0.4)] relative">
                     <div className="absolute inset-x-0 top-0 h-[1px] bg-slate-100 dark:bg-slate-200/50"></div>
                  </div>
                </div>

                {/* 1st Place */}
                <div className="flex-[1.1] sm:flex-[1.2] flex flex-col items-center z-20 min-w-[110px] sm:min-w-[130px] max-w-[130px] sm:max-w-[160px]">
                  {rankingData[0] ? (
                    <Crown size={36} className="text-yellow-500 dark:text-yellow-400 mb-1 fill-yellow-400/30 dark:fill-yellow-400/20 drop-shadow-[0_0_15px_rgba(234,179,8,0.5)] dark:drop-shadow-[0_0_15px_rgba(250,204,21,0.5)] sm:w-[44px] sm:h-[44px]" strokeWidth={1.5} />
                  ) : (
                    <div className="h-10 sm:h-[48px] w-full invisible"><Crown size={36} /></div>
                  )}
                  <div className="bg-white dark:bg-[#1C2028] border-2 border-yellow-400/50 dark:border-yellow-500/50 rounded-xl sm:rounded-2xl p-2.5 sm:p-4 w-full flex flex-col items-center shadow-xl shadow-yellow-500/20 dark:shadow-yellow-500/10 relative overflow-hidden min-h-[160px] sm:min-h-[190px] z-10">
                    <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-yellow-300 via-yellow-500 to-yellow-600 opacity-90 dark:opacity-80"></div>
                    <div className="absolute inset-0 bg-yellow-500/5 mix-blend-multiply dark:mix-blend-screen pointer-events-none"></div>
                    
                    <div className="bg-gradient-to-b from-yellow-400 to-yellow-600 text-white text-[11px] sm:text-sm font-extrabold px-3 py-0.5 rounded-full mb-2 shadow-[0_0_15px_rgba(234,179,8,0.4)] dark:shadow-[0_0_15px_rgba(250,204,21,0.4)] border border-yellow-300/50">1º</div>
                    
                    {rankingData[0] ? (
                      <>
                        {renderLogo(rankingData[0], "lg")}
                        <h3 className="text-gray-900 dark:text-white text-[12px] sm:text-[14px] font-extrabold mt-2 text-center w-full px-0.5 line-clamp-2 leading-tight">{rankingData[0].name}</h3>
                        <p className="text-yellow-600 dark:text-yellow-400 font-black text-[13px] sm:text-base mt-0.5 shrink-0 drop-shadow-sm dark:drop-shadow-md whitespace-nowrap">{formatCurrency(rankingData[0].val)}</p>
                        <div className="flex items-center gap-1 mt-1.5 bg-yellow-50 dark:bg-black/50 border border-yellow-100 dark:border-none px-1.5 py-0.5 rounded-md w-full justify-center">
                          <span className="text-[10px] sm:text-[11px] text-yellow-800 dark:text-slate-300 whitespace-nowrap font-bold dark:font-medium">{rankingData[0].trips} viagens</span>
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col items-center justify-center flex-1 h-full w-full">
                        <span className="text-[11px] sm:text-[13px] text-yellow-600/60 dark:text-yellow-500/50 font-bold text-center">Vaga disponível</span>
                      </div>
                    )}
                  </div>
                  {/* Podium base */}
                  <div className="w-[90%] h-7 sm:h-9 bg-gradient-to-b from-yellow-400 to-yellow-600 dark:from-yellow-600/80 dark:to-yellow-900/30 rounded-t-lg sm:rounded-t-xl mt-[-2px] -z-10 shadow-[inset_0_2px_4px_rgba(255,255,255,0.6)] dark:shadow-[inset_0_2px_4px_rgba(255,255,255,0.4)] relative">
                    <div className="absolute inset-x-0 top-0 h-[1px] bg-yellow-100 dark:bg-yellow-200/50"></div>
                  </div>
                </div>

                {/* 3rd Place */}
                <div className="flex-1 flex flex-col items-center max-w-[120px] sm:max-w-[140px]">
                  <div className="bg-white dark:bg-[#1C2028] border border-gray-200 dark:border-[#523A28] rounded-xl sm:rounded-2xl p-2 sm:p-3 w-full flex flex-col items-center shadow-md dark:shadow-lg dark:shadow-orange-900/10 relative overflow-hidden group min-h-[110px] sm:min-h-[140px]">
                    <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-orange-300 to-orange-500 opacity-80 dark:opacity-40"></div>
                    <div className="bg-orange-600 dark:bg-[#8A5A44]/80 text-white text-[10px] sm:text-xs font-bold px-2 py-0.5 rounded-full mb-2 shadow-[0_0_10px_rgba(234,88,12,0.3)] dark:shadow-[0_0_10px_rgba(138,90,68,0.3)] border border-orange-400 dark:border-orange-500/40">3º</div>
                    
                    {rankingData[2] ? (
                      <>
                        {renderLogo(rankingData[2], "md")}
                        <h3 className="text-gray-900 dark:text-white text-[11px] sm:text-[13px] font-bold mt-2 text-center w-full px-0.5 line-clamp-2 leading-tight">{rankingData[2].name}</h3>
                        <p className="text-orange-600 dark:text-orange-400 font-extrabold text-[12px] sm:text-sm mt-0.5 shrink-0 whitespace-nowrap">{formatCurrency(rankingData[2].val)}</p>
                        <div className="flex items-center gap-1 mt-1.5 bg-gray-50 dark:bg-black/40 border border-gray-100 dark:border-none px-1.5 py-0.5 rounded-md w-full justify-center">
                          <span className="text-[9px] sm:text-[10px] text-gray-500 dark:text-slate-300 whitespace-nowrap font-medium">{rankingData[2].trips} viagens</span>
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col items-center justify-center flex-1 py-2 h-full">
                         <span className="text-[10px] sm:text-xs text-gray-400 dark:text-slate-500 font-medium text-center">Sem classificação</span>
                      </div>
                    )}
                  </div>
                  {/* Podium base */}
                  <div className="w-[85%] h-4 sm:h-5 bg-gradient-to-b from-orange-200 to-orange-300 dark:from-orange-800/80 dark:to-orange-950/30 rounded-t-lg sm:rounded-t-xl mt-[-2px] -z-10 dark:shadow-[inset_0_2px_4px_rgba(255,255,255,0.2)] relative">
                     <div className="absolute inset-x-0 top-0 h-[1px] bg-orange-100 dark:bg-orange-300/40"></div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* List items below Podium or for List View */}
          <div className="mt-8 space-y-3 pb-6">
            {rankingData.slice(viewType === "podio" ? 3 : 0).map((item, index) => {
              const actualRank = viewType === "podio" ? index + 4 : index + 1;
              return (
                <RankingListItem
                  key={item.id}
                  item={item}
                  actualRank={actualRank}
                  critical={actualRank <= rankingImageConfig.criticalLimit}
                />
              );
            })}
            
            {viewType === "lista" && rankingData.length === 0 && (
              <div className="text-center py-10 bg-white dark:bg-[#1A1D24] border border-gray-200 dark:border-[#2A2F3A] rounded-2xl shadow-sm">
                <Trophy size={48} className="mx-auto text-gray-300 dark:text-slate-700 mb-4" />
                <p className="text-gray-500 dark:text-slate-400 font-semibold text-sm">Nenhum dado encontrado para o filtro atual.</p>
              </div>
            )}
          </div>
            </>
          ) : (
            <div className="relative pt-6 pb-8" aria-live="polite">
              <div className="flex items-end justify-center gap-1.5 sm:gap-3 mx-auto w-full px-1">
                {["h-[140px] sm:h-[160px]", "h-[160px] sm:h-[190px]", "h-[110px] sm:h-[140px]"].map(
                  (heightClass, index) => (
                    <div
                      key={index}
                      className={cn(
                        "flex-1 max-w-[140px] rounded-xl sm:rounded-2xl bg-white dark:bg-[#1C2028] border border-gray-200 dark:border-[#2A2F3A] p-3 shadow-sm",
                        heightClass,
                      )}
                    >
                      <div className="mx-auto h-5 w-9 rounded-full bg-slate-100 dark:bg-white/5 animate-pulse" />
                      <div className="mx-auto mt-3 h-12 w-12 rounded-full bg-slate-100 dark:bg-white/5 animate-pulse" />
                      <div className="mx-auto mt-3 h-3 w-16 rounded bg-slate-100 dark:bg-white/5 animate-pulse" />
                      <div className="mx-auto mt-2 h-3 w-20 rounded bg-slate-100 dark:bg-white/5 animate-pulse" />
                    </div>
                  ),
                )}
              </div>
              <p className="mt-5 text-center text-[12px] font-medium text-slate-500 dark:text-slate-400">
                Sincronizando classificação
              </p>
            </div>
          )}
        </div>
      </div>

      {showDatePicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#1C2028] border border-gray-200 dark:border-[#2A2F3A] p-5 rounded-2xl w-full max-w-sm shadow-2xl relative">
            <button 
              onClick={() => setShowDatePicker(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 transition-colors"
            >
              <X size={20} />
            </button>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Filtrar por Período</h3>
            
            <div className="flex bg-gray-50 dark:bg-[#1A1D24] border border-gray-200 dark:border-[#2A2F3A] rounded-xl p-1 shadow-sm h-10 mb-4">
              <button
                onClick={() => setPeriodPreset("semana")}
                className={cn(
                  "flex-1 rounded-[8px] text-[12px] font-bold transition-colors hover:shadow-sm",
                  periodPreset === "semana"
                    ? "bg-white dark:bg-[#283142] text-gray-900 dark:text-white shadow-sm"
                    : "text-gray-600 dark:text-slate-300 hover:bg-white/50"
                )}
              >
                Semana Atual
              </button>
              <button
                onClick={() => setPeriodPreset("mes")}
                className={cn(
                  "flex-1 rounded-[8px] text-[12px] font-bold transition-colors hover:shadow-sm",
                  periodPreset === "mes"
                    ? "bg-white dark:bg-[#283142] text-gray-900 dark:text-white shadow-sm"
                    : "text-gray-600 dark:text-slate-300 hover:bg-white/50"
                )}
              >
                {formatRankingMonthLabel(referenceDate)}
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-1.5 block">Data Inicial</label>
                <input 
                  type="date" 
                  value={startDateStr}
                  onChange={(e) => {
                    const value = e.target.value;
                    setStartDateStr(value);
                    setPeriodPreset("custom");
                  }}
                  className="w-full h-11 bg-gray-50 dark:bg-[#1A1D24] border border-gray-200 dark:border-[#2A2F3A] text-gray-900 dark:text-white rounded-xl px-3 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-medium"
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-1.5 block">Data Final</label>
                <input 
                  type="date" 
                  value={endDateStr}
                  onChange={(e) => {
                    const value = e.target.value;
                    setEndDateStr(value);
                    setPeriodPreset("custom");
                  }}
                  className="w-full h-11 bg-gray-50 dark:bg-[#1A1D24] border border-gray-200 dark:border-[#2A2F3A] text-gray-900 dark:text-white rounded-xl px-3 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-medium"
                />
              </div>
              <div className="pt-2">
                <button 
                  onClick={() => setShowDatePicker(false)}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-colors shadow-sm"
                >
                  Aplicar Filtro
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
