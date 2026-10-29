import { Clock, Navigation } from "lucide-react";

export function DriverOperationTiming({ remaining, disabled, busy, onStart }: {
  remaining: string; disabled: boolean; busy: boolean; onStart: () => void;
}) {
  return <div className="nvu-driver-operation-timing" data-testid="driver-operation-timing">
    <div className="nvu-driver-remaining-time">
      <Clock size={18} strokeWidth={1.7} aria-hidden="true" />
      <div><small>Tempo restante</small><strong>{remaining}</strong></div>
    </div>
    <button type="button" className="nvu-driver-start-work" onClick={onStart} disabled={disabled} aria-busy={busy}>
      <Navigation size={15} fill="currentColor" strokeWidth={1.7} aria-hidden="true" />
      <span>{busy ? "Preparando…" : "Iniciar trabalho"}</span>
    </button>
  </div>;
}
