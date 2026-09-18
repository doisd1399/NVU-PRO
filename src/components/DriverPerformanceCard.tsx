import React, { useMemo, useState, useRef, useEffect } from "react";
import { cn } from "../lib/utils";
import { DayPicker, DateRange } from "react-day-picker";
import "react-day-picker/style.css";
import {
  TrendingUp,
  Target,
  Trophy,
  Activity,
  Star,
  Banknote,
  Package,
  ArrowUpRight,
  Award,
  Shield,
  Hexagon,
  CalendarCheck,
  DollarSign,
} from "lucide-react";
import {
  filterTripsBySimulator,
  getWeeklyRange,
} from "../lib/metricsEngine";
import { normalizeTrip } from "../lib/tripNormalizer";
import { mergeTripDatasetsInInterval } from "../lib/tripDatasetReconciliation";
import { buildCanonicalDriverRankingContext } from "../lib/rankingPageEngine";
import { getCanonicalTripDriverId } from "../lib/tripIdentity";
import { useTripsRealtime } from "../hooks/useTripsRealtime";
import { useLiveCalendarReference } from "../hooks/useLiveCalendarReference";
import {
  buildClassificationPeriods,
  getClassificationHistoryInterval,
  resolvePerformanceInterval,
  resolvePreviousPerformanceInterval,
} from "../lib/performancePeriods";
import { differenceInDays } from "date-fns";

export interface DriverPerformanceCardProps {
  historicoTrips: any[];
  globalHistoricoTrips?: any[];
  globalTripsLoading?: boolean;
  driverTripsLoading?: boolean;
  driverId: string;
  activeCompanyId: string | null;
  allCompanyMembers: any[];
  users?: any[];
  currentUser: any;
  simulatorId?: string;
  allCompanies?: any[];
  simulators?: Record<string, unknown>[];
  displayLevel?: number;
  currentLevelXp?: number;
  xpProgress?: number;
}

