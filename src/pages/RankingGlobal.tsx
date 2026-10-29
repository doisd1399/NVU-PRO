import { NvuWordmark } from "../components/common/NvuWordmark";
import { ModalSelect } from "../components/ui/ModalSelect";
import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Trophy, ChevronDown, Building2, Users, Globe2, ChevronRight, Calendar, Menu, ChevronUp, Gamepad2 } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useOperationalStore, useRankingFilterStore, useSessionStore } from "../context/AppContext";
import { useNotificationStore } from "../context/NotificationsContext";
import { useCompanyStore } from "../context/CompanyContext";
import { useTripsRealtime } from "../hooks/useTripsRealtime";
import { groupMetricsByCompany, filterTripsBySimulator } from "../lib/metricsEngine";
import { preloadRankingImages } from "../services/preloadRankingImages";
import { auth } from "../lib/firebase";
import { StableImage } from "../components/common/StableImage";
import { NotificationCenter } from "../components/NotificationCenter";
import { resolveDriverPhoto } from "../lib/resolveDriverPhoto";
import { cn } from "../lib/utils";
import { buildDriverRankingPageData, buildInternalDriverRankingPageData, getActiveInternalDriverIds } from "../lib/rankingPageEngine";
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
  mergeRankingCompanyCatalogs,
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
import { onCanonicalTripUpdated } from "../lib/CanonicalTripUpdateEvent";
import RankingPremiumPodium from "../components/RankingPremiumPodium";
import { RankingGamerLeaderboard } from "../components/RankingGamerLeaderboard";
import { RankingPeriodModal } from "../components/RankingPeriodModal";
import { RankingPreviousPeriodCard } from "../components/RankingPreviousPeriodCard";
import RankingParticipantPremiumModal from "../components/RankingParticipantPremiumModal";
import { SimulatorSelectionModal } from "../components/SimulatorSelectionModal";
import { rankingCompanyDisplayName } from "../lib/rankingDisplayName";
import { WorkspaceDock } from "../components/WorkspaceDock";
import { useRankingVehiclePhotoPrefetch } from "../hooks/useRankingVehiclePhotoPrefetch";

const freezeRankingSnapshot = (items: any[]) =>
  items.map((item) => ({ ...item }));

