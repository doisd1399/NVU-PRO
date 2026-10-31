import { ProfileHero } from "../../components/common/ProfileHero";
import { ProfileCoverHero } from "../../components/common/ProfileCoverHero";
import { DriverProfileToolbar } from "../../components/driver/DriverProfileToolbar";
import type { DriverProfileView } from "../../components/driver/DriverProfileSummary";
import type { RankingAggregatePeriodType } from "../../lib/rankingAggregates";
import { ModalSelect } from "../../components/ui/ModalSelect";
import { assertWorkModeEntryAllowed, prefetchWorkModeAvailability } from "../../services/workModeAvailabilityService";
import { isWorkModeMaintenanceError } from "../../lib/workModeMaintenanceError";
import { WorkModeMaintenanceDialog } from "../../components/WorkModeMaintenanceDialog";
import { resolveDriverPhoto } from '../../lib/resolveDriverPhoto';
import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useLandscapeWorkspace } from "../../hooks/useLandscapeWorkspace";
import { useLandscapeFillHeight } from "../../hooks/useLandscapeFillHeight";
import Dashboard from "./Dashboard";
import TripHistory from "./TripHistory";
import { DriverResults } from "../../components/driver/DriverResults";
import { filterAndSortTripHistory } from "../../lib/tripHistoryEngine";
import { applySimulatorCurrencyContext } from "../../lib/metricsEngine";
import "../../components/driver/DriverWorkspace.css";
import "../../components/driver/DriverLandscape.css";
import "../../components/driver/DriverLandscapeProfile.css";
import { resolveOperationContract } from "../../lib/operationResultSummary";
import { useOperationalStore, useSessionStore, type User } from "../../context/AppContext";
import { useCompanyStore } from "../../context/CompanyContext";
import { Button } from "../../components/ui/Button";
import { StableImage } from "../../components/common/StableImage";
import { RetainedPanel } from "../../components/common/RetainedPanel";
import { useVehiclePhoto } from "../../hooks/useVehiclePhoto";
import { resolveVehiclePhotoOperationSimulatorId } from "../../lib/vehiclePhotoIdentity";
import { cn, getNomeContratoHistorico } from "../../lib/utils";
import { indexConfirmedOperationTripDates, operationJobTimestamp } from "../../lib/operationResultSummary";
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
  ClipboardList,
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
import { ProfileModal } from "../../components/ProfileModal";
import { SimulatorSelectionModal } from "../../components/SimulatorSelectionModal";
import { DriverPerformanceCard } from "../../components/DriverPerformanceCard";
import { useDriverTrips } from "../../hooks/useDriverTrips";
import { LeaveCompanyCard } from "../../components/driver/LeaveCompanyCard";
import { HistoryReadCoverageNotice } from "../../components/common/HistoryReadCoverageNotice";
import { HistoryMoneySummary } from "../../components/common/HistoryMoneySummary";
import { summarizeTripMoney } from "../../lib/tripMoneySummary";
import { resolveCompanySimulatorFilterValue, resolveSimulatorDisplayLabel } from "../../lib/simulatorOptions";
import { prepareAndCommitNavigation } from "../../lib/navigationTransition";
import { preloadRoute } from "../../lib/routePreload";
import { markProfilePerf } from "../../lib/profilePerformanceTelemetry";
import { getCanonicalTripCompanyId } from "../../lib/tripIdentity";
import { isClosedJobStatus, isRunningJobStatus, isTripRecordableJobStatus } from "../../lib/jobStatus";
import { getProLaunchAvailability } from "../../lib/proLaunchAvailability";
import {
  deriveCurrentOperationProgress,
  selectCanonicalOperationTrips,
  selectCurrentOperationJob,
  type CurrentOperationJob,
} from "../../lib/currentOperation";
import { resolveTripSimulatorCode } from "../../lib/tripDistance";
import { isTrailerlessSimulator } from "../../lib/resolveSimulator";
import { launchGtoWork } from "../../services/gtoWorkLauncher";
import { GtoWorkModeDialog, type GtoWorkMode } from "../../components/GtoWorkModeDialog";
import { getSimpleAutomationSimulator, type SimpleAutomationCity } from "../../lib/simpleAutomation";
import { getCachedSimpleAutomationCities, loadSimpleAutomationCities } from "../../services/simpleAutomationCityService";
import { launchSimpleAutomation, simpleAutomationStatusMessage } from "../../services/simpleAutomationLauncher";
import { ensureOperationIntegrity } from "../../services/operationIntegrityGuard";
import {
  clearActiveOperationSnapshot,
  readActiveOperationSnapshot,
  writeActiveOperationSnapshot,
} from "../../lib/activeOperationSnapshot";

type DriverProfileTab = "dashboard" | "profile" | "operations" | "activity" | "results";

