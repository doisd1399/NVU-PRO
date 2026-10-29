import { CachedImage } from "../../components/common/CachedImage";
import { ModalPortal } from "../../components/ui/ModalPortal";
import { useLocalOperationPending } from "../../hooks/useLocalOperationPending";
import { toast } from "sonner";
import { OperationSyncNotice } from "../../components/OperationSyncNotice";
import { DriverOperationTiming } from "../../components/driver/DriverOperationTiming";
import { DiscreetDisclosure } from "../../components/common/DiscreetDisclosure";
import { RetainedPanel } from "../../components/common/RetainedPanel";
import { AutomaticDriverQueue } from "../../components/operations/AutomaticDriverQueue";
import { DriverWorkRequest } from "../../components/driver/DriverWorkRequest";
import { DriverIdlePanel, DriverPreviousWork, DriverAssignedQueue } from "../../components/driver/DriverIdlePanel";
import { DriverStatusRow } from "../../components/driver/DriverStatusRow";
import { useOptionalAutomaticOperations } from "../../contexts/AutomaticOperationsProvider";
import { LandscapeOperationPanel } from "../../components/operations/LandscapeOperationPanel";
import { useLandscapeWorkspace } from "../../hooks/useLandscapeWorkspace";
import { createPortal } from "react-dom";
import React, { useState, useMemo, useEffect } from "react";
import { PendingProOperationNotice } from "../../components/PendingProOperationNotice";
import { useLocation, useNavigate } from "react-router-dom";
import { useActivityStore, useOperationalStore, useSessionStore } from "../../context/AppContext";
import { useCompanyStore } from "../../context/CompanyContext";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import {
  FileText,
  Calendar,
  Clock,
  Star,
  Play,
  Square,
  CheckCircle,
  Circle,
  MapPin,
  Building2,
  Search,
  ArrowRight,
  UserCog,
  Loader2,
  Eye,
  X,
  Navigation,
  Pencil,
  LayoutDashboard,
  User as UserIcon,
  ChevronDown,
  Lock,
  History,
  Activity,
  Award,
  Check,
  CheckCircle2,
  TrendingUp,
  ChevronRight,
  CalendarDays,
  ChevronsUpDown,
  ChevronsDownUp,
  Download,
  ImagePlus,
  Info,
} from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { prepareAndCommitNavigation } from "../../lib/navigationTransition";
import { ptBR } from "date-fns/locale";

import { db } from "../../lib/firebase";
import { query, collection, where, onSnapshot, doc } from "firebase/firestore";
import ErrorBoundary from "../../components/ErrorBoundary";
import { OperationalSuspensionNotice } from "../../components/OperationalSuspensionNotice";
import { useOperationalSuspension } from "../../hooks/useOperationalSuspension";
import TripHistory from "./TripHistory";
import { OperationProgressBar } from "../../components/common/OperationProgressBar";
import { isClosedJobStatus, isRunningJobStatus, isTripRecordableJobStatus } from "../../lib/jobStatus";
import { getProLaunchAvailability } from "../../lib/proLaunchAvailability";
import {
  deriveCurrentOperationProgress,
  selectCanonicalOperationTrips,
  selectCurrentOperationJob,
} from "../../lib/currentOperation";
import { resolveTripSimulatorCode } from "../../lib/tripDistance";
import { assertWorkModeEntryAllowed, prefetchWorkModeAvailability } from "../../services/workModeAvailabilityService";
import { isWorkModeMaintenanceError } from "../../lib/workModeMaintenanceError";
import { WorkModeMaintenanceDialog } from "../../components/WorkModeMaintenanceDialog";
import { isTrailerlessSimulator } from "../../lib/resolveSimulator";
import { launchGtoWork } from "../../services/gtoWorkLauncher";
import { GtoWorkModeDialog, type GtoWorkMode } from "../../components/GtoWorkModeDialog";
import { getSimpleAutomationSimulator, type SimpleAutomationCity } from "../../lib/simpleAutomation";
import { getCachedSimpleAutomationCities, loadSimpleAutomationCities } from "../../services/simpleAutomationCityService";
import { launchSimpleAutomation, simpleAutomationStatusMessage } from "../../services/simpleAutomationLauncher";
import { ensureOperationIntegrity } from "../../services/operationIntegrityGuard";
import { useVehiclePhoto, type VehiclePhotoController } from "../../hooks/useVehiclePhoto";
import { resolveVehiclePhotoOperationSimulatorId } from "../../lib/vehiclePhotoIdentity";
import GtoObserverSetup from "../../components/GtoObserverSetup";

import { cn, getNomeContratoHistorico } from "../../lib/utils";
import { buildInProgressOperationSummary, buildOperationResultSummary, operationCompletedAtMs, resolveOperationContract, selectCompletedOperationJobs } from "../../lib/operationResultSummary";
import { useDriverTrips } from "../../hooks/useDriverTrips";
import { normalizeTrip } from "../../lib/tripNormalizer";
import { applySimulatorCurrencyContext } from "../../lib/metricsEngine";
import { summarizeTripMoney } from "../../lib/tripMoneySummary";
import {
  OperationResultModal,
  OperationResultData,
} from "../../components/OperationResultModal";
import {
  consumeOperationCompletionResult,
  publishOperationCompletionResult,
  readOperationCompletionResult,
  OPERATION_RESULT_READY_EVENT,
} from "../../lib/operationCompletionResult";

const GTO_PREFERRED_DESTINATIONS = [
  "Itapetuna",
  "Nova Macaé",
  "Registro",
  "Águas Velhas",
  "Faz Areia Dourada",
  "Cruz do Oeste",
  "Cooperativa Agro Grão",
  "Curitiba",
  "Lages",
  "Lauro Muller",
] as const;

