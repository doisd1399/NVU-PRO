import { useEffect, useState } from "react";
import { Trash2, RefreshCw } from "lucide-react";
import { syncEngine } from "../../services/sync/SyncEngine";
import type { FailedRegistrationRecovery, FailedRegistrationRecoveryReason } from "../../lib/failedTripRegistrationRecovery";
import { formatTripHistoryMoney } from "../../lib/tripMoneyPresentation";
import { pendingTripFailureExplanation } from "../../lib/printProtocolRecovery509";

const messages: Record<FailedRegistrationRecoveryReason, string> = {
  READY: "A tentativa local falhou; o registro permanece preservado.",
  PERMISSION_DENIED: "O envio foi negado. Revise o acesso e o vínculo; o registro permanece preservado.",
  SERVER_PRECONDITION: "Uma condição do servidor não foi atendida. O registro permanece preservado para revisão.",
  PRINT_PROTOCOL_RETRY: "O comprovante continua consistente com a política atual. Reenvie uma única vez após confirmar que o endpoint atualizado está publicado.",
  OTHER_ACCOUNT: "Este registro pertence a outra conta e permanece preservado.",
  COMMAND_UNAVAILABLE: "O comando salvo não está disponível para diagnóstico.",
  COMMAND_AMBIGUOUS: "Foram encontrados comandos em conflito; o registro permanece preservado.",
  COMMAND_NOT_FAILED: "O estado do comando mudou; o registro permanece preservado.",
  FAILURE_REQUIRES_REVIEW: "Esta falha requer revisão. Nenhuma nova tentativa foi iniciada.",
  IDENTITY_REQUIRES_REVIEW: "O vínculo do registro requer revisão. Nenhuma nova tentativa foi iniciada.",
  PAYLOAD_REQUIRES_REVIEW: "Registro e comando diferem; ambos permanecem preservados para revisão.",
};

