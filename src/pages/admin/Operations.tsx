import React, { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useActivityStore, useOperationalStore, useSessionStore } from "../../context/AppContext";
import { useCompanyStore } from "../../context/CompanyContext";
import { Button } from "../../components/ui/Button";
import {
  Plus,
  Search,
  PlayCircle,
  Clock,
  CheckCircle2,
  AlertTriangle,
  X,
  ArrowRight,
  PackageOpen,
  User,
  Trash2,
  Star,
  Briefcase,
  ChevronDown,
  ChevronUp,
  Truck,
  Car,
} from "lucide-react";
import { differenceInDays, format } from "date-fns";
import { cn, getJobRealTimestamp } from "../../lib/utils";
import { isTrailerlessSimulator } from "../../lib/resolveSimulator";
import { useTripHistory } from "../../hooks/useTripHistory";

type StatusFilter = "all" | "ongoing" | "active" | "delayed" | "completed";

export default function Operations() {
  const location = useLocation();
  const navigate = useNavigate();
  const { companies, activeCompanyId } = useCompanyStore();
  const {
    jobs,
    contracts,
    users,
    vehicles,
    trailers,
    simulators,
    cancelJob,
    deleteJob,
    rejectJobDemand,
  } = useOperationalStore();
  const { jobDemands } = useActivityStore();
  const { currentUser } = useSessionStore();
  const { historicoTrips = [] } = useTripHistory(activeCompanyId, {
    userId: currentUser?.id,
  });

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ongoing");
  const [search, setSearch] = useState("");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [preselectedDriverId, setPreselectedDriverId] = useState<string | null>(
    null,
  );
  const [preselectedContractId, setPreselectedContractId] = useState<
    string | null
  >(null);
  const [cancelingJobId, setCancelingJobId] = useState<string | null>(null);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);

  useEffect(() => {
    let shouldClear = false;
    if (location.state?.filter) {
      setStatusFilter(location.state.filter as StatusFilter);
      shouldClear = true;
    }

    if (location.state?.preselectedJobId) {
      setSelectedJobId(location.state.preselectedJobId);
      shouldClear = true;
    }

    if (shouldClear) {
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, location.pathname, navigate]);

  const getJobStatusDetails = React.useCallback((job: any, contract: any) => {
    if (job.status === "completed") {
      let isLegacyCompleted = false;
      let wasOnTime = false;
      
      if (job.completionStatus) {
        wasOnTime = job.completionStatus === "on_time";
      } else {
        const completedAt = job.completedAt ? new Date(job.completedAt) : null;
        if (completedAt && !isNaN(completedAt.getTime())) {
          const deadlineStr = job.dueAt || job.deadlineDate;
          const deadline = deadlineStr ? new Date(deadlineStr) : null;
          const isValidDeadline = deadline && !isNaN(deadline.getTime());
          wasOnTime = !isValidDeadline || (completedAt <= deadline);
        } else {
          isLegacyCompleted = true;
        }
      }
      
      if (isLegacyCompleted) {
        return {
          text: "Concluído",
          color: "bg-green-500",
          bg: "bg-green-100 dark:bg-green-500/20",
          icon: CheckCircle2,
        };
      }
      
      return {
        text: wasOnTime ? "Concluído no prazo" : "Concluído com atraso",
        color: wasOnTime ? "bg-green-500" : "bg-orange-500",
        bg: wasOnTime ? "bg-green-100 dark:bg-green-500/20" : "bg-orange-100 dark:bg-orange-500/20",
        icon: wasOnTime ? CheckCircle2 : AlertTriangle,
      };
    }
    if (job.status === "cancelled")
      return {
        text: "Cancelado",
        color: "bg-rose-500",
        bg: "bg-red-100 dark:bg-red-500/20",
        icon: X,
      };

    const targetDate = new Date(job.dueAt || job.deadlineDate);
    const now = new Date();
    // Replaces differenceInDays to check exact precise milliseconds if it is expired
    if (now > targetDate) {
      return {
        text: "Atrasado",
        color: "bg-rose-500",
        bg: "bg-red-100 dark:bg-red-500/20",
        icon: AlertTriangle,
      };
    }
    
    // Difference in days for warning
    const daysLeft = Math.ceil((targetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysLeft <= 2)
      return {
        text: "Atenção",
        color: "bg-amber-50 dark:bg-amber-500/100",
        bg: "bg-amber-100 dark:bg-amber-500/20",
        icon: AlertTriangle,
      };
    if (job.status === "active")
      return {
        text: "Em Andamento",
        color: "bg-blue-50 dark:bg-blue-500/100",
        bg: "bg-blue-100 dark:bg-blue-500/20",
        icon: PlayCircle,
      };

    return {
      text: "Não Iniciado",
      color: "bg-gray-400",
      bg: "bg-gray-50 dark:bg-[#1A1F26]",
      icon: Clock,
    };
  }, []);

  const activeJobsList = React.useMemo(() => {
    const contractsMap = new Map(contracts.map((c) => [c.id, c]));
    const usersMap = new Map(users.map((u) => [u.id, u]));
    const vehiclesMap = new Map(vehicles.map((v) => [v.id, v]));
    const trailersMap = new Map(trailers.map((t) => [t.id, t]));
    const companiesMap = new Map(companies.map((c) => [c.id, c]));

    return jobs
      .map((job) => {
        const contract = contractsMap.get(job.contractId);
        const driver = usersMap.get(job.driverId);
        const vehicle = vehiclesMap.get(job.vehicleId);
        const trailerlessSimulator = isTrailerlessSimulator(
          contract,
          simulators as unknown[],
        );
        const trailer = trailerlessSimulator
          ? undefined
          : trailersMap.get(job.trailerId);
        const company = companiesMap.get(job.companyId);

        const statusDetails = getJobStatusDetails(job, contract);
        const daysLeft = differenceInDays(new Date(job.deadlineDate), new Date());

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
      .filter((j) => j.contract && j.driver);
  }, [jobs, contracts, users, vehicles, trailers, simulators, companies, getJobStatusDetails]);

  // Filtragem
  const filteredJobs = activeJobsList.filter((job) => {
    // Status
    if (statusFilter === "active" && job.statusDetails.text !== "Em Andamento")
      return false;
    if (statusFilter === "delayed" && job.statusDetails.text !== "Atrasado")
      return false;
    if (statusFilter === "completed" && job.status !== "completed")
      return false;
    if (
      statusFilter === "ongoing" &&
      ["completed", "cancelled"].includes(job.status)
    )
      return false;

    // Busca
    if (search) {
      const lowerSearch = search.toLowerCase();
      if (
        !job.driver?.name.toLowerCase().includes(lowerSearch) &&
        !job.contract?.name.toLowerCase().includes(lowerSearch)
      ) {
        return false;
      }
    }
    return true;
  }).sort((a, b) => {
    // Only apply comprehensive sort if we are viewing completed jobs, 
    // or just apply it globally descending. Apply it to all to keep recent stuff top.
    const tsA = getJobRealTimestamp(a, historicoTrips);
    const tsB = getJobRealTimestamp(b, historicoTrips);
    const dateA = new Date(tsA);
    const dateB = new Date(tsB);
    
    if (tsA !== tsB) {
      return tsB - tsA;
    }

    const contractA = a.contract?.name || "";
    const contractB = b.contract?.name || "";
    return contractA.localeCompare(contractB);
  });

  const selectedJob = selectedJobId
    ? activeJobsList.find((j) => j.id === selectedJobId)
    : null;

  return (
    <div className="space-y-0 relative h-full flex flex-col pt-2 pb-8">
      {/* Cabeçalho */}
      <div className="flex flex-row items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-[#fafafa] tracking-tight">
            Operações
          </h1>
          <p className="text-[13px] text-gray-500 dark:text-[#a1a1aa] mt-0.5 font-medium">
            Gestão de trabalhos e designações.
          </p>
        </div>
        <Button
          onClick={() => navigate("/admin/assign")}
          className="bg-gray-900 hover:bg-gray-800 text-white gap-1.5 shadow-sm dark:shadow-none shrink-0 px-4 py-2 h-9 rounded-lg text-[13px] font-medium transition-all"
        >
          <Plus size={16} />
          <span className="hidden sm:inline">Designar Trabalho</span>
          <span className="sm:hidden">Novo</span>
        </Button>
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div className="relative w-full sm:max-w-[300px]">
          <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
            <Search size={15} className="text-gray-400" />
          </div>
          <input
            type="text"
            placeholder="Pesquisar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-white dark:bg-[#1A1F26] border border-gray-200 dark:border-[#2A2F3A] rounded-lg pl-9 pr-4 py-2 text-[13px] font-medium focus:outline-none focus:ring-2 focus:ring-gray-900/5 focus:border-gray-300 dark:focus:border-slate-600 shadow-sm dark:shadow-none transition-all"
          />
        </div>
        <div className="relative whitespace-nowrap">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="appearance-none w-full sm:w-auto bg-white dark:bg-[#1A1F26] border border-gray-200 dark:border-[#2A2F3A] rounded-lg pl-4 pr-10 py-2 text-[13px] font-semibold text-gray-700 dark:text-[#d4d4d8] focus:outline-none focus:ring-2 focus:ring-gray-900/5 focus:border-gray-300 dark:focus:border-slate-600 shadow-sm dark:shadow-none cursor-pointer hover:bg-gray-50 dark:hover:bg-[#3f3f46] transition-colors"
          >
            <option value="all">Todos os Status</option>
            <option value="ongoing">Abertos</option>
            <option value="active">Em andamento</option>
            <option value="delayed">Atrasados</option>
            <option value="completed">Concluídos</option>
          </select>
          <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none text-gray-400">
            <ChevronDown size={14} />
          </div>
        </div>
      </div>

      {/* Grid Content */}
      <div className="flex-1">
        {filteredJobs.length === 0 ? (
          <div className="bg-white dark:bg-[#1A1F26]/50 border border-gray-200 dark:border-[#2A2F3A]/60 rounded-3xl p-10 text-center flex flex-col items-center justify-center min-h-[300px]">
            <div className="w-16 h-16 bg-white dark:bg-[#1A1F26] rounded-2xl flex items-center justify-center text-gray-300 mb-4 border border-gray-100 dark:border-[#2A2F3A] shadow-sm dark:shadow-none">
              <Search size={24} />
            </div>
            <h3 className="text-[15px] font-bold text-gray-900 dark:text-[#fafafa]">
              Nenhuma operação encontrada
            </h3>
            <p className="text-[13px] text-gray-500 dark:text-[#a1a1aa] mt-1 max-w-sm mb-6">
              Ajuste os filtros de busca ou inicie uma nova operação com seus
              motoristas.
            </p>
            <Button
              onClick={() => navigate("/admin/assign")}
              variant="outline"
              className="h-10 text-sm font-semibold rounded-xl px-5 border-gray-200 dark:border-[#2A2F3A]"
            >
              Iniciar Operação
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 md:gap-4">
            {filteredJobs.map((job) => {
              const isSelected = selectedJobId === job.id;
              const progressPct =
                Math.round(
                  (job.progress / Math.max(1, job.contract!.totalDeliveries)) *
                    100,
                ) || 0;
              const deliveriesLeft =
                job.contract!.totalDeliveries - job.progress;
              const isOverdue = job.daysLeft < 0;
              const effectiveTrailerId = job.trailerlessSimulator
                ? ""
                : job.trailerId || job.contract?.trailerId;
              const currentTrailer = job.trailerlessSimulator
                ? null
                : trailers.find((t) => t.id === effectiveTrailerId);

              return (
                <div
                  key={job.id}
                  className={cn(
                    "relative flex flex-col border rounded-[24px] transition-all overflow-hidden bg-white dark:bg-[#1A1F26]",
                    isSelected
                      ? "border-blue-500 shadow-md dark:shadow-none ring-1 ring-blue-500/20"
                      : "border-gray-200 dark:border-[#2A2F3A] shadow-sm dark:shadow-none hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-md dark:shadow-none",
                  )}
                >
                  <button
                    onClick={() => setSelectedJobId(isSelected ? null : job.id)}
                    className="w-full text-left p-4 flex flex-col gap-4"
                  >
                    <div className="flex justify-between items-start gap-4 pr-6 relative w-full">
                      <div className="flex-1 min-w-0 pr-4">
                        <h3 className="font-semibold text-gray-900 dark:text-[#fafafa] text-[15px] sm:text-[16px] truncate tracking-tight mb-1">
                          {job.driver!.name}
                        </h3>
                        <div className="flex flex-col gap-1 text-[12px] text-gray-500 dark:text-[#a1a1aa] mt-1 mb-2 sm:mb-0">
                          <span className="font-medium text-gray-800 dark:text-[#d4d4d8] truncate">
                            {job.contract!.name}
                          </span>
                          {job.vehicle ? (
                            <span className="flex items-center gap-1.5 font-medium">
                              <Car
                                size={13}
                                className="shrink-0 text-gray-400"
                              />
                              {job.vehicle.name}
                            </span>
                          ) : (
                            <span className="flex items-center gap-1.5">
                              <Car
                                size={13}
                                className="shrink-0 text-gray-400"
                              />
                              S/ Veículo
                            </span>
                          )}
                          {!job.trailerlessSimulator && (
                            currentTrailer ? (
                              <span className="flex items-center gap-1.5 break-words font-medium">
                                <Truck
                                  size={13}
                                  className="shrink-0 text-gray-400"
                                />
                                {currentTrailer.name}
                              </span>
                            ) : (
                              <span className="flex items-center gap-1.5">
                                <Truck
                                  size={13}
                                  className="shrink-0 text-gray-400"
                                />
                                S/ Reboque
                              </span>
                            )
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-2">
                        {/* Status de On e Off */}
                        <div
                          className="flex items-center gap-1.5 bg-gray-50 dark:bg-[#09090b] border border-gray-200 dark:border-[#2A2F3A] rounded-lg px-2 py-1 cursor-default"
                          title={job.driver!.isOnline ? "Online" : "Offline"}
                        >
                          <span
                            className={cn(
                              "text-[10px] font-bold tracking-tight uppercase",
                              job.driver!.isOnline
                                ? "text-green-600"
                                : "text-gray-500 dark:text-[#a1a1aa]",
                            )}
                          >
                            {job.driver!.isOnline ? "On" : "Off"}
                          </span>
                          <div className="relative inline-flex items-center shrink-0">
                            <div
                              className={cn(
                                "w-[24px] h-[14px] rounded-full shadow-inner dark:shadow-none relative transition-colors",
                                job.driver!.isOnline
                                  ? "bg-[#32D74B]"
                                  : "bg-gray-200 dark:bg-white/10",
                              )}
                            >
                              <div
                                className={cn(
                                  "absolute top-[2px] transition-all bg-white dark:bg-[#09090b] border border-gray-200 dark:border-[#2A2F3A] rounded-full h-[10px] w-[10px]",
                                  job.driver!.isOnline
                                    ? "left-[12px] border-white"
                                    : "left-[2px]",
                                )}
                              ></div>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="absolute right-0 top-[0px] text-gray-400 mt-1">
                        {isSelected ? (
                          <ChevronUp size={22} strokeWidth={2} />
                        ) : (
                          <ChevronDown size={22} strokeWidth={2} />
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 w-full">
                      {/* Card progress */}
                      <div className="w-full shrink-0 border border-gray-200 dark:border-[#2A2F3A] bg-gray-50 dark:bg-[#1A1F26] rounded-2xl p-4 flex flex-col gap-3">
                        <div className="flex justify-between items-start">
                          <div className="flex flex-col items-start leading-tight">
                            <span className="text-[15px] text-blue-600 dark:text-blue-400 font-medium tracking-tight mb-0.5">
                              {job.progress}/{job.contract!.totalDeliveries}
                            </span>
                            <span className="text-[12px] text-gray-500 dark:text-[#a1a1aa]">
                              (Entregas)
                            </span>
                          </div>
                          <div className="flex flex-col items-end leading-tight">
                            <span className="text-[15px] text-blue-600 dark:text-blue-400 font-medium tracking-tight mb-0.5">
                              {deliveriesLeft}
                            </span>
                            <span className="text-[12px] text-gray-500 dark:text-[#a1a1aa]">
                              faltam
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="flex-1 bg-gray-200 dark:bg-white/10/70 dark:bg-[#27272a] rounded-full h-[5px] overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500 bg-[#00D1FF] shadow-[0_0_10px_rgba(0,209,255,0.4)]"
                              style={{ width: `${Math.max(3, progressPct)}%` }}
                            ></div>
                          </div>
                          <span className="text-[12px] font-medium text-blue-600 dark:text-blue-400 shrink-0 min-w-[28px] text-right">
                            {progressPct}%
                          </span>
                        </div>
                      </div>

                      {/* Prazo */}
                      <div className="flex px-1 pt-1 items-center gap-2">
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest whitespace-nowrap">
                          Prazo limite:
                        </span>
                        <span
                          className={cn(
                            "font-medium flex items-center gap-1.5 text-[12px]",
                            isOverdue && job.status === "active"
                              ? "text-red-600 font-bold"
                              : "text-gray-900 dark:text-[#fafafa]",
                          )}
                        >
                          <Clock
                            size={13}
                            className={cn(
                              isOverdue && job.status === "active"
                                ? "text-red-500"
                                : "text-gray-400",
                            )}
                          />
                          {format(new Date(job.deadlineDate), "dd/MM/yyyy")}
                        </span>
                      </div>
                    </div>
                  </button>
                  {isSelected && (
                    <div className="border-t border-gray-100 dark:border-[#2A2F3A] bg-gray-50 dark:bg-[#1A1F26] p-3 sm:p-4 flex flex-col gap-3">
                      {/* Contract Card Match */}
                      <div
                        className="bg-white dark:bg-[#1A1F26] rounded-2xl border border-gray-200 dark:border-[#2A2F3A]/80 shadow-sm dark:shadow-none relative px-4 py-3 sm:p-4 hover:border-gray-300 dark:hover:border-[#52525b] transition-colors cursor-pointer group"
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
                            <p className="text-[12px] font-medium text-gray-500 dark:text-[#a1a1aa] truncate flex items-center gap-1.5">
                              <Truck size={12} className="text-gray-400" />
                              {job.trailer ? job.trailer.name : "Qualquer reboque"}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-[12px] font-semibold text-gray-900 dark:text-[#fafafa] bg-gray-50 dark:bg-[#1A1F26]/80 p-2 rounded-lg border border-gray-100 dark:border-[#2A2F3A]">
                          <span>{job.contract!.totalDeliveries} entregas</span>
                          <span className="text-gray-300 dark:text-gray-600">•</span>
                          <span>{job.contract!.deadlineDays} dias</span>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <Button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/admin/driver/${job.driverId}`, { state: { returnUrl: location.pathname, companyId: job.companyId } });
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
                              {
                                setCancelingJobId(job.id);
                                cancelJob(job.id).finally(() =>
                                  setCancelingJobId(null),
                                );
                                setSelectedJobId(null);
                              }
                            }}
                          >
                            {cancelingJobId === job.id
                              ? "Cancelando..."
                              : "Cancelar"}
                          </Button>
                        )}

                      {(job.status === "completed" ||
                        job.status === "cancelled") && (
                        <Button
                          className="flex-1 h-9 px-4 text-[12px] font-semibold text-red-600 bg-white dark:bg-[#1A1F26] hover:bg-red-50 dark:bg-red-500/10 dark:border-red-500/20 border border-red-200 shadow-sm dark:shadow-none rounded-xl flex items-center gap-1.5 text-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled={deletingJobId === job.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            {
                              setDeletingJobId(job.id);
                              deleteJob(job.id).finally(() =>
                                setDeletingJobId(null),
                              );
                              setSelectedJobId(null);
                            }
                          }}
                        >
                          <Trash2 size={14} />
                          {deletingJobId === job.id
                            ? "Excluindo..."
                            : "Excluir Histórico"}
                        </Button>
                      )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