function DashboardComponent({
  isIntegrated = false,
  operationCardOnly = false,
  tripHistoryOverride,
  tripHistoryLoadingOverride,
  tripHistoryReadyOverride,
  progressAnimationKey,
  vehiclePhotoOverride,
}: {
  isIntegrated?: boolean;
  operationCardOnly?: boolean;
  tripHistoryOverride?: any[];
  tripHistoryLoadingOverride?: boolean;
  tripHistoryReadyOverride?: boolean;
  progressAnimationKey?: string;
  vehiclePhotoOverride?: VehiclePhotoController;
}) {
  const { currentUser } = useSessionStore();
  const {
    companies,
    activeCompanyId,
    requestJoinCompany,
    cancelRequestJoinCompany,
    allCompanyMembers,
    driverRequests,
  } = useCompanyStore();
  const automatic=useOptionalAutomaticOperations();
  const hasAutomaticQueues=Boolean(automatic?.view?.queues.length);
  // Horizontal "Painel do motorista" layout; portrait keeps the original structure.
  const landscapeWorkspace = useLandscapeWorkspace();
  const { suspension: operationalSuspension } = useOperationalSuspension(
    currentUser as any,
  );
  const {
    jobs,
    requestNewJobDemand,
    cancelJobDemand,
    contracts,
    vehicles,
    trailers,
    startJob,
    finishJob,
    users,
    updateUserOnlineStatus,
    jobsReady,
    contractsReady,
    simulators,
  } = useOperationalStore();
  const { jobDemands } = useActivityStore();
  // The integrated profile already owns the company-trip cache. Reusing that
  // snapshot avoids mounting a second listener and a second state update while
  // the operational header is opening.
  const driverTripsState = useDriverTrips(
    isIntegrated ? null : currentUser?.id,
    { enabled: !isIntegrated },
  );
  const historicoTrips = isIntegrated
    ? tripHistoryOverride || []
    : driverTripsState.trips;
  const tripHistoryLoading = isIntegrated
    ? Boolean(tripHistoryLoadingOverride)
    : driverTripsState.loading;
  const normalizedCompanyTrips = useMemo(
    () => historicoTrips.map((trip: any) => normalizeTrip(trip)).filter((trip) => trip.isValid),
    [historicoTrips],
  );

  const [searchTerm, setSearchTerm] = useState("");
  const [now, setNow] = useState(new Date());

  React.useEffect(() => {
    const timerId = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timerId);
  }, []);

  const [isRequestingId, setIsRequestingId] = useState<string | null>(null);
  const [startingJobId, setStartingJobId] = useState<string | null>(null);
  const [isContractModalOpen, setIsContractModalOpen] = useState(false);
  const [operationInfoScope, setOperationInfoScope] = useState<string | null>(null);
  const operationInfoId = React.useId();
  const [isSubmittingDemand, setIsSubmittingDemand] = useState(false);
  const [isGtoModeDialogOpen, setIsGtoModeDialogOpen] = useState(false);
  const [maintenanceMode, setMaintenanceMode] = useState<GtoWorkMode | null>(null);
  const [isSimpleAutomationStarting, setIsSimpleAutomationStarting] = useState(false);
  const [isWorkModeChecking, setIsWorkModeChecking] = useState(false);
  const workModePendingRef = React.useRef(false);
  const [simpleAutomationCities, setSimpleAutomationCities] = useState<SimpleAutomationCity[]>([]);
  const [demandSuccess, setDemandSuccess] = useState(false);

  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [paintDialogOpen, setPaintDialogOpen] = useState(false);
  const photoInputRef = React.useRef<HTMLInputElement>(null);

  const [isFinishing, setIsFinishing] = useState(false);
  const [showOperationResultModal, setShowOperationResultModal] =
    useState(false);
  const [operationResultData, setOperationResultData] =
    useState<OperationResultData | null>(null);
  const resultScope = `${currentUser?.id || ""}|${activeCompanyId || ""}`;
  const [operationResultScope, setOperationResultScope] = useState("");

  React.useEffect(() => {
    const consumeResult = () => {
      const userId = String(currentUser?.id || "").trim();
      if (!userId) return;
      if (!activeCompanyId) return;
      const handoff = consumeOperationCompletionResult(userId, activeCompanyId);
      if (!handoff) return;
      setOperationResultData(handoff.data);
      setOperationResultScope(`${userId}|${activeCompanyId}`);
      setShowOperationResultModal(true);
    };

    consumeResult();
    window.addEventListener(OPERATION_RESULT_READY_EVENT, consumeResult);
    return () => {
      window.removeEventListener(OPERATION_RESULT_READY_EVENT, consumeResult);
    };
  }, [currentUser?.id, activeCompanyId]);

  const navigate = useNavigate();
  const location = useLocation();
  const [isPageSelectorOpen, setIsPageSelectorOpen] = useState(false);

  React.useEffect(() => {
    const routeState = location.state as
      | { nvuOperationResult?: OperationResultData; userId?: string; companyId?: string }
      | null;
    if (!routeState?.nvuOperationResult || routeState.userId !== currentUser?.id || routeState.companyId !== activeCompanyId) return;
    setOperationResultData(routeState.nvuOperationResult);
    setOperationResultScope(resultScope);
    setShowOperationResultModal(true);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate, currentUser?.id, activeCompanyId, resultScope]);

  // --- MOVED HOOKS TO TOP ---
  const myJob = useMemo(
    () => selectCurrentOperationJob(jobs, currentUser?.id, activeCompanyId),
    [activeCompanyId, currentUser?.id, jobs],
  );
  const localPendingTrips = useLocalOperationPending(currentUser?.id, myJob?.companyId, myJob?.id);

  const currentOperationProgress = useMemo(
    () =>
      deriveCurrentOperationProgress(
        myJob,
        isIntegrated ? historicoTrips : driverTripsState.trips,
        currentUser?.id,
      ),
    [currentUser?.id, driverTripsState.trips, historicoTrips, isIntegrated, myJob],
  );

  const pendingDriverJobs = useMemo(() => {
    const valid = jobs.filter(
      (j) =>
        j.driverId === currentUser?.id &&
        j.companyId === activeCompanyId &&
        j.status === "pending",
    );
    valid.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA; // Oldest first? Actually dateA - dateB means oldest is first.
    });
    return valid;
  }, [jobs, currentUser?.id, activeCompanyId]);

  const contract = useMemo(
    () => resolveOperationContract(myJob, contracts),
    [myJob, contracts],
  );

  const currentOperationTrips = useMemo(() => {
    if (!myJob) return [];
    return selectCanonicalOperationTrips(myJob, historicoTrips, String(currentUser?.id || myJob.driverId || ""))
      .map((trip) => applySimulatorCurrencyContext(normalizeTrip(trip), companies, simulators));
  }, [companies, currentUser?.id, historicoTrips, myJob, simulators]);

  const vehicle = useMemo(() => {
    if (!myJob) return null;
    return vehicles.find((v) => v.id === myJob.vehicleId)
      || ((myJob as any).vehicleName
        ? ({
            id: myJob.vehicleId,
            name: (myJob as any).vehicleName,
            plate: (myJob as any).vehiclePlate || "",
            companyId: myJob.companyId,
          } as any)
        : null);
  }, [myJob, vehicles]);

  const trailerlessSimulator = isTrailerlessSimulator(
    contract,
    simulators as unknown[],
  );

  const trailer = useMemo(() => {
    if (trailerlessSimulator) return null;
    const tId = myJob?.trailerId || contract?.trailerId;
    const foundTrailer = tId ? trailers.find((t) => t.id === tId) : null;
    return foundTrailer
      || (tId && (myJob as any)?.trailerName
        ? ({ id: tId, name: (myJob as any).trailerName, companyId: myJob?.companyId } as any)
        : null);
  }, [myJob, contract, trailers, trailerlessSimulator]);

  const currentCompany = useMemo(
    () => companies.find((company) => company.id === (myJob?.companyId || activeCompanyId)) || null,
    [companies, myJob?.companyId, activeCompanyId],
  );
  const currentOperationInfoScope = `${resultScope}|${myJob?.id || ""}|${location.key}|${operationCardOnly}`;
  const isOperationInfoOpen = operationInfoScope === currentOperationInfoScope;
  useEffect(() => {
    setOperationInfoScope(null);
  }, [currentOperationInfoScope]);
  const currentOperationInfo = useMemo(() => myJob && contract
    ? buildInProgressOperationSummary({
        job: myJob, contract, trips: currentOperationTrips, companies, now,
        driverId: currentUser?.id,
        vehicleName: vehicle?.name, trailerName: trailer?.name,
        showTrailer: !trailerlessSimulator,
      })
    : null, [myJob, contract, currentOperationTrips, companies, now, currentUser?.id, vehicle?.name, trailer?.name, trailerlessSimulator]);
  const vehiclePhotoSimulatorId = resolveVehiclePhotoOperationSimulatorId(
    myJob, currentCompany, "",
    simulators as unknown as Record<string, unknown>[],
    companies as unknown as Record<string, unknown>[], [contract],
  );
  const activeVehiclePhotoIdentity = currentUser?.id && myJob?.vehicleId && vehiclePhotoSimulatorId
    ? { userId: currentUser.id, simulatorId: vehiclePhotoSimulatorId, vehicleId: myJob.vehicleId, vehicleName: vehicle?.name || "Veículo atual" }
    : null;
  const ownVehiclePhoto = useVehiclePhoto(
    vehiclePhotoOverride ? null : activeVehiclePhotoIdentity,
    currentCompany?.id || "",
    !vehiclePhotoOverride,
  );
  const {
    src: displayedVehiclePhoto, busy: vehiclePhotoBusy, pending: vehiclePhotoPending,
    error: vehiclePhotoError, save: saveVehiclePhoto,
  } = vehiclePhotoOverride || ownVehiclePhoto;

  const onVehiclePhotoSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await saveVehiclePhoto(file);
  };

  // The active contract is the spelling authority: the simulator displays the route
  // generated from this operation, so its literal city names must win over built-in
  // fallback names even when only accents/case differ. Fixed GTO names are fallback only;
  // previous OCR/history is deliberately excluded from the authority set.
  const trustedGtoCities = useMemo(() => {
    const values: string[] = [];
    const add = (value: unknown) => {
      const city = String(value || "").trim().replace(/\s+/g, " ");
      if (city && !values.some((item) => item.localeCompare(city, "pt-BR", { sensitivity: "base" }) === 0)) {
        values.push(city);
      }
    };

    contract?.deliveries?.forEach((route) => {
      add(route.origin);
      add(route.destination);
    });
    GTO_PREFERRED_DESTINATIONS.forEach(add);
    return values.slice(0, 120);
  }, [contract?.deliveries]);

  // The current delivery is the authority for native GTO reconciliation in every
  // contract mode. Legacy/simple contracts can still carry deliveries; omitting this
  // context makes the emulator fall back to noisy OCR for city names.
  const activeDetailedGtoRoute = useMemo(() => {
    const deliveries = contract?.deliveries || [];
    if (!deliveries.length) return undefined;
    const progress = currentOperationProgress;
    return deliveries[Math.min(progress, deliveries.length - 1)];
  }, [contract?.deliveries, currentOperationProgress]);
  const trustedGtoCitiesJson = JSON.stringify(trustedGtoCities);

  const isGtoWork =
    resolveTripSimulatorCode(currentCompany as any, simulators as any[]) === "GTO" ||
    resolveTripSimulatorCode(contract as any, simulators as any[]) === "GTO" ||
    resolveTripSimulatorCode(myJob as any, simulators as any[]) === "GTO";
  const simpleAutomationSimulator = useMemo(
    () =>
      isGtoWork
        ? getSimpleAutomationSimulator("GTO")
        : getSimpleAutomationSimulator(currentCompany, simulators as unknown[]) ||
          getSimpleAutomationSimulator(contract, simulators as unknown[]) ||
          getSimpleAutomationSimulator(myJob, simulators as unknown[]),
    [currentCompany, contract, myJob, simulators, isGtoWork],
  );
  // An operation resolved as GTO must also have the Pro service identity.
  const isSimpleAutomationWork = Boolean(simpleAutomationSimulator);

  React.useEffect(() => {
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
        console.error("[NVU] Falha ao carregar cidades do Modo Pro", error);
        // Offline refresh does not erase the last known list.
      });
    return () => {
      cancelled = true;
    };
  }, [simpleAutomationSimulator?.key]);

  const handleTripAction = async () => {
    if (operationalSuspension.active) {
      alert(
        isGtoWork
          ? "Suas atividades operacionais estão suspensas. Aguarde a liberação para iniciar o trabalho."
          : "Suas atividades operacionais estão suspensas. Aguarde o término da suspensão para lançar viagens.",
      );
      return;
    }
    const proAvailability = getProLaunchAvailability({
      job: myJob,
      confirmedTripCount: currentOperationProgress,
      totalDeliveries: contract?.totalDeliveries,
      hasContract: Boolean(contract),
      hasUser: Boolean(currentUser),
      hasCompany: Boolean(currentCompany),
    });

    if ((isSimpleAutomationWork || myJob?.operationSyncState === "pending_finish" || myJob?.operationSyncState === "start_rejected") && !proAvailability.canLaunch) {
      alert(proAvailability.message);
      return;
    }

    if (!isSimpleAutomationWork && (!myJob || !contract || !currentUser || !currentCompany)) {
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

  const startGtoAutomatic = async () => {
    if (!myJob || !contract || !currentUser || !currentCompany) {
      alert("Inicie uma operação para começar o trabalho no GTO.");
      return;
    }

    try {
      if (myJob.operationSyncState !== "pending_start") void ensureOperationIntegrity(myJob.id, contract.totalDeliveries || 0, "pro-entry").catch((error) =>
        console.warn("[NVU] Integrity Guard do GTO não concluiu; o fluxo continuará protegido pelo ACK:", error),
      );
      const result = await launchGtoWork({
        driverId: currentUser.id,
        driverName: currentUser.name,
        companyId: currentCompany.id,
        companyName: currentCompany.companyName || currentCompany.name || "Empresa",
        jobId: myJob.id,
        jobStatus: myJob.status,
        confirmedTripCount: currentOperationProgress,
        jobProgress: currentOperationProgress,
        jobTotalDeliveries: contract.totalDeliveries || 0,
        contractId: contract.id,
        contractName: contract.name || "",
        contractMode: contract.mode,
        vehicleId: vehicle?.id || "",
        vehicleName: vehicle?.name || "",
        trailerId: trailer?.id || "",
        trailerName: trailer?.name || "",
        expectedGtoOrigin: activeDetailedGtoRoute?.origin || "",
        expectedGtoDestination: activeDetailedGtoRoute?.destination || "",
        trustedGtoCitiesJson,
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

  const startSimpleAutomation = async (entryCheck: Promise<void>) => {
    if (!simpleAutomationSimulator) return;
    if (myJob && myJob.operationSyncState !== "pending_start" && typeof navigator !== "undefined" && navigator.onLine) {
      void ensureOperationIntegrity(myJob.id, contract?.totalDeliveries || 0, "pro-entry").catch((error) =>
        console.warn("[NVU] Integrity Guard do Modo Pro não concluiu; o fluxo continuará protegido pelo ACK:", error),
      );
    }
    const proAvailability = getProLaunchAvailability({
      job: myJob,
      confirmedTripCount: currentOperationProgress,
      totalDeliveries: contract?.totalDeliveries,
      hasContract: Boolean(contract),
      hasUser: Boolean(currentUser),
      hasCompany: Boolean(currentCompany),
    });
    if (!proAvailability.canLaunch) {
      alert(proAvailability.message);
      return;
    }
    const visibleOperationProgress = currentOperationProgress;
    if (isClosedJobStatus(myJob?.status, visibleOperationProgress, contract?.totalDeliveries || 0)) {
      alert("Operação concluída. Solicite uma nova operação para continuar.");
      return;
    }
    // A ausência de cidades não deve bloquear a abertura do Modo Pro.
    // A validação de origem/destino deve ocorrer somente no início da operação,
    // quando o usuário realmente precisar selecionar uma rota.
    setIsSimpleAutomationStarting(true);
    try {
      const cachedCities = getCachedSimpleAutomationCities(simpleAutomationSimulator.key);
      const result = await launchSimpleAutomation(
        simpleAutomationSimulator.key,
        cachedCities.length ? cachedCities : simpleAutomationCities,
        currentCompany.companyName || currentCompany.name || "Empresa",
        {
          companyId: currentCompany.id,
          driverId: currentUser?.id,
          jobId: myJob?.id,
          contractId: contract?.id,
          operationName: contract?.name || "Operação atual",
          contractName: contract?.name || "",
          confirmedTripCount: currentOperationProgress,
          jobProgress: currentOperationProgress,
          jobTotalDeliveries: contract?.totalDeliveries || 0,
          jobStatus: myJob?.status || "",
          operationClosed: isClosedJobStatus(
            myJob?.status,
            currentOperationProgress,
            contract?.totalDeliveries || 0,
          ),
          vehicleName: vehicle?.name || "",
          trailerName: trailer?.name || "",
          historyTrips: currentOperationTrips,
          historyReady: Boolean(isIntegrated ? tripHistoryReadyOverride : driverTripsState.historyReady)
            && (!driverTripsState.error || currentOperationTrips.length > 0),
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

  const selectWorkMode = async (mode: GtoWorkMode) => {
    if (["pending_finish", "start_rejected"].includes(myJob?.operationSyncState || "")) {
      setIsGtoModeDialogOpen(false);
      toast.message("A ação da operação aguarda sincronização. Os registros locais foram preservados.");
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
      alert(error instanceof Error ? error.message : "Não foi possível verificar a disponibilidade do modo.");
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

  const unassignedContracts = useMemo(
    () => {
      const assignedContractIds = new Set(jobs.map(j => j.contractId));
      return contracts.filter(
        (c) =>
          c.companyId === activeCompanyId &&
          !assignedContractIds.has(c.id),
      );
    },
    [contracts, jobs, activeCompanyId],
  );

  const completedJobs = useMemo(
    () => selectCompletedOperationJobs(jobs, historicoTrips, String(currentUser?.id || ""), activeCompanyId),
    [jobs, currentUser?.id, activeCompanyId, historicoTrips],
  );
  const lastCompletedJob = completedJobs[0];
  const lastCompletedTrips = useMemo(() => lastCompletedJob
    ? selectCanonicalOperationTrips(lastCompletedJob, historicoTrips, String(currentUser?.id || ""))
        .map(trip => applySimulatorCurrencyContext(trip, companies, simulators))
    : [], [lastCompletedJob, historicoTrips, currentUser?.id, companies, simulators]);
  const lastCompletedResult = useMemo(() => {
    if (!lastCompletedJob || !currentUser?.id || !activeCompanyId) return null;
    const cached = readOperationCompletionResult(currentUser.id, activeCompanyId, lastCompletedJob.id);
    const rebuilt = buildOperationResultSummary({
      job: lastCompletedJob, contract: resolveOperationContract(lastCompletedJob, contracts), trips: lastCompletedTrips,
      vehicleName: vehicles.find(value => value.id === lastCompletedJob.vehicleId)?.name,
      trailerName: trailers.find(value => value.id === lastCompletedJob.trailerId)?.name,
      showTrailer: !isTrailerlessSimulator(String((lastCompletedJob as any).simulatorId || currentCompany?.simulatorId || "")),
    });
    // Fresh history reflects later edits/deletions. The archive preserves the
    // confirmed result while history is unavailable, without freezing totals.
    const historyReady = isIntegrated ? tripHistoryReadyOverride : driverTripsState.historyReady;
    return cached ? { ...cached, ...(historyReady ? { moneyGroups: rebuilt.moneyGroups, totalViagens: rebuilt.totalViagens } : {}) } : rebuilt;
  }, [lastCompletedJob, lastCompletedTrips, currentUser?.id, activeCompanyId, contracts, vehicles, trailers, currentCompany?.simulatorId, isIntegrated, tripHistoryReadyOverride, driverTripsState.historyReady]);
  const reviewPreviousWork = (job: (typeof completedJobs)[number]) => {
    const trips = selectCanonicalOperationTrips(job, historicoTrips, String(currentUser?.id || ""))
      .map(trip => applySimulatorCurrencyContext(trip, companies, simulators));
    const rebuilt = buildOperationResultSummary({
      job, contract: resolveOperationContract(job, contracts), trips,
      vehicleName: vehicles.find(value => value.id === job.vehicleId)?.name,
      trailerName: trailers.find(value => value.id === job.trailerId)?.name,
      showTrailer: !isTrailerlessSimulator(String(job.simulatorId || currentCompany?.simulatorId || "")),
    });
    const cached = currentUser && activeCompanyId ? readOperationCompletionResult(currentUser.id, activeCompanyId, job.id) : null;
    const ready = isIntegrated ? tripHistoryReadyOverride : driverTripsState.historyReady;
    const result = job.id === lastCompletedJob?.id && lastCompletedResult ? lastCompletedResult
      : cached ? { ...cached, ...(ready ? { moneyGroups: rebuilt.moneyGroups, totalViagens: rebuilt.totalViagens } : {}) } : rebuilt;
    setOperationResultData(result);
    setOperationResultScope(resultScope);
    setShowOperationResultModal(true);
  };
  // -------------------------

  const pageOptions = [
    { id: "/driver", label: "Painel Operacional", icon: LayoutDashboard },
    { id: "/driver/profile", label: "Meu Perfil", icon: UserIcon },
    { id: "/driver/history", label: "Histórico de Viagens", icon: History },
    { id: "/driver/reports", label: "Relatórios", icon: Activity },
  ];

  const activePageDetails =
    pageOptions.find((p) => p.id === location.pathname) || pageOptions[0];
  const ActiveIcon = activePageDetails.icon;

  const renderTopControls = (showLaunchTrip = false) => {
    if (isIntegrated) return null;

    return (
      <div className="w-full flex flex-col gap-2 sm:gap-3 mb-0">
        <div
          className={cn(
            "w-full flex flex-row flex-nowrap items-stretch gap-2 sm:gap-4",
            !showLaunchTrip && "max-w-sm",
          )}
        >
          {!isIntegrated && (
            <div
              className={cn(
                "min-w-0 sm:flex-1",
                showLaunchTrip ? "flex-[4.5]" : "flex-1",
              )}
            >
              <button
                onClick={() => setIsPageSelectorOpen(!isPageSelectorOpen)}
                className="w-full h-9 sm:h-[56px] bg-white dark:bg-nvu-surface border border-slate-200 dark:border-nvu-line rounded-lg sm:rounded-[12px] px-2 sm:px-4 flex items-center justify-center gap-1.5 sm:gap-[12px] shadow-sm active:scale-[0.99] transition-transform"
              >
                <ActiveIcon
                  size={14}
                  className="text-slate-600 dark:text-nvu-muted shrink-0 sm:!w-[20px] sm:!h-[20px]"
                />
                <span className="text-[11px] sm:text-[16px] font-semibold text-slate-800 dark:text-nvu-text truncate leading-none sm:leading-none">
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
          )}

          {showLaunchTrip && (
            <div
              className={cn(
                "min-w-0 sm:flex-1",
                isIntegrated ? "flex-1" : "flex-[5.5]",
              )}
            >
              <button
                onClick={() => void handleTripAction()}
                className={cn(
                  "w-full h-9 sm:h-[56px] rounded-lg sm:rounded-[12px] shadow-sm flex items-center justify-center gap-1.5 sm:gap-[12px] transition-colors",
                  myJob && !operationalSuspension.active
                    ? "bg-[#1f242d] hover:bg-[#2a303c] active:bg-[#151921] text-white dark:bg-slate-200 dark:hover:bg-slate-300 dark:text-slate-800"
                    : "bg-gray-400 dark:bg-gray-600 text-white cursor-not-allowed opacity-80",
                )}
              >
                {myJob && !operationalSuspension.active ? (
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
        </div>

        {/* Dropdown in normal document flow */}
        {!isIntegrated && isPageSelectorOpen && (
          <div className="w-full bg-white dark:bg-nvu-surface border border-slate-200 dark:border-nvu-line rounded-lg shadow-sm overflow-hidden animate-in fade-in slide-in-from-top-2">
            {pageOptions.map((opt) => {
              const Icon = opt.icon;
              return (
                <button
                  key={opt.id}
                  onClick={() => {
                    setIsPageSelectorOpen(false);
                    void prepareAndCommitNavigation(
                      () => {},
                      () => navigate(opt.id)
                    );
                  }}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 sm:px-4 sm:py-3 border-b border-slate-100 dark:border-nvu-line last:border-0 hover:bg-slate-50 dark:hover:bg-nvu-strip transition-colors text-left",
                    location.pathname === opt.id
                      ? "bg-slate-50 dark:bg-nvu-strip"
                      : "",
                  )}
                >
                  <Icon
                    size={16}
                    className={cn(
                      location.pathname === opt.id
                        ? "text-blue-600 dark:text-[#0cb49f]"
                        : "text-slate-500",
                    )}
                  />
                  <span
                    className={cn(
                      "text-[13px] sm:text-[14px] font-semibold",
                      location.pathname === opt.id
                        ? "text-blue-700 dark:text-[#0cb49f]"
                        : "text-slate-600 dark:text-nvu-text-soft",
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
  };

  const handleCopyPaintCode = (paintCode?: string) => {
    if (paintCode) {
      const finishCopy = () => {
        setCopiedCode("Código copiado: " + paintCode);
        setTimeout(() => setCopiedCode(null), 3000);
      };
      if (navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(paintCode).then(finishCopy).catch(() => {
          const textarea = document.createElement("textarea");
          textarea.value = paintCode;
          textarea.setAttribute("readonly", "");
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          document.body.appendChild(textarea);
          textarea.select();
          try { document.execCommand("copy"); } finally { textarea.remove(); }
          finishCopy();
        });
        return;
      }
      const textarea = document.createElement("textarea");
      textarea.value = paintCode;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      try { document.execCommand("copy"); } finally { textarea.remove(); }
      finishCopy();
    } else {
      setCopiedCode("Nenhum código de pintura cadastrado");
      setTimeout(() => setCopiedCode(null), 3000);
    }
  };

  const handleRequestDemand = async () => {
    try {
      if (operationalSuspension.active) {
        alert(
          "Suas atividades operacionais estão suspensas. Aguarde o término da suspensão para solicitar um novo trabalho.",
        );
        return;
      }
      setIsSubmittingDemand(true);
      await requestNewJobDemand();
      setDemandSuccess(true);
      setTimeout(() => setDemandSuccess(false), 3000);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmittingDemand(false);
    }
  };

  const handleResultRequestNewJob = () => {
    setShowOperationResultModal(false);
    const event = new CustomEvent("app-navigate", {
      detail: { to: "dashboard" },
    });
    window.dispatchEvent(event);
    void handleRequestDemand();
  };

  // Check if there is an active request
  const myPendingRequest = driverRequests.find(
    (r) => r.motoristaId === currentUser?.id && r.status === "pending",
  );

  // myPendingRequest and !activeCompanyId logical blocks removed from here.
  // They are now isolated into JoinCompany.tsx and handled by DriverLayout.tsx router.

  const activeOperationResolved =
    jobsReady && (!myJob || Boolean(contract) || contractsReady);

  // Never paint the actionable "Solicitar Novo Trabalho" state before the
  // scoped job/contract snapshots have settled. A cached operation remains
  // visible immediately; only a first-ever uncached entry receives this
  // neutral, fixed-height synchronization card.
  if ((!myJob || !contract) && !activeOperationResolved) {
    return (
      <div className="space-y-3 sm:space-y-4 w-full max-w-7xl mx-auto pb-4 pt-0">
        {!isIntegrated && renderTopControls(false)}
        <OperationalSuspensionNotice user={currentUser as any} />
        <Card className="border border-slate-200 dark:border-nvu-line shadow-sm bg-white dark:bg-nvu-surface rounded-2xl overflow-hidden">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-white/5 flex items-center justify-center shrink-0">
                <Loader2 size={17} className="animate-spin text-slate-500 dark:text-nvu-muted" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] sm:text-sm font-bold text-slate-800 dark:text-nvu-text">
                  Sincronizando operação atual
                </p>
                <p className="text-[11px] sm:text-xs text-slate-500 dark:text-nvu-muted mt-0.5">
                  Confirmando seu trabalho ativo sem alterar a tela.
                </p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2" aria-hidden="true">
              <div className="h-12 rounded-xl bg-slate-100/80 dark:bg-white/5 animate-pulse" />
              <div className="h-12 rounded-xl bg-slate-100/80 dark:bg-white/5 animate-pulse" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!myJob || !contract) {
    if (operationCardOnly) {
      return <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-[13px] text-slate-500 dark:border-nvu-line dark:bg-nvu-surface dark:text-nvu-muted">Nenhuma operação em andamento.</div>;
    }
    const myDemand = jobDemands.find(
      (d) =>
        d.driverId === currentUser?.id &&
        d.status === "pending" &&
        d.companyId === activeCompanyId,
    );

    const solicitarTrabalhoCard = <DriverWorkRequest
      variant="panel" online={Boolean(currentUser?.isOnline)} suspended={operationalSuspension.active}
      busy={isSubmittingDemand} pending={Boolean(myDemand)}
      requestedAt={myDemand ? format(new Date(myDemand.createdAt), "HH:mm") : undefined}
      success={demandSuccess} onRequest={() => void handleRequestDemand()} onCancel={() => void cancelJobDemand().catch(() => {})}
    />;

    const filaOperacionalSection = pendingDriverJobs.length > 0 && <DriverAssignedQueue
      key={`assigned:${resultScope}`} jobs={pendingDriverJobs} contracts={contracts} suspended={operationalSuspension.active}
      startingJobId={startingJobId} onStart={async job => {
        if (operationalSuspension.active || startingJobId) return;
        setStartingJobId(job.id);
        try { await startJob(job.id); }
        catch (error: any) { alert(error?.message || "Não foi possível iniciar a operação."); }
        finally { setStartingJobId(current => current === job.id ? null : current); }
      }} />;

    return (
      <DriverIdlePanel company={currentCompany} viewerId={String(currentUser?.id || "")}
        online={Boolean(currentUser?.isOnline)} suspended={operationalSuspension.active}
        onAvailabilityChange={updateUserOnlineStatus}>
        <OperationResultModal
          key={resultScope}
          isOpen={showOperationResultModal && operationResultScope === resultScope}
          onClose={() => setShowOperationResultModal(false)}
          onRequestNewJob={handleResultRequestNewJob}
          resultData={operationResultData}
        />
        {!isIntegrated && renderTopControls(true)}
        <OperationalSuspensionNotice user={currentUser as any} />
        {solicitarTrabalhoCard}
        {filaOperacionalSection}
        {hasAutomaticQueues && <AutomaticDriverQueue blocked={operationalSuspension.active} />}
        {!hasAutomaticQueues && !pendingDriverJobs.length && <section className="nvu-idle-empty-queue" aria-label="Fila operacional">
          <h2>Fila operacional</h2><p>A empresa ainda não encaminhou operações para a sua fila.</p>
        </section>}
        <DriverPreviousWork key={`history:${resultScope}`} jobs={completedJobs} contracts={contracts} trips={historicoTrips}
          driverId={String(currentUser?.id || "")} historyReady={Boolean(isIntegrated ? tripHistoryReadyOverride : driverTripsState.historyReady)}
          onReview={reviewPreviousWork} />
      </DriverIdlePanel>
    );
  }

  const isAwaitingCompletion = myJob.status === "awaiting_completion";
  const isActive = isRunningJobStatus(myJob.status);
  const realProgress = currentOperationProgress;
  const progressPercent =
    Math.round(
      (realProgress / Math.max(1, contract.totalDeliveries || 1)) * 100,
    ) || 0;
  const operationReadyForManualFinish =
    isAwaitingCompletion || myJob.operationSyncState === "pending_finish" || (Number(contract.totalDeliveries || 0) > 0 &&
    realProgress + localPendingTrips >= Number(contract.totalDeliveries || 0));

  const targetDateString = myJob.dueAt || myJob.deadlineDate;
  const deadlineDate = new Date(targetDateString);
  const diffMs = deadlineDate.getTime() - now.getTime();
  const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24)); // Replaced differenceInDays

  let timeRemainingText = "Atrasado";
  const hasValidDeadline = Boolean(targetDateString);

  if (!hasValidDeadline) {
    timeRemainingText = "Não definido";
  } else if (diffMs > 0) {
    const d = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const h = Math.floor((diffMs / (1000 * 60 * 60)) % 24);
    const m = Math.floor((diffMs / 1000 / 60) % 60);
    timeRemainingText = `${d}d · ${h}h · ${m}min`;
  }

  const assignedAtDate = myJob.assignedAt
    ? new Date(myJob.assignedAt)
    : myJob.createdAt
      ? new Date(myJob.createdAt)
      : new Date();
  const calculatedTotalDays = Math.ceil(
    (deadlineDate.getTime() - assignedAtDate.getTime()) / (1000 * 60 * 60 * 24),
  );
  const totalDays =
    calculatedTotalDays > 0
      ? calculatedTotalDays
      : contract.deadlineDays > 0
        ? contract.deadlineDays
        : 1;
  const daysElapsed = Math.max(0, totalDays - daysLeft);

  const expectedDeliveries =
    (daysElapsed / totalDays) * contract.totalDeliveries;

  let currentRating = 5.0;
  if (expectedDeliveries > 0) {
    const ratio = realProgress / expectedDeliveries;
    currentRating = Math.min(5.0, Math.max(1.0, 5.0 * ratio));
  } else if (daysElapsed > 0 && realProgress === 0) {
    currentRating = 4.0;
  }

  let ratingText = "";
  if (currentRating >= 4.5) ratingText = "Excelente";
  else if (currentRating >= 4.0) ratingText = "Muito bom";
  else if (currentRating >= 3.0) ratingText = "Bom";
  else if (currentRating >= 2.0) ratingText = "Regular";
  else ratingText = "Ruim";

  const handleFinishJob = async () => {
    if (!myJob) return;
    setIsFinishing(true);
    try {
      const completion = await finishJob(myJob.id);
      if (completion.pendingSync) {
        toast.message("Finalização salva no aparelho. Aguardando sincronização das viagens.");
        return;
      }
      const resultData = buildOperationResultSummary({
        job: { ...myJob, status: "completed", completedAt: new Date().toISOString(),
          progress: completion.progress, totalDeliveries: completion.total },
        contract, trips: currentOperationTrips,
        vehicleName: vehicle?.name, trailerName: trailerlessSimulator ? undefined : trailer?.name,
        showTrailer: !trailerlessSimulator,
      });

      if (currentUser?.id && activeCompanyId) publishOperationCompletionResult({
        userId: currentUser.id, companyId: activeCompanyId, jobId: myJob.id, data: resultData,
      });
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar a finalização.");
      // finishJob presents the server failure once. No blocking browser alert
      // keeps the button in Processando while the message is open.
    } finally {
      setIsFinishing(false);
    }
  };

  const landscapeOperationLayout = landscapeWorkspace && isIntegrated && !operationCardOnly;
  const controlsAndCard = (
      <div className="flex flex-col w-full gap-1.5 sm:gap-2" data-testid="operation-controls-and-card">
        <div className="order-1 sm:order-2 w-full">
          {renderTopControls(true)}
        </div>
        <div className="order-2 sm:order-2 w-full">
          <OperationalSuspensionNotice user={currentUser as any} />
        </div>
        {isGtoWork && currentCompany && (
          <div className="hidden" aria-hidden="true">
            <GtoObserverSetup
              context={{
                driverId: currentUser.id,
                driverName: currentUser.name,
                companyId: currentCompany.id,
                companyName: currentCompany.companyName || currentCompany.name || "Empresa",
                jobId: myJob.id,
                jobStatus: myJob.status,
                confirmedTripCount: currentOperationProgress,
                jobProgress: currentOperationProgress,
                jobTotalDeliveries: contract.totalDeliveries || 0,
                contractId: contract.id,
                contractName: contract.name || "",
                contractMode: contract.mode,
                vehicleId: vehicle?.id || "",
                vehicleName: vehicle?.name || "",
                trailerId: trailer?.id || "",
                trailerName: trailer?.name || "",
                expectedGtoOrigin: activeDetailedGtoRoute?.origin || "",
                expectedGtoDestination: activeDetailedGtoRoute?.destination || "",
                trustedGtoCitiesJson,
              }}
            />
          </div>
        )}
        {/* Main Job Card */}
        <div className="order-3 flex flex-col bg-white dark:bg-nvu-page rounded-2xl sm:rounded-[24px] shadow-sm dark:shadow-none border border-gray-200 dark:border-nvu-line overflow-hidden mb-3 sm:mb-4 mt-0">
          <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={onVehiclePhotoSelected} />
          <div className="relative nvu-driver-vehicle-photo">
          <button type="button" disabled={vehiclePhotoBusy || !vehicle?.id} aria-label={displayedVehiclePhoto ? "Substituir foto do veículo" : "Adicionar foto do veículo"} onClick={() => photoInputRef.current?.click()} className="relative w-full h-44 sm:h-64 overflow-hidden bg-[#151921] text-gray-400 flex items-center justify-center disabled:cursor-wait">
            {displayedVehiclePhoto ? <CachedImage src={displayedVehiclePhoto} alt="Fotografia cadastrada do veículo" className="h-full w-full object-cover" /> : <span className="flex items-center gap-2 text-sm"><ImagePlus size={20}/> Adicionar foto do veículo</span>}
            {vehiclePhotoBusy && <span className="absolute bottom-2 right-2 rounded-lg bg-black/70 px-3 py-1 text-xs text-white">Salvando…</span>}
          </button>
          <button type="button" className="nvu-driver-operation-info"
            aria-label="Informações da operação em andamento" aria-haspopup="dialog"
            aria-expanded={isOperationInfoOpen} aria-controls={operationInfoId}
            onClick={() => setOperationInfoScope(currentOperationInfoScope)}>
            <Info size={20} strokeWidth={1.6} aria-hidden="true" />
          </button>
          </div>
          {vehiclePhotoError && <p role="alert" className="px-4 pt-2 text-xs text-rose-600 dark:text-rose-400">{vehiclePhotoError}</p>}
          {vehiclePhotoPending && !vehiclePhotoBusy && <p role="status" className="px-4 pt-2 text-xs text-slate-500 dark:text-nvu-muted">Foto salva no aparelho. Sincronização pendente; será tentada quando a conexão voltar.</p>}
          {/* Header */}
          <div className="relative overflow-hidden bg-[#1f242d] dark:bg-nvu-page p-3 sm:p-4 w-full" style={{ display: operationReadyForManualFinish ? undefined : "none" }}>
            {/* Subtle glow effect */}
            <div className="absolute top-[-50%] right-[-10%] w-[150px] h-[150px] bg-white/5 rounded-full blur-[40px] pointer-events-none"></div>

            {operationReadyForManualFinish ? (
              <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
                <div className="flex flex-col items-start min-w-0">
                  <h3 className="text-[15px] sm:text-[18px] font-bold text-green-400 tracking-tight leading-none mb-1">
                    {localPendingTrips > 0 ? "Entregas salvas no aparelho" : "Entregas concluídas!"}
                  </h3>
                  <p className="text-[10px] sm:text-[11px] font-medium text-gray-400 leading-tight">
                    Finalize a operação para continuar. O servidor confirmará as entregas.
                  </p>
                </div>
                <button
                  onClick={handleFinishJob}
                  disabled={isFinishing || myJob.operationSyncState === "pending_finish"}
                  className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-full text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0 w-full sm:w-auto text-center"
                >
                  {myJob.operationSyncState === "pending_finish" ? "Finalização salva" : isFinishing ? "Salvando…" : "Finalizar Operação"}
                </button>
              </div>
              ) : (
              <div className="flex justify-between items-start z-10 relative gap-3">
                <div className="flex flex-col pr-2 min-w-0">
                  <span className="text-[8px] sm:text-[9px] font-bold text-emerald-400 uppercase tracking-wider mb-1">
                    TRABALHO ATIVO
                  </span>
                  <span className="text-[8px] sm:text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1 mt-0.5">
                    Operação atual
                  </span>
                  <h3 className="font-bold text-white text-[22px] sm:text-[26px] tracking-tight leading-none mb-1.5">
                    {contract.name}
                  </h3>
                  <p className="text-[10px] sm:text-[11px] text-gray-400 font-medium leading-none truncate whitespace-nowrap">
                    Siga as especificações do transporte.
                  </p>
                </div>

                <div className="shrink-0 flex pt-0.5">

                </div>
              </div>
              )}
          </div>

          {/* Content Area */}
          <div className="nvu-current-operation-body flex flex-col">
            <PendingProOperationNotice jobId={myJob?.id} driverId={currentUser?.id}
              companyId={activeCompanyId} confirmed={currentOperationProgress}
              serverProgress={Number(myJob?.progress || 0)}
              total={contract?.totalDeliveries || 0}
              visibleHistoryCount={currentOperationTrips.length}
              historyReady={Boolean(isIntegrated ? tripHistoryReadyOverride : driverTripsState.historyReady)} />
            <div className="nvu-current-operation-vehicle flex items-center gap-3 rounded-xl px-1">
              <button type="button" onClick={() => setPaintDialogOpen(true)} aria-label="Ver pinturas do veículo e reboque" title="Pinturas disponíveis" className="shrink-0 p-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/5 dark:text-nvu-text-soft dark:hover:bg-white/10"><Download size={17} strokeWidth={1.7}/></button>
              <div className="min-w-0 flex-1"><p className="text-base font-semibold text-slate-900 dark:text-white break-words">{vehicle?.name || "Veículo não informado"}</p><p className="text-xs text-gray-400 break-words">{!trailerlessSimulator ? trailer?.name || "Reboque não informado" : ""}</p></div><div className="border-l border-slate-200 dark:border-nvu-line pl-3 text-sm font-semibold text-slate-900 dark:text-white shrink-0">{contract.name}</div>
              
            </div>
            {/* Metrics */}
            <div className="nvu-driver-operation-metrics border border-gray-100 dark:border-nvu-line bg-gray-50/50 dark:bg-nvu-strip rounded-[8px] flex items-center shadow-sm dark:shadow-none mt-0.5">
              <div className="flex-1 py-1.5 flex flex-col items-center justify-center text-center">
                <span className="text-[14px] sm:text-[16px] font-bold text-slate-800 dark:text-nvu-text leading-none tracking-tight mb-0.5">
                  {realProgress}/{contract.totalDeliveries}
                </span>
                <span className="text-[7px] sm:text-[8px] text-gray-400 dark:text-nvu-muted uppercase tracking-wider font-semibold">
                  Entregas
                </span>
              </div>

              <div className="w-px h-6 bg-gray-200/60 dark:bg-nvu-line shrink-0"></div>

              <div className="flex-1 py-1.5 flex flex-col items-center justify-center text-center">
                <span className="text-[14px] sm:text-[16px] font-bold text-slate-800 dark:text-nvu-text leading-none tracking-tight mb-0.5">
                  {Math.max(0, contract.totalDeliveries - realProgress)}
                </span>
                <span className="text-[7px] sm:text-[8px] text-gray-400 dark:text-nvu-muted uppercase tracking-wider font-semibold">
                  Faltam
                </span>
              </div>

              <div className="w-px h-6 bg-gray-200/60 dark:bg-nvu-line shrink-0"></div>

              <div className="flex-1 py-1.5 flex flex-col items-center justify-center text-center">
                <span className="text-[14px] sm:text-[16px] font-bold text-slate-800 dark:text-nvu-text leading-none tracking-tight mb-0.5">
                  {progressPercent.toFixed(0)}%
                </span>
                <span className="text-[7px] sm:text-[8px] text-gray-400 dark:text-nvu-muted uppercase tracking-wider font-semibold">
                  Concluído
                </span>
              </div>
            </div>

            {/* Compact Progress bar */}
            <div className="flex flex-col gap-1.5 mt-1 mb-0.5">
              <OperationProgressBar
                percent={progressPercent}
                replayKey={
                  progressAnimationKey ??
                  `${location.key}:${location.pathname}:${myJob.id}`
                }
              />
              <p className="text-[8px] uppercase tracking-wider font-semibold text-gray-400 dark:text-nvu-muted text-center">
                Progresso da operação
              </p>
            </div>
          </div>

          {/* Remaining time and the contextual action share equal compact tiles. */}
          <OperationSyncNotice job={myJob} />
          <DriverOperationTiming remaining={timeRemainingText} onStart={() => void handleTripAction()}
            disabled={!isTripRecordableJobStatus(myJob.status, realProgress, contract.totalDeliveries) || operationReadyForManualFinish || isWorkModeChecking || isSimpleAutomationStarting}
            busy={isWorkModeChecking || isSimpleAutomationStarting} />
          <DriverStatusRow online={Boolean(currentUser?.isOnline)} suspended={operationalSuspension.active}
            onChange={updateUserOnlineStatus} />
        </div>
      </div>
  );
  const contractRoutesCard = (contract.mode === "detailed" &&
    contract.deliveries &&
    contract.deliveries.length > 0
    ? (
          <Card className="border border-gray-100 dark:border-nvu-line shadow-sm bg-white dark:bg-nvu-surface">
            <CardContent className="p-3 sm:p-4">
              <h3 className="text-[13px] sm:text-[14px] font-bold text-gray-900 dark:text-nvu-text mb-3 uppercase tracking-wide flex items-center gap-2">
                <MapPin size={16} className="text-blue-500" />
                Rotas do Contrato
              </h3>
              <div className="flex flex-col gap-2 relative">
                {/* Connecting line for desktop/tablet */}
                <div className="hidden sm:block absolute top-4 bottom-4 left-[23px] w-px bg-gray-200 dark:bg-nvu-line z-0"></div>

                {contract.deliveries.map((del, idx) => {
                  const isCompleted = idx < realProgress;
                  return (
                    <div
                      key={del.id || idx}
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-xl border transition-colors text-[13px] sm:text-[14px] relative z-10",
                        isCompleted
                          ? "bg-green-50/80 dark:bg-green-500/10 border-green-100 dark:border-green-500/20"
                          : "bg-gray-50/80 dark:bg-nvu-surface border-gray-100 dark:border-nvu-line",
                      )}
                    >
                      <div className="shrink-0 flex items-center justify-center w-6 h-6 bg-white dark:bg-nvu-surface rounded-full sm:shadow-sm">
                        {isCompleted ? (
                          <CheckCircle
                            size={18}
                            className="text-green-600 dark:text-green-400"
                          />
                        ) : (
                          <div className="w-[14px] h-[14px] rounded-full border-2 border-gray-300 dark:border-nvu-line"></div>
                        )}
                      </div>
                      <div className="flex-1 flex flex-row items-center min-w-0 gap-2 sm:gap-3">
                        <span
                          className={cn(
                            "font-semibold truncate",
                            isCompleted
                              ? "text-green-800 dark:text-green-400"
                              : "text-gray-900 dark:text-nvu-text",
                          )}
                        >
                          {del.origin}
                        </span>
                        <span className="text-gray-300 dark:text-nvu-muted shrink-0">
                          →
                        </span>
                        <span
                          className={cn(
                            "font-semibold truncate",
                            isCompleted
                              ? "text-green-800 dark:text-green-400"
                              : "text-gray-900 dark:text-nvu-text",
                          )}
                        >
                          {del.destination}
                        </span>
                      </div>
                      <div className="shrink-0">
                        <span className="text-[10px] font-bold text-gray-400 dark:text-nvu-muted uppercase tracking-wider">
                          #{idx + 1}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )
    : null);
  const operationTripHistory = (
        <TripHistory embeddedJob={myJob} hideHeader hideHeaderActions hideFloatingSummary
          historicoTripsOverride={historicoTrips}
          canonicalOperationTripsOverride={currentOperationTrips}
          historyLoadingOverride={tripHistoryLoading} />
  );

  return (
    <div className="space-y-3 sm:space-y-4 w-full max-w-7xl mx-auto pb-4 pt-0">
      {maintenanceMode && (
        <WorkModeMaintenanceDialog
          mode={maintenanceMode === "simple" ? "pro" : maintenanceMode}
          simulator={isGtoWork ? "GTO" : simpleAutomationSimulator?.key || "GTO"}
          onClose={() => setMaintenanceMode(null)}
        />
      )}
        {paintDialogOpen && createPortal(
        <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/70 p-3" onClick={() => setPaintDialogOpen(false)}>
          <section role="dialog" aria-modal="true" aria-label="Pinturas disponíveis" className="w-full max-w-md max-h-[85dvh] overflow-y-auto rounded-2xl border border-slate-200 dark:border-nvu-line bg-white dark:bg-nvu-surface p-5 text-slate-900 dark:text-white shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4"><h3 className="font-semibold text-lg text-slate-900 dark:text-white">Pinturas disponíveis</h3><button className="text-slate-600 dark:text-nvu-text" aria-label="Fechar" onClick={() => setPaintDialogOpen(false)}><X size={20}/></button></div>
            {([{ label: "Veículo", name: vehicle?.name, value: vehicle?.paintCode }, ...(!trailerlessSimulator ? [{ label: "Reboque", name: trailer?.name, value: trailer?.paintCode }] : [])]).map((item, index) => {
              const value = String(item.value || "").trim();
              const isLink = /^https:\/\//i.test(value);
              return <div key={index} className="mb-3 rounded-xl border border-slate-200 dark:border-nvu-line bg-slate-50 dark:bg-transparent p-3">
                <p className="text-xs text-slate-500 dark:text-nvu-muted">{item.label}</p><p className="font-semibold text-sm break-words">{item.name || "Não informado"}</p>
                {value ? <><p className="mt-2 text-xs text-slate-600 dark:text-nvu-muted break-all">{value}</p><button className="mt-3 rounded-lg bg-slate-200 dark:bg-nvu-strip text-slate-900 dark:text-white px-3 py-2 text-sm" onClick={() => { if (isLink) window.open(value, "_blank", "noopener,noreferrer"); else handleCopyPaintCode(value); }}>{isLink ? "Abrir link da pintura" : "Copiar código da pintura"}</button></> : <p className="mt-2 text-xs text-slate-500 dark:text-nvu-muted">Nenhuma pintura disponibilizada.</p>}
              </div>;
            })}
          </section>
        </div>, document.body
      )}
            <GtoWorkModeDialog
        open={isGtoModeDialogOpen}
        variant={isGtoWork ? "gto" : "simple"}
        simulatorLabel={simpleAutomationSimulator?.shortLabel}
        busy={isWorkModeChecking || isSimpleAutomationStarting}
        onClose={() => setIsGtoModeDialogOpen(false)}
        onSelect={handleGtoModeSelect}
        vehiclePhoto={displayedVehiclePhoto}
        vehicleName={vehicle?.name}
        vehiclePhotoPending={vehiclePhotoPending}
      />
      <OperationResultModal
        key={resultScope}
        isOpen={showOperationResultModal && operationResultScope === resultScope}
        onClose={() => setShowOperationResultModal(false)}
        onRequestNewJob={handleResultRequestNewJob}
        resultData={operationResultData}
      />
      <OperationResultModal
        key={currentOperationInfoScope}
        id={operationInfoId}
        isOpen={isOperationInfoOpen}
        onClose={() => setOperationInfoScope(null)}
        resultData={currentOperationInfo}
        status="in_progress"
      />
      {landscapeOperationLayout ? (
        <div className="nvu-landscape-operation-grid" data-testid="landscape-operation-grid">
          {controlsAndCard}
          <LandscapeOperationPanel key={`${activeCompanyId}:${myJob.id}`} blocked={operationalSuspension.active}
            tripCount={currentOperationTrips.length} routes={contractRoutesCard} trips={operationTripHistory} />
        </div>
      ) : (
        <>
          {controlsAndCard}
      <RetainedPanel active={!operationCardOnly} className="space-y-3 sm:space-y-4">
      {hasAutomaticQueues&&<AutomaticDriverQueue blocked={operationalSuspension.active}/>}

      {/* Contract Routes (Detailed Mode) */}
      {contractRoutesCard}

      {/* Collapse the whole history, not only each trip's expanded details. */}
      <DiscreetDisclosure key={`${activeCompanyId}:${myJob.id}`} title="Viagens da operação" icon={History}
        summary={`${currentOperationTrips.length} registradas`} testId="operation-trips-disclosure">
        {operationTripHistory}
      </DiscreetDisclosure>
      </RetainedPanel>
        </>
      )}

      {isContractModalOpen && (
        <ModalPortal label="Detalhes do contrato" onClose={() => setIsContractModalOpen(false)} busy={false}><div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 min-h-[100dvh]">
          <div className="nvu-viewport-modal-card flex flex-col bg-white dark:bg-nvu-surface rounded-2xl w-full max-w-lg shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 flex items-center justify-between border-b border-gray-100 dark:border-nvu-line">
              <h3 className="text-xl font-bold text-gray-900 dark:text-nvu-text">
                Detalhes do Contrato
              </h3>
              <button
                onClick={() => setIsContractModalOpen(false)}
                className="p-2 text-gray-400 hover:text-gray-600 dark:text-nvu-text-soft dark:hover:text-nvu-muted hover:bg-gray-100 dark:bg-nvu-strip dark:hover:bg-nvu-strip/50 rounded-full transition-colors"
                title="Fechar"
              >
                <X size={20} />
              </button>
            </div>

            <div className="nvu-modal-body p-6 overflow-y-auto max-h-[70vh] space-y-6">
              <div>
                <p className="text-sm font-medium text-gray-500 dark:text-nvu-muted mb-1">
                  Nome do Contrato
                </p>
                <p className="text-base font-semibold text-gray-900 dark:text-nvu-text">
                  {contract.name}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-500 dark:text-nvu-muted mb-1">
                    ID do Contrato
                  </p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-nvu-text truncate">
                    {contract.id}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500 dark:text-nvu-muted mb-1">
                    Prazo Restante
                  </p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-nvu-text">
                    {daysLeft} dias
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500 dark:text-nvu-muted mb-1">
                    Total de Entregas
                  </p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-nvu-text">
                    {contract.totalDeliveries}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500 dark:text-nvu-muted mb-1">
                    Status
                  </p>
                  <p
                    className={cn(
                      "text-sm font-semibold",
                      isActive
                        ? diffMs < 0
                          ? "text-red-600 dark:text-red-400"
                          : "text-blue-600 dark:text-blue-400"
                        : "text-yellow-600 dark:text-yellow-400",
                    )}
                  >
                    {isAwaitingCompletion
                      ? "Aguardando Finalização"
                      : isActive
                        ? diffMs < 0
                          ? "Atrasado"
                          : "Em andamento"
                        : "Pendente"}
                  </p>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-gray-500 dark:text-nvu-muted mb-2">
                  Simulador
                </p>
                <div className="bg-gray-50 dark:bg-nvu-surface p-3 rounded-lg border border-gray-100 dark:border-nvu-line">
                  <p className="font-medium text-gray-900 dark:text-nvu-text">
                    {contract.simulator}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-gray-50 dark:bg-nvu-surface px-6 py-4 flex justify-end border-t border-gray-100 dark:border-nvu-line">
              <Button onClick={() => setIsContractModalOpen(false)}>
                Fechar
              </Button>
            </div>
          </div>
        </div></ModalPortal>
      )}

      {/* Snackbar for Copied Paint Code */}
      {copiedCode && (
        <div className="fixed bottom-4 sm:bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-5">
          <div className="bg-gray-900 text-white px-4 py-3 rounded-xl shadow-lg dark:shadow-none font-medium text-sm flex items-center gap-2">
            <CheckCircle size={16} className="text-green-400" />
            {copiedCode}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Dashboard(props: {
  isIntegrated?: boolean;
  operationCardOnly?: boolean;
  tripHistoryOverride?: any[];
  tripHistoryLoadingOverride?: boolean;
  tripHistoryReadyOverride?: boolean;
  progressAnimationKey?: string;
  vehiclePhotoOverride?: VehiclePhotoController;
}) {
  return (
    <ErrorBoundary>
      <DashboardComponent {...props} />
    </ErrorBoundary>
  );
}
