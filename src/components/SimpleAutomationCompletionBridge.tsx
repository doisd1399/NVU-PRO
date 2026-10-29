import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  isSimpleAutomationNativeAvailable,
  SimpleAutomation,
} from "../lib/simpleAutomationNative";
import { authenticateNativeForPendingProTrip } from "../services/googleAuthService";
import type { NormalizedTrip } from "../lib/tripNormalizer";
import { toProOperationHistoryRows } from "../lib/proOperationHistory";

interface SimpleAutomationCompletionBridgeProps {
  currentUser: any;
  currentCompany: any;
  currentJob: any;
  currentContract: any;
  activeVehicle?: any;
  activeTrailer?: any;
  currentOperationProgress?: number;
  currentOperationTrips?: NormalizedTrip[];
  operationHistoryLoading?: boolean;
  operationHistoryReady?: boolean;
  operationHistoryError?: boolean;
}

type PendingProTrip = {
  attemptId: string;
  driverId?: string;
  queueStatus?: string;
  lastQueueError?: string;
};

/**
 * Native Pro is the only owner of the Firestore write. This bridge deliberately
 * does not call the Web completion service and never emits a second trip write.
 * It only observes durable queue state and presents the user action required to
 * repair a missing/divergent native Firebase identity.
 */
export function SimpleAutomationCompletionBridge({
  currentUser,
  currentCompany,
  currentJob,
  currentContract,
  activeVehicle,
  activeTrailer,
  currentOperationProgress,
  currentOperationTrips,
  operationHistoryLoading,
  operationHistoryReady,
  operationHistoryError,
}: SimpleAutomationCompletionBridgeProps) {
  const running = useRef(false);
  const snapshotRevision = useRef(0);
  const authPromptKey = useRef("");
  const authRecoveryInFlight = useRef(false);

  // Share the exact validated rows behind the WebView's operation progress
  // with the native bubble. Do not publish an initial, unresolved empty cache.
  useEffect(() => {
    if (!isSimpleAutomationNativeAvailable() || !currentJob?.id || !currentCompany?.id
      || !currentUser?.id || typeof currentOperationProgress !== "number"
      || (!operationHistoryReady && operationHistoryLoading)
      || !currentOperationTrips) return;
    if (operationHistoryError && currentOperationTrips.length === 0) return;
    const scope = {
      jobId: String(currentJob.id), companyId: String(currentCompany.id),
      driverId: String(currentUser.id),
    };
    const trips = toProOperationHistoryRows(currentOperationTrips, scope);
    // Refresh the operation scope before publishing its rows. A stale layout
    // must never replace the history of a different active operation.
    void SimpleAutomation.updateOperationHistory({
      ...scope, trips,
      confirmedTripCount: Math.max(0, Number(currentOperationProgress)),
      jobProgress: Math.max(0, Number(currentOperationProgress)),
    }).catch((error) => {
      console.warn("[NVU-Pro] operation history projection unavailable", error);
    });
  }, [currentUser?.id, currentCompany?.id, currentJob?.id,
    currentOperationProgress, currentOperationTrips,
    operationHistoryLoading, operationHistoryReady, operationHistoryError]);

  // Keep the native Pro card bound to the live operation even while a prior
  // receipt is queued and the driver never opens the overlay again.
  useEffect(() => {
    if (!isSimpleAutomationNativeAvailable() || !currentUser?.id || !currentCompany?.id
        || !currentJob?.id || !currentContract?.id) return;
    if (typeof currentOperationProgress !== "number") return;
    const progress = Math.max(0, Number(currentOperationProgress));
    const total = Math.max(0, Number(currentJob.totalDeliveries ?? currentContract.totalDeliveries ?? 0));
    const jobStatus = String(currentJob.status ?? "");
    const operationClosed = Boolean(currentJob.deleted
      || ["completed", "cancelled"].includes(jobStatus.toLowerCase())
      || (total > 0 && progress >= total));
    snapshotRevision.current = Math.max(Date.now(), snapshotRevision.current + 1);
    void SimpleAutomation.refreshOperationSnapshot({
      companyName: String(currentCompany.name ?? currentCompany.companyName ?? "").trim(),
      operationName: String(currentJob.operationName ?? currentJob.contractNameSnapshot
        ?? currentContract.name ?? "").trim(),
      contractName: String(currentContract.name ?? "").trim(),
      jobId: String(currentJob.id),
      contractId: String(currentContract.id),
      companyId: String(currentCompany.id),
      driverId: String(currentUser.id),
      confirmedTripCount: progress,
      jobProgress: progress,
      jobTotalDeliveries: total,
      jobStatus,
      operationClosed,
      operationContextRevision: snapshotRevision.current,
      vehicleName: String(activeVehicle?.name ?? activeVehicle?.model ?? activeVehicle?.vehicleName ?? "").trim(),
      trailerName: String(activeTrailer?.name ?? activeTrailer?.model ?? activeTrailer?.trailerName ?? "").trim(),
    }).catch((error) => console.warn("[NVU-Pro] operation snapshot refresh failed", error));
  }, [currentUser?.id, currentCompany?.id, currentCompany?.name, currentCompany?.companyName,
    currentJob?.id, currentJob?.totalDeliveries, currentJob?.status,
    currentJob?.deleted, currentJob?.operationName, currentJob?.contractNameSnapshot,
    currentContract?.id, currentContract?.name, currentContract?.totalDeliveries,
    activeVehicle?.name, activeVehicle?.model, activeVehicle?.vehicleName,
    activeTrailer?.name, activeTrailer?.model, activeTrailer?.trailerName, currentOperationProgress]);

  const recoverNativeAuth = useCallback(
    (pending: PendingProTrip, nativeAuthState: string, silent = false) => {
      const attemptId = String(pending.attemptId || "").trim();
      const expectedDriverId = String(pending.driverId || "").trim();
      const promptKey = `${attemptId}:${nativeAuthState}:${silent ? "silent" : "interactive"}`;
      if (!attemptId || authRecoveryInFlight.current || authPromptKey.current === promptKey) return;
      authPromptKey.current = promptKey;

      const message = nativeAuthState === "DIVERGENT"
        ? "A conta Google nativa não corresponde ao motorista desta viagem."
        : "A sessão Google nativa expirou ou está ausente.";
      const authenticate = async () => {
        if (authRecoveryInFlight.current) return;
        authRecoveryInFlight.current = true;
        try {
          if (!expectedDriverId || String(currentUser?.id || "") !== expectedDriverId) {
            toast.error("A operação aberta não corresponde ao usuário autenticado. A viagem foi preservada.");
            return;
          }
          await authenticateNativeForPendingProTrip(expectedDriverId, {
            allowInteractiveFallback: !silent,
          });
          const retry = await SimpleAutomation.retryPending();
          if (retry.status === "auth-required" || retry.status === "retry-unavailable") {
            throw new Error(retry.status);
          }
          authPromptKey.current = "";
          if (!silent) {
            toast.success("Identidade confirmada. Nova tentativa iniciada para a viagem salva.");
          }
        } catch (error) {
          authPromptKey.current = silent ? promptKey : "";
          console.warn("[NVU-ProAuth] reautenticação não concluída", error);
          if (silent) {
            toast.warning("A conta Google nativa precisa de uma confirmação para retomar o envio.", {
              id: `nvu-pro-auth-${attemptId}`,
              duration: 20000,
              action: {
                label: "Autenticar",
                onClick: () => {
                  authPromptKey.current = "";
                  void recoverNativeAuth(pending, nativeAuthState, false);
                },
              },
            });
          } else {
            toast.error("Não foi possível confirmar a conta Google. A viagem continua preservada para nova tentativa.");
          }
        } finally {
          authRecoveryInFlight.current = false;
        }
      };

      toast.warning(message, {
        id: `nvu-pro-auth-${attemptId}`,
        duration: 20000,
        description: "Toque em Autenticar para retomar automaticamente, sem refazer a viagem.",
        action: {
          label: "Autenticar",
          onClick: () => {
            void authenticate();
          },
        },
      });
    },
    [currentUser?.id],
  );

  const poll = useCallback(async () => {
    if (!isSimpleAutomationNativeAvailable() || running.current) return;
    running.current = true;
    try {
      const status = await SimpleAutomation.getStatus();
      const pending = (status.pendingProTrips || []).find(
        (item) => item.queueStatus !== "FAILED",
      ) as PendingProTrip | undefined;
      if (!pending) {
        if (!authRecoveryInFlight.current) authPromptKey.current = "";
        return;
      }
      const nativeAuthState = String(status.nativeAuthState || "UNKNOWN");
      if (nativeAuthState === "MISSING" && pending.queueStatus !== "AUTH_REQUIRED") {
        // A Web Firebase session does not hydrate the native FirebaseAuth
        // instance automatically. Try Credential Manager once in the
        // background; only its failure becomes a user-facing action.
        recoverNativeAuth(pending, nativeAuthState, true);
        return;
      }
      const queueError = String(pending.lastQueueError || "");
      const identityRequired = nativeAuthState === "MISSING"
        || nativeAuthState === "DIVERGENT"
        || queueError.includes("Autenticação nativa não corresponde");
      // A server permission rejection is not a network retry and does not
      // justify opening Google repeatedly when the native UID already matches.
      // The history card keeps the explicit, one-tap repair action available.
      if (pending.queueStatus !== "AUTH_REQUIRED" || !identityRequired) return;
      console.info("[NVU-ProAuth] auth-required", {
        state: nativeAuthState,
        queueStatus: pending.queueStatus,
        diagnosticAt: status.nativeAuthDiagnosticAt || 0,
      });
      recoverNativeAuth(pending, nativeAuthState, false);
    } catch (error) {
      // Native status polling is best effort. The durable Android queue and
      // JobScheduler remain the recovery authority when the WebView is paused.
      console.warn("[SimpleAutomationCompletionBridge] status polling failed", error);
    } finally {
      running.current = false;
    }
  }, [recoverNativeAuth]);

  useEffect(() => {
    if (!isSimpleAutomationNativeAvailable()) return;
    void poll();
    let disposed = false;
    let removeReceiptListener: (() => Promise<void>) | undefined;
    void SimpleAutomation.addListener("receiptCaptured", () => {
      if (!disposed) void poll();
    }).then((handle) => {
      if (disposed) {
        void handle.remove();
      } else {
        removeReceiptListener = handle.remove;
      }
    }).catch((error) => {
      console.warn("[SimpleAutomationCompletionBridge] receipt listener registration failed", error);
    });

    // The event listener is authoritative; polling is only a safety net. Keep
    // the safety net short so an already-correct native session cannot remain
    // visually stuck for several seconds.
    const intervalId = window.setInterval(() => void poll(), 750);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
      if (removeReceiptListener) void removeReceiptListener();
    };
  }, [poll]);

  return null;
}
