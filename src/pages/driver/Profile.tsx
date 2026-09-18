import { resolveDriverPhoto } from '../../lib/resolveDriverPhoto';
import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Dashboard from "./Dashboard";
import { useOperationalStore, useSessionStore, type User } from "../../context/AppContext";
import { useCompanyStore } from "../../context/CompanyContext";
import { Button } from "../../components/ui/Button";
import { StableImage } from "../../components/common/StableImage";
import { OperationProgressBar } from "../../components/common/OperationProgressBar";
import { cn, getJobRealTimestamp, getNomeContratoHistorico } from "../../lib/utils";
import { getDriverLevelData } from "../../lib/levelUtils";
import { getFilteredTrips, getTodayRange, getWeeklyRange, getMonthlyRange } from "../../lib/metricsEngine";
import { normalizeTrip, NormalizedTrip } from "../../lib/tripNormalizer";
import {
  TrendingUp,
  Target,
  BadgeCheck,
  ChevronRight,
  Crosshair,
  Route,
  X,
  Goal,
  Gauge,
  CheckCircle,
  Truck,
  Car,
  Info,
  Phone,
  Mail,
  Building2,
  Gamepad2,
  Settings,
  Package,
  Power,
  Calendar,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  Filter,
  Edit,
  ShieldCheck,
  Check,
  LayoutDashboard,
  User as UserIcon,
  Navigation,
  Lock,
  History,
  Trophy,
  DollarSign,
  Star,
  Sparkles,
  Wallet,
  Award,
  Activity,
  AlertTriangle,
  Hourglass,
  CalendarDays,
  Banknote,
} from "lucide-react";
import { createPortal } from "react-dom";
import { ProfileModal } from "../../components/ProfileModal";
import { DriverPerformanceCard } from "../../components/DriverPerformanceCard";
import { useDriverTrips } from "../../hooks/useDriverTrips";
import { resolveCompanySimulatorFilterValue, resolveSimulatorDisplayLabel } from "../../lib/simulatorOptions";
import { prepareAndCommitNavigation } from "../../lib/navigationTransition";
import { preloadRoute } from "../../lib/routePreload";
import { markProfilePerf } from "../../lib/profilePerformanceTelemetry";
import { getCanonicalTripCompanyId } from "../../lib/tripIdentity";
import { isClosedJobStatus, isRunningJobStatus, isTripRecordableJobStatus } from "../../lib/jobStatus";
import { getProLaunchAvailability } from "../../lib/proLaunchAvailability";
import {
  deriveCurrentOperationProgress,
  selectCurrentOperationJob,
} from "../../lib/currentOperation";
import { resolveTripSimulatorCode } from "../../lib/tripDistance";
import { isTrailerlessSimulator } from "../../lib/resolveSimulator";
import { launchGtoWork } from "../../services/gtoWorkLauncher";
import { GtoWorkModeDialog, type GtoWorkMode } from "../../components/GtoWorkModeDialog";
import { getSimpleAutomationSimulator, type SimpleAutomationCity } from "../../lib/simpleAutomation";
import { loadSimpleAutomationCities } from "../../services/simpleAutomationCityService";
import { launchSimpleAutomation, simpleAutomationStatusMessage } from "../../services/simpleAutomationLauncher";
import {
  clearActiveOperationSnapshot,
  readActiveOperationSnapshot,
  writeActiveOperationSnapshot,
} from "../../lib/activeOperationSnapshot";

type DriverProfileTab = "dashboard" | "profile" | "operations";

const getDriverProfileTab = (state: unknown): DriverProfileTab => {
  if (state && typeof state === "object" && "profileTab" in state) {
    const profileTab = (state as { profileTab?: unknown }).profileTab;
    if (
      profileTab === "dashboard" ||
      profileTab === "profile" ||
      profileTab === "operations"
    ) {
      return profileTab;
    }
  }

  return "dashboard";
};

