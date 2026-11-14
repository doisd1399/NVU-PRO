import { createPortal } from "react-dom";
import React, { useEffect, useState } from "react";
import { Wallet, X } from "lucide-react";
import { formatMoney } from "../../lib/partnerships";
import { dateTimeText } from "../../lib/rewardPayments";
import { timeLeftText, type RewardOffer } from "../../lib/rewards";
import "./PartnershipStartSheet.css";

/**
 * Antes de iniciar um trabalho com pagamento: as condições, em poucas linhas, e o aceite.
 * Concluir fora do prazo finaliza o trabalho, mas o motorista não recebe (rompe o acordo).
 */
export function RewardStartSheet({ offer, onClose, onConfirm }: { offer: RewardOffer | null; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { setBusy(false); setError(""); }, [offer?.id]);
  if (!offer) return null;
  const now = Date.now(), left = timeLeftText(offer.deadlineMs, now), late = offer.deadlineMs > 0 && offer.deadlineMs < now;
  const confirm = async () => {
    if (busy) return; setBusy(true); setError("");
    try { await onConfirm(); } catch (reason: any) { setError(reason?.message || "Não foi possível iniciar o trabalho."); setBusy(false); }
  };
  return createPortal(<div className="nvu-pss-backdrop" role="presentation" onClick={() => !busy && onClose()}>
    <section className="nvu-pss" role="dialog" aria-modal="true" aria-labelledby="nvu-rss-title" onClick={event => event.stopPropagation()} data-testid="reward-start-sheet">
      <header><span className="nvu-pss-badge"><Wallet size={14} aria-hidden="true" /> Oferta de trabalho</span>
        <button type="button" aria-label="Fechar" disabled={busy} onClick={onClose}><X size={18} aria-hidden="true" /></button></header>
      <h2 id="nvu-rss-title">{offer.contractName || offer.name}</h2>
      <p className="nvu-pss-partner">{offer.companyName}</p>
      <ul style={{ margin: "10px 0", padding: 0, listStyle: "none", display: "grid", gap: 6, fontSize: 14 }}>
        <li><b>{formatMoney(offer.perTripCents)}</b> por viagem{offer.maxTripsPerDriver ? ` · ${offer.maxTripsPerDriver} viagens` : ""}</li>
        {offer.deadlineMs ? <li>Prazo: <b>{dateTimeText(offer.deadlineMs)}</b>{left ? ` (${left})` : ""}</li> : null}
        {offer.goalRequired && offer.goalCents ? <li>Meta de ganhos: <b>{formatMoney(offer.goalCents)}</b></li> : null}
        <li>Pagamento por Pix, depois de concluir.</li>
      </ul>
      {late ? <p className="nvu-pss-notice" role="alert">O prazo desta operação já terminou. Você pode iniciar e finalizar o trabalho, mas <b>não recebe</b> pelo serviço.</p> : null}
      {late ? null : <p className="nvu-pss-notice" role="note">Conclua a operação no prazo. Fora do prazo você finaliza o trabalho, mas <b>não recebe</b> pelo serviço, por romper o acordo.{offer.goalRequired && offer.goalCents ? <> Os ganhos das viagens também precisam atingir a meta de {formatMoney(offer.goalCents)}: <b>sem a meta, não há pagamento</b> pelo trabalho.</> : null} Ao concluir, informe sua chave Pix.</p>}
      {error ? <p className="nvu-pss-error" role="alert">{error}</p> : null}
      <button type="button" className="nvu-pss-start" disabled={busy} onClick={() => void confirm()}>{busy ? "Iniciando…" : late ? "Iniciar sem pagamento" : "Aceitar e iniciar"}</button>
      <button type="button" className="nvu-pss-start" style={{ background: "transparent", color: "inherit", border: "1px solid currentColor", opacity: 0.8, marginTop: 8 }} disabled={busy} onClick={onClose}>Agora não</button>
    </section>
  </div>, document.body);
}