const getDriverProfileTab = (state: unknown): DriverProfileTab => {
  if (state && typeof state === "object" && "profileTab" in state) {
    const profileTab = (state as { profileTab?: unknown }).profileTab;
    if (
      profileTab === "dashboard" ||
      profileTab === "profile" ||
      profileTab === "operations" ||
      profileTab === "activity" ||
      profileTab === "results"
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
  const [profileRankingScope, setProfileRankingScope] = useState<"internal" | "global">("global");
  const [profileView, setProfileView] = useState<DriverProfileView>("summary");
  const [profilePeriodType, setProfilePeriodType] = useState<RankingAggregatePeriodType>("mes");
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);
  const [isConfigMenuOpen, setIsConfigMenuOpen] = useState(false);
  const [isGtoModeDialogOpen, setIsGtoModeDialogOpen] = useState(false);
  const [maintenanceMode, setMaintenanceMode] = useState<GtoWorkMode | null>(null);
  const [isSimpleAutomationStarting, setIsSimpleAutomationStarting] = useState(false);
  const [isWorkModeChecking, setIsWorkModeChecking] = useState(false);
  const workModePendingRef = useRef(false);
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
  const activeTab = getDriverProfileTab(location.state);
  // Horizontal screens use the cover layout of "Painel do motorista"; portrait is untouched.
  const landscapeWorkspace = useLandscapeWorkspace();
  const landscapeDashboard = activeTab === "dashboard" && landscapeWorkspace;
  // Horizontal lists scroll inside their own card: trips, daily results and the operation history.
  const workspaceRef = useRef<HTMLDivElement>(null);
  useLandscapeFillHeight(
    landscapeWorkspace,
    workspaceRef,
    activeTab === "activity" ? ".nvu-driver-activity-list"
      : activeTab === "results" ? ".nvu-driver-daily-results"
      : activeTab === "operations" ? ".nvu-ops-history-list"
      : null,
    { alignTo: activeTab === "operations" ? '[data-testid="operation-controls-and-card"]' : undefined },
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
  const selectProfilePage = (pageId: string) => {
    setIsPageSelectorOpen(false);

    if (pageId === "news" || pageId === "ranking") {
      const path = pageId === "news" ? "/driver/news" : "/ranking";
      void prepareAndCommitNavigation(
        () => preloadRoute(path),
        () => navigate(path, pageId === "ranking"
          ? { state: { backgroundLocation: location } }
          : undefined),
      );
      return;
    }

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

    if (!["dashboard", "profile", "operations", "activity", "results"].includes(pageId)) return;
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
        navigate(location.pathname, {
          state: {
            ...currentState,
            profileTab: nextTab,
          },
          replace: false
        });
        window.scrollTo({ top: 0, behavior: "instant" });
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
  const activeContract = useMemo(
    () => resolveOperationContract(activeJob, contracts),
    [activeJob, contracts],
  );
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
        || (cachedOperationSnapshot?.vehicle as any)
        || (displayJobData.vehicleName
          ? ({
              id: String(displayActiveJob.vehicleId),
              name: String(displayJobData.vehicleName),
              plate: String(displayJobData.vehiclePlate || ""),
              companyId: activeCompanyId || "",
            } as any)
          : null)
      : null;
  const activeTrailerId = trailerlessSimulator
    ? ""
    : displayActiveJob?.trailerId || displayActiveContract?.trailerId;
  const activeTrailer = activeTrailerId
    ? trailersMap.get(String(activeTrailerId))
      || (cachedOperationSnapshot?.trailer as any)
      || (displayJobData.trailerName
        ? ({
            id: String(activeTrailerId),
            name: String(displayJobData.trailerName),
            companyId: activeCompanyId || "",
          } as any)
        : null)
    : null;
  const activeSnapshotSimulator =
    getSimpleAutomationSimulator(
      displayActiveContract || companies.find((company) => company.id === activeCompanyId),
      simulators as unknown[],
    ) || (cachedOperationSnapshot?.simulator as any) || null;
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
        {
          vehicle: activeVehicle as unknown as Record<string, unknown> | null,
          trailer: activeTrailer as unknown as Record<string, unknown> | null,
          simulator: activeSnapshotSimulator as unknown as Record<string, unknown> | null,
        },
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
    activeTrailer,
    activeVehicle,
    currentUser.id,
    jobsReady,
    activeSnapshotSimulator,
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
    const dates = indexConfirmedOperationTripDates(historicoTrips, currentUser.id);
    return pastJobs
      .filter((job) => {
        if (periodFilter === "all") return true;

        const jobDate = new Date(operationJobTimestamp(job, dates));

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
        const tsA = operationJobTimestamp(a, dates);
        const tsB = operationJobTimestamp(b, dates);

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
    currentUser.id,
    customEndDate,
    customStartDate,
    historicoTrips,
    needsOperationsHistory,
    pastJobs,
    periodFilter,
  ]);

  // History cards must never trust the denormalized job counter. Use the same
  // confirmed canonical trip set as the active-operation card.
  const canonicalProgressByJobId = useMemo(() => {
    const result = new Map<string, number>();
    for (const job of [...filteredHistoryJobs, ...(activeJob ? [activeJob] : [])]) {
      result.set(String(job.id), selectCanonicalOperationTrips(job, historicoTrips, String(currentUser.id || job.driverId || "")).length);
    }
    return result;
  }, [activeJob, filteredHistoryJobs, historicoTrips]);

  const displayDeliveries =
    filteredHistoryJobs.reduce((acc, job) => acc + (canonicalProgressByJobId.get(String(job.id)) || 0), 0) +
    (periodFilter === "all" && activeJob ? (canonicalProgressByJobId.get(String(activeJob.id)) || 0) : 0);
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
    const progress = activeJobProgress;
    return deliveries[Math.min(progress, deliveries.length - 1)];
  })();

  const currentActiveCompany = useMemo(
    () =>
      activeCompanyId
        ? companies.find((company) => company.id === activeCompanyId)
        : null,
    [activeCompanyId, companies],
  );
  const vehiclePhotoSimulatorId = resolveVehiclePhotoOperationSimulatorId(
    displayActiveJob, currentActiveCompany, "",
    simulators as unknown as Record<string, unknown>[],
    companies as unknown as Record<string, unknown>[], [displayActiveContract],
  );
  // This profile owns the visible start-work button. Share one controller
  // with its integrated Dashboard so the modal and card always use the same
  // photo, including a newly selected local/offline preview.
  const vehiclePhoto = useVehiclePhoto(
    currentUser.id && displayActiveJob?.vehicleId && vehiclePhotoSimulatorId
      ? { userId: currentUser.id, simulatorId: vehiclePhotoSimulatorId,
          vehicleId: String(displayActiveJob.vehicleId), vehicleName: activeVehicle?.name || "Veículo atual" }
      : null,
    String(displayActiveJob?.companyId || activeCompanyId || ""),
    true,
  );
  const simulatorCompanies = useMemo(() => {
    const membershipCompanyIds = new Set(memberships?.map((membership) => membership.companyId) || []);
    return companies.filter((company) => membershipCompanyIds.has(company.id));
  }, [companies, memberships]);
  const isGtoWork =
    resolveTripSimulatorCode(currentActiveCompany as any, simulators as any[]) === "GTO" ||
    resolveTripSimulatorCode(activeContract as any, simulators as any[]) === "GTO" ||
    resolveTripSimulatorCode(activeJob as any, simulators as any[]) === "GTO";
  const simpleAutomationSimulator = useMemo(
    () =>
      isGtoWork
        ? getSimpleAutomationSimulator("GTO")
        : getSimpleAutomationSimulator(currentActiveCompany, simulators as unknown[]) ||
          getSimpleAutomationSimulator(activeContract, simulators as unknown[]) ||
          getSimpleAutomationSimulator(activeJob, simulators as unknown[]),
    [currentActiveCompany, activeContract, activeJob, simulators, isGtoWork],
  );
  // An operation resolved as GTO must also have the Pro service identity.
  const isSimpleAutomationWork = Boolean(simpleAutomationSimulator);

  useEffect(() => {
    let cancelled = false;
    if (!simpleAutomationSimulator) {
      setSimpleAutomationCities([]);
      return () => {
        cancelled = true;
      };
    }
    setSimpleAutomationCities(getCachedSimpleAutomationCities(simpleAutomationSimulator.key));
    void loadSimpleAutomationCities(simpleAutomationSimulator.key)
      .then((cities) => {
        if (!cancelled) setSimpleAutomationCities(cities);
      })
      .catch((error) => {
        console.error("[NVU] Falha ao carregar cidades do modo Pro no perfil", error);
        // Keep the last known cities available when a refresh fails offline.
      });
    return () => {
      cancelled = true;
    };
  }, [simpleAutomationSimulator?.key]);

  const handleTripAction = async () => {
    const proAvailability = getProLaunchAvailability({
      job: activeJob,
      confirmedTripCount: activeJobProgress,
      totalDeliveries: activeOperationTotalDeliveries,
      hasContract: Boolean(activeContract),
      hasUser: Boolean(currentUser),
      hasCompany: Boolean(currentActiveCompany),
    });

    if ((isSimpleAutomationWork || activeJob?.operationSyncState === "pending_finish" || activeJob?.operationSyncState === "start_rejected") && !proAvailability.canLaunch) {
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
      prefetchWorkModeAvailability();
      setIsGtoModeDialogOpen(true);
      return;
    }

    navigate("/driver/trip");
  };

  const startSimpleAutomation = async (entryCheck: Promise<void>) => {
    if (!simpleAutomationSimulator) return;
    if (activeJob && activeJob.operationSyncState !== "pending_start" && typeof navigator !== "undefined" && navigator.onLine) {
      void ensureOperationIntegrity(activeJob.id, activeOperationTotalDeliveries, "pro-entry").catch((error) =>
        console.warn("[NVU] Integrity Guard do Modo Pro não concluiu; o fluxo continuará protegido pelo ACK:", error),
      );
    }
    const operationTripsForPro = activeJob ? selectCanonicalOperationTrips(activeJob, historicoTrips, String(currentUser?.id || activeJob.driverId || "")) : [];
    const proAvailability = getProLaunchAvailability({
      job: activeJob,
      confirmedTripCount: activeJobProgress,
      totalDeliveries: activeOperationTotalDeliveries,
      hasContract: Boolean(activeContract),
      hasUser: Boolean(currentUser),
      hasCompany: Boolean(currentActiveCompany),
    });
    if (!proAvailability.canLaunch) {
      alert(proAvailability.message);
      return;
    }
    setIsSimpleAutomationStarting(true);
    try {
      const cachedCities = getCachedSimpleAutomationCities(simpleAutomationSimulator.key);
      const result = await launchSimpleAutomation(
        simpleAutomationSimulator.key,
        cachedCities.length ? cachedCities : simpleAutomationCities,
        currentActiveCompany.companyName || currentActiveCompany.name || "Empresa",
        {
          companyId: currentActiveCompany.id,
          driverId: currentUser?.id,
          jobId: String(displayActiveJob?.id || ""),
          contractId: String(displayActiveContract?.id || ""),
          operationName: activeOperationName,
          contractName: String(displayContractData.name || displayJobData.contractName || ""),
          confirmedTripCount: activeJobProgress,
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
          historyTrips: operationTripsForPro,
          historyReady: driverTripState.historyReady
            && (!driverTripState.error || operationTripsForPro.length > 0),
        },
        entryCheck,
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
      if (activeJob.operationSyncState !== "pending_start") void ensureOperationIntegrity(activeJob.id, activeOperationTotalDeliveries, "pro-entry").catch((error) =>
        console.warn("[NVU] Integrity Guard do GTO não concluiu; o fluxo continuará protegido pelo ACK:", error),
      );
      const result = await launchGtoWork({
        driverId: currentUser.id,
        driverName: currentUser.name,
        companyId: currentActiveCompany.id,
        companyName:
          currentActiveCompany.companyName || currentActiveCompany.name || "Empresa",
        jobId: activeJob.id,
        jobStatus: activeJob.status,
        confirmedTripCount: activeJobProgress,
        jobProgress: activeJobProgress,
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
      alert(error instanceof Error ? error.message : "Não foi possível abrir o trabalho GTO. Tente novamente.");
    }
  };

  const selectWorkMode = async (mode: GtoWorkMode) => {
    if (["pending_finish", "start_rejected"].includes(activeJob?.operationSyncState || "")) {
      setIsGtoModeDialogOpen(false);
      alert("A ação da operação aguarda sincronização. Os registros locais foram preservados.");
      return;
    }
    const simulatorKey = isGtoWork ? "GTO" : simpleAutomationSimulator?.key || "GTO";
    if (mode === "print") {
      try {
        await assertWorkModeEntryAllowed("print", simulatorKey);
      } catch (error) {
        if (isWorkModeMaintenanceError(error)) {
          setIsGtoModeDialogOpen(false);
          setMaintenanceMode(mode);
          return;
        }
        alert(error instanceof Error ? error.message : "Não foi possível verificar a disponibilidade do modo.");
        return;
      }
      setIsGtoModeDialogOpen(false);
      navigate("/driver/trip?mode=print");
      return;
    }
    const entryCheck = assertWorkModeEntryAllowed(mode === "simple" ? "pro" : "max", simulatorKey);
    try {
      await entryCheck;
    } catch (error) {
      if (isWorkModeMaintenanceError(error)) {
        setIsGtoModeDialogOpen(false);
        setMaintenanceMode(mode);
        return;
      }
      alert(error instanceof Error ? error.message : "Não foi possível verificar o controle de viagens.");
      return;
    }
    setIsGtoModeDialogOpen(false);
    if (mode === "simple") {
      await startSimpleAutomation(entryCheck);
      return;
    }
    await startGtoAutomatic();
  };

  const handleGtoModeSelect = async (mode: GtoWorkMode) => {
    if (workModePendingRef.current) return;
    workModePendingRef.current = true;
    setIsWorkModeChecking(true);
    try { await selectWorkMode(mode); }
    finally {
      workModePendingRef.current = false;
      setIsWorkModeChecking(false);
    }
  };

  const getSimulatorLabel = (company: any) =>
    resolveSimulatorDisplayLabel(
      company,
      simulators as any[],
      companies as any[],
    ) || company?.simulatorName || "";

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

  const resultTrips = useMemo(() =>
    visitedTabs.has("results") || activeTab === "results"
      ? filterAndSortTripHistory(historicoTrips, { periodPreset: "todos" })
          .map(trip => applySimulatorCurrencyContext(trip, companies, simulators))
      : [], [activeTab, visitedTabs, historicoTrips, companies, simulators]);

  // Resultados card of the Resumo: the same trips as the Resultados page, computed only when the card is opened.
  const getSummaryResultTrips = useCallback(() => filterAndSortTripHistory(historicoTrips, { periodPreset: "todos" })
    .map(trip => applySimulatorCurrencyContext(trip, companies, simulators)), [historicoTrips, companies, simulators]);

  const renderWorkspaceHeading = () => (
    <>
      {activeTab === "profile" ? <DriverProfileToolbar view={profileView} onViewChange={setProfileView}
        infoOpen={isInfoOpen} onInfo={() => setIsInfoOpen(value => !value)} onEdit={() => setIsEditProfileOpen(true)}/> :
      (activeTab !== "dashboard" || displayActiveJob) && <header className="nvu-driver-page-heading" data-page={activeTab}>
        <div>
          <h1>{activeTab === "dashboard" ? (landscapeWorkspace ? "Painel do motorista" : "Operação atual") : activeTab === "results" ? "Resultados" : "Atividade"}</h1>
          {activeTab === "dashboard" && <p>Acompanhe suas entregas e o prazo.</p>}
          {activeTab === "results" && <p>Ganhos e relatórios</p>}
          {(activeTab === "activity" || activeTab === "operations") && <p>Suas viagens e operações</p>}
        </div>
      </header>}
      {(activeTab === "activity" || activeTab === "operations") &&
        <div className="nvu-driver-tabs" aria-label="Tipo de atividade">
          <button type="button" aria-pressed={activeTab === "activity"} onClick={() => selectProfilePage("activity")}>Viagens</button>
          <button type="button" aria-pressed={activeTab === "operations"} onClick={() => selectProfilePage("operations")}>Operações</button>
        </div>}
    </>
  );

  return (
    <div ref={workspaceRef} className="nvu-driver-workspace w-full flex flex-col gap-3 sm:gap-4" data-profile-page={activeTab} data-landscape-dashboard={landscapeDashboard ? "true" : undefined}>
      {maintenanceMode && (
        <WorkModeMaintenanceDialog
          mode={maintenanceMode === "simple" ? "pro" : maintenanceMode}
          simulator={isGtoWork ? "GTO" : simpleAutomationSimulator?.key || "GTO"}
          onClose={() => setMaintenanceMode(null)}
        />
      )}
      <GtoWorkModeDialog
        open={isGtoModeDialogOpen}
        variant={isGtoWork ? "gto" : "simple"}
        simulatorLabel={simpleAutomationSimulator?.shortLabel}
        vehiclePhoto={vehiclePhoto.src}
        vehicleName={activeVehicle?.name || "Veículo atual"}
        vehiclePhotoPending={vehiclePhoto.pending}
        busy={isWorkModeChecking || isSimpleAutomationStarting}
        onClose={() => setIsGtoModeDialogOpen(false)}
        onSelect={handleGtoModeSelect}
      />

      <div className={cn("nvu-profile-stack space-y-3 sm:space-y-4 w-full box-border", (activeTab !== "dashboard" || landscapeDashboard) && "nvu-profile-cover-stack")}>
        {/* Action Buttons */}

        {/* Profile Header — hero visual inspirado na referência; handlers preservados. */}
        {activeTab === "dashboard" && !landscapeDashboard ? <ProfileHero compactIdentity scope="driver" name={currentUser.name} description={currentUser.roles?.includes("admin") ? "Administrador" : "Motorista Parceiro"}
          image={resolveDriverPhoto(currentUser)} viewerId={currentUser.id} assetId={`driver-profile:${currentUser.id}`}
          simulator={getSimulatorLabel(currentActiveCompany)} simulatorOpen={isSimulatorMenuOpen} onSimulator={() => setIsSimulatorMenuOpen(!isSimulatorMenuOpen)} /> :
          <ProfileCoverHero scope="driver" profileId={currentUser.id} profile={currentUser} name={currentUser.name} description="Motorista Parceiro"
            avatar={resolveDriverPhoto(currentUser)} viewerId={currentUser.id} canEdit
            simulator={getSimulatorLabel(currentActiveCompany)} simulatorOpen={isSimulatorMenuOpen} onSimulator={() => setIsSimulatorMenuOpen(true)} />}

        <SimulatorSelectionModal
          open={isSimulatorMenuOpen}
          items={simulatorCompanies.map((company) => ({ id: company.id, label: getSimulatorLabel(company) || "Global Truck" }))}
          selectedId={activeCompanyId}
          onSelect={setActiveCompanyId}
          onClose={() => setIsSimulatorMenuOpen(false)}
        />

        <div className="nvu-driver-surface" data-page={activeTab}>
        {renderWorkspaceHeading()}

        {(visitedTabs.has("activity") || activeTab === "activity") &&
          <RetainedPanel active={activeTab === "activity"}>
            <HistoryReadCoverageNotice coverage={driverTripState.coverage} hasError={Boolean(driverTripState.error)} error={driverTripState.error} readCoverage={driverTripState.readCoverage} />
            <TripHistory key={`${currentUser.id}:${activeCompanyId}:activity`}
              compactDriverView hideHeader hideHeaderActions hideDriverFilter mode="driver"
              defaultDriverId={currentUser.id} defaultDriverName={currentUser.name}
              historicoTripsOverride={historicoTrips}
              historyLoadingOverride={driverTripsLoading} historyErrorOverride={driverTripState.error} />
          </RetainedPanel>}

        {(visitedTabs.has("results") || activeTab === "results") &&
          <RetainedPanel active={activeTab === "results"}>
            <HistoryReadCoverageNotice coverage={driverTripState.coverage} hasError={Boolean(driverTripState.error)} error={driverTripState.error} readCoverage={driverTripState.readCoverage} />
            <DriverResults key={`${currentUser.id}:${activeCompanyId}:results`} trips={resultTrips}
              loading={driverTripsLoading} onTripsReport={() => selectProfilePage("reports")}
              onOperationReport={() => selectProfilePage("operations")} />
          </RetainedPanel>}

        {(visitedTabs.has("profile") || activeTab === "profile") && (
          <RetainedPanel active={activeTab === "profile"} className="space-y-6 sm:space-y-8">
            <HistoryReadCoverageNotice coverage={driverTripState.coverage} hasError={Boolean(driverTripState.error)} error={driverTripState.error} readCoverage={driverTripState.readCoverage} />
            {/* Driver Details Info Card */}
            {isInfoOpen && (
              <div className="bg-white dark:bg-nvu-surface border border-slate-200 dark:border-nvu-line rounded-[16px] p-4 sm:p-5 shadow-sm space-y-4 animate-in fade-in slide-in-from-top-2">
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
                <div className="flex flex-wrap gap-2 border-t border-slate-100 dark:border-nvu-line pt-4" data-testid="profile-companies-entry">
                  <button type="button" onClick={() => navigate("/driver/companies")}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-nvu-line px-3.5 py-2 text-[13px] font-semibold text-slate-700 dark:text-nvu-text-soft hover:bg-slate-50 dark:hover:bg-nvu-strip">
                    <Building2 size={15} aria-hidden="true" /> Encontrar empresas
                  </button>
                  <button type="button" onClick={() => navigate("/driver/companies", { state: { focus: "applications" } })}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-nvu-line px-3.5 py-2 text-[13px] font-semibold text-slate-700 dark:text-nvu-text-soft hover:bg-slate-50 dark:hover:bg-nvu-strip">
                    <ClipboardList size={15} aria-hidden="true" /> Minhas inscrições
                  </button>
                </div>
                {activeCompanyId && <LeaveCompanyCard companyId={activeCompanyId} enabled={isInfoOpen} />}
              </div>
            )}

            {showSecondary && (
              needsProfileMetrics ? (
                <DriverPerformanceCard
                  rankingScope={profileRankingScope}
                  hideScopeSelector
                  profilePresentation={{
                    view: profileView,
                    periodType: profilePeriodType,
                    onPeriodChange: setProfilePeriodType,
                    onScopeChange: setProfileRankingScope,
                    viewerId: currentUser.id,
                    results: { getTrips: getSummaryResultTrips, loading: driverTripsLoading },
                    company: currentActiveCompany ? {
                      id: currentActiveCompany.id,
                      name: currentActiveCompany.companyName || currentActiveCompany.name || currentActiveCompany.fleetName || "Empresa vinculada",
                      logo: currentActiveCompany.logoUrl || currentActiveCompany.logoURL || currentActiveCompany.companyLogoURL,
                    } : null,
                    companyLoading: Boolean(activeCompanyId && companiesLoading),
                    vehicle: displayActiveJob?.vehicleId ? {
                      id: String(displayActiveJob.vehicleId),
                      name: activeVehicle?.name || displayJobData.vehicleName || "Veículo atual",
                      photo: vehiclePhoto.src,
                      onPhotoLoad: vehiclePhoto.onImageLoad,
                      onPhotoError: vehiclePhoto.onImageError,
                    } : null,
                  }}
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
          </RetainedPanel>
        )}

        {(visitedTabs.has("operations") || activeTab === "operations") && (
          <RetainedPanel active={activeTab === "operations"} className="space-y-3 nvu-ops-filters-panel">
              {!activeJob && activeOperationResolved && currentUser.isOnline && (
                <Button
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl h-12 font-bold text-[14px] shadow-sm tracking-tight transition-all"
                  onClick={handleRequestWork}
                >
                  <Package size={18} className="mr-2" />
                  Solicitar Nova Operação
                </Button>
              )}

            {/* Compact period picker, shared with trips and results. */}
            <div className="nvu-driver-operation-filters">
              <ModalSelect title="Período das operações" description="Escolha o período do histórico de operações."
                value={periodFilter} onChange={event => setPeriodFilter(event.target.value as typeof periodFilter)}
                className="nvu-driver-period-select" icon={<CalendarDays size={16} aria-hidden="true" />}>
                <option value="all">Todo o período</option>
                <option value="hoje">Hoje</option>
                <option value="semana">Esta semana</option>
                <option value="mes">Este mês</option>
                <option value="custom">Personalizado</option>
              </ModalSelect>

              {periodFilter === "custom" && (
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 animate-in slide-in-from-top-2 duration-200">
                  <div className="flex-1">
                    <div className="relative">
                      <div className="absolute inset-y-0 left-2.5 sm:left-3 flex items-center pointer-events-none text-gray-400">
                        <Calendar size={13} />
                      </div>
                      <input
                        type="date"
                        aria-label="Início do período das operações"
                        value={customStartDate}
                        onChange={(e) => setCustomStartDate(e.target.value)}
                        className="w-full bg-gray-100 dark:bg-nvu-surface text-gray-700 dark:text-nvu-text-soft text-[12px] sm:text-[13px] font-medium border border-transparent rounded-xl pl-8 sm:pl-9 pr-2 sm:pr-3 py-2 sm:py-2.5 focus:outline-none focus:ring-2 focus:ring-gray-900/10 dark:focus:ring-white/10 shadow-sm dark:shadow-none transition-all"
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
                        aria-label="Fim do período das operações"
                        value={customEndDate}
                        onChange={(e) => setCustomEndDate(e.target.value)}
                        className="w-full bg-gray-100 dark:bg-nvu-surface text-gray-700 dark:text-nvu-text-soft text-[12px] sm:text-[13px] font-medium border border-transparent rounded-xl pl-8 sm:pl-9 pr-2 sm:pr-3 py-2 sm:py-2.5 focus:outline-none focus:ring-2 focus:ring-gray-900/10 dark:focus:ring-white/10 shadow-sm dark:shadow-none transition-all"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

          </RetainedPanel>
        )}

        {(visitedTabs.has("dashboard") || activeTab === "dashboard" || visitedTabs.has("operations") || activeTab === "operations") && (
          <RetainedPanel active={activeTab === "dashboard" || activeTab === "operations"} className="nvu-ops-card-panel">
            {showSecondary && <>
              {activeTab === "operations" && <h2 className="nvu-driver-section-title">Operação ativa</h2>}
              <Dashboard
                isIntegrated={true}
                operationCardOnly={activeTab === "operations"}
                tripHistoryOverride={driverTripState.trips}
                tripHistoryLoadingOverride={driverTripsLoading}
                tripHistoryReadyOverride={driverTripState.historyReady}
                progressAnimationKey={`${location.key}:${activeTab}:dashboard`}
                vehiclePhotoOverride={vehiclePhoto}
              />
            </>}
          </RetainedPanel>
        )}

        {(visitedTabs.has("operations") || activeTab === "operations") && (
          <RetainedPanel active={activeTab === "operations"} className="nvu-ops-history-panel">
            {/* Job History */}
            <div className="pb-6">
              <h3 className="text-[13px] font-bold text-gray-900 dark:text-nvu-text mb-3 px-1">
                Histórico
              </h3>
              {filteredHistoryJobs.length > 0 ? (
                <div className="space-y-3 nvu-ops-history-list">
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

                    const jobTrips = getFilteredTrips(
                      selectCanonicalOperationTrips(job, historicoTrips, currentUser.id).map(normalizeTrip),
                      undefined,
                      undefined,
                      undefined,
                      undefined,
                      allCompanies,
                      undefined,
                      simulators,
                    );
                    const jobMoneyGroups = summarizeTripMoney(jobTrips);

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
                          "bg-slate-50 dark:bg-nvu-surface border rounded-2xl transition-all shadow-sm overflow-hidden",
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
                            <div className="text-slate-400 dark:text-nvu-muted shrink-0 ml-2">
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
                                className="text-gray-500 dark:text-nvu-muted shrink-0"
                              />
                              <span className="text-[11px] sm:text-[11.5px] font-medium text-gray-700 dark:text-nvu-text-soft whitespace-nowrap">
                                {canonicalProgressByJobId.get(String(job.id)) || 0}{" "}
                                {(canonicalProgressByJobId.get(String(job.id)) || 0) === 1 ? "viagem" : "viagens"}
                              </span>
                            </div>

                            {!jobTrailerlessSimulator && (
                              <>
                                <div className="w-px h-3.5 bg-gray-200 dark:bg-nvu-line shrink-0"></div>

                                <div className="flex items-center gap-1.5 shrink-0">
                                  <Truck
                                    size={13}
                                    className="text-gray-500 dark:text-nvu-muted shrink-0"
                                  />
                                  <span className="text-[11px] sm:text-[11.5px] font-medium text-gray-700 dark:text-nvu-text-soft whitespace-nowrap">
                                    {trailer?.name || "Nenhum"}
                                  </span>
                                </div>

                                <div className="w-px h-3.5 bg-gray-200 dark:bg-nvu-line shrink-0"></div>
                              </>
                            )}

                            <div className="flex items-center gap-1.5 shrink-0 pr-1">
                              <Truck
                                size={13}
                                className="text-gray-500 dark:text-nvu-muted shrink-0"
                              />
                              <span className="text-[11px] sm:text-[11.5px] font-medium text-gray-700 dark:text-nvu-text-soft whitespace-nowrap">
                                {vehicle?.name || "Nenhum"}
                              </span>
                            </div>
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="px-4 pb-4 animate-in fade-in slide-in-from-top-2 duration-200">
                            <div className="bg-gray-50 dark:bg-nvu-strip rounded-xl border border-gray-100 dark:border-nvu-line/60 p-2.5 mb-3 space-y-2">
                              {/* Total de Ganhos */}
                              <div className="flex items-center gap-2">
                                <Banknote
                                  size={11}
                                  className="text-green-500 dark:text-green-400 shrink-0"
                                  strokeWidth={2.5}
                                />
                                <div className="flex items-center gap-2 min-w-0 w-full">
                                  <span className="text-[10px] font-medium text-gray-500 dark:text-nvu-muted shrink-0">
                                    Total de ganhos:
                                  </span>
                                  <div className="text-[11.5px] font-semibold min-w-0 break-words">
                                    <HistoryMoneySummary groups={jobMoneyGroups} />
                                  </div>
                                </div>
                              </div>

                              {/* Prazo total */}
                              <div className="flex items-center gap-2">
                                <CalendarDays
                                  size={11}
                                  className="text-gray-400 dark:text-nvu-muted shrink-0"
                                  strokeWidth={2.5}
                                />
                                <div className="flex items-center gap-2 min-w-0 w-full">
                                  <span className="text-[10px] font-medium text-gray-500 dark:text-nvu-muted shrink-0">
                                    Prazo total:
                                  </span>
                                  <span className="text-[11.5px] font-semibold text-gray-900 dark:text-nvu-text truncate">
                                    {prazoTotal}
                                  </span>
                                </div>
                              </div>

                              {/* Execução */}
                              <div className="flex items-center gap-2">
                                <Clock
                                  size={11}
                                  className="text-gray-400 dark:text-nvu-muted shrink-0"
                                  strokeWidth={2.5}
                                />
                                <div className="flex items-center gap-2 min-w-0 w-full">
                                  <span className="text-[10px] font-medium text-gray-500 dark:text-nvu-muted shrink-0">
                                    Execução:
                                  </span>
                                  <span className="text-[11.5px] font-semibold text-gray-900 dark:text-nvu-text truncate">
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
                                      : "text-gray-400 dark:text-nvu-muted",
                                  )}
                                  strokeWidth={2.5}
                                />
                                <div className="flex items-center gap-2 min-w-0 w-full">
                                  <span
                                    className={cn(
                                      "text-[10px] font-medium shrink-0",
                                      isAtrasado
                                        ? "text-red-600/80 dark:text-red-400/80"
                                        : "text-gray-500 dark:text-nvu-muted",
                                    )}
                                  >
                                    {isAtrasado ? "Atraso:" : "Tempo restante:"}
                                  </span>
                                  <span
                                    className={cn(
                                      "text-[11.5px] font-semibold truncate",
                                      isAtrasado
                                        ? "text-red-600 dark:text-red-400"
                                        : "text-gray-900 dark:text-nvu-text",
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
                <div className="bg-slate-50 dark:bg-nvu-surface border border-slate-200/80 dark:border-white/5 border-dashed rounded-[24px] p-8 text-center shadow-sm">
                  <p className="text-[14px] text-slate-500 dark:text-nvu-muted font-medium">
                    Nenhum histórico disponível
                  </p>
                </div>
              )}
            </div>
          </RetainedPanel>
        )}



        </div>
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
        className="min-h-[45vh] bg-gray-50 dark:bg-nvu-page"
        role="status"
        aria-live="polite"
      >
        <span className="sr-only">Preparando perfil do motorista</span>
      </div>
    );
  }

  return <DriverProfileContent key={currentUser.id} currentUser={currentUser} />;
}
