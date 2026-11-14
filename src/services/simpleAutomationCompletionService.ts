import { canonicalTripOperationService } from "../application/trip/CanonicalTripOperationService";
import { canonicalTripCommandService } from "../application/trip/CanonicalTripCommandService";
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
import { isDefinitelyOffline } from "../lib/connectivity";
import { buildClientOperationProjection } from "../application/operation/operationProjectionSelectors";
import { canonicalTripRepository } from "../repositories/CanonicalTripRepository";

export type SimpleAutomationCompletionContext = {
  status: SimpleAutomationNativeStatus;
  currentUser: any;
  currentCompany: any;
  currentJob: any;
  currentContract: any;
  activeVehicle?: any;
  activeTrailer?: any;
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
  pendingSync?: boolean;
  reason?: string;
  trace?: SimpleAutomationCompletionTrace;
  operationProgress?: number;
  operationTotalDeliveries?: number;
  operationClosed?: boolean;
  operationReadyToFinalize?: boolean;
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

function localConfirmedOperationProgress(job: Record<string, unknown>): number {
  return buildClientOperationProjection(job, canonicalTripRepository.list())?.confirmedTripCount ?? 0;
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

  const contextMismatches = [
    !attemptId && "tentativa ausente",
    !capturedContextEpoch || !sameText(capturedContextEpoch, liveContextEpoch) ? "contexto" : "",
    !capturedSimulatorKey || !sameText(capturedSimulatorKey, liveSimulatorKey) ? "simulador" : "",
    !capturedSimulatorCode || !sameText(capturedSimulatorCode, liveSimulatorCode) ? "código do simulador" : "",
    !capturedPackageId || !sameText(capturedPackageId, livePackageId) ? "pacote" : "",
    !capturedCompanyId || !sameText(capturedCompanyId, input.currentCompany?.id) ? "empresa" : "",
    !capturedJobId || !sameText(capturedJobId, input.currentJob?.id) ? "operação" : "",
    !capturedContractId || !sameText(capturedContractId, input.currentContract?.id) ? "contrato" : "",
    !origin && "origem ausente",
    !destination && "destino ausente",
    !simulatorDefinition && "simulador inválido",
  ].filter(Boolean) as string[];

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
    const details = contextMismatches.length ? ` Motivo: ${contextMismatches.join(", ")}.` : "";
    return rejectWithReason(`A captura pertence a um contexto diferente; ela não será enviada automaticamente.${details}`);
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
  // Capture/queueing must not wait for a remote preflight. The server
  // transaction owns eligibility, capacity and capture-event idempotency.
  const authoritativeState = {
    progress: localConfirmedOperationProgress(input.currentJob),
    totalDeliveries: Number(input.currentJob.totalDeliveries || input.currentContract.totalDeliveries || 0),
    status: String(input.currentJob.status || "active"),
  };
  const isOffline = isDefinitelyOffline();
  trace.operationStateMs = monotonicNow() - operationStateStartedAt;
  trace.duplicateGuardMs = monotonicNow() - duplicateStartedAt;
  traceStage("web_preflight_finished", trace.operationStateMs);
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
    const terminalMessage = String(authoritativeState.status || "").trim().toLowerCase() === "awaiting_completion"
      ? "Todas as viagens foram registradas. Finalize a operação no painel para continuar."
      : "Operação concluída. Solicite uma nova operação para continuar.";
    return rejectWithReason(terminalMessage, validation);
  }

  // Equal amounts can belong to different journeys. Replay protection is
  // bound to attempt/context/capture time, never to the amount alone.
  const capturedAt = Number(status.receiptCapturedAt || 0);
  const tripCompletedAtLocal = new Date(capturedAt > 0 && capturedAt <= Date.now() + 300_000 ? capturedAt : Date.now()).toISOString();
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
    createdAtLocal: tripCompletedAtLocal,
    completedAtLocal: tripCompletedAtLocal,
    dataLancamento: tripCompletedAtLocal,
    completedAt: tripCompletedAtLocal,
    createdAt: tripCompletedAtLocal,
    updatedAt: tripCompletedAtLocal,
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
    // Preserve immutable OCR evidence through the queue; server checks it
    // against the cents and removes raw text before persisting public history.
    receiptText,
    simpleReceiptCurrency: evidence.currency,
    simpleReceiptSourceField: validation.sourceField,
    simpleReceiptResultScreenConfirmed: evidence.resultScreenConfirmed,
    simpleReceiptBonusEvidence: evidence.bonusEvidence,
    simpleReceiptConfidence: evidence.confidence,
    simpleReceiptCapturedAt: status.receiptCapturedAt || 0,
    simpleReceiptCaptureAttemptId: attemptId,
    simpleReceiptCaptureContextEpoch: capturedContextEpoch,
    simpleReceiptRawTextHashPending: true,
    source: "PRO_SIMPLE_AUTOMATION",
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

  // The next confirmed count is assigned by the server writer. Before ACK,
  // the client must not predict a slot, limit or terminal state.
  const projectedOperationProgress = authoritativeState.progress;
  const operationWillClose = false;
  const addTripStartedAt = monotonicNow();
  traceStage("web_adddoc_started");
  const result = await completeTripWithCoordinator({
    userId: input.currentUser.id,
    companyId: capturedCompanyId,
    tripData,
    job: input.currentJob,
    contract: input.currentContract,
    addTrip: (trip) =>
      canonicalTripCommandService.addTripWithinOperationLimit(trip, {
        jobId: capturedJobId,
        totalDeliveries: authoritativeTotal,
        tripId: deterministicTripId,
      }),
    syncJobProgress: (jobId) => canonicalTripOperationService.syncJobProgress(jobId),
    deferOperationReconciliation: !operationWillClose,
    projectedOperationProgress,
    projectedOperationTotalDeliveries: authoritativeTotal,
    onOperationReconciled: async (state) => {
      try {
        await SimpleAutomation.refreshOperationState({
          jobProgress: Number(state.progress ?? authoritativeState.progress),
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
  const savedOffline = result.docRef.offline === true || String(result.docRef.id || "").startsWith("local-");
  await SimpleAutomation.acknowledgeReceipt({
    accepted: true,
    pendingSync: savedOffline,
    captureAttemptId: attemptId,
      reason: savedOffline
        ? "Viagem Pro registrada offline. Aguardando conexão para validação."
        : `Viagem Pro lançada com segurança (${result.docRef.id}).`,
  });
  trace.acknowledgeMs = monotonicNow() - acknowledgeStartedAt;
  traceStage("web_ack_finished", trace.acknowledgeMs);
  trace.totalMs = monotonicNow() - totalStartedAt;
  traceTiming(trace);
  return {
    validation,
    submitted: true,
    pendingSync: savedOffline,
    trace,
    operationProgress: result.operationProgress,
    operationTotalDeliveries: result.operationTotalDeliveries,
    operationClosed: result.operationClosed,
    operationReadyToFinalize: result.operationReadyToFinalize,
  };
  });
}
