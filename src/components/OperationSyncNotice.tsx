import { useEffect, useState } from "react";
import { operationOutbox, reconcileOperationOutboxNativeState } from "../services/operationOutbox";
import { toast } from "sonner";

const actionButton = "rounded-md border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60 dark:border-nvu-line dark:text-nvu-text";

/**
 * The state of a saved start or finish. A finish that waits always says why and can always be retried or cancelled: the driver
 * is never left behind a button that does nothing.
 */
export function OperationSyncNotice({ job }: { job?: { id: string; operationSyncState?: string; operationSyncError?: string } | null }) {
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && navigator.onLine === false);
  useEffect(() => {
    const update = () => setOffline(navigator.onLine === false);
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  if (!job?.operationSyncState) return null;
  const rejected = job.operationSyncState.endsWith("rejected");
  const finishing = job.operationSyncState === "pending_finish";

  const retryNow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      operationOutbox.retryNow(job.id);
      await operationOutbox.synchronize("start");
      await operationOutbox.synchronize("finish");
      if (typeof navigator !== "undefined" && navigator.onLine === false) toast.message("Sem conexão. Vamos tentar assim que a rede voltar.");
    } catch { toast.error("Não foi possível salvar a nova tentativa neste aparelho. Os registros foram preservados."); }
    finally { setBusy(false); }
  };
  const cancelFinish = async () => {
    try {
      if (!operationOutbox.cancelFinish(job.id)) { toast.message("A finalização está sendo enviada agora. Aguarde alguns segundos."); return; }
      setConfirmingCancel(false);
      await reconcileOperationOutboxNativeState().catch(() => undefined);
      toast.success("Finalização cancelada. Você pode finalizar a operação novamente.");
    } catch { toast.error("Não foi possível cancelar agora. Os registros foram preservados."); }
  };

  return <div role={rejected ? "alert" : "status"} data-testid="operation-sync-notice" className="mx-3 mb-2 rounded-lg bg-slate-100 px-3 py-2 text-[11px] leading-relaxed text-slate-600 dark:bg-nvu-surface dark:text-nvu-text-soft">
    {rejected ? <>Não foi possível confirmar esta ação. {job.operationSyncError} Os registros locais foram preservados.
      <button type="button" className="ml-2 underline" onClick={() => {
        try { operationOutbox.retry(job.id); }
        catch { toast.error("Não foi possível salvar a nova tentativa neste aparelho. Os registros foram preservados."); }
      }}>Tentar sincronizar</button>
      {job.operationSyncState === "finish_rejected" && <button type="button" className="ml-2 underline" onClick={() => void cancelFinish()}>Cancelar finalização</button>}</>
      : finishing
        ? <>
          <span data-testid="operation-sync-message">Finalização salva neste aparelho. {offline ? "Sem conexão: será confirmada assim que a rede voltar." : job.operationSyncError || "Será confirmada após o envio e a validação das viagens."}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-2">
            {confirmingCancel
              ? <>
                <span>Cancelar a finalização? Suas viagens continuam salvas.</span>
                <button type="button" className={actionButton} onClick={() => void cancelFinish()}>Sim, cancelar</button>
                <button type="button" className={actionButton} onClick={() => setConfirmingCancel(false)}>Voltar</button>
              </>
              : <>
                <button type="button" className={actionButton} disabled={busy} onClick={() => void retryNow()}>{busy ? "Verificando…" : "Tentar agora"}</button>
                <button type="button" className={actionButton} onClick={() => setConfirmingCancel(true)}>Cancelar finalização</button>
              </>}
          </span>
        </>
        : "Início salvo neste aparelho. Você pode trabalhar offline; a operação e as viagens aguardam confirmação ao sincronizar."}
  </div>;
}
