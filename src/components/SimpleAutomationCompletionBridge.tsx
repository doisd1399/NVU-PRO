import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  isSimpleAutomationNativeAvailable,
  recordSimpleAutomationProTiming,
  SimpleAutomation,
} from "../lib/simpleAutomationNative";
import { completeSimpleAutomationReceipt } from "../services/simpleAutomationCompletionService";
import { publishOperationCompletionResult } from "../lib/operationCompletionResult";

interface SimpleAutomationCompletionBridgeProps {
  currentUser: any;
  currentCompany: any;
  currentJob: any;
  currentContract: any;
  activeVehicle?: any;
  activeTrailer?: any;
  currentOperationProgress?: number;
  finishJob: (jobId: string) => Promise<void>;
}

const now = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const validationAmountCents = (validation: { amount: number | null }): number =>
  validation.amount === null ? 0 : Math.round(validation.amount * 100);

export function SimpleAutomationCompletionBridge({
  currentUser,
  currentCompany,
  currentJob,
  currentContract,
  activeVehicle,
  activeTrailer,
  currentOperationProgress,
  finishJob,
}: SimpleAutomationCompletionBridgeProps) {
  const navigate = useNavigate();
  const handledReceiptKey = useRef("");
  const running = useRef(false);
  const pendingPoll = useRef(false);
  const lastValidContext = useRef<{
    currentUser: any;
    currentCompany: any;
    currentJob: any;
    currentContract: any;
    activeVehicle?: any;
    activeTrailer?: any;
    currentOperationProgress?: number;
    finishJob: (jobId: string) => Promise<void>;
  } | null>(null);

  useEffect(() => {
    if (currentUser?.id && currentCompany?.id && currentJob?.id && currentContract?.id) {
      lastValidContext.current = {
        currentUser,
        currentCompany,
        currentJob,
        currentContract,
        activeVehicle,
        activeTrailer,
        currentOperationProgress,
        finishJob,
      };
    }
  }, [activeTrailer, activeVehicle, currentCompany, currentContract, currentJob, currentOperationProgress, currentUser, finishJob]);

  useEffect(() => {
    if (!isSimpleAutomationNativeAvailable()) return;
    if (!currentUser?.id || !currentCompany?.id || !currentJob?.id || !currentContract?.id) return;

    const progress = Math.max(
      0,
      Number(currentOperationProgress ?? currentJob.progress ?? 0),
    );
    const total = Math.max(
      0,
      Number(currentJob.totalDeliveries ?? currentContract.totalDeliveries ?? 0),
    );
    const jobStatus = String(currentJob.status ?? "");
    const operationClosed = Boolean(
      currentJob.deleted
        || ["completed", "cancelled"].includes(jobStatus.toLowerCase())
        || (total > 0 && progress >= total),
    );
    const companyName = String(currentCompany.name ?? currentCompany.companyName ?? "").trim();
    const operationName = String(
      currentJob.operationName
        ?? currentJob.contractNameSnapshot
        ?? currentContract.name
        ?? "",
    ).trim();
    const contractName = String(currentContract.name ?? "").trim();
    const vehicleName = String(
      activeVehicle?.name
        ?? activeVehicle?.model
        ?? activeVehicle?.vehicleName
        ?? "",
    ).trim();
    const trailerName = String(
      activeTrailer?.name
        ?? activeTrailer?.model
        ?? activeTrailer?.trailerName
        ?? "",
    ).trim();

    void SimpleAutomation.refreshOperationSnapshot({
      companyName,
      operationName,
      contractName,
      jobId: String(currentJob.id),
      contractId: String(currentContract.id),
      companyId: String(currentCompany.id),
      driverId: String(currentUser.id),
      jobProgress: progress,
      jobTotalDeliveries: total,
      jobStatus,
      operationClosed,
      vehicleName,
      trailerName,
    }).catch(() => undefined);
  }, [
    activeTrailer?.id,
    activeTrailer?.name,
    activeTrailer?.model,
    activeTrailer?.trailerName,
    activeVehicle?.id,
    activeVehicle?.name,
    activeVehicle?.model,
    activeVehicle?.vehicleName,
    currentCompany?.id,
    currentCompany?.name,
    currentCompany?.companyName,
    currentContract?.id,
    currentContract?.name,
    currentContract?.totalDeliveries,
    currentJob?.id,
    currentJob?.progress,
    currentOperationProgress,
    currentJob?.status,
    currentJob?.deleted,
    currentJob?.totalDeliveries,
    currentJob?.operationName,
    currentJob?.contractNameSnapshot,
    currentUser?.id,
  ]);

  const poll = useCallback(async () => {
    if (!isSimpleAutomationNativeAvailable() || running.current) return;
    const context = lastValidContext.current;
    if (!context?.currentUser?.id || !context.currentCompany?.id || !context.currentJob?.id || !context.currentContract?.id) {
      pendingPoll.current = true;
      return;
    }

    running.current = true;
    const readStartedAt = now();
    try {
      const nativeStatus = await SimpleAutomation.getStatus();
      const statusReadMs = now() - readStartedAt;
      if (nativeStatus.simpleState !== "CAPTURE_CAPTURED" || !nativeStatus.receiptText) return;
      // Native Firestore submission owns the immediate path. The Web bridge must
      // not race it or show a second success; it takes ownership only after the
      // native coordinator explicitly marks a safe fallback.
      if (nativeStatus.nativeSubmissionState === "SUBMITTING_NATIVE"
        || nativeStatus.nativeSubmissionState === "SYNCED") return;
      const bridgeCaptureElapsedMs = Number(statusReadMs.toFixed(1));
      recordSimpleAutomationProTiming("bridge_capture_received", bridgeCaptureElapsedMs);
      console.info("[NVU-ProTiming]", {
        stage: "bridge_capture_received",
        statusReadMs: bridgeCaptureElapsedMs,
      });

      // Freeze the exact native payload observed by this poll. The completion
      // service validates the native capture snapshot against the live context;
      // it never re-reads route/simulator metadata after asynchronous waits.
      const status = Object.freeze({ ...nativeStatus });
      const receiptKey = [
        status.captureAttemptId || "missing-attempt",
        status.captureContextEpoch || "missing-epoch",
        status.receiptCapturedAt || 0,
      ].join(":");
      if (handledReceiptKey.current === receiptKey) return;
      handledReceiptKey.current = receiptKey;

      const completionStartedAt = now();
      const result = await completeSimpleAutomationReceipt({
        status,
        currentUser: context.currentUser,
        currentCompany: context.currentCompany,
        currentJob: context.currentJob,
        currentContract: context.currentContract,
        activeVehicle: context.activeVehicle,
        activeTrailer: context.activeTrailer,
        finishJob: context.finishJob,
      });
      const bridgeCompletionMs = Number((now() - completionStartedAt).toFixed(1));
      recordSimpleAutomationProTiming("bridge_completion_finished", bridgeCompletionMs);
      console.info("[NVU-ProTiming]", {
        stage: "bridge_completion_finished",
        completionMs: bridgeCompletionMs,
      });
      if (result.submitted) {
        const historyStartedAt = now();
        if (result.tripId && validationAmountCents(result.validation) > 0) {
          await SimpleAutomation.recordConfirmedTrip({
            tripId: result.tripId,
            jobId: String(status.captureJobId || context.currentJob.id),
            companyId: String(status.captureCompanyId || context.currentCompany.id),
            driverId: String(status.captureDriverId || context.currentUser.id),
            contractId: String(status.captureContractId || context.currentContract.id),
            simulatorKey: String(status.captureSimulatorKey || status.simulatorKey || ""),
            origin: String(status.captureOrigin || ""),
            destination: String(status.captureDestination || ""),
            amountCents: validationAmountCents(result.validation),
            completedAt: Date.now(),
          });
        }
        const historyUpdatedMs = now() - historyStartedAt;
        recordSimpleAutomationProTiming("history_updated", historyUpdatedMs);
        recordSimpleAutomationProTiming("preview_shown", 0);
        console.info("[NVU-ProTiming]", {
          bridgeStatusReadMs: Number(statusReadMs.toFixed(1)),
          ...(result.trace || {}),
          historyUpdatedMs: Number(historyUpdatedMs.toFixed(1)),
        });
        if (result.operationClosed) {
          const completedAt = new Date();
          const assignedAtMs = context.currentJob.assignedAt
            ? new Date(context.currentJob.assignedAt).getTime()
            : context.currentJob.createdAt
              ? new Date(context.currentJob.createdAt).getTime()
              : completedAt.getTime();
          const executionMs = Math.max(0, completedAt.getTime() - assignedAtMs);
          const executionDays = Math.floor(executionMs / (1000 * 60 * 60 * 24));
          const executionHours = Math.floor((executionMs / (1000 * 60 * 60)) % 24);
          const executionMinutes = Math.floor((executionMs / (1000 * 60)) % 60);
          const dueAt = context.currentJob.dueAt || context.currentJob.deadlineDate;
          const dueDiffMs = dueAt
            ? new Date(dueAt).getTime() - completedAt.getTime()
            : 0;
          const isAtrasado = Boolean(dueAt) && dueDiffMs < 0;
          const remainingAbsMs = Math.abs(dueDiffMs);
          const remainingDays = Math.floor(remainingAbsMs / (1000 * 60 * 60 * 24));
          const remainingHours = Math.floor((remainingAbsMs / (1000 * 60 * 60)) % 24);
          const remainingMinutes = Math.floor((remainingAbsMs / (1000 * 60)) % 60);

          publishOperationCompletionResult({
            userId: context.currentUser.id,
            jobId: context.currentJob.id,
            data: {
              contractName:
                context.currentContract.name
                || context.currentJob.operationName
                || "Operação concluída",
              tempoExecucao:
                executionDays > 0
                  ? `${executionDays}d ${executionHours}h ${executionMinutes}min`
                  : `${executionHours}h ${executionMinutes}min`,
              tempoRestante: dueAt
                ? remainingDays > 0
                  ? `${remainingDays}d ${remainingHours}h ${remainingMinutes}min`
                  : `${remainingHours}h ${remainingMinutes}min`
                : "-",
              isAtrasado,
              prazoTotal: `${Math.max(1, Number(context.currentContract.deadlineDays || 1))} dias`,
              totalViagens: Number(
                result.operationProgress ?? Number(context.currentJob.progress || 0) + 1,
              ),
              vehicleName: context.activeVehicle?.name,
              showTrailer: Boolean(context.activeTrailer?.id || context.currentJob.trailerId),
              trailerName: context.activeTrailer?.name,
            },
          });
        }
        toast.success(
          result.operationClosed
            ? "Operação concluída. Exibindo os resultados."
            : "Viagem registrada com sucesso.",
          { duration: result.operationClosed ? 3600 : 3600 },
        );
        navigate("/driver/dashboard", { replace: true });
      } else {
        toast.error(result.reason || "Captura fora da tela correta. Abra a tela de conclusão e tente novamente.");
      }
    } catch (error) {
      handledReceiptKey.current = "";
      console.error("[NVU] Falha ao concluir viagem Pro", error);
      const code = String((error as any)?.message || (error as any)?.code || "");
      toast.error(
        code.includes("OPERATION_TRIP_LIMIT_REACHED")
          ? "A operação já atingiu o total previsto de viagens. Solicite uma nova operação."
          : "Não foi possível validar a captura. Abra a tela de conclusão e tente novamente.",
      );
    } finally {
      running.current = false;
      if (pendingPoll.current) {
        pendingPoll.current = false;
        void poll();
      }
    }
  }, [navigate]);

  const requestPoll = useCallback(() => {
    if (running.current) {
      pendingPoll.current = true;
      return;
    }
    void poll();
  }, [poll]);

  useEffect(() => {
    let disposed = false;
    let removeReceiptListener: (() => Promise<void>) | undefined;
    requestPoll();
    void SimpleAutomation.addListener("receiptCaptured", () => {
      if (!disposed) requestPoll();
    }).then((handle) => {
      if (disposed) {
        void handle.remove();
      } else {
        removeReceiptListener = handle.remove;
      }
    }).catch(() => undefined);

    const intervalId = window.setInterval(requestPoll, 200);
    const onVisibility = () => {
      if (document.visibilityState === "visible") requestPoll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
      if (removeReceiptListener) void removeReceiptListener();
    };
  }, [requestPoll]);

  return null;
}
