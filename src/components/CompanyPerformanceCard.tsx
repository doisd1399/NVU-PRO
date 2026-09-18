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
  ArrowDownRight,
  Minus,
  Award,
  Shield,
  Hexagon,
  CalendarCheck,
  DollarSign,
} from "lucide-react";
import {
  getWeeklyRange,
  filterTripsBySimulator,
  groupMetricsByCompany,
} from "../lib/metricsEngine";
import { normalizeTrip } from "../lib/tripNormalizer";
import { calculateOperationalScores } from "../lib/operationalRhythm";
import { useTripsRealtime } from "../hooks/useTripsRealtime";
import { useLiveCalendarReference } from "../hooks/useLiveCalendarReference";
import {
  buildClassificationPeriods,
  getClassificationHistoryInterval,
  resolvePerformanceInterval,
  resolvePreviousPerformanceInterval,
} from "../lib/performancePeriods";
import { differenceInDays } from "date-fns";

export interface CompanyPerformanceCardProps {
  historicoTrips: any[];
  globalHistoricoTrips?: any[];
  companyId: string;
  allCompanies: any[];
  simulatorId?: string;
  simulators?: Record<string, unknown>[];
  companiesLoading?: boolean;
  companyTripsLoading?: boolean;
}

export const CompanyPerformanceCard = React.memo(function CompanyPerformanceCard({
  historicoTrips,
  globalHistoricoTrips,
  companyId,
  allCompanies,
  simulatorId,
  simulators = [],
  companiesLoading = false,
  companyTripsLoading = false,
}: CompanyPerformanceCardProps) {
  const [isPeriodSelectorOpen, setIsPeriodSelectorOpen] = useState(false);
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
  // The current/previous comparison and the five-period classification were
  // previously two independent listeners. They are consumed by the same card
  // and can be covered by one bounded union range, avoiding duplicate Firestore
  // subscriptions and duplicate normalization work on the first profile paint.
  const performanceHistoryRange = useMemo(
    () => ({
      start: new Date(
        Math.min(
          prevSDate.getTime(),
          prevEDate.getTime(),
          classificationHistoryRange.start.getTime(),
        ),
      ),
      end: new Date(
        Math.max(
          eDate.getTime(),
          prevEDate.getTime(),
          classificationHistoryRange.end.getTime(),
        ),
      ),
    }),
    [
      classificationHistoryRange.end,
      classificationHistoryRange.start,
      eDate,
      prevEDate,
      prevSDate,
    ],
  );
  const performanceTripsState = useTripsRealtime({
    startDate: performanceHistoryRange.start,
    endDate: performanceHistoryRange.end,
    enabled: shouldLoadScopedTrips,
    keepPreviousData: true,
  });

  const effectiveGlobalTrips =
    globalHistoricoTrips ?? performanceTripsState.trips;
  const effectiveClassificationTrips =
    globalHistoricoTrips ?? performanceTripsState.trips;
  const performanceTripsLoading =
    globalHistoricoTrips === undefined &&
    (performanceTripsState.loading || performanceTripsState.refreshing);
  const normalizedCompanyHistory = useMemo(() => {
    return historicoTrips.map(normalizeTrip).filter((trip) => trip.isValid);
  }, [historicoTrips]);
  const hasVisibleCompanyHistory = normalizedCompanyHistory.length > 0;
  // A cached/company-owned history is enough for the first paint. Global
  // ranking and catalog reconciliation can refresh without replacing known
  // metrics with a synchronization placeholder.
  const currentRankingLoading =
    (companiesLoading || performanceTripsLoading) && !hasVisibleCompanyHistory;
  const classificationTripsLoading =
    (companiesLoading || performanceTripsLoading) && !hasVisibleCompanyHistory;

  const normalizedHistorico = useMemo(() => {
    return effectiveGlobalTrips.map(normalizeTrip).filter((t) => t.isValid);
  }, [effectiveGlobalTrips]);
  const normalizedClassificationHistory = useMemo(() => {
    return effectiveClassificationTrips
      .map(normalizeTrip)
      .filter((trip) => trip.isValid);
  }, [effectiveClassificationTrips]);

  const companySimulatorTrips = useMemo(
    () =>
      filterTripsBySimulator(
        normalizedCompanyHistory,
        simulatorId,
        allCompanies,
        simulators,
      ).filter(
        (trip) => (trip.empresaId || trip.companyId) === companyId,
      ),
    [allCompanies, companyId, normalizedCompanyHistory, simulatorId, simulators],
  );

  const allTimeCompanyTrips = useMemo(
    () =>
      normalizedCompanyHistory.filter(
        (trip) => (trip.empresaId || trip.companyId) === companyId,
      ),
    [companyId, normalizedCompanyHistory],
  );

  // Use the exact same company aggregation as the detailed ranking page.
  // This keeps the profile position, participant total, earnings and trip
  // count aligned with RankingGlobal for the same simulator and period.
  const currentPeriodStatsArray = useMemo(
    () =>
      groupMetricsByCompany(
        normalizedHistorico,
        sDate,
        eDate,
        simulatorId,
        allCompanies,
        simulators,
      ),
    [allCompanies, eDate, normalizedHistorico, sDate, simulatorId, simulators],
  );
  const previousPeriodStatsArray = useMemo(
    () =>
      groupMetricsByCompany(
        normalizedHistorico,
        prevSDate,
        prevEDate,
        simulatorId,
        allCompanies,
        simulators,
      ),
    [allCompanies, normalizedHistorico, prevEDate, prevSDate, simulatorId, simulators],
  );

  const currentCompanyPos = currentPeriodStatsArray.findIndex(
    (item) => item.id === companyId,
  );
  const currentCompanyStats =
    currentCompanyPos >= 0 ? currentPeriodStatsArray[currentCompanyPos] : null;
  const previousCompanyStats =
    previousPeriodStatsArray.find((item) => item.id === companyId) || null;

  // Company-owned history is a much smaller query and can paint the visible
  // KPIs before the global catalog/ranking finishes. Global stats replace the
  // local totals once available, keeping the final result aligned with Ranking.
  const currentTrips = useMemo(
    () =>
      companySimulatorTrips.filter(
        (trip) => trip.metricDate >= sDate && trip.metricDate <= eDate,
      ),
    [companySimulatorTrips, eDate, sDate],
  );
  const previousTrips = useMemo(
    () =>
      companySimulatorTrips.filter(
        (trip) =>
          trip.metricDate >= prevSDate && trip.metricDate <= prevEDate,
      ),
    [companySimulatorTrips, prevEDate, prevSDate],
  );
  const localCurrentEarnings = useMemo(
    () => currentTrips.reduce((total, trip) => total + trip.normalizedValor, 0),
    [currentTrips],
  );
  const localPreviousEarnings = useMemo(
    () => previousTrips.reduce((total, trip) => total + trip.normalizedValor, 0),
    [previousTrips],
  );

  const currentEarnings = currentCompanyStats?.val ?? localCurrentEarnings;
  const prevEarnings = previousCompanyStats?.val ?? localPreviousEarnings;
  const viagensRealizadas = currentCompanyStats?.trips ?? currentTrips.length;
  const companyMetricsLoading =
    companyTripsLoading && currentTrips.length === 0 && !currentCompanyStats;
  const hasCurrentCompanyActivity = viagensRealizadas > 0;
  const currentPositionDisplay = currentRankingLoading
    ? "…"
    : hasCurrentCompanyActivity && currentCompanyPos >= 0
      ? `#${currentCompanyPos + 1}`
      : "—";
  const currentTotalCompanies = currentPeriodStatsArray.length;
  const currentDiffToNext =
    hasCurrentCompanyActivity && currentCompanyPos > 0
      ? currentPeriodStatsArray[currentCompanyPos - 1].val -
        currentEarnings
      : 0;

  const evolution =
    prevEarnings === 0
      ? currentEarnings > 0
        ? 100
        : 0
      : ((currentEarnings - prevEarnings) / prevEarnings) * 100;
  const evolutionText = companyMetricsLoading
    ? "…"
    : evolution > 0
      ? `+${Math.round(evolution)}%`
      : `${Math.round(evolution)}%`;
  const evolutionTone =
    evolution > 0
      ? "text-emerald-600 dark:text-emerald-400"
      : evolution < 0
        ? "text-rose-600 dark:text-rose-400"
        : "text-slate-500 dark:text-slate-400";
  const EvolutionIcon = evolution > 0
    ? ArrowUpRight
    : evolution < 0
      ? ArrowDownRight
      : Minus;

  const totalViagensGeral = allTimeCompanyTrips.length;

  const actualEndDate = eDate > new Date() ? new Date() : eDate;
  const runDays = Math.max(1, differenceInDays(actualEndDate, sDate) + 1);
  const mediaDiaria = viagensRealizadas / runDays;

  const companyPerformancePool = useMemo(
    () =>
      currentPeriodStatsArray.map((item) => ({
        viagens: item.trips,
        ganhos: item.val,
      })),
    [currentPeriodStatsArray],
  );

  const { ritmoOperacionalScore, viagensScore, ganhosScore } = useMemo(
    () =>
      calculateOperationalScores(
        {
          viagens: currentCompanyStats?.trips || 0,
          ganhos: currentCompanyStats?.val || 0,
        },
        companyPerformancePool,
      ),
    [companyPerformancePool, currentCompanyStats],
  );

  const scoreRaw = Math.round((ritmoOperacionalScore + viagensScore + ganhosScore) / 3);
  const score = Math.round(scoreRaw);
  const displayScore = currentRankingLoading
    ? "…"
    : hasCurrentCompanyActivity
      ? Math.min(100, score)
      : "—";

  const getStatus = (score: number, hasActivity: boolean, loading: boolean) => {
    if (loading) {
      return {
        label: "Sincronizando",
        color: "text-teal-500 dark:text-teal-400",
        bg: "bg-teal-500 dark:bg-teal-400",
        index: 0,
        desc: (
          <>
            Atualizando empresas do<br />
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

  const status = getStatus(score, hasCurrentCompanyActivity, currentRankingLoading);
  const bannerTextColor = status.color.split(" ").find(c => c.startsWith("dark:"))?.replace("dark:", "") || status.color;
  const bannerBgColor = bannerTextColor.replace("text-", "bg-");

  const totalEarningsAllTime = useMemo(
    () =>
      allTimeCompanyTrips.reduce((acc, t) => acc + t.normalizedValor, 0),
    [allTimeCompanyTrips],
  );
  const currentLevelXp = Math.floor(totalViagensGeral * 10 + totalEarningsAllTime * 0.1);
  const currentLevel = Math.floor(currentLevelXp / 1000) + 1;
  const xpProgress = Math.min(100, ((currentLevelXp % 1000) / 1000) * 100);

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
      const ranking = groupMetricsByCompany(
        normalizedClassificationHistory,
        period.start,
        period.end,
        simulatorId,
        allCompanies,
        simulators,
      );
      const companyPos = ranking.findIndex((item) => item.id === companyId);
      const companyData = companyPos >= 0 ? ranking[companyPos] : null;
      const hasActivity = (companyData?.trips || 0) > 0;

      return {
        id: period.id,
        label: period.label,
        trips: companyData?.trips || 0,
        earnings: companyData?.val || 0,
        position: hasActivity && companyPos >= 0 ? companyPos + 1 : null,
        total: ranking.length,
        loading: classificationTripsLoading,
      };
    });
  }, [
    allCompanies,
    classificationPeriods,
    classificationTripsLoading,
    companyId,
    normalizedClassificationHistory,
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
      <div className="mb-3 px-3 py-2 rounded-xl bg-slate-100 dark:bg-white/5 text-xs font-semibold text-slate-600 dark:text-slate-300">
        Comparação entre empresas do simulador no período selecionado
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
                  <span className="text-[11px] sm:text-[18px] font-bold text-white leading-none">{currentRankingLoading ? "…" : `${ritmoOperacionalScore}%`}</span>
                </div>
              </div>
              <div className="w-px h-5 sm:h-8 bg-white/10 shrink-0"></div>
              <div className="flex items-center gap-1.5 sm:gap-3">
                <div className="w-6 h-6 sm:w-10 sm:h-10 rounded-full border border-teal-500/30 flex items-center justify-center shrink-0">
                   <TrendingUp size={12} className={cn("sm:w-[18px] sm:h-[18px]", bannerTextColor)} strokeWidth={2.5} />
                </div>
                <div className="flex flex-col">
                  <span className="text-[7px] sm:text-[10px] text-white/60 font-medium tracking-wider uppercase leading-none mb-0.5 sm:mb-1">Viagens</span>
                  <span className="text-[11px] sm:text-[18px] font-bold text-white leading-none">{currentRankingLoading ? "…" : `${viagensScore}%`}</span>
                </div>
              </div>
              <div className="w-px h-5 sm:h-8 bg-white/10 shrink-0"></div>
              <div className="flex items-center gap-1.5 sm:gap-3">
                <div className="w-6 h-6 sm:w-10 sm:h-10 rounded-full border border-teal-500/30 flex items-center justify-center shrink-0">
                   <DollarSign size={12} className={cn("sm:w-[18px] sm:h-[18px]", bannerTextColor)} strokeWidth={2.5} />
                </div>
                <div className="flex flex-col">
                  <span className="text-[7px] sm:text-[10px] text-white/60 font-medium tracking-wider uppercase leading-none mb-0.5 sm:mb-1">Ganhos</span>
                  <span className="text-[11px] sm:text-[18px] font-bold text-white leading-none">{currentRankingLoading ? "…" : `${ganhosScore}%`}</span>
                </div>
              </div>
            </div>

            {/* Bottom Row: XP Progress */}
            <div className="flex flex-row items-center gap-2 sm:gap-4 mt-1 sm:mt-2 bg-[#021317] rounded-[10px] sm:rounded-2xl p-1.5 sm:p-3 border border-white/5">
              <div className="flex-1 flex flex-col gap-1 sm:gap-2">
                <div className="flex justify-between items-center px-1">
                   <span className="text-[9px] sm:text-[14px] font-medium text-white/90">{currentLevelXp % 1000} / 1.000 XP</span>
                   <span className={cn("text-[9px] sm:text-[13px] font-semibold", bannerTextColor)}>{Math.round(xpProgress)}%</span>
                </div>
                <div className="w-full h-1.5 sm:h-2.5 bg-[#0a2e38] rounded-full overflow-hidden">
                  <div className={cn("h-full rounded-full", bannerBgColor)} style={{width: `${Math.max(2, xpProgress)}%`}}></div>
                </div>
              </div>
              <div className="w-px h-6 sm:h-8 bg-white/10 shrink-0"></div>
              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 pr-0.5 sm:pr-2">
                 <div className="w-6 h-6 sm:w-10 sm:h-10 rounded-full bg-teal-500/20 border border-teal-500/30 flex items-center justify-center shrink-0">
                    <Star size={12} className={cn("sm:w-[18px] sm:h-[18px]", bannerTextColor)} fill="currentColor" />
                 </div>
                 <span className="text-[9px] sm:text-[14px] font-bold text-white uppercase tracking-wider">
                   Nível <span className={cn("text-[11px] sm:text-[16px] ml-0.5", bannerTextColor)}>{currentLevel}</span>
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
              {companyMetricsLoading ? "…" : formatCurrency(currentEarnings)}
            </span>
            <div className={cn("flex items-center gap-1 text-[11px] font-bold", evolutionTone)}>
              <EvolutionIcon size={12} strokeWidth={3} />
              <span>{evolutionText}</span>
            </div>
          </div>

          {/* KPI 2: Ranking */}
          <div className="flex flex-col items-center justify-center py-3 px-2 sm:py-4 sm:px-3 text-center bg-white dark:bg-[#1A1F26] rounded-[16px] border border-slate-200 dark:border-white/10 shadow-sm">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Trophy
                size={14}
                className="text-teal-600 dark:text-teal-400"
                strokeWidth={2.5}
              />
              <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                Ranking Global
              </span>
            </div>
            <div className="flex items-baseline gap-1 mb-1">
              <span className="text-[17px] md:text-[20px] font-bold text-slate-900 dark:text-white leading-none tracking-tight">
                {currentPositionDisplay}
              </span>
              <span className="text-[11px] md:text-[13px] text-slate-400 font-medium">
                / {currentRankingLoading ? "…" : currentTotalCompanies}
              </span>
            </div>
            {!currentRankingLoading && currentDiffToNext > 0 ? (
              <span className="text-[9px] sm:text-[10px] text-slate-500 dark:text-slate-400 font-medium leading-tight">
                Faltam{" "}
                <span className="text-teal-600 dark:text-teal-400 font-bold">
                  {formatCurrencyExact(currentDiffToNext)}
                </span>
                <br />
                para o próximo
              </span>
            ) : (
              <span className="text-[9px] sm:text-[10px] text-slate-500 dark:text-slate-400 font-medium leading-tight opacity-0">
                Faltam <br />
                para o próximo
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
              {companyMetricsLoading ? "…" : viagensRealizadas}
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
              {companyMetricsLoading
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
            <EvolutionIcon
              size={16}
              className={evolutionTone}
              strokeWidth={2.5}
            />
            <span className="text-[10px] sm:text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
              Evolução
            </span>
          </div>

          <div className="flex flex-col items-center">
            <span className={cn(
              "text-[16px] sm:text-[18px] font-bold leading-none mb-0.5 tracking-tight",
              evolutionTone,
            )}>
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
                    {!item.loading && item.total > 0 && (
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
