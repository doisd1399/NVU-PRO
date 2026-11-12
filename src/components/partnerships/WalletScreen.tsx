import React, { useState } from "react";
import { formatMoney, type WalletEntry, type WalletTotals } from "../../lib/partnerships";
import { WalletRow } from "./PanelParts";

type Filter = "todos" | "ganho" | "investimento";

/** Carteira digital de parcerias: ganhos (quando executa) e investimentos (quando contrata). Contabilidade do app; nenhum dinheiro passa pelo NVU. */
export function WalletView({ entries, totals, busy, onOpen, onPay }: { entries: WalletEntry[]; totals: WalletTotals; busy: boolean; onOpen: (partnershipId: string) => void; onPay: (e: WalletEntry) => void }) {
  const [filter, setFilter] = useState<Filter>("todos");
  const shown = entries.filter(entry => filter === "todos" || entry.kind === filter);
  const gainTotal = totals.toReceiveCents + totals.receivedCents + totals.forecastGainCents, investTotal = totals.toPayCents + totals.paidCents + totals.forecastInvestCents;
  return <>
    <div className="b2p-sum">
      <div><small>Ganhos em parcerias</small><b data-tone={gainTotal ? "pos" : undefined}>{formatMoney(gainTotal)}</b><em>{formatMoney(totals.receivedCents)} recebido · {formatMoney(totals.toReceiveCents)} a receber</em></div>
      <div><small>Investimento em parcerias</small><b>{formatMoney(investTotal)}</b><em>{formatMoney(totals.paidCents)} pago · {formatMoney(totals.toPayCents)} a pagar</em></div>
    </div>
    <div className="b2p-facts"><div><b>{formatMoney(totals.netCents)}</b><span>Saldo liquidado</span></div><div><b>{formatMoney(totals.forecastGainCents)}</b><span>Ganho previsto</span></div><div><b>{formatMoney(totals.forecastInvestCents)}</b><span>Investimento previsto</span></div></div>
    <div className="b2p-subtabs" role="tablist" aria-label="Filtrar movimentos">
      {([["todos", "Todos"], ["ganho", "Ganhos"], ["investimento", "Investimentos"]] as [Filter, string][]).map(([id, label]) =>
        <button type="button" role="tab" key={id} aria-selected={filter === id} data-on={filter === id ? "1" : "0"} onClick={() => setFilter(id)}>{label}</button>)}
    </div>
    {shown.length ? <div>{shown.map(entry => {
      const action = entry.kind === "investimento" && entry.status === "a_pagar" ? "Pagar com comprovante" : entry.kind === "ganho" && (entry.status === "a_receber" || entry.status === "pago") ? "Confirmar recebimento" : "";
      return <div key={entry.id}><WalletRow e={entry} busy={busy} onAction={action ? () => onPay(entry) : undefined} actionLabel={action} />
        <div className="b2p-wactions" style={{ paddingBottom: 6, paddingTop: 0, marginTop: -6 }}><button type="button" className="b2p-btn" data-v="text" data-size="sm" onClick={() => onOpen(entry.partnershipId)}>Ver parceria</button></div></div>;
    })}</div> : <p className="b2p-empty">Sem movimentos ainda. Parcerias com valor do acordo aparecem aqui.</p>}
    <p className="b2p-hint">A carteira é o registro do que foi combinado entre as empresas: o pagamento acontece fora do NVU. Fora do prazo, o valor final tem −25%.</p>
  </>;
}
