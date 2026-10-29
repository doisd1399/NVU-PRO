import { operationOutbox } from "../services/operationOutbox";
import { toast } from "sonner";

export function OperationSyncNotice({ job }: { job?: { id: string; operationSyncState?: string; operationSyncError?: string } | null }) {
  if (!job?.operationSyncState) return null;
  const rejected = job.operationSyncState.endsWith("rejected");
  return <div role={rejected ? "alert" : "status"} className="mx-3 mb-2 rounded-lg bg-slate-100 px-3 py-2 text-[11px] leading-relaxed text-slate-600 dark:bg-nvu-surface dark:text-nvu-text-soft">
    {rejected ? <>Não foi possível confirmar esta ação. {job.operationSyncError} Os registros locais foram preservados.
      <button type="button" className="ml-2 underline" onClick={() => {
        try { operationOutbox.retry(job.id); }
        catch { toast.error("Não foi possível salvar a nova tentativa neste aparelho. Os registros foram preservados."); }
      }}>Tentar sincronizar</button></>
      : job.operationSyncState === "pending_finish"
        ? "Finalização salva neste aparelho. Será confirmada após o envio e a validação das viagens."
        : "Início salvo neste aparelho. Você pode trabalhar offline; a operação e as viagens aguardam confirmação ao sincronizar."}
  </div>;
}