function DriverProfileContent({ currentUser }: { currentUser: User }) {
  const {
    companies,
    allCompanies,
    activeCompanyId,
    setActiveCompanyId,
    memberships,
    companiesLoading,
    companyCatalogLoaded,
    companyCatalogAttempted,
    loadCompanyCatalog,
    allCompanyMembers,
  } = useCompanyStore();
  const {
    jobs,
    contracts,
    vehicles,
    trailers,
    users,
    updateUserOnlineStatus,
    requestNewJobDemand,
    simulators,
    jobsReady,
    contractsReady,
  } = useOperationalStore();
  const driverTripState = useDriverTrips(currentUser.id);
  const historicoTrips = useMemo(
    () =>
      driverTripState.trips.filter((trip) => {
        const tripCompanyId = getCanonicalTripCompanyId(trip);
        return !activeCompanyId || tripCompanyId === activeCompanyId;
      }),
    [activeCompanyId, driverTripState.trips],
  );
  const driverTripsLoading = driverTripState.loading;
  const [isSimulatorMenuOpen, setIsSimulatorMenuOpen] = useState(false);
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);
  const [isConfigMenuOpen, setIsConfigMenuOpen] = useState(false);
  const [isGtoModeDialogOpen, setIsGtoModeDialogOpen] = useState(false);
  const [isSimpleAutomationStarting, setIsSimpleAutomationStarting] = useState(false);
  const [simpleAutomationCities, setSimpleAutomationCities] = useState<SimpleAutomationCity[]>([]);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [periodFilter, setPeriodFilter] = useState<
    "all" | "hoje" | "semana" | "mes" | "custom"
  >("all");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");

  const navigate = useNavigate();
  const location = useLocation();
  const [isPageSelectorOpen, setIsPageSelectorOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<DriverProfileTab>(() =>
    getDriverProfileTab(location.state),
  );
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(new Set([activeTab]));
  // The operational panel is the first view of this route. Keep profile
  // metrics/history out of that first render; they are only needed after the
  // corresponding selector is opened.
  const needsProfileMetrics = activeTab === "profile";
  const needsOperationsHistory = activeTab === "operations";
  // Render the active view in the first committed frame. A timer here made
  // the page look unresponsive on slower WebViews.
  const [showSecondary] = useState(true);

  useEffect(() => {
    setVisitedTabs(prev => prev.has(activeTab) ? prev : new Set(prev).add(activeTab));
  }, [activeTab]);

  useEffect(() => {
    if (!needsProfileMetrics || companyCatalogLoaded || companyCatalogAttempted) return;

    // Driver-owned trips and identity are the critical first paint. Load the
    // complete company catalog in idle time for global position details.
    let cancelled = false;
    const run = () => {
      if (!cancelled) void loadCompanyCatalog();
    };
    const requestIdle = (window as any).requestIdleCallback as
      | ((callback: () => void, options?: { timeout: number }) => number)
      | undefined;
    const cancelIdle = (window as any).cancelIdleCallback as
      | ((id: number) => void)
      | undefined;

    if (requestIdle) {
      const idleId = requestIdle(run, { timeout: 1_200 });
      return () => {
        cancelled = true;
        cancelIdle?.(idleId);
      };
    }

    const timer = window.setTimeout(run, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [companyCatalogAttempted, companyCatalogLoaded, loadCompanyCatalog, needsProfileMetrics]);

  // Profile, dashboard and operations are views inside one route. Store the
  // selected view in React Router so browser/WebView Back restores the
  // previous view instead of leaving the profile or closing the APK.
  useEffect(() => {
    const nextTab = getDriverProfileTab(location.state);
    setVisitedTabs((previous) =>
      previous.has(nextTab) ? previous : new Set(previous).add(nextTab),
    );
    setActiveTab(nextTab);
  }, [location.state]);

  const selectProfilePage = (pageId: string) => {
    setIsPageSelectorOpen(false);

    if (pageId === "history") {
      void prepareAndCommitNavigation(
        () => preloadRoute("/driver/history"),
        () => navigate("/driver/history")
      );
      return;
    }

    if (pageId === "reports") {
      void prepareAndCommitNavigation(
        () => preloadRoute("/driver/reports"),
        () => navigate("/driver/reports")
      );
      return;
    }

    const nextTab = pageId as DriverProfileTab;
    if (nextTab === activeTab) return;

    const currentState =
      location.state && typeof location.state === "object"
        ? (location.state as Record<string, unknown>)
        : {};

    void prepareAndCommitNavigation(
      () => {},
      () => {
        setVisitedTabs((previous) =>
          previous.has(nextTab) ? previous : new Set(previous).add(nextTab),
        );
        setActiveTab(nextTab);
        navigate(location.pathname, {
          state: {
            ...currentState,
            profileTab: nextTab,
          },
          replace: true
        });
      }
    );
  };

  const contractsMap = useMemo(
    () => new Map(contracts.map((contract) => [contract.id, contract])),
    [contracts],
  );
  const vehiclesMap = useMemo(
    () => new Map(vehicles.map((vehicle) => [vehicle.id, vehicle])),
    [vehicles],
  );
  const trailersMap = useMemo(
    () => new Map(trailers.map((trailer) => [trailer.id, trailer])),
    [trailers],
  );

  // The active operation must use the same source-of-truth selector as the
  // authenticated shell and native Pro bridge. This avoids a stale operation
  // when multiple jobs are open or snapshots arrive in different orders.
  const activeJob = useMemo(
    () => selectCurrentOperationJob(jobs, currentUser.id, activeCompanyId),
    [activeCompanyId, currentUser.id, jobs],
  );
  const activeContract = activeJob
    ? contractsMap.get(activeJob.contractId)
    : null;
  const [cachedOperationSnapshot, setCachedOperationSnapshot] = useState(() =>
    readActiveOperationSnapshot(currentUser.id, activeCompanyId),
  );
  const cachedOperationJob =
    !jobsReady && cachedOperationSnapshot?.job && isRunningJobStatus(
      String(cachedOperationSnapshot.job.status || ""),
    )
      ? cachedOperationSnapshot.job
      : null;
  const cachedOperationContract = cachedOperationJob
    ? cachedOperationSnapshot?.contract || null
    : null;
  // The local snapshot is a first-paint fallback only. Once the jobs listener
  // confirms its server-backed state, an absent open job must render the empty
  // active-operation state instead of a completed historical operation.
  const displayActiveJob = activeJob || cachedOperationJob;
  const displayActiveContract = activeJob
    ? activeContract
    : cachedOperationContract;
  const displayJobData = (displayActiveJob || {}) as Record<string, any>;
  const displayContractData = (displayActiveContract || {}) as Record<string, any>;
  const trailerlessSimulator = isTrailerlessSimulator(
    displayActiveContract || companies.find((company) => company.id === activeCompanyId),
    simulators as unknown[],
  );
  const activeVehicle =
    displayActiveJob && displayActiveJob.vehicleId
      ? vehiclesMap.get(String(displayActiveJob.vehicleId))
      : null;
  const activeTrailerId = trailerlessSimulator
    ? ""
    : displayActiveJob?.trailerId || displayActiveContract?.trailerId;
  const activeTrailer = activeTrailerId
    ? trailersMap.get(String(activeTrailerId))
    : null;
  const activeOperationName = String(
      displayContractData.name ||
      displayJobData.contractName ||
      displayJobData.name ||
      "Operação atual",
  );
  const activeOperationTotalDeliveries = Math.max(
    0,
    Number(
      displayContractData.totalDeliveries ??
        displayJobData.totalDeliveries ??
        0,
    ) || 0,
  );
  // A confirmed jobs snapshot is authoritative for actions. A scoped local
  // projection may paint the operation while contract/catalog details refresh.
  const activeOperationResolved =
    jobsReady && (!activeJob || Boolean(activeContract) || contractsReady);
  const activeOperationCardJob =
    displayActiveJob &&
    displayActiveContract &&
    activeOperationResolved &&
    isRunningJobStatus(displayActiveJob.status) &&
    displayActiveContract.status !== "completed"
      ? displayActiveJob
      : null;

  useEffect(() => {
    setCachedOperationSnapshot(
      readActiveOperationSnapshot(currentUser.id, activeCompanyId),
    );
  }, [activeCompanyId, currentUser.id]);

  useEffect(() => {
    if (!activeCompanyId || !currentUser.id) return;
    if (activeJob) {
      writeActiveOperationSnapshot(
        currentUser.id,
        activeCompanyId,
        activeJob as unknown as Record<string, unknown>,
        activeContract as unknown as Record<string, unknown> | null,
      );
      setCachedOperationSnapshot(
        readActiveOperationSnapshot(currentUser.id, activeCompanyId),
      );
      return;
    }
    if (jobsReady) {
      clearActiveOperationSnapshot(currentUser.id, activeCompanyId);
      setCachedOperationSnapshot(null);
    }
  }, [
    activeCompanyId,
    activeContract,
    activeJob,
    currentUser.id,
    jobsReady,
  ]);

  // Historical jobs logic (xp calculation only looks at completed)
  const allDriverJobs = useMemo(
    () => {
      if (!needsOperationsHistory) return [];
      return jobs.filter(
        (job) =>
          job.driverId === currentUser.id && job.id !== activeJob?.id,
      );
    },
    [activeJob?.id, currentUser.id, jobs, needsOperationsHistory],
  );
  const pastJobs = useMemo(
    () => allDriverJobs.filter((job) => job.status === "completed"),
    [allDriverJobs],
  );

  const filteredHistoryJobs = useMemo(() => {
    if (!needsOperationsHistory) return [];
    return pastJobs
      .filter((job) => {
        if (periodFilter === "all") return true;

        const dateStr =
          job.completedAt || job.createdAt || new Date().toISOString();
        const jobDate = new Date(dateStr);

        if (periodFilter === "hoje") {
          const { start, end } = getTodayRange();
          return jobDate >= start && jobDate <= end;
        }

        if (periodFilter === "semana") {
          const { start, end } = getWeeklyRange();
          return jobDate >= start && jobDate <= end;
        }

        if (periodFilter === "mes") {
          const { start, end } = getMonthlyRange();
          return jobDate >= start && jobDate <= end;
        }

        if (periodFilter === "custom") {
          if (customStartDate) {
            const start = new Date(`${customStartDate}T00:00:00.000Z`);
            if (jobDate < start) return false;
          }
          if (customEndDate) {
            const end = new Date(`${customEndDate}T23:59:59.999Z`);
            if (jobDate > end) return false;
          }
          return true;
        }
        return true;
      })
      .sort((a, b) => {
        const tsA = getJobRealTimestamp(a, historicoTrips);
        const tsB = getJobRealTimestamp(b, historicoTrips);

        const contractA = getNomeContratoHistorico(
          a,
          contractsMap.get(a.contractId),
        );
        const contractB = getNomeContratoHistorico(
          b,
          contractsMap.get(b.contractId),
        );

        if (tsB !== tsA) return tsB - tsA;
        return contractA.localeCompare(contractB);
      });
  }, [
    contractsMap,
    customEndDate,
    customStartDate,
    historicoTrips,
    needsOperationsHistory,
    pastJobs,
    periodFilter,
  ]);

  const displayDeliveries =
    filteredHistoryJobs.reduce((acc, job) => acc + job.progress, 0) +
    (periodFilter === "all" && activeJob ? activeJob.progress : 0);
  const displayCompleted = filteredHistoryJobs.filter(
    (j) => j.status === "completed",
  ).length;

  const levelData = useMemo(
    () => {
      if (!needsProfileMetrics) {
        return { displayLevel: 1, currentLevelXp: 0, xpProgress: 0 };
      }
      return getDriverLevelData(
        currentUser.id,
        jobs,
        contracts,
        historicoTrips,
      );
    },
    [contracts, currentUser.id, historicoTrips, jobs, needsProfileMetrics],
  );
  const displayLevel = levelData.displayLevel;
  const currentLevelXp = levelData.currentLevelXp;
  const xpProgress = levelData.xpProgress;

  const normalizedAllTrips = useMemo(
    () => (needsProfileMetrics || needsOperationsHistory
      ? historicoTrips.map((t: any) => normalizeTrip(t))
      : []),
    [historicoTrips, needsOperationsHistory, needsProfileMetrics],
  );
  
  const filteredDriverTrips = useMemo(() => {
    if (!needsProfileMetrics) return [];
    return getFilteredTrips(normalizedAllTrips, undefined, undefined, undefined, undefined, companies, currentUser.id);
  }, [normalizedAllTrips, currentUser.id, companies, needsProfileMetrics]);

    const activeJobProgress = useMemo(
    () =>
      deriveCurrentOperationProgress(
        displayActiveJob as any,
        driverTripState.trips,
        currentUser.id,
      ),
    [currentUser.id, displayActiveJob, driverTripState.trips],
  );

  const activeGtoDelivery = (() => {
    const deliveries = activeContract?.deliveries || [];
    if (!deliveries.length) return undefined;
    const progress = Math.max(0, Number(activeJob?.progress) || 0);
    return deliveries[Math.min(progress, deliveries.length - 1)];
  })();

  const totalGanhos = useMemo(
    () =>
      filteredDriverTrips.reduce(
        (total, trip) => total + trip.normalizedValor,
        0,
      ),
    [filteredDriverTrips],
  );
  const totalViagens = filteredDriverTrips.length;

  const currentActiveCompany = useMemo(
    () =>
      activeCompanyId
        ? companies.find((company) => company.id === activeCompanyId)
        : null,
    [activeCompanyId, companies],
  );
  const simpleAutomationSimulator = useMemo(
    () =>
      getSimpleAutomationSimulator(currentActiveCompany, simulators as unknown[]) ||
      getSimpleAutomationSimulator(activeContract, simulators as unknown[]) ||
      getSimpleAutomationSimulator(activeJob, simulators as unknown[]),
    [currentActiveCompany, activeContract, activeJob, simulators],
  );
  const isGtoWork =
    resolveTripSimulatorCode(currentActiveCompany as any, simulators as any[]) === "GTO" ||
    resolveTripSimulatorCode(activeContract as any, simulators as any[]) === "GTO" ||
    resolveTripSimulatorCode(activeJob as any, simulators as any[]) === "GTO";
  // GTO exposes both automatic modes: simple without projection and Max with projection.
  const isSimpleAutomationWork = Boolean(simpleAutomationSimulator);

  useEffect(() => {
    let cancelled = false;
    if (!simpleAutomationSimulator) {
      setSimpleAutomationCities([]);
      return () => {
        cancelled = true;
      };
    }
    void loadSimpleAutomationCities(simpleAutomationSimulator.key)
      .then((cities) => {
        if (!cancelled) setSimpleAutomationCities(cities);
      })
      .catch((error) => {
        console.error("[NVU] Falha ao carregar cidades do modo Pro no perfil", error);
        if (!cancelled) setSimpleAutomationCities([]);
      });
    return () => {
      cancelled = true;
    };
  }, [simpleAutomationSimulator]);

  const handleTripAction = async () => {
    const proAvailability = getProLaunchAvailability({
      job: activeJob,
      totalDeliveries: activeOperationTotalDeliveries,
      hasContract: Boolean(activeContract),
      hasUser: Boolean(currentUser),
      hasCompany: Boolean(currentActiveCompany),
    });

    if (isSimpleAutomationWork && !proAvailability.canLaunch) {
      alert(proAvailability.message);
      return;
    }

    if (!isSimpleAutomationWork && (!activeJob || !activeContract || !currentActiveCompany || !isTripRecordableJobStatus(activeJob.status, activeJobProgress, activeOperationTotalDeliveries))) {
      alert(
        isGtoWork
          ? "Inicie uma operação para começar o trabalho no GTO."
          : "Inicie uma operação para lançar viagens.\n\n1. Receba um contrato.\n2. Inicie o contrato.\n3. Após iniciar a operação você poderá registrar suas viagens.",
      );
      return;
    }

    if (isSimpleAutomationWork || isGtoWork) {
      setIsGtoModeDialogOpen(true);
      return;
    }

    navigate("/driver/trip");
  };

  const startSimpleAutomation = async () => {
    if (!simpleAutomationSimulator) return;
    const proAvailability = getProLaunchAvailability({
      job: activeJob,
      totalDeliveries: activeOperationTotalDeliveries,
      hasContract: Boolean(activeContract),
      hasUser: Boolean(currentUser),
      hasCompany: Boolean(currentActiveCompany),
    });
    if (!proAvailability.canLaunch) {
      alert(proAvailability.message);
      return;
    }
    if (!simpleAutomationCities.length) {
      alert(`Nenhuma cidade cadastrada para ${simpleAutomationSimulator.shortLabel}. Peça ao Painel Sênior para usar Gerenciar cidades.`);
      return;
    }
    setIsSimpleAutomationStarting(true);
    try {
      const result = await launchSimpleAutomation(
        simpleAutomationSimulator.key,
        simpleAutomationCities,
        currentActiveCompany.companyName || currentActiveCompany.name || "Empresa",
        {
          companyId: currentActiveCompany.id,
          driverId: currentUser?.id,
          jobId: String(displayActiveJob?.id || ""),
          contractId: String(displayActiveContract?.id || ""),
          operationName: activeOperationName,
          contractName: String(displayContractData.name || displayJobData.contractName || ""),
          jobProgress: activeJobProgress,
          jobTotalDeliveries: activeOperationTotalDeliveries,
          jobStatus: String(displayActiveJob?.status || activeJob?.status || ""),
          operationClosed: isClosedJobStatus(
            displayActiveJob?.status || activeJob?.status,
            activeJobProgress,
            activeOperationTotalDeliveries,
          ),
          vehicleName: activeVehicle?.name || "",
          trailerName: activeTrailer?.name || "",
        },
      );
      if (result.status === "opened") {
        setIsGtoModeDialogOpen(false);
        return;
      }
      alert(simpleAutomationStatusMessage(result));
    } finally {
      setIsSimpleAutomationStarting(false);
    }
  };

  const startGtoAutomatic = async () => {
    if (!activeJob || !activeContract || !currentActiveCompany || !isTripRecordableJobStatus(activeJob.status)) {
      alert("Inicie uma operação para começar o trabalho no GTO.");
      return;
    }

    try {
      const result = await launchGtoWork({
        driverId: currentUser.id,
        driverName: currentUser.name,
        companyId: currentActiveCompany.id,
        companyName:
          currentActiveCompany.companyName || currentActiveCompany.name || "Empresa",
        jobId: activeJob.id,
        jobStatus: activeJob.status,
        jobProgress: activeJob.progress || 0,
        jobTotalDeliveries: activeContract.totalDeliveries || 0,
        contractId: activeContract.id,
        contractName: activeContract.name || "",
        vehicleId: activeVehicle?.id || "",
        vehicleName: activeVehicle?.name || "",
        trailerId: activeTrailer?.id || "",
        trailerName: activeTrailer?.name || "",
        expectedGtoOrigin: activeGtoDelivery?.origin || "",
        expectedGtoDestination: activeGtoDelivery?.destination || "",
      });

      if (result.status === "not-native") {
        alert("Iniciar trabalho GTO está disponível no aplicativo Android NVU.");
      } else if (result.status === "module-missing") {
        alert("Este APK não possui o módulo GTO atualizado. Instale a versão atual do aplicativo.");
      } else if (result.status === "gto-missing") {
        alert("Global Truck Online não foi encontrado neste aparelho.");
      } else if (result.status === "screen-capture-denied") {
        alert("Autorize a leitura da tela para iniciar o trabalho GTO. O simulador só será aberto depois que o Android confirmar essa autorização.");
      } else if (result.status === "job-not-ready") {
        alert("Inicie a operação antes de abrir o trabalho GTO.");
      } else if (result.status === "job-closed") {
        alert("Operação concluída. Inicie uma nova operação para continuar.");
      } else if (result.status === "observer-failed") {
        alert(result.message || "O Observador GTO não conseguiu iniciar corretamente.");
      }
    } catch (error) {
      console.error("Falha ao iniciar trabalho GTO:", error);
      alert("Não foi possível abrir o trabalho GTO. Tente novamente.");
    }
  };

  const handleGtoModeSelect = async (mode: GtoWorkMode) => {
    setIsGtoModeDialogOpen(false);
    if (mode === "print") {
      navigate("/driver/trip?mode=print");
      return;
    }
    if (mode === "simple") {
      await startSimpleAutomation();
      return;
    }
    await startGtoAutomatic();
  };

  const getSimulatorLabel = (company: any) =>
    resolveSimulatorDisplayLabel(
      company,
      simulators as any[],
      companies as any[],
    ) || company?.simulatorName || "";

  const [globalRank, setGlobalRank] = useState<{
    position: number;
    total: number;
    diffToNext: number | null;
  } | null>(null);

  const simulatorCompanies = useMemo(() => {
    const membershipCompanyIds = new Set(memberships?.map(m => m.companyId) || []);
    return companies.filter((c) => membershipCompanyIds.has(c.id));
  }, [companies, memberships]);

  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }),
    [],
  );

  useEffect(() => {
    if (!needsProfileMetrics) {
      setGlobalRank(null);
      return;
    }
    if (!currentActiveCompany?.id || !currentUser?.id) {
      setGlobalRank(null);
      return;
    }

    // Reutiliza os dados que já chegam pelo AppContext/useTripHistory.
    // Antes deste ajuste, esta tela abria um segundo listener de viagens da
    // empresa e outro listener de companyMembers para calcular o mesmo ranking.
    const earningsByDriver: Record<string, number> = {};

    historicoTrips.forEach((data) => {
      const mId = data.motoristaId;
      if (!mId) return;
      const valor = Number(data.valor) || 0;
      earningsByDriver[mId] = (earningsByDriver[mId] || 0) + valor;
    });

    const driversInCompany = new Set<string>();
    allCompanyMembers
      .filter((member) => member.companyId === currentActiveCompany.id)
      .forEach((member) => {
        if (member.userId) driversInCompany.add(member.userId);
      });

    Object.keys(earningsByDriver).forEach((driverId) =>
      driversInCompany.add(driverId),
    );
    driversInCompany.add(currentUser.id);

    const leaderboard = Array.from(driversInCompany).map((driverId) => ({
      id: driverId,
      ganhos: earningsByDriver[driverId] || 0,
    }));

    leaderboard.sort((a, b) => b.ganhos - a.ganhos);

    const position =
      leaderboard.findIndex((item) => item.id === currentUser.id) + 1;

    let diffToNext: number | null = null;
    if (position > 1) {
      const nextPerson = leaderboard[position - 2];
      const currentGanhos = earningsByDriver[currentUser.id] || 0;
      diffToNext = nextPerson.ganhos - currentGanhos;
    }

    setGlobalRank({
      position: position > 0 ? position : leaderboard.length,
      total: leaderboard.length,
      diffToNext,
    });
  }, [
    currentActiveCompany?.id,
    currentUser?.id,
    historicoTrips,
    allCompanyMembers,
    needsProfileMetrics,
  ]);

  const handleRequestWork = async () => {
    try {
      if (currentUser.isOnline) {
        await requestNewJobDemand();
        alert("Solicitação de novo trabalho enviada para a administração.");
      } else {
        alert(
          "Você precisa estar disponível (Online) para solicitar trabalho.",
        );
      }
    } catch (e: any) {
      console.error(e);
      alert(e.message || "Erro ao solicitar trabalho.");
    }
  };

  const currentMembership = activeCompanyId
    ? currentUser.memberships?.[activeCompanyId] ||
      memberships.find((m) => m.companyId === activeCompanyId)
    : null;
  const currentFormattedDate = (currentMembership as any)?.joinedAt
    ? new Date((currentMembership as any).joinedAt).toLocaleDateString("pt-BR")
    : "Recente";

  const pageOptions = [
    { id: "dashboard", label: "Painel Operacional", icon: LayoutDashboard },
    { id: "profile", label: "Meu Perfil", icon: UserIcon },
    { id: "history", label: "Histórico de Viagens", icon: History },
    { id: "operations", label: "Histórico de Operações", icon: Package },
    { id: "reports", label: "Relatórios", icon: Activity },
  ];

  const activePageDetails =
    pageOptions.find((p) => p.id === activeTab) || pageOptions[0];
  const ActiveIcon = activePageDetails.icon;

  const renderPageSelector = () => (
    <div className="nvu-profile-company-bar w-full flex flex-col gap-2 sm:gap-3 mt-1 sm:mt-2 mb-2 sm:mb-3 z-20">
      <div className="w-full flex flex-row items-stretch justify-between gap-2 sm:gap-4">
        <div
          className={cn(
            "min-w-0 sm:flex-1",
            activeTab === "dashboard" ? "flex-[4.5]" : "flex-1",
          )}
        >
          <button
            onClick={() => setIsPageSelectorOpen(!isPageSelectorOpen)}
            className="w-full h-9 sm:h-[56px] bg-white dark:bg-[#1A1F26] border border-slate-200 dark:border-[#2A2F3A] rounded-lg sm:rounded-[12px] px-2 sm:px-4 flex items-center justify-center gap-1.5 sm:gap-[12px] shadow-sm active:scale-[0.99] transition-transform"
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
                "text-slate-400 shrink-0 transition-transform sm:!w-[20px] sm:!h-[20px]",
                isPageSelectorOpen && "rotate-180",
              )}
            />
          </button>
        </div>

        {activeTab === "dashboard" && (
          <div className="min-w-0 sm:flex-1 flex-[5.5]">
            <button
              onClick={() => void handleTripAction()}
              className={cn(
                "w-full h-9 sm:h-[56px] rounded-lg sm:rounded-[12px] shadow-sm flex items-center justify-center gap-1.5 sm:gap-[12px] transition-colors",
                activeJob && isTripRecordableJobStatus(activeJob.status)
                  ? "bg-[#1f242d] hover:bg-[#2a303c] active:bg-[#151921] text-white dark:bg-slate-200 dark:hover:bg-slate-300 dark:text-slate-800"
                  : "bg-gray-400 dark:bg-gray-600 text-white cursor-not-allowed opacity-80",
              )}
            >
              {activeJob && isTripRecordableJobStatus(activeJob.status) ? (
                <Navigation
                  size={14}
                  className="shrink-0 sm:!w-[20px] sm:!h-[20px]"
                />
              ) : (
                <Lock
                  size={14}
                  className="shrink-0 sm:!w-[20px] sm:!h-[20px]"
                />
              )}
              <span className="text-[11px] sm:text-[16px] font-semibold tracking-wide sm:tracking-normal leading-none sm:leading-none">
                Iniciar trabalho
              </span>
            </button>
          </div>
        )}

        {activeTab === "profile" && (
          <div className="shrink-0 relative">
            <button
              onClick={() => setIsConfigMenuOpen(!isConfigMenuOpen)}
              className="w-9 h-9 sm:w-[56px] sm:h-[56px] bg-white dark:bg-[#1A1F26] border border-slate-200 dark:border-[#2A2F3A] rounded-lg sm:rounded-[12px] flex items-center justify-center shadow-sm active:scale-[0.99] transition-transform hover:bg-slate-50 dark:hover:bg-[#2A2F3A]"
            >
              <Settings
                size={16}
                className="text-slate-600 dark:text-slate-400 sm:!w-[22px] sm:!h-[22px]"
              />
            </button>

            {isConfigMenuOpen && (
              <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-[#1A1F26] border border-slate-200 dark:border-[#2A2F3A] rounded-lg shadow-lg overflow-hidden z-30 animate-in fade-in zoom-in-95">
                <button
                  onClick={() => {
                    setIsConfigMenuOpen(false);
                    setIsEditProfileOpen(true);
                  }}
                  className="w-full flex items-center gap-2 px-4 py-3 text-[13px] text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#2A2F3A] transition-colors"
                >
                  <Edit size={16} className="text-slate-500" />
                  Editar Perfil
                </button>
                <button
                  onClick={() => {
                    setIsConfigMenuOpen(false);
                    setIsInfoOpen(!isInfoOpen);
                  }}
                  className="w-full flex items-center gap-2 px-4 py-3 text-[13px] text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#2A2F3A] transition-colors border-t border-slate-100 dark:border-slate-800/60"
                >
                  <Info size={16} className="text-slate-500" />
                  {isInfoOpen ? "Ocultar Info" : "Ver Informações"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {isPageSelectorOpen && (
        <div className="w-full bg-white dark:bg-[#1A1F26] border border-slate-200 dark:border-[#2A2F3A] rounded-lg shadow-sm overflow-hidden animate-in fade-in slide-in-from-top-2">
          {pageOptions.map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.id}
                onClick={() => selectProfilePage(opt.id)}
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
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div className="w-full flex flex-col gap-3 sm:gap-4 pb-8">
      <GtoWorkModeDialog
        open={isGtoModeDialogOpen}
        variant={isGtoWork ? "gto" : "simple"}
        simulatorLabel={simpleAutomationSimulator?.shortLabel}
        busy={isSimpleAutomationStarting}
        onClose={() => setIsGtoModeDialogOpen(false)}
        onSelect={handleGtoModeSelect}
      />

      {/* iOS Style Nav Bar Content */}
      <div className="flex items-center justify-center px-4 py-0 sm:py-2"></div>

      <div className="nvu-profile-stack space-y-3 sm:space-y-4 w-full box-border">
        {/* Action Buttons */}

        {/* Profile Header — hero visual inspirado na referência; handlers preservados. */}
        <section
          data-nvu-profile-banner
          className="nvu-profile-hero relative isolate -mx-2 -mt-2 h-[300px] min-h-0 overflow-hidden rounded-b-[18px] bg-[#0e1d29] shadow-[0_18px_45px_rgba(7,23,37,0.18)] sm:-mx-4 sm:-mt-4 sm:h-[320px] sm:rounded-b-[22px]"
          onClick={() => window.dispatchEvent(new CustomEvent("nvu-profile-banner-tapped", { detail: { scope: "driver" } }))}
        >
          <div className="absolute inset-0 overflow-hidden rounded-b-[18px] sm:rounded-b-[22px]">
            {resolveDriverPhoto(currentUser) ? (
              <StableImage
                src={resolveDriverPhoto(currentUser)}
                alt=""
                loading="eager"
                decoding="async"
                fetchPriority="high"
                wrapperClassName="absolute inset-0 h-full w-full"
                className="object-cover object-[center_30%] opacity-100"
                referrerPolicy="no-referrer"
                fallback={<span className="h-full w-full bg-[radial-gradient(circle_at_72%_22%,#1a5362_0%,#102839_46%,#07131e_100%)]" />}
              />
            ) : (
              <div className="h-full w-full bg-[radial-gradient(circle_at_72%_22%,#1a5362_0%,#102839_46%,#07131e_100%)]" />
            )}
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(4,16,28,0.02)_0%,rgba(4,16,28,0.06)_42%,rgba(4,16,28,0.40)_100%)]" />
            <div className="absolute inset-y-0 left-0 w-2/3 bg-[linear-gradient(90deg,rgba(4,16,28,0.26)_0%,rgba(4,16,28,0.18)_62%,transparent_100%)]" />
          </div>

          <div className="relative z-10 flex h-full min-h-0 flex-col justify-end p-4 pb-5 pt-[calc(env(safe-area-inset-top)+3.75rem)] sm:p-6 sm:pb-6 sm:pt-[calc(env(safe-area-inset-top)+3.75rem)]">
            <div className="flex items-end justify-between gap-4 sm:gap-6">
              <div className="flex min-w-0 flex-1 items-end gap-3 sm:gap-4">
                <div className="flex h-11 w-1 shrink-0 items-center justify-center rounded-full bg-[#13c9b4] shadow-[0_0_18px_rgba(19,201,180,0.55)] sm:h-16" />
                <div className="min-w-0 text-white">
                  <div className="flex items-center gap-2">
                    <UserIcon size={19} className="shrink-0 text-white/95 sm:h-6 sm:w-6" />
                    <h2 className="truncate text-[18px] font-extrabold leading-tight tracking-[-0.02em] text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.65)] sm:text-[22px]">{currentUser.name}</h2>
                  </div>
                  <p className="mt-1 text-[12px] font-medium text-white/90 sm:text-[14px]">
                    {currentUser.roles?.includes("admin") ? "Administrador" : "Motorista Parceiro"}
                  </p>
                </div>
              </div>

              <div className="relative w-[118px] shrink-0 self-end rounded-xl border border-white/25 bg-slate-950/12 p-1 shadow-[0_6px_18px_rgba(0,0,0,0.12)] backdrop-blur-sm sm:w-[134px] sm:rounded-2xl sm:p-1.5">
                <span className="block px-1 text-[8px] font-bold uppercase tracking-[0.17em] text-white/75 sm:text-[9px]">Simulador</span>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    setIsSimulatorMenuOpen(!isSimulatorMenuOpen);
                  }}
                  className="mt-0.5 flex w-full items-center justify-between gap-1 rounded-lg border border-white/35 bg-white/8 px-1.5 py-1 text-left transition-colors hover:bg-white/15 active:scale-[0.98] sm:px-2 sm:py-1.5"
                  aria-expanded={isSimulatorMenuOpen}
                  aria-haspopup="listbox"
                >
                  <span className="flex min-w-0 items-center gap-1 text-[10px] font-bold text-white sm:text-[11px]">
                    <Truck size={15} className="shrink-0 text-white/95 sm:h-4 sm:w-4" />
                    <span className="truncate">{getSimulatorLabel(currentActiveCompany) || "G. Truck"}</span>
                  </span>
                  <ChevronDown size={15} className={cn("shrink-0 text-white/90 transition-transform", isSimulatorMenuOpen && "rotate-180")} />
                </button>
              </div>
            </div>
          </div>
        </section>

        {isSimulatorMenuOpen && createPortal(
          <div
            className="nvu-simulator-modal-overlay nvu-simulator-modal-overlay-native fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/35 px-4 py-6 backdrop-blur-[2px]"
            role="presentation"
            onClick={(event) => {
              if (event.target === event.currentTarget) setIsSimulatorMenuOpen(false);
            }}
          >
            <div
              className="nvu-simulator-modal w-full max-w-[380px] max-h-[min(72vh,520px)] overflow-y-auto rounded-[28px] border border-slate-200 bg-white p-3 shadow-[0_24px_80px_rgba(15,23,42,0.30)] animate-in fade-in zoom-in-95 dark:border-[#2A2F3A] dark:bg-[#1A1F26]"
              role="dialog"
              aria-modal="true"
              aria-labelledby="profile-simulator-modal-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3 px-3 pb-2 pt-1">
                <div>
                  <p id="profile-simulator-modal-title" className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Selecione o simulador</p>
                  <p className="mt-1 text-[12px] text-slate-400 dark:text-slate-500">Escolha o ambiente de trabalho do motorista.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsSimulatorMenuOpen(false)}
                  className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-[#2A2F3A] dark:hover:text-white"
                  aria-label="Fechar seletor de simulador"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="grid gap-1.5 pt-1" role="listbox" aria-label="Simuladores disponíveis">
                {simulatorCompanies.map((c) => {
                  const isSelected = c.id === activeCompanyId;
                  return (
                    <button
                      key={c.id}
                      onClick={() => {
                        setActiveCompanyId(c.id);
                        setIsSimulatorMenuOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded-2xl border px-3.5 py-3 text-left transition-colors active:scale-[0.99]",
                        isSelected
                          ? "border-teal-300 bg-teal-50 text-slate-900 dark:border-teal-500/40 dark:bg-teal-500/10 dark:text-white"
                          : "border-transparent text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-[#2A2F3A]",
                      )}
                      role="option"
                      aria-selected={isSelected}
                    >
                      <span className="truncate text-[13px] font-semibold">{getSimulatorLabel(c) || "Global Truck"}</span>
                      {isSelected && <Check size={17} className="shrink-0 text-teal-600 dark:text-teal-300" />}
                    </button>
                  );
                })}
                {simulatorCompanies.length === 0 && (
                  <div className="px-3 py-4 text-center text-[12px] text-slate-500">Nenhum simulador disponível</div>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}

        {renderPageSelector()}

        {(visitedTabs.has("profile") || activeTab === "profile") && (
          <div className={cn(activeTab !== "profile" && "hidden", "space-y-6 sm:space-y-8")}>
            {/* Driver Details Info Card */}
            {isInfoOpen && (
              <div className="bg-white dark:bg-[#1A1F26] border border-slate-200 dark:border-[#2A2F3A] rounded-[16px] p-4 sm:p-5 shadow-sm space-y-4 animate-in fade-in slide-in-from-top-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-500/10 dark:border-blue-500/20 flex items-center justify-center shrink-0">
                      <Mail
                        size={16}
                        className="text-blue-600 dark:text-blue-400"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                        Email
                      </p>
                      <p className="text-[14px] font-bold text-slate-900 dark:text-white truncate">
                        {currentUser.email || "Não informado"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-green-50 dark:bg-green-500/10 dark:border-green-500/20 flex items-center justify-center shrink-0">
                      <Phone
                        size={16}
                        className="text-green-600 dark:text-green-400"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                        WhatsApp
                      </p>
                      <p className="text-[14px] font-bold text-slate-900 dark:text-white truncate">
                        {currentUser.whatsapp || "Não informado"}
                      </p>
                    </div>
                  </div>
                  {currentActiveCompany && (
                    <div className="flex items-center gap-3 sm:col-span-2">
                      <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-500/10 flex items-center justify-center shrink-0">
                        <Building2
                          size={16}
                          className="text-purple-600 dark:text-purple-400"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                          Empresa Ativa / Vínculo
                        </p>
                        <p className="text-[14px] font-bold text-slate-900 dark:text-white truncate">
                          {currentActiveCompany?.companyName || "Carregando..."}
                          <span className="text-slate-500 font-medium ml-1 text-[13px]">
                            • Desde {currentFormattedDate}
                          </span>
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {showSecondary && (
              needsProfileMetrics ? (
                <DriverPerformanceCard
                  historicoTrips={historicoTrips}
                  driverId={currentUser?.id}
                  activeCompanyId={activeCompanyId}
                  allCompanyMembers={allCompanyMembers}
                  users={users}
                  currentUser={currentUser}
                  globalTripsLoading={
                    historicoTrips.length === 0 &&
                    (!companyCatalogLoaded || companiesLoading)
                      ? true
                      : undefined
                  }
                  driverTripsLoading={driverTripsLoading}
                  simulatorId={resolveCompanySimulatorFilterValue(
                    currentActiveCompany,
                    simulators as Record<string, unknown>[],
                    allCompanies as Record<string, unknown>[],
                  )}
                  allCompanies={allCompanies}
                  simulators={simulators as Record<string, unknown>[]}
                  displayLevel={displayLevel}
                  currentLevelXp={currentLevelXp}
                  xpProgress={xpProgress}
                />
              ) : (
                <div className="min-h-[220px]" aria-hidden="true" />
              )
            )}
          </div>
        )}

        {(visitedTabs.has("operations") || activeTab === "operations") && (
          <div className={cn(activeTab !== "operations" && "hidden", "space-y-6 sm:space-y-8")}>
            <div className="flex flex-col gap-3">
              {!activeJob && activeOperationResolved && currentUser.isOnline && (
                <Button
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl h-12 font-bold text-[14px] shadow-sm tracking-tight transition-all"
                  onClick={handleRequestWork}
                >
                  <Package size={18} className="mr-2" />
                  Solicitar Nova Operação
                </Button>
              )}
            </div>

            {/* Date Filter */}
            <div className="flex flex-col gap-3">
              <div className="relative group w-full">
                <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-gray-400">
                  <Calendar size={16} />
                </div>
                <select
                  value={periodFilter}
                  onChange={(e) => setPeriodFilter(e.target.value as any)}
                  className="w-full appearance-none bg-slate-50 dark:bg-[#1A1F26] border border-slate-200/80 dark:border-white/5 rounded-[14px] pl-10 pr-10 py-3 text-[13px] font-bold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500/20 cursor-pointer hover:bg-slate-100 dark:hover:bg-white/5 transition-colors shadow-sm"
                >
                  <option value="all">Tudo</option>
                  <option value="hoje">Hoje</option>
                  <option value="semana">Semana Atual</option>
                  <option value="mes">Mês Atual</option>
                  <option value="custom">
                    Personalizado
                  </option>
                </select>
                <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none text-slate-400">
                  <ChevronDown size={16} />
                </div>
              </div>

              {periodFilter === "custom" && (
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 animate-in slide-in-from-top-2 duration-200">
                  <div className="flex-1">
                    <div className="relative">
                      <div className="absolute inset-y-0 left-2.5 sm:left-3 flex items-center pointer-events-none text-gray-400">
                        <Calendar size={13} />
                      </div>
                      <input
                        type="date"
                        value={customStartDate}
                        onChange={(e) => setCustomStartDate(e.target.value)}
                        className="w-full bg-gray-100 dark:bg-[#18181b] text-gray-700 dark:text-[#d4d4d8] text-[12px] sm:text-[13px] font-medium border border-transparent rounded-xl pl-8 sm:pl-9 pr-2 sm:pr-3 py-2 sm:py-2.5 focus:outline-none focus:ring-2 focus:ring-gray-900/10 dark:focus:ring-white/10 shadow-sm dark:shadow-none transition-all"
                      />
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="relative">
                      <div className="absolute inset-y-0 left-2.5 sm:left-3 flex items-center pointer-events-none text-gray-400">
                        <Calendar size={13} />
                      </div>
                      <input
                        type="date"
                        value={customEndDate}
                        onChange={(e) => setCustomEndDate(e.target.value)}
                        className="w-full bg-gray-100 dark:bg-[#18181b] text-gray-700 dark:text-[#d4d4d8] text-[12px] sm:text-[13px] font-medium border border-transparent rounded-xl pl-8 sm:pl-9 pr-2 sm:pr-3 py-2 sm:py-2.5 focus:outline-none focus:ring-2 focus:ring-gray-900/10 dark:focus:ring-white/10 shadow-sm dark:shadow-none transition-all"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Active Job Section */}
            <div>
              <h3 className="text-[11px] font-bold text-slate-500 dark:text-slate-400/80 uppercase tracking-[0.15em] mb-4 px-1">
                Operação Ativa
              </h3>
              {activeOperationCardJob ? (
                <div className="order-3 flex flex-col bg-white dark:bg-[#1A1F26] rounded-2xl sm:rounded-[24px] shadow-sm dark:shadow-none border border-gray-200 dark:border-[#2A2F3A] overflow-hidden mb-3 sm:mb-4">
                  {/* Header */}
                  <div className="relative overflow-hidden bg-[#1f242d] dark:bg-[#151921] p-3 sm:p-4 w-full">
                    {/* Subtle glow effect */}
                    <div className="absolute top-[-50%] right-[-10%] w-[150px] h-[150px] bg-white/5 rounded-full blur-[40px] pointer-events-none"></div>

                    <div className="flex justify-between items-start z-10 relative gap-3">
                      <div className="flex flex-col pr-2 min-w-0">
                        <span className="text-[8px] sm:text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1 mt-0.5">
                          Operação atual
                        </span>
                        <h3 className="font-bold text-white text-[22px] sm:text-[26px] tracking-tight leading-none mb-1.5">
                          {activeOperationName}
                        </h3>
                        <p className="text-[10px] sm:text-[11px] text-gray-400 font-medium leading-none truncate whitespace-nowrap">
                          Siga as especificações do transporte.
                        </p>
                      </div>

                      <div className="shrink-0 flex pt-0.5">
                        <span className="px-1.5 py-0.5 text-[8px] sm:text-[9px] font-semibold border border-[#0cb49f]/20 bg-[#0cb49f]/10 text-[#0cb49f] rounded-full flex items-center gap-1 whitespace-nowrap tracking-wide">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#0cb49f]"></span>
                          TRABALHO ATIVO
                        </span>
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
                            {activeJobProgress}/{activeOperationTotalDeliveries || "—"}
                        </span>
                        <span className="text-[7px] sm:text-[8px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-semibold">
                          Entregas
                        </span>
                      </div>

                      <div className="w-px h-6 bg-gray-200/60 dark:bg-[#2A2F3A] shrink-0"></div>

                      <div className="flex-1 py-1.5 flex flex-col items-center justify-center text-center">
                        <span className="text-[14px] sm:text-[16px] font-bold text-slate-800 dark:text-gray-100 leading-none tracking-tight mb-0.5">
                          {activeOperationTotalDeliveries > 0
                            ? Math.max(
                                0,
                                activeOperationTotalDeliveries - activeJobProgress,
                              )
                            : "—"}
                        </span>
                        <span className="text-[7px] sm:text-[8px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-semibold">
                          Faltam
                        </span>
                      </div>

                      <div className="w-px h-6 bg-gray-200/60 dark:bg-[#2A2F3A] shrink-0"></div>

                      <div className="flex-1 py-1.5 flex flex-col items-center justify-center text-center">
                        <span className="text-[14px] sm:text-[16px] font-bold text-slate-800 dark:text-gray-100 leading-none tracking-tight mb-0.5">
                          {activeOperationTotalDeliveries > 0
                            ? `${Math.round(
                                (activeJobProgress /
                                  activeOperationTotalDeliveries) *
                                  100,
                              )}%`
                            : "—"}
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
                          activeOperationTotalDeliveries > 0
                            ? Math.round(
                                (activeJobProgress /
                                  activeOperationTotalDeliveries) *
                                  100,
                              )
                            : 0
                        }
                        replayKey={`${location.key}:${activeTab}:${activeOperationCardJob.id}`}
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
                          {activeJob.deadlineDate
                            ? new Date(
                                activeJob.deadlineDate,
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
                            if (!displayJobData.deadlineDate) return "Não definido";
                            const diffMs =
                              new Date(displayJobData.deadlineDate).getTime() -
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
              ) : !activeOperationResolved ? (
                <div
                  className="min-h-[160px] bg-white dark:bg-[#1A1F26] border border-slate-200/80 dark:border-white/5 rounded-[24px] p-5 shadow-sm"
                  aria-live="polite"
                >
                  <div className="flex items-center gap-3 mb-5">
                    <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-white/5 animate-pulse" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 w-36 rounded bg-slate-100 dark:bg-white/5 animate-pulse" />
                      <div className="h-2.5 w-24 rounded bg-slate-100 dark:bg-white/5 animate-pulse" />
                    </div>
                  </div>
                  <div className="space-y-2.5">
                    <div className="h-10 rounded-xl bg-slate-50 dark:bg-white/[0.035] animate-pulse" />
                    <div className="h-10 rounded-xl bg-slate-50 dark:bg-white/[0.035] animate-pulse" />
                  </div>
                  <p className="mt-4 text-[12px] text-slate-500 dark:text-slate-400 font-medium text-center">
                    Sincronizando operação atual
                  </p>
                </div>
              ) : (
                <div className="bg-white dark:bg-[#1A1F26] border border-slate-200/80 dark:border-white/5 border-dashed rounded-[24px] p-8 text-center shadow-sm">
                  <p className="text-[14px] text-slate-500 dark:text-slate-400 font-medium">
                    Nenhuma operação em andamento
                  </p>
                </div>
              )}
            </div>

            {/* Job History */}
            <div className="pb-6">
              <h3 className="text-[13px] font-bold text-gray-900 dark:text-[#fafafa] mb-3 px-1">
                Histórico
              </h3>
              {filteredHistoryJobs.length > 0 ? (
                <div className="space-y-3">
                  {filteredHistoryJobs.map((job) => {
                    const contract = contractsMap.get(job.contractId);
                    const jobTrailerlessSimulator = isTrailerlessSimulator(
                      contract || currentActiveCompany,
                      simulators as unknown[],
                    );
                    const jobTrailerId = jobTrailerlessSimulator
                      ? ""
                      : job.trailerId || contract?.trailerId;
                    const vehicle = vehiclesMap.get(job.vehicleId);
                    const trailer = jobTrailerId ? trailersMap.get(jobTrailerId) : null;

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
                      if (trip.motoristaId !== currentUser.id) return false;

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
                          "bg-slate-50 dark:bg-[#1A1F26] border rounded-2xl transition-all shadow-sm overflow-hidden",
                          isExpanded
                            ? "border-slate-300 dark:border-white/20 ring-1 ring-slate-200 dark:ring-white/10"
                            : "border-slate-200/80 dark:border-white/5 hover:border-slate-300 dark:hover:border-white/10",
                        )}
                      >
                        <button
                          className="w-full flex flex-col p-4 focus:outline-none"
                          onClick={() =>
                            setExpandedJobId(isExpanded ? null : job.id)
                          }
                        >
                          <div className="flex items-center justify-between w-full">
                            <div className="flex items-center gap-3 min-w-0">
                              {/* Check / Cross */}
                              <div
                                className={cn(
                                  "w-[34px] h-[34px] rounded-full flex items-center justify-center shrink-0 border shadow-inner",
                                  isAtrasado
                                    ? "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/50"
                                    : "bg-teal-50 dark:bg-teal-950/20 border-teal-200 dark:border-teal-900/50",
                                )}
                              >
                                {isAtrasado ? (
                                  <X
                                    size={16}
                                    className="text-amber-600 dark:text-amber-400"
                                    strokeWidth={2.5}
                                  />
                                ) : (
                                  <Check
                                    size={16}
                                    className="text-teal-600 dark:text-teal-400"
                                    strokeWidth={2.5}
                                  />
                                )}
                              </div>

                              {/* Name and Badge */}
                              <div className="flex items-center gap-2.5 min-w-0">
                                <h4 className="text-[15px] sm:text-[16px] font-bold text-slate-900 dark:text-white truncate tracking-tight">
                                  {getNomeContratoHistorico(job, contract)}
                                </h4>
                                <span
                                  className={cn(
                                    "h-[18px] px-2 text-[9px] font-bold tracking-wide rounded-md uppercase flex items-center justify-center shrink-0 leading-none border",
                                    isAtrasado
                                      ? "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200/50 dark:border-amber-500/20"
                                      : "bg-teal-50 dark:bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-200/50 dark:border-teal-500/20",
                                  )}
                                >
                                  {isAtrasado
                                    ? "O prazo expirou"
                                    : "Dentro do prazo"}
                                </span>
                              </div>
                            </div>
                            <div className="text-slate-400 dark:text-slate-500 shrink-0 ml-2">
                              <ChevronRight
                                size={18}
                                className={cn(
                                  "transition-transform duration-300",
                                  isExpanded ? "rotate-90" : "",
                                )}
                              />
                            </div>
                          </div>

                          {/* Divider */}
                          <div className="h-px w-full bg-slate-200/80 dark:bg-white/5 my-3"></div>

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
                              <Truck
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
                                    {currencyFormatter.format(totalGanhos)}
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
                                "flex items-center gap-2 rounded-xl px-3 py-2 border",
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
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="bg-slate-50 dark:bg-[#1A1F26] border border-slate-200/80 dark:border-white/5 border-dashed rounded-[24px] p-8 text-center shadow-sm">
                  <p className="text-[14px] text-slate-500 dark:text-slate-400 font-medium">
                    Nenhum histórico disponível
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {(visitedTabs.has("dashboard") || activeTab === "dashboard") && (
          <div className={cn(activeTab !== "dashboard" && "hidden", "")}>
            {showSecondary && (
              <Dashboard
                isIntegrated={true}
                tripHistoryOverride={driverTripState.trips}
                tripHistoryLoadingOverride={driverTripsLoading}
                progressAnimationKey={`${location.key}:${activeTab}:dashboard`}
              />
            )}
          </div>
        )}

        <ProfileModal
          isOpen={isEditProfileOpen}
          onClose={() => setIsEditProfileOpen(false)}
        />
      </div>
    </div>
  );
}

/**
 * Session gate kept outside the feature component.
 *
 * The previous implementation returned before several hooks when the cached
 * session briefly had no user, then rendered those hooks after rehydration.
 * React rejects that hook-order change and the Motorista workspace stops
 * opening. Mounting the content only after a user exists keeps the hook graph
 * stable through login, profile switching, resume and logout.
 */
export default function Profile() {
  const { currentUser, authInitialized, sessionUiReady } = useSessionStore();
  const profilePaintMarkedRef = useRef(false);

  useLayoutEffect(() => {
    if (
      profilePaintMarkedRef.current ||
      !authInitialized ||
      !sessionUiReady ||
      !currentUser
    ) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      profilePaintMarkedRef.current = true;
      markProfilePerf("T11_PROFILE_FIRST_PAINT", {
        route: "/driver/profile",
        role: "driver",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [authInitialized, currentUser, sessionUiReady]);

  // The profile shell is independent from membership revalidation. Its
  // operation-specific hooks already expose their own local readiness states.
  if (!authInitialized || !sessionUiReady || !currentUser) {
    return (
      <div
        className="min-h-[45vh] bg-gray-50 dark:bg-[#09090b]"
        role="status"
        aria-live="polite"
      >
        <span className="sr-only">Preparando perfil do motorista</span>
      </div>
    );
  }

  return <DriverProfileContent key={currentUser.id} currentUser={currentUser} />;
}
