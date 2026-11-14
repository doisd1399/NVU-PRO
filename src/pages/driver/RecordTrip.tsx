import { CachedImage } from "../../components/common/CachedImage";
import { assertWorkModeEntryAllowed, assertCachedWorkModeEntryAllowed } from "../../services/workModeAvailabilityService";
import { isWorkModeMaintenanceError } from "../../lib/workModeMaintenanceError";
import { WorkModeMaintenanceDialog } from "../../components/WorkModeMaintenanceDialog";
import React, { useState, useRef, useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import { useOperationalStore, useSessionStore } from "../../context/AppContext";
import { useCompanyStore } from "../../context/CompanyContext";
import { resolveOperationContract, selectCompletedOperationJobs } from "../../lib/operationResultSummary";
import {
  ArrowLeft,
  MapPin,
  UploadCloud,
  Send,
  Clock,
  CheckCircle2,
  User,
  ClipboardList,
  Truck,
  Package,
  X,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { withTimeout } from "../../lib/asyncTimeout";
import { toast } from "sonner";
import { UploadError } from "../../services/uploadService";
import { canonicalTripDuplicateService } from "../../application/trip/CanonicalTripDuplicateService";
import { canonicalTripOperationService } from "../../application/trip/CanonicalTripOperationService";
import { canonicalTripCommandService } from "../../application/trip/CanonicalTripCommandService";
import { completeTripWithCoordinator } from "../../services/operationalCompletionCoordinator";
import { TripRegistrationCoordinator } from "../../application/trip/TripRegistrationCoordinator";
import { OperationalSuspensionNotice } from "../../components/OperationalSuspensionNotice";
import { useOperationalSuspension } from "../../hooks/useOperationalSuspension";
import { isTrailerlessSimulator, resolveSimulatorId } from "../../lib/resolveSimulator";
import { resolveSimulatorDisplayLabel } from "../../lib/simulatorOptions";
import {
  isClosedJobStatus,
  isTripRecordableJobStatus,
} from "../../lib/jobStatus";
import { parseTripValue } from "../../lib/tripNormalizer";
import { analyzeGtoTripReceipt } from "../../services/gtoOcrService";
import type { GtoPrintEvidence } from "../../../functions/src/gtoPrintEvidence";
import { extractScsTripData } from "../../services/scsTripOcrService";
import { extractToe3TripData } from "../../services/toe3TripOcrService";
import { extractWorldTripValue } from "../../services/worldTripOcrService";
import {
  isFileAccessError,
  normalizeFileAccessError,
  snapshotSelectedFile,
} from "../../lib/fileAccess";
import {
  formatTripDistanceInput,
  parseTripDistance,
  requiresTripDistance,
  resolveTripSimulatorCode,
} from "../../lib/tripDistance";
import { TRIP_RECEIPT_RETENTION_DAYS } from "../../lib/tripReceiptRetention";
import { SyncManager } from "../../services/syncManager";
import { isConnectivityError, isDefinitelyOffline } from "../../lib/connectivity";
import { persistOfflineReceipt, removeOfflineReceipt } from "../../lib/offlineReceiptStore";
import { firebaseTripSyncAdapter } from "../../services/sync/FirebaseTripSyncAdapter";
import { launchGtoWork } from "../../services/gtoWorkLauncher";
import { ensureOperationIntegrity } from "../../services/operationIntegrityGuard";
import { useDriverTrips } from "../../hooks/useDriverTrips";
import { PrintFailureDiagnostic, usePrintFailureDiagnostic } from "../../components/PrintFailureDiagnostic";
import { deriveCurrentOperationProgress, selectCanonicalOperationTrips, selectCurrentOperationJob } from "../../lib/currentOperation";

type ReceiptUploadPhase = "idle" | "preparing" | "validating" | "uploading";

const generateImageHash = async (
  arrayBuffer: ArrayBuffer,
  file: File,
): Promise<string> => {
  if (!window.crypto || !window.crypto.subtle) {
    return file.name + file.size + file.lastModified;
  }
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
};

const resolveImageUploadErrorMessage = (
  error: unknown,
  phase: string,
): string => {
  if (isFileAccessError(error)) {
    return normalizeFileAccessError(error).message;
  }

  if (error instanceof UploadError) return error.message;

  if (phase === "hashing") {
    return "Não foi possível validar a imagem selecionada. Selecione-a novamente.";
  }

  if (phase === "duplicate-check") {
    return "Não foi possível verificar o comprovante no servidor. Confira a conexão e tente novamente.";
  }

  return "Não foi possível concluir o envio. Confira a conexão e tente novamente.";
};

function RecordTripOperational({ onMaintenance }: { onMaintenance: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser } = useSessionStore();
  const printDiagnostic = usePrintFailureDiagnostic(currentUser?.id || "");
  const { companies, activeCompanyId, memberships } = useCompanyStore();
  const { suspension: operationalSuspension } = useOperationalSuspension(
    currentUser as any,
  );
  const {
    jobs,
    contracts,
    vehicles,
    trailers,
    simulators,
    simulatorsLoading,
  } = useOperationalStore();
  const driverTripState = useDriverTrips(currentUser?.id);

  const [origem, setOrigem] = useState("");
  const [destino, setDestino] = useState("");
  const [valor, setValor] = useState("");
  const [valorDetectadoAutomaticamente, setValorDetectadoAutomaticamente] = useState(false);
  const [valorDeteccaoMetodo, setValorDeteccaoMetodo] = useState<"manual" | "ocr">("manual");
  const [distanciaPercorrida, setDistanciaPercorrida] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageHash, setImageHash] = useState<string | null>(null);
  const [offlineReceiptKey, setOfflineReceiptKey] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string>("");
  const [uploadLocation, setUploadLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isReadingValue, setIsReadingValue] = useState(false);
  const [gtoReceiptAnalysisStatus, setGtoReceiptAnalysisStatus] = useState<"idle" | "reading" | "ok" | "failed" | "blocked">("idle");
  // Preserve the OCR evidence that produced the GTO Print amount. The server
  // can then reject a client amount that does not match the receipt evidence.
  const [gtoReceiptRawText, setGtoReceiptRawText] = useState("");
  const [gtoReceiptEvidence, setGtoReceiptEvidence] = useState<GtoPrintEvidence | null>(null);
  const [gtoAdDoubleDetected, setGtoAdDoubleDetected] = useState(false);
  const [gtoAdEvidence, setGtoAdEvidence] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadPhase, setUploadPhase] = useState<ReceiptUploadPhase>("idle");
  const [isNavigating, setIsNavigating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ocrRequestIdRef = useRef(0);
  const receiptOriginalNameRef = useRef("");
  const submissionInFlightRef = useRef(false);
  const selectionInFlightRef = useRef(false);

  useEffect(() => {
    let id = localStorage.getItem("deviceId");
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
      localStorage.setItem("deviceId", id);
    }
    setDeviceId(id);
  }, []);

  const currentCompany = companies.find((c) => c.id === activeCompanyId);
  const resolvedSimulatorCode = resolveTripSimulatorCode(
    currentCompany as any,
    simulators as any[],
  );
  const gtoMode = new URLSearchParams(location.search).get("mode");
  const isGtoPrintMode = resolvedSimulatorCode === "GTO" && gtoMode === "print";
  const distanceRequired = requiresTripDistance(
    currentCompany as any,
    simulators as any[],
  );
  const simulatorResolutionPending = Boolean(
    currentCompany && simulatorsLoading && !resolvedSimulatorCode,
  );
  const trailerlessSimulator = isTrailerlessSimulator(
    currentCompany,
    simulators as unknown[],
  );

  useEffect(() => {
    if (!distanceRequired && distanciaPercorrida) {
      setDistanciaPercorrida("");
    }
  }, [distanceRequired, distanciaPercorrida]);

  const driverMembership = memberships?.find(
    (m) =>
      m.companyId === activeCompanyId &&
      m.userId === currentUser?.id &&
      m.status === "active",
  );
  const isAdmin =
    currentUser?.role === "admin" ||
    (driverMembership && driverMembership.roles.includes("admin"));

  // Print, Pro and both dashboards must resolve the same assignment before
  // choosing the target contract or binding a receipt to an operation.
  const activeJob = useMemo(() =>
    selectCurrentOperationJob(jobs, currentUser?.id, activeCompanyId) ||
    selectCompletedOperationJobs(jobs, driverTripState.trips, currentUser?.id || "", activeCompanyId)[0] || null,
    [jobs, currentUser?.id, activeCompanyId, driverTripState.trips],
  );
  const activeContract = useMemo(
    () => resolveOperationContract(activeJob, contracts), [activeJob, contracts],
  );
  useEffect(() => {
    printDiagnostic.clear();
  }, [currentUser?.id, activeCompanyId, activeJob?.id, printDiagnostic.clear]);
  const activeJobPendingOffline = activeJob ? SyncManager.getPendingRegistrationCount(activeJob.id) : 0;
  const activeJobProgress = activeJob
    ? deriveCurrentOperationProgress(activeJob as any, driverTripState.trips, currentUser?.id)
    : 0;
  const activeOperationTrips = activeJob ? selectCanonicalOperationTrips(activeJob, driverTripState.trips, String(currentUser?.id || activeJob.driverId || "")) : [];
  // Local pending records reserve the next route index, but never count as
  // operation progress until a server-confirmed trip appears in the canonical history.
  const activeJobNextRouteIndex = activeJobProgress + activeJobPendingOffline;
  const activeJobTotalDeliveries = Math.max(
    0,
    Number(activeContract?.totalDeliveries || 0),
  );
  const activeJobClosed = Boolean(
    activeJob &&
      isClosedJobStatus(
        activeJob.status,
        activeJobProgress,
        activeJobTotalDeliveries,
      ),
  );

  const predefinedRoutes =
    !isGtoPrintMode &&
    activeContract?.mode === "detailed" &&
    activeContract.deliveries &&
    activeContract.deliveries.length > 0
      ? activeContract.deliveries
      : null;
  const currentRouteIndex = activeJob ? activeJobNextRouteIndex : 0;

  const isContractCompletedState = predefinedRoutes && currentRouteIndex >= predefinedRoutes.length;
  const currentPredefinedRoute = (predefinedRoutes && !isContractCompletedState) ? predefinedRoutes[currentRouteIndex] : null;

  useEffect(() => {
    if (activeJobClosed && !isUploading) {
      // `awaiting_completion` is only closed when the server progress is
      // consistent with the contract total. A stale status with remaining
      // deliveries must continue through the GTO launch path.
      navigate("/driver/profile", { replace: true });
    }
  }, [activeJobClosed, isUploading, navigate]);

  useEffect(() => {
    if (currentPredefinedRoute) {
      if (origem !== currentPredefinedRoute.origin) setOrigem(currentPredefinedRoute.origin);
      if (destino !== currentPredefinedRoute.destination) setDestino(currentPredefinedRoute.destination);
    }
  }, [currentPredefinedRoute, origem, destino]);

  if (!currentUser) return null;

  if (operationalSuspension.active) {
    return (
      <div className="w-full max-w-2xl mx-auto space-y-4 py-4 px-1">
        <OperationalSuspensionNotice user={currentUser as any} sticky={false} />
        <button
          type="button"
          onClick={() => navigate("/driver/profile")}
          className="w-full h-11 rounded-xl bg-gray-900 text-white font-semibold hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white transition-colors"
        >
          Voltar ao painel operacional
        </button>
      </div>
    );
  }

  if (!currentCompany) {
    return (
      <div className="w-full text-center py-10">
        <p className="text-gray-500 dark:text-nvu-muted">
          Selecione uma empresa e simulador para acessar o lançamento de
          viagens.
        </p>
        <button
          onClick={() => navigate("/")}
          className="mt-4 text-blue-600 dark:text-blue-400 underline text-sm hover:text-blue-700 dark:hover:text-blue-300"
        >
          Voltar
        </button>
      </div>
    );
  }

  if (simulatorResolutionPending) {
    return (
      <div className="w-full flex flex-col items-center justify-center py-12 gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-b-blue-600" />
        <p className="text-sm text-gray-500 dark:text-nvu-muted">
          Identificando o simulador da empresa...
        </p>
      </div>
    );
  }

  if (!resolvedSimulatorCode) {
    return (
      <div className="w-full text-center py-10 px-4">
        <p className="text-gray-600 dark:text-nvu-text-soft">
          Não foi possível identificar o simulador desta empresa. Atualize o
          cadastro da empresa antes de lançar uma viagem.
        </p>
        <button
          onClick={() => navigate(-1)}
          className="mt-4 text-blue-600 dark:text-blue-400 underline text-sm"
        >
          Voltar
        </button>
      </div>
    );
  }

  // Check if user is linked to this context
  if (!driverMembership && !isAdmin) {
    return (
      <div className="w-full text-center py-10">
        <p className="text-gray-500 dark:text-nvu-muted">
          Você não possui vínculo ativo com esta empresa/simulador.
        </p>
        <button
          onClick={() => navigate("/")}
          className="mt-4 text-blue-600 dark:text-blue-400 underline text-sm hover:text-blue-700 dark:hover:text-blue-300"
        >
          Voltar
        </button>
      </div>
    );
  }


  // Protect route
  if ((!activeJob || !activeContract) || (activeJobClosed && !isUploading && !isNavigating)) {
    // Only admins or something? Wait, admins can't launch trips for themselves unless they have an active contract here.
    return (
      <div className="w-full text-center py-10 px-4">
        <div className="max-w-md mx-auto bg-white dark:bg-nvu-surface p-6 rounded-2xl border border-gray-100 dark:border-nvu-line shadow-sm">
          <div className="w-16 h-16 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center mx-auto mb-4">
            <X size={32} />
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
            Acesso Bloqueado
          </h2>
          <p className="text-gray-600 dark:text-nvu-muted mb-6 text-left space-y-2">
            <strong>Inicie uma operação para lançar viagens.</strong>
            <br/><br/>
            1. Receba um contrato.<br/>
            2. Inicie o contrato.<br/>
            3. Após iniciar a operação você poderá registrar suas viagens.
          </p>
          <button
            onClick={() => navigate("/driver/profile")}
            className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors"
          >
            Voltar ao Dashboard
          </button>
        </div>
      </div>
    );
  }

  const activeVehicle =
    activeJob && activeJob.vehicleId
      ? vehicles.find(
          (v) =>
            v.id === activeJob.vehicleId && v.companyId === activeCompanyId,
        )
        || ((activeJob as any).vehicleName
          ? ({
              id: activeJob.vehicleId,
              name: (activeJob as any).vehicleName,
              plate: (activeJob as any).vehiclePlate || "",
              companyId: activeCompanyId || activeJob.companyId,
            } as any)
          : null)
      : null;
  const activeTrailerId = trailerlessSimulator
    ? ""
    : activeJob?.trailerId || activeContract?.trailerId;
  const activeTrailer = activeTrailerId
    ? trailers.find(
        (t) => t.id === activeTrailerId && t.companyId === activeCompanyId,
      )
      || ((activeJob as any)?.trailerName
        ? ({
            id: activeTrailerId,
            name: (activeJob as any).trailerName,
            companyId: activeCompanyId || activeJob?.companyId,
          } as any)
        : null)
    : null;

  const activeGtoDelivery = (() => {
    const deliveries = activeContract?.deliveries || [];
    if (!deliveries.length) return undefined;
    // Route selection is derived from confirmed canonical history, never from
    // the denormalized job counter. Pending/offline captures are not confirmed
    // deliveries and therefore cannot advance the server-defined route.
    return deliveries[Math.min(activeJobProgress, deliveries.length - 1)];
  })();

  if (resolvedSimulatorCode === "GTO" && !isGtoPrintMode) {
    const startGto = async () => {
      try {
        const result = await launchGtoWork({
          driverId: currentUser.id,
          driverName: currentUser.name,
          companyId: currentCompany.id,
          companyName: currentCompany.companyName || currentCompany.name || "Empresa",
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
          toast.error("Iniciar trabalho GTO está disponível no aplicativo Android NVU.");
        } else if (result.status === "module-missing") {
          toast.error("Este APK não possui o módulo GTO atualizado.");
        } else if (result.status === "gto-missing") {
          toast.error("Global Truck Online não foi encontrado neste aparelho.");
        } else if (result.status === "screen-capture-denied") {
          toast.error("Autorize a leitura da tela. O GTO será aberto somente após a confirmação do Android.");
        } else if (result.status === "job-not-ready") {
          toast.error("Inicie a operação antes de abrir o trabalho GTO.");
        } else if (result.status === "job-closed") {
          toast.error("Operação concluída. Inicie uma nova operação para continuar.");
        } else if (result.status === "observer-failed") {
          toast.error(result.message || "O Observador GTO não conseguiu iniciar corretamente.");
        }
      } catch (error) {
        console.error("Falha ao iniciar trabalho GTO:", error);
        toast.error("Não foi possível abrir o trabalho GTO.");
      }
    };

    return (
      <div className="w-full max-w-lg mx-auto py-8 px-3">
        <div className="bg-white dark:bg-nvu-surface border border-slate-200 dark:border-nvu-line rounded-2xl p-5 text-center">
          <Truck size={28} className="mx-auto text-cyan-600 dark:text-cyan-300 mb-3" />
          <h1 className="text-base font-bold text-slate-900 dark:text-white">
            Trabalho GTO
          </h1>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-nvu-muted">
            Escolha o frete no GTO e faça a rota normalmente. Ao chegar ao destino, a NVU identificará a conclusão e registrará a viagem automaticamente.
          </p>
          <div className="mt-4 space-y-2">
            <button
              type="button"
              onClick={() => navigate("/driver/trip?mode=print", { replace: true })}
              className="w-full h-11 rounded-xl border border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 font-semibold"
            >
              Modo print
            </button>
            <button
              type="button"
              onClick={() => void startGto()}
              className="w-full h-11 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-semibold"
            >
              Modo automático
            </button>
          </div>
          <button
            type="button"
            onClick={() => navigate("/driver/profile", { replace: true })}
            className="mt-2 w-full h-10 rounded-xl border border-slate-200 dark:border-nvu-line text-slate-700 dark:text-nvu-text text-sm font-semibold"
          >
            Voltar ao painel operacional
          </button>
        </div>
      </div>
    );
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const selectedFile = input.files?.[0];
    // Release the native picker reference immediately. Android document
    // providers can invalidate it after the change event finishes.
    input.value = "";

    if (selectedFile) {
      if (selectionInFlightRef.current || isReadingValue || isUploading) return;
      printDiagnostic.clear();
      selectionInFlightRef.current = true;
      const now = Date.now();
      const previous = { imagePreview, imageHash, offlineReceiptKey, valor, valorDetectadoAutomaticamente,
        valorDeteccaoMetodo, gtoReceiptAnalysisStatus, gtoReceiptRawText, gtoReceiptEvidence,
        gtoAdDoubleDetected, gtoAdEvidence, name: receiptOriginalNameRef.current };
      const restorePrevious = () => {
        if (!previous.imagePreview || !previous.offlineReceiptKey) return false;
        setImagePreview(previous.imagePreview); setImageHash(previous.imageHash); setOfflineReceiptKey(previous.offlineReceiptKey);
        setValor(previous.valor); setValorDetectadoAutomaticamente(previous.valorDetectadoAutomaticamente);
        setValorDeteccaoMetodo(previous.valorDeteccaoMetodo); setGtoReceiptAnalysisStatus(previous.gtoReceiptAnalysisStatus);
        setGtoReceiptRawText(previous.gtoReceiptRawText); setGtoReceiptEvidence(previous.gtoReceiptEvidence);
        setGtoAdDoubleDetected(previous.gtoAdDoubleDetected); setGtoAdEvidence(previous.gtoAdEvidence);
        receiptOriginalNameRef.current = previous.name;
        return true;
      };

      setIsUploading(true);
      setUploadPhase("preparing");
      setUploadProgress(0);
      setImageHash(null);
      // Persist the owned original and begin its upload before OCR. Serialize OCR instead of
      // imposing the old three-per-minute quota on legitimate local captures.
      // Previous evidence stays intact until explicit safe cleanup.
      setOfflineReceiptKey(null);
      let localPreviewUrl: string | null = null;
      let stableFile: File | null = null;
      let stableHash = "";
      let phase = "capturing-file";

      try {
        // Make one immediate browser-owned snapshot before OCR, hashing and
        // compression start. This prevents concurrent reads of a temporary
        // Android content URI, which caused NotReadableError in the field.
        const { file, bytes } = await snapshotSelectedFile(selectedFile, {
          maxBytes: 10 * 1024 * 1024,
          fallbackName: `comprovante-${now}.jpg`,
        });
        stableFile = file;

        const requestId = ++ocrRequestIdRef.current;
        localPreviewUrl = URL.createObjectURL(file);
        receiptOriginalNameRef.current = file.name.trim();
        setGtoReceiptAnalysisStatus("idle");
        setGtoReceiptRawText("");
        setGtoReceiptEvidence(null);
        setGtoAdDoubleDetected(false);
        setGtoAdEvidence([]);
        setValorDetectadoAutomaticamente(false);
        setValorDeteccaoMetodo("manual");
        setValor("");
        setImagePreview(localPreviewUrl);

        const simulatorId = resolveSimulatorId(currentCompany, simulators) || "";
        const simulatorName =
          resolveSimulatorDisplayLabel(currentCompany as any, simulators as any[], companies as any[]) ||
          simulators.find((simulator) => simulator.id === simulatorId)?.name ||
          resolvedSimulatorCode;
        const isGto = resolvedSimulatorCode === "GTO";
        const isScsOcrSimulator =
          resolvedSimulatorCode === "ATS" || resolvedSimulatorCode === "ETS2";
        const isToe3OcrSimulator = resolvedSimulatorCode === "TOE3";
        const isWorldOcrSimulator = resolvedSimulatorCode === "WTDS" || resolvedSimulatorCode === "WBDS";
        console.log("[NVU OCR] context", {
          simulatorId,
          simulatorName,
          resolvedSimulatorCode,
          isGto,
          isScsOcrSimulator,
          isToe3OcrSimulator,
          isWorldOcrSimulator,
        });

        setUploadPhase("validating");
        phase = "hashing";
        const hash = await withTimeout(
          generateImageHash(bytes, file),
          10_000,
          "A validação local da imagem demorou demais.",
        );
        stableHash = hash;

        phase = "duplicate-check";
        const isDuplicate = await withTimeout(
          canonicalTripDuplicateService.findTripByImageHash(hash, currentCompany?.id || activeCompanyId || ""),
          12_000,
          "A verificação de duplicidade demorou demais.",
        );

        if (isDuplicate) {
          toast.error(isDuplicate.jobId === activeJob?.id && isDuplicate.driverId === currentUser.id
            ? "Este comprovante já foi registrado nesta operação. Confira o histórico antes de reenviar."
            : "Esta imagem já foi utilizada em um lançamento anterior.");
          ocrRequestIdRef.current += 1;
          setIsReadingValue(false);
          if (restorePrevious()) {
            if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
            return;
          }
          setImagePreview(null);
          setImageHash(null);
          setOfflineReceiptKey(null);
          setGtoReceiptAnalysisStatus("idle");
          setGtoAdDoubleDetected(false);
          setGtoAdEvidence([]);
          receiptOriginalNameRef.current = "";
          if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
          return;
        }

        // Persist the exact image before networking, also when online. The
        // trip outbox owns the upload and keeps the same identity on retries.
        phase = "offline-receipt-store";
        const receiptKey = await persistOfflineReceipt(file, {
          imageHash: hash, companyId: currentCompany?.id || "Geral", userId: currentUser.id,
        });
        setImageHash(hash);
        setOfflineReceiptKey(receiptKey);
        if (!isDefinitelyOffline()) {
          // Start transfer before OCR; even a driver who filled the route first
          // gets upload/OCR overlap. Submission joins
          // the same flight and still waits for the authoritative server ACK.
          void firebaseTripSyncAdapter.prepareReceipt(receiptKey, currentUser.id, currentCompany?.id || "Geral")
            .catch(() => { /* The durable receipt is retried by submission. */ });
        }
        if (previous.imagePreview?.startsWith("blob:") && previous.imagePreview !== localPreviewUrl) URL.revokeObjectURL(previous.imagePreview);

        // OCR reads the unmodified local original while its transport copy uploads.
        // The full ADS analysis still gates registration.
        phase = "ocr-analysis";
        if (isGto) {
          setIsReadingValue(true);
          setGtoReceiptAnalysisStatus("reading");

          let signalValueReady: () => void = () => {};
          const valueReady = new Promise<void>((resolve) => { signalValueReady = resolve; });
          const analysisTask = analyzeGtoTripReceipt(file, {
            onValueDetected: (detectedValue) => {
              if (ocrRequestIdRef.current !== requestId) return;
              setValor(detectedValue);
              setValorDetectadoAutomaticamente(true);
              setValorDeteccaoMetodo("ocr");
              signalValueReady();
            },
          })
            .then((analysis) => {
              if (ocrRequestIdRef.current !== requestId) return;

              setGtoReceiptRawText(analysis.rawText || "");
              setGtoReceiptEvidence(analysis.printEvidence || null);

              // Promote a valid monetary value before any screen-evidence
              // decision. A readable amount and explicit fraud evidence are
              // independent concerns in GTO print mode.
              if (analysis.value) {
                setValor(analysis.value);
                setValorDetectadoAutomaticamente(true);
                setValorDeteccaoMetodo("ocr");
              } else {
                setValorDetectadoAutomaticamente(false);
                setValorDeteccaoMetodo("manual");
              }

              if (analysis.doubledByAd) {
                        setGtoAdDoubleDetected(true);
                setGtoAdEvidence(analysis.evidence);
                setGtoReceiptAnalysisStatus("blocked");
                toast.error(
                  "Anúncio/valor dobrado detectado no print. Esta viagem não será aceita como resultado normal.",
                );
                return;
              }

                    if (analysis.value) {
                setGtoReceiptAnalysisStatus("ok");
                toast.success(`Valor identificado: R$ ${analysis.value}`);
              } else {
                setGtoReceiptAnalysisStatus("failed");
                toast.warning(
                  "Não foi possível ler o valor recebido. Envie um print mais nítido.",
                );
              }
            })
            .catch((error) => {
              if (ocrRequestIdRef.current !== requestId) return;
              console.error("[NVU GTO OCR] async analysis failure", error);
                    setGtoReceiptAnalysisStatus("failed");
              toast.warning(
                "Não foi possível ler o valor recebido. Envie um print mais nítido para continuar.",
              );
            })
            .finally(() => {
              if (ocrRequestIdRef.current === requestId) {
                setIsReadingValue(false);
              }
            });
          await Promise.race([valueReady, analysisTask]);
        } else if (isScsOcrSimulator) {
          setIsReadingValue(true);
          await extractScsTripData(file, resolvedSimulatorCode)
            .then((detected) => {
              if (ocrRequestIdRef.current !== requestId) return;

              if (!detected) {
                toast.warning(
                  "Não foi possível ler o comprovante automaticamente. Confira os campos e preencha o que faltar.",
                );
                return;
              }

              const detectedFields: string[] = [];

              if (!currentPredefinedRoute && detected.origin) {
                setOrigem((current) => current.trim() || detected.origin || "");
                detectedFields.push("origem");
              }

              if (!currentPredefinedRoute && detected.destination) {
                setDestino((current) => current.trim() || detected.destination || "");
                detectedFields.push("destino");
              }

              if (distanceRequired && detected.distanceKm) {
                const formattedDistance = formatTripDistanceInput(detected.distanceKm);
                setDistanciaPercorrida(
                  (current) => current.trim() || formattedDistance,
                );
                detectedFields.push("distância");
              }

              if (detected.value) {
                setValor(detected.value);
                setValorDetectadoAutomaticamente(true);
                setValorDeteccaoMetodo("ocr");
                detectedFields.push("valor");
              }

              if (detectedFields.length > 0) {
                toast.success(
                  `Leitura automática concluída: ${detectedFields.join(", ")}.`,
                );
              } else {
                toast.warning(
                  "A imagem foi analisada, mas nenhum dado pôde ser confirmado com segurança.",
                );
              }
            })
            .catch((error) => {
              console.warn("[NVU OCR] SCS reading failed", error);
              toast.warning("Não foi possível ler o print automaticamente. Confira os campos.");
            })
            .finally(() => {
              if (ocrRequestIdRef.current === requestId) {
                setIsReadingValue(false);
              }
            });
        } else if (isToe3OcrSimulator) {
          setIsReadingValue(true);
          await extractToe3TripData(file)
            .then((detected) => {
              if (ocrRequestIdRef.current !== requestId) return;

              if (!detected) {
                toast.warning(
                  "Não foi possível ler km e ganhos automaticamente. Confira os campos e preencha o que faltar.",
                );
                return;
              }

              const detectedFields: string[] = [];

              if (distanceRequired && detected.distanceKm) {
                const formattedDistance = formatTripDistanceInput(detected.distanceKm);
                setDistanciaPercorrida(
                  (current) => current.trim() || formattedDistance,
                );
                detectedFields.push("distância");
              }

              if (detected.value) {
                setValor(detected.value);
                setValorDetectadoAutomaticamente(true);
                setValorDeteccaoMetodo("ocr");
                detectedFields.push("valor");
              }

              if (detectedFields.length > 0) {
                toast.success(
                  `Leitura automática concluída: ${detectedFields.join(", ")}.`,
                );
              } else {
                toast.warning(
                  "A imagem foi analisada, mas km e ganhos não puderam ser confirmados com segurança.",
                );
              }
            })
            .catch((error) => {
              console.warn("[NVU OCR] TOE3 reading failed", error);
              toast.warning("Não foi possível ler o print automaticamente. Confira os campos.");
            })
            .finally(() => {
              if (ocrRequestIdRef.current === requestId) {
                setIsReadingValue(false);
              }
            });
        } else if (isWorldOcrSimulator) {
          setIsReadingValue(true);
          await extractWorldTripValue(file, resolvedSimulatorCode)
            .then((detectedValue) => {
              if (ocrRequestIdRef.current !== requestId) return;
              if (!detectedValue) {
                toast.warning("Não foi possível confirmar os ganhos no comprovante. Confira o print ou informe o valor manualmente.");
                return;
              }
              setValor(detectedValue);
              setValorDetectadoAutomaticamente(true);
              setValorDeteccaoMetodo("ocr");
              toast.success(`Valor identificado: R$ ${detectedValue}`);
            })
            .catch((error) => {
              console.warn("[NVU OCR] World reading failed", error);
              toast.warning("Não foi possível ler o print automaticamente. Confira os campos.");
            })
            .finally(() => {
              if (ocrRequestIdRef.current === requestId) setIsReadingValue(false);
            });
        } else {
          setIsReadingValue(false);
        }

      } catch (error: unknown) {
        // A connection can disappear after the local snapshot/hash is ready.
        // Preserve that exact binary evidence instead of discarding the user's
        // receipt and forcing a second selection.
        if (stableFile && stableHash && (isConnectivityError(error) ||
          ["storage/unknown", "storage/unauthorized", "storage/unauthenticated", "functions/permission-denied", "functions/unauthenticated"].includes(String((error as { code?: string })?.code || "")))) {
          try {
            const receiptKey = await persistOfflineReceipt(stableFile, {
              imageHash: stableHash,
              companyId: currentCompany?.id || "Geral",
              userId: currentUser.id,
            });
            setImageHash(stableHash);
            setOfflineReceiptKey(receiptKey);
            const uploadCode = String((error as { code?: string })?.code || "");
            console.warn("[NVU] comprovante aguardando envio", {
              code: uploadCode,
              httpStatus: (error as { httpStatus?: number })?.httpStatus,
            });
            toast.info("Comprovante preservado no aparelho", {
              description: "A viagem permanece pendente. Confira a conexão ou regularize seu vínculo para tentar novamente.",
              position: "top-center",
            });
            return;
          } catch (storageError) {
            console.error("Offline receipt persistence failed:", storageError);
          }
        }

        try { printDiagnostic.capture(error, `image-${phase}`); } catch { /* Never hide the original failure. */ }
        const normalizedError = normalizeFileAccessError(error);
        const userMessage = resolveImageUploadErrorMessage(error, phase);
        console.error("Upload error:", {
          phase,
          error: normalizedError,
          code: (error as { code?: unknown })?.code,
          serverResponse: (error as { serverResponse?: unknown })?.serverResponse,
        });
        ocrRequestIdRef.current += 1;
        setIsReadingValue(false);
        if (restorePrevious()) {
          if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
          toast.error(`Não foi possível substituir a imagem. ${userMessage} O comprovante anterior foi preservado.`);
          return;
        }
        setImagePreview(null);
        setImageHash(null);
        setOfflineReceiptKey(null);
        setGtoReceiptAnalysisStatus("idle");
        setGtoReceiptRawText("");
        setGtoAdDoubleDetected(false);
        setGtoAdEvidence([]);
        receiptOriginalNameRef.current = "";
        if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
        toast.error(`Falha no envio da imagem. ${userMessage}`);
      } finally {
        selectionInFlightRef.current = false;
        setIsUploading(false);
        setUploadPhase("idle");
        setUploadProgress(0);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    }
  };

  const registerSelectedTrip = async () => {
    try { assertCachedWorkModeEntryAllowed("print", resolvedSimulatorCode); }
    catch (error) {
      if (isWorkModeMaintenanceError(error)) onMaintenance();
      else toast.error(error instanceof Error ? error.message : "Não foi possível verificar o controle de envio.");
      return;
    }

    if (operationalSuspension.active) {
      toast.error(
        "Suas atividades operacionais estão suspensas. Aguarde a liberação para lançar viagens.",
      );
      return;
    }
    if (isContractCompletedState) {
      toast.error("Este contrato já foi 100% concluído. Volte ao painel e finalize a operação.");
      return;
    }


    if (resolvedSimulatorCode === "GTO" && isGtoPrintMode) {
      if (isReadingValue || gtoReceiptAnalysisStatus === "reading") {
        toast.warning("Aguarde a NVU terminar a análise do print.");
        return;
      }
      if (gtoAdDoubleDetected || gtoReceiptAnalysisStatus === "blocked") {
        toast.error("Viagem bloqueada: o print indica anúncio/valor dobrado.");
        return;
      }
      if (gtoReceiptAnalysisStatus === "failed") {
        toast.error("Não foi possível ler o valor recebido. Envie um print mais nítido.");
        return;
      }
      if (gtoReceiptAnalysisStatus !== "ok" || !valorDetectadoAutomaticamente) {
        toast.error("Aguarde a leitura do valor recebido.");
        return;
      }
    }

    const finalOrigem = currentPredefinedRoute ? currentPredefinedRoute.origin : origem;
    const finalDestino = currentPredefinedRoute ? currentPredefinedRoute.destination : destino;

    const remoteReceiptUrl = String(imagePreview || "").trim();
    const receiptIsConfirmedInStorage =
      !offlineReceiptKey && /^https:\/\//i.test(remoteReceiptUrl);
    const receiptReadyForSubmission = Boolean(offlineReceiptKey) || receiptIsConfirmedInStorage;

    if (!finalOrigem || !finalDestino || !valor || !receiptReadyForSubmission) {
      toast.error("Por favor, preencha todos os campos obrigatórios.");
      return;
    }

    const distanciaNumerica = parseTripDistance(distanciaPercorrida);
    if (distanceRequired && distanciaNumerica <= 0) {
      toast.error("Informe uma distância percorrida válida em quilômetros.");
      return;
    }

    if (!activeJob) {
      toast.error("Nenhuma operação iniciada encontrada. Inicie uma operação antes de lançar viagens.");
      return;
    }

    if (!imageHash) {
      toast.error("Não foi possível validar o comprovante. Selecione o print novamente.");
      return;
    }

    setIsUploading(true);

    printDiagnostic.clear();
    let submissionPhase = "operation-preflight";
    try {
      // 6. Backend validation check: reconcile valid trips before accepting
      // another one, so the last delivery cannot be recorded twice or exceed
      // the contract total after a stale local refresh.
      // Storage may fail while Firestore still works. A local receipt always
      // requires the ordered replay path, never a direct Firestore write.
      let isOffline = isDefinitelyOffline() || Boolean(offlineReceiptKey);
      const localOperationState = () => ({
        progress: activeJobProgress,
        totalDeliveries: Number(activeContract?.totalDeliveries || 0),
        status: String(activeJob.status || "active"),
      });
      // The local, owned operation snapshot controls capture availability.
      // Registration is durable first; the canonical server writer validates
      // the receipt later. A history audit must never gate the Save button.
      if (["pending_finish", "start_rejected"].includes(activeJob.operationSyncState || "")) {
        throw new Error("Esta operação está aguardando confirmação ou finalização. Confira o painel.");
      }
      const authoritativeState = localOperationState();
      if (!isOffline && activeJob.operationSyncState !== "pending_start") {
        void ensureOperationIntegrity(activeJob.id, Number(activeContract?.totalDeliveries || 0), "before-trip")
          .catch(error => console.warn("[NVU] Conferência da operação será retomada em segundo plano", error));
      }
      const freshJobProgress = Math.max(0, Number(authoritativeState.progress || 0));
      const freshJobTotalDeliveries = Math.max(
        0,
        Number(authoritativeState.totalDeliveries || activeContract?.totalDeliveries || 0),
      );
      const locallyReservedTrips = SyncManager.getPendingRegistrationCount(activeJob.id);
      if (
        !isTripRecordableJobStatus(
          authoritativeState.status,
          freshJobProgress,
          freshJobTotalDeliveries,
        )
      ) {
        setIsUploading(false);
        toast.error(
          freshJobTotalDeliveries > 0 && freshJobProgress >= freshJobTotalDeliveries
            ? "A operação já atingiu o total previsto de viagens. Solicite uma nova operação."
            : "Operação não está ativa no servidor. Inicie a operação e tente novamente.",
        );
        return;
      }
      if (
        locallyReservedTrips > 0 &&
        freshJobTotalDeliveries > 0 &&
        freshJobProgress + locallyReservedTrips >= freshJobTotalDeliveries
      ) {
        setIsUploading(false);
        toast.error("Há viagens aguardando validação nesta operação. Aguarde a sincronização antes de registrar outra viagem.");
        return;
      }

      const valorNumerico = parseTripValue(valor);
      if (resolvedSimulatorCode === "GTO" && (!Number.isFinite(valorNumerico) || valorNumerico <= 0)) {
        setIsUploading(false);
        toast.error("Leitura GTO inválida: o ganho precisa ser positivo. Confira o comprovante.");
        return;
      }

      const simulatorId = resolveSimulatorId(currentCompany, simulators);
      const simulatorName =
        resolveSimulatorDisplayLabel(currentCompany as any, simulators as any[], companies as any[]) ||
        simulators.find((simulator) => simulator.id === simulatorId)?.name ||
        resolvedSimulatorCode;
      const tripCompletedAtLocal = new Date().toISOString();

      const data: any = {
        empresaId: currentCompany?.id || "Geral",
        companyId: currentCompany?.id || "Geral",
        empresaNome: currentCompany?.companyName || "Geral",
        simulatorId,
        simulatorCode: resolvedSimulatorCode,
        simulatorName,
        simuladorNome: simulatorName,
        motoristaId: currentUser.id,
        driverId: currentUser.id,
        motoristaNome: currentUser.name,

        contratoId: activeContract?.id || "",
        contratoNumero: activeContract?.name || "",
        contratoDescricao: "",

        veiculoId: activeVehicle?.id || "",
        veiculoNome: activeVehicle ? `${activeVehicle.name || ""}`.trim() : "",
        veiculoPlaca: activeVehicle?.plate || "",

        reboqueId: activeTrailer?.id || "",
        reboqueNome: activeTrailer ? `${activeTrailer.name || ""}`.trim() : "",

        origem: finalOrigem,
        destino: finalDestino,
        valor: valorNumerico,
        valorCents: Math.round(valorNumerico * 100),
        valorDeteccaoMetodo,
        valorDetectadoAutomaticamente,
        valorBloqueadoPorDeteccao: valorDetectadoAutomaticamente,
        ...(distanceRequired
          ? { distanciaPercorrida: distanciaNumerica }
          : {}),
        // A blob URL is only a preview and is not readable by Firebase. Never
        // send it as a receipt URL: the adapter must receive the HTTPS URL
        // returned by Storage after the upload has completed.
        comprovanteUrl: receiptIsConfirmedInStorage ? remoteReceiptUrl : "",
        ...(offlineReceiptKey
          ? {
              offlineReceiptKey,
              receiptSyncStatus: "awaiting_upload",
            }
          : {}),
        comprovanteTituloOriginal: receiptOriginalNameRef.current || "",
        status: "concluida",
        criadoPor: currentUser.id,
        createdAtLocal: tripCompletedAtLocal,
        completedAtLocal: tripCompletedAtLocal,
        dataLancamento: tripCompletedAtLocal,
        completedAt: tripCompletedAtLocal,
        createdAt: tripCompletedAtLocal,
        updatedAt: tripCompletedAtLocal,

        // Audit fields
        imageHash: imageHash,
        idempotencyKey: `print:${activeJob.id}:${currentUser.id}:${imageHash}`,
        deviceId: deviceId,
        uploadedAt: tripCompletedAtLocal,
        uploadedBy: currentUser.id,
        receiptRetentionDays: TRIP_RECEIPT_RETENTION_DAYS,
        receiptRetentionPolicy: "storage-lifecycle-v1",
        contractId: activeContract?.id || "",
        jobId: activeJob?.id || "",
        operationId: activeJob?.id || "",
        ...(resolvedSimulatorCode === "GTO" && isGtoPrintMode
          ? {
              gtoEntryMode: "print",
              gtoReceiptAnalyzed: gtoReceiptAnalysisStatus === "ok",
              gtoReceiptValidationMode: "ocr",
              gtoReceiptManualConfirmation: false,
              // Send the same OCR evidence used by the UI. registerCanonicalSimpleTrip
              // independently compares its parsed amount with valorCents.
              receiptText: gtoReceiptRawText,
              ...(gtoReceiptEvidence ? { gtoReceiptEvidence } : {}),
              gtoReceiptReviewRequired: false,
              gtoRewardedAdDetected: false,
            }
          : {}),
      };

      if (uploadLocation) {
        data.uploadLocation = uploadLocation;
      }

      submissionPhase = "trip-commit";
      const completionResult = await completeTripWithCoordinator({
        userId: currentUser.id,
        companyId: currentCompany?.id || activeCompanyId || "",
        tripData: data,
        job: activeJob,
        contract: activeContract,
        addTrip: async (trip) => {
          const canonicalTrip = TripRegistrationCoordinator.register({
            ...trip,
            source: "PRINT_PRO_REGISTRATION",
          });
          return canonicalTripCommandService.addTripWithinOperationLimit(canonicalTrip, {
            jobId: activeJob.id,
            totalDeliveries: freshJobTotalDeliveries,
            waitForServerAck: false,
          });
        },
        syncJobProgress: activeJob
          ? (jobId) => canonicalTripOperationService.syncJobProgress(jobId)
          : undefined,
        projectedOperationProgress: freshJobProgress + 1,
        projectedOperationTotalDeliveries: freshJobTotalDeliveries,
        deferOperationReconciliation: true,
      });

      printDiagnostic.clear();
      const savedOffline = completionResult.docRef.offline === true || String(completionResult.docRef.id || "").startsWith("local-");
      if (["FAILED", "CONFLICT"].includes(completionResult.docRef.syncState || "")) {
        toast.warning("Viagem salva; a validação exige revisão", {
          description: "O comprovante está preservado. Confira o motivo em Viagens aguardando confirmação no histórico.",
        });
      } else if (completionResult.operationReadyToFinalize) {
        toast.success("Todas as viagens foram registradas. Finalize a operação no painel.");
      } else if (!completionResult.operationClosed) {
        if (!savedOffline) {
          toast.success("Viagem lançada com sucesso!");
        }
      }
      setOrigem("");
      setDestino("");
      setValor("");
      setValorDetectadoAutomaticamente(false);
      setValorDeteccaoMetodo("manual");
      setDistanciaPercorrida("");
      setImagePreview(null);
      setImageHash(null);
      setOfflineReceiptKey(null);
      setGtoReceiptAnalysisStatus("idle");
      setGtoReceiptRawText("");
      setGtoReceiptEvidence(null);
      setGtoAdDoubleDetected(false);
      setGtoAdEvidence([]);
      receiptOriginalNameRef.current = "";
      if (fileInputRef.current) fileInputRef.current.value = "";

      setIsNavigating(true);
      // A confirmed final delivery returns to the operational dashboard with
      // the job still in `awaiting_completion`. Only the explicit Finalizar
      // Operação button may perform the terminal transition and open results.
      if (completionResult.operationReadyToFinalize) {
        navigate("/driver/dashboard", { replace: true });
      } else if (
        activeJob &&
        activeContract &&
        freshJobProgress + 1 < activeContract.totalDeliveries
      ) {
        navigate("/driver/history");
      }
    } catch (err: any) {
      const failureStage = String(err?.tripSyncStage || submissionPhase);
      try { printDiagnostic.capture(err, failureStage); } catch { /* never hide the original failure */ }
      const errorDetails = err?.details && typeof err.details === "object" ? err.details : {};
      const reasonCode = String((errorDetails as any)?.reasonCode || (errorDetails as any)?.reason || "");
      console.error("Erro ao salvar viagem:", {
        phase: failureStage,
        code: err?.code,
        reasonCode,
        message: err?.message,
      });
      const errorCode = String(err?.code || "").toLowerCase();
      const errorMessage = String(err?.message || "");
      const storageFailureReason = String(err?.storageFailureReason || "").toUpperCase();
      const combinedError = `${errorCode} ${reasonCode} ${storageFailureReason} ${errorMessage}`;
      const receiptTransportFailure =
        /storage\/(?:unauthorized|unauthenticated|unknown|retry-limit-exceeded|quota-exceeded|canceled|network-request-failed)/.test(combinedError)
        || /network|offline|timeout|failed to fetch|connection/i.test(combinedError);
      const userMessage = combinedError.includes("CANONICAL_TRIP_TOMBSTONED")
        ? "Este print está vinculado ao identificador de uma viagem excluída anteriormente. Por segurança, não é possível reenviá-lo como uma viagem nova. Confira o histórico da operação e solicite revisão da exclusão, se ela foi indevida. O comprovante permanece nesta tela; não limpe os dados do aplicativo."
        : combinedError.includes("CANONICAL_TRIP_ATTEMPT_CONFLICT")
        ? "Este comprovante já pertence a uma viagem salva. Confira a pendência no histórico; a tentativa original foi preservada sem duplicar o registro."
        : combinedError.includes("CANONICAL_TRIP_AUTH_SCOPE_MISMATCH")
        ? "O perfil aberto não corresponde à sessão autenticada. Entre novamente com a conta deste motorista; o comprovante permanece nesta tela."
        : storageFailureReason === "QUOTA"
          ? "O armazenamento do aparelho está cheio. Libere espaço e tente novamente; o comprovante permanece nesta tela."
        : storageFailureReason === "UNAVAILABLE"
          ? "O armazenamento local do aparelho está indisponível. Preserve o comprovante e reabra o aplicativo antes de tentar novamente."
        : storageFailureReason === "CORRUPT"
          ? "Os dados locais da viagem precisam de recuperação. Preserve o comprovante e exporte o diagnóstico para o suporte."
        : /OFFLINE_STORAGE_WRITE_FAILED|SYNC_QUEUE_STORAGE_WRITE_FAILED|OFFLINE_STORAGE_UNAVAILABLE/.test(combinedError)
          ? "Não foi possível gravar a viagem localmente. O comprovante foi preservado nesta tela; tente novamente sem fechar o aplicativo."
          : /OFFLINE_STORAGE_DATA_CORRUPT|SYNC_QUEUE_STORAGE_READ_FAILED/.test(combinedError)
            ? "Os dados locais precisam de recuperação. Preserve os dados do app e exporte o diagnóstico para o suporte; o comprovante permanece nesta tela."
            : combinedError.includes("OFFLINE_RECEIPT_UPLOAD_REQUIRED") ||
        combinedError.includes("TRIP_RECEIPT_UPLOAD_REQUIRED")
        ? "O comprovante ainda não foi enviado. A viagem permanece pendente para validação."
        : combinedError.includes("OPERATION_DRIVER_BINDING_INVALID")
          ? "O motorista desta sessão não corresponde ao trabalho no servidor. Solicite a correção da operação."
          : combinedError.includes("OPERATION_COMPANY_CONTRACT_BINDING_INVALID")
            ? "Empresa ou contrato divergem do trabalho no servidor. Solicite a correção da operação."
            : combinedError.includes("OPERATION_TOTAL_DELIVERIES_INVALID")
              ? "O total de viagens está ausente ou inválido na operação do servidor. Solicite a atualização do trabalho."
              : combinedError.includes("GTO_RECEIPT_ANALYSIS_REQUIRED")
                ? "A validação OCR do comprovante não terminou. Selecione o print novamente."
        : combinedError.includes("OPERATION_TRIP_LIMIT_REACHED")
        ? "A operação já atingiu o total previsto de viagens. Solicite uma nova operação."
        : combinedError.includes("OPERATION_TRIP_SLOT_ALREADY_CLAIMED")
          ? "Esta viagem já está sendo processada ou já foi registrada. Atualize o histórico antes de tentar novamente."
        : combinedError.includes("OFFLINE_RECEIPT_OWNER_OR_DATA_MISMATCH")
          ? "O comprovante local não corresponde à sessão atual. Entre novamente com a conta deste motorista; o comprovante permanece nesta tela."
          : combinedError.includes("OFFLINE_RECEIPT_UPLOAD_NOT_CONFIRMED") || combinedError.includes("TRIP_RECEIPT_URL_NOT_CONFIRMED")
            ? "O comprovante ainda não foi confirmado no Firebase Storage. Aguarde o envio terminar e tente novamente."
            : receiptTransportFailure && offlineReceiptKey
              ? "O comprovante foi preservado no aparelho, mas a viagem ainda não foi confirmada. Verifique a conexão e tente lançar novamente."
            : combinedError.includes("OPERATION_PROGRESS_RECONCILIATION_REQUIRED")
              ? "A operação está sincronizando as viagens anteriores. Atualize a tela e tente novamente em alguns segundos."
          : combinedError.includes("OPERATION_NOT_RECORDABLE")
            ? "A operação não está ativa para receber novos lançamentos. Atualize a operação e tente novamente."
            : combinedError.includes("permission-denied")
              ? submissionPhase === "operation-preflight"
                ? "O servidor não permitiu consultar a operação. Verifique a sessão e as regras publicadas."
                : "As regras do servidor recusaram a viagem. O comprovante permanece nesta tela; confira o vínculo da operação."
              : combinedError.includes("functions/not-found")
                ? "O serviço de registro precisa ser atualizado no servidor. Sua viagem foi preservada no histórico pendente."
                : /SERVER_CANONICAL_TRIP_ACK|SERVER_TRIP_EDIT_ACK|CALLABLE_ACK_INVALID|CALLABLE_REGISTRATION/.test(combinedError)
                  ? "O servidor não confirmou a viagem. O comprovante permanece nesta tela e a tentativa pode ser revisada no histórico pendente."
                : combinedError.includes("invalid-argument") || combinedError.includes("failed-precondition")
                  ? `O servidor não confirmou o registro: ${errorMessage.slice(0, 240)}. A viagem permanece salva para revisão.`
                  : err?.tripId
                    ? "O envio ainda não foi confirmado. A viagem foi preservada no histórico pendente."
                    : `Não foi possível concluir o registro nesta etapa (${failureStage}). O comprovante foi mantido nesta tela.`;
      toast.error(userMessage);
    } finally {
      setIsUploading(false);
    }
  };

  const handleLancarViagem = async () => {
    if (submissionInFlightRef.current) return;
    submissionInFlightRef.current = true;
    try { await registerSelectedTrip(); }
    finally { submissionInFlightRef.current = false; }
  };

  const formatCurrency = (value: string) => {
    // Keep only digits
    let digits = value.replace(/\D/g, "");
    if (!digits) return "";

    // Convert to number and format as BRL
    const numberValue = parseInt(digits, 10) / 100;
    return numberValue.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const handleValorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isGtoPrintMode || valorDetectadoAutomaticamente) return;
    const rawValue = e.target.value;
    setValor(formatCurrency(rawValue));
    setValorDeteccaoMetodo("manual");
  };

  const currentDeliveries = activeJobProgress;
  const totalDeliveries = activeContract ? activeContract.totalDeliveries : 6; // fallback 6 as per mockup
  const driverName = currentUser.name || "Motorista não identificado";
  const contractName = activeContract?.name || "Nenhum contrato ativo";
  const vehicleName = activeVehicle?.name || "Nenhum";
  const trailerName = trailerlessSimulator
    ? ""
    : activeTrailer?.name || "Nenhum";
  const companyLogo = currentCompany?.logoUrl || "";
  const companyName = currentCompany?.companyName || "Empresa";
  const cnpj = currentCompany?.cnpj || "00.000.000/0000-00";
  const distanceFieldNumber = predefinedRoutes ? 2 : 3;
  const receiptFieldNumber = predefinedRoutes
    ? distanceRequired
      ? 3
      : 2
    : distanceRequired
      ? 4
      : 3;
  const valueFieldNumber = predefinedRoutes
    ? distanceRequired
      ? 4
      : 3
    : distanceRequired
      ? 5
      : 4;

  return (
    <div className="w-full max-w-2xl mx-auto space-y-3 pb-6 px-0 sm:px-4 text-gray-900 dark:text-nvu-text font-sans tracking-[-0.01em]">
      {/* Top Header */}
      <div className="flex items-center gap-2 py-1 px-2">
        <button
          onClick={() => navigate(-1)}
          className="p-1 -ml-1 text-gray-600 hover:text-gray-900 dark:text-nvu-muted dark:hover:text-white transition-colors bg-transparent border-none outline-none appearance-none cursor-pointer flex items-center justify-center shrink-0"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex flex-col min-w-0">
          <h1 className="text-[16px] sm:text-[17px] font-bold text-gray-900 dark:text-white tracking-tight leading-none mb-0.5">
            Lançar Viagem
          </h1>
          <p className="text-[11px] sm:text-[12px] text-gray-500 dark:text-nvu-muted font-medium leading-none">
            Registre os dados da entrega realizada.
          </p>
        </div>
      </div>

      {/* Main Info Card */}
      <div className="bg-white dark:bg-nvu-surface border border-gray-100 dark:border-nvu-line shadow-[0_2px_12px_rgba(0,0,0,0.03)] sm:rounded-2xl rounded-xl overflow-hidden">
        <div className="p-3 sm:p-4">
          {/* Company Header */}
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-[#1BACB3] font-bold text-white tracking-tighter text-lg rounded-xl flex items-center justify-center shrink-0 shadow-sm overflow-hidden">
              {companyLogo ? (
                <CachedImage
                  src={companyLogo}
                  alt={companyName}
                  className="w-full h-full object-cover"
                />
              ) : (
                companyName.substring(0, 2).toUpperCase()
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 leading-tight">
                <h2 className="text-[14px] sm:text-[15px] font-bold text-gray-900 dark:text-white truncate">
                  {companyName}
                </h2>
                <div className="text-blue-600 dark:text-blue-400 shrink-0">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M10.603 2.5029L12.0005 1L13.3981 2.5029L15.4223 2.76632L16.2928 4.63665L18.2568 5.43859L18.4237 7.49479L20.0076 8.86874L19.5539 10.8711L20.5962 12.5693L19.5539 14.2675L20.0076 16.2699L18.4237 17.6439L18.2568 19.7001L16.2928 20.502L15.4223 22.3723L13.3981 22.6357L12.0005 24.1386L10.603 22.6357L8.5788 22.3723L7.70823 20.502L5.74426 19.7001L5.57732 17.6439L3.99346 16.2699L4.44716 14.2675L3.40483 12.5693L4.44716 10.8711L3.99346 8.86874L5.57732 7.49479L5.74426 5.43859L7.70823 4.63665L8.5788 2.76632L10.603 2.5029ZM11.085 14.9453L16.3263 9.70404L14.9121 8.28983L11.085 12.1169L9.00694 10.0388L7.59273 11.453L11.085 14.9453Z" />
                  </svg>
                </div>
              </div>
              <p className="text-[11px] text-gray-500 dark:text-nvu-muted font-medium mt-0.5 truncate">
                CNPJ {cnpj}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-y-2.5 gap-x-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-gray-50 dark:bg-nvu-surface/80 border border-gray-100 dark:border-nvu-line flex items-center justify-center shrink-0 text-gray-400 dark:text-nvu-muted">
                <User size={14} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-gray-400 dark:text-nvu-muted font-medium leading-none mb-0.5">
                  Motorista
                </p>
                <p className="text-[12px] font-semibold text-gray-800 dark:text-nvu-text truncate leading-none">
                  {driverName}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-gray-50 dark:bg-nvu-surface/80 border border-gray-100 dark:border-nvu-line flex items-center justify-center shrink-0 text-gray-400 dark:text-nvu-muted">
                <ClipboardList size={14} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-gray-400 dark:text-nvu-muted font-medium leading-none mb-0.5">
                  Contrato
                </p>
                <p className="text-[12px] font-semibold text-gray-800 dark:text-nvu-text truncate leading-none">
                  {contractName}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-gray-50 dark:bg-nvu-surface/80 border border-gray-100 dark:border-nvu-line flex items-center justify-center shrink-0 text-gray-400 dark:text-nvu-muted">
                <Truck size={14} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-gray-400 dark:text-nvu-muted font-medium leading-none mb-0.5">
                  Veículo
                </p>
                <p className="text-[12px] font-semibold text-gray-800 dark:text-nvu-text truncate leading-none">
                  {vehicleName}
                </p>
              </div>
            </div>
            {!trailerlessSimulator && (
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-gray-50 dark:bg-nvu-surface/80 border border-gray-100 dark:border-nvu-line flex items-center justify-center shrink-0 text-gray-400 dark:text-nvu-muted">
                  <Package size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] text-gray-400 dark:text-nvu-muted font-medium leading-none mb-0.5">
                    Reboque
                  </p>
                  <p className="text-[12px] font-semibold text-gray-800 dark:text-nvu-text truncate leading-none">
                    {trailerName}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Progress Card Section */}
        <div className="px-3 py-2 bg-gray-50/80 dark:bg-nvu-surface/30 border-t border-gray-100 dark:border-nvu-line flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div className="text-blue-500 dark:text-blue-400">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="20" x2="12" y2="10" />
                <line x1="18" y1="20" x2="18" y2="4" />
                <line x1="6" y1="20" x2="6" y2="16" />
              </svg>
            </div>
            <span className="font-semibold text-[12px] text-gray-800 dark:text-nvu-text">
              Viagens
            </span>
          </div>
          <div className="font-bold text-[13px] text-gray-900 dark:text-white">
            <span className="text-blue-600 dark:text-blue-400">
              {currentDeliveries}
            </span>
            <span className="text-gray-400 dark:text-nvu-muted">
              /{totalDeliveries}
            </span>
          </div>
        </div>
      </div>

      {isGtoPrintMode && (
        <div className="rounded-xl border border-blue-200 dark:border-blue-500/25 bg-blue-50/80 dark:bg-blue-500/10 px-3 py-2.5">
          <div className="text-[12px] font-bold text-blue-800 dark:text-blue-300">
            GTO · Modo print
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-blue-700/80 dark:text-blue-300/80">
            Preencha origem e destino. Ao enviar o comprovante, a NVU lê os ganhos e valida se há confirmação de anúncio/valor dobrado.
          </p>
        </div>
      )}

      {/* Form Card */}
      <div className="bg-white dark:bg-nvu-surface border border-gray-200/80 dark:border-nvu-line shadow-[0_4px_24px_rgba(0,0,0,0.02)] sm:rounded-2xl rounded-xl p-3 sm:p-4 relative">
        <div className="space-y-3">
          {predefinedRoutes && !isGtoPrintMode ? (
            <div>
              <label className="text-[12px] font-semibold text-gray-800 dark:text-nvu-text mb-1 block">
                1. Rota*
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400 dark:text-nvu-muted z-10">
                  <MapPin size={14} />
                </div>
                <div className="w-full min-h-9 px-3 py-1.5 pl-8 bg-gray-50 dark:bg-nvu-surface/50 border border-gray-200 dark:border-nvu-line text-[13px] rounded-lg cursor-not-allowed opacity-90 truncate flex items-center">
                  {isContractCompletedState ? (
                    <span className="text-green-600 dark:text-green-400 font-medium">Contrato 100% concluído</span>
                  ) : (
                    currentPredefinedRoute ? (
                      <span className="truncate">
                        <span className="font-semibold text-blue-600 dark:text-blue-400">
                          {`Viagem ${currentRouteIndex + 1}/${predefinedRoutes.length}`}
                        </span>
                        <span className="text-gray-600 dark:text-nvu-text-soft font-medium ml-1.5">
                           • {currentPredefinedRoute.origin} ➔ {currentPredefinedRoute.destination}
                        </span>
                      </span>
                    ) : (
                      "Carregando..."
                    )
                  )}
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* 1. Origem */}
              <div>
                <label className="text-[12px] font-semibold text-gray-800 dark:text-nvu-text mb-1 block">
                  1. Origem*
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400 dark:text-nvu-muted">
                    <MapPin size={14} />
                  </div>
                  <input
                    type="text"
                    value={origem}
                    readOnly={false}
                    aria-label="Origem da rota"
                    onChange={(e) => setOrigem(e.target.value)}
                    className="w-full h-9 bg-white dark:bg-nvu-surface border border-gray-200 dark:border-nvu-line text-gray-800 dark:text-nvu-text text-[13px] rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 block pl-8 pr-3 py-1.5 transition-colors outline-none placeholder:text-gray-400 dark:placeholder:text-nvu-muted"
                    placeholder="Ex.: Curitiba - PR"
                  />
                </div>
              </div>

              {/* 2. Destino */}
              <div>
                <label className="text-[12px] font-semibold text-gray-800 dark:text-nvu-text mb-1 block">
                  2. Destino*
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400 dark:text-nvu-muted">
                    <MapPin size={14} />
                  </div>
                  <input
                    type="text"
                    value={destino}
                    readOnly={false}
                    aria-label="Destino da rota"
                    onChange={(e) => setDestino(e.target.value)}
                    className="w-full h-9 bg-white dark:bg-nvu-surface border border-gray-200 dark:border-nvu-line text-gray-800 dark:text-nvu-text text-[13px] rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 block pl-8 pr-3 py-1.5 transition-colors outline-none placeholder:text-gray-400 dark:placeholder:text-nvu-muted"
                    placeholder="Ex.: São Paulo - SP"
                  />
                </div>
              </div>
            </>
          )}

          {distanceRequired && (
            <div>
              <label className="text-[12px] font-semibold text-gray-800 dark:text-nvu-text mb-1 block">
                {distanceFieldNumber}. Distância percorrida (km)*
              </label>
              <div className="relative flex items-center border border-gray-200 dark:border-nvu-line rounded-lg overflow-hidden bg-white dark:bg-nvu-surface focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-500 transition-shadow h-9">
                <input
                  type="text"
                  inputMode="decimal"
                  value={distanciaPercorrida}
                  onChange={(event) => setDistanciaPercorrida(event.target.value)}
                  className="w-full bg-transparent text-gray-900 dark:text-white text-right font-semibold text-[13px] block px-3 py-1.5 outline-none placeholder:text-gray-400 dark:placeholder:text-nvu-muted"
                  placeholder="0"
                  aria-label="Distância percorrida em quilômetros"
                />
                <div className="px-3 py-1.5 border-l border-gray-100 dark:border-nvu-line bg-gray-50/50 dark:bg-nvu-surface/50 text-gray-600 dark:text-nvu-muted font-medium text-[13px] shrink-0">
                  km
                </div>
              </div>
            </div>
          )}

          {/* Comprovante */}
          <div>
            <label className="text-[12px] font-semibold text-gray-800 dark:text-nvu-text mb-1 block">
              {receiptFieldNumber}. Comprovante da Viagem*
            </label>
            <div className="flex items-center flex-wrap gap-2 mb-2">
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.webp"
                className="hidden"
                ref={fileInputRef}
                onChange={handleImageUpload}
              />
              <button
                disabled={isUploading}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "flex items-center gap-1.5 bg-blue-50 hover:bg-blue-100 dark:bg-blue-500/10 dark:hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-500/30 text-[12px] font-semibold h-8 px-3 rounded-lg transition-colors",
                  isUploading
                    ? "opacity-50 cursor-not-allowed"
                    : "active:scale-[0.98]",
                )}
              >
                <UploadCloud
                  size={14}
                  className={isUploading ? "animate-pulse" : ""}
                />
                {uploadPhase !== "idle"
                  ? (uploadPhase === "uploading"
                      ? "Enviando..."
                      : uploadPhase === "validating"
                        ? "Validando..."
                        : "Preparando...")
                  : "Enviar imagem"}
              </button>
            </div>

            {isGtoPrintMode && gtoReceiptAnalysisStatus !== "idle" && (
              <div
                className={cn(
                  "mb-2 rounded-lg border px-3 py-2 text-[11px] font-medium",
                  gtoReceiptAnalysisStatus === "blocked"
                    ? "border-red-200 bg-red-50 text-red-700 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-300"
                    : gtoReceiptAnalysisStatus === "failed"
                      ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300"
                      : gtoReceiptAnalysisStatus === "ok"
                        ? "border-green-200 bg-green-50 text-green-700 dark:border-green-500/25 dark:bg-green-500/10 dark:text-green-300"
                        : "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-300",
                )}
              >
                {gtoReceiptAnalysisStatus === "reading" && "Analisando valor e confirmação de anúncio/dobro…"}
                {gtoReceiptAnalysisStatus === "ok" && "Leitura local concluída · validação do servidor após o envio."}
                {gtoReceiptAnalysisStatus === "failed" && (
                  <div>
                    Não foi possível ler o valor recebido. Envie um print mais nítido para continuar.
                  </div>
                )}
                {gtoReceiptAnalysisStatus === "blocked" && (
                  <>
                    Anúncio/valor dobrado confirmado no print. O lançamento normal está bloqueado.
                    {gtoAdEvidence.length > 0 && (
                      <span className="block mt-0.5 opacity-80">
                        Evidência: {gtoAdEvidence.join(", ")}
                      </span>
                    )}
                  </>
                )}
              </div>
            )}

            {imagePreview && (
              <div className="mt-2 space-y-1.5 transition-all">
                <div className="flex justify-end">
                  <button
                    disabled={isUploading}
                    onClick={() => {
                      ocrRequestIdRef.current += 1;
                      setIsReadingValue(false);
                      if (imagePreview?.startsWith("blob:")) {
                        URL.revokeObjectURL(imagePreview);
                      }
                      setImagePreview(null);
                      setImageHash(null);
                      setGtoReceiptAnalysisStatus("idle");
                      setGtoAdDoubleDetected(false);
                      setGtoAdEvidence([]);
                                    if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className={cn(
                      "flex items-center gap-1 text-[10px] font-medium py-1 px-2 rounded-full transition-colors",
                      isUploading
                       ? "bg-gray-100 text-gray-400 dark:bg-nvu-surface dark:text-gray-600 cursor-not-allowed opacity-50"
                       : "text-gray-500 hover:text-gray-800 dark:text-nvu-muted dark:hover:text-nvu-text bg-gray-100 hover:bg-gray-200 dark:bg-nvu-surface dark:hover:bg-nvu-strip"
                    )}
                  >
                    <X size={10} className="stroke-[2.5]" />
                    <span>Remover</span>
                  </button>
                </div>
                <div className="w-full rounded-xl overflow-hidden border border-gray-200 dark:border-nvu-line shadow-sm relative z-0">
                  <PhotoProvider>
                    <PhotoView src={imagePreview}>
                      <CachedImage
                        src={imagePreview}
                        alt="Prévia do comprovante"
                        className={cn("w-full h-auto max-h-[160px] object-cover sm:object-contain rounded-lg cursor-pointer transition-opacity", uploadPhase !== "idle" ? "opacity-70" : "opacity-100")}
                      />
                    </PhotoView>
                  </PhotoProvider>

                  {uploadPhase !== "idle" && (
                    <div className="absolute inset-x-0 bottom-0 bg-white/95 dark:bg-nvu-surface/95 backdrop-blur-md p-3 border-t border-gray-200/50 dark:border-nvu-line/50 flex flex-col gap-1.5">
                       <div className="flex justify-between text-[10px] items-center text-blue-600 dark:text-blue-400 font-bold tracking-widest uppercase">
                         <span className="flex items-center gap-1.5">
                           <UploadCloud size={12} className="animate-pulse" />
                           {uploadPhase === "uploading"
                             ? "Enviando comprovante..."
                             : uploadPhase === "validating"
                               ? "Validando comprovante..."
                               : "Preparando comprovante..."}
                         </span>
                         {uploadPhase === "uploading" && <span>{uploadProgress.toFixed(0)}%</span>}
                       </div>
                       <div className="w-full h-1 bg-gray-200 dark:bg-nvu-strip rounded-full overflow-hidden">
                          <div
                            className={cn(
                              "h-full bg-blue-600 dark:bg-blue-500 rounded-full transition-all duration-300",
                              uploadPhase !== "uploading" && "animate-pulse",
                            )}
                            style={{
                              width:
                                uploadPhase === "uploading"
                                  ? `${Math.max(2, uploadProgress)}%`
                                  : "35%",
                            }}
                          />
                       </div>
                    </div>
                  )}

                  {uploadPhase === "idle" && imageHash && (
                    <div className="absolute bottom-2 right-2 bg-green-500/90 text-white text-[10px] px-2.5 py-1.5 rounded-lg font-semibold shadow-sm backdrop-blur-sm flex items-center gap-1.5">
                      <CheckCircle2 size={12} className="stroke-[2.5]" />
                      {offlineReceiptKey ? "Comprovante salvo; aguardando envio" : "Comprovante enviado com sucesso"}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Valor */}
          <div className="pt-0.5">
            <div className="mb-1 flex items-center justify-between gap-2">
              <label className="text-[12px] font-semibold text-gray-800 dark:text-nvu-text block">
                {valueFieldNumber}. Valor ganho (R$)*
              </label>
                  {isReadingValue && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-600 dark:text-blue-400">
                  <span className="h-2.5 w-2.5 animate-spin rounded-full border border-blue-200 border-b-blue-600 dark:border-blue-500/30 dark:border-b-blue-400" />
                  Leitura automática
                </span>
              )}
              {valorDetectadoAutomaticamente && !isReadingValue && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                  Valor confirmado pelo print · somente leitura
                </span>
              )}
            </div>
            <div className="relative flex items-center border border-gray-200 dark:border-nvu-line rounded-lg overflow-hidden bg-white dark:bg-nvu-surface focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-500 transition-shadow h-9">
              <div className="px-3 py-1.5 border-r border-gray-100 dark:border-nvu-line bg-gray-50/50 dark:bg-nvu-surface/50 text-gray-600 dark:text-nvu-muted font-medium text-[13px] shrink-0">
                R$
              </div>
              {isGtoPrintMode ? (
                <output className="w-full text-right pr-3 text-[13px] font-semibold text-gray-900 dark:text-white">
                  {valor || "0,00"}
                </output>
              ) : (
                <input
                  type="text"
                  value={valor}
                  onChange={handleValorChange}
                  readOnly={valorDetectadoAutomaticamente}
                  aria-readonly={valorDetectadoAutomaticamente}
                  title={valorDetectadoAutomaticamente ? "Valor detectado automaticamente pelo print; não pode ser alterado." : undefined}
                  className={cn(
                    "w-full bg-transparent text-gray-900 dark:text-white text-right font-semibold text-[13px] block pr-3 py-1.5 outline-none placeholder:text-gray-400 dark:placeholder:text-nvu-muted",
                    valorDetectadoAutomaticamente
                      ? "cursor-not-allowed text-emerald-700 dark:text-emerald-300"
                      : "focus:ring-0",
                  )}
                  placeholder="0,00"
                />
              )}
            </div>
          </div>

          {/* Buttons */}
          <div className="pt-2 space-y-2">
            <PrintFailureDiagnostic text={printDiagnostic.text} />
            <button
              onClick={handleLancarViagem}
              disabled={isContractCompletedState || isUploading}
              className={cn(
                "w-full h-10 flex items-center justify-center gap-1.5 rounded-lg font-bold text-[13px] transition-all active:scale-[0.99]",
                isContractCompletedState
                  ? "bg-gray-400 dark:bg-nvu-strip text-white cursor-not-allowed"
                  : "bg-[#1f242d] hover:bg-[#2a303c] active:bg-[#151921] text-white dark:bg-slate-200 dark:hover:bg-slate-300 dark:text-slate-800 shadow-sm dark:shadow-none"
              )}
            >
              <Send size={14} className="-mt-0.5" />
              {isContractCompletedState ? "CONTRATO CONCLUÍDO" : (isUploading ? "ENVIANDO..." : "LANÇAR VIAGEM")}
            </button>
            <button
              onClick={() => navigate("/driver/history")}
              className="w-full h-10 flex items-center justify-center gap-1.5 bg-white dark:bg-nvu-surface hover:bg-slate-50 dark:hover:bg-nvu-surface text-slate-800 dark:text-nvu-text border border-slate-300 dark:border-nvu-line rounded-lg font-bold text-[13px] transition-all active:scale-[0.99]"
            >
              <Clock size={14} />
              HISTÓRICO DE VIAGENS
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


export default function RecordTrip() {
  const location = useLocation();
  const navigate = useNavigate();
  const { companies, activeCompanyId } = useCompanyStore();
  const { simulators, simulatorsLoading } = useOperationalStore();
  const company = companies.find((item) => item.id === activeCompanyId);
  const simulator = resolveTripSimulatorCode(company as any, simulators as any[]);
  const isPrintEntry = new URLSearchParams(location.search).get("mode") === "print";
  const [entry, setEntry] = useState<"checking" | "allowed" | "blocked">("checking");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [approvedKey, setApprovedKey] = useState("");
  const [maintenance, setMaintenance] = useState(false);
  const currentKey = `${company?.id || ""}:${simulator}:${location.search}`;

  useEffect(() => {
    if (!isPrintEntry) return;
    if (!company || (simulatorsLoading && !simulator)) {
      setEntry("checking");
      return;
    }
    let active = true;
    setEntry("checking");
    setMaintenance(false);
    assertWorkModeEntryAllowed("print", simulator)
      .then(() => {
        if (active) { setApprovedKey(currentKey); setEntry("allowed"); }
      })
      .catch((reason: unknown) => {
        if (!active) return;
        if (isWorkModeMaintenanceError(reason)) {
          setMaintenance(true);
          setEntry("blocked");
          return;
        }
        setError(reason instanceof Error ? reason.message : "Não foi possível validar a entrada no Print.");
        setEntry("blocked");
      });
    return () => { active = false; };
  }, [isPrintEntry, company?.id, simulator, simulatorsLoading, attempt, currentKey]);

  if (isPrintEntry && entry === "blocked" && !maintenance) {
    return (
      <div className="p-6 text-center" role="status">
        <p>{error}</p>
        {entry === "blocked" && (
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>
            Tentar novamente
          </button>
        )}
      </div>
    );
  }
  return (
    <>
      <div inert={maintenance || (isPrintEntry && (entry !== "allowed" || approvedKey !== currentKey))}>
        <RecordTripOperational onMaintenance={() => setMaintenance(true)} />
      </div>
      {(maintenance || (isPrintEntry && (entry !== "allowed" || approvedKey !== currentKey))) && (
        maintenance
          ? <WorkModeMaintenanceDialog mode="print" simulator={simulator} onClose={() => setMaintenance(false)} />
          : <div role="status" aria-live="polite" className="fixed inset-0 z-[190] flex items-start justify-center bg-white/20 pt-36 dark:bg-nvu-page/30">
              <p className="rounded-2xl bg-white p-5 font-semibold text-slate-800 shadow-lg dark:bg-nvu-surface dark:text-white">Verificando disponibilidade do Print...</p>
            </div>
      )}
    </>
  );
}
