import { serverTimestamp, updateDoc } from "firebase/firestore";
import { TripsRepository } from "../repositories/TripsRepository";
import { completeTripWithCoordinator } from "./operationalCompletionCoordinator";
import type { SimpleReceiptValidation } from "./simpleAutomationReceiptPolicy";
import { validateProReceiptEvidence } from "./pro-universal/proReceiptAdapters";
import {
  getProSimulatorDefinition,
  type ProSimulatorKey,
} from "./pro-universal/proUniversalContracts";
import { SimpleAutomation, recordSimpleAutomationProTiming } from "../lib/simpleAutomationNative";
import type { SimpleAutomationNativeStatus } from "../lib/simpleAutomationNative";
import { isTripRecordableJobStatus } from "../lib/jobStatus";
import { resolveTripTrailerFields } from "../lib/tripTrailer";

export type SimpleAutomationCompletionContext = {
  status: SimpleAutomationNativeStatus;
  currentUser: any;
  currentCompany: any;
  currentJob: any;
  currentContract: any;
  activeVehicle?: any;
  activeTrailer?: any;
  finishJob: (jobId: string) => Promise<void>;
};

export type SimpleAutomationCompletionTrace = {
  statusReadMs?: number;
  validationMs?: number;
  duplicateGuardMs?: number;
  operationStateMs?: number;
  addTripMs?: number;
  acknowledgeMs?: number;
  totalMs?: number;
};

export type SimpleAutomationCompletionResult = {
  validation: SimpleReceiptValidation;
  submitted: boolean;
  tripId?: string;
  reason?: string;
  trace?: SimpleAutomationCompletionTrace;
  operationProgress?: number;
  operationTotalDeliveries?: number;
  operationClosed?: boolean;
};

const monotonicNow = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const PRO_SUBMISSION_LOCKS = new Map<string, Promise<void>>();

async function withProSubmissionLock<T>(
  key: string,
  work: () => Promise<T>,
): Promise<T> {
  const previous = PRO_SUBMISSION_LOCKS.get(key) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chain = previous.catch(() => undefined).then(() => current);
  PRO_SUBMISSION_LOCKS.set(key, chain);
  await previous.catch(() => undefined);
  try {
    return await work();
  } finally {
    release();
    if (PRO_SUBMISSION_LOCKS.get(key) === chain) PRO_SUBMISSION_LOCKS.delete(key);
  }
}

function traceTiming(trace: SimpleAutomationCompletionTrace): void {
  // Deliberately emit only stage durations. Never include user/company/job IDs,
  // simulator packages, route names or OCR text in diagnostics.
  if (typeof console !== "undefined" && typeof console.info === "function") {
    console.info("[NVU-ProTiming]", trace);
  }
}

function traceStage(stage: string, elapsedMs?: number): void {
  recordSimpleAutomationProTiming(stage, elapsedMs);
  if (typeof console !== "undefined" && typeof console.info === "function") {
    console.info("[NVU-ProTiming]", {
      stage,
      ...(typeof elapsedMs === "number" ? { elapsedMs: Number(elapsedMs.toFixed(1)) } : {}),
    });
  }
}

function text(value: unknown): string {
  return String(value || "").trim();
}

function sameText(left: unknown, right: unknown): boolean {
  return text(left) === text(right);
}

const emptyValidation = (reason: string): SimpleReceiptValidation => ({
  decision: "review",
  amount: null,
  currency: "UNKNOWN",
  reasons: [reason],
  sourceField: null,
  candidates: [],
});

async function rejectReceipt(
  validation: SimpleReceiptValidation,
  reason: string,
  trace?: SimpleAutomationCompletionTrace,
): Promise<SimpleAutomationCompletionResult> {
  const acknowledgeStartedAt = monotonicNow();
  await SimpleAutomation.acknowledgeReceipt({ accepted: false, reason });
  if (trace) {
    trace.acknowledgeMs = monotonicNow() - acknowledgeStartedAt;
    traceTiming(trace);
  }
  return { validation, submitted: false, reason, trace };
}

