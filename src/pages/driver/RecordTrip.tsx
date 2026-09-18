import React, { useState, useRef, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import { useOperationalStore, useSessionStore } from "../../context/AppContext";
import { useCompanyStore } from "../../context/CompanyContext";
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
import {
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { toast } from "sonner";
import { uploadService, UploadError } from "../../services/uploadService";
import { TripsRepository } from "../../repositories/TripsRepository";
import { completeTripWithCoordinator } from "../../services/operationalCompletionCoordinator";
import { publishOperationCompletionResult } from "../../lib/operationCompletionResult";
import type { OperationResultData } from "../../components/OperationResultModal";
import { OperationalSuspensionNotice } from "../../components/OperationalSuspensionNotice";
import { useOperationalSuspension } from "../../hooks/useOperationalSuspension";
import { isTrailerlessSimulator, resolveSimulatorId } from "../../lib/resolveSimulator";
import { resolveSimulatorDisplayLabel } from "../../lib/simulatorOptions";
import {
  isClosedJobStatus,
  isRunningJobStatus,
  isTripRecordableJobStatus,
} from "../../lib/jobStatus";
import { parseTripValue } from "../../lib/tripNormalizer";
import { analyzeGtoTripReceipt } from "../../services/gtoOcrService";
import { extractScsTripData } from "../../services/scsTripOcrService";
import { extractToe3TripData } from "../../services/toe3TripOcrService";
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
import { launchGtoWork } from "../../services/gtoWorkLauncher";

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

export default function RecordTrip() {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser } = useSessionStore();
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
    finishJob,
  } = useOperationalStore();

  const [origem, setOrigem] = useState("");
  const [destino, setDestino] = useState("");
  const [valor, setValor] = useState("");
  const [valorDetectadoAutomaticamente, setValorDetectadoAutomaticamente] = useState(false);
  const [valorDeteccaoMetodo, setValorDeteccaoMetodo] = useState<"manual" | "ocr">("manual");
  const [distanciaPercorrida, setDistanciaPercorrida] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageHash, setImageHash] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string>("");
  const [uploadLocation, setUploadLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [uploadCountMinute, setUploadCountMinute] = useState<number[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isReadingValue, setIsReadingValue] = useState(false);
  const [gtoReceiptAnalysisStatus, setGtoReceiptAnalysisStatus] = useState<"idle" | "reading" | "ok" | "failed" | "blocked">("idle");
  const [gtoAdDoubleDetected, setGtoAdDoubleDetected] = useState(false);
  const [gtoAdEvidence, setGtoAdEvidence] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadPhase, setUploadPhase] = useState<ReceiptUploadPhase>("idle");
  const [isNavigating, setIsNavigating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ocrRequestIdRef = useRef(0);
  const receiptOriginalNameRef = useRef("");

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

  // Find active job in the current company context
  const validActiveJobs = jobs.filter(
    (j) =>
      j.driverId === currentUser?.id &&
      j.companyId === activeCompanyId &&
      (isRunningJobStatus(j.status) || j.status === "completed") &&
      contracts.some(
        (c) => c.companyId === activeCompanyId && c.id === j.contractId,
      ),
  );

  validActiveJobs.sort((a, b) => {
    if (a.status === "active" && b.status !== "active") return -1;
    if (b.status === "active" && a.status !== "active") return 1;

    const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return dateB - dateA;
  });

  const activeJob = validActiveJobs[0];
  const activeContract = activeJob
    ? contracts.find(
        (c) => c.id === activeJob.contractId && c.companyId === activeCompanyId,
      )
    : null;
  const activeJobProgress = Math.max(0, Number(activeJob?.progress || 0));
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
  const currentRouteIndex = activeJob ? (activeJob.progress || 0) : 0;

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
        <p className="text-gray-500 dark:text-gray-400">
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
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Identificando o simulador da empresa...
        </p>
      </div>
    );
  }

  if (!resolvedSimulatorCode) {
    return (
      <div className="w-full text-center py-10 px-4">
        <p className="text-gray-600 dark:text-gray-300">
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
        <p className="text-gray-500 dark:text-gray-400">
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
        <div className="max-w-md mx-auto bg-white dark:bg-[#1A1F26] p-6 rounded-2xl border border-gray-100 dark:border-[#2A2F3A] shadow-sm">
          <div className="w-16 h-16 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center mx-auto mb-4">
            <X size={32} />
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
            Acesso Bloqueado
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6 text-left space-y-2">
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
      : null;
  const activeTrailerId = trailerlessSimulator
    ? ""
    : activeJob?.trailerId || activeContract?.trailerId;
  const activeTrailer = activeTrailerId
    ? trailers.find(
        (t) => t.id === activeTrailerId && t.companyId === activeCompanyId,
      )
    : null;

  const activeGtoDelivery = (() => {
    const deliveries = activeContract?.deliveries || [];
    if (!deliveries.length) return undefined;
    const progress = Math.max(0, Number(activeJob?.progress) || 0);
    return deliveries[Math.min(progress, deliveries.length - 1)];
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
        <div className="bg-white dark:bg-[#121213] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 text-center">
          <Truck size={28} className="mx-auto text-cyan-600 dark:text-cyan-300 mb-3" />
          <h1 className="text-base font-bold text-slate-900 dark:text-white">
            Trabalho GTO
          </h1>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
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
            className="mt-2 w-full h-10 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-sm font-semibold"
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
      const now = Date.now();
      const recentUploads = uploadCountMinute.filter(time => now - time < 60000);

      if (recentUploads.length >= 3) {
        toast.error("Limite de uploads atingido. Aguarde um minuto.");
        return;
      }
      if (recentUploads.length > 0 && now - recentUploads[recentUploads.length - 1] < 5000) {
        toast.error("Aguarde 5 segundos entre envios.");
        return;
      }

      setIsUploading(true);
      setUploadPhase("preparing");
      setUploadProgress(0);
      setImageHash(null);
      let localPreviewUrl: string | null = null;
      let phase = "capturing-file";

      try {
        // Make one immediate browser-owned snapshot before OCR, hashing and
        // compression start. This prevents concurrent reads of a temporary
        // Android content URI, which caused NotReadableError in the field.
        const { file, bytes } = await snapshotSelectedFile(selectedFile, {
          maxBytes: 10 * 1024 * 1024,
          fallbackName: `comprovante-${now}.jpg`,
        });

        const requestId = ++ocrRequestIdRef.current;
        if (imagePreview?.startsWith("blob:")) {
          URL.revokeObjectURL(imagePreview);
        }
        localPreviewUrl = URL.createObjectURL(file);
        receiptOriginalNameRef.current = file.name.trim();
        setGtoReceiptAnalysisStatus("idle");
        setGtoAdDoubleDetected(false);
        setGtoAdEvidence([]);
        setValorDetectadoAutomaticamente(false);
        setValorDeteccaoMetodo("manual");
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
        console.log("[NVU OCR] context", {
          simulatorId,
          simulatorName,
          resolvedSimulatorCode,
          isGto,
          isScsOcrSimulator,
          isToe3OcrSimulator,
        });

        // OCR always reads the stable browser-owned snapshot, but it must never
        // hold the receipt upload hostage. On low-end Android devices the OCR
        // worker and Firebase upload now progress independently. The launch
        // gate below still requires a successful GTO analysis before saving a
        // normal trip, so anti-ADS validation remains conservative.
        if (isGto) {
          setIsReadingValue(true);
          setGtoReceiptAnalysisStatus("reading");

          void analyzeGtoTripReceipt(file, {
            onValueDetected: (detectedValue) => {
              if (ocrRequestIdRef.current !== requestId) return;
              setValor(detectedValue);
              setValorDetectadoAutomaticamente(true);
              setValorDeteccaoMetodo("ocr");
            },
          })
            .then((analysis) => {
              if (ocrRequestIdRef.current !== requestId) return;

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
        } else if (isScsOcrSimulator) {
          setIsReadingValue(true);
          void extractScsTripData(file, resolvedSimulatorCode)
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
                setValor((current) => current.trim() || detected.value || "");
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
            .finally(() => {
              if (ocrRequestIdRef.current === requestId) {
                setIsReadingValue(false);
              }
            });
        } else if (isToe3OcrSimulator) {
          setIsReadingValue(true);
          void extractToe3TripData(file)
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
                setValor((current) => current.trim() || detected.value || "");
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
            .finally(() => {
              if (ocrRequestIdRef.current === requestId) {
                setIsReadingValue(false);
              }
            });
        } else {
          setIsReadingValue(false);
        }

        setUploadPhase("validating");
        phase = "hashing";
        const hash = await withTimeout(
          generateImageHash(bytes, file),
          10_000,
          "A validação local da imagem demorou demais.",
        );

        phase = "duplicate-check";
        const isDuplicate = await withTimeout(
          TripsRepository.checkImageHash(hash),
          12_000,
          "A verificação de duplicidade demorou demais.",
        );

        if (isDuplicate) {
          toast.error("Esta imagem já foi utilizada em um lançamento anterior.");
          ocrRequestIdRef.current += 1;
          setIsReadingValue(false);
          setImagePreview(null);
          setImageHash(null);
          setGtoReceiptAnalysisStatus("idle");
          setGtoAdDoubleDetected(false);
          setGtoAdEvidence([]);
            receiptOriginalNameRef.current = "";
          if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
          return;
        }

        phase = "firebase-upload";
        setUploadPhase("uploading");
        const url = await uploadService.uploadImage({
          file,
          companyId: currentCompany?.id || "Geral",
          userId: currentUser.id,
          folder: "receipts",
          compressionMaxSizeMB: 1,
          maxWidthOrHeight: 1920,
          // Keep the client output below the authenticated 2 MB Storage rule.
          maxOutputBytes: 1_800_000,
          storageScope: "trip-receipt",
          onProgress: (progress) => {
            setUploadProgress(progress);
          },
        });

        setUploadCountMinute([...recentUploads, now]);
        setImageHash(hash);
        setImagePreview(url);
        if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
        toast.success("Comprovante pronto para envio!", { position: "top-center" });
      } catch (error: unknown) {
        const normalizedError = normalizeFileAccessError(error);
        const userMessage = resolveImageUploadErrorMessage(error, phase);
        console.error("Upload error:", {
          phase,
          error: normalizedError,
        });
        ocrRequestIdRef.current += 1;
        setIsReadingValue(false);
        setImagePreview(null);
        setImageHash(null);
        setGtoReceiptAnalysisStatus("idle");
        setGtoAdDoubleDetected(false);
        setGtoAdEvidence([]);
        receiptOriginalNameRef.current = "";
        if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
        toast.error(`Falha no envio da imagem. ${userMessage}`);
      } finally {
        setIsUploading(false);
        setUploadPhase("idle");
        setUploadProgress(0);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    }
  };

  const handleLancarViagem = async () => {
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
      if (imagePreview && gtoReceiptAnalysisStatus !== "ok") {
        toast.error("Aguarde a leitura do valor recebido.");
        return;
      }
    }

    const finalOrigem = currentPredefinedRoute ? currentPredefinedRoute.origin : origem;
    const finalDestino = currentPredefinedRoute ? currentPredefinedRoute.destination : destino;

    if (!finalOrigem || !finalDestino || !valor || !imagePreview) {
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

    setIsUploading(true);

    try {
      // 6. Backend validation check: reconcile valid trips before accepting
      // another one, so the last delivery cannot be recorded twice or exceed
      // the contract total after a stale local refresh.
      const authoritativeState = await TripsRepository.readAuthoritativeOperationState(
        activeJob.id,
        Number(activeContract?.totalDeliveries || 0),
      );
      const freshJobProgress = Math.max(0, Number(authoritativeState.progress || 0));
      const freshJobTotalDeliveries = Math.max(
        0,
        Number(authoritativeState.totalDeliveries || activeContract?.totalDeliveries || 0),
      );
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

      const valorNumerico = parseTripValue(valor);

      const simulatorId = resolveSimulatorId(currentCompany, simulators);
      const simulatorName =
        resolveSimulatorDisplayLabel(currentCompany as any, simulators as any[], companies as any[]) ||
        simulators.find((simulator) => simulator.id === simulatorId)?.name ||
        resolvedSimulatorCode;

      const data: any = {
        empresaId: currentCompany?.id || "Geral",
        companyId: currentCompany?.id || "Geral",
        empresaNome: currentCompany?.companyName || "Geral",
        simulatorId,
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
        valorDeteccaoMetodo,
        valorDetectadoAutomaticamente,
        valorBloqueadoPorDeteccao: valorDetectadoAutomaticamente,
        ...(distanceRequired
          ? { distanciaPercorrida: distanciaNumerica }
          : {}),
        comprovanteUrl: imagePreview,
        comprovanteTituloOriginal: receiptOriginalNameRef.current || "",
        status: "concluida",
        criadoPor: currentUser.id,
        dataLancamento: new Date(),
        completedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),

        // Audit fields
        imageHash: imageHash,
        deviceId: deviceId,
        uploadedAt: serverTimestamp(),
        uploadedBy: currentUser.id,
        receiptRetentionDays: TRIP_RECEIPT_RETENTION_DAYS,
        receiptRetentionPolicy: "storage-lifecycle-v1",
        contractId: activeContract?.id || "",
        jobId: activeJob?.id || "",
        ...(resolvedSimulatorCode === "GTO" && isGtoPrintMode
          ? {
              gtoEntryMode: "print",
              gtoReceiptAnalyzed: gtoReceiptAnalysisStatus === "ok",
              gtoReceiptValidationMode: "ocr",
              gtoReceiptManualConfirmation: false,
              gtoReceiptReviewRequired: false,
              gtoRewardedAdDetected: false,
            }
          : {}),
      };

      if (uploadLocation) {
        data.uploadLocation = uploadLocation;
      }

      const completionResult = await completeTripWithCoordinator({
        userId: currentUser.id,
        companyId: currentCompany?.id || activeCompanyId || "",
        tripData: data,
        job: activeJob,
        contract: activeContract,
        addTrip: (trip) =>
          TripsRepository.addTripWithinOperationLimit(trip, {
            jobId: activeJob.id,
            totalDeliveries: freshJobTotalDeliveries,
          }),
        persistTripId: async (tripRef) => {
          await updateDoc(tripRef as any, { tripId: tripRef.id });
        },
        syncJobProgress: activeJob
          ? (jobId) => TripsRepository.syncJobProgress(jobId)
          : undefined,
        finishJob,
        projectedOperationProgress: freshJobProgress + 1,
        projectedOperationTotalDeliveries: freshJobTotalDeliveries,
      });

      let completedOperationResultData: OperationResultData | null = null;
      if (completionResult.operationClosed && activeJob && activeContract) {
        const completionAt = new Date();
        const assignedAtMs = activeJob.assignedAt
          ? new Date(activeJob.assignedAt).getTime()
          : activeJob.createdAt
            ? new Date(activeJob.createdAt).getTime()
            : completionAt.getTime();
        const executionMs = Math.max(0, completionAt.getTime() - assignedAtMs);
        const executionDays = Math.floor(executionMs / (1000 * 60 * 60 * 24));
        const executionHours = Math.floor((executionMs / (1000 * 60 * 60)) % 24);
        const executionMinutes = Math.floor((executionMs / (1000 * 60)) % 60);
        const dueAt = activeJob.dueAt || activeJob.deadlineDate;
        const dueDiffMs = dueAt
          ? new Date(dueAt).getTime() - completionAt.getTime()
          : 0;
        const isAtrasado = Boolean(dueAt) && dueDiffMs < 0;
        const remainingAbsMs = Math.abs(dueDiffMs);
        const remainingDays = Math.floor(remainingAbsMs / (1000 * 60 * 60 * 24));
        const remainingHours = Math.floor((remainingAbsMs / (1000 * 60 * 60)) % 24);
        const remainingMinutes = Math.floor((remainingAbsMs / (1000 * 60)) % 60);
        const tempoRestante = dueAt
          ? remainingDays > 0
            ? `${remainingDays}d ${remainingHours}h ${remainingMinutes}min`
            : `${remainingHours}h ${remainingMinutes}min`
          : "-";

        completedOperationResultData = {
          contractName: activeContract.name || "Operação concluída",
          tempoExecucao:
            executionDays > 0
              ? `${executionDays}d ${executionHours}h ${executionMinutes}min`
              : `${executionHours}h ${executionMinutes}min`,
          tempoRestante,
          isAtrasado,
          prazoTotal: `${Math.max(1, Number(activeContract.deadlineDays || 1))} dias`,
          totalViagens: Number(
            completionResult.operationProgress ?? freshJobProgress + 1,
          ),
          vehicleName: activeVehicle?.name,
          showTrailer: !trailerlessSimulator,
          trailerName: trailerlessSimulator ? undefined : activeTrailer?.name,
        };
        publishOperationCompletionResult({
          userId: currentUser.id,
          jobId: activeJob.id,
          data: completedOperationResultData,
        });
      }

      if (!completionResult.operationClosed) {
        toast.success("Viagem lançada com sucesso!");
      }
      setOrigem("");
      setDestino("");
      setValor("");
      setValorDetectadoAutomaticamente(false);
      setValorDeteccaoMetodo("manual");
      setDistanciaPercorrida("");
      setImagePreview(null);
      setImageHash(null);
      setGtoReceiptAnalysisStatus("idle");
      setGtoAdDoubleDetected(false);
      setGtoAdEvidence([]);
      receiptOriginalNameRef.current = "";
      if (fileInputRef.current) fileInputRef.current.value = "";

      setIsNavigating(true);
      // Navigation is no longer held by syncJobProgress. If the projected
      // progress is not the final delivery, show the history immediately;
      // the final delivery remains on the current route until finishJob's
      // optimistic job update redirects it safely.
      if (completionResult.operationClosed) {
        navigate("/driver/dashboard", {
          replace: true,
          state: { nvuOperationResult: completedOperationResultData },
        });
      } else if (
        activeJob &&
        activeContract &&
        freshJobProgress + 1 < activeContract.totalDeliveries
      ) {
        navigate("/driver/history");
      }
    } catch (err: any) {
      console.error("Erro ao salvar viagem:", err);
      const errorCode = String(err?.code || "").toLowerCase();
      const errorMessage = String(err?.message || "");
      const combinedError = `${errorCode} ${errorMessage}`;
      const userMessage = combinedError.includes("OPERATION_TRIP_LIMIT_REACHED")
        ? "A operação já atingiu o total previsto de viagens. Solicite uma nova operação."
        : combinedError.includes("OPERATION_TRIP_SLOT_ALREADY_CLAIMED")
          ? "Esta viagem já está sendo processada ou já foi registrada. Atualize o histórico antes de tentar novamente."
          : combinedError.includes("OPERATION_NOT_RECORDABLE")
            ? "A operação não está ativa para receber novos lançamentos. Atualize a operação e tente novamente."
            : combinedError.includes("permission-denied")
              ? "O servidor não autorizou este lançamento. Atualize a operação e tente novamente."
              : "Ocorreu um erro ao salvar a viagem. Tente novamente.";
      toast.error(userMessage);
    } finally {
      setIsUploading(false);
    }
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
    if (valorDetectadoAutomaticamente) return;
    const rawValue = e.target.value;
    setValor(formatCurrency(rawValue));
    setValorDeteccaoMetodo("manual");
  };

  const currentDeliveries = activeJob ? activeJob.progress : 0;
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
    <div className="w-full max-w-2xl mx-auto space-y-3 pb-6 px-0 sm:px-4 text-gray-900 dark:text-gray-100 font-sans tracking-[-0.01em]">
      {/* Top Header */}
      <div className="flex items-center gap-2 py-1 px-2">
        <button
          onClick={() => navigate(-1)}
          className="p-1 -ml-1 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors bg-transparent border-none outline-none appearance-none cursor-pointer flex items-center justify-center shrink-0"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex flex-col min-w-0">
          <h1 className="text-[16px] sm:text-[17px] font-bold text-gray-900 dark:text-white tracking-tight leading-none mb-0.5">
            Lançar Viagem
          </h1>
          <p className="text-[11px] sm:text-[12px] text-gray-500 dark:text-gray-400 font-medium leading-none">
            Registre os dados da entrega realizada.
          </p>
        </div>
      </div>

      {/* Main Info Card */}
      <div className="bg-white dark:bg-[#121213] border border-gray-100 dark:border-gray-800 shadow-[0_2px_12px_rgba(0,0,0,0.03)] sm:rounded-2xl rounded-xl overflow-hidden">
        <div className="p-3 sm:p-4">
          {/* Company Header */}
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-[#1BACB3] font-bold text-white tracking-tighter text-lg rounded-xl flex items-center justify-center shrink-0 shadow-sm overflow-hidden">
              {companyLogo ? (
                <img
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
              <p className="text-[11px] text-gray-500 dark:text-gray-400 font-medium mt-0.5 truncate">
                CNPJ {cnpj}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-y-2.5 gap-x-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-gray-50 dark:bg-gray-800/80 border border-gray-100 dark:border-gray-800 flex items-center justify-center shrink-0 text-gray-400 dark:text-gray-500">
                <User size={14} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-gray-400 dark:text-gray-500 font-medium leading-none mb-0.5">
                  Motorista
                </p>
                <p className="text-[12px] font-semibold text-gray-800 dark:text-gray-200 truncate leading-none">
                  {driverName}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-gray-50 dark:bg-gray-800/80 border border-gray-100 dark:border-gray-800 flex items-center justify-center shrink-0 text-gray-400 dark:text-gray-500">
                <ClipboardList size={14} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-gray-400 dark:text-gray-500 font-medium leading-none mb-0.5">
                  Contrato
                </p>
                <p className="text-[12px] font-semibold text-gray-800 dark:text-gray-200 truncate leading-none">
                  {contractName}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-gray-50 dark:bg-gray-800/80 border border-gray-100 dark:border-gray-800 flex items-center justify-center shrink-0 text-gray-400 dark:text-gray-500">
                <Truck size={14} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-gray-400 dark:text-gray-500 font-medium leading-none mb-0.5">
                  Veículo
                </p>
                <p className="text-[12px] font-semibold text-gray-800 dark:text-gray-200 truncate leading-none">
                  {vehicleName}
                </p>
              </div>
            </div>
            {!trailerlessSimulator && (
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-gray-50 dark:bg-gray-800/80 border border-gray-100 dark:border-gray-800 flex items-center justify-center shrink-0 text-gray-400 dark:text-gray-500">
                  <Package size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 font-medium leading-none mb-0.5">
                    Reboque
                  </p>
                  <p className="text-[12px] font-semibold text-gray-800 dark:text-gray-200 truncate leading-none">
                    {trailerName}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Progress Card Section */}
        <div className="px-3 py-2 bg-gray-50/80 dark:bg-gray-800/30 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
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
            <span className="font-semibold text-[12px] text-gray-800 dark:text-gray-200">
              Viagens
            </span>
          </div>
          <div className="font-bold text-[13px] text-gray-900 dark:text-white">
            <span className="text-blue-600 dark:text-blue-400">
              {currentDeliveries}
            </span>
            <span className="text-gray-400 dark:text-gray-500">
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
      <div className="bg-white dark:bg-[#121213] border border-gray-200/80 dark:border-gray-800 shadow-[0_4px_24px_rgba(0,0,0,0.02)] sm:rounded-2xl rounded-xl p-3 sm:p-4 relative">
        <div className="space-y-3">
          {predefinedRoutes && !isGtoPrintMode ? (
            <div>
              <label className="text-[12px] font-semibold text-gray-800 dark:text-gray-200 mb-1 block">
                1. Rota*
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400 dark:text-gray-500 z-10">
                  <MapPin size={14} />
                </div>
                <div className="w-full min-h-9 px-3 py-1.5 pl-8 bg-gray-50 dark:bg-[#1A1F26]/50 border border-gray-200 dark:border-gray-800 text-[13px] rounded-lg cursor-not-allowed opacity-90 truncate flex items-center">
                  {isContractCompletedState ? (
                    <span className="text-green-600 dark:text-green-400 font-medium">Contrato 100% concluído</span>
                  ) : (
                    currentPredefinedRoute ? (
                      <span className="truncate">
                        <span className="font-semibold text-blue-600 dark:text-blue-400">
                          {`Viagem ${currentRouteIndex + 1}/${predefinedRoutes.length}`}
                        </span>
                        <span className="text-gray-600 dark:text-gray-300 font-medium ml-1.5">
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
                <label className="text-[12px] font-semibold text-gray-800 dark:text-gray-200 mb-1 block">
                  1. Origem*
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400 dark:text-gray-500">
                    <MapPin size={14} />
                  </div>
                  <input
                    type="text"
                    value={origem}
                    readOnly={false}
                    aria-label="Origem da rota"
                    onChange={(e) => setOrigem(e.target.value)}
                    className="w-full h-9 bg-white dark:bg-[#1A1F26] border border-gray-200 dark:border-gray-800 text-gray-800 dark:text-gray-100 text-[13px] rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 block pl-8 pr-3 py-1.5 transition-colors outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500"
                    placeholder="Ex.: Curitiba - PR"
                  />
                </div>
              </div>

              {/* 2. Destino */}
              <div>
                <label className="text-[12px] font-semibold text-gray-800 dark:text-gray-200 mb-1 block">
                  2. Destino*
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400 dark:text-gray-500">
                    <MapPin size={14} />
                  </div>
                  <input
                    type="text"
                    value={destino}
                    readOnly={false}
                    aria-label="Destino da rota"
                    onChange={(e) => setDestino(e.target.value)}
                    className="w-full h-9 bg-white dark:bg-[#1A1F26] border border-gray-200 dark:border-gray-800 text-gray-800 dark:text-gray-100 text-[13px] rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 block pl-8 pr-3 py-1.5 transition-colors outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500"
                    placeholder="Ex.: São Paulo - SP"
                  />
                </div>
              </div>
            </>
          )}

          {distanceRequired && (
            <div>
              <label className="text-[12px] font-semibold text-gray-800 dark:text-gray-200 mb-1 block">
                {distanceFieldNumber}. Distância percorrida (km)*
              </label>
              <div className="relative flex items-center border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden bg-white dark:bg-[#1A1F26] focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-500 transition-shadow h-9">
                <input
                  type="text"
                  inputMode="decimal"
                  value={distanciaPercorrida}
                  onChange={(event) => setDistanciaPercorrida(event.target.value)}
                  className="w-full bg-transparent text-gray-900 dark:text-white text-right font-semibold text-[13px] block px-3 py-1.5 outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500"
                  placeholder="0"
                  aria-label="Distância percorrida em quilômetros"
                />
                <div className="px-3 py-1.5 border-l border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50 text-gray-600 dark:text-gray-400 font-medium text-[13px] shrink-0">
                  km
                </div>
              </div>
            </div>
          )}

          {/* Comprovante */}
          <div>
            <label className="text-[12px] font-semibold text-gray-800 dark:text-gray-200 mb-1 block">
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
                {gtoReceiptAnalysisStatus === "ok" && "Print validado · nenhum anúncio/valor dobrado confirmado."}
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
                       ? "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-600 cursor-not-allowed opacity-50"
                       : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700"
                    )}
                  >
                    <X size={10} className="stroke-[2.5]" />
                    <span>Remover</span>
                  </button>
                </div>
                <div className="w-full rounded-xl overflow-hidden border border-gray-200 dark:border-gray-800 shadow-sm relative z-0">
                  <PhotoProvider>
                    <PhotoView src={imagePreview}>
                      <img
                        src={imagePreview}
                        alt="Prévia do comprovante"
                        className={cn("w-full h-auto max-h-[160px] object-cover sm:object-contain rounded-lg cursor-pointer transition-opacity", uploadPhase !== "idle" ? "opacity-70" : "opacity-100")}
                      />
                    </PhotoView>
                  </PhotoProvider>

                  {uploadPhase !== "idle" && (
                    <div className="absolute inset-x-0 bottom-0 bg-white/95 dark:bg-[#1A1F26]/95 backdrop-blur-md p-3 border-t border-gray-200/50 dark:border-gray-700/50 flex flex-col gap-1.5">
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
                       <div className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
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
                      Comprovante enviado com sucesso
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Valor */}
          <div className="pt-0.5">
            <div className="mb-1 flex items-center justify-between gap-2">
              <label className="text-[12px] font-semibold text-gray-800 dark:text-gray-200 block">
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
            <div className="relative flex items-center border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden bg-white dark:bg-[#1A1F26] focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-500 transition-shadow h-9">
              <div className="px-3 py-1.5 border-r border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50 text-gray-600 dark:text-gray-400 font-medium text-[13px] shrink-0">
                R$
              </div>
                <input
                  type="text"
                  value={valor}
                  onChange={handleValorChange}
                  readOnly={valorDetectadoAutomaticamente}
                  aria-readonly={valorDetectadoAutomaticamente}
                  title={valorDetectadoAutomaticamente ? "Valor detectado automaticamente pelo print; não pode ser alterado." : undefined}
                  className={cn(
                    "w-full bg-transparent text-gray-900 dark:text-white text-right font-semibold text-[13px] block pr-3 py-1.5 outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500",
                    valorDetectadoAutomaticamente
                      ? "cursor-not-allowed text-emerald-700 dark:text-emerald-300"
                      : "focus:ring-0",
                  )}
                  placeholder="0,00"
                />
            </div>
          </div>

          {/* Buttons */}
          <div className="pt-2 space-y-2">
            <button
              onClick={handleLancarViagem}
              disabled={isContractCompletedState || isUploading}
              className={cn(
                "w-full h-10 flex items-center justify-center gap-1.5 rounded-lg font-bold text-[13px] transition-all active:scale-[0.99]",
                isContractCompletedState
                  ? "bg-gray-400 dark:bg-gray-700 text-white cursor-not-allowed"
                  : "bg-[#1f242d] hover:bg-[#2a303c] active:bg-[#151921] text-white dark:bg-slate-200 dark:hover:bg-slate-300 dark:text-slate-800 shadow-sm dark:shadow-none"
              )}
            >
              <Send size={14} className="-mt-0.5" />
              {isContractCompletedState ? "CONTRATO CONCLUÍDO" : (isUploading ? "ENVIANDO..." : "LANÇAR VIAGEM")}
            </button>
            <button
              onClick={() => navigate("/driver/history")}
              className="w-full h-10 flex items-center justify-center gap-1.5 bg-white dark:bg-[#121213] hover:bg-slate-50 dark:hover:bg-gray-800 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-gray-800 rounded-lg font-bold text-[13px] transition-all active:scale-[0.99]"
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
