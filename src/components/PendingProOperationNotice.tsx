import { useEffect, useState } from "react";
import { isSimpleAutomationNativeAvailable, SimpleAutomation } from "../lib/simpleAutomationNative";
import { ProPendingAuthButton } from "./ProPendingAuthButton";
import { useOperationRecovery } from "../hooks/useMissingOperationTrip";

/**
 * Pro receipts are local until the server ACK and never count in ranking totals. A receipt that is only waiting for the network
 * is NOT announced here: it is a row of "Viagens da operação" with its send status. This card appears only when the driver has to
 * act (confirm the Google account, review a rejected receipt) or the server reports an inconsistency.
 */
export function PendingProOperationNotice({ jobId, driverId, companyId, confirmed, serverProgress, total, visibleHistoryCount }: {
  jobId?: string | null;
  driverId?: string | null;
  companyId?: string | null;
  confirmed: number;
  serverProgress?: number;
  total: number;
  visibleHistoryCount?: number;
  historyReady?: boolean;
}) {
  const recovery = useOperationRecovery();
  const [failed, setFailed] = useState(0);
  const [authAttempts, setAuthAttempts] = useState<string[]>([]);
  useEffect(() => {
    if (!isSimpleAutomationNativeAvailable() || !jobId || !driverId || !companyId) {
      setFailed(0);
      setAuthAttempts([]);
      return;
    }
    let alive = true;
    const refresh = async () => {
      try {
        const status = await SimpleAutomation.getReadOnlyProQueueDiagnostics({ driverId, companyId, jobId });
        if (!status.ownerAuthenticated) {
          if (alive) { setFailed(0); setAuthAttempts([]); }
          return;
        }
        const matching = (status.pendingProTrips || []).filter((trip) =>
          trip.jobId === jobId && trip.driverId === driverId && trip.companyId === companyId
          && !["SYNCED", "DISCARDED_OPERATION_COMPLETED"].includes(trip.queueStatus));
        if (alive) {
          setFailed(matching.filter((trip) => ["FAILED", "CONFLICT"].includes(trip.queueStatus)).length);
          setAuthAttempts(matching.filter((trip) => trip.queueStatus === "AUTH_REQUIRED"
            || String(trip.lastQueueError || "").includes("Autenticação nativa não corresponde")).map((trip) => trip.attemptId));
        }
      } catch { /* Retry when the native bridge is ready. */ }
    };
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
    window.addEventListener("nvu-completed-operation-queue-cleaned", refresh);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener("nvu-completed-operation-queue-cleaned", refresh); };
  }, [jobId, driverId, companyId]);

  const recoveryStatus = recovery?.jobId === jobId ? recovery.status : "unavailable";
  // `job.progress` and a realtime list are projections that can settle at
  // different moments. Never call that transient state a server inconsistency.
  // The reconciliation callable is the only authority allowed to classify a
  // real conflict.
  const serverConflict = recovery?.jobId === jobId && recoveryStatus === "conflict";
  const displayedServerProgress = recovery?.serverProgress ?? serverProgress;
  const displayedConfirmedCount = recovery?.confirmedCount ?? visibleHistoryCount;
  // Once the server has confirmed every delivery, leftover local attempts are redundant: nothing is asked of the driver.
  const incomplete = total <= 0 || confirmed < total;
  const needsAuth = authAttempts.length > 0 && incomplete;
  const needsReview = failed > 0 && incomplete;
  if (!serverConflict && !needsAuth && !needsReview) return null;
  return (
    <div role="status" data-testid="pro-attention-notice" className="rounded-xl border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200">
      <strong>Operação atual: {confirmed}/{total || "—"} confirmadas</strong>
      {needsReview && <span className="block">{failed} {failed === 1 ? "viagem salva exige" : "viagens salvas exigem"} revisão. Veja o histórico da operação.</span>}
      {serverConflict && <span className="block">
        A projeção operacional precisa de reconciliação: progresso armazenado {displayedServerProgress ?? "—"}, viagens canônicas confirmadas {displayedConfirmedCount ?? "—"}.{' '}
        Motivo: {recovery?.reason || "OPERATION_RECONCILIATION_CONFLICT"}. Nenhuma viagem será criada automaticamente.
      </span>}
      {serverConflict &&
        <button type="button" onClick={() => recovery?.retry()}
          className="mt-1 underline underline-offset-2">Conferir novamente</button>}
      {needsAuth && <div className="mt-2"><span className="block">Confirme a conta Google do motorista para retomar o envio.</span><ProPendingAuthButton driverId={driverId!} attemptIds={authAttempts} /></div>}
    </div>
  );
}
