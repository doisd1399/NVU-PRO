import { resolveDriverPhoto } from '../../../lib/resolveDriverPhoto';
import React, { useState, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { useActivityStore, useOperationalStore, useRankingFilterStore, useSessionStore } from "../../../context/AppContext";
import { useCompanyStore } from "../../../context/CompanyContext";
import { StableImage } from "../../../components/common/StableImage";
import { preloadImages } from "../../../lib/imageCache";

export const Z_INDEX = {
  dropdown: 1000,
  tooltip: 1100,
  popover: 1200,
  sidebar: 1250,
  drawer: 1300,
  modalBackdrop: 1400,
  modal: 1410,
  alertDialog: 1500,
  toast: 1600,
};

import { Card, CardContent } from "../../../components/ui/Card";
import { Button } from "../../../components/ui/Button";
import {
  Activity,
  FileText,
  UserPlus,
  Users,
  ArrowRight,
  Package,
  TrendingUp,
  Bell,
  ChevronRight,
  Container,
  Box,
  ChevronDown,
  ChevronUp,
  MapPin,
  CheckCircle2,
  Clock,
  Truck,
  User,
  Car,
  Trash2,
  Filter,
  Star,
  X,
  AlertTriangle,
  Calendar,
  Trophy,
  Rocket,
  Target,
  BarChart2,
  CalendarDays,
  Goal,
  Gauge,
  BadgeCheck,
  Route,
  Crosshair,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  differenceInDays,
  format,
  startOfDay,
  endOfDay,
  startOfMonth,
  endOfMonth,
  subDays,
  parseISO,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn, formatDriverName } from "../../../lib/utils";
import {
  normalizeTrip,
  getFilteredTrips,
  getStartOfDay,
  getEndOfDay,
  calculateWeeklyMetrics,
  getWeeklyRange,
  getMonthlyRange,
  getCustomRange,
} from "../../../lib/metricsEngine";
import { DesempenhoOperacionalCard } from "../../../components/DesempenhoOperacionalCard";
import { useTripHistory } from "../../../hooks/useTripHistory";
import { isTerminalJobStatus } from "../../../lib/jobStatus";
import { isTrailerlessSimulator } from "../../../lib/resolveSimulator";

function OperationsTab() {
  const { currentUser } = useSessionStore();
  const { companies, activeCompanyId, allCompanyMembers } = useCompanyStore();
  const {
    users,
    contracts,
    jobs,
    vehicles,
    trailers,
    simulators,
    cancelJob,
    rejectJobDemand,
    operationalDataReady,
    operationalDataRefreshing,
  } = useOperationalStore();
  const { jobDemands } = useActivityStore();
  const {
    globalPeriodPreset: desempenhoPeriod,
    setGlobalPeriodPreset: setDesempenhoPeriod,
    globalStartDateStr,
    globalEndDateStr,
  } = useRankingFilterStore();
  const { historicoTrips = [] } = useTripHistory(activeCompanyId, {
    userId: currentUser?.id,
  });
  const navigate = useNavigate();

  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }),
    [],
  );
  const formatCurrency = (value: number) => currencyFormatter.format(value);

  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [activeMobileSection, setActiveMobileSection] = useState<string | null>(
    null,
  );
  const [activeJobsFilter, setActiveJobsFilter] = useState<
    "all" | "pending" | "attention" | "late"
  >("all");
  const [cancelingJobId, setCancelingJobId] = useState<string | null>(null);
  const [jobToCancel, setJobToCancel] = useState<string | null>(null);
  const [isDemandsExpanded, setIsDemandsExpanded] = useState(false);
  const [isDriversModalOpen, setIsDriversModalOpen] = useState(false);
  const [resumoPeriod, setResumoPeriod] = useState<"semana" | "mensal">(
    "semana",
  );

  const activeDriverIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of allCompanyMembers) {
      if (
        m.companyId === activeCompanyId &&
        m.status === "active" &&
        m.roles?.includes("driver")
      ) {
        ids.add(m.userId);
      }
    }
    return ids;
  }, [allCompanyMembers, activeCompanyId]);

  const drivers = useMemo(
    () => users.filter((u) => activeDriverIds.has(u.id)),
    [users, activeDriverIds],
  );

  const pendingDemands = useMemo(() => {
    return jobDemands.filter(
      (d) => d.companyId === activeCompanyId && d.status === "pending",
    );
  }, [jobDemands, activeCompanyId]);

  const activeDriversCount = useMemo(
    () => drivers.filter((u) => u.status === "active" && u.isOnline).length,
    [drivers],
  );
  const activeDrivers = activeDriversCount;

  const activeContractsCount = contracts.length;
  const contractsById = useMemo(
    () => new Map(contracts.map((contract) => [contract.id, contract])),
    [contracts],
  );
  const usersById = useMemo(
    () => new Map(users.map((user) => [user.id, user])),
    [users],
  );
  const vehiclesById = useMemo(
    () => new Map(vehicles.map((vehicle) => [vehicle.id, vehicle])),
    [vehicles],
  );
  const trailersById = useMemo(
    () => new Map(trailers.map((trailer) => [trailer.id, trailer])),
    [trailers],
  );
  const companiesById = useMemo(
    () => new Map(companies.map((company) => [company.id, company])),
    [companies],
  );

  // Computed data for Active Jobs
  const getJobStatusDetails = (job: any, contract: any) => {
    if (job.status === "completed")
      return {
        text: "Concluído",
        color: "bg-green-500",
        bg: "bg-green-50 dark:bg-green-500/10 dark:border-green-500/20",
        icon: CheckCircle2,
      };
    if (job.status === "cancelled")
      return {
        text: "Cancelado",
        color: "bg-red-500",
        bg: "bg-red-50 dark:bg-red-500/10 dark:border-red-500/20",
      };
    if (job.status === "awaiting_completion")
      return {
        text: "Aguardando conclusão",
        color: "bg-emerald-500",
        bg: "bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/20",
        icon: CheckCircle2,
      };
    if (job.status === "delayed")
      return {
        text: "Atrasado",
        color: "bg-red-500",
        bg: "bg-red-50 dark:bg-red-500/10 dark:border-red-500/20",
      };

    const daysLeft = differenceInDays(
      new Date(job.dueAt || job.deadlineDate),
      new Date(),
    );

    if (daysLeft < 0)
      return {
        text: "Atrasado",
        color: "bg-red-500",
        bg: "bg-red-50 dark:bg-red-500/10 dark:border-red-500/20",
      };
    if (daysLeft <= 2)
      return {
        text: "Atenção",
        color: "bg-amber-50 dark:bg-amber-500/100",
        bg: "bg-amber-50 dark:bg-amber-500/10",
      };
    if (job.status === "active")
      return {
        text: "Em Andamento",
        color: "bg-blue-500",
        bg: "bg-blue-50 dark:bg-blue-500/10 dark:border-blue-500/20",
      };

    return {
      text: "Não Iniciado",
      color: "bg-gray-400",
      bg: "bg-gray-50 dark:bg-[#1A1F26]",
    };
  };

  const activeJobsList = useMemo(() => {
    const now = new Date();
    return jobs
      .map((job) => {
        const contract = contractsById.get(job.contractId);
        const driver = usersById.get(job.driverId);
        const vehicle = vehiclesById.get(job.vehicleId);
        const company = job.companyId
          ? companiesById.get(job.companyId)
          : undefined;
        const trailerlessSimulator = isTrailerlessSimulator(
          contract || company,
          simulators as unknown[],
        );
        const effectiveTrailerId = trailerlessSimulator
          ? ""
          : job.trailerId || contract?.trailerId;
        const trailer = effectiveTrailerId
          ? trailersById.get(effectiveTrailerId)
          : undefined;

        const statusDetails = getJobStatusDetails(job, contract);
        const daysLeft = differenceInDays(
          new Date(job.dueAt || job.deadlineDate),
          now,
        );

        return {
          ...job,
          contract,
          driver,
          vehicle,
          trailer,
          trailerlessSimulator,
          company,
          statusDetails,
          daysLeft,
        };
      })
      .filter(
        (j) =>
          j.contract &&
          j.driver &&
          !isTerminalJobStatus(j.status),
      );
  }, [
    companiesById,
    contractsById,
    jobs,
    simulators,
    trailersById,
    usersById,
    vehiclesById,
  ]);

  const filteredActiveJobsList = useMemo(() => {
    return activeJobsList.filter((job) => {
      if (activeJobsFilter === "late")
        return job.status === "delayed" || job.daysLeft < 0;
      if (activeJobsFilter === "attention")
        return (
          job.status !== "delayed" &&
          job.status !== "awaiting_completion" &&
          job.daysLeft >= 0 &&
          job.daysLeft <= 2
        );
      if (activeJobsFilter === "pending") return job.status === "pending";
      return true;
    });
  }, [activeJobsList, activeJobsFilter]);
  

  const normalizedHistoricoTrips = useMemo(() => {
    return historicoTrips.map((trip: any) =>
      normalizeTrip({ ...trip, id: trip.id || trip.idViagem }),
    );
  }, [historicoTrips]);

  const validTripCountByJobId = useMemo(() => {
    const counts = new Map<string, number>();
    const fallbackCandidates = new Map<string, any[]>();

    activeJobsList.forEach((job) => {
      counts.set(job.id, 0);
      const key = `${String(job.driverId || "").trim()}|${String(job.contractId || "").trim()}`;
      if (key === "|") return;
      const current = fallbackCandidates.get(key) || [];
      current.push(job);
      current.sort((a, b) => {
        const aTime = new Date(a.assignedAt || a.createdAt || 0).getTime() || 0;
        const bTime = new Date(b.assignedAt || b.createdAt || 0).getTime() || 0;
        return bTime - aTime;
      });
      fallbackCandidates.set(key, current);
    });

    normalizedHistoricoTrips.forEach((trip: any) => {
      if (!trip.isValid) return;

      const directJobId = String(trip.jobId || "").trim();
      if (directJobId) {
        if (counts.has(directJobId)) {
          counts.set(directJobId, (counts.get(directJobId) || 0) + 1);
        }
        return;
      }

      // Compatibility for trips created before jobId became mandatory. The
      // driver card already used this contract/driver/time fallback; applying
      // the same rule here prevents the company card from showing a different
      // progress for the very same active operation.
      const driverId = String(
        trip.driverId || trip.motoristaId || trip.motorista_id || trip.userId || "",
      ).trim();
      const contractId = String(trip.contractId || trip.contratoId || "").trim();
      if (!driverId || !contractId) return;

      const candidates = fallbackCandidates.get(`${driverId}|${contractId}`) || [];
      const tripTime = trip.metricDate?.getTime?.() || 0;
      if (!tripTime) return;

      const matchedJob = candidates.find((job) => {
        const assignedTime =
          new Date(job.assignedAt || job.createdAt || 0).getTime() || 0;
        const completedTime = job.completedAt
          ? new Date(job.completedAt).getTime() || Number.POSITIVE_INFINITY
          : Number.POSITIVE_INFINITY;
        return tripTime >= assignedTime && tripTime <= completedTime;
      });

      if (matchedJob) {
        counts.set(matchedJob.id, (counts.get(matchedJob.id) || 0) + 1);
      }
    });

    return counts;
  }, [activeJobsList, normalizedHistoricoTrips]);

  const getResolvedJobProgress = React.useCallback(
    (job: any) =>
      Math.max(
        0,
        Number(job?.progress) || 0,
        validTripCountByJobId.get(String(job?.id || "")) || 0,
      ),
    [validTripCountByJobId],
  );

  const {
    summaryActiveDriversCount,
    summaryDriversRequired,
    summaryActiveCompleted,
    summaryActiveRequired,
    summaryActiveContractsCount,
    summaryEfficiency,
  } = useMemo(() => {
    const activeSummaryDriverIds = new Set<string>();
    let comp = 0;
    let req = 0;
    const currentActiveContracts = new Set<string>();
    let activeJobsCount = 0;

    for (const job of activeJobsList) {
      if (job.companyId === activeCompanyId) {
        if (job.driverId) {
          activeSummaryDriverIds.add(job.driverId);
        }
        if (job.contractId) {
          currentActiveContracts.add(job.contractId);
        }
        activeJobsCount++;
        const realProgress = getResolvedJobProgress(job);
        comp += realProgress || 0;

        req += job.contract?.totalDeliveries || 0;
      }
    }

    let eff: number | string = "--";
    if (req > 0) {
      eff = Math.min(100, Math.max(0, Math.round((comp / req) * 100)));
    }

    return {
      summaryActiveDriversCount: activeSummaryDriverIds.size,
      summaryDriversRequired: activeJobsCount,
      summaryActiveCompleted: comp,
      summaryActiveRequired: req,
      summaryActiveContractsCount: activeJobsCount,
      summaryEfficiency: eff,
    };
  }, [activeJobsList, activeCompanyId, getResolvedJobProgress]);

  const resumoMetrics = useMemo(() => {
    const { start, end } =
      resumoPeriod === "semana" ? getWeeklyRange() : getMonthlyRange();
    return calculateWeeklyMetrics(
      normalizedHistoricoTrips,
      start,
      end,
      activeCompanyId,
    );
  }, [normalizedHistoricoTrips, resumoPeriod, activeCompanyId]);

  const resumoTrips = resumoMetrics.filteredTrips;
  const totalGanhos = resumoMetrics.totalRevenue;

  const { driversWithOperation, driversWithoutOperation } = useMemo(() => {
    const jobsByDriverId = new Map<string, any>();

    for (const job of activeJobsList) {
      if (job.companyId !== activeCompanyId || !job.driverId) continue;

      const currentJob = jobsByDriverId.get(job.driverId);
      const shouldPreferStartedJob =
        currentJob?.status === "pending" && job.status !== "pending";

      if (!currentJob || shouldPreferStartedJob) {
        jobsByDriverId.set(job.driverId, job);
      }
    }

    const withOperation: Array<{ user: any; job: any }> = [];
    const withoutOperation: any[] = [];

    for (const driver of drivers) {
      const job = jobsByDriverId.get(driver.id);
      if (job) {
        withOperation.push({ user: driver, job });
      } else {
        withoutOperation.push(driver);
      }
    }

    return {
      driversWithOperation: withOperation,
      driversWithoutOperation: withoutOperation,
    };
  }, [drivers, activeJobsList, activeCompanyId]);

  useEffect(() => {
    // This modal is opened on demand, so warm its exact photo set while the
    // user is still looking at the operations dashboard.
    void preloadImages(
      [
        ...driversWithoutOperation.map(
          (user) => resolveDriverPhoto(user) || null,
        ),
        ...driversWithOperation.map(
          ({ user }) => resolveDriverPhoto(user) || null,
        ),
      ],
      6,
    );
  }, [driversWithoutOperation, driversWithOperation]);

  const META_SEMANAL_POR_MOTORISTA = 15;
  const META_MENSAL_POR_MOTORISTA = 40;

  const desempenhoMetrics = useMemo(() => {
    let sDate, eDate;

    if (desempenhoPeriod === "semana") {
      const { start, end } = getWeeklyRange();
      sDate = start;
      eDate = end;
    } else if (desempenhoPeriod === "mes") {
      const { start, end } = getMonthlyRange();
      sDate = start;
      eDate = end;
    } else {
      if (globalStartDateStr && globalEndDateStr) {
        const { start, end } = getCustomRange(
          globalStartDateStr,
          globalEndDateStr,
        );
        sDate = start;
        eDate = end;
      } else {
        sDate = globalStartDateStr
          ? getStartOfDay(globalStartDateStr)
          : undefined;
        eDate = globalEndDateStr ? getEndOfDay(globalEndDateStr) : undefined;
      }
    }

    const filteredTrips = getFilteredTrips(
      normalizedHistoricoTrips,
      sDate,
      eDate,
      activeCompanyId,
    );

    const viagensRealizadas = filteredTrips.length;

    // Meta por motorista
    const metaPorMotorista =
      desempenhoPeriod === "semana"
        ? META_SEMANAL_POR_MOTORISTA
        : META_MENSAL_POR_MOTORISTA;

    // Calcula proporção de participação
    const periodDays = sDate && eDate ? differenceInDays(eDate, sDate) + 1 : 1;
    let propMetaAcumulada = 0;

    // 1. Entradas (motoristas atualmente ativos)
    drivers.forEach((d) => {
      const member = allCompanyMembers.find(
        (m) =>
          m.userId === d.id &&
          m.companyId === activeCompanyId &&
          m.roles?.includes("driver") &&
          m.status === "active",
      );
      if (!sDate || !eDate || !member || !member.joinedAt) {
        propMetaAcumulada += 1;
        return;
      }
      const joinDate = new Date(member.joinedAt);
      if (joinDate > eDate) return; // Entrou após
      let pJoin = joinDate < sDate ? sDate : joinDate;
      const activeDays = differenceInDays(eDate, pJoin) + 1;
      propMetaAcumulada += Math.max(0, Math.min(1, activeDays / periodDays));
    });

    // 2. Saídas (motoristas inativos com registros no período)
    const inactiveDriversMap = new Map<string, Date>();
    filteredTrips.forEach((t) => {
      if (t.motoristaId && !drivers.find((d) => d.id === t.motoristaId)) {
        const tDate = t.metricDate
          ? new Date(t.metricDate)
          : t.completedAt
            ? new Date(t.completedAt)
            : null;
        if (tDate) {
          const curr = inactiveDriversMap.get(t.motoristaId);
          if (!curr || tDate > curr) {
            inactiveDriversMap.set(t.motoristaId, tDate);
          }
        }
      }
    });

    inactiveDriversMap.forEach((lastTripDate) => {
      if (!sDate || !eDate) {
        propMetaAcumulada += 1;
        return;
      }
      let pLeft = lastTripDate > eDate ? eDate : lastTripDate;
      if (pLeft < sDate) return;
      const activeDays = differenceInDays(pLeft, sDate) + 1;
      propMetaAcumulada += Math.max(0, Math.min(1, activeDays / periodDays));
    });

    // Motoristas ativos totais (considerando os que participaram)
    const motoristasAtivos = drivers.length + inactiveDriversMap.size;

    // Meta operacional baseada na fração proporcional calculada
    const metaOperacional = Math.round(propMetaAcumulada * metaPorMotorista);

    // Viagens restantes
    const viagensRestantes = Math.max(0, metaOperacional - viagensRealizadas);

    // Média operacional
    const mediaOperacional =
      motoristasAtivos > 0 ? viagensRealizadas / motoristasAtivos : 0;

    // Capacidade operacional
    const capacidadeOperacional =
      metaOperacional > 0 ? (viagensRealizadas / metaOperacional) * 100 : 0;

    return {
      motoristasAtivos,
      metaOperacional,
      viagensRealizadas,
      viagensRestantes,
      metaPorMotorista,
      mediaOperacional,
      capacidadeOperacional: capacidadeOperacional,
      scoreDisplay: Object.is(NaN, capacidadeOperacional)
        ? 0
        : Math.min(100, capacidadeOperacional),
      scoreStatus: Object.is(NaN, capacidadeOperacional)
        ? 0
        : capacidadeOperacional,
    };
  }, [
    normalizedHistoricoTrips,
    activeCompanyId,
    desempenhoPeriod,
    globalStartDateStr,
    globalEndDateStr,
    drivers,
  ]);

  const getDesempenhoClassification = (score: number) => {
    if (score >= 100)
      return {
        text: "Excelente",
        colorClass: "text-emerald-500 dark:text-emerald-400",
        barColor: "bg-emerald-500",
        effectClass:
          "shadow-[0_0_15px_rgba(16,185,129,0.3)] dark:shadow-[0_0_15px_rgba(16,185,129,0.15)]",
      };
    if (score >= 85)
      return {
        text: "Muito Bom",
        colorClass: "text-blue-500 dark:text-blue-400",
        barColor: "bg-blue-500",
        effectClass:
          "shadow-[0_0_15px_rgba(59,130,246,0.3)] dark:shadow-[0_0_15px_rgba(59,130,246,0.15)]",
      };
    if (score >= 70)
      return {
        text: "Bom",
        colorClass: "text-green-500 dark:text-green-400",
        barColor: "bg-green-500",
        effectClass:
          "shadow-[0_0_15px_rgba(34,197,94,0.3)] dark:shadow-[0_0_15px_rgba(34,197,94,0.15)]",
      };
    if (score >= 50)
      return {
        text: "Regular",
        colorClass: "text-amber-500 dark:text-amber-400",
        barColor: "bg-amber-500",
        effectClass:
          "shadow-[0_0_15px_rgba(245,158,11,0.3)] dark:shadow-[0_0_15px_rgba(245,158,11,0.15)]",
      };
    return {
      text: "Baixo",
      colorClass: "text-red-500 dark:text-red-400",
      barColor: "bg-red-500",
      effectClass:
        "shadow-[0_0_15px_rgba(239,68,68,0.3)] dark:shadow-[0_0_15px_rgba(239,68,68,0.15)]",
    };
  };

  const desempenhoClass = getDesempenhoClassification(
    desempenhoMetrics.capacidadeOperacional,
  );
  const visualProgress = Math.min(desempenhoMetrics.capacidadeOperacional, 100);

  const getDesempenhoText = (score: number) => {
    if (score >= 100) return "Desempenho acima da meta operacional.";
    if (score >= 70) return "Desempenho dentro da meta operacional.";
    return "Desempenho abaixo da meta operacional.";
  };

  // Detailed Operation Status
  const { pendingJobs, inProgressJobs, warningJobs, delayedJobs } =
    useMemo(() => {
      let p = 0,
        i = 0,
        w = 0,
        d = 0;
      for (const j of activeJobsList) {
        // Every open job belongs to exactly one status bucket so the counts
        // and percentages cannot drift above the number of active jobs.
        if (j.status === "pending") {
          p++;
          continue;
        }
        if (j.status === "awaiting_completion") {
          i++;
          continue;
        }
        if (j.status === "delayed" || j.daysLeft < 0) {
          d++;
          continue;
        }
        if (j.daysLeft <= 2) {
          w++;
          continue;
        }
        i++;
      }
      return {
        pendingJobs: p,
        inProgressJobs: i,
        warningJobs: w,
        delayedJobs: d,
      };
    }, [activeJobsList]);

  const totalActiveList = activeJobsList.length || 1; // avoid div by 0

  return (
    <div className="space-y-6">
      {(!operationalDataReady || operationalDataRefreshing) && (
        <div
          className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-200"
          role="status"
          aria-live="polite"
        >
          Exibindo os dados disponíveis enquanto o restante da operação é sincronizado; os valores podem ser parciais até a confirmação do servidor.
        </div>
      )}
      {/* --- SOLICITAÇÕES DE TRABALHO (NVU) --- */}
      {pendingDemands.length > 0 && (
        <div className="bg-white dark:bg-[#1A1F26] border border-slate-200 dark:border-[#2A2F3A] rounded-lg shadow-sm overflow-hidden">
          <button
            onClick={() => setIsDemandsExpanded(!isDemandsExpanded)}
            className="w-full h-9 px-2 sm:px-3 flex items-center justify-between active:scale-[0.99] transition-transform bg-white dark:bg-[#1A1F26]"
          >
            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
              <div className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-500 shrink-0"></div>
              <span className="text-[11px] sm:text-[13px] font-semibold text-slate-800 dark:text-slate-200 truncate leading-none">
                Solicitações de Trabalho
              </span>
            </div>
            <div className="flex items-center gap-2 pl-2 shrink-0">
              <div className="bg-slate-100 dark:bg-[#2A2F3A] text-slate-600 dark:text-slate-300 min-w-[20px] h-5 px-1.5 rounded-full flex items-center justify-center shrink-0">
                <span className="font-semibold text-[10px] leading-none">
                  {pendingDemands.length}
                </span>
              </div>
              <ChevronDown
                size={14}
                className={cn(
                  "text-slate-400 shrink-0 transition-transform",
                  isDemandsExpanded && "rotate-180",
                )}
              />
            </div>
          </button>

          <div
            className={cn(
              "transition-all duration-200 ease-in-out border-t border-slate-100 dark:border-[#2A2F3A]",
              isDemandsExpanded
                ? "opacity-100"
                : "max-h-0 opacity-0 overflow-hidden border-t-0",
            )}
          >
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4 gap-4 bg-gray-50/50 dark:bg-[#1A1F26]">
              {pendingDemands.map((demand) => {
                const driver = users.find((u) => u.id === demand.driverId);
                const driverJobs = jobs.filter(
                  (j) =>
                    j.driverId === demand.driverId && j.status === "completed",
                );
                const totalJobs = driverJobs.length;
                const rating = driver?.rating?.toFixed(1) || "5.0";

                return (
                  <div
                    key={demand.id}
                    className="bg-white dark:bg-[#1A1F26] rounded-2xl p-4 border border-gray-200 dark:border-[#2A2F3A]/60 shadow-sm relative group hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3 min-w-0">
                        {resolveDriverPhoto(driver) || null ? (
                          <StableImage
                            src={resolveDriverPhoto(driver) || null}
                            alt={driver?.name}
                            loading="lazy"
                            decoding="async"
                            wrapperClassName="w-10 h-10 rounded-full shrink-0 border border-gray-100 dark:border-[#2A2F3A] bg-gray-50 dark:bg-[#1A1F26]"
                            className="object-cover"
                            referrerPolicy="no-referrer"
                            fallback={
                              <span className="h-full w-full text-gray-600 dark:text-[#d4d4d8] flex items-center justify-center font-bold text-sm">
                                {driver?.name?.substring(0, 2).toUpperCase() || "M"}
                              </span>
                            }
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-gray-50 dark:bg-[#1A1F26] text-gray-600 dark:text-[#d4d4d8] flex items-center justify-center font-bold text-sm shrink-0 border border-gray-200 dark:border-[#2A2F3A]">
                            {driver?.name?.substring(0, 2).toUpperCase() || "M"}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="font-bold text-gray-900 dark:text-[#fafafa] text-[14px] truncate">
                            {driver?.name}
                          </p>
                          <div className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-[#a1a1aa] mt-0.5">
                            <span className="flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400">
                              <Star size={11} className="fill-current" />{" "}
                              {rating}
                            </span>
                            <span className="text-gray-300">•</span>
                            <span className="truncate">
                              {totalJobs} trabalhos
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() =>
                          navigate("/admin/assign", {
                            state: {
                              preselectedDriverId: demand.driverId,
                            },
                          })
                        }
                        className="flex-1 bg-green-500 hover:bg-green-600 text-white h-8 font-semibold text-xs shadow-none"
                      >
                        Encaminhar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          navigate(`/admin/driver/${demand.driverId}`, {
                            state: {
                              returnUrl: "/admin/fleet",
                              returnState: { activeTab: "operations" },
                              companyId: demand.companyId || activeCompanyId,
                            },
                          })
                        }
                        className="px-3 h-8 text-xs font-semibold text-gray-600 dark:text-[#d4d4d8] border-gray-200 dark:border-[#2A2F3A]"
                      >
                        Perfil
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => rejectJobDemand(demand.id)}
                        className="px-2 h-8 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg shrink-0"
                        title="Recusar solicitação"
                      >
                        <X size={16} />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* --- MOBILE DASHBOARD --- */}
      <div className="md:hidden space-y-4">
        {/* 1. Resumo Operacional (Sempre expandido) */}
        <div className="bg-white dark:bg-[#1A1F26] border text-gray-900 dark:text-[#fafafa] border-gray-200 dark:border-[#2A2F3A] rounded-xl overflow-hidden shadow-sm dark:shadow-none">
          <div className="w-full flex items-center justify-between p-3 bg-white dark:bg-[#1A1F26] border-b border-gray-100 dark:border-[#2A2F3A]">
            <div className="flex flex-col text-left">
              <span className="font-bold text-[15px] text-gray-900 dark:text-[#fafafa]">
                Resumo Operacional
              </span>
              <span className="text-[12px] text-gray-500 dark:text-[#a1a1aa] font-medium">
                Em tempo real
              </span>
            </div>

            <div className="flex items-center bg-slate-100 dark:bg-[#2A2F3A] rounded-lg p-0.5">
              <button
                onClick={() => setResumoPeriod("semana")}
                className={cn(
                  "px-2 py-1 text-[11px] font-bold rounded-md transition-colors",
                  resumoPeriod === "semana"
                    ? "bg-white dark:bg-[#3A3F4A] text-slate-900 dark:text-white shadow-sm"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200",
                )}
              >
                1S
              </button>
              <button
                onClick={() => setResumoPeriod("mensal")}
                className={cn(
                  "px-2 py-1 text-[11px] font-bold rounded-md transition-colors",
                  resumoPeriod === "mensal"
                    ? "bg-white dark:bg-[#3A3F4A] text-slate-900 dark:text-white shadow-sm"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200",
                )}
              >
                1M
              </button>
            </div>
          </div>
          <div>
            <div className="p-3 grid grid-cols-2 gap-2">
              <div
                className="bg-gray-50 dark:bg-[#1A1F26] rounded-lg p-3 flex flex-col justify-between border border-gray-100 dark:border-[#2A2F3A] h-[72px] cursor-pointer hover:bg-gray-100 dark:hover:bg-[#2A2F3A] transition-colors"
                onClick={() => setIsDriversModalOpen(true)}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-[10px] text-gray-500 dark:text-[#a1a1aa] font-bold uppercase tracking-wider leading-none">
                    Motoristas
                  </span>
                  <ChevronRight size={12} className="text-gray-400" />
                </div>
                <div className="flex items-baseline gap-1 mt-auto">
                  <span className="text-[18px] font-bold text-gray-900 dark:text-[#fafafa] leading-none">
                    {driversWithOperation.length}{" "}
                    <span className="text-[12px] font-medium text-gray-400">
                      / {drivers.length}
                    </span>
                  </span>
                  <span className="text-[10px] text-gray-400 leading-none">
                    Com operação
                  </span>
                </div>
              </div>
              <div className="bg-gray-50 dark:bg-[#1A1F26] rounded-lg p-3 flex flex-col justify-between border border-gray-100 dark:border-[#2A2F3A] h-[72px]">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-gray-500 dark:text-[#a1a1aa] font-bold uppercase tracking-wider leading-none">
                    Ganhos
                  </span>
                  <span className="text-[9px] text-gray-400 leading-none">
                    Acumulado
                  </span>
                </div>
                <div className="flex items-baseline gap-1 mt-auto">
                  <span className="text-[14px] tracking-tight font-bold text-gray-900 dark:text-[#fafafa] leading-none shrink-0">
                    {formatCurrency(totalGanhos)}
                  </span>
                </div>
              </div>
              <div className="bg-gray-50 dark:bg-[#1A1F26] rounded-lg p-3 flex flex-col justify-between border border-gray-100 dark:border-[#2A2F3A] h-[72px]">
                <span className="text-[10px] text-gray-500 dark:text-[#a1a1aa] font-bold uppercase tracking-wider leading-none">
                  Viagens Realizadas
                </span>
                <div className="flex items-baseline gap-1 mt-auto">
                  <span className="text-[18px] font-bold text-gray-900 dark:text-[#fafafa] leading-none">
                    {resumoTrips.length}
                  </span>
                  <span className="text-[10px] text-gray-400 leading-none">
                    Concluídas
                  </span>
                </div>
              </div>
              <div className="bg-gray-50 dark:bg-[#1A1F26] rounded-lg p-3 flex flex-col justify-between border border-gray-100 dark:border-[#2A2F3A] h-[72px]">
                <span className="text-[10px] text-gray-500 dark:text-[#a1a1aa] font-bold uppercase tracking-wider leading-none">
                  Meta de Entregas
                </span>
                <div className="flex items-baseline gap-1 mt-auto">
                  <span className="text-[18px] font-bold text-gray-900 dark:text-[#fafafa] leading-none">
                    {Math.max(
                      0,
                      summaryActiveRequired - summaryActiveCompleted,
                    )}
                  </span>
                  <span className="text-[10px] text-gray-400 leading-none">
                    {Math.max(
                      0,
                      summaryActiveRequired - summaryActiveCompleted,
                    ) === 0
                      ? "Concluída"
                      : "Restantes"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 1.5 NOVO CARD STATUS OPERACIONAL */}
        <DesempenhoOperacionalCard
          metrics={desempenhoMetrics}
          className="mb-6"
          periodPreset={desempenhoPeriod}
          setPeriodPreset={setDesempenhoPeriod}
        />

        {/* 2. Ações Rápidas (Recolhido) */}
        <div className="bg-white dark:bg-[#1A1F26] border text-gray-900 dark:text-[#fafafa] border-gray-200 dark:border-[#2A2F3A] rounded-xl overflow-hidden shadow-sm dark:shadow-none">
          <button
            onClick={() =>
              setActiveMobileSection(
                activeMobileSection === "actions" ? null : "actions",
              )
            }
            className="w-full flex items-center justify-between p-3 bg-white dark:bg-[#1A1F26]"
          >
            <span className="font-bold text-[15px]">Ações Rápidas</span>
            {activeMobileSection === "actions" ? (
              <ChevronUp
                size={18}
                className="text-gray-500 dark:text-[#a1a1aa]"
              />
            ) : (
              <ChevronDown
                size={18}
                className="text-gray-500 dark:text-[#a1a1aa]"
              />
            )}
          </button>
          <div
            className={cn(
              "transition-all duration-200 ease-in-out",
              activeMobileSection === "actions"
                ? "max-h-[400px] opacity-100"
                : "max-h-0 opacity-0 overflow-hidden",
            )}
          >
            <div className="px-3 pb-3 pt-1 border-t border-gray-100 dark:border-[#2A2F3A] space-y-1.5">
              <button
                onClick={() =>
                  navigate("/admin/fleet", {
                    state: { activeTab: "contracts" },
                  })
                }
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-gray-50 dark:bg-[#1A1F26] active:bg-gray-50 dark:bg-[#1A1F26] transition-colors"
              >
                <div className="flex items-center gap-3 text-[13px] font-bold text-gray-800 dark:text-[#d4d4d8]">
                  <FileText
                    size={18}
                    className="text-indigo-600 dark:text-indigo-400"
                  />{" "}
                  <span>Operações</span>
                </div>
                <ChevronRight size={16} className="text-gray-400" />
              </button>
              <button
                onClick={() => navigate("/admin/assign")}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-gray-50 dark:bg-[#1A1F26] active:bg-gray-50 dark:bg-[#1A1F26] transition-colors"
              >
                <div className="flex items-center gap-3 text-[13px] font-bold text-gray-800 dark:text-[#d4d4d8]">
                  <UserPlus
                    size={18}
                    className="text-orange-600 dark:text-orange-400"
                  />{" "}
                  <span>Designar Trabalho</span>
                </div>
                <ChevronRight size={16} className="text-gray-400" />
              </button>
              <button
                onClick={() =>
                  navigate("/admin/fleet", { state: { activeTab: "hr" } })
                }
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-gray-50 dark:bg-[#1A1F26] active:bg-gray-50 dark:bg-[#1A1F26] transition-colors"
              >
                <div className="flex items-center gap-3 text-[13px] font-bold text-gray-800 dark:text-[#d4d4d8]">
                  <Users
                    size={18}
                    className="text-blue-600 dark:text-blue-400"
                  />{" "}
                  <span>Rh</span>
                </div>
                <ChevronRight size={16} className="text-gray-400" />
              </button>
            </div>
          </div>
        </div>

        {/* 3. Trabalhos Ativos (Sempre expandido) */}
        <div className="bg-white dark:bg-[#1A1F26] border text-gray-900 dark:text-[#fafafa] border-gray-200 dark:border-[#2A2F3A] rounded-xl overflow-hidden shadow-sm dark:shadow-none">
          <div className="w-full flex items-center justify-between p-3 bg-white dark:bg-[#1A1F26] border-b border-gray-100 dark:border-[#2A2F3A]">
            <span className="font-bold text-[15px]">
              Trabalhos Ativos{" "}
              <span className="text-gray-400 font-normal">
                ({filteredActiveJobsList.length})
              </span>
            </span>
            <div className="relative inline-flex items-center">
              <Filter
                size={14}
                className="absolute left-2 text-gray-500 dark:text-[#a1a1aa]"
              />
              <select
                className="pl-7 pr-6 py-1 text-[12px] font-medium bg-gray-50 dark:bg-[#1A1F26] border border-gray-200 dark:border-[#2A2F3A] rounded-lg text-gray-700 dark:text-[#a1a1aa] appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500/20 shadow-sm dark:shadow-none cursor-pointer"
                value={activeJobsFilter}
                onChange={(e) => setActiveJobsFilter(e.target.value as any)}
              >
                <option value="all">Em aberto</option>
                <option value="pending">Não iniciados</option>
                <option value="attention">Próximos do prazo</option>
                <option value="late">Vencidos</option>
              </select>
              <ChevronDown
                size={14}
                className="absolute right-2 text-gray-500 pointer-events-none"
              />
            </div>
          </div>
          <div>
            <div className="p-3 space-y-1.5 overflow-hidden">
              {filteredActiveJobsList.map((job) => {
                const isExpanded = expandedJobId === job.id;
                  const realProgress = getResolvedJobProgress(job);
                const progressPct =
                  Math.round(
                    (realProgress /
                      Math.max(1, job.contract!.totalDeliveries)) *
                      100,
                  ) || 0;
                const deliveriesLeft =
                  job.contract!.totalDeliveries - realProgress;
                const isOverdue = job.daysLeft < 0;

                const deadlineDate = new Date(job.deadlineDate);
                const diffMs = deadlineDate.getTime() - new Date().getTime();
                let timeRemainingText = "Contrato vencido";
                const hasValidDeadline = Boolean(job.deadlineDate);

                if (!hasValidDeadline) {
                  timeRemainingText = "Prazo não definido";
                } else if (diffMs > 0) {
                  const d = Math.floor(diffMs / (1000 * 60 * 60 * 24));
                  const h = Math.floor((diffMs / (1000 * 60 * 60)) % 24);
                  const m = Math.floor((diffMs / 1000 / 60) % 60);
                  timeRemainingText = `${d} dias • ${h}h • ${m}min`;
                }

                return (
                  <div
                    key={job.id}
                    className={cn(
                      "relative flex flex-col border rounded-[24px] transition-all overflow-hidden bg-white dark:bg-[#1A1F26]",
                      isExpanded
                        ? "border-blue-500 shadow-md dark:shadow-none ring-1 ring-blue-500/20"
                        : "border-gray-200 dark:border-[#2A2F3A] shadow-sm dark:shadow-none hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-md dark:shadow-none",
                    )}
                  >
                    <button
                      onClick={() =>
                        setExpandedJobId(isExpanded ? null : job.id)
                      }
                      className="w-full text-left p-3.5 sm:p-4 flex flex-col gap-3.5"
                    >
                      <div className="flex justify-between items-start w-full">
                          <div className="flex items-center gap-3 min-w-0 pr-4">
                            {resolveDriverPhoto(job.driver) || null ? (
                              <StableImage
                                src={resolveDriverPhoto(job.driver) || null}
                                alt={job.driver?.name}
                                loading="lazy"
                                decoding="async"
                                wrapperClassName="w-10 h-10 rounded-full shrink-0 border border-gray-100 dark:border-[#2A2F3A] bg-gray-50 dark:bg-[#1A1F26]"
                                className="object-cover"
                                referrerPolicy="no-referrer"
                                fallback={
                                  <span className="h-full w-full text-gray-600 dark:text-[#d4d4d8] flex items-center justify-center font-bold text-sm">
                                    {job.driver?.name?.substring(0, 2).toUpperCase() || "M"}
                                  </span>
                                }
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-full bg-gray-50 dark:bg-[#1A1F26] text-gray-600 dark:text-[#d4d4d8] flex items-center justify-center font-bold text-sm shrink-0 border border-gray-200 dark:border-[#2A2F3A]">
                                {job.driver?.name?.substring(0, 2).toUpperCase() || "M"}
                              </div>
                            )}
                            <div className="flex flex-col gap-0 min-w-0">
                              <h3 className="text-[15px] sm:text-[17px] font-semibold text-[#111827] dark:text-white leading-tight mb-0 truncate">
                                {formatDriverName(job.driver!.name)}
                              </h3>
                              <span className="text-[12px] font-medium text-[#6B7280] leading-tight truncate">
                                {job.contract!.name}
                              </span>
                            </div>
                          </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {/* Switch ON/OFF */}
                          <div
                            className="flex items-center gap-1 bg-gray-50 dark:bg-[#09090b] border border-[#E5E7EB] dark:border-[#2A2F3A] rounded-full px-[5px] py-[3px] cursor-default mt-1"
                            title={job.driver!.isOnline ? "Online" : "Offline"}
                          >
                            <span
                              className={cn(
                                "text-[8px] font-bold tracking-tight uppercase px-0.5",
                                job.driver!.isOnline
                                  ? "text-[#16A34A]"
                                  : "text-[#6B7280]",
                              )}
                            >
                              {job.driver!.isOnline ? "On" : "Off"}
                            </span>
                            <div className="relative inline-flex items-center shrink-0">
                              <div
                                className={cn(
                                  "w-[16px] h-[10px] rounded-full relative transition-colors",
                                  job.driver!.isOnline
                                    ? "bg-[#16A34A]"
                                    : "bg-gray-200 dark:bg-white/10",
                                )}
                              >
                                <div
                                  className={cn(
                                    "absolute top-[2px] transition-all bg-white dark:bg-[#09090b] rounded-full h-[6px] w-[6px]",
                                    job.driver!.isOnline
                                      ? "left-[8px]"
                                      : "left-[2px]",
                                  )}
                                ></div>
                              </div>
                            </div>
                          </div>
                          {/* Chevron */}
                          <div className="text-[#6B7280] dark:text-gray-400 mt-1 flex items-center justify-center -mr-1">
                            {isExpanded ? (
                              <ChevronUp size={16} strokeWidth={1.5} />
                            ) : (
                              <ChevronDown size={16} strokeWidth={1.5} />
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col items-start justify-start gap-1 text-[12px] text-[#6B7280] font-normal py-0">
                        {job.vehicle ? (
                          <div className="flex items-center gap-1.5">
                            <Truck size={12} strokeWidth={1.5} />
                            <span>{job.vehicle.name}</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <Truck size={12} strokeWidth={1.5} />
                            <span>S/ Veículo</span>
                          </div>
                        )}
                        {!job.trailerlessSimulator && (
                          job.trailer ? (
                            <div className="flex items-center gap-1.5">
                              <Package size={12} strokeWidth={1.5} />
                              <span className="break-words">
                                {job.trailer.name}
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <Package size={12} strokeWidth={1.5} />
                              <span>S/ Reboque</span>
                            </div>
                          )
                        )}
                      </div>

                      <div className="flex flex-col gap-2.5 w-full">
                        {/* Card progress */}
                        <div className="w-full shrink-0 border border-[#E5E7EB] dark:border-[#2A2F3A] bg-[#F9FAFB] dark:bg-[#1A1F26] rounded-[14px] py-3 px-2 flex flex-col gap-2">
                          <div className="grid grid-cols-3 relative">
                            <div className="flex flex-col items-center justify-center">
                              <div className="text-[18px] sm:text-[20px] font-semibold text-[#0cb49f] leading-none mb-1">
                                {realProgress}/{job.contract!.totalDeliveries}
                              </div>
                              <div className="text-[10px] sm:text-[11px] font-normal text-[#4B5563] dark:text-[#a1a1aa] leading-none text-center">
                                (Entregas)
                              </div>
                            </div>

                            <div className="absolute left-[33%] top-1 bottom-1 w-px bg-[#E5E7EB] dark:bg-[#2A2F3A]"></div>

                            <div className="flex flex-col items-center justify-center">
                              <div className="text-[18px] sm:text-[20px] font-semibold text-[#0cb49f] leading-none mb-1">
                                {deliveriesLeft}
                              </div>
                              <div className="text-[10px] sm:text-[11px] font-normal text-[#4B5563] dark:text-[#a1a1aa] leading-none text-center">
                                faltam
                              </div>
                            </div>

                            <div className="absolute left-[66%] top-1 bottom-1 w-px bg-[#E5E7EB] dark:bg-[#2A2F3A]"></div>

                            <div className="flex flex-col items-center justify-center">
                              <div className="text-[18px] sm:text-[20px] font-semibold text-[#0cb49f] leading-none mb-1">
                                {progressPct}%
                              </div>
                              <div className="text-[10px] sm:text-[11px] font-normal text-[#4B5563] dark:text-[#a1a1aa] leading-none text-center">
                                concluído
                              </div>
                            </div>
                          </div>

                          <div className="px-4 mt-0.5">
                            <div className="w-full bg-[#E5E7EB] dark:bg-[#27272a] rounded-full h-[4px] overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-500 bg-[#0cb49f]"
                                style={{
                                  width: `${Math.max(3, progressPct)}%`,
                                }}
                              ></div>
                            </div>
                          </div>
                        </div>

                        {/* Prazo e Tempo Restante */}
                        <div className="flex items-center justify-between border-t border-gray-100 dark:border-[#2A2F3A] mt-2 pt-2 px-1 w-full shrink-0">
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none">
                              Prazo limite
                            </span>
                            <span className="text-[12px] sm:text-[13px] font-medium text-gray-900 dark:text-[#fafafa] flex items-center gap-1.5">
                              <Calendar
                                size={13}
                                className="text-gray-400 shrink-0"
                              />
                              <span className="truncate">
                                {hasValidDeadline
                                  ? format(deadlineDate, "dd/MM/yyyy")
                                  : "Prazo não definido"}
                              </span>
                            </span>
                          </div>
                          <div className="flex flex-col gap-1.5 items-end">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none">
                              Tempo restante
                            </span>
                            <span className="text-[12px] sm:text-[13px] font-medium text-gray-900 dark:text-[#fafafa] flex items-center gap-1.5">
                              <Clock
                                size={13}
                                className="text-gray-400 shrink-0"
                              />
                              <span
                                className={cn(
                                  "truncate",
                                  isOverdue && job.status === "active"
                                    ? "text-red-500 font-bold"
                                    : "",
                                )}
                              >
                                {timeRemainingText}
                              </span>
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="border-t border-gray-100 dark:border-[#2A2F3A] bg-gray-50 dark:bg-[#1A1F26] p-3 sm:p-4 flex flex-col gap-3">
                        {/* Contract Card Match */}
                        <div
                          className="hidden sm:block bg-white dark:bg-[#1A1F26] rounded-2xl border border-gray-200 dark:border-[#2A2F3A]/80 shadow-sm dark:shadow-none relative px-4 py-3 sm:p-4 hover:border-gray-300 dark:hover:border-[#52525b] transition-colors cursor-pointer group"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/admin/contract/${job.contract!.id}`);
                          }}
                        >
                          <div className="flex justify-between items-start mb-2">
                            <div className="pr-8">
                              <h3 className="font-bold text-gray-900 dark:text-[#fafafa] text-[14px] sm:text-[15px] leading-tight mb-1 line-clamp-2">
                                {job.contract!.name}
                              </h3>
                              {!job.trailerlessSimulator && (
                                <p className="text-[12px] font-medium text-gray-500 dark:text-[#a1a1aa] truncate flex items-center gap-1.5">
                                  <Truck size={12} className="text-gray-400" />
                                  {job.trailer
                                    ? job.trailer.name
                                    : "Qualquer reboque"}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 text-[12px] font-semibold text-gray-900 dark:text-[#fafafa] bg-gray-50 dark:bg-[#1A1F26]/80 p-2 rounded-lg border border-gray-100 dark:border-[#2A2F3A]">
                            <span>
                              {job.contract!.totalDeliveries} entregas
                            </span>
                            <span className="text-gray-300">•</span>
                            <span>{job.contract!.deadlineDays} dias</span>
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/admin/driver/${job.driver!.id}`, {
                                state: {
                                  returnUrl: "/admin/fleet",
                                  returnState: { activeTab: "operations" },
                                  companyId: job.companyId || activeCompanyId,
                                },
                              });
                            }}
                            className="flex-1 h-9 text-[12px] font-semibold text-gray-700 dark:text-[#d4d4d8] bg-white dark:bg-[#1A1F26] hover:bg-gray-50 dark:hover:bg-[#3f3f46] border border-gray-200 dark:border-[#2A2F3A] shadow-sm dark:shadow-none rounded-xl"
                          >
                            <User size={14} className="mr-1.5" /> Perfil
                          </Button>

                          {job.status !== "completed" &&
                            job.status !== "cancelled" && (
                              <Button
                                className="flex-1 h-9 px-4 text-[12px] font-semibold text-red-600 bg-white dark:bg-[#1A1F26] hover:bg-red-50 dark:bg-red-500/10 dark:border-red-500/20 border border-red-200 shadow-sm dark:shadow-none rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
                                disabled={cancelingJobId === job.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setJobToCancel(job.id);
                                }}
                              >
                                {cancelingJobId === job.id
                                  ? "Cancelando..."
                                  : "Cancelar"}
                              </Button>
                            )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* 4. Desempenho da Rede (Sempre expandido) */}
        <div className="bg-white dark:bg-[#1A1F26] border text-gray-900 dark:text-[#fafafa] border-gray-200 dark:border-[#2A2F3A] rounded-xl overflow-hidden shadow-sm dark:shadow-none">
          <div className="w-full flex items-center justify-between p-3 bg-white dark:bg-[#1A1F26] border-b border-gray-100 dark:border-[#2A2F3A]">
            <span className="font-bold text-[15px]">Desempenho da Rede</span>
          </div>
          <div>
            <div className="p-4 space-y-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full bg-gray-300 dark:bg-[#52525b]"></div>
                  <span className="text-[13px] font-bold text-gray-700 dark:text-[#d4d4d8]">
                    Não iniciados
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-[13px]">{pendingJobs}</span>
                  <span className="text-gray-400 text-[11px] w-7 text-right">
                    {Math.round((pendingJobs / totalActiveList) * 100)}%
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full bg-blue-50 dark:bg-blue-500/100"></div>
                  <span className="text-[13px] font-bold text-gray-700 dark:text-[#d4d4d8]">
                    Em andamento
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-[13px]">
                    {inProgressJobs}
                  </span>
                  <span className="text-gray-400 text-[11px] w-7 text-right">
                    {Math.round((inProgressJobs / totalActiveList) * 100)}%
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full bg-orange-500"></div>
                  <span className="text-[13px] font-bold text-gray-700 dark:text-[#d4d4d8]">
                    Próximos do prazo
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-[13px]">{warningJobs}</span>
                  <span className="text-gray-400 text-[11px] w-7 text-right">
                    {Math.round((warningJobs / totalActiveList) * 100)}%
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full bg-rose-500"></div>
                  <span className="text-[13px] font-bold text-gray-700 dark:text-[#d4d4d8]">
                    Vencidos
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-[13px]">{delayedJobs}</span>
                  <span className="text-gray-400 text-[11px] w-7 text-right">
                    {Math.round((delayedJobs / totalActiveList) * 100)}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* --- DESKTOP DASHBOARD (Hidden on mobile) --- */}
      <div className="hidden md:block space-y-6">
        {/* Quick Actions (White Card background) */}
        <Card className="rounded-2xl border-none shadow-sm dark:shadow-none">
          <CardContent className="p-6">
            <h2 className="text-base font-bold text-gray-900 dark:text-[#fafafa] mb-4">
              Ações Rápidas
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <button
                onClick={() =>
                  navigate("/admin/fleet", {
                    state: { activeTab: "contracts" },
                  })
                }
                className="flex items-center justify-between p-4 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:bg-indigo-500/20 transition-colors text-left group"
              >
                <div className="flex items-center gap-4">
                  <div className="text-indigo-600 dark:text-indigo-400">
                    <FileText size={24} strokeWidth={1.5} />
                  </div>
                  <div>
                    <p className="font-bold text-gray-900 dark:text-[#fafafa] text-sm">
                      1. Operações
                    </p>
                    <p className="text-[11px] text-gray-500 dark:text-[#a1a1aa]">
                      Abrir seção de operações
                    </p>
                  </div>
                </div>
                <div className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center">
                  <ArrowRight size={14} />
                </div>
              </button>

              <button
                onClick={() => navigate("/admin/assign")}
                className="flex items-center justify-between p-4 rounded-xl bg-orange-50 dark:bg-orange-500/10 hover:bg-orange-100 dark:bg-orange-500/20 transition-colors text-left group"
              >
                <div className="flex items-center gap-4">
                  <div className="text-orange-600 dark:text-orange-400">
                    <UserPlus size={24} strokeWidth={1.5} />
                  </div>
                  <div>
                    <p className="font-bold text-gray-900 dark:text-[#fafafa] text-sm">
                      2. Designar
                    </p>
                    <p className="text-[11px] text-gray-500 dark:text-[#a1a1aa]">
                      Designar trabalho para motorista
                    </p>
                  </div>
                </div>
                <div className="w-6 h-6 rounded-full bg-orange-500 text-white flex items-center justify-center">
                  <ArrowRight size={14} />
                </div>
              </button>

              <button
                onClick={() =>
                  navigate("/admin/fleet", { state: { activeTab: "hr" } })
                }
                className="flex items-center justify-between p-4 rounded-xl bg-blue-50 dark:bg-blue-500/10 dark:border-blue-500/20 hover:bg-blue-100 dark:bg-blue-500/20 transition-colors text-left group"
              >
                <div className="flex items-center gap-4">
                  <div className="text-blue-600 dark:text-blue-400">
                    <Users size={24} strokeWidth={1.5} />
                  </div>
                  <div>
                    <p className="font-bold text-gray-900 dark:text-[#fafafa] text-sm">
                      3. Rh
                    </p>
                    <p className="text-[11px] text-gray-500 dark:text-[#a1a1aa]">
                      Recursos Humanos
                    </p>
                  </div>
                </div>
                <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center">
                  <ArrowRight size={14} />
                </div>
              </button>
            </div>
          </CardContent>
        </Card>

        {/* Resumo Operacional Card (Desktop) */}
        <Card className="rounded-2xl border-none shadow-sm dark:shadow-none bg-white dark:bg-[#1A1F26] border-gray-200 dark:border-[#2A2F3A] overflow-visible">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex flex-col text-left">
                <h2 className="text-base font-bold text-gray-900 dark:text-[#fafafa]">
                  Resumo Operacional
                </h2>
                <span className="text-[12px] text-gray-500 dark:text-[#a1a1aa] font-medium">
                  Em tempo real
                </span>
              </div>

              <div className="flex items-center bg-slate-100 dark:bg-[#2A2F3A] rounded-lg p-1">
                <button
                  onClick={() => setResumoPeriod("semana")}
                  className={cn(
                    "px-3 py-1.5 text-[12px] font-bold rounded-md transition-colors",
                    resumoPeriod === "semana"
                      ? "bg-white dark:bg-[#3A3F4A] text-slate-900 dark:text-white shadow-sm"
                      : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200",
                  )}
                >
                  Semana
                </button>
                <button
                  onClick={() => setResumoPeriod("mensal")}
                  className={cn(
                    "px-3 py-1.5 text-[12px] font-bold rounded-md transition-colors",
                    resumoPeriod === "mensal"
                      ? "bg-white dark:bg-[#3A3F4A] text-slate-900 dark:text-white shadow-sm"
                      : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200",
                  )}
                >
                  Mensal
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div
                className="bg-gray-50 dark:bg-[#1A1F26] rounded-xl p-4 flex flex-col justify-between border border-gray-100 dark:border-[#2A2F3A] h-[90px] cursor-pointer hover:bg-gray-100 dark:hover:bg-[#2A2F3A] transition-colors"
                onClick={() => setIsDriversModalOpen(true)}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-[12px] text-gray-500 dark:text-[#a1a1aa] font-bold uppercase tracking-wider leading-none">
                    Motoristas
                  </span>
                  <ChevronRight size={14} className="text-gray-400" />
                </div>
                <div className="flex items-baseline gap-1.5 mt-auto">
                  <span className="text-[24px] font-bold text-gray-900 dark:text-[#fafafa] leading-none">
                    {driversWithOperation.length}{" "}
                    <span className="text-[14px] font-medium text-gray-400">
                      / {drivers.length}
                    </span>
                  </span>
                  <span className="text-[12px] text-gray-400 leading-none">
                    Com operação
                  </span>
                </div>
              </div>
              <div className="bg-gray-50 dark:bg-[#1A1F26] rounded-xl p-4 flex flex-col justify-between border border-gray-100 dark:border-[#2A2F3A] h-[90px]">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[12px] text-gray-500 dark:text-[#a1a1aa] font-bold uppercase tracking-wider leading-none">
                    Ganhos
                  </span>
                  <span className="text-[11px] text-gray-400 leading-none">
                    Acumulado
                  </span>
                </div>
                <div className="flex items-baseline gap-1.5 mt-auto">
                  <span className="text-[17px] xl:text-[19px] tracking-tight font-bold text-gray-900 dark:text-[#fafafa] leading-none shrink-0">
                    {formatCurrency(totalGanhos)}
                  </span>
                </div>
              </div>
              <div className="bg-gray-50 dark:bg-[#1A1F26] rounded-xl p-4 flex flex-col justify-between border border-gray-100 dark:border-[#2A2F3A] h-[90px]">
                <span className="text-[12px] text-gray-500 dark:text-[#a1a1aa] font-bold uppercase tracking-wider leading-none">
                  Viagens Realizadas
                </span>
                <div className="flex items-baseline gap-1.5 mt-auto">
                  <span className="text-[24px] font-bold text-gray-900 dark:text-[#fafafa] leading-none">
                    {resumoTrips.length}
                  </span>
                  <span className="text-[12px] text-gray-400 leading-none">
                    Concluídas
                  </span>
                </div>
              </div>
              <div className="bg-gray-50 dark:bg-[#1A1F26] rounded-xl p-4 flex flex-col justify-between border border-gray-100 dark:border-[#2A2F3A] h-[90px]">
                <span className="text-[12px] text-gray-500 dark:text-[#a1a1aa] font-bold uppercase tracking-wider leading-none">
                  Meta de Entregas
                </span>
                <div className="flex items-baseline gap-1.5 mt-auto">
                  <span className="text-[24px] font-bold text-gray-900 dark:text-[#fafafa] leading-none">
                    {Math.max(
                      0,
                      summaryActiveRequired - summaryActiveCompleted,
                    )}
                  </span>
                  <span className="text-[12px] text-gray-400 leading-none">
                    {Math.max(
                      0,
                      summaryActiveRequired - summaryActiveCompleted,
                    ) === 0
                      ? "Concluída"
                      : "Restantes"}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Status Operacional Card (Desktop) */}
        <DesempenhoOperacionalCard
          metrics={desempenhoMetrics}
          className="mb-6 w-full"
          periodPreset={desempenhoPeriod}
          setPeriodPreset={setDesempenhoPeriod}
        />

        {/* Main Bottom Grid */}
        <div className="flex flex-col gap-6">
          {/* Active Jobs List */}
          <div className="space-y-4">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-base font-bold text-gray-900 dark:text-[#fafafa]">
                Trabalhos Ativos{" "}
                <span className="text-gray-400 font-normal">
                  ({filteredActiveJobsList.length})
                </span>
              </h2>
              <div className="flex items-center gap-3">
                <div className="relative inline-flex items-center hidden sm:inline-flex">
                  <Filter
                    size={14}
                    className="absolute left-2 text-gray-500 dark:text-[#a1a1aa]"
                  />
                  <select
                    className="pl-7 pr-6 py-1 text-[12px] font-medium bg-gray-50 dark:bg-[#1A1F26] border border-gray-200 dark:border-[#2A2F3A] rounded-lg text-gray-700 dark:text-[#a1a1aa] appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500/20 shadow-sm dark:shadow-none cursor-pointer"
                    value={activeJobsFilter}
                    onChange={(e) => setActiveJobsFilter(e.target.value as any)}
                  >
                    <option value="all">Em aberto</option>
                    <option value="pending">Não iniciados</option>
                    <option value="attention">Próximos do prazo</option>
                    <option value="late">Vencidos</option>
                  </select>
                  <ChevronDown
                    size={14}
                    className="absolute right-2 text-gray-500 pointer-events-none"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {filteredActiveJobsList.length === 0 ? (
                <div className="bg-white dark:bg-[#1A1F26] border border-gray-200 dark:border-[#2A2F3A] border-dashed rounded-2xl p-10 text-center">
                  <p className="text-gray-500 dark:text-[#a1a1aa] font-medium">
                    Nenhum trabalho ativo no momento.
                  </p>
                </div>
              ) : (
                filteredActiveJobsList.map((job) => {
                  const isExpanded = expandedJobId === job.id;
                  const realProgress = getResolvedJobProgress(job);
                  const progressPct =
                    Math.round(
                      (realProgress /
                        Math.max(1, job.contract!.totalDeliveries)) *
                        100,
                    ) || 0;
                  const deliveriesLeft =
                    job.contract!.totalDeliveries - realProgress;
                  const isOverdue = job.daysLeft < 0;

                  const deadlineDate = new Date(job.deadlineDate);
                  const diffMs = deadlineDate.getTime() - new Date().getTime();
                  let timeRemainingText = "Contrato vencido";
                  const hasValidDeadline = Boolean(job.deadlineDate);

                  if (!hasValidDeadline) {
                    timeRemainingText = "Prazo não definido";
                  } else if (diffMs > 0) {
                    const d = Math.floor(diffMs / (1000 * 60 * 60 * 24));
                    const h = Math.floor((diffMs / (1000 * 60 * 60)) % 24);
                    const m = Math.floor((diffMs / 1000 / 60) % 60);
                    timeRemainingText = `${d} dias • ${h}h • ${m}min`;
                  }

                  return (
                    <div
                      key={job.id}
                      className={cn(
                        "relative flex flex-col border rounded-[24px] transition-all overflow-hidden bg-white dark:bg-[#1A1F26]",
                        isExpanded
                          ? "border-blue-500 shadow-md dark:shadow-none ring-1 ring-blue-500/20"
                          : "border-gray-200 dark:border-[#2A2F3A] shadow-sm dark:shadow-none hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-md dark:shadow-none",
                      )}
                    >
                      <button
                        onClick={() =>
                          setExpandedJobId(isExpanded ? null : job.id)
                        }
                        className="w-full text-left p-4 sm:p-5 flex flex-col gap-4"
                      >
                        <div className="flex justify-between items-start w-full">
                          <div className="flex items-center gap-3 min-w-0 pr-4">
                            {resolveDriverPhoto(job.driver) || null ? (
                              <StableImage
                                src={resolveDriverPhoto(job.driver) || null}
                                alt={job.driver?.name}
                                loading="lazy"
                                decoding="async"
                                wrapperClassName="w-10 h-10 rounded-full shrink-0 border border-gray-100 dark:border-[#2A2F3A] bg-gray-50 dark:bg-[#1A1F26]"
                                className="object-cover"
                                referrerPolicy="no-referrer"
                                fallback={
                                  <span className="h-full w-full text-gray-600 dark:text-[#d4d4d8] flex items-center justify-center font-bold text-sm">
                                    {job.driver?.name?.substring(0, 2).toUpperCase() || "M"}
                                  </span>
                                }
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-full bg-gray-50 dark:bg-[#1A1F26] text-gray-600 dark:text-[#d4d4d8] flex items-center justify-center font-bold text-sm shrink-0 border border-gray-200 dark:border-[#2A2F3A]">
                                {job.driver?.name?.substring(0, 2).toUpperCase() || "M"}
                              </div>
                            )}
                            <div className="flex flex-col gap-0 min-w-0">
                              <h3 className="text-[15px] sm:text-[17px] font-semibold text-[#111827] dark:text-white leading-tight mb-0 truncate">
                                {formatDriverName(job.driver!.name)}
                              </h3>
                              <span className="text-[12px] font-medium text-[#6B7280] leading-tight truncate">
                                {job.contract!.name}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {/* Switch ON/OFF */}
                            <div
                              className="flex items-center gap-1 bg-gray-50 dark:bg-[#09090b] border border-[#E5E7EB] dark:border-[#2A2F3A] rounded-full px-[5px] py-[3px] cursor-default mt-1"
                              title={
                                job.driver!.isOnline ? "Online" : "Offline"
                              }
                            >
                              <span
                                className={cn(
                                  "text-[8px] font-bold tracking-tight uppercase px-0.5",
                                  job.driver!.isOnline
                                    ? "text-[#16A34A]"
                                    : "text-[#6B7280]",
                                )}
                              >
                                {job.driver!.isOnline ? "On" : "Off"}
                              </span>
                              <div className="relative inline-flex items-center shrink-0">
                                <div
                                  className={cn(
                                    "w-[16px] h-[10px] rounded-full relative transition-colors",
                                    job.driver!.isOnline
                                      ? "bg-[#16A34A]"
                                      : "bg-gray-200 dark:bg-white/10",
                                  )}
                                >
                                  <div
                                    className={cn(
                                      "absolute top-[2px] transition-all bg-white dark:bg-[#09090b] rounded-full h-[6px] w-[6px]",
                                      job.driver!.isOnline
                                        ? "left-[8px]"
                                        : "left-[2px]",
                                    )}
                                  ></div>
                                </div>
                              </div>
                            </div>
                            {/* Chevron */}
                            <div className="text-[#6B7280] dark:text-gray-400 mt-1 flex items-center justify-center -mr-1">
                              {isExpanded ? (
                                <ChevronUp size={16} strokeWidth={1.5} />
                              ) : (
                                <ChevronDown size={16} strokeWidth={1.5} />
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-col items-start justify-start gap-1 text-[12px] text-[#6B7280] font-normal py-0">
                          {job.vehicle ? (
                            <div className="flex items-center gap-1.5">
                              <Truck size={12} strokeWidth={1.5} />
                              <span>{job.vehicle.name}</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <Truck size={12} strokeWidth={1.5} />
                              <span>S/ Veículo</span>
                            </div>
                          )}
                          {job.trailer ? (
                            <div className="flex items-center gap-1.5">
                              <Package size={12} strokeWidth={1.5} />
                              <span className="break-words">
                                {job.trailer.name}
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <Package size={12} strokeWidth={1.5} />
                              <span>S/ Reboque</span>
                            </div>
                          )}
                        </div>

                        <div className="flex flex-col gap-2.5 w-full">
                          {/* Card progress */}
                          <div className="w-full shrink-0 border border-[#E5E7EB] dark:border-[#2A2F3A] bg-[#F9FAFB] dark:bg-[#1A1F26] rounded-[14px] py-3 px-2 flex flex-col gap-2">
                            <div className="grid grid-cols-3 relative">
                              <div className="flex flex-col items-center justify-center">
                                <div className="text-[18px] sm:text-[20px] font-semibold text-[#0cb49f] leading-none mb-1">
                                  {realProgress}/{job.contract!.totalDeliveries}
                                </div>
                                <div className="text-[10px] sm:text-[11px] font-normal text-[#4B5563] dark:text-[#a1a1aa] leading-none text-center">
                                  (Entregas)
                                </div>
                              </div>

                              <div className="absolute left-[33%] top-1 bottom-1 w-px bg-[#E5E7EB] dark:bg-[#2A2F3A]"></div>

                              <div className="flex flex-col items-center justify-center">
                                <div className="text-[18px] sm:text-[20px] font-semibold text-[#0cb49f] leading-none mb-1">
                                  {deliveriesLeft}
                                </div>
                                <div className="text-[10px] sm:text-[11px] font-normal text-[#4B5563] dark:text-[#a1a1aa] leading-none text-center">
                                  faltam
                                </div>
                              </div>

                              <div className="absolute left-[66%] top-1 bottom-1 w-px bg-[#E5E7EB] dark:bg-[#2A2F3A]"></div>

                              <div className="flex flex-col items-center justify-center">
                                <div className="text-[18px] sm:text-[20px] font-semibold text-[#0cb49f] leading-none mb-1">
                                  {progressPct}%
                                </div>
                                <div className="text-[10px] sm:text-[11px] font-normal text-[#4B5563] dark:text-[#a1a1aa] leading-none text-center">
                                  concluído
                                </div>
                              </div>
                            </div>

                            <div className="px-4 mt-0.5">
                              <div className="w-full bg-[#E5E7EB] dark:bg-[#27272a] rounded-full h-[4px] overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all duration-500 bg-[#0cb49f]"
                                  style={{
                                    width: `${Math.max(3, progressPct)}%`,
                                  }}
                                ></div>
                              </div>
                            </div>
                          </div>

                          {/* Prazo e Tempo Restante */}
                          <div className="flex items-center justify-between border-t border-gray-100 dark:border-[#2A2F3A] mt-2 pt-2 px-1 w-full shrink-0">
                            <div className="flex flex-col gap-1.5">
                              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none">
                                Prazo limite
                              </span>
                              <span className="text-[12px] sm:text-[13px] font-medium text-gray-900 dark:text-[#fafafa] flex items-center gap-1.5">
                                <Calendar
                                  size={13}
                                  className="text-gray-400 shrink-0"
                                />
                                <span className="truncate">
                                  {hasValidDeadline
                                    ? format(deadlineDate, "dd/MM/yyyy")
                                    : "Prazo não definido"}
                                </span>
                              </span>
                            </div>
                            <div className="flex flex-col gap-1.5 items-end">
                              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none">
                                Tempo restante
                              </span>
                              <span className="text-[12px] sm:text-[13px] font-medium text-gray-900 dark:text-[#fafafa] flex items-center gap-1.5">
                                <Clock
                                  size={13}
                                  className="text-gray-400 shrink-0"
                                />
                                <span
                                  className={cn(
                                    "truncate",
                                    isOverdue && job.status === "active"
                                      ? "text-red-500 font-bold"
                                      : "",
                                  )}
                                >
                                  {timeRemainingText}
                                </span>
                              </span>
                            </div>
                          </div>
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="border-t border-gray-100 dark:border-[#2A2F3A] bg-gray-50 dark:bg-[#1A1F26] p-3 sm:p-4 flex gap-2">
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/admin/driver/${job.driver!.id}`, {
                                state: {
                                  returnUrl: "/admin/fleet",
                                  returnState: { activeTab: "operations" },
                                  companyId: job.companyId || activeCompanyId,
                                },
                              });
                            }}
                            className="flex-1 h-9 text-[12px] font-semibold text-gray-700 dark:text-[#d4d4d8] bg-white dark:bg-[#1A1F26] hover:bg-gray-50 dark:hover:bg-[#3f3f46] border border-gray-200 dark:border-[#2A2F3A] shadow-sm dark:shadow-none rounded-xl"
                          >
                            <User size={14} className="mr-1.5" /> Perfil
                          </Button>

                          {job.status !== "completed" &&
                            job.status !== "cancelled" && (
                              <Button
                                className="flex-1 h-9 px-4 text-[12px] font-semibold text-red-600 bg-white dark:bg-[#1A1F26] hover:bg-red-50 dark:bg-red-500/10 dark:border-red-500/20 border border-red-200 shadow-sm dark:shadow-none rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
                                disabled={cancelingJobId === job.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setJobToCancel(job.id);
                                }}
                              >
                                {cancelingJobId === job.id
                                  ? "Cancelando..."
                                  : "Cancelar"}
                              </Button>
                            )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
      {/* --- END DESKTOP DASHBOARD --- */}

      {jobToCancel &&
        createPortal(
          <div
            style={{ zIndex: Z_INDEX.modalBackdrop }}
            className="fixed inset-0 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-200"
          >
            <div
              style={{ zIndex: Z_INDEX.modal }}
              className="bg-white dark:bg-[#1A1F26] rounded-2xl shadow-xl w-full max-w-[320px] p-6 flex flex-col items-center text-center"
            >
              <div className="w-12 h-12 bg-red-100 dark:bg-red-500/20 text-red-600 rounded-full flex items-center justify-center mb-4">
                <AlertTriangle size={24} />
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-[#fafafa] mb-2">
                Cancelar Contrato?
              </h3>
              <p className="text-[13px] text-gray-500 dark:text-[#a1a1aa] mb-6">
                Este contrato será cancelado e o motorista perderá o acesso de
                sua finalização.
              </p>
              <div className="flex items-center gap-3 w-full">
                <Button
                  variant="outline"
                  className="flex-1 h-10 border-gray-200 dark:border-[#2A2F3A] hover:bg-gray-50 dark:hover:bg-[#3f3f46] text-gray-700 dark:text-[#d4d4d8] font-semibold text-[13px]"
                  onClick={() => setJobToCancel(null)}
                >
                  Voltar
                </Button>
                <Button
                  className="flex-1 h-10 bg-red-600 hover:bg-red-700 text-white font-semibold text-[13px]"
                  disabled={cancelingJobId === jobToCancel}
                  onClick={() => {
                    setCancelingJobId(jobToCancel);
                    cancelJob(jobToCancel).finally(() => {
                      setCancelingJobId(null);
                      setJobToCancel(null);
                      setExpandedJobId(null);
                    });
                  }}
                >
                  {cancelingJobId === jobToCancel
                    ? "Cancelando..."
                    : "Cancelar"}
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {isDriversModalOpen &&
        createPortal(
          <div
            style={{ zIndex: Z_INDEX.modalBackdrop }}
            className="fixed inset-0 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={() => setIsDriversModalOpen(false)}
          >
            <div
              style={{ zIndex: Z_INDEX.modal }}
              className="bg-white dark:bg-[#1C2128] rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-[85vh] border border-gray-100 dark:border-[#2A2F3A] relative"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 bg-white dark:bg-[#1A1F26] border-b border-gray-100 dark:border-[#2A2F3A] shrink-0">
                <div>
                  <h3 className="text-[16px] font-bold text-gray-900 dark:text-[#fafafa]">
                    Status dos Motoristas
                  </h3>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className="text-[11px] font-bold text-gray-600 dark:text-[#a1a1aa] bg-gray-100 dark:bg-[#2A2F3A] px-2 py-0.5 rounded text-center leading-tight">
                      Total: {drivers.length}
                    </span>
                    <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 px-2 py-0.5 rounded text-center leading-tight">
                      Com operação: {driversWithOperation.length}/{drivers.length}
                    </span>
                    <span className="text-[11px] font-bold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-[#2A2F3A] border border-gray-200 dark:border-gray-600 px-2 py-0.5 rounded text-center leading-tight">
                      Sem operação: {driversWithoutOperation.length}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setIsDriversModalOpen(false)}
                  className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-[#fafafa] hover:bg-gray-100 dark:hover:bg-[#2A2F3A] rounded-full transition-colors self-start"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="overflow-y-auto w-full flex-1 p-4 flex flex-col gap-6 bg-gray-50/50 dark:bg-[#15191E]">
                {driversWithoutOperation.length > 0 && (
                  <div>
                    <h4 className="flex items-center gap-2 text-[12px] font-bold text-gray-500 dark:text-[#a1a1aa] uppercase tracking-wider mb-2.5 px-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                      Motoristas sem operação
                    </h4>
                    <div className="space-y-2">
                      {driversWithoutOperation.map((user) => {
                        const isAvailable = Boolean(user.isOnline);

                        return (
                          <div
                            key={user.id}
                            className="flex items-center gap-3 p-2.5 rounded-xl bg-white dark:bg-[#1A1F26] border border-gray-100 dark:border-[#2A2F3A] shadow-sm dark:shadow-none hover:border-gray-200 dark:hover:border-gray-600 transition-colors"
                          >
                            <StableImage
                              src={resolveDriverPhoto(user) || null}
                              alt={user.name}
                              loading="eager"
                              decoding="async"
                              wrapperClassName={cn(
                                "w-10 h-10 rounded-full shrink-0",
                                isAvailable
                                  ? "bg-green-50 dark:bg-green-900/20"
                                  : "bg-gray-100 dark:bg-gray-800",
                              )}
                              className="object-cover"
                              fallback={
                                <span
                                  className={cn(
                                    "h-full w-full flex items-center justify-center",
                                    isAvailable
                                      ? "bg-green-50 dark:bg-green-900/20"
                                      : "bg-gray-100 dark:bg-gray-800",
                                  )}
                                >
                                  <User
                                    size={18}
                                    className={
                                      isAvailable
                                        ? "text-green-500 dark:text-green-400"
                                        : "text-gray-400 dark:text-gray-500"
                                    }
                                  />
                                </span>
                              }
                            />
                            <div className="flex-1 min-w-0 flex flex-col justify-center">
                              <p className="text-[14px] font-bold text-gray-900 dark:text-[#fafafa] truncate leading-tight">
                                {user.name}
                              </p>
                              <div className="flex items-center gap-1.5 mt-1">
                                <span
                                  className={cn(
                                    "text-[10px] font-bold border px-1.5 py-0.5 rounded truncate",
                                    isAvailable
                                      ? "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/10 border-green-100 dark:border-green-500/20"
                                      : "text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-500/10 border-gray-200 dark:border-gray-500/20",
                                  )}
                                >
                                  {isAvailable ? "DISPONÍVEL" : "INDISPONÍVEL"}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {driversWithOperation.length > 0 && (
                  <div>
                    <h4 className="flex items-center gap-2 text-[12px] font-bold text-gray-500 dark:text-[#a1a1aa] uppercase tracking-wider mb-2.5 px-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                      Motoristas com operação
                    </h4>
                    <div className="space-y-2">
                      {driversWithOperation.map(({ user, job }) => {
                        const isWaiting = job.status === "pending";

                        return (
                          <div
                            key={user.id}
                            className="flex items-center gap-3 p-2.5 rounded-xl bg-white dark:bg-[#1A1F26] border border-gray-100 dark:border-[#2A2F3A] shadow-sm dark:shadow-none hover:border-gray-200 dark:hover:border-gray-600 transition-colors"
                          >
                            <StableImage
                              src={resolveDriverPhoto(user) || null}
                              alt={user.name}
                              loading="eager"
                              decoding="async"
                              wrapperClassName={cn(
                                "w-10 h-10 rounded-full shrink-0",
                                isWaiting
                                  ? "bg-amber-50 dark:bg-amber-900/20"
                                  : "bg-blue-50 dark:bg-blue-900/20",
                              )}
                              className="object-cover"
                              fallback={
                                <span
                                  className={cn(
                                    "h-full w-full flex items-center justify-center",
                                    isWaiting
                                      ? "bg-amber-50 dark:bg-amber-900/20"
                                      : "bg-blue-50 dark:bg-blue-900/20",
                                  )}
                                >
                                  <User
                                    size={18}
                                    className={
                                      isWaiting
                                        ? "text-amber-500 dark:text-amber-400"
                                        : "text-blue-500 dark:text-blue-400"
                                    }
                                  />
                                </span>
                              }
                            />
                            <div className="flex-1 min-w-0 flex flex-col justify-center">
                              <p className="text-[14px] font-bold text-gray-900 dark:text-[#fafafa] truncate leading-tight">
                                {user.name}
                              </p>
                              <div className="flex items-center gap-1.5 mt-1">
                                <span
                                  className={cn(
                                    "text-[10px] font-bold border px-1.5 py-0.5 rounded truncate max-w-full",
                                    isWaiting
                                      ? "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border-amber-100 dark:border-amber-500/20"
                                      : "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 border-blue-100 dark:border-blue-500/20",
                                  )}
                                >
                                  {isWaiting
                                    ? "AGUARDANDO"
                                    : "OPERAÇÃO ATIVA"}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {drivers.length === 0 && (
                  <div className="flex flex-col items-center justify-center p-8 text-center text-gray-400 dark:text-gray-500 my-auto">
                    <Users size={32} className="mb-3 opacity-50" />
                    <p className="text-[13px] font-medium">
                      Nenhum motorista na rede.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

export default React.memo(OperationsTab);
