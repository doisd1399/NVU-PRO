import { resolveDriverPhoto } from '../../lib/resolveDriverPhoto';
import React, { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useOperationalStore, useSessionStore } from "../../context/AppContext";
import { useCompanyStore } from "../../context/CompanyContext";
import { Button } from "../../components/ui/Button";
import { StableImage } from "../../components/common/StableImage";
import { OperationProgressBar } from "../../components/common/OperationProgressBar";
import { DriverPerformanceCard } from "../../components/DriverPerformanceCard";
import { cn, getJobRealTimestamp, getNomeContratoHistorico } from "../../lib/utils";
import { getDriverLevelData } from "../../lib/levelUtils";
import { getFilteredTrips } from "../../lib/metricsEngine";
import { normalizeTrip } from "../../lib/tripNormalizer";
import {
  resolveRegisteredSimulatorId,
  resolveSimulatorDisplayLabel,
} from "../../lib/simulatorOptions";
import { isOpenJobStatus } from "../../lib/jobStatus";
import { isTrailerlessSimulator } from "../../lib/resolveSimulator";
import { prepareAndCommitNavigation } from "../../lib/navigationTransition";
import TripHistory from "../driver/TripHistory";
import Reports from "./Reports";
import {
  ArrowLeft,
  CheckCircle,
  Truck,
  Car,
  Info,
  Phone,
  Mail,
  Building2,
  Gamepad2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  Package,
  Trash2,
  Trophy,
  Navigation,
  Wallet,
  Award,
  Sparkles,
  AlertTriangle,
  Banknote,
  Hourglass,
  X,
  Check,
  LayoutDashboard,
  User as UserIcon,
  History,
  Activity,
  ChevronRight,
  CalendarDays,
  Clock,
} from "lucide-react";
import { useTripHistory } from "../../hooks/useTripHistory";
import { useDriverTrips } from "../../hooks/useDriverTrips";
import {
  getTripCompanyId,
  getTripDriverId,
  getTripTimestamp,
  resolveViewedDriverCompanyId,
} from "../../lib/companyScope";

