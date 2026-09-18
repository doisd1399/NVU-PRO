import React, { useState, useMemo, useEffect } from "react";
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
} from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { prepareAndCommitNavigation } from "../../lib/navigationTransition";
import { ptBR } from "date-fns/locale";

import { db } from "../../lib/firebase";
import { query, collection, where, onSnapshot } from "firebase/firestore";
import ErrorBoundary from "../../components/ErrorBoundary";
import { OperationalSuspensionNotice } from "../../components/OperationalSuspensionNotice";
import { useOperationalSuspension } from "../../hooks/useOperationalSuspension";
import TripHistory from "./TripHistory";
import { OperationProgressBar } from "../../components/common/OperationProgressBar";
import { isClosedJobStatus, isRunningJobStatus } from "../../lib/jobStatus";
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
import GtoObserverSetup from "../../components/GtoObserverSetup";

import { cn, getJobRealTimestamp, getNomeContratoHistorico } from "../../lib/utils";
import { useDriverTrips } from "../../hooks/useDriverTrips";
import { normalizeTrip } from "../../lib/tripNormalizer";
import {
  OperationResultModal,
  OperationResultData,
} from "../../components/OperationResultModal";
import {
  consumeOperationCompletionResult,
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
  tripHistoryOverride,
  tripHistoryLoadingOverride,
  progressAnimationKey,
}: {
  isIntegrated?: boolean;
  tripHistoryOverride?: any[];
  tripHistoryLoadingOverride?: boolean;
  progressAnimationKey?: string;
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
  const [isSubmittingDemand, setIsSubmittingDemand] = useState(false);
  const [isGtoModeDialogOpen, setIsGtoModeDialogOpen] = useState(false);
  const [isSimpleAutomationStarting, setIsSimpleAutomationStarting] = useState(false);
  const [simpleAutomationCities, setSimpleAutomationCities] = useState<SimpleAutomationCity[]>([]);
  const [demandSuccess, setDemandSuccess] = useState(false);

  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const [isFinishing, setIsFinishing] = useState(false);
  const [showOperationResultModal, setShowOperationResultModal] =
    useState(false);
  const [operationResultData, setOperationResultData] =
    useState<OperationResultData | null>(null);

  React.useEffect(() => {
    const consumeResult = () => {
      const userId = String(currentUser?.id || "").trim();
      if (!userId) return;
      const handoff = consumeOperationCompletionResult(userId);
      if (!handoff) return;
      setOperationResultData(handoff.data);
      setShowOperationResultModal(true);
    };

    consumeResult();
    window.addEventListener(OPERATION_RESULT_READY_EVENT, consumeResult);
    return () => {
      window.removeEventListener(OPERATION_RESULT_READY_EVENT, consumeResult);
    };
  }, [currentUser?.id]);

  const navigate = useNavigate();
  const location = useLocation();
  const [isPageSelectorOpen, setIsPageSelectorOpen] = useState(false);
  const [operationTripsExpanded, setOperationTripsExpanded] = useState(false);

  React.useEffect(() => {
    const routeState = location.state as
      | { nvuOperationResult?: OperationResultData }
      | null;
    if (!routeState?.nvuOperationResult) return;
    setOperationResultData(routeState.nvuOperationResult);
    setShowOperationResultModal(true);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);

  // --- MOVED HOOKS TO TOP ---
  const myJob = useMemo(
    () => selectCurrentOperationJob(jobs, currentUser?.id, activeCompanyId),
    [activeCompanyId, currentUser?.id, jobs],
  );

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
        j.status === "pending",
    );
    valid.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA; // Oldest first? Actually dateA - dateB means oldest is first.
    });
    return valid;
  }, [jobs, currentUser?.id]);

  const contract = useMemo(
    () => (myJob ? contracts.find((c) => c.id === myJob.contractId) : null),
    [myJob, contracts],
  );

  const currentOperationTrips = useMemo(() => {
    if (!myJob) return [];

    const assignedTime = myJob.assignedAt
      ? new Date(myJob.assignedAt).getTime()
      : myJob.createdAt
        ? new Date(myJob.createdAt).getTime()
        : 0;
    const completedTime = myJob.completedAt
      ? new Date(myJob.completedAt).getTime()
      : Date.now() + 86_400_000;

    return normalizedCompanyTrips.filter((trip: any) => {
      if (trip.jobId && trip.jobId === myJob.id) return true;
      const tripContractId = trip.contractId || trip.contratoId;
      const tripDriverId =
        trip.driverId || trip.motoristaId || trip.motorista_id || trip.userId;
      if (tripContractId !== myJob.contractId) return false;
      if (tripDriverId !== currentUser?.id) return false;
      const tripTime = trip.metricDate.getTime();
      return tripTime >= assignedTime && tripTime <= completedTime;
    });
  }, [normalizedCompanyTrips, myJob, currentUser?.id]);

  const totalGanhosCurrentOperation = useMemo(
    () =>
      currentOperationTrips.reduce(
        (total: number, trip: any) => total + trip.normalizedValor,
        0,
      ),
    [currentOperationTrips],
  );

  const vehicle = useMemo(
    () => (myJob ? vehicles.find((v) => v.id === myJob.vehicleId) : null),
    [myJob, vehicles],
  );

  const trailerlessSimulator = isTrailerlessSimulator(
    contract,
    simulators as unknown[],
  );

  const trailer = useMemo(() => {
    if (trailerlessSimulator) return null;
    const tId = myJob?.trailerId || contract?.trailerId;
    const foundTrailer = tId ? trailers.find((t) => t.id === tId) : null;
    return foundTrailer;
  }, [myJob, contract, trailers, trailerlessSimulator]);

  const currentCompany = useMemo(
    () => companies.find((company) => company.id === activeCompanyId) || null,
    [companies, activeCompanyId],
  );

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
    const progress = Math.max(0, Number(myJob?.progress || 0));
    return deliveries[Math.min(progress, deliveries.length - 1)];
  }, [contract?.deliveries, myJob?.progress]);
  const trustedGtoCitiesJson = JSON.stringify(trustedGtoCities);

  const simpleAutomationSimulator = useMemo(
    () =>
      getSimpleAutomationSimulator(currentCompany, simulators as unknown[]) ||
      getSimpleAutomationSimulator(contract, simulators as unknown[]) ||
      getSimpleAutomationSimulator(myJob, simulators as unknown[]),
    [currentCompany, contract, myJob, simulators],
  );
  const isGtoWork =
    resolveTripSimulatorCode(currentCompany as any, simulators as any[]) === "GTO" ||
    resolveTripSimulatorCode(contract as any, simulators as any[]) === "GTO" ||
    resolveTripSimulatorCode(myJob as any, simulators as any[]) === "GTO";
  // Global Truck is both the GTO Max host and a valid simple-automation host.
  // Keep it classified as GTO so the three-option dialog remains available.
  const isSimpleAutomationWork = Boolean(simpleAutomationSimulator);

  React.useEffect(() => {
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
        console.error("[NVU] Falha ao carregar cidades do Modo Pro", error);
        if (!cancelled) setSimpleAutomationCities([]);
      });
    return () => {
      cancelled = true;
    };
  }, [simpleAutomationSimulator]);

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
      totalDeliveries: contract?.totalDeliveries,
      hasContract: Boolean(contract),
      hasUser: Boolean(currentUser),
      hasCompany: Boolean(currentCompany),
    });

    if (isSimpleAutomationWork && !proAvailability.canLaunch) {
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
      const result = await launchGtoWork({
        driverId: currentUser.id,
        driverName: currentUser.name,
        companyId: currentCompany.id,
        companyName: currentCompany.companyName || currentCompany.name || "Empresa",
        jobId: myJob.id,
        jobStatus: myJob.status,
        jobProgress: myJob.progress || 0,
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
      alert("Não foi possível abrir o trabalho GTO. Tente novamente.");
    }
  };

  const startSimpleAutomation = async () => {
    if (!simpleAutomationSimulator) return;
    const proAvailability = getProLaunchAvailability({
      job: myJob,
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
    if (!simpleAutomationCities.length) {
      alert(`Nenhuma cidade cadastrada para ${simpleAutomationSimulator.shortLabel}. Peça ao Painel Sênior para usar Gerenciar cidades.`);
      return;
    }
    setIsSimpleAutomationStarting(true);
    try {
      const result = await launchSimpleAutomation(
        simpleAutomationSimulator.key,
        simpleAutomationCities,
        currentCompany.companyName || currentCompany.name || "Empresa",
        {
          companyId: currentCompany.id,
          driverId: currentUser?.id,
          jobId: myJob?.id,
          contractId: contract?.id,
          operationName: contract?.name || "Operação atual",
          contractName: contract?.name || "",
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
    () => {
      const contractsMap = new Map(contracts.map(c => [c.id, c]));
      return jobs
        .filter(
          (j) => j.driverId === currentUser?.id && j.status === "completed",
        )
        .sort((a, b) => {
          const dateA = getJobRealTimestamp(a, historicoTrips);
          const dateB = getJobRealTimestamp(b, historicoTrips);

          const contractA = getNomeContratoHistorico(a, contractsMap.get(a.contractId));
          const contractB = getNomeContratoHistorico(b, contractsMap.get(b.contractId));

          if (dateB !== dateA) {
            return dateB - dateA;
          }

          return contractA.localeCompare(contractB);
        });
    },
    [jobs, contracts, currentUser?.id, historicoTrips],
  );
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
      <div className="w-full flex flex-col gap-2 sm:gap-3 mb-2 sm:mb-3">
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
                      () => navigate(opt.id)
                    );
                  }}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 sm:px-4 sm:py-3 border-b border-slate-100 dark:border-[#2A2F3A] last:border-0 hover:bg-slate-50 dark:hover:bg-[#2A2F3A] transition-colors text-left",
                    location.pathname === opt.id
                      ? "bg-slate-50 dark:bg-[#2A2F3A]"
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
  };

  const handleCopyPaintCode = (paintCode?: string) => {
    if (paintCode) {
      navigator.clipboard.writeText(paintCode);
      setCopiedCode("Código copiado: " + paintCode);
      setTimeout(() => setCopiedCode(null), 3000);
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
        <Card className="border border-slate-200 dark:border-[#2A2F3A] shadow-sm bg-white dark:bg-[#1A1F26] rounded-2xl overflow-hidden">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-white/5 flex items-center justify-center shrink-0">
                <Loader2 size={17} className="animate-spin text-slate-500 dark:text-slate-400" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] sm:text-sm font-bold text-slate-800 dark:text-slate-100">
                  Sincronizando operação atual
                </p>
                <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 mt-0.5">
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
    const lastJob = completedJobs[0];

    // Calculate days since last job
    let daysSinceLastJob = 0;
    if (lastJob?.createdAt) {
      // As a proxy since we don't have completedAt in some old records
      daysSinceLastJob = differenceInDays(
        new Date(),
        new Date(lastJob.createdAt),
      );
    }

    const myDemand = jobDemands.find(
      (d) =>
        d.driverId === currentUser?.id &&
        d.status === "pending" &&
        d.companyId === activeCompanyId,
    );

    const solicitarTrabalhoCard = (
      <Card className="border border-blue-100 dark:border-blue-500/20 shadow-sm bg-white dark:bg-[#1A1F26]">
        <CardContent className="p-4 sm:p-5 flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 mb-1">
              <CheckCircle size={16} />
              <h3 className="font-bold text-xs uppercase tracking-wider">
                Solicitar Novo Trabalho
              </h3>
            </div>
            <p className="text-gray-500 dark:text-[#a1a1aa] text-xs leading-relaxed">
              Sinalize disponibilidade à operação.
            </p>
          </div>

          <div>
            {myDemand ? (
              <div className="bg-yellow-50 dark:bg-amber-500/10 border border-yellow-100 dark:border-yellow-500/20 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-yellow-100 dark:bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 flex items-center justify-center shrink-0">
                    <Clock size={16} />
                  </div>
                  <div>
                    <p className="font-bold text-yellow-900 dark:text-yellow-300 text-xs text-left">
                      Na fila aguardando
                    </p>
                    <p className="text-[10px] text-yellow-700 dark:text-yellow-400 font-medium">
                      Às {format(new Date(myDemand.createdAt), "HH:mm")}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={cancelJobDemand}
                  className="h-8 text-xs bg-white dark:bg-[#1A1F26] border-yellow-200 text-yellow-700 w-full sm:w-auto hover:bg-yellow-50 dark:hover:bg-yellow-900/20"
                >
                  Cancelar Pedido
                </Button>
              </div>
            ) : demandSuccess ? (
              <div className="bg-green-50 dark:bg-green-500/10 border border-green-100 dark:border-green-500/20 rounded-xl p-3 flex items-center gap-3 text-green-700 dark:text-green-400">
                <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-500/20 flex items-center justify-center shrink-0">
                  <CheckCircle size={16} />
                </div>
                <div>
                  <p className="font-bold text-xs">Solicitação enviada</p>
                  <p className="text-[10px] font-medium">
                    Administração notificada com sucesso.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <Button
                  onClick={handleRequestDemand}
                  disabled={
                    !currentUser?.isOnline ||
                    isSubmittingDemand ||
                    operationalSuspension.active
                  }
                  className={cn(
                    "w-full h-10 text-sm font-bold shadow-sm dark:shadow-none transition-all",
                    currentUser?.isOnline && !operationalSuspension.active
                      ? "bg-[#1f242d] hover:bg-[#2a303c] active:bg-[#151921] dark:bg-blue-600 dark:hover:bg-blue-700 text-white"
                      : "bg-gray-100 dark:bg-[#18181b] text-gray-400 cursor-not-allowed",
                  )}
                >
                  {isSubmittingDemand ? (
                    <>
                      <Loader2 className="animate-spin mr-2" size={16} />{" "}
                      Enviando...
                    </>
                  ) : (
                    "Solicitar Novo Trabalho"
                  )}
                </Button>
                {operationalSuspension.active ? (
                  <p className="text-center text-[10px] text-red-500 font-semibold">
                    Solicitações bloqueadas durante a suspensão
                  </p>
                ) : !currentUser?.isOnline ? (
                  <p className="text-center text-[10px] text-gray-400 font-medium">
                    Fique online para enviar solicitação
                  </p>
                ) : null}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );

    const tempoOciosoCard = (
      <Card className="bg-gray-50 dark:bg-[#11141A] border border-gray-100 dark:border-[#2A2F3A] shadow-none p-3 sm:px-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-white dark:bg-[#1A1F26] border border-gray-200 dark:border-gray-800 flex items-center justify-center text-gray-500 dark:text-gray-400 shrink-0 shadow-sm">
              <Clock size={14} />
            </div>
            <div>
              <p className="text-[10px] font-bold text-gray-500 dark:text-[#a1a1aa] uppercase tracking-widest leading-none mb-1">
                Tempo Ocioso
              </p>
              <p className="text-[10px] text-gray-400 font-medium leading-none">
                Desde a última rota
              </p>
            </div>
          </div>
          <div className="flex items-baseline gap-1 shrink-0">
            <p className="text-2xl font-black text-gray-900 dark:text-[#fafafa] leading-none">
              {daysSinceLastJob}
            </p>
            <p className="text-[10px] font-bold text-gray-500 dark:text-[#a1a1aa]">
              dias
            </p>
          </div>
        </div>
      </Card>
    );

    const filaOperacionalSection = (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-gray-900 dark:text-[#fafafa] px-1">
          <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
          <h2 className="text-sm font-bold uppercase tracking-wider">
            Fila Operacional
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {pendingDriverJobs.length > 0 ? (
            pendingDriverJobs.map((job, idx) => {
              const c = contracts.find((ct) => ct.id === job.contractId);
              if (!c) return null;
              const positionLabels = [
                "Próximo contrato",
                "Segundo na fila",
                "Terceiro na fila",
              ];
              const positionLabel =
                positionLabels[idx] || `${idx + 1}º na fila`;

              return (
                <Card
                  key={job.id}
                  className="border border-gray-200 dark:border-[#3f3f46] shadow-sm bg-white dark:bg-[#1A1F26] overflow-hidden group hover:border-blue-300 dark:hover:border-blue-500/50 transition-colors"
                >
                  <CardContent className="p-0">
                    <div className="px-4 py-3 flex items-center justify-between bg-gray-50 dark:bg-[#11141A] border-b border-gray-100 dark:border-[#2A2F3A]">
                      <span className="text-[10px] font-bold text-gray-500 dark:text-[#a1a1aa] uppercase tracking-widest">
                        {positionLabel}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                        </span>
                        <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-widest">
                          Atribuído
                        </span>
                      </div>
                    </div>
                    <div className="px-4 py-4 space-y-4">
                      <div>
                        <p className="font-bold text-sm text-gray-900 dark:text-[#fafafa] mb-1 leading-tight">
                          {c.name}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-[#a1a1aa] font-medium leading-relaxed">
                          {c.totalDeliveries} entregas previstas na rota do
                          contrato selecionado.
                        </p>
                      </div>
                      <Button
                        onClick={async () => {
                          if (operationalSuspension.active || startingJobId) {
                            if (operationalSuspension.active) {
                              alert(
                                "Suas atividades operacionais estão suspensas. Aguarde o término da suspensão para iniciar esta operação.",
                              );
                            }
                            return;
                          }
                          setStartingJobId(job.id);
                          try {
                            await startJob(job.id);
                          } catch (error: any) {
                            alert(error?.message || "Não foi possível iniciar a operação.");
                          } finally {
                            setStartingJobId((current) =>
                              current === job.id ? null : current,
                            );
                          }
                        }}
                        disabled={operationalSuspension.active || Boolean(startingJobId)}
                        className={cn(
                          "w-full h-9 text-xs font-bold text-white shadow-none rounded-lg flex items-center justify-center gap-2",
                          operationalSuspension.active || startingJobId
                            ? "bg-gray-400 cursor-not-allowed"
                            : "bg-blue-600 hover:bg-blue-700",
                        )}
                      >
                        {startingJobId === job.id ? (
                          <>
                            <Loader2 size={14} className="animate-spin" />
                            Iniciando operação…
                          </>
                        ) : (
                          <>
                            <Play size={14} className="fill-current" />
                            Iniciar Operação
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          ) : (
            <div className="md:col-span-2 bg-white dark:bg-[#1A1F26] border border-gray-100 dark:border-[#2A2F3A] rounded-xl p-8 flex flex-col items-center justify-center text-center shadow-sm">
              <FileText
                size={20}
                className="text-gray-300 dark:text-gray-600 mb-2"
              />
              <p className="text-xs text-gray-500 dark:text-[#a1a1aa] font-medium max-w-sm">
                Não há contratos atribuídos para você neste momento. Solicite um
                novo trabalho ou aguarde a administração enviar.
              </p>
            </div>
          )}
        </div>
      </div>
    );

    return (
      <div className="w-full max-w-7xl mx-auto space-y-3 sm:space-y-4 pb-4 pt-0">
        <OperationResultModal
          isOpen={showOperationResultModal}
          onClose={() => setShowOperationResultModal(false)}
          onRequestNewJob={handleResultRequestNewJob}
          resultData={operationResultData}
        />
        {renderTopControls(true)}
        <OperationalSuspensionNotice user={currentUser as any} />

        {/* Central Operacional Header */}
        <header className="flex flex-col sm:flex-row md:items-center justify-between gap-4 bg-white dark:bg-[#1A1F26] p-4 sm:px-5 sm:py-4 rounded-[18px] border border-gray-100 dark:border-[#2A2F3A] shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-full flex items-center justify-center shrink-0">
              <UserCog size={20} />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-gray-900 dark:text-[#fafafa] tracking-tight leading-none mb-1">
                Central Operacional
              </h1>
              <p className="text-xs font-medium text-gray-500 dark:text-[#a1a1aa] leading-none">
                Nenhum contrato ativo
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="flex-1 sm:w-auto flex items-center justify-between gap-3 bg-gray-50 dark:bg-[#11141A] px-4 py-2 rounded-xl border border-gray-100 dark:border-[#2A2F3A]">
              <div>
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="relative flex h-2 w-2">
                    {currentUser?.isOnline && (
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#0cb49f] opacity-75"></span>
                    )}
                    <span
                      className={cn(
                        "relative inline-flex rounded-full h-2 w-2",
                        currentUser?.isOnline
                          ? "bg-[#0cb49f]"
                          : "bg-gray-300 dark:bg-[#52525b]",
                      )}
                    ></span>
                  </span>
                  <h3 className="font-bold text-xs text-gray-900 dark:text-[#fafafa] leading-none">
                    Status
                  </h3>
                </div>
                <p className="text-[10px] sm:text-[11px] text-gray-500 dark:text-[#a1a1aa] leading-none">
                  {operationalSuspension.active
                    ? "Suspenso"
                    : currentUser?.isOnline
                      ? "Disponível"
                      : "Indisponível"}
                </p>
              </div>
              <label
                className={cn(
                  "relative inline-flex items-center shrink-0",
                  operationalSuspension.active ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                )}
              >
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={currentUser?.isOnline || false}
                  disabled={operationalSuspension.active}
                  onChange={(e) => updateUserOnlineStatus(e.target.checked)}
                />
                <div className="w-10 h-5 bg-gray-200 dark:bg-[#18181b] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-5 peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white dark:after:bg-gray-300 after:border-gray-200 dark:after:border-transparent after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0cb49f] dark:peer-checked:bg-[#0cb49f] shadow-inner dark:shadow-none"></div>
              </label>
            </div>
          </div>
        </header>

        {pendingDriverJobs.length === 0 ? (
          <div className="flex flex-col gap-4">
            {solicitarTrabalhoCard}
            {filaOperacionalSection}
            {tempoOciosoCard}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {filaOperacionalSection}
            {solicitarTrabalhoCard}
            {tempoOciosoCard}
          </div>
        )}

        {/* Central de Avisos e Histórico - Agora em linha única no desktop se possível */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex items-center gap-3 bg-[#1f242d] dark:bg-[#1A1F26] border border-transparent dark:border-[#2A2F3A] rounded-xl p-3 shadow-sm">
            <div className="w-7 h-7 rounded-full bg-white/10 dark:bg-blue-500/20 flex items-center justify-center shrink-0">
              <Circle
                size={12}
                className="fill-current text-white dark:text-blue-400"
              />
            </div>
            <p className="text-[11px] font-medium text-gray-300 dark:text-gray-400 leading-snug">
              Mantenha-se{" "}
              <strong className="text-white dark:text-[#fafafa]">
                Disponível
              </strong>{" "}
              para receber prioridade na atribuição.
            </p>
          </div>

          {lastJob && (
            <div className="flex items-center gap-3 bg-white dark:bg-[#1A1F26] border border-gray-200/60 dark:border-[#2A2F3A] rounded-xl p-3 shadow-sm">
              <div className="w-7 h-7 rounded-full bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center shrink-0">
                <CheckCircle
                  size={12}
                  className="text-emerald-600 dark:text-emerald-400"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-0.5">
                  Última Operação
                </p>
                <p className="font-bold text-[11px] text-gray-900 dark:text-[#fafafa] truncate leading-none">
                  {getNomeContratoHistorico(lastJob, contracts.find((c) => c.id === lastJob.contractId))}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const isAwaitingCompletion = myJob.status === "awaiting_completion";
  const isActive = isRunningJobStatus(myJob.status);
  const persistedProgress = Math.max(0, Number(myJob.progress) || 0);
  const realProgress = tripHistoryLoading
    ? persistedProgress
    : Math.max(persistedProgress, currentOperationTrips.length);
  const progressPercent =
    Math.round(
      (realProgress / Math.max(1, contract.totalDeliveries || 1)) * 100,
    ) || 0;

  const targetDateString = myJob.dueAt || myJob.deadlineDate;
  const deadlineDate = new Date(targetDateString);
  const diffMs = deadlineDate.getTime() - now.getTime();
  const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24)); // Replaced differenceInDays

  let timeRemainingText = "Atrasado";
  const hasValidDeadline = Boolean(targetDateString);

  if (!hasValidDeadline) {
    timeRemainingText = "Prazo não definido";
  } else if (diffMs > 0) {
    const d = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const h = Math.floor((diffMs / (1000 * 60 * 60)) % 24);
    const m = Math.floor((diffMs / 1000 / 60) % 60);
    timeRemainingText = `${d} dias • ${h}h • ${m}min`;
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
      // Calculate data for modal
      const executionDiffMs = now.getTime() - assignedAtDate.getTime();
      const execD = Math.floor(executionDiffMs / (1000 * 60 * 60 * 24));
      const execH = Math.floor((executionDiffMs / (1000 * 60 * 60)) % 24);
      const execM = Math.floor((executionDiffMs / 1000 / 60) % 60);

      const isAtrasado = diffMs < 0;
      let tempoRestanteOuAtraso = "0h 0min";

      if (hasValidDeadline) {
        const absDiffMs = Math.abs(diffMs);
        const trD = Math.floor(absDiffMs / (1000 * 60 * 60 * 24));
        const trH = Math.floor((absDiffMs / (1000 * 60 * 60)) % 24);
        const trM = Math.floor((absDiffMs / 1000 / 60) % 60);
        tempoRestanteOuAtraso =
          trD > 0 ? `${trD}d ${trH}h ${trM}min` : `${trH}h ${trM}min`;
      } else {
        tempoRestanteOuAtraso = "-";
      }

      const jobTrips = normalizedCompanyTrips.filter((trip: any) => {
        if (trip.jobId && trip.jobId === myJob.id) return true;
        if (trip.contratoId !== myJob.contractId) return false;
        if (trip.motoristaId !== currentUser?.id) return false;

        const tripTime = trip.metricDate.getTime();
        const assignedTime = myJob.assignedAt
          ? new Date(myJob.assignedAt).getTime()
          : 0;
        const completedTime = myJob.completedAt
          ? new Date(myJob.completedAt).getTime()
          : Date.now() + 86_400_000;

        return tripTime >= assignedTime && tripTime <= completedTime;
      });
      const totalGanhos = jobTrips.reduce(
        (total, trip: any) => total + trip.normalizedValor,
        0,
      );

      const resultData = {
        contractName: contract.name,
        tempoExecucao:
          execD > 0
            ? `${execD}d ${execH}h ${execM}min`
            : `${execH}h ${execM}min`,
        tempoRestante: tempoRestanteOuAtraso,
        isAtrasado,
        prazoTotal: `${totalDays} dias`,
        totalViagens: realProgress,
        vehicleName: vehicle?.name,
        showTrailer: !trailerlessSimulator,
        trailerName: trailerlessSimulator ? undefined : trailer?.name,
        totalGanhos,
      };

      await finishJob(myJob.id);

      setOperationResultData(resultData);
      setShowOperationResultModal(true);
    } catch (error) {
      console.error(error);
    } finally {
      setIsFinishing(false);
    }
  };

  return (
    <div className="space-y-3 sm:space-y-4 w-full max-w-7xl mx-auto pb-4 pt-0">
      <GtoWorkModeDialog
        open={isGtoModeDialogOpen}
        variant={isGtoWork ? "gto" : "simple"}
        simulatorLabel={simpleAutomationSimulator?.shortLabel}
        busy={isSimpleAutomationStarting}
        onClose={() => setIsGtoModeDialogOpen(false)}
        onSelect={handleGtoModeSelect}
      />
      <OperationResultModal
        isOpen={showOperationResultModal}
        onClose={() => setShowOperationResultModal(false)}
        onRequestNewJob={handleResultRequestNewJob}
        resultData={operationResultData}
      />
      <div className="flex flex-col w-full gap-3 sm:gap-0">
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
                jobProgress: myJob.progress || 0,
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
        <header className="order-3 sm:order-1 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 w-full mb-0 sm:mb-3">
          <Card className="w-full shrink-0 border border-gray-100 dark:border-[#2A2F3A] shadow-sm rounded-2xl bg-white dark:bg-[#1A1F26] flex-1">
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div className="pr-3 flex-1">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="relative flex h-2 w-2">
                      {currentUser?.isOnline && (
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#0cb49f] opacity-75"></span>
                      )}
                      <span
                        className={cn(
                          "relative inline-flex rounded-full h-2 w-2",
                          currentUser?.isOnline
                            ? "bg-[#0cb49f]"
                            : "bg-gray-300 dark:bg-[#52525b]",
                        )}
                      ></span>
                    </span>
                    <h3 className="font-bold text-[13px] text-gray-900 dark:text-white leading-none">
                      Status
                    </h3>
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-[#a1a1aa] leading-tight mt-0.5">
                    {operationalSuspension.active
                      ? "Suspenso temporariamente"
                      : currentUser?.isOnline
                        ? "Disponível para fretes"
                        : "Indisponível no momento"}
                  </p>
                </div>
                <label
                  className={cn(
                    "relative inline-flex items-center shrink-0 ml-2",
                    operationalSuspension.active ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                  )}
                >
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={currentUser?.isOnline || false}
                    disabled={operationalSuspension.active}
                    onChange={(e) => updateUserOnlineStatus(e.target.checked)}
                  />
                  <div className="w-10 h-5 bg-gray-200 dark:bg-[#18181b] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-5 peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white dark:after:bg-gray-300 after:border-gray-200 dark:after:border-transparent after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0cb49f] dark:peer-checked:bg-[#0cb49f] shadow-inner dark:shadow-none"></div>
                </label>
              </div>
            </CardContent>
          </Card>
        </header>

        {/* Main Job Card */}
        <div className="order-3 flex flex-col bg-white dark:bg-[#1A1F26] rounded-2xl sm:rounded-[24px] shadow-sm dark:shadow-none border border-gray-200 dark:border-[#2A2F3A] overflow-hidden mb-3 sm:mb-4">
          {/* Header */}
          <div className="relative overflow-hidden bg-[#1f242d] dark:bg-[#151921] p-3 sm:p-4 w-full">
            {/* Subtle glow effect */}
            <div className="absolute top-[-50%] right-[-10%] w-[150px] h-[150px] bg-white/5 rounded-full blur-[40px] pointer-events-none"></div>

            {progressPercent === 100 ? (
              <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
                <div className="flex flex-col items-start min-w-0">
                  <h3 className="text-[15px] sm:text-[18px] font-bold text-green-400 tracking-tight leading-none mb-1">
                    Operação concluída!
                  </h3>
                  <p className="text-[10px] sm:text-[11px] font-medium text-gray-400 leading-tight">
                    Todas as entregas foram registradas. Finalize a operação para continuar.
                  </p>
                </div>
                <button
                  onClick={handleFinishJob}
                  disabled={isFinishing}
                  className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-full text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0 w-full sm:w-auto text-center"
                >
                  {isFinishing ? "Processando..." : "Finalizar Operação"}
                </button>
              </div>
            ) : (
              <div className="flex justify-between items-start z-10 relative gap-3">
                <div className="flex flex-col pr-2 min-w-0">
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
                  <span className="px-1.5 py-0.5 text-[8px] sm:text-[9px] font-semibold border border-[#0cb49f]/20 bg-[#0cb49f]/10 text-[#0cb49f] rounded-full flex items-center gap-1 whitespace-nowrap tracking-wide">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#0cb49f]"></span>
                    TRABALHO ATIVO
                  </span>
                </div>
              </div>
              )}
          </div>

          {/* Content Area */}
          <div className="p-3 pb-2 sm:p-4 sm:pb-3 flex flex-col gap-2.5">
            {/* Buttons Row (Vehicles and Trailer) */}
            <div className="flex flex-col gap-1.5">
              <button
                onClick={() => handleCopyPaintCode(vehicle?.paintCode)}
                className="flex items-center justify-between border border-gray-100 dark:border-[#2A2F3A] bg-white dark:bg-[#1f242d] hover:bg-gray-50 dark:hover:bg-[#2e3440] transition-colors rounded-[10px] py-1.5 px-3 text-left group shadow-sm dark:shadow-none"
              >
                <div className="flex flex-col w-full justify-center">
                  <span className="text-[8px] font-bold text-gray-400 uppercase tracking-wider leading-none mb-0.5">
                    Veículo
                  </span>
                  <span className="text-[11px] sm:text-[12px] font-bold text-slate-800 dark:text-[#fafafa] leading-tight break-words">
                    {vehicle?.name || "Nenhum"}
                  </span>
                </div>
                <ChevronRight
                  size={14}
                  className="text-gray-300 dark:text-gray-600 group-hover:text-gray-500 shrink-0 ml-2"
                />
              </button>

              {!trailerlessSimulator && (
                <button
                  onClick={() => handleCopyPaintCode(trailer?.paintCode)}
                  className="flex items-center justify-between border border-gray-100 dark:border-[#2A2F3A] bg-white dark:bg-[#1f242d] hover:bg-gray-50 dark:hover:bg-[#2e3440] transition-colors rounded-[10px] py-1.5 px-3 text-left group shadow-sm dark:shadow-none"
                >
                  <div className="flex flex-col w-full justify-center">
                    <span className="text-[8px] font-bold text-gray-400 uppercase tracking-wider leading-none mb-0.5">
                      Reboque
                    </span>
                    <span className="text-[11px] sm:text-[12px] font-bold text-slate-800 dark:text-[#fafafa] leading-tight break-words">
                      {trailer?.name || "Nenhum"}
                    </span>
                  </div>
                  <ChevronRight
                    size={14}
                    className="text-gray-300 dark:text-gray-600 group-hover:text-gray-500 shrink-0 ml-2"
                  />
                </button>
              )}
            </div>

            {/* Metrics */}
            <div className="border border-gray-100 dark:border-[#2A2F3A] bg-gray-50/50 dark:bg-[#1f242d] rounded-[8px] flex items-center shadow-sm dark:shadow-none mt-0.5">
              <div className="flex-1 py-1.5 flex flex-col items-center justify-center text-center">
                <span className="text-[14px] sm:text-[16px] font-bold text-slate-800 dark:text-gray-100 leading-none tracking-tight mb-0.5">
                  {realProgress}/{contract.totalDeliveries}
                </span>
                <span className="text-[7px] sm:text-[8px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-semibold">
                  Entregas
                </span>
              </div>

              <div className="w-px h-6 bg-gray-200/60 dark:bg-[#2A2F3A] shrink-0"></div>

              <div className="flex-1 py-1.5 flex flex-col items-center justify-center text-center">
                <span className="text-[14px] sm:text-[16px] font-bold text-slate-800 dark:text-gray-100 leading-none tracking-tight mb-0.5">
                  {Math.max(0, contract.totalDeliveries - realProgress)}
                </span>
                <span className="text-[7px] sm:text-[8px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-semibold">
                  Faltam
                </span>
              </div>

              <div className="w-px h-6 bg-gray-200/60 dark:bg-[#2A2F3A] shrink-0"></div>

              <div className="flex-1 py-1.5 flex flex-col items-center justify-center text-center">
                <span className="text-[14px] sm:text-[16px] font-bold text-slate-800 dark:text-gray-100 leading-none tracking-tight mb-0.5">
                  {progressPercent.toFixed(0)}%
                </span>
                <span className="text-[7px] sm:text-[8px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-semibold">
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
                  {hasValidDeadline
                    ? format(deadlineDate, "dd/MM/yyyy")
                    : "Não definido"}
                </span>
              </div>
            </div>

            <div className="w-px h-5 bg-gray-100 dark:bg-[#2A2F3A] shrink-0 mx-1"></div>

            <div className="flex flex-1 items-center justify-end gap-2 min-w-0 pl-1 text-right">
              <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-md bg-gray-50 dark:bg-[#2A2F3A] flex flex-shrink-0 items-center justify-center order-1 border border-gray-100 dark:border-transparent">
                <Clock size={12} className="text-gray-600 dark:text-gray-400" />
              </div>
              <div className="flex flex-col min-w-0 items-end overflow-hidden">
                <span className="text-[7px] sm:text-[8px] font-bold text-gray-400 uppercase tracking-widest mb-0.5">
                  Tempo restante
                </span>
                <span className="text-[10px] sm:text-[11px] font-bold text-slate-800 dark:text-gray-200 whitespace-nowrap overflow-visible leading-none">
                  {timeRemainingText}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Contract Routes (Detailed Mode) */}
      {contract.mode === "detailed" &&
        contract.deliveries &&
        contract.deliveries.length > 0 && (
          <Card className="border border-gray-100 dark:border-[#2A2F3A] shadow-sm bg-white dark:bg-[#1A1F26]">
            <CardContent className="p-3 sm:p-4">
              <h3 className="text-[13px] sm:text-[14px] font-bold text-gray-900 dark:text-[#fafafa] mb-3 uppercase tracking-wide flex items-center gap-2">
                <MapPin size={16} className="text-blue-500" />
                Rotas do Contrato
              </h3>
              <div className="flex flex-col gap-2 relative">
                {/* Connecting line for desktop/tablet */}
                <div className="hidden sm:block absolute top-4 bottom-4 left-[23px] w-px bg-gray-200 dark:bg-[#2A2F3A] z-0"></div>

                {contract.deliveries.map((del, idx) => {
                  const isCompleted = idx < realProgress;
                  return (
                    <div
                      key={del.id || idx}
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-xl border transition-colors text-[13px] sm:text-[14px] relative z-10",
                        isCompleted
                          ? "bg-green-50/80 dark:bg-green-500/10 border-green-100 dark:border-green-500/20"
                          : "bg-gray-50/80 dark:bg-[#18181b] border-gray-100 dark:border-[#2A2F3A]",
                      )}
                    >
                      <div className="shrink-0 flex items-center justify-center w-6 h-6 bg-white dark:bg-[#1A1F26] rounded-full sm:shadow-sm">
                        {isCompleted ? (
                          <CheckCircle
                            size={18}
                            className="text-green-600 dark:text-green-400"
                          />
                        ) : (
                          <div className="w-[14px] h-[14px] rounded-full border-2 border-gray-300 dark:border-gray-600"></div>
                        )}
                      </div>
                      <div className="flex-1 flex flex-row items-center min-w-0 gap-2 sm:gap-3">
                        <span
                          className={cn(
                            "font-semibold truncate",
                            isCompleted
                              ? "text-green-800 dark:text-green-400"
                              : "text-gray-900 dark:text-[#fafafa]",
                          )}
                        >
                          {del.origin}
                        </span>
                        <span className="text-gray-300 dark:text-[#3f3f46] shrink-0">
                          →
                        </span>
                        <span
                          className={cn(
                            "font-semibold truncate",
                            isCompleted
                              ? "text-green-800 dark:text-green-400"
                              : "text-gray-900 dark:text-[#fafafa]",
                          )}
                        >
                          {del.destination}
                        </span>
                      </div>
                      <div className="shrink-0">
                        <span className="text-[10px] font-bold text-gray-400 dark:text-[#52525b] uppercase tracking-wider">
                          #{idx + 1}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

      {/* Operation Trips Section */}
      <div className="w-full flex flex-col pt-1">
        <div className="w-full px-1 pb-3 border-b border-gray-200/80 dark:border-[#2A2F3A]">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 flex items-center justify-center shrink-0">
                <History size={18} className="text-blue-600 dark:text-blue-400" />
              </div>
              <div className="min-w-0">
                <h3 className="text-[15px] sm:text-base font-semibold text-gray-900 dark:text-[#fafafa] leading-tight whitespace-nowrap">
                  Viagens da operação
                </h3>
                <p className="mt-0.5 text-[12px] text-gray-500 dark:text-[#a1a1aa] truncate">
                  Histórico das execuções
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOperationTripsExpanded((prev) => !prev)}
              title={operationTripsExpanded ? "Recolher detalhes das viagens" : "Expandir detalhes das viagens"}
              className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 dark:text-[#a1a1aa] transition-colors"
            >
              {operationTripsExpanded ? (
                <ChevronsDownUp size={16} className="stroke-[2.2]" />
              ) : (
                <ChevronsUpDown size={16} className="stroke-[2.2]" />
              )}
            </button>
          </div>
        </div>
        <div className="w-full mt-3">
          <TripHistory
            embeddedJob={myJob}
            hideHeader={true}
            hideHeaderActions={true}
            externalExpandAllState={operationTripsExpanded}
            historicoTripsOverride={historicoTrips}
            historyLoadingOverride={tripHistoryLoading}
          />
        </div>
      </div>

      {isContractModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 min-h-[100dvh]">
          <div className="bg-white dark:bg-[#1A1F26] rounded-2xl w-full max-w-lg shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 flex items-center justify-between border-b border-gray-100 dark:border-[#2A2F3A]">
              <h3 className="text-xl font-bold text-gray-900 dark:text-[#fafafa]">
                Detalhes do Contrato
              </h3>
              <button
                onClick={() => setIsContractModalOpen(false)}
                className="p-2 text-gray-400 hover:text-gray-600 dark:text-[#d4d4d8] dark:hover:text-[#a1a1aa] hover:bg-gray-100 dark:bg-[#27272a] dark:hover:bg-[#3f3f46]/50 rounded-full transition-colors"
                title="Fechar"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto max-h-[70vh] space-y-6">
              <div>
                <p className="text-sm font-medium text-gray-500 dark:text-[#a1a1aa] mb-1">
                  Nome do Contrato
                </p>
                <p className="text-base font-semibold text-gray-900 dark:text-[#fafafa]">
                  {contract.name}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-500 dark:text-[#a1a1aa] mb-1">
                    ID do Contrato
                  </p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-[#fafafa] truncate">
                    {contract.id}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500 dark:text-[#a1a1aa] mb-1">
                    Prazo Restante
                  </p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-[#fafafa]">
                    {daysLeft} dias
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500 dark:text-[#a1a1aa] mb-1">
                    Total de Entregas
                  </p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-[#fafafa]">
                    {contract.totalDeliveries}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500 dark:text-[#a1a1aa] mb-1">
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
                <p className="text-sm font-medium text-gray-500 dark:text-[#a1a1aa] mb-2">
                  Simulador
                </p>
                <div className="bg-gray-50 dark:bg-[#1A1F26] p-3 rounded-lg border border-gray-100 dark:border-[#2A2F3A]">
                  <p className="font-medium text-gray-900 dark:text-[#fafafa]">
                    {contract.simulator}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-gray-50 dark:bg-[#1A1F26] px-6 py-4 flex justify-end border-t border-gray-100 dark:border-[#2A2F3A]">
              <Button onClick={() => setIsContractModalOpen(false)}>
                Fechar
              </Button>
            </div>
          </div>
        </div>
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
  tripHistoryOverride?: any[];
  tripHistoryLoadingOverride?: boolean;
  progressAnimationKey?: string;
}) {
  return (
    <ErrorBoundary>
      <DashboardComponent {...props} />
    </ErrorBoundary>
  );
}