export const DriverPerformanceCard = React.memo(function DriverPerformanceCard({
  historicoTrips,
  globalHistoricoTrips,
  globalTripsLoading,
  driverTripsLoading = false,
  driverId,
  activeCompanyId,
  allCompanyMembers,
  users = [],
  currentUser,
  simulatorId,
  allCompanies = [],
  simulators = [],
  displayLevel = 1,
  currentLevelXp = 0,
  xpProgress = 0,
}: DriverPerformanceCardProps) {
  const [isPeriodSelectorOpen, setIsPeriodSelectorOpen] = useState(false);
  const [rankingScope, setRankingScope] = useState<"internal" | "global">("global");
  const [selectedPeriod, setSelectedPeriod] = useState<
    "Semana atual" | "Mês atual" | "Hoje" | "Personalizado"
  >("Semana atual");
  const [customDateRange, setCustomDateRange] = useState<DateRange | undefined>(
    { from: getWeeklyRange().start, to: getWeeklyRange().end },
  );

  const referenceDate = useLiveCalendarReference();
  const [isCustomDateModalOpen, setIsCustomDateModalOpen] = useState(false);
  const periodSelectorRef = useRef<HTMLDivElement>(null);
  const [classificationView, setClassificationView] = useState<
    "Semanal" | "Mensal"
  >("Semanal");

  const currentPeriodRange = useMemo(
    () =>
      resolvePerformanceInterval(
        selectedPeriod,
        customDateRange,
        referenceDate,
      ),
    [customDateRange, referenceDate, selectedPeriod],
  );
  const previousPeriodRange = useMemo(
    () =>
      resolvePreviousPerformanceInterval(
        selectedPeriod,
        currentPeriodRange,
        referenceDate,
      ),
    [currentPeriodRange, referenceDate, selectedPeriod],
  );
  const classificationPeriods = useMemo(
    () => buildClassificationPeriods(classificationView, referenceDate, 5),
    [classificationView, referenceDate],
  );
  const classificationHistoryRange = useMemo(
    () => getClassificationHistoryInterval(classificationPeriods),
    [classificationPeriods],
  );

  const sDate = currentPeriodRange.start;
  const eDate = currentPeriodRange.end;
  const prevSDate = previousPeriodRange.start;
  const prevEDate = previousPeriodRange.end;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        periodSelectorRef.current &&
        !periodSelectorRef.current.contains(event.target as Node)
      ) {
        setIsPeriodSelectorOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handlePeriodSelect = (
    period: "Semana atual" | "Mês atual" | "Hoje" | "Personalizado",
  ) => {
    setSelectedPeriod(period);
    setIsPeriodSelectorOpen(false);
    if (period === "Personalizado") {
      setIsCustomDateModalOpen(true);
    }
  };

  const getPeriodLabel = () => {
    if (selectedPeriod === "Personalizado") {
      if (customDateRange?.from && customDateRange?.to) {
        return `${customDateRange.from.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} - ${customDateRange.to.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`;
      } else if (customDateRange?.from) {
        return customDateRange.from.toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
        });
      }
      return "Personalizado";
    }
    return selectedPeriod;
  };

  const shouldLoadScopedTrips = globalHistoricoTrips === undefined;
  const tripsCacheScope = `${activeCompanyId || "none"}:${simulatorId || "all"}`;
  const scopedTripsState = useTripsRealtime({
    startDate: prevSDate,
    endDate: eDate,
    enabled: shouldLoadScopedTrips,
    keepPreviousData: true,
    cacheScope: tripsCacheScope,
  });
  const classificationTripsState = useTripsRealtime({
    startDate: classificationHistoryRange.start,
    endDate: classificationHistoryRange.end,
    enabled: shouldLoadScopedTrips,
    keepPreviousData: true,
    cacheScope: tripsCacheScope,
  });

  const effectiveCurrentTrips = globalHistoricoTrips ?? scopedTripsState.trips;
  const effectiveClassificationTrips =
    globalHistoricoTrips ?? classificationTripsState.trips;
  const rawGlobalTripsLoading =
    globalTripsLoading ?? scopedTripsState.loading;
  const rawClassificationTripsLoading =
    globalTripsLoading ??
    (classificationTripsState.loading || classificationTripsState.refreshing);
  // A non-empty driver history is a valid first-paint projection. Remote
  // ranking/classification may refresh, but must not replace known data with a
  // visible synchronization state.
  const hasVisibleDriverHistory = historicoTrips.length > 0;
  const effectiveGlobalTripsLoading =
    rawGlobalTripsLoading && !hasVisibleDriverHistory;
  const classificationTripsLoading =
    rawClassificationTripsLoading && !hasVisibleDriverHistory;

  // Reconcile the complete active-company history with the bounded global
  // ranking source. The bounded query can omit legacy/transitional documents
  // that are already visible in Histórico de Viagens, causing Meu Perfil to
  // show fewer trips and earnings for the exact same period.
  const reconciledCurrentTrips = useMemo(
    () =>
      mergeTripDatasetsInInterval(
        prevSDate,
        eDate,
        historicoTrips,
        effectiveCurrentTrips,
      ),
    [eDate, effectiveCurrentTrips, historicoTrips, prevSDate],
  );
  const reconciledClassificationTrips = useMemo(
    () =>
      mergeTripDatasetsInInterval(
        classificationHistoryRange.start,
        classificationHistoryRange.end,
        historicoTrips,
        effectiveClassificationTrips,
      ),
    [
      classificationHistoryRange.end,
      classificationHistoryRange.start,
      effectiveClassificationTrips,
      historicoTrips,
    ],
  );

  const normalizedCurrentTrips = useMemo(() => {
    return reconciledCurrentTrips.map(normalizeTrip).filter((t) => t.isValid);
  }, [reconciledCurrentTrips]);
  const normalizedOwnHistory = useMemo(
    () => historicoTrips.map(normalizeTrip).filter((trip) => trip.isValid),
    [historicoTrips],
  );
  const ownSimulatorTrips = useMemo(
    () =>
      filterTripsBySimulator(
        normalizedOwnHistory,
        simulatorId,
        allCompanies,
        simulators,
      ).filter((trip) => getCanonicalTripDriverId(trip) === driverId),
    [allCompanies, driverId, normalizedOwnHistory, simulatorId, simulators],
  );
  const normalizedClassificationTrips = useMemo(() => {
    return reconciledClassificationTrips
      .map(normalizeTrip)
      .filter((trip) => trip.isValid);
  }, [reconciledClassificationTrips]);

  // Current KPIs and previous-period evolution stay on a small live range. The
  // five-row classification history has its own bounded live range; otherwise
  // rows older than the immediately previous period are incorrectly rendered
  // as zero after the Firestore scope optimization.
  const canonicalUserNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const user of users) {
      const id = String(user?.id || "").trim();
      const name = String(user?.name || "").trim();
      if (id && name) names.set(id, name);
    }
    const ownId = String(currentUser?.id || driverId || "").trim();
    const ownName = String(currentUser?.name || "").trim();
    if (ownId && ownName) names.set(ownId, ownName);
    return names;
  }, [currentUser?.id, currentUser?.name, driverId, users]);

  const canonicalRankingTrips = useMemo(
    () =>
      normalizedCurrentTrips.map((trip) => {
        const tripDriverId = getCanonicalTripDriverId(trip);
        const canonicalName = tripDriverId
          ? canonicalUserNames.get(tripDriverId)
          : undefined;
        return canonicalName
          ? {
              ...trip,
              motoristaNome: canonicalName,
              driverName: canonicalName,
            }
          : trip;
      }),
    [canonicalUserNames, normalizedCurrentTrips],
  );
  const classificationRankingTrips = useMemo(
    () => normalizedClassificationTrips,
    [normalizedClassificationTrips],
  );

  const internalCurrentContext = useMemo(
    () =>
      buildCanonicalDriverRankingContext({
        trips: canonicalRankingTrips,
        scope: "internal",
        startDate: sDate,
        endDate: eDate,
        driverId,
        companyId: activeCompanyId,
        simulatorId,
        companies: allCompanies,
        simulators,
      }),
    [activeCompanyId, allCompanies, canonicalRankingTrips, driverId, eDate, sDate, simulatorId, simulators],
  );

  const globalCurrentContext = useMemo(
    () =>
      buildCanonicalDriverRankingContext({
        trips: canonicalRankingTrips,
        scope: "global",
        startDate: sDate,
        endDate: eDate,
        driverId,
        companyId: activeCompanyId,
        simulatorId,
        companies: allCompanies,
        simulators,
      }),
    [activeCompanyId, allCompanies, canonicalRankingTrips, driverId, eDate, sDate, simulatorId, simulators],
  );

  const internalPreviousContext = useMemo(
    () =>
      buildCanonicalDriverRankingContext({
        trips: canonicalRankingTrips,
        scope: "internal",
        startDate: prevSDate,
        endDate: prevEDate,
        driverId,
        companyId: activeCompanyId,
        simulatorId,
        companies: allCompanies,
        simulators,
      }),
    [activeCompanyId, allCompanies, canonicalRankingTrips, driverId, prevEDate, prevSDate, simulatorId, simulators],
  );

  const globalPreviousContext = useMemo(
    () =>
      buildCanonicalDriverRankingContext({
        trips: canonicalRankingTrips,
        scope: "global",
        startDate: prevSDate,
        endDate: prevEDate,
        driverId,
        companyId: activeCompanyId,
        simulatorId,
        companies: allCompanies,
        simulators,
      }),
    [activeCompanyId, allCompanies, canonicalRankingTrips, driverId, prevEDate, prevSDate, simulatorId, simulators],
  );

  const currentRankingContext = rankingScope === "internal"
    ? internalCurrentContext
    : globalCurrentContext;
  const previousRankingContext = rankingScope === "internal"
    ? internalPreviousContext
    : globalPreviousContext;

  const currentDriverStats = currentRankingContext.current;
  const isSelectedScopeLoading = effectiveGlobalTripsLoading;
  const localCurrentTrips = useMemo(
    () =>
      ownSimulatorTrips.filter(
        (trip) => trip.metricDate >= sDate && trip.metricDate <= eDate,
      ),
    [eDate, ownSimulatorTrips, sDate],
  );
  const localPreviousTrips = useMemo(
    () =>
      ownSimulatorTrips.filter(
        (trip) =>
          trip.metricDate >= prevSDate && trip.metricDate <= prevEDate,
      ),
    [ownSimulatorTrips, prevEDate, prevSDate],
  );
  const localCurrentEarnings = useMemo(
    () =>
      localCurrentTrips.reduce(
        (total, trip) => total + trip.normalizedValor,
        0,
      ),
    [localCurrentTrips],
  );
  const localPreviousEarnings = useMemo(
    () =>
      localPreviousTrips.reduce(
        (total, trip) => total + trip.normalizedValor,
        0,
      ),
    [localPreviousTrips],
  );
  const currentTrips = isSelectedScopeLoading
    ? localCurrentTrips
    : currentRankingContext.entityTrips;
  const prevTrips = isSelectedScopeLoading
    ? localPreviousTrips
    : previousRankingContext.entityTrips;
  const currentEarnings = isSelectedScopeLoading
    ? localCurrentEarnings
    : currentDriverStats.earnings;
  const prevEarnings = isSelectedScopeLoading
    ? localPreviousEarnings
    : previousRankingContext.current.earnings;
  const viagensRealizadas = isSelectedScopeLoading
    ? localCurrentTrips.length
    : currentDriverStats.trips;
  const driverMetricsLoading =
    driverTripsLoading &&
    localCurrentTrips.length === 0 &&
    isSelectedScopeLoading;
  const hasCurrentDriverActivity = viagensRealizadas > 0;
  const currentPositionDisplay =
    isSelectedScopeLoading
      ? "…"
      : currentRankingContext.position
        ? `#${currentRankingContext.position}`
        : "—";
  const currentTotalDrivers = currentRankingContext.totalParticipants;
  const currentDiffToNext = isSelectedScopeLoading
    ? 0
    : currentRankingContext.differenceToNext;
  const currentNextCompetitor = isSelectedScopeLoading
    ? null
    : currentRankingContext.nextCompetitor;
  const currentNextCompetitorName = useMemo(() => {
    const name = currentNextCompetitor?.name?.trim();
    return name || "Próximo colocado";
  }, [currentNextCompetitor]);
  const currentNextCompetitorCompanyName = useMemo(() => {
    if (rankingScope !== "global" || !currentNextCompetitor?.companyId) return null;
    return (
      allCompanies.find((company) => company.id === currentNextCompetitor.companyId)
        ?.companyName || null
    );
  }, [allCompanies, currentNextCompetitor, rankingScope]);

  let evolution =
    prevEarnings === 0
      ? currentEarnings > 0
        ? 100
        : 0
      : ((currentEarnings - prevEarnings) / prevEarnings) * 100;
  const evolutionText = driverMetricsLoading
    ? "…"
    : evolution > 0
      ? `+${Math.round(evolution)}%`
      : `${Math.round(evolution)}%`;

  const actualEndDate = eDate > new Date() ? new Date() : eDate;
  const runDays = Math.max(1, differenceInDays(actualEndDate, sDate) + 1);
  const mediaDiaria = viagensRealizadas / runDays;

  const {
    ritmoOperacionalScore,
    viagensScore,
    ganhosScore,
    finalIndex: score,
  } = currentRankingContext;
  const displayScore = isSelectedScopeLoading
    ? "…"
    : hasCurrentDriverActivity
      ? Math.min(100, score)
      : "—";
  // --------------------------------------

  const getStatus = (score: number, hasActivity: boolean, loading: boolean) => {
    if (loading) {
      return {
        label: "Sincronizando",
        color: "text-teal-500 dark:text-teal-400",
        bg: "bg-teal-500 dark:bg-teal-400",
        index: 0,
        desc: (
          <>
            Atualizando participantes do<br />
            mesmo simulador.
          </>
        ),
      };
    }
    if (!hasActivity) {
      return {
        label: "Sem atividade",
        color: "text-slate-400 dark:text-slate-400",
        bg: "bg-slate-400 dark:bg-slate-600",
        index: 0,
        desc: (
          <>
            Nenhuma viagem válida no<br />
            período selecionado.
          </>
        ),
      };
    }
    if (score >= 90)
      return {
        label: "Excelente",
        color: "text-emerald-600 dark:text-emerald-400",
        bg: "bg-emerald-500 dark:bg-emerald-400",
        index: 4,
        desc: (
          <>
            Ritmo de operação intenso e<br />
            altamente competitivo.
          </>
        ),
      };
    if (score >= 70)
      return {
        label: "Bom",
        color: "text-teal-600 dark:text-teal-400",
        bg: "bg-teal-500 dark:bg-teal-400",
        index: 3,
        desc: (
          <>
            Operação consistente com<br />
            bom volume de viagens.
          </>
        ),
      };
    if (score >= 50)
      return {
        label: "Regular",
        color: "text-yellow-600 dark:text-yellow-400",
        bg: "bg-yellow-500 dark:bg-yellow-400",
        index: 2,
        desc: (
          <>
            Ritmo moderado, há espaço<br />
            para acelerar.
          </>
        ),
      };
    return {
      label: "Abaixo do Esperado",
      color: "text-slate-500 dark:text-slate-400",
      bg: "bg-slate-400 dark:bg-slate-600",
      index: 1,
      desc: (
        <>
          Baixa atividade no<br />
          período selecionado.
        </>
      ),
    };
  };

  const status = getStatus(
    score,
    hasCurrentDriverActivity,
    isSelectedScopeLoading,
  );
  const bannerTextColor = status.color.split(" ").find(c => c.startsWith("dark:"))?.replace("dark:", "") || status.color;
  const bannerBgColor = bannerTextColor.replace("text-", "bg-");

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(val);
  };

  const formatCurrencyExact = (val: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(val);
  };

  const classificationHistory = useMemo(() => {
    return classificationPeriods.map((period) => {
      const context = buildCanonicalDriverRankingContext({
        trips: classificationRankingTrips,
        scope: rankingScope,
        startDate: period.start,
        endDate: period.end,
        driverId,
        companyId: activeCompanyId,
        simulatorId,
        companies: allCompanies,
        simulators,
      });

      return {
        id: period.id,
        label: period.label,
        trips: context.current.trips,
        earnings: context.current.earnings,
        position: context.position,
        total: context.totalParticipants,
        loading: classificationTripsLoading,
      };
    });
  }, [
    activeCompanyId,
    allCompanies,
    classificationPeriods,
    classificationRankingTrips,
    classificationTripsLoading,
    driverId,
    rankingScope,
    simulatorId,
    simulators,
  ]);

  const scales = [
    "Muito baixo",
    "Baixo",
    "Regular",
    "Bom",
    "Excelente",
    "Extraordinário",
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* RANKING_SCOPE_SELECTOR */}
      <div className="flex gap-2 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 w-fit">
        <button
          type="button"
          onClick={() => setRankingScope("internal")}
          className={cn("px-3 py-2 rounded-lg text-xs font-bold", rankingScope === "internal" ? "bg-blue-600 text-white" : "text-slate-600 dark:text-slate-300")}
        >
          Ranking Interno
        </button>
        <button
          type="button"
          onClick={() => setRankingScope("global")}
          className={cn("px-3 py-2 rounded-lg text-xs font-bold", rankingScope === "global" ? "bg-blue-600 text-white" : "text-slate-600 dark:text-slate-300")}
        >
          Ranking Global
        </button>
      </div>
      <div className="mb-3 px-3 py-2 rounded-xl bg-slate-100 dark:bg-white/5 text-xs font-semibold">
        {rankingScope === "internal"
          ? "🏢 Ranking Interno — comparação com sua equipe no período"
          : effectiveGlobalTripsLoading
            ? "🌎 Ranking Global — carregando dados do simulador..."
            : "🌎 Ranking Global — comparação com o simulador no período"}
      </div>
      {/* CARD 1: RITMO OPERACIONAL */}
      <div className="w-full rounded-[24px] flex flex-col relative shadow-[0_4px_24px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)] bg-white dark:bg-[#1A1F26] border border-slate-200/80 dark:border-white/5 p-4 sm:p-5">
        {/* Banner */}
        <div className="relative w-full bg-[#031c22] rounded-[16px] sm:rounded-[20px] text-white mb-4 shadow-sm overflow-hidden">
          {/* Backgrounds container with overflow-hidden */}
          <div className="absolute inset-0 rounded-[16px] sm:rounded-[20px] overflow-hidden pointer-events-none">
            {/* Glows and particles */}
            <div className="absolute top-[-30%] left-[-10%] w-[80%] h-[150%] bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-teal-400/10 via-transparent to-transparent pointer-events-none" />
            <div className="absolute bottom-[-50%] right-[-10%] w-[80%] h-[120%] bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-emerald-500/10 via-transparent to-transparent pointer-events-none" />

            {/* Fluid lines */}
            <svg
              className="absolute bottom-0 w-full h-auto opacity-40 pointer-events-none mix-blend-screen"
              viewBox="0 0 1440 200"
              fill="none"
              preserveAspectRatio="none"
            >
              <path
                d="M0,200 C320,50 420,150 720,80 C1020,10 1200,120 1440,60 L1440,200 L0,200 Z"
                fill="url(#fluid-grad)"
              />
              <path
                d="M0,200 C200,100 400,20 720,90 C1040,160 1240,40 1440,80 L1440,200 L0,200 Z"
                fill="url(#fluid-grad-2)"
                opacity="0.5"
              />
              <defs>
                <linearGradient id="fluid-grad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#14B8A6" stopOpacity="0" />
                  <stop offset="50%" stopColor="#14B8A6" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" />
                </linearGradient>
                <linearGradient id="fluid-grad-2" x1="1" y1="0" x2="0" y2="0">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0" />
                  <stop offset="50%" stopColor="#10b981" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
                </linearGradient>
              </defs>
            </svg>
          </div>

          {/* Banner Content */}
          <div className="flex flex-col w-full p-3 sm:p-5 md:p-6 relative z-10 gap-3 sm:gap-6">
            {/* Header: Title and Period Select */}
            <div className="flex flex-row justify-between items-center w-full gap-2">
              <h3 className="text-[10px] sm:text-[14px] font-bold text-white uppercase tracking-wider shrink-0">
                1. RITMO OPERACIONAL
              </h3>

              <div className="relative" ref={periodSelectorRef}>
                <div
                  onClick={() => setIsPeriodSelectorOpen(!isPeriodSelectorOpen)}
                  className="flex items-center gap-1 sm:gap-2 bg-white/5 hover:bg-white/10 transition-colors border border-white/10 rounded-full px-2 py-1 sm:px-4 sm:py-2 cursor-pointer backdrop-blur-md shrink-0"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-white/80 sm:w-[14px] sm:h-[14px]"
                  >
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="3" y1="10" x2="21" y2="10"></line>
                  </svg>
                  <span className="text-[9px] sm:text-[13px] font-medium text-white/90">
                    Período: {getPeriodLabel()}
                  </span>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={cn(
                      "text-white/60 ml-0.5 sm:ml-1 transition-transform sm:w-[14px] sm:h-[14px]",
                      isPeriodSelectorOpen && "rotate-180",
                    )}
                  >
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </div>

                {isPeriodSelectorOpen && (
                  <div className="absolute right-0 top-full mt-2 w-48 sm:w-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50 overflow-hidden">
                    <div className="p-1">
                      {[
                        "Semana atual",
                        "Mês atual",
                        "Hoje",
                        "Personalizado",
                      ].map((period) => (
                        <button
                          key={period}
                          onClick={() => handlePeriodSelect(period as any)}
                          className={cn(
                            "w-full text-left px-3 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors",
                            selectedPeriod === period
                              ? "bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-400"
                              : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800",
                          )}
                        >
                          {period}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Middle Row: Status and Índice Final */}
            <div className="flex flex-row items-center justify-between">
              {/* Left: Circle + Status */}
              <div className="flex items-center gap-2 sm:gap-4 flex-1">
                <div className="relative w-[32px] h-[32px] sm:w-[64px] sm:h-[64px] rounded-full border border-teal-500/30 flex items-center justify-center shrink-0">
                  <ArrowUpRight size={16} className={cn("sm:w-[28px] sm:h-[28px]", bannerTextColor)} strokeWidth={2.5} />
                </div>
                <div className="flex flex-col">
                  <span className={cn("text-[14px] sm:text-[26px] font-bold tracking-tight leading-none mb-0.5 sm:mb-1.5", bannerTextColor)}>
                    {status.label}
                  </span>
                  <span className="text-[8px] sm:text-[14px] text-white/80 font-medium leading-[1.2] sm:leading-[1.3] max-w-[140px] sm:max-w-[280px]">
                    {status.desc}
                  </span>
                </div>
              </div>

              {/* Separator */}
              <div className="w-px h-8 sm:h-12 bg-white/10 mx-2 sm:mx-4 shrink-0"></div>

              {/* Right: Índice Final */}
              <div className="flex flex-col items-end sm:items-start shrink-0">
                <span className="text-[7px] sm:text-[11px] text-white/60 font-medium tracking-wider uppercase mb-0.5 sm:mb-1">
                  ÍNDICE FINAL
                </span>
                <div className="flex items-baseline gap-0.5 sm:gap-1">
                  <span className={cn("text-[20px] sm:text-[40px] font-bold leading-none", bannerTextColor)}>
                    {displayScore}
                  </span>
                  <span className="text-[10px] sm:text-[18px] text-white/60 font-medium">
                    /100
                  </span>
                </div>
              </div>
            </div>

            {/* Indicators Row */}
            <div className="flex flex-row items-center justify-between gap-1 sm:gap-10 mt-0 sm:mt-1">
              <div className="flex items-center gap-1.5 sm:gap-3">
                <div className="w-6 h-6 sm:w-10 sm:h-10 rounded-full border border-teal-500/30 flex items-center justify-center shrink-0">
                   <CalendarCheck size={12} className={cn("sm:w-[18px] sm:h-[18px]", bannerTextColor)} strokeWidth={2} />
                </div>
                <div className="flex flex-col">
                  <span className="text-[7px] sm:text-[10px] text-white/60 font-medium tracking-wider uppercase leading-none mb-0.5 sm:mb-1">Ritmo</span>
                  <span className="text-[11px] sm:text-[18px] font-bold text-white leading-none">{isSelectedScopeLoading ? "…" : `${ritmoOperacionalScore}%`}</span>
                </div>
              </div>
              <div className="w-px h-5 sm:h-8 bg-white/10 shrink-0"></div>
              <div className="flex items-center gap-1.5 sm:gap-3">
                <div className="w-6 h-6 sm:w-10 sm:h-10 rounded-full border border-teal-500/30 flex items-center justify-center shrink-0">
                   <TrendingUp size={12} className={cn("sm:w-[18px] sm:h-[18px]", bannerTextColor)} strokeWidth={2.5} />
                </div>
                <div className="flex flex-col">
                  <span className="text-[7px] sm:text-[10px] text-white/60 font-medium tracking-wider uppercase leading-none mb-0.5 sm:mb-1">Viagens</span>
                  <span className="text-[11px] sm:text-[18px] font-bold text-white leading-none">{isSelectedScopeLoading ? "…" : `${viagensScore}%`}</span>
                </div>
              </div>
              <div className="w-px h-5 sm:h-8 bg-white/10 shrink-0"></div>
              <div className="flex items-center gap-1.5 sm:gap-3">
                <div className="w-6 h-6 sm:w-10 sm:h-10 rounded-full border border-teal-500/30 flex items-center justify-center shrink-0">
                   <DollarSign size={12} className={cn("sm:w-[18px] sm:h-[18px]", bannerTextColor)} strokeWidth={2.5} />
                </div>
                <div className="flex flex-col">
                  <span className="text-[7px] sm:text-[10px] text-white/60 font-medium tracking-wider uppercase leading-none mb-0.5 sm:mb-1">Ganhos</span>
                  <span className="text-[11px] sm:text-[18px] font-bold text-white leading-none">{isSelectedScopeLoading ? "…" : `${ganhosScore}%`}</span>
                </div>
              </div>
            </div>

            {/* Bottom Row: XP Progress */}
            <div className="flex flex-row items-center gap-2 sm:gap-4 mt-1 sm:mt-2 bg-[#021317] rounded-[10px] sm:rounded-2xl p-1.5 sm:p-3 border border-white/5">
              <div className="flex-1 flex flex-col gap-1 sm:gap-2">
                <div className="flex justify-between items-center px-1">
                   <span className="text-[9px] sm:text-[14px] font-medium text-white/90">{Math.floor(currentLevelXp) % 1000} / 1.000 XP</span>
                   <span className={cn("text-[9px] sm:text-[13px] font-semibold", bannerTextColor)}>{Math.round(xpProgress)}%</span>
                </div>
                <div className="w-full h-1.5 sm:h-2.5 bg-[#0a2e38] rounded-full overflow-hidden">
                  <div className={cn("h-full rounded-full", bannerBgColor)} style={{"width": `${Math.max(2, xpProgress)}%`}}></div>
                </div>
              </div>
              <div className="w-px h-6 sm:h-8 bg-white/10 shrink-0"></div>
              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 pr-0.5 sm:pr-2">
                 <div className="w-6 h-6 sm:w-10 sm:h-10 rounded-full bg-teal-500/20 border border-teal-500/30 flex items-center justify-center shrink-0">
                    <Star size={12} className={cn("sm:w-[18px] sm:h-[18px]", bannerTextColor)} fill="currentColor" />
                 </div>
                 <span className="text-[9px] sm:text-[14px] font-bold text-white uppercase tracking-wider">
                   Nível <span className={cn("text-[11px] sm:text-[16px] ml-0.5", bannerTextColor)}>{displayLevel}</span>
                 </span>
              </div>
            </div>
          </div>
        </div>
        {/* KPIs Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-3">
          {/* KPI 1: Ganhos */}
          <div className="flex flex-col items-center justify-center py-3 px-2 sm:py-4 sm:px-3 text-center bg-white dark:bg-[#1A1F26] rounded-[16px] border border-slate-200 dark:border-white/10 shadow-sm">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Banknote
                size={14}
                className="text-teal-600 dark:text-teal-400"
                strokeWidth={2.5}
              />
              <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                Ganhos
              </span>
            </div>
            <span className="text-[13px] sm:text-[14px] md:text-[15px] font-bold text-slate-900 dark:text-white leading-none mb-1 tracking-tight break-all">
              {driverMetricsLoading ? "…" : formatCurrency(currentEarnings)}
            </span>
            <div className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
              <ArrowUpRight size={12} strokeWidth={3} />
              <span>{evolutionText}</span>
            </div>
          </div>

          {/* KPI 2: Ranking */}
          <div className="flex min-w-0 flex-col items-center justify-center overflow-hidden py-3 px-2 sm:py-4 sm:px-3 text-center bg-white dark:bg-[#1A1F26] rounded-[16px] border border-slate-200 dark:border-white/10 shadow-sm">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Trophy
                size={14}
                className="text-teal-600 dark:text-teal-400"
                strokeWidth={2.5}
              />
              <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                {rankingScope === "internal" ? "Ranking Interno" : "Ranking Global"}
              </span>
            </div>
            <div className="flex items-baseline gap-1 mb-1">
              <span className="text-[17px] md:text-[20px] font-bold text-slate-900 dark:text-white leading-none tracking-tight">
                {currentPositionDisplay}
              </span>
              <span className="text-[11px] md:text-[13px] text-slate-400 font-medium">
                / {isSelectedScopeLoading ? "…" : currentTotalDrivers}
              </span>
            </div>
            {isSelectedScopeLoading ? (
              <span className="text-[9px] sm:text-[10px] text-slate-500 dark:text-slate-400 font-medium leading-tight">
                Calculando ranking…
              </span>
            ) : currentNextCompetitor ? (
              <div className="flex w-full min-w-0 flex-col items-center text-slate-500 dark:text-slate-400 font-medium leading-tight">
                <span className="text-[8px] sm:text-[9px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Próximo colocado
                </span>
                <span
                  className="mt-0.5 block w-full truncate px-1 text-[10px] sm:text-[11px] font-semibold text-slate-700 dark:text-slate-300"
                  title={currentNextCompetitor.name || currentNextCompetitor.id}
                >
                  {currentNextCompetitorName}
                </span>
                {currentNextCompetitorCompanyName ? (
                  <span
                    className="block w-full truncate px-1 text-[8px] sm:text-[9px] text-slate-400 dark:text-slate-500"
                    title={currentNextCompetitorCompanyName}
                  >
                    {currentNextCompetitorCompanyName}
                  </span>
                ) : null}
                {currentDiffToNext > 0 ? (
                  <span className="mt-1 whitespace-nowrap text-[9px] sm:text-[10px]">
                    Faltam{" "}
                    <span className="text-teal-600 dark:text-teal-400 font-bold">
                      {formatCurrencyExact(currentDiffToNext)}
                    </span>
                  </span>
                ) : (
                  <span className="mt-1 max-w-full px-1 text-[8px] sm:text-[9px] leading-tight">
                    Empate em ganhos; desempate por viagens
                  </span>
                )}
              </div>
            ) : currentRankingContext.position === 1 ? (
              <span className="text-[9px] sm:text-[10px] text-teal-600 dark:text-teal-400 font-semibold leading-tight">
                Você lidera este ranking
              </span>
            ) : (
              <span className="text-[9px] sm:text-[10px] text-slate-500 dark:text-slate-400 font-medium leading-tight opacity-0">
                Sem referência
              </span>
            )}
          </div>

          {/* KPI 3: Viagens */}
          <div className="flex flex-col items-center justify-center py-3 px-2 sm:py-4 sm:px-3 text-center bg-white dark:bg-[#1A1F26] rounded-[16px] border border-slate-200 dark:border-white/10 shadow-sm">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Package
                size={14}
                className="text-teal-600 dark:text-teal-400"
                strokeWidth={2.5}
              />
              <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                Viagens
              </span>
            </div>
            <span className="text-[17px] md:text-[20px] font-bold text-slate-900 dark:text-white leading-none mb-1 tracking-tight">
              {driverMetricsLoading ? "…" : viagensRealizadas}
            </span>
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              realizadas
            </span>
          </div>

          {/* KPI 4: Média diária */}
          <div className="flex flex-col items-center justify-center py-3 px-2 sm:py-4 sm:px-3 text-center bg-white dark:bg-[#1A1F26] rounded-[16px] border border-slate-200 dark:border-white/10 shadow-sm">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Activity
                size={14}
                className="text-teal-600 dark:text-teal-400"
                strokeWidth={2.5}
              />
              <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                Média Diária
              </span>
            </div>
            <span className="text-[17px] md:text-[20px] font-bold text-slate-900 dark:text-white leading-none mb-1 tracking-tight">
              {driverMetricsLoading
                ? "…"
                : mediaDiaria.toLocaleString("pt-BR", {
                maximumFractionDigits: 1,
              })}
            </span>
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              viagens/dia
            </span>
          </div>
        </div>

        {/* Evolução */}
        <div className="flex items-center justify-between w-full py-3 px-4 sm:py-4 sm:px-5 bg-white dark:bg-[#1A1F26] rounded-[16px] border border-slate-200 dark:border-white/10 shadow-sm">
          <div className="flex items-center gap-2 sm:gap-3">
            <TrendingUp
              size={16}
              className="text-teal-600 dark:text-teal-400"
              strokeWidth={2.5}
            />
            <span className="text-[10px] sm:text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
              Evolução
            </span>
          </div>

          <div className="flex flex-col items-center">
            <span className="text-[16px] sm:text-[18px] font-bold text-slate-900 dark:text-white leading-none mb-0.5 tracking-tight">
              {evolutionText}
            </span>
            <span className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 font-medium">
              vs. período anterior
            </span>
          </div>

          <div className="w-[80px] sm:w-[120px] h-[24px] relative">
            <svg
              width="100%"
              height="100%"
              preserveAspectRatio="none"
              viewBox="0 0 100 30"
            >
              <defs>
                <linearGradient id="evolGrad2" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#14B8A6" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#14B8A6" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path
                d="M0,30 L0,20 C20,24 35,10 55,14 C75,18 85,4 100,6 L100,30 Z"
                fill="url(#evolGrad2)"
              />
              <path
                d="M0,20 C20,24 35,10 55,14 C75,18 85,4 100,6"
                fill="none"
                stroke="#14B8A6"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>
      </div>

      {/* CARD 2: CONSISTÊNCIA */}
      <div className="w-full rounded-[24px] flex flex-col relative shadow-[0_4px_24px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)] bg-white dark:bg-[#1A1F26] border border-slate-200/80 dark:border-white/5 p-4 sm:p-5">
        <h3 className="text-[11px] sm:text-[13px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-4">
          2. CONSISTÊNCIA
        </h3>

        {selectedPeriod === "Mês atual" ||
        selectedPeriod === "Personalizado" ? (
          <div className="w-full mb-4">
            <div className="grid grid-cols-7 gap-1 sm:gap-2 max-w-md mx-auto text-center mb-2">
              {["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"].map((day) => (
                <span
                  key={day}
                  className="text-[9px] sm:text-[10px] font-bold text-slate-500"
                >
                  {day}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1 sm:gap-2 max-w-md mx-auto">
              {(() => {
                const daysInPeriod: Date[] = [];
                let currDate = new Date(sDate);
                currDate.setUTCHours(0, 0, 0, 0);
                const endOfDay = new Date(eDate);
                endOfDay.setUTCHours(23, 59, 59, 999);
                let maxDays = 365; // hard limit
                while (currDate <= endOfDay && maxDays > 0) {
                  daysInPeriod.push(new Date(currDate));
                  currDate.setUTCDate(currDate.getUTCDate() + 1);
                  maxDays--;
                }
                const firstDayOfWeek =
                  daysInPeriod.length > 0 ? daysInPeriod[0].getUTCDay() : 0;

                return (
                  <>
                    {Array.from({ length: firstDayOfWeek }).map((_, i) => (
                      <div
                        key={`empty-${i}`}
                        className="w-7 h-7 sm:w-10 sm:h-10 mx-auto"
                      />
                    ))}
                    {daysInPeriod.map((d) => {
                      const hasTrip = currentTrips.some((t) => {
                        return (
                          t.metricDate.getUTCDate() === d.getUTCDate() &&
                          t.metricDate.getUTCMonth() === d.getUTCMonth() &&
                          t.metricDate.getUTCFullYear() === d.getUTCFullYear()
                        );
                      });
                      return (
                        <div
                          key={d.toISOString()}
                          className={cn(
                            "w-7 h-7 sm:w-10 sm:h-10 mx-auto rounded-full flex items-center justify-center text-[10px] sm:text-[11px] font-medium transition-all",
                            hasTrip
                              ? "bg-teal-500 text-white shadow-[0_2px_8px_rgba(20,184,166,0.3)]"
                              : "bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 text-slate-400",
                          )}
                        >
                          {d.getUTCDate()}
                        </div>
                      );
                    })}
                  </>
                );
              })()}
            </div>
          </div>
        ) : (
          <div className="flex justify-between items-center w-full px-1 sm:px-4 mb-4">
            {["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"].map(
              (day, idx) => {
                const hasTripOnDay = currentTrips.some((t) => {
                  return t.metricDate.getUTCDay() === idx;
                });
                const isChecked = hasTripOnDay;
                return (
                  <div key={day} className="flex flex-col items-center gap-2">
                    <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400">
                      {day}
                    </span>
                    <div
                      className={cn(
                        "w-10 h-10 sm:w-11 sm:h-11 rounded-full flex items-center justify-center transition-all",
                        isChecked
                          ? "bg-teal-500 text-white shadow-[0_4px_10px_rgba(20,184,166,0.3)]"
                          : "bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 border-dashed text-slate-400",
                      )}
                    >
                      {isChecked ? (
                        <svg
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                      ) : (
                        <div className="w-3 h-0.5 bg-slate-300 dark:bg-slate-600 rounded-full" />
                      )}
                    </div>
                  </div>
                );
              },
            )}
          </div>
        )}

        <div className="w-full text-center">
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Período:{" "}
            {sDate.toLocaleDateString("pt-BR", {
              day: "2-digit",
              month: "2-digit",
            })}{" "}
            a{" "}
            {eDate.toLocaleDateString("pt-BR", {
              day: "2-digit",
              month: "2-digit",
            })}
          </span>
        </div>
      </div>

      {/* CARD 3: HISTÓRICO DE CLASSIFICAÇÃO */}
      <div className="w-full rounded-[24px] flex flex-col relative shadow-[0_4px_24px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)] bg-white dark:bg-[#1A1F26] border border-slate-200/80 dark:border-white/5 p-4 sm:p-5">
        <div className="flex justify-between items-center w-full mb-3 sm:mb-4">
          <h3 className="text-[11px] sm:text-[13px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
            3. HISTÓRICO DE CLASSIFICAÇÃO
          </h3>

          <div className="flex bg-slate-100 dark:bg-slate-800 rounded-full p-1 border border-slate-200 dark:border-slate-700 shrink-0 ml-1">
            <button
              onClick={() => setClassificationView("Semanal")}
              className={cn(
                "px-2.5 py-1 sm:px-3 rounded-full text-[10px] sm:text-[11px] font-bold shadow-sm transition-all whitespace-nowrap",
                classificationView === "Semanal"
                  ? "bg-teal-500 text-white"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white",
              )}
            >
              Semanal
            </button>
            <button
              onClick={() => setClassificationView("Mensal")}
              className={cn(
                "px-2.5 py-1 sm:px-3 rounded-full text-[10px] sm:text-[11px] font-bold shadow-sm transition-all whitespace-nowrap",
                classificationView === "Mensal"
                  ? "bg-teal-500 text-white"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white",
              )}
            >
              Mensal
            </button>
          </div>
        </div>

        <div className="w-full pb-1">
          <table className="w-full table-fixed">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800/60">
                <th className="py-2.5 text-left text-[8px] sm:text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-tight sm:tracking-wider w-[28%] whitespace-nowrap">
                  Período
                </th>
                <th className="py-2.5 text-center text-[8px] sm:text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-tight sm:tracking-wider w-[18%] whitespace-nowrap">
                  Viagens
                </th>
                <th className="py-2.5 text-center text-[8px] sm:text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-tight sm:tracking-wider w-[24%] whitespace-nowrap">
                  Ganhos
                </th>
                <th className="py-2.5 text-right text-[8px] sm:text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-tight sm:tracking-wider w-[30%] whitespace-nowrap">
                  Posição no Ranking
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800/40">
              {classificationHistory.map((item) => (
                <tr key={item.id}>
                  <td className="py-2.5 sm:py-3 text-[10px] sm:text-[12px] font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap">
                    {item.label}
                  </td>
                  <td className="py-2.5 sm:py-3 text-[11px] sm:text-[13px] font-bold text-slate-900 dark:text-white text-center whitespace-nowrap">
                    {item.loading ? "…" : item.trips}
                  </td>
                  <td className="py-2.5 sm:py-3 text-[11px] sm:text-[13px] font-bold text-slate-900 dark:text-white text-center whitespace-nowrap">
                    {item.loading ? "…" : formatCurrencyExact(item.earnings)}
                  </td>
                  <td className="py-2.5 sm:py-3 text-[11px] sm:text-[13px] font-bold text-slate-900 dark:text-white text-right whitespace-nowrap">
                    {item.loading ? (
                      <span className="text-slate-400 dark:text-slate-500">…</span>
                    ) : item.position === null ? (
                      <span className="text-slate-400 dark:text-slate-500">
                        —
                      </span>
                    ) : item.position === 1 ||
                      item.position === 2 ||
                      item.position === 3 ? (
                      <span className="text-teal-600 dark:text-teal-400">
                        #{item.position}
                      </span>
                    ) : (
                      <span className="text-slate-900 dark:text-white">
                        #{item.position}
                      </span>
                    )}{" "}
                    {!item.loading && (
                      <span className="text-slate-400">/ {item.total}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="w-full text-center mt-3 sm:mt-4">
          <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500">
            {classificationTripsLoading
              ? "Sincronizando histórico de classificação…"
              : "Os dados são atualizados em tempo real."}
          </span>
        </div>
      </div>

      {isCustomDateModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
              <h4 className="font-bold text-slate-900 dark:text-white">
                Selecionar Período
              </h4>
              <button
                onClick={() => setIsCustomDateModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div className="p-4 flex justify-center overflow-auto max-h-[60vh]">
              <DayPicker
                mode="range"
                selected={customDateRange}
                onSelect={setCustomDateRange}
                className="text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex justify-end">
              <button
                onClick={() => setIsCustomDateModalOpen(false)}
                className="px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-lg font-medium transition-colors"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