const formatRankingAmount = (value: number, currency: string) => {
  try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value); }
  catch { return `${currency} ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
};
const formatRankingCurrency = (item: any) => {
  const groups = Array.isArray(item?.currencyBreakdown) ? item.currencyBreakdown : [];
  if (groups.length) return groups.map((group: any) => formatRankingAmount(Number(group.value || 0), String(group.currency))).join(" · ");
  return item?.currency ? formatRankingAmount(Number(item.val || 0), String(item.currency)) : "—";
};
const comparableRankingMoney = (item: any) => {
  const groups = Array.isArray(item?.currencyBreakdown) ? item.currencyBreakdown : [];
  if (groups.length !== 1 || !groups[0]?.currency || item?.currencyUnresolvedTrips) return null;
  const value = Number(groups[0].value);
  return Number.isFinite(value) ? { value, currency: String(groups[0].currency) } : null;
};

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
  viewerId?: string;
  assetType?: "driver" | "company";
};

// Ranking snapshots are short-lived, UID-scoped first-paint accelerators.
// They are never authoritative: the realtime path still reconciles and replaces
// them. A short TTL prevents a cold WebView from showing an old classification
// while avoiding the blank/skeleton cycle on every app restart.
const RANKING_CACHE_TTL_MS = 2 * 60 * 1000;
const RANKING_PERSISTED_CACHE_TTL_MS = 15 * 60 * 1000;
const RANKING_PERSISTED_CACHE_PREFIX = "nvu.ranking.snapshot.v4.";
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
      (navigator.onLine !== false && Date.now() - parsed.cachedAt > RANKING_PERSISTED_CACHE_TTL_MS) ||
      !Array.isArray(parsed.items)
    ) {
      return [];
    }
    const persisted = {
      cachedAt: parsed.cachedAt,
      items: parsed.items.slice(0, 200),
      viewerId: parsed.viewerId,
      assetType: parsed.assetType,
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

const writeRankingSnapshot = (key: string, items: any[], viewerId?: string, assetType: "driver" | "company" = "driver") => {
  const compactItems = items.slice(0, 200).map((item) => ({
    id: item.id,
    name: item.name,
    logo: item.logo,
    companyId: item.companyId,
    companyName: item.companyName,
    companyLogo: item.companyLogo,
    val: item.val,
    trips: item.trips,
    currency: item.currency,
    currencyBreakdown: item.currencyBreakdown,
    currencyUnresolvedTrips: item.currencyUnresolvedTrips,
  }));
  const entry = { cachedAt: Date.now(), items: compactItems, viewerId, assetType };
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

const preloadRankingSnapshotImages = (items: any[], viewerId: string, assetType: "driver" | "company") => {
  const config = getRankingImagePreloadConfig();
  return preloadRankingImages(
    items.slice(0, config.criticalLimit), viewerId, assetType,
    config.concurrency,
    "auto",
  );
};

export function preloadLastRankingSnapshotImages(): Promise<void> {
  const viewerId = auth.currentUser?.uid;
  if (!viewerId || lastRankingSnapshot?.viewerId !== viewerId) return Promise.resolve();
  return preloadRankingSnapshotImages(readLastRankingSnapshot(), viewerId, lastRankingSnapshot.assetType || "driver");
}

export default function RankingGlobal() {
  const location = useLocation();
  const profileIntent = (location.state as { profileRanking?: {
    type?: "entre" | "interno" | "global"; simulatorId?: string; companyId?: string;
    periodType?: "semana" | "mes";
  } } | null)?.profileRanking;
  const profileRankingType = ["entre", "interno", "global"].includes(profileIntent?.type || "")
    ? profileIntent?.type : undefined;
  const navigate = useNavigate();
  const rankingImageConfig = useMemo(getRankingImagePreloadConfig, []);
  useEffect(() => onCanonicalTripUpdated(() => {
    rankingSnapshotCache.clear();
    lastRankingSnapshot = null;
    if (typeof window !== "undefined") {
      for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
        const key = window.localStorage.key(index);
        if (key?.startsWith(RANKING_PERSISTED_CACHE_PREFIX)) window.localStorage.removeItem(key);
      }
    }
  }), []);
  const { currentUser, activeRole } = useSessionStore();
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
    jobs,
    vehicles,
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
    () => String(profileIntent?.simulatorId || preferredProfileSimulatorValue),
  );
  const simulatorSelectionModeRef = useRef<"pending" | "auto" | "user">(
    profileIntent?.simulatorId ? "user" : preferredProfileSimulatorValue ? "auto" : "pending",
  );
  const autoSimulatorSourceRef = useRef("");
  const [rankingType, setRankingType] = useState<"entre" | "interno" | "global">(profileRankingType || "entre");
  const [viewType, setViewType] = useState<"podio" | "lista">("podio");
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>(profileIntent?.companyId || "");
  const [selectedParticipant, setSelectedParticipant] = useState<{ item: any; rank: number } | null>(null);
  const [showAdditionalParticipants, setShowAdditionalParticipants] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [isSimulatorModalOpen, setIsSimulatorModalOpen] = useState(false);

  const appliedProfileIntentRef = useRef("");
  useEffect(() => {
    if (!profileRankingType || appliedProfileIntentRef.current === location.key) return;
    appliedProfileIntentRef.current = location.key;
    setRankingType(profileRankingType);
    setSelectedCompanyId(String(profileIntent?.companyId || ""));
    if (profileIntent?.simulatorId) {
      simulatorSelectionModeRef.current = "user";
      setSimulator(String(profileIntent.simulatorId));
    }
    if (profileIntent?.periodType === "semana" || profileIntent?.periodType === "mes") {
      setPeriodPreset(profileIntent.periodType);
    }
  }, [location.key, profileIntent?.companyId, profileIntent?.periodType, profileIntent?.simulatorId, profileRankingType, setPeriodPreset]);

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
  // Open weekly/monthly periods use the authenticated callable, which rebuilds
  // the bounded canonical source before the result is accepted. This keeps the
  // global universe complete without opening a collection-wide live listener.
  const isOpenRankingPeriod = rankingRange.end.getTime() >= Date.now();
  const aggregateEligible = Boolean(
    aggregatePeriodType &&
      aggregatePeriodKey &&
      simulator &&
      simulator !== ALL_SIMULATORS_VALUE &&
      rankingType !== "interno",
  );
  const rankingAggregateState = useRankingAggregate({
    simulatorId: simulator,
    periodType: aggregatePeriodType,
    periodKey: aggregatePeriodKey,
    enabled: aggregateEligible,
    refreshOnRead: isOpenRankingPeriod,
  });
  const previousPeriodReferenceDate = useMemo(() => {
    if (!aggregatePeriodType) return referenceDate;
    return new Date(rankingRange.start.getTime() - 1);
  }, [aggregatePeriodType, rankingRange.start, referenceDate]);
  const previousAggregatePeriodKey = useMemo(
    () => aggregatePeriodType
      ? buildRankingAggregatePeriodKey(aggregatePeriodType, previousPeriodReferenceDate)
      : "",
    [aggregatePeriodType, previousPeriodReferenceDate],
  );
  const previousAggregateEligible = Boolean(
    aggregatePeriodType && previousAggregatePeriodKey && simulator &&
      simulator !== ALL_SIMULATORS_VALUE && rankingType !== "interno",
  );
  const previousRankingAggregateState = useRankingAggregate({
    simulatorId: simulator,
    periodType: aggregatePeriodType,
    periodKey: previousAggregatePeriodKey,
    enabled: previousAggregateEligible,
    refreshOnRead: false,
  });
  const previousRankingAggregate = previousRankingAggregateState.status === "ready"
    ? previousRankingAggregateState.aggregate
    : null;
  const consolidatedAggregate =
    rankingAggregateState.status === "ready"
      ? rankingAggregateState.aggregate
      : null;
  const globalAggregateUnsupported = Boolean(
    rankingType !== "interno" &&
      (!aggregatePeriodType || simulator === ALL_SIMULATORS_VALUE),
  );
  const useTripFallback = rankingType === "interno";

  // Standard weekly/monthly rankings read only companies referenced by the
  // selected aggregate. Bounded fallback reads every eligible company in the
  // loaded catalog—not merely companies affiliated with the current viewer.
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
    return mergeRankingCompanyCatalogs(
      [...catalogCompanies, ...((profileCompanies || []) as any[])],
      aggregateCompanies,
      aggregateCompaniesComplete && aggregateCompaniesServerConfirmed ? aggregateCompanyIds : [],
    );
  }, [aggregateCompanies, aggregateCompaniesComplete, aggregateCompaniesServerConfirmed, aggregateCompanyIds, catalogCompanies, profileCompanies]);

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
          [item.id, item.name, item.logo || "", item.val, item.trips, item.currency || "", item.companyId || "", item.companyName || "", JSON.stringify(item.currencyBreakdown || [])].join("~"),
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
        [item.id, item.name, item.logo || "", item.val, item.trips, item.currency || "", item.companyId || "", item.companyName || "", JSON.stringify(item.currencyBreakdown || [])].join("~"),
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
      void preloadRankingSnapshotImages(snapshot, currentUser?.id || "", rankingType === "entre" ? "company" : "driver").then(publish);
    } else {
      publish();
      void preloadRankingSnapshotImages(snapshot, currentUser?.id || "", rankingType === "entre" ? "company" : "driver");
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
    serverConfirmed: tripsServerConfirmed,
  } = useTripsRealtime({
    startDate: rankingRange.start,
    endDate: rankingRange.end,
    enabled: effectiveTripFallback,
    keepPreviousData: true,
    companyIds: rankingType === "interno"
      ? [selectedCompanyId || activeCompanyId || ""].filter(Boolean)
      : [],
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

  const activeInternalDriverIds = useMemo(() => rankingType === "interno"
    ? getActiveInternalDriverIds(allCompanyMembers as unknown as Record<string, unknown>[], selectedCompanyId)
    : [], [allCompanyMembers, rankingType, selectedCompanyId]);

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
    if (rankingType === "interno" && selectedCompanyId && companyCatalogLoaded && !companiesLoading) {
       const isValid = filteredCompaniesForDropdown.some(c => c.id === selectedCompanyId);
       if (!isValid) {
         setSelectedCompanyId(String(filteredCompaniesForDropdown[0]?.id || ""));
       }
    }
  }, [simulator, rankingType, filteredCompaniesForDropdown, selectedCompanyId, companyCatalogLoaded, companiesLoading]);

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

    const rankingParams = {
      trips: preparedRankingTrips,
      startDate: deferredRankingInput.startDate,
      endDate: deferredRankingInput.endDate,
      companyId: deferredRankingInput.rankingType === "interno"
        ? deferredRankingInput.selectedCompanyId : undefined,
      simulatorId: deferredRankingInput.simulator,
      tripsAlreadyFilteredBySimulator: true,
      companies: deferredRankingInput.companies,
      simulators: deferredRankingInput.simulators,
      users,
      companyMembers: allCompanyMembers as unknown as Record<string, unknown>[],
    };
    return deferredRankingInput.rankingType === "interno"
      ? buildInternalDriverRankingPageData(rankingParams)
      : buildDriverRankingPageData({ ...rankingParams, scope: "global" });

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
    aggregateCompanyIds.length === 0 ||
    (aggregateCompaniesComplete === true &&
      aggregateCompaniesServerConfirmed === true &&
      !aggregateCompaniesLoading);
  const fallbackCompaniesReady =
    !effectiveTripFallback || (companyCatalogLoaded && !companiesLoading);
  const tripSourceReady =
    effectiveTripFallback &&
    fallbackCompaniesReady &&
    tripsServerConfirmed &&
    !tripsError &&
    !tripsLoading &&
    !tripsRefreshing;
  const rankingSourcesReady =
    rankingComputationReady &&
    simulatorSelectionReady &&
    ((aggregateSourceReady && aggregateCompaniesReady) || tripSourceReady || globalAggregateUnsupported) &&
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
          [item.id, item.name, item.logo || "", item.val, item.trips, item.currency || "", item.companyId || "", item.companyName || "", JSON.stringify(item.currencyBreakdown || [])].join("~"),
        )
        .join("|"),
    [liveRankingData],
  );
  const rankingData =
    visibleRankingSnapshot.key === rankingCacheKey &&
    visibleRankingSnapshot.items.length > 0
      ? visibleRankingSnapshot.items
      : preparedLiveRanking ? liveRankingData : [];
  const previousRankingData = useMemo(() => {
    if (!previousRankingAggregate) return [];
    if (rankingType === "entre") {
      return buildCompanyRankingFromAggregate(previousRankingAggregate, rankingCompanyPool, simulators);
    }
    return buildDriverRankingFromAggregate(
      previousRankingAggregate,
      users,
      rankingCompanyPool,
      simulators,
      (allCompanyMembers as unknown) as Record<string, unknown>[],
    );
  }, [allCompanyMembers, previousRankingAggregate, rankingCompanyPool, rankingType, simulators, users]);
  const previousPeriodLeader = previousRankingData[0];
  const currentPeriodLeader = rankingData[0];
  const previousLeaderComparison = useMemo(() => {
    const current = comparableRankingMoney(currentPeriodLeader);
    const previous = comparableRankingMoney(previousPeriodLeader);
    if (!current || !previous || current.currency !== previous.currency) return null;
    return { current, previous, delta: current.value - previous.value };
  }, [currentPeriodLeader, previousPeriodLeader]);
  // Reuse a previously confirmed snapshot for this exact scope immediately.
  // A newly calculated subset must wait for complete comparative sources;
  // otherwise a partial company read can falsely appear as a first place.
  const rankingReady = rankingData.length > 0 || preparedLiveRanking;
  useRankingVehiclePhotoPrefetch(rankingData, {
    viewerId: currentUser?.id, simulatorId: simulator,
    companies: companies as Record<string, any>[], simulators: simulators as unknown as Record<string, any>[],
  }, rankingReady && rankingType !== "entre");

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
      writeRankingSnapshot(rankingCacheKey, snapshot, currentUser?.id, rankingType === "entre" ? "company" : "driver");
    };

    if (rankingImageConfig.gateInitialPublishOnImages) {
      void preloadRankingSnapshotImages(snapshot, currentUser?.id || "", rankingType === "entre" ? "company" : "driver").finally(publish);
    } else {
      publish();
      void preloadRankingSnapshotImages(snapshot, currentUser?.id || "", rankingType === "entre" ? "company" : "driver");
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
    const deferredItems = rankingData
      .slice(
        rankingImageConfig.criticalLimit,
        rankingImageConfig.deferredLimit,
      )
      ;
    if (deferredItems.length === 0) return;

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
        void preloadRankingImages(
          deferredItems, currentUser?.id || "", rankingType === "entre" ? "company" : "driver",
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
      rankingErrorNoticeKeysRef.current.has(rankingCacheKey)
    ) {
      return;
    }
    rankingErrorNoticeKeysRef.current.add(rankingCacheKey);
    setRankingErrorNoticeKey(rankingCacheKey);
  }, [calculatedRankingData.length, rankingCacheKey, rankingLoadError, rankingReady]);

  const [rankingDeadlineReached, setRankingDeadlineReached] = useState(false);
  useEffect(() => {
    setRankingDeadlineReached(false);
    if (rankingReady) return;
    const timer = setTimeout(() => setRankingDeadlineReached(true), 20_000);
    return () => clearTimeout(timer);
  }, [rankingReady, rankingCacheKey]);

  const showRankingErrorNotice =
    rankingErrorNoticeKey === rankingCacheKey &&
    !rankingReady;
  const showServerRankingUnavailableNotice =
    rankingType !== "interno" &&
    !globalAggregateUnsupported &&
    Boolean(simulator) &&
    (rankingAggregateState.status === "unavailable" || rankingAggregateState.status === "missing") &&
    !aggregateForRanking;

  const formatCurrency = formatRankingCurrency;

  const rankingPeriodLabel = periodPreset === "semana"
    ? "Semana atual"
    : periodPreset === "mes"
      ? formatRankingMonthLabel(referenceDate)
      : (startDateStr || endDateStr)
        ? `${startDateStr ? formatDateBR(startDateStr) : "Início"} até ${endDateStr ? formatDateBR(endDateStr) : "Hoje"}`
        : "Sem filtro de data";
  const rankingTypeLabel = rankingType === "global" ? "Global" : rankingType === "interno" ? "Interno" : "Empresarial";
  const pageTitle = "Ranking Global";
  const pageDescription = "Classificação financeira.";
  const simulatorLabel = simulatorOptions.find((option) => option.value === simulator)?.label || ALL_SIMULATORS_LABEL;
  const simulatorModalItems = useMemo(
    () => [{ id: ALL_SIMULATORS_VALUE, label: ALL_SIMULATORS_LABEL }, ...simulatorOptions.map((option) => ({ id: option.value, label: option.label }))],
    [simulatorOptions],
  );

  const openParticipant = useCallback((item: any, rank: number) => {
    // Only driver rankings have a participant profile. Company tiles remain informational.
    if (rankingType !== "entre") setSelectedParticipant({ item, rank });
  }, [rankingType]);
  const participantRankingScope = rankingType === "entre" ? "companies" : rankingType === "interno" ? "internal" : "global";
  const additionalRankingData = rankingData.slice(3);
  useEffect(() => { setSelectedParticipant(null); setShowAdditionalParticipants(false); }, [rankingType, selectedCompanyId, simulator, periodPreset, rankingRange.start, rankingRange.end]);


  return (
    <div className="nvu-ranking-page nvu-gamer-ranking min-h-screen bg-gray-50 dark:bg-nvu-surface text-gray-900 dark:text-nvu-text font-sans pb-10">
      <header className="nvu-ranking-app-header flex items-center justify-between px-4 z-30 bg-white dark:bg-nvu-page border-b border-gray-100 dark:border-nvu-line text-gray-900 dark:text-white">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("nvu-open-shell-menu"))}
            aria-label="Abrir menu do aplicativo"
            className="rounded-lg p-1.5 text-gray-600 transition-colors hover:bg-gray-100 dark:text-nvu-text dark:hover:bg-white/10"
          >
            <Menu size={24} />
          </button>
          <NvuWordmark />
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <NotificationCenter
            notifications={notifications}
            onRead={markNotificationAsRead}
            isOpen={isNotificationsOpen}
            onToggle={() => setIsNotificationsOpen((open) => !open)}
            onClose={() => setIsNotificationsOpen(false)}
            buttonClassName="relative rounded-full p-2 text-gray-600 transition-colors hover:bg-gray-100 dark:text-nvu-text dark:hover:bg-white/10"
            onOpen={(notification) => {
              const type = notification.type ?? notification.tipo;
              navigate(type === "NEW_OPERATION" ? "/driver" : activeRole === "admin" ? "/admin/fleet" : "/driver/profile");
            }}
          />
          <button
            type="button"
            onClick={() => navigate(activeRole === "admin" ? "/admin/fleet" : "/driver/profile")}
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
                wrapperClassName="h-9 w-9 shrink-0 rounded-full border border-gray-200 bg-gray-100 dark:border-nvu-line dark:bg-nvu-surface"
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
                wrapperClassName="h-9 w-9 shrink-0 rounded-full border border-gray-200 bg-gray-100 dark:border-nvu-line dark:bg-nvu-surface"
                className="object-cover"
                referrerPolicy="no-referrer"
                fallback={<span className="flex h-full w-full items-center justify-center bg-slate-900 text-xs font-bold text-white">NV</span>}
              />
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white dark:bg-nvu-surface">{String(currentUser?.name || "NV").slice(0, 2).toUpperCase()}</span>
            )}
          </button>
        </div>
      </header>

      {/* Ranking title bar */}
      <div className="nvu-ranking-header nvu-ranking-header-centered flex items-center justify-center bg-gray-50 px-4 pb-4 pt-3 transition-colors dark:bg-nvu-surface">
        <div className="nvu-ranking-title-lockup">
          <div className="nvu-ranking-title-copy">
            <h1>{pageTitle}</h1>
            <p>{pageDescription}</p>
          </div>
        </div>
      </div>

      <div className="nvu-gamer-content">
        <div className={`nvu-gamer-controls${filtersExpanded ? " is-expanded" : " is-collapsed"}`}>
          <button type="button" className="nvu-gamer-filter-summary" aria-label={`Filtros do ranking: ${simulatorLabel}, ${rankingTypeLabel}, ${rankingPeriodLabel}`} aria-expanded={filtersExpanded} aria-controls="ranking-gamer-filter-body" onClick={() => setFiltersExpanded((open) => !open)}>
            <span className="nvu-gamer-filter-summary-text"><span>{simulatorLabel}</span><span aria-hidden="true">·</span><span>{rankingTypeLabel}</span><span aria-hidden="true">·</span><span>{rankingPeriodLabel}</span></span>
            {filtersExpanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
          </button>
          <div id="ranking-gamer-filter-body" className="nvu-gamer-filter-body" hidden={!filtersExpanded}>
          <div className="nvu-gamer-filter-line">
            <button type="button" className="nvu-gamer-simulator" aria-label="Simulador" aria-haspopup="dialog" aria-expanded={isSimulatorModalOpen} onClick={() => setIsSimulatorModalOpen(true)}>
              <Gamepad2 size={16} aria-hidden="true" />
              <span className="nvu-gamer-filter-button-value">{simulatorLabel}</span>
            </button>
            <button type="button" className="nvu-gamer-calendar" aria-label="Escolher período do ranking" onClick={() => setShowDatePicker(true)}><Calendar size={16} />Período</button>
          </div>
          <p className="nvu-gamer-period">Período ativo: {rankingPeriodLabel}</p>
          <div className="nvu-gamer-tabs" role="group" aria-label="Tipo de ranking">
            <button type="button" aria-pressed={rankingType === "global"} onClick={() => setRankingType("global")}><Globe2 size={14} />Global</button>
            <button type="button" aria-pressed={rankingType === "interno"} onClick={() => setRankingType("interno")}><Users size={14} />Interno</button>
            <button type="button" aria-pressed={rankingType === "entre"} onClick={() => setRankingType("entre")}><Building2 size={14} />Empresarial</button>
          </div>
          {rankingType === "interno" && <label className="nvu-gamer-company">Selecione a empresa
            <ModalSelect title="Selecionar empresa" aria-label="Selecione a empresa" value={selectedCompanyId} onChange={(e) => setSelectedCompanyId(e.target.value)}>
              <option value="">Selecione...</option>
              {filteredCompaniesForDropdown.map(c => <option key={String(c.id)} value={String(c.id)}>{rankingCompanyDisplayName(c.name || c.companyName || "Empresa")}</option>)}
            </ModalSelect>
          </label>}
          </div>
        </div>
        <SimulatorSelectionModal
          open={isSimulatorModalOpen}
          items={simulatorModalItems}
          selectedId={simulator || ALL_SIMULATORS_VALUE}
          onSelect={(value) => {
            simulatorSelectionModeRef.current = "user";
            setSimulator(value);
          }}
          onClose={() => setIsSimulatorModalOpen(false)}
          description="Escolha o ambiente de trabalho do ranking."
        />

        <div className="nvu-gamer-results">
          {rankingReady && (rankingAggregateState.stale || aggregateCompaniesRefreshing || aggregateCompaniesError || !rankingSourcesReady) && (
            <p role="status" data-testid="ranking-saved-snapshot" className="mb-3 text-center text-xs text-slate-500 dark:text-nvu-muted">
              Último resultado salvo · {rankingAggregateState.refreshing || aggregateCompaniesRefreshing ? "atualizando" : "aguardando atualização"}
            </p>
          )}
          {rankingReady ? (
            rankingData.length === 0 ? (
              <div data-testid="ranking-empty-state" role="status" className="text-center py-10 bg-white dark:bg-nvu-surface border border-gray-200 dark:border-nvu-line rounded-2xl shadow-sm">
                <Trophy size={44} className="mx-auto text-gray-300 dark:text-slate-700 mb-3" />
                <p className="text-gray-500 dark:text-nvu-muted font-semibold text-sm">
                  {globalAggregateUnsupported
                    ? "Escolha semana ou mês e um simulador específico para ver o ranking global."
                    : "Sem classificação no período."}
                </p>
              </div>
            ) : (
            <>
          {viewType === "podio" && <>
            <div className="nvu-gamer-top-title"><strong>TOP 3</strong><span>Destaques do período</span></div>
            <RankingPremiumPodium
              items={rankingData}
              viewerId={currentUser?.id}
              assetType={rankingType === "entre" ? "company" : "driver"}
              formatCurrency={formatCurrency}
              onOpen={openParticipant}
            />
          </>}
          <RankingGamerLeaderboard
            items={showAdditionalParticipants ? rankingData : rankingData.slice(0, 3)}
            viewerId={currentUser?.id}
            assetType={rankingType === "entre" ? "company" : "driver"}
            showPhotos
            criticalLimit={rankingImageConfig.criticalLimit}
            formatCurrency={formatCurrency}
            onOpen={openParticipant}
            additionalCount={additionalRankingData.length}
            participantCount={rankingData.length}
            showAdditionalParticipants={showAdditionalParticipants}
            onToggleAdditional={() => setShowAdditionalParticipants((open) => !open)}
          />
          {previousPeriodLeader && currentPeriodLeader && (
            <RankingPreviousPeriodCard
              leader={previousPeriodLeader}
              viewerId={currentUser?.id}
              assetType={rankingType === "entre" ? "company" : "driver"}
              periodLabel={periodPreset === "semana" ? "Semana anterior" : "Mês anterior"}
              earnings={formatCurrency(previousPeriodLeader)}
              comparison={previousLeaderComparison ? `${previousLeaderComparison.delta >= 0 ? "+" : "−"}${formatRankingAmount(Math.abs(previousLeaderComparison.delta), previousLeaderComparison.current.currency)}` : null}
            />
          )}
            </>
            )
          ) : showRankingErrorNotice || showServerRankingUnavailableNotice || rankingDeadlineReached ? (
            <div data-testid="ranking-error-state" role="alert" className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-nvu-line dark:bg-nvu-surface">
              <Trophy size={40} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
              <p className="font-semibold text-slate-800 dark:text-nvu-text">{rankingAggregateState.status === "missing" ? "Histórico não consolidado para este período." : "Não foi possível carregar o ranking."}</p>
              <button
                data-testid="ranking-retry"
                type="button"
                onClick={() => window.location.reload()}
                className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Tentar novamente
              </button>
            </div>
          ) : (
            <div data-testid="ranking-loading-state" className="relative pt-6 pb-8" aria-live="polite">
              <div className="flex items-end justify-center gap-1.5 sm:gap-3 mx-auto w-full px-1">
                {["h-[140px] sm:h-[160px]", "h-[160px] sm:h-[190px]", "h-[110px] sm:h-[140px]"].map(
                  (heightClass, index) => (
                    <div
                      key={index}
                      className={cn(
                        "flex-1 max-w-[140px] rounded-xl sm:rounded-2xl bg-white dark:bg-nvu-surface border border-gray-200 dark:border-nvu-line p-3 shadow-sm",
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
              <p className="mt-5 text-center text-[12px] font-medium text-slate-500 dark:text-nvu-muted">
                Sincronizando classificação
              </p>
            </div>
          )}
        </div>
      </div>

      {showDatePicker && (
        <RankingPeriodModal
          preset={periodPreset}
          startDate={startDateStr}
          endDate={endDateStr}
          referenceDate={referenceDate}
          onClose={() => setShowDatePicker(false)}
          onApply={({ preset, startDate, endDate }) => {
            setStartDateStr(startDate);
            setEndDateStr(endDate);
            setPeriodPreset(preset);
            setShowDatePicker(false);
          }}
        />
      )}
      {rankingType !== "entre" && selectedParticipant && (
        <RankingParticipantPremiumModal
          item={selectedParticipant.item}
          rank={selectedParticipant.rank}
          rankingScope={participantRankingScope}
          periodLabel={rankingPeriodLabel}
          simulatorId={simulator}
          periodType={periodPreset === "semana" ? "semana" : "mes"}
          start={rankingRange.start}
          end={rankingRange.end}
          companies={companies as Record<string, unknown>[]}
          simulators={simulators as unknown as Record<string, unknown>[]}
          users={users as Record<string, unknown>[]}
          companyMembers={allCompanyMembers as unknown as Record<string, unknown>[]}
          currentUserId={currentUser?.id}
          jobs={jobs as unknown as Array<Record<string, any>>}
          vehicles={vehicles as unknown as Array<Record<string, any>>}
          onClose={() => setSelectedParticipant(null)}
        />
      )}
      <WorkspaceDock />
    </div>
  );
}
