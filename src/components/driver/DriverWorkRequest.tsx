import { useId } from "react";
import { ClipboardList, Navigation } from "lucide-react";

export function DriverWorkRequest({ online, suspended, busy, pending, requestedAt, success, onRequest, onCancel, variant = "compact" }: {
  online: boolean; suspended: boolean; busy: boolean; pending: boolean; requestedAt?: string;
  success: boolean; onRequest: () => void; onCancel: () => void;
  variant?: "compact" | "panel";
}) {
  const descriptionId = useId();
  const explanation = suspended ? "Solicitações bloqueadas durante a suspensão."
    : !online ? "Fique disponível para solicitar trabalho." : variant === "panel" ? "Solicite um novo trabalho à empresa." : "Envie uma solicitação à empresa.";
  return <section className={`nvu-work-request${variant === "panel" ? " nvu-idle-work-request" : ""}`} aria-label="Solicitar trabalho">
    {variant === "panel" && <span className="nvu-idle-request-icon"><ClipboardList size={24} strokeWidth={1.7} aria-hidden="true" /></span>}
    <div><h2>{pending ? "Solicitação em andamento" : variant === "panel" ? "Sem operação em andamento" : "Solicitar trabalho"}</h2>
      <p id={descriptionId} role="status">{pending ? `Aguardando a empresa${requestedAt ? ` · enviada às ${requestedAt}` : ""}.`
        : success ? "Solicitação enviada. Aguarde o encaminhamento da empresa." : explanation}</p></div>
    {pending ? <button type="button" className={variant === "panel" ? "nvu-idle-request-cancel" : undefined} onClick={onCancel}>Cancelar pedido</button>
      : !success && <button type="button" className={variant === "panel" ? "nvu-idle-request-action" : "nvu-driver-start-work"} aria-describedby={descriptionId}
        disabled={!online || suspended || busy} aria-busy={busy} onClick={onRequest}>
        {variant === "panel" && <Navigation size={19} fill="currentColor" aria-hidden="true" />}{busy ? "Enviando…" : "Solicitar trabalho"}
      </button>}
  </section>;
}
