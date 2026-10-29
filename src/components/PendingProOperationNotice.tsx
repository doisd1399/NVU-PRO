import { useEffect, useState } from "react";
import { isSimpleAutomationNativeAvailable, SimpleAutomation } from "../lib/simpleAutomationNative";
import { ProPendingAuthButton } from "./ProPendingAuthButton";
import { useOperationRecovery } from "../hooks/useMissingOperationTrip";

/** Pro receipts are local until the server ACK; keep them out of ranking totals. */
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
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(0);
  const [authRequired, setAuthRequired] = useState(false);
  useEffect(() => {
    if (!isSimpleAutomationNativeAvailable() || !jobId || !driverId || !companyId) {
      setPending(0);
      setFailed(0);
      setAuthRequired(false);
      return;
    }
    let alive = true;
    const refresh = async () => {
      try {
        const status = await SimpleAutomation.getReadOnlyProQueueDiagnostics({ driverId, companyId, jobId });
        if (!status.ownerAuthenticated) {
          if (alive) { setPending(0); setFailed(0); setAuthRequired(false); }
          return;
        }
        const matching = (status.pendingProTrips || []).filter((trip) =>
          trip.jobId === jobId && trip.driverId === driverId && trip.companyId === companyId
          && !["SYNCED", "DISCARDED_OPERATION_COMPLETED"].includes(trip.queueStatus));
        if (alive) {
          setPending(matching.length);
          setFailed(matching.filter((trip) => ["FAILED", "CONFLICT"].includes(trip.queueStatus)).length);
          setAuthRequired(matching.some((trip) => trip.queueStatus === "AUTH_REQUIRED"
            || String(trip.lastQueueError || "").includes("Autenticação nativa não corresponde")));
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
  if (!pending && !serverConflict) return null;
  return (
    <div className="rounded-xl border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200">
      <strong>Operação atual: {confirmed}/{total || "—"} confirmadas</strong>
      {pending > 0 && <span className="block">{pending} {pending === 1 ? "tentativa salva" : "tentativas salvas"} neste aparelho. O ranking usa apenas as viagens confirmadas.</span>}
      {failed > 0 && (total <= 0 || confirmed < total) && <span className="block">{failed} {failed === 1 ? "tentativa exige" : "tentativas exigem"} revisão no histórico.</span>}
      {pending > 0 && total > 0 && confirmed >= total && <span className="block">Após o servidor confirmar a finalização, as tentativas locais restantes serão descartadas automaticamente.</span>}
      {serverConflict && <span className="block">
        A projeção operacional precisa de reconciliação: progresso armazenado {displayedServerProgress ?? "—"}, viagens canônicas confirmadas {displayedConfirmedCount ?? "—"}.{' '}
        Motivo: {recovery?.reason || "OPERATION_RECONCILIATION_CONFLICT"}. Nenhuma viagem será criada automaticamente.
      </span>}
      {serverConflict &&
        <button type="button" onClick={() => recovery?.retry()}
          className="mt-1 underline underline-offset-2">Conferir novamente</button>}
      {authRequired && (total <= 0 || confirmed < total) && <div className="mt-2"><span className="block">Confirme a conta Google do motorista para retomar o envio.</span><ProPendingAuthButton driverId={driverId!} /></div>}
    </div>
  );
}
