import { Clock, Navigation } from "lucide-react";

/**
 * The current operation's action: one quiet full-width "Iniciar trabalho" button (with the glass reflection) and, right
 * below it, the remaining time. The button takes the colour of the figures card of the operation (see
 * DriverOperationCard.css) and keeps the original filled arrow and reflection in both themes.
 */
export function DriverOperationTiming({ remaining, disabled, busy, onStart }: {
  remaining: string; disabled: boolean; busy: boolean; onStart: () => void;
}) {
  return <div className="nvu-driver-operation-timing" data-testid="driver-operation-timing">
    <button type="button" className="nvu-driver-start-work" onClick={onStart} disabled={disabled} aria-busy={busy}>
      <Navigation size={15} fill="currentColor" strokeWidth={1.7} aria-hidden="true" />
      <span>{busy ? "Preparando…" : "Iniciar trabalho"}</span>
    </button>
    <p className="nvu-driver-remaining-time" data-testid="driver-remaining-time">
      <Clock size={16} strokeWidth={1.8} aria-hidden="true" />
      <span>Tempo restante:</span>
      <strong>{remaining}</strong>
    </p>
  </div>;
}