export default function DriverProfileIsolated() {
  const { id: driverId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const routeCompanyId = (
    location.state as { companyId?: string } | null
  )?.companyId;
  // The company history hook already hydrates the shared memory/session cache
  // synchronously. Do not gate that path behind a frame: the profile should
  // paint the known history while the catalog and Firestore reconcile.

  const handleBack = () => {
    if (location.state && location.state.returnUrl) {
      navigate(location.state.returnUrl, { state: location.state.returnState });
    } else {
      navigate(-1);
    }
  };

  const {
    companies,
    allCompanies,
    activeCompanyId,
    companyCatalogLoaded,
    companyCatalogAttempted,
    loadCompanyCatalog,
    allCompanyMembers,
  } = useCompanyStore();
  const { currentUser } = useSessionStore();
  const {
    users,
    jobs,
    contracts,
    vehicles,
    trailers,
    simulators,
    deleteJob,
  } = useOperationalStore();

  useEffect(() => {
    if (companyCatalogLoaded || companyCatalogAttempted) return;
    void loadCompanyCatalog();
  }, [companyCatalogAttempted, companyCatalogLoaded, loadCompanyCatalog]);

  // Fleet navigation already carries the viewed company. Avoid opening a
  // second driver-wide listener before the profile header has painted.
  const { trips: driverTrips = [] } = useDriverTrips(driverId, {
    enabled: !routeCompanyId,
  });

  const driverForContext = users.find((user) => user.id === driverId);
  const activeDriverMembershipForContext = allCompanyMembers?.find(
    (member) => member.userId === driverId && member.status === "active",
  );
  const historicalDriverMembershipForContext = allCompanyMembers?.find(
    (member) => member.userId === driverId,
  );

  const activeJobCompanyIdForContext = useMemo(() => {
    const driverJobs = jobs
      .filter((job) => job.driverId === driverId && job.companyId)
      .sort((a, b) => {
        const aTime = new Date(a.createdAt || (a as any).startedAt || 0).getTime();
        const bTime = new Date(b.createdAt || (b as any).startedAt || 0).getTime();
        return bTime - aTime;
      });
    return driverJobs[0]?.companyId || null;
  }, [driverId, jobs]);

  const latestTripCompanyIdForContext = useMemo(() => {
    const latestTrip = driverTrips
      .filter((trip) => getTripDriverId(trip) === driverId)
      .sort((a, b) => getTripTimestamp(b) - getTripTimestamp(a))[0];
    return getTripCompanyId(latestTrip);
  }, [driverId, driverTrips]);

  // The route/company being inspected is authoritative. Operational evidence
  // (job and latest trip) then protects profiles whose user.companyId or
  // membership projection is stale. The logged senior user's company is only
  // the final fallback.
  const viewedCompanyId = resolveViewedDriverCompanyId({
    routeCompanyId,
    activeJobCompanyId: activeJobCompanyIdForContext,
    latestTripCompanyId: latestTripCompanyIdForContext,
    activeMembershipCompanyId: activeDriverMembershipForContext?.companyId,
    userCompanyId: driverForContext?.companyId,
    historicalMembershipCompanyId:
      historicalDriverMembershipForContext?.companyId,
    fallbackActiveCompanyId: activeCompanyId,
  });

  const { historicoTrips = [] } = useTripHistory(viewedCompanyId, {
    enabled: Boolean(viewedCompanyId),
    userId: currentUser?.id,
  });

  // Company history remains the canonical source for totals and level data.
  // Simulator-wide ranking periods are loaded directly inside the performance
  // card, so this profile no longer subscribes to every trip in the system.
  const viewedCompanyTrips = historicoTrips;
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [jobToDelete, setJobToDelete] = useState<string | null>(null);
  const [isPageSelectorOpen, setIsPageSelectorOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "profile" | "history" | "operations" | "reports"
  >("profile");
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(new Set([activeTab]));

  useEffect(() => {
    setVisitedTabs(prev => prev.has(activeTab) ? prev : new Set(prev).add(activeTab));
  }, [activeTab]);

  const driver = driverForContext;
  if (!driver) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <p className="text-gray-500 mb-4">Motorista não encontrado.</p>
          <Button onClick={handleBack} variant="outline">
            Voltar
          </Button>
        </div>
      </div>
    );
  }

  const driverMembership = activeDriverMembershipForContext;

  const resolvedCompany =
    (viewedCompanyId ? allCompanies.find((company) => company.id === viewedCompanyId) : null) ||
    (activeCompanyId ? allCompanies.find((company) => company.id === activeCompanyId) : null) ||
    (viewedCompanyId ? companies.find((company) => company.id === viewedCompanyId) : null);

  const pageOptions = [
    { id: "profile", label: "Meu Perfil", icon: UserIcon },
    { id: "history", label: "Histórico de Viagens", icon: History },
    { id: "operations", label: "Histórico de Operações", icon: Package },
    { id: "reports", label: "Relatórios", icon: Activity },
  ];

  const activePageDetails =
    pageOptions.find((p) => p.id === activeTab) || pageOptions[0];
  const ActiveIcon = activePageDetails.icon;

  const renderPageSelector = () => (
    <div className="w-full flex flex-col gap-2 sm:gap-3 z-20">
      <div className="w-full flex flex-row items-stretch justify-between gap-2 sm:gap-4">
        <div className="flex bg-white dark:bg-[#1A1F26] border border-slate-200 dark:border-[#2A2F3A] rounded-lg sm:rounded-[12px] shadow-sm min-w-0 flex-1 h-9 sm:h-[56px] overflow-hidden">
          <button
            onClick={handleBack}
            className="w-11 sm:w-14 h-full hover:bg-slate-50 dark:hover:bg-[#2A2F3A] transition-colors flex items-center justify-center shrink-0 border-r border-slate-200 dark:border-[#2A2F3A]"
          >
            <ArrowLeft
              size={16}
              className="text-slate-600 dark:text-slate-400"
            />
          </button>

          <button
            onClick={() => setIsPageSelectorOpen(!isPageSelectorOpen)}
            className="flex-1 h-full hover:bg-slate-50 dark:hover:bg-[#2A2F3A] transition-colors flex items-center justify-center gap-1.5 sm:gap-[12px] px-2 sm:px-4 active:scale-[0.99]"
          >
            <ActiveIcon
              size={14}
              className="text-slate-600 dark:text-slate-400 shrink-0 sm:!w-[20px] sm:!h-[20px]"
            />
            <span className="text-[11px] sm:text-[16px] font-semibold text-slate-800 dark:text-slate-200 truncate leading-none sm:leading-none">
              {activePageDetails.label}
            </span>
            <ChevronDown
              size={14}
              className={cn(
                "text-slate-400 shrink-0 transition-transform duration-200 sm:!w-[18px] sm:!h-[18px]",
                isPageSelectorOpen && "rotate-180",
              )}
            />
          </button>
        </div>
      </div>

      {isPageSelectorOpen && (
        <div className="w-full bg-white dark:bg-[#1A1F26] border border-slate-200 dark:border-[#2A2F3A] rounded-lg shadow-sm overflow-hidden animate-in fade-in slide-in-from-top-2">
          {pageOptions.map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.id}
                onClick={() => {
                  setIsPageSelectorOpen(false);
                  void prepareAndCommitNavigation(
                    () => {},
                    () => {
                      setActiveTab(
                        opt.id as "profile" | "history" | "operations" | "reports",
                      );
                    }
                  );
                }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 sm:px-4 sm:py-3 border-b border-slate-100 dark:border-[#2A2F3A] last:border-0 hover:bg-slate-50 dark:hover:bg-[#2A2F3A] transition-colors text-left",
                  activeTab === opt.id ? "bg-slate-50 dark:bg-[#2A2F3A]" : "",
                )}
              >
                <Icon
                  size={16}
                  className={cn(
                    activeTab === opt.id
                      ? "text-blue-600 dark:text-[#0cb49f]"
                      : "text-slate-500",
                  )}
                />
                <span
                  className={cn(
                    "text-[13px] sm:text-[14px] font-semibold",
                    activeTab === opt.id
                      ? "text-blue-700 dark:text-[#0cb49f]"
                      : "text-slate-600 dark:text-slate-300",
                  )}
                >
                  {opt.label}
                </span>
                {activeTab === opt.id && (
                  <Check
                    size={14}
                    className="ml-auto text-blue-600 dark:text-[#0cb49f]"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  // Active job logic
  const validActiveJobs = jobs.filter(
    (j) =>
      j.driverId === driverId &&
      isOpenJobStatus(j.status) &&
      contracts.some((c) => c.id === j.contractId),
  );

  validActiveJobs.sort((a, b) => {
    if (a.status === "active" && b.status !== "active") return -1;
    if (a.status !== "active" && b.status === "active") return 1;
    const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return dateB - dateA;
  });

  const activeJob = validActiveJobs[0];
  const activeContract = activeJob
    ? contracts.find((c) => c.id === activeJob.contractId)
    : null;
  const activeVehicle =
    activeJob && activeJob.vehicleId
      ? vehicles.find((v) => v.id === activeJob.vehicleId)
      : null;
  const trailerlessSimulator = isTrailerlessSimulator(
    activeContract || resolvedCompany,
    simulators as unknown[],
  );
  const activeTrailerId = trailerlessSimulator
    ? ""
    : activeJob?.trailerId || activeContract?.trailerId;
  const activeTrailer = activeTrailerId
    ? trailers.find((t) => t.id === activeTrailerId)
    : null;

  // Historical jobs logic (only completed ones)
  const allDriverJobs = jobs.filter(
    (j) => j.driverId === driverId && j.id !== activeJob?.id,
  );
  const pastJobs = allDriverJobs
    .filter((j) => j.status === "completed")
    .sort((a, b) => {
      const tsA = getJobRealTimestamp(a, historicoTrips);
      const tsB = getJobRealTimestamp(b, historicoTrips);

      if (tsB !== tsA) {
        return tsB - tsA;
      }

      const contractA = getNomeContratoHistorico(a, contracts.find((c) => c.id === a.contractId));
      const contractB = getNomeContratoHistorico(b, contracts.find((c) => c.id === b.contractId));
      return contractA.localeCompare(contractB);
    });

  const levelData = getDriverLevelData(
    driverId as string,
    jobs,
    contracts,
    historicoTrips,
  );
  const displayLevel = levelData.displayLevel;
  const currentLevelXp = levelData.currentLevelXp;
  const xpProgress = levelData.xpProgress;

  const normalizedAllTrips = useMemo(() => historicoTrips.map((t: any) => normalizeTrip(t)), [historicoTrips]);

  const activeJobProgress = useMemo(() => {
    const persistedProgress = Math.max(0, Number(activeJob?.progress) || 0);
    if (!activeJob) return persistedProgress;

    const assignedTime = activeJob.assignedAt
      ? new Date(activeJob.assignedAt).getTime()
      : activeJob.createdAt
        ? new Date(activeJob.createdAt).getTime()
        : 0;
    const completedTime = activeJob.completedAt
      ? new Date(activeJob.completedAt).getTime()
      : Number.POSITIVE_INFINITY;

    const liveProgress = normalizedAllTrips.filter((trip: any) => {
      if (!trip.isValid) return false;
      if (trip.jobId && trip.jobId === activeJob.id) return true;

      const tripContractId = trip.contractId || trip.contratoId;
      const tripDriverId =
        trip.driverId || trip.motoristaId || trip.motorista_id || trip.userId;
      if (tripContractId !== activeJob.contractId) return false;
      if (tripDriverId !== driverId) return false;

      const tripTime = trip.metricDate.getTime();
      return tripTime >= assignedTime && tripTime <= completedTime;
    }).length;

    return Math.max(persistedProgress, liveProgress);
  }, [activeJob, driverId, normalizedAllTrips]);

  const registeredSimulatorId = resolveRegisteredSimulatorId(
    resolvedCompany as any,
    simulators as any[],
  );
  const resolvedSimulatorLabel = registeredSimulatorId
    ? resolveSimulatorDisplayLabel(
        resolvedCompany as any,
        simulators as any[],
        allCompanies as any[],
      ) || "Simulador registrado"
    : "Simulador não vinculado";
  
  const filteredDriverTrips = useMemo(() => {
    return getFilteredTrips(normalizedAllTrips, undefined, undefined, undefined, undefined, companies, driverId);
  }, [normalizedAllTrips, driverId, companies]);

  const totalGanhos = filteredDriverTrips.reduce((acc, t) => acc + t.normalizedValor, 0);
  const totalViagens = filteredDriverTrips.length;


  const formatCurrency = (val?: number) => {
    if (val === undefined || val === null || isNaN(val)) return "-";
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(val);
  };

  const isDriverActive = driver.status === "active";

  const onAssignJob = () => {
    navigate("/admin/assign", {
      state: {
        preselectedDriverId: driverId,
      },
    });
  };

  const onViewJob = (jobId: string) => {
    navigate("/admin/fleet", {
      state: { preselectedJobId: jobId },
    });
  };

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-3 sm:gap-4 w-full pb-8">
      <div className="bg-white dark:bg-[#1A1F26] border border-slate-200 dark:border-[#2A2F3A] rounded-[14px] sm:rounded-[16px] flex flex-col shadow-sm relative z-30 w-full box-border">
        <div className="p-3 sm:p-4 flex items-start sm:items-center justify-between gap-3 w-full">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-12 h-12 sm:w-14 sm:h-14 bg-slate-900 dark:bg-[#2A2F3A] rounded-lg overflow-hidden flex items-center justify-center shrink-0 border border-slate-200 dark:border-[#3A3F4A] shadow-sm relative">
              {resolveDriverPhoto(driver) ? (
                <StableImage
                  src={resolveDriverPhoto(driver)}
                  alt={driver.name}
                  loading="eager"
                  decoding="async"
                  fetchPriority="high"
                  wrapperClassName="w-full h-full"
                  className="object-cover"
                  referrerPolicy="no-referrer"
                  fallback={
                    <span className="h-full w-full bg-slate-900 dark:bg-[#2A2F3A] flex items-center justify-center text-base sm:text-lg font-bold text-white tracking-tighter">
                      {driver.name.substring(0, 2).toUpperCase()}
                    </span>
                  }
                />
              ) : (
                <span className="text-base sm:text-lg font-bold text-white tracking-tighter">
                  {driver.name.substring(0, 2).toUpperCase()}
                </span>
              )}
            </div>
            <div className="flex flex-col flex-1 min-w-0 justify-center">
              <div className="flex items-center gap-1.5 w-full">
                <h2 className="text-[11px] sm:text-[13px] font-bold text-slate-900 dark:text-white leading-none whitespace-nowrap">
                  {driver.name}
                </h2>
              </div>
              <p className="text-[9px] sm:text-[11px] text-slate-500 dark:text-slate-400 font-medium leading-none mt-1 whitespace-nowrap">
                {driver.roles?.includes("admin")
                  ? "Administrador"
                  : "Motorista Parceiro"}
              </p>
            </div>
          </div>

          <div className="flex items-center pl-3 sm:pl-4 border-l border-slate-200 dark:border-[#2A2F3A] shrink-0 w-auto">
            <div className="flex flex-col w-auto min-w-0 justify-center">
              <span className="text-[8px] sm:text-[9px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider mb-0.5 px-0.5 whitespace-nowrap">
                Simulador
              </span>
              <div className="flex items-center justify-between gap-1.5 bg-slate-50 dark:bg-[#1A1F26] border border-slate-200 dark:border-[#2A2F3A] shadow-sm rounded-md px-1.5 py-1 w-auto">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Truck
                    size={10}
                    className="text-slate-500 dark:text-slate-400 shrink-0"
                  />
                  <span className="text-[9px] sm:text-[10px] font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                    {resolvedSimulatorLabel}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {renderPageSelector()}

      <div className="space-y-3 sm:space-y-4">
        {visitedTabs.has("profile") && (
          <div className={cn(activeTab !== "profile" && "hidden")}>
            <div className="space-y-3 sm:space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
            {viewedCompanyId ? (
              <DriverPerformanceCard
                historicoTrips={viewedCompanyTrips}
                driverId={driverId as string}
                activeCompanyId={viewedCompanyId}
                allCompanyMembers={allCompanyMembers}
                users={users}
                currentUser={driver}
                simulatorId={registeredSimulatorId}
                allCompanies={allCompanies}
                simulators={simulators as Record<string, unknown>[]}
                displayLevel={displayLevel}
                currentLevelXp={currentLevelXp}
                xpProgress={xpProgress}
              />
            ) : (
              <div className="min-h-[220px]" aria-hidden="true" />
            )}
          </div>
          </div>
        )}

        {visitedTabs.has("operations") && (
          <div className={cn(activeTab !== "operations" && "hidden")}>
            <div className="space-y-6">
            {/* Active Job Section */}
            <div>
              <h3 className="text-[15px] font-bold text-gray-900 dark:text-[#fafafa] mb-3 px-1">
                Operação Ativa
              </h3>
              {activeJob && activeContract ? (
                <div className="order-3 flex flex-col bg-white dark:bg-[#1A1F26] rounded-2xl sm:rounded-[24px] shadow-sm dark:shadow-none border border-gray-200 dark:border-[#2A2F3A] overflow-hidden mb-3 sm:mb-4">
                  {/* Header */}
                  <div
                    className="relative overflow-hidden bg-[#1f242d] dark:bg-[#151921] p-3 sm:p-4 w-full cursor-pointer hover:bg-[#252b36] transition-colors"
                    onClick={() => onViewJob(activeJob.id)}
                  >
                    {/* Subtle glow effect */}
                    <div className="absolute top-[-50%] right-[-10%] w-[150px] h-[150px] bg-white/5 rounded-full blur-[40px] pointer-events-none"></div>

                    <div className="flex justify-between items-start z-10 relative gap-3">
                      <div className="flex flex-col pr-2 min-w-0">
                        <span className="text-[8px] sm:text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1 mt-0.5">
                          Operação atual
                        </span>
                        <h3 className="font-bold text-white text-[22px] sm:text-[26px] tracking-tight leading-none mb-1.5">
                          {activeContract.name}
                        </h3>
                        <p className="text-[10px] sm:text-[11px] text-gray-400 font-medium leading-none truncate whitespace-nowrap">
                          Siga as especificações do transporte.
                        </p>
                      </div>

                      <div className="shrink-0 flex pt-0.5">
                        {activeJob.status === "pending" ? (
                          <span className="px-1.5 py-0.5 text-[8px] sm:text-[9px] font-semibold border border-yellow-500/20 bg-yellow-500/10 text-yellow-400 rounded-full flex items-center gap-1 whitespace-nowrap tracking-wide">
                            <span className="w-1.5 h-1.5 rounded-full bg-yellow-400"></span>
                            PENDENTE
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 text-[8px] sm:text-[9px] font-semibold border border-[#0cb49f]/20 bg-[#0cb49f]/10 text-[#0cb49f] rounded-full flex items-center gap-1 whitespace-nowrap tracking-wide">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#0cb49f]"></span>
                            TRABALHO ATIVO
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Content Area */}
                  <div className="p-3 pb-2 sm:p-4 sm:pb-3 flex flex-col gap-2.5">
                    {/* Buttons Row (Vehicles and Trailer) */}
                    <div className="flex flex-col gap-1.5">
                      <button className="flex items-center justify-between border border-gray-100 dark:border-[#2A2F3A] bg-white dark:bg-[#1f242d] rounded-[10px] py-1.5 px-3 text-left group shadow-sm dark:shadow-none cursor-default">
                        <div className="flex flex-col w-full justify-center">
                          <span className="text-[8px] font-bold text-gray-400 uppercase tracking-wider leading-none mb-0.5">
                            Veículo
                          </span>
                          <span className="text-[11px] sm:text-[12px] font-bold text-slate-800 dark:text-[#fafafa] leading-tight break-words">
                            {activeVehicle?.name || "Nenhum"}
                          </span>
                        </div>
                        <ChevronRight
                          size={14}
                          className="text-gray-300 dark:text-gray-600 shrink-0 ml-2"
                        />
                      </button>

                      {!trailerlessSimulator && (
                        <button className="flex items-center justify-between border border-gray-100 dark:border-[#2A2F3A] bg-white dark:bg-[#1f242d] rounded-[10px] py-1.5 px-3 text-left group shadow-sm dark:shadow-none cursor-default">
                          <div className="flex flex-col w-full justify-center">
                            <span className="text-[8px] font-bold text-gray-400 uppercase tracking-wider leading-none mb-0.5">
                              Reboque
                            </span>
                            <span className="text-[11px] sm:text-[12px] font-bold text-slate-800 dark:text-[#fafafa] leading-tight break-words">
                              {activeTrailer?.name || "Nenhum"}
                            </span>
                          </div>
                          <ChevronRight
                            size={14}
                            className="text-gray-300 dark:text-gray-600 shrink-0 ml-2"
                          />
                        </button>
                      )}
                    </div>

                    {/* Metrics */}
                    <div className="border border-gray-100 dark:border-[#2A2F3A] bg-gray-50/50 dark:bg-[#1f242d] rounded-[8px] flex items-center shadow-sm dark:shadow-none mt-0.5">
                      <div className="flex-1 py-1.5 flex flex-col items-center justify-center text-center">
                        <span className="text-[14px] sm:text-[16px] font-bold text-slate-800 dark:text-gray-100 leading-none tracking-tight mb-0.5">
                          {activeJobProgress}/{activeContract.totalDeliveries}
                        </span>
                        <span className="text-[7px] sm:text-[8px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-semibold">
                          Entregas
                        </span>
                      </div>

                      <div className="w-px h-6 bg-gray-200/60 dark:bg-[#2A2F3A] shrink-0"></div>

                      <div className="flex-1 py-1.5 flex flex-col items-center justify-center text-center">
                        <span className="text-[14px] sm:text-[16px] font-bold text-slate-800 dark:text-gray-100 leading-none tracking-tight mb-0.5">
                          {Math.max(
                            0,
                            activeContract.totalDeliveries - activeJobProgress,
                          )}
                        </span>
                        <span className="text-[7px] sm:text-[8px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-semibold">
                          Faltam
                        </span>
                      </div>

                      <div className="w-px h-6 bg-gray-200/60 dark:bg-[#2A2F3A] shrink-0"></div>

                      <div className="flex-1 py-1.5 flex flex-col items-center justify-center text-center">
                        <span className="text-[14px] sm:text-[16px] font-bold text-slate-800 dark:text-gray-100 leading-none tracking-tight mb-0.5">
                          {activeContract.totalDeliveries > 0
                            ? Math.round(
                                (activeJobProgress /
                                  activeContract.totalDeliveries) *
                                  100,
                              )
                            : 0}
                          %
                        </span>
                        <span className="text-[7px] sm:text-[8px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-semibold">
                          Concluído
                        </span>
                      </div>
                    </div>

                    {/* Compact Progress bar */}
                    <div className="flex flex-col gap-1.5 mt-1 mb-0.5">
                      <OperationProgressBar
                        percent={
                          activeContract.totalDeliveries > 0
                            ? Math.round(
                                (activeJobProgress /
                                  activeContract.totalDeliveries) *
                                  100,
                              )
                            : 0
                        }
                        replayKey={`${location.key}:${driverId ?? "driver"}:${activeJob.id}`}
                      />
                      <p className="text-[8px] uppercase tracking-wider font-semibold text-gray-400 dark:text-gray-500 text-center">
                        Progresso da operação
                      </p>
                    </div>
                  </div>

                  {/* Footer - Limit/Time */}
                  <div className="flex items-center justify-between border-t border-gray-100 dark:border-[#2A2F3A] bg-white dark:bg-[#1A1F26] px-3 py-2 sm:px-4 sm:py-2.5 shrink-0 w-full overflow-hidden">
                    <div className="flex flex-1 items-center gap-2 min-w-0 pr-1">
                      <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-md bg-gray-50 dark:bg-[#2A2F3A] flex flex-shrink-0 items-center justify-center border border-gray-100 dark:border-transparent">
                        <CalendarDays
                          size={12}
                          className="text-gray-600 dark:text-gray-400"
                        />
                      </div>
                      <div className="flex flex-col min-w-0 overflow-hidden text-left">
                        <span className="text-[7px] sm:text-[8px] font-bold text-gray-400 uppercase tracking-widest mb-0.5">
                          Prazo limite
                        </span>
                        <span className="text-[10px] sm:text-[11px] font-bold text-slate-800 dark:text-gray-200 whitespace-nowrap overflow-visible leading-none">
                          {activeJob.dueAt || activeJob.deadlineDate
                            ? new Date(
                                activeJob.dueAt || activeJob.deadlineDate,
                              ).toLocaleDateString("pt-BR")
                            : "Não definido"}
                        </span>
                      </div>
                    </div>

                    <div className="w-px h-5 bg-gray-100 dark:bg-[#2A2F3A] shrink-0 mx-1"></div>

                    <div className="flex flex-1 items-center justify-end gap-2 min-w-0 pl-1 text-right">
                      <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-md bg-gray-50 dark:bg-[#2A2F3A] flex flex-shrink-0 items-center justify-center order-1 border border-gray-100 dark:border-transparent">
                        <Clock
                          size={12}
                          className="text-gray-600 dark:text-gray-400"
                        />
                      </div>
                      <div className="flex flex-col min-w-0 overflow-hidden order-0">
                        <span className="text-[7px] sm:text-[8px] font-bold text-gray-400 uppercase tracking-widest mb-0.5">
                          Tempo restante
                        </span>
                        <span className="text-[10px] sm:text-[11px] font-bold text-slate-800 dark:text-gray-200 whitespace-nowrap overflow-visible leading-none truncate">
                          {(() => {
                            const deadline = activeJob.dueAt || activeJob.deadlineDate;
                            if (!deadline) return "Não definido";
                            const diffMs =
                              new Date(deadline).getTime() -
                              new Date().getTime();
                            if (diffMs <= 0) return "Vencido";
                            const d = Math.floor(
                              diffMs / (1000 * 60 * 60 * 24),
                            );
                            const h = Math.floor(
                              (diffMs / (1000 * 60 * 60)) % 24,
                            );
                            const m = Math.floor((diffMs / 1000 / 60) % 60);
                            return `${d} dias - ${h}h - ${m}min`;
                          })()}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-white dark:bg-[#1A1F26] border border-gray-100 dark:border-[#2A2F3A] border-dashed rounded-[20px] p-8 text-center shadow-sm dark:shadow-none">
                  <p className="text-[15px] text-gray-500 dark:text-[#a1a1aa] font-medium">
                    Nenhuma operação em andamento
                  </p>
                </div>
              )}
            </div>

            {/* Job History */}
            <div>
              <h3 className="text-[15px] font-bold text-gray-900 dark:text-[#fafafa] mb-3 px-1">
                Histórico
              </h3>
              {pastJobs.length > 0 ? (
                <div className="space-y-3">
                  {pastJobs.map((job) => {
                    const contract = contracts.find(
                      (c) => c.id === job.contractId,
                    );
                    const jobTrailerlessSimulator = isTrailerlessSimulator(
                      contract || resolvedCompany,
                      simulators as unknown[],
                    );
                    const jobTrailerId = jobTrailerlessSimulator
                      ? ""
                      : job.trailerId || contract?.trailerId;
                    const vehicle = vehicles.find(
                      (v) => v.id === job.vehicleId,
                    );
                    const trailer = jobTrailerId
                      ? trailers.find((t) => t.id === jobTrailerId)
                      : null;

                    const parseDateSafe = (d: any): Date | null => {
                      if (!d) return null;
                      if (d.toDate && typeof d.toDate === "function")
                        return d.toDate();
                      if (d.seconds) return new Date(d.seconds * 1000);
                      const date = new Date(d);
                      if (isNaN(date.getTime())) return null;
                      return date;
                    };

                    const rawCompletedAt = parseDateSafe(job.completedAt);
                    const rawDeadline = parseDateSafe(
                      job.dueAt || job.deadlineDate,
                    );
                    const rawAssignedAt = parseDateSafe(
                      job.assignedAt || job.createdAt,
                    );
                    const isExpanded = expandedJobId === job.id;

                    const jobTrips = normalizedAllTrips.filter((trip) => {
                      if (!trip.isValid) return false;
                      if (trip.jobId && trip.jobId === job.id) return true;
                      if (trip.contratoId !== job.contractId) return false;
                      if (trip.motoristaId !== driverId) return false;

                      const tripTime = trip.metricDate.getTime();
                      const assignedTime = rawAssignedAt
                        ? rawAssignedAt.getTime()
                        : 0;
                      const completedTime = rawCompletedAt
                        ? rawCompletedAt.getTime()
                        : Date.now() + 86400000;

                      return (
                        tripTime >= assignedTime && tripTime <= completedTime
                      );
                    });

                    const totalGanhos = jobTrips.reduce(
                      (acc, trip) => acc + trip.normalizedValor,
                      0,
                    );

                    let tempoExecucao = "-";
                    let tempoRestanteOuAtraso = "-";
                    let isAtrasado = false;
                    let prazoTotal = "-";

                    if (rawAssignedAt && rawDeadline) {
                      const diffTotalMs =
                        rawDeadline.getTime() - rawAssignedAt.getTime();
                      const totalDays = Math.floor(
                        diffTotalMs / (1000 * 60 * 60 * 24),
                      );
                      prazoTotal = `${totalDays} dia${totalDays > 1 ? "s" : ""}`;
                    }

                    if (rawAssignedAt && rawCompletedAt) {
                      const diffExecMs =
                        rawCompletedAt.getTime() - rawAssignedAt.getTime();
                      const execD = Math.floor(
                        diffExecMs / (1000 * 60 * 60 * 24),
                      );
                      const execH = Math.floor(
                        (diffExecMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
                      );
                      const execM = Math.floor(
                        (diffExecMs % (1000 * 60 * 60)) / (1000 * 60),
                      );
                      tempoExecucao =
                        execD > 0
                          ? `${execD}d ${execH}h ${execM}min`
                          : `${execH}h ${execM}min`;
                    }

                    if (rawCompletedAt && rawDeadline) {
                      const diffRestMs =
                        rawDeadline.getTime() - rawCompletedAt.getTime();
                      isAtrasado = diffRestMs < 0;
                      const absRest = Math.abs(diffRestMs);
                      const restD = Math.floor(absRest / (1000 * 60 * 60 * 24));
                      const restH = Math.floor(
                        (absRest % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
                      );
                      const restM = Math.floor(
                        (absRest % (1000 * 60 * 60)) / (1000 * 60),
                      );
                      tempoRestanteOuAtraso =
                        restD > 0
                          ? `${restD}d ${restH}h ${restM}min`
                          : `${restH}h ${restM}min`;
                    }

                    return (
                      <div
                        key={job.id}
                        className={cn(
                          "bg-white dark:bg-[#1A1F26] border rounded-2xl transition-all shadow-sm dark:shadow-none overflow-hidden",
                          isExpanded
                            ? "border-gray-300 dark:border-gray-600 ring-1 ring-gray-200 dark:ring-gray-700 block"
                            : "border-gray-100 dark:border-[#2A2F3A] hover:border-gray-200 dark:hover:border-gray-700",
                        )}
                      >
                        <button
                          className="w-full flex flex-col p-3 focus:outline-none"
                          onClick={() =>
                            setExpandedJobId(isExpanded ? null : job.id)
                          }
                        >
                          <div className="flex items-center justify-between w-full">
                            <div className="flex items-center gap-3 min-w-0">
                              {/* Check / Cross */}
                              <div
                                className={cn(
                                  "w-[34px] h-[34px] rounded-full flex items-center justify-center shrink-0",
                                  isAtrasado
                                    ? "bg-amber-100 dark:bg-amber-500/20"
                                    : "bg-emerald-100 dark:bg-emerald-500/20",
                                )}
                              >
                                {isAtrasado ? (
                                  <X
                                    size={16}
                                    className="text-amber-600 dark:text-amber-400"
                                    strokeWidth={3}
                                  />
                                ) : (
                                  <Check
                                    size={16}
                                    className="text-emerald-600 dark:text-emerald-400"
                                    strokeWidth={3}
                                  />
                                )}
                              </div>

                              {/* Name and Badge */}
                              <div className="flex items-center gap-2.5 min-w-0">
                                <h4 className="text-[15px] sm:text-[16px] font-semibold text-gray-900 dark:text-[#fafafa] truncate">
                                  {getNomeContratoHistorico(job, contract)}
                                </h4>
                                <span
                                  className={cn(
                                    "h-[16px] px-1.5 text-[9px] font-bold tracking-wide rounded uppercase flex items-center justify-center shrink-0 leading-none",
                                    isAtrasado
                                      ? "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400"
                                      : "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400",
                                  )}
                                >
                                  {isAtrasado
                                    ? "O prazo expirou"
                                    : "Dentro do prazo"}
                                </span>
                              </div>
                            </div>
                            <div className="text-gray-400 dark:text-gray-500 shrink-0 ml-2">
                              {isExpanded ? (
                                <ChevronUp size={18} />
                              ) : (
                                <ChevronDown size={18} />
                              )}
                            </div>
                          </div>

                          {/* Divider */}
                          <div className="h-px w-full bg-gray-100 dark:bg-gray-800/60 my-2.5"></div>

                          {/* Info row */}
                          <div className="flex items-center justify-start w-full gap-x-2 sm:gap-x-4 gap-y-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                            <div className="flex items-center gap-1.5 shrink-0">
                              <Package
                                size={13}
                                className="text-gray-500 dark:text-gray-400 shrink-0"
                              />
                              <span className="text-[11px] sm:text-[11.5px] font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
                                {job.progress}{" "}
                                {job.progress === 1 ? "viagem" : "viagens"}
                              </span>
                            </div>

                            {!jobTrailerlessSimulator && (
                              <>
                                <div className="w-px h-3.5 bg-gray-200 dark:bg-gray-700/60 shrink-0"></div>

                                <div className="flex items-center gap-1.5 shrink-0">
                                  <Truck
                                    size={13}
                                    className="text-gray-500 dark:text-gray-400 shrink-0"
                                  />
                                  <span className="text-[11px] sm:text-[11.5px] font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
                                    {trailer?.name || "Nenhum"}
                                  </span>
                                </div>

                                <div className="w-px h-3.5 bg-gray-200 dark:bg-gray-700/60 shrink-0"></div>
                              </>
                            )}

                            <div className="flex items-center gap-1.5 shrink-0 pr-1">
                              <Car
                                size={13}
                                className="text-gray-500 dark:text-gray-400 shrink-0"
                              />
                              <span className="text-[11px] sm:text-[11.5px] font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
                                {vehicle?.name || "Nenhum"}
                              </span>
                            </div>
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="px-4 pb-4 animate-in fade-in slide-in-from-top-2 duration-200">
                            <div className="bg-gray-50 dark:bg-[#202024] rounded-xl border border-gray-100 dark:border-gray-800/60 p-2.5 mb-3 space-y-2">
                              {/* Total de Ganhos */}
                              <div className="flex items-center gap-2">
                                <Banknote
                                  size={11}
                                  className="text-green-500 dark:text-green-400 shrink-0"
                                  strokeWidth={2.5}
                                />
                                <div className="flex items-center gap-2 min-w-0 w-full">
                                  <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 shrink-0">
                                    Total de ganhos:
                                  </span>
                                  <span className="text-[11.5px] font-semibold text-green-600 dark:text-green-400 truncate">
                                    {formatCurrency(totalGanhos)}
                                  </span>
                                </div>
                              </div>

                              {/* Prazo total */}
                              <div className="flex items-center gap-2">
                                <CalendarDays
                                  size={11}
                                  className="text-gray-400 dark:text-gray-500 shrink-0"
                                  strokeWidth={2.5}
                                />
                                <div className="flex items-center gap-2 min-w-0 w-full">
                                  <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 shrink-0">
                                    Prazo total:
                                  </span>
                                  <span className="text-[11.5px] font-semibold text-gray-900 dark:text-[#fafafa] truncate">
                                    {prazoTotal}
                                  </span>
                                </div>
                              </div>

                              {/* Execução */}
                              <div className="flex items-center gap-2">
                                <Clock
                                  size={11}
                                  className="text-gray-400 dark:text-gray-500 shrink-0"
                                  strokeWidth={2.5}
                                />
                                <div className="flex items-center gap-2 min-w-0 w-full">
                                  <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 shrink-0">
                                    Execução:
                                  </span>
                                  <span className="text-[11.5px] font-semibold text-gray-900 dark:text-[#fafafa] truncate">
                                    {tempoExecucao}
                                  </span>
                                </div>
                              </div>

                              {/* Tempo restante / Atraso */}
                              <div className="flex items-center gap-2">
                                <Hourglass
                                  size={11}
                                  className={cn(
                                    "shrink-0",
                                    isAtrasado
                                      ? "text-red-500 dark:text-red-400"
                                      : "text-gray-400 dark:text-gray-500",
                                  )}
                                  strokeWidth={2.5}
                                />
                                <div className="flex items-center gap-2 min-w-0 w-full">
                                  <span
                                    className={cn(
                                      "text-[10px] font-medium shrink-0",
                                      isAtrasado
                                        ? "text-red-600/80 dark:text-red-400/80"
                                        : "text-gray-500 dark:text-gray-400",
                                    )}
                                  >
                                    {isAtrasado ? "Atraso:" : "Tempo restante:"}
                                  </span>
                                  <span
                                    className={cn(
                                      "text-[11.5px] font-semibold truncate",
                                      isAtrasado
                                        ? "text-red-600 dark:text-red-400"
                                        : "text-gray-900 dark:text-[#fafafa]",
                                    )}
                                  >
                                    {tempoRestanteOuAtraso}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Result Message */}
                            <div
                              className={cn(
                                "flex items-center gap-2 rounded-xl px-3 py-2 border mb-3",
                                isAtrasado
                                  ? "bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20"
                                  : "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-100 dark:border-emerald-500/20",
                              )}
                            >
                              <div
                                className={cn(
                                  "shrink-0 w-[17px] h-[17px] rounded-full flex items-center justify-center",
                                  isAtrasado
                                    ? "bg-amber-200/50 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400"
                                    : "bg-emerald-200/50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400",
                                )}
                              >
                                {isAtrasado ? (
                                  <X size={10} strokeWidth={3} />
                                ) : (
                                  <Check size={10} strokeWidth={3} />
                                )}
                              </div>
                              <div className="flex flex-col justify-center">
                                <h4
                                  className={cn(
                                    "text-[12px] font-semibold mb-0.5 tracking-tight leading-none",
                                    isAtrasado
                                      ? "text-amber-800 dark:text-amber-500"
                                      : "text-emerald-800 dark:text-emerald-500",
                                  )}
                                >
                                  Resultado da operação
                                </h4>
                                <p
                                  className={cn(
                                    "text-[10px] font-normal leading-tight",
                                    isAtrasado
                                      ? "text-amber-700/80 dark:text-amber-400/80"
                                      : "text-emerald-700/80 dark:text-emerald-400/80",
                                  )}
                                >
                                  {isAtrasado
                                    ? "Não foi concluído no prazo estabelecido."
                                    : "Dentro do prazo estabelecido."}
                                </p>
                              </div>
                            </div>

                            <div className="pt-2 border-t border-gray-100 dark:border-gray-800/60">
                              <button
                                className="w-full h-8 px-4 text-[11px] font-semibold text-red-600 bg-red-50 dark:bg-red-500/10 dark:border-red-500/20 hover:bg-red-100 dark:bg-red-500/20 border-none shadow-none rounded-lg flex items-center justify-center gap-1.5 transition-colors"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setJobToDelete(job.id);
                                }}
                              >
                                <Trash2 size={14} />
                                Excluir do Histórico
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="bg-white dark:bg-[#1A1F26] border border-gray-100 dark:border-[#2A2F3A] rounded-[20px] p-8 text-center shadow-sm dark:shadow-none border-dashed">
                  <p className="text-[14px] text-gray-500 dark:text-[#a1a1aa] font-medium">
                    Nenhum histórico disponível
                  </p>
                </div>
              )}
            </div>
          </div>
          </div>
        )}

        {visitedTabs.has("history") && (
          <div className={cn(activeTab !== "history" && "hidden")}>
            <TripHistory
            hideHeader={true}
            hideDriverFilter={true}
            defaultDriverName={driver.name}
            defaultDriverId={driver.id}
            isInsideAdminTab={true}
            companyId={viewedCompanyId || undefined}
          />
          </div>
        )}

        {visitedTabs.has("reports") && (
          <div className={cn(activeTab !== "reports" && "hidden")}>
            <Reports
            hideHeader={true}
            defaultDriverId={driver.id}
            isInsideAdminTab={true}
          />
          </div>
        )}
      </div>

      {jobToDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#1A1F26] rounded-2xl shadow-xl w-full max-w-[320px] p-6 flex flex-col items-center text-center">
            <div className="w-12 h-12 bg-red-100 dark:bg-red-500/20 text-red-600 rounded-full flex items-center justify-center mb-4">
              <Trash2 size={24} />
            </div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-[#fafafa] mb-2">
              Excluir do Histórico?
            </h3>
            <p className="text-[13px] text-gray-500 dark:text-[#a1a1aa] mb-6">
              Esta ação removerá o contrato do histórico do motorista. Não
              afetará as estatísticas globais, apenas este registro.
            </p>
            <div className="flex items-center gap-3 w-full">
              <Button
                variant="outline"
                className="flex-1 h-10 border-gray-200 dark:border-[#2A2F3A] hover:bg-gray-50 dark:hover:bg-[#3f3f46] text-gray-700 dark:text-[#d4d4d8] font-semibold text-[13px]"
                onClick={() => setJobToDelete(null)}
              >
                Cancelar
              </Button>
              <Button
                className="flex-1 h-10 bg-red-600 hover:bg-red-700 text-white font-semibold text-[13px]"
                onClick={() => {
                  deleteJob(jobToDelete);
                  setExpandedJobId(null);
                  setJobToDelete(null);
                }}
              >
                Excluir
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