export async function completeSimpleAutomationReceipt(
  input: SimpleAutomationCompletionContext,
): Promise<SimpleAutomationCompletionResult> {
  const totalStartedAt = monotonicNow();
  const trace: SimpleAutomationCompletionTrace = {};
  const status = input.status;
  const attemptId = text(status.captureAttemptId);
  const capturedContextEpoch = text(status.captureContextEpoch);
  const capturedSimulatorKey = text(status.captureSimulatorKey) as ProSimulatorKey;
  const capturedSimulatorCode = text(status.captureSimulatorCode);
  const capturedPackageId = text(status.capturePackageId);
  const capturedCompanyId = text(status.captureCompanyId);
  const capturedJobId = text(status.captureJobId);
  const capturedContractId = text(status.captureContractId);
  const origin = text(status.captureOrigin);
  const destination = text(status.captureDestination);
  const receiptText = text(status.receiptText);

  const rejectWithReason = async (
    reason: string,
    validation: SimpleReceiptValidation = emptyValidation(reason),
  ): Promise<SimpleAutomationCompletionResult> => {
    trace.totalMs = monotonicNow() - totalStartedAt;
    return rejectReceipt(validation, reason, trace);
  };

  if (status.simpleState !== "CAPTURE_CAPTURED" || !receiptText) {
    return rejectWithReason("A captura ainda não está pronta para validação.");
  }
  traceStage("web_capture_received");

  const simulatorDefinition = getProSimulatorDefinition(capturedSimulatorKey);
  const liveSimulatorKey = text(status.simulatorKey);
  const liveSimulatorCode = text(status.simulatorCode);
  const liveContextEpoch = text(status.contextEpoch);
  const livePackageId = text(status.packageId);

  if (
    !attemptId
    || !capturedContextEpoch
    || !capturedSimulatorKey
    || !capturedSimulatorCode
    || !capturedPackageId
    || !capturedCompanyId
    || !capturedJobId
    || !capturedContractId
    || !origin
    || !destination
    || !simulatorDefinition
    || !sameText(capturedSimulatorKey, liveSimulatorKey)
    || !sameText(capturedSimulatorCode, liveSimulatorCode)
    || !sameText(capturedContextEpoch, liveContextEpoch)
    || !sameText(capturedPackageId, livePackageId)
    || !sameText(capturedCompanyId, input.currentCompany?.id)
    || !sameText(capturedJobId, input.currentJob?.id)
    || !sameText(capturedContractId, input.currentContract?.id)
  ) {
    return rejectWithReason("A captura pertence a um contexto diferente; ela não será enviada automaticamente.");
  }

  const validationStartedAt = monotonicNow();
  traceStage("web_validation_started");
  const { validation, evidence } = validateProReceiptEvidence(capturedSimulatorKey, receiptText);
  trace.validationMs = monotonicNow() - validationStartedAt;
  traceStage("web_validation_finished", trace.validationMs);

  if (
    validation.decision !== "accept"
    || !validation.sourceField
    || !evidence.resultScreenConfirmed
    || evidence.amountCents <= 0
    || evidence.bonusEvidence === "POSITIVE"
    || evidence.bonusEvidence === "DUPLICATED"
  ) {
    const reason = validation.reasons.join(" ") || "A evidência da tela de resultados não foi aprovada.";
    return rejectWithReason(reason, validation);
  }

  if (origin.localeCompare(destination, "pt-BR", { sensitivity: "base" }) === 0) {
    return rejectWithReason("Origem e destino da viagem Pro são inválidos.", validation);
  }

  if (!input.currentUser?.id || !input.currentCompany?.id || !input.currentJob?.id || !input.currentContract?.id) {
    return rejectWithReason("A operação ativa não está disponível para concluir a viagem Pro.", validation);
  }

  const amountCents = evidence.amountCents;
  const amount = amountCents / 100;
  const deterministicTripId = `simple_${input.currentUser.id}_${attemptId}`
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, 180);
  const trailerFields = resolveTripTrailerFields({
    simulatorKey: capturedSimulatorKey,
    job: input.currentJob,
    contract: input.currentContract,
    trailer: input.activeTrailer,
  });
  const duplicateGuardKey = `simple-value:${capturedJobId}:${input.currentUser.id}:${amountCents}`;
  const duplicateLockKey = `pro:${capturedJobId}:${input.currentUser.id}:${capturedSimulatorKey}`;
  return withProSubmissionLock(duplicateLockKey, async () => {
  const operationStateStartedAt = monotonicNow();
  traceStage("web_preflight_started");
  const duplicateStartedAt = operationStateStartedAt;
  let authoritativeState: Awaited<ReturnType<typeof TripsRepository.readAuthoritativeOperationState>>;
  let previousIdenticalTrip: Awaited<ReturnType<typeof TripsRepository.findLatestOperationTripByValue>>;
  try {
    [authoritativeState, previousIdenticalTrip] = await Promise.all([
      TripsRepository.readAuthoritativeOperationState(
        capturedJobId,
        Number(input.currentContract.totalDeliveries || 0),
      ),
      TripsRepository.findLatestOperationTripByValue({
        jobId: capturedJobId,
        driverId: input.currentUser.id,
        companyId: capturedCompanyId,
        amountCents,
        simulatorKey: capturedSimulatorKey,
        duplicateGuardKey,
      }),
    ]);
    const parallelElapsed = monotonicNow() - operationStateStartedAt;
    trace.operationStateMs = parallelElapsed;
    trace.duplicateGuardMs = monotonicNow() - duplicateStartedAt;
    traceStage("web_preflight_finished", parallelElapsed);
  } catch (error) {
    const elapsed = monotonicNow() - operationStateStartedAt;
    trace.operationStateMs = elapsed;
    trace.duplicateGuardMs = elapsed;
    console.warn("[NVU-Pro] operação/duplicate guard não pôde ser confirmado; envio bloqueado", error);
    return rejectWithReason("Não foi possível confirmar a operação atual. A viagem não foi enviada; tente novamente.", validation);
  }
  const authoritativeTotal = authoritativeState.totalDeliveries || Number(input.currentContract.totalDeliveries || 0);
  if (!isTripRecordableJobStatus(authoritativeState.status, authoritativeState.progress, authoritativeTotal)) {
    try {
      await SimpleAutomation.refreshOperationState({
        jobProgress: authoritativeState.progress,
        jobTotalDeliveries: authoritativeTotal,
        jobStatus: authoritativeState.status || "completed",
        operationClosed: true,
      });
    } catch (error) {
      console.warn("[NVU-Pro] refresh terminal da operação falhou", error);
    }
    return rejectWithReason("Operação concluída. Solicite uma nova operação para continuar.", validation);
  }

  if (previousIdenticalTrip) {
    return rejectWithReason(
      "Esta viagem Pro foi bloqueada porque o mesmo valor já foi registrado consecutivamente nesta operação.",
      validation,
    );
  }

  const tripData: Record<string, unknown> = {
    empresaId: capturedCompanyId,
    companyId: capturedCompanyId,
    empresaNome: input.currentCompany.companyName || input.currentCompany.name || "Empresa",
    motoristaId: input.currentUser.id,
    driverId: input.currentUser.id,
    motoristaNome: input.currentUser.name || "Motorista",
    contratoId: capturedContractId,
    contractId: capturedContractId,
    contratoNumero: input.currentContract.name || "",
    contratoDescricao: "",
    jobId: capturedJobId,
    origem: origin,
    destino: destination,
    valor: amount,
    valorCents: amountCents,
    valorDeteccaoMetodo: "simple_native_ocr",
    valorDetectadoAutomaticamente: true,
    valorBloqueadoPorDeteccao: true,
    comprovanteTituloOriginal: "simple-native-receipt",
    status: "concluida",
    criadoPor: input.currentUser.id,
    dataLancamento: serverTimestamp(),
    completedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    simulatorId: capturedSimulatorKey,
    simulatorKey: capturedSimulatorKey,
    simulatorCode: simulatorDefinition.simulatorCode,
    simulatorName: simulatorDefinition.simulatorCode,
    simuladorNome: simulatorDefinition.simulatorCode,
    simuladorCodigo: simulatorDefinition.simulatorCode,
    veiculoId: input.activeVehicle?.id || input.currentJob.vehicleId || "",
    veiculoNome: input.activeVehicle?.name || "",
    veiculoPlaca: input.activeVehicle?.plate || "",
    ...trailerFields,
    simpleAutomation: true,
    simpleAutomationVersion: "v2-universal-snapshot",
    simpleReceiptCurrency: evidence.currency,
    simpleReceiptSourceField: validation.sourceField,
    simpleReceiptResultScreenConfirmed: evidence.resultScreenConfirmed,
    simpleReceiptBonusEvidence: evidence.bonusEvidence,
    simpleReceiptConfidence: evidence.confidence,
    simpleReceiptCapturedAt: status.receiptCapturedAt || 0,
    simpleReceiptCaptureAttemptId: attemptId,
    simpleReceiptCaptureContextEpoch: capturedContextEpoch,
    simpleReceiptRawTextHashPending: true,
    idempotencyKey: `simple:${capturedJobId}:${input.currentUser.id}:${attemptId}`,
    deterministicTripId,
    simpleDuplicateGuardKey: duplicateGuardKey,
    simpleDuplicateGuardVersion: "v3-indexed-snapshot",
  };

  // Visual feedback must never delay the durable write.
  void SimpleAutomation.showStatusMessage({
    message: "Enviando viagem…",
    durationMs: 6500,
  }).catch((error) => {
    console.warn("[NVU-Pro] mensagem visual de envio não pôde ser exibida", error);
  });

  const projectedOperationProgress = authoritativeState.progress + 1;
  const operationWillClose = Boolean(
    authoritativeTotal > 0 && projectedOperationProgress >= authoritativeTotal,
  );
  const addTripStartedAt = monotonicNow();
  traceStage("web_adddoc_started");
  const result = await completeTripWithCoordinator({
    userId: input.currentUser.id,
    companyId: capturedCompanyId,
    tripData,
    job: input.currentJob,
    contract: input.currentContract,
    addTrip: (trip) =>
      TripsRepository.addTripWithinOperationLimit(trip, {
        jobId: capturedJobId,
        totalDeliveries: authoritativeTotal,
        tripId: deterministicTripId,
      }),
    persistTripId: async (tripRef) => {
      await updateDoc(tripRef as any, { tripId: tripRef.id });
    },
    syncJobProgress: (jobId) => TripsRepository.syncJobProgress(jobId),
    finishJob: input.finishJob,
    deferOperationReconciliation: !operationWillClose,
    projectedOperationProgress,
    projectedOperationTotalDeliveries: authoritativeTotal,
    onOperationReconciled: async (state) => {
      try {
        await SimpleAutomation.refreshOperationState({
          jobProgress: Number(state.progress ?? authoritativeState.progress + 1),
          jobTotalDeliveries: Number(state.totalDeliveries ?? authoritativeTotal),
          jobStatus: state.status || "active",
          operationClosed: Boolean(state.closed),
        });
      } catch (error) {
        console.warn("[NVU-Pro] refresh pós-reconciliação falhou", error);
      }
    },
  });
  trace.addTripMs = monotonicNow() - addTripStartedAt;
  traceStage("web_adddoc_finished", trace.addTripMs);

  // The trip is already durable. Refreshing the overlay is UX-only and must
  // not delay the acknowledgement that confirms registration. The full
  // snapshot is refreshed so operation/vehicle/trailer do not remain frozen
  // at the moment Pro was launched.
  const liveOperationName = text(
    input.currentJob?.operationName
      || input.currentJob?.operacaoNome
      || input.currentJob?.operation
      || input.currentJob?.operacao
      || input.currentContract?.operationName
      || input.currentContract?.operacaoNome
      || input.currentContract?.name,
  );
  const liveContractName = text(
    input.currentContract?.contractName
      || input.currentContract?.contratoNome
      || input.currentContract?.name
      || input.currentContract?.numero
      || input.currentContract?.number,
  );
  void SimpleAutomation.refreshOperationSnapshot({
    companyName: text(input.currentCompany?.companyName || input.currentCompany?.name),
    operationName: liveOperationName,
    contractName: liveContractName,
    jobId: text(input.currentJob?.id),
    contractId: text(input.currentContract?.id),
    companyId: capturedCompanyId,
    driverId: text(input.currentUser?.id),
    jobProgress: Number(result.operationProgress ?? authoritativeState.progress),
    jobTotalDeliveries: Number(result.operationTotalDeliveries ?? authoritativeTotal),
    jobStatus: result.operationStatus || "active",
    operationClosed: Boolean(result.operationClosed),
    vehicleName: text(input.activeVehicle?.name || input.currentJob?.vehicleName || input.currentJob?.veiculoNome),
    trailerName: text(trailerFields.reboqueNome),
  }).catch((error) => {
    console.warn("[NVU-Pro] refresh completo do card de operação falhou após envio", error);
  });

  const acknowledgeStartedAt = monotonicNow();
  traceStage("web_ack_started");
  await SimpleAutomation.acknowledgeReceipt({
    accepted: true,
    reason: `Viagem Pro lançada com segurança (${result.docRef.id}).`,
  });
  trace.acknowledgeMs = monotonicNow() - acknowledgeStartedAt;
  traceStage("web_ack_finished", trace.acknowledgeMs);
  trace.totalMs = monotonicNow() - totalStartedAt;
  traceTiming(trace);
  return {
    validation,
    submitted: true,
    tripId: result.docRef.id,
    trace,
    operationProgress: result.operationProgress,
    operationTotalDeliveries: result.operationTotalDeliveries,
    operationClosed: result.operationClosed,
  };
  });
}
