import React from "react";
import { ArrowRight, BarChart3, Repeat } from "lucide-react";
import { ManagementDialog } from "../admin/management/ManagementDialog";
import { formatDays, formatMoney, LATE_PENALTY_PERCENT, roleIn, shortName, type Partnership } from "../../lib/partnerships";
import { fmtDateTime, fmtDay } from "./shared";
import "../admin/management/OperationInfoSheet.css";

const Line = ({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "warn" | "neg" }) =>
  <div className="b2p-info-line" data-tone={tone}><span>{label}</span><b>{value}</b></div>;

/** "Informações da operação" da parceria: tudo o que não cabe no resumo (partes, acordo, pagamento, veículo, condições). */
export function PartnershipInfoSheet({ p, me, onResults, onRepeat, onClose }: { p: Partnership; me: string; onResults: () => void; onRepeat: () => void; onClose: () => void }) {
  const role = roleIn(p, me), s = p.settlement, pay = p.payment, contractor = role === "contractor";
  const money = (cents: number) => formatMoney(cents, p.currency);
  return <ManagementDialog title="Informações da operação" variant="sheet" onClose={onClose}>
    <div className="b2p-info" data-testid="partnership-info-sheet">
      <header className="b2p-info-head"><strong>{p.operationName}</strong><span>{shortName(p.contractorName)} → {shortName(p.executorName)}</span></header>

      <section>
        <Line label="Prazo" value={p.durationDays ? formatDays(p.durationDays) : "—"} />
        {p.deadlineMs ? <Line label="Prazo final" value={fmtDateTime(p.deadlineMs)} /> : null}
        {p.goalAmountCents ? <Line label="Meta de ganhos" value={money(p.goalAmountCents)} /> : null}
        {p.driverName ? <Line label="Motorista" value={p.driverName} /> : null}
        {p.vehicleName ? <Line label="Veículo" value={`${p.vehicleName}${p.vehiclePlate ? ` · ${p.vehiclePlate}` : ""}`} /> : null}
        {p.trailerName || p.trailerRequirement ? <Line label="Reboque" value={p.trailerName || p.trailerRequirement} /> : null}
      </section>

      {p.agreedAmountCents ? <section><h3>Pagamento</h3>
        <Line label="Valor combinado" value={money(p.agreedAmountCents)} />
        {s ? <>
          {s.late ? <Line label={`Fora do prazo (−${s.penaltyPercent}%)`} value={`− ${money(s.discountCents)}`} tone="neg" /> : null}
          <Line label={contractor ? "A pagar" : "A receber"} value={money(s.finalCents)} />
          <Line label="Situação" value={pay?.status === "settled" ? `Liquidado em ${fmtDay(pay.settledAtMs)}` : pay?.status === "paid" ? "Pago · aguarda confirmação" : contractor ? "A pagar" : "A receber"} />
        </> : <Line label="Fora do prazo" value={`${money(Math.round(p.agreedAmountCents * (100 - LATE_PENALTY_PERCENT) / 100))} (−${LATE_PENALTY_PERCENT}%)`} />}
      </section> : null}

      {p.conditions ? <section><h3>Condições</h3><p className="b2p-info-text">{p.conditions}</p></section> : null}
      {p.startPhotoUrl ? <img className="b2p-info-photo" src={p.startPhotoUrl} alt="Foto do veículo no início da operação" loading="lazy" /> : null}

      <div className="nvu-op-sheet-actions">
        {p.progress > 0 || p.status === "completed" ? <button type="button" className="nvu-op-sheet-action" onClick={() => { onClose(); onResults(); }}><BarChart3 className="nvu-op-sheet-action-icon" size={26} strokeWidth={1.7} aria-hidden="true" /><span>Resultados</span><span className="nvu-op-sheet-arrow"><ArrowRight size={22} strokeWidth={1.8} /></span></button> : null}
        {contractor && ["completed", "declined", "cancelled"].includes(p.status) ? <button type="button" className="nvu-op-sheet-action" onClick={() => { onClose(); onRepeat(); }}><Repeat className="nvu-op-sheet-action-icon" size={26} strokeWidth={1.7} aria-hidden="true" /><span>Repetir oferta</span><span className="nvu-op-sheet-arrow"><ArrowRight size={22} strokeWidth={1.8} /></span></button> : null}
      </div>
    </div>
  </ManagementDialog>;
}