export function FailedHistoryRegistrationRecovery({ companyId, jobId, onlyFailures = false }: { companyId: string; jobId?: string; refreshKey?: unknown; onlyFailures?: boolean }) {
  const [revision, setRevision] = useState(0);
  const [discarding, setDiscarding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    const events = ["nvu-canonical-trip-queued", "nvu-trip-sync-state-changed", "nvu-canonical-trip-updated", "nvu:canonical-trip-updated", "storage", "online", "offline"];
    events.forEach(name => window.addEventListener(name, refresh));
    return () => events.forEach(name => window.removeEventListener(name, refresh));
  }, []);
  let view: ReturnType<typeof syncEngine.inspectFailedHistoryRegistrations>;
  let pending: ReturnType<typeof syncEngine.getOwnedPendingRegistrations>;
  try {
    void revision;
    view = syncEngine.inspectFailedHistoryRegistrations(companyId);
    pending = syncEngine.getOwnedPendingRegistrations(companyId, jobId);
    if (onlyFailures) pending = pending.filter(item => item.state === "FAILED" || item.state === "CONFLICT");
  } catch {
    return null;
  }
  if (!pending.length) return null;

  const retry = async (row: FailedRegistrationRecovery) => {
    setRetrying(row.commandKey); setError(null);
    try {
      const ok = await syncEngine.retryFailedHistoryRegistration(row);
      if (!ok) setError("A pendência mudou. Atualize a tela antes de tentar novamente.");
      else setRevision(value => value + 1);
    } catch { setError("Não foi possível preparar o reenvio. O comprovante continua preservado."); }
    finally { setRetrying(null); }
  };

  const discard = async (row: FailedRegistrationRecovery) => {
    if (!window.confirm(`Descartar “${row.label}” deste aparelho?\n\nATENÇÃO: se a viagem ainda não foi confirmada no servidor, a pendência e a referência local podem se perder definitivamente. Esta ação NÃO envia nem valida a viagem. Só prossiga após verificar o servidor.`)) return;
    setDiscarding(row.commandKey);
    setError(null);
    try {
      const ok = await syncEngine.discardFailedHistoryRegistration(row);
      if (!ok) setError("A pendência mudou e não pôde ser descartada com segurança. Atualize a tela e tente novamente.");
      else setRevision(value => value + 1);
    } catch {
      setError("Não foi possível descartar a pendência local.");
    } finally {
      setDiscarding(null);
    }
  };

  return (
    <section aria-label="Viagens aguardando confirmação" className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-xs text-slate-700 dark:border-amber-500/20 dark:bg-amber-950/20 dark:text-nvu-text-soft">
      <h3 className="font-semibold">Suas viagens aguardando confirmação · {pending.length}</h3>
      <div className="mt-3 space-y-3">
        <p>Viagens e comprovantes estão salvos neste aparelho. Entram no progresso e nos ganhos após a confirmação do servidor.</p>
        {error && <p className="rounded-lg bg-red-50 p-2 text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
        {pending.map((item, index) => {
          const id = String(item.trip.canonicalTripId || item.trip.tripId);
          const row = view.rows.find(row => row.tripId === id);
          const stage = ({ RECEIPT_LOAD: "Leitura do comprovante", RECEIPT_UPLOAD: "Envio do comprovante", RECEIPT_LOCAL_SAVE: "Confirmação do upload", CALLABLE_REGISTRATION: "Validação no servidor", CALLABLE_ACK: "Confirmação do registro", SERVER_READ: "Leitura da confirmação", SERVER_ACK: "Conferência da confirmação" } as Record<string, string>)[item.lastFailureStage || ""];
          const reason = String(item.lastError || "");
          const failed = item.state === "FAILED" || item.state === "CONFLICT";
          const status = item.state === "SYNCING" ? "Enviando e validando sua viagem…"
            : failed ? "Validação exige revisão; comprovante preservado"
            : navigator.onLine === false ? "Aguardando conexão para enviar automaticamente"
            : "Envio automático em andamento; nova tentativa programada se necessário";
          const detail = failed ? pendingTripFailureExplanation(reason) : "";
          const code = reason.match(/^(?:functions\/)?[a-z-]+/i)?.[0] || "não informado";
          return <div key={`${id}-${index}`} className="space-y-2 border-t border-amber-200 pt-2 dark:border-amber-500/20">
            <p className="font-semibold">{String(item.trip.origem || item.trip.origin || "Origem")} → {String(item.trip.destino || item.trip.destination || "Destino")}</p>
            <p>{formatTripHistoryMoney(item.trip)} · aguardando confirmação</p>
            <p role="status" className="font-medium">{status}</p>
            {detail && <p>{detail}</p>}
            {failed && <p className="text-[11px] opacity-80">Código técnico: {code}.</p>}
            {failed && row && <p className="text-[11px] opacity-90">{messages[row.reason]}</p>}
            {failed && !row && <p>Não foi possível correlacionar o comando e o registro local para recuperação. Preserve o comprovante e consulte o diagnóstico.</p>}
            {stage && <p>Última etapa: {stage}.</p>}
            {row && ["READY", "PERMISSION_DENIED", "SERVER_PRECONDITION", "PRINT_PROTOCOL_RETRY"].includes(row.reason) && <button type="button"
              onClick={() => void retry(row)} disabled={Boolean(retrying || discarding)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 font-semibold disabled:opacity-50 dark:border-nvu-line">
              <RefreshCw size={14} aria-hidden="true" />{retrying === row.commandKey ? "Preparando…" : row.reason === "PRINT_PROTOCOL_RETRY" ? "Revalidar após atualização do servidor" : "Reenviar com validação"}
            </button>}
            {row && <button type="button" onClick={() => void discard(row)} disabled={Boolean(discarding || retrying)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 px-2.5 py-1.5 font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/20">
              <Trash2 size={14} aria-hidden="true" />
              {discarding === row.commandKey ? "Descartando…" : "Descartar deste aparelho"}
            </button>}
          </div>;
        })}
      </div>
    </section>
  );
}
