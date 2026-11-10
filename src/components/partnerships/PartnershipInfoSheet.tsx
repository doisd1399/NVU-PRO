import React from "react";
import { BarChart3, Repeat } from "lucide-react";
import { useSessionStore } from "../../context/AppContext";
import { StableImage } from "../common/StableImage";
import { ManagementDialog } from "../admin/management/ManagementDialog";
import { formatDays, formatMoney, remainingText, roleIn, shortName, type Partnership } from "../../lib/partnerships";
import "../admin/management/OperationInfoSheet.css";

const toneOf = (p: Partnership, late: boolean) => p.status === "cancelled" ? "cancelled" : p.status === "completed" ? "done" : late ? "overdue" : p.status === "accepted" || p.status === "pending" ? "pending" : "active";
const LABEL: Record<string, string> = { active: "Em andamento", pending: "Não iniciado", overdue: "Atrasado", done: "Concluído", cancelled: "Cancelado" };

/**
 * "Informações da operação" da parceria: o MESMO desenho da folha da Central e do painel do motorista (motorista, operação e situação,
 * lista compacta e ações). O acordo (valor e pagamento) entra como linhas extras da própria lista.
 */
export function PartnershipInfoSheet({ p, me, driverPhoto, onResults, onRepeat, onClose }: { p: Partnership; me: string; driverPhoto?: string; onResults: () => void; onRepeat: () => void; onClose: () => void }) {
  const { currentUser } = useSessionStore();
  const now = Date.now(), contractor = roleIn(p, me) === "contractor", s = p.settlement, pay = p.payment;
  const late = !["completed", "cancelled", "declined"].includes(p.status) && Boolean(p.deadlineMs) && p.deadlineMs <= now;
  const tone = toneOf(p, late), money = (cents: number) => formatMoney(cents, p.currency);
  const percent = p.totalTrips ? Math.min(100, Math.round(p.progress / p.totalTrips * 100)) : 0;
  const person = p.driverName || "Motorista a designar", other = contractor ? `Executada por ${shortName(p.executorName)}` : `Contratada por ${shortName(p.contractorName)}`;
  const time = tone === "done" ? (s ? (s.late ? "Fora do prazo" : "No prazo") : "Operação encerrada") : tone === "cancelled" ? "Operação cancelada" : p.deadlineMs ? (remainingText(p.deadlineMs, now) || "Prazo vencido") : p.durationDays ? `${formatDays(p.durationDays)} após o aceite` : "Não definido";
  return <ManagementDialog title="Informações da operação" variant="sheet" onClose={onClose}>
    <div className="nvu-op-sheet-body" data-testid="partnership-info-sheet">
      <div className="nvu-op-sheet-driver">
        <StableImage src={driverPhoto} persistentViewerId={currentUser?.id} persistentAssetId={p.driverId ? `partnership-driver:${p.driverId}` : undefined} alt={`Foto de ${person}`}
          wrapperClassName="nvu-op-sheet-photo" className="object-cover" referrerPolicy="no-referrer" fallback={<span>{person.slice(0, 2).toUpperCase()}</span>} />
        <div><strong>{person}</strong><span>{other}</span></div>
      </div>
      <div className="nvu-op-sheet-operation">
        <strong>{p.operationName}</strong>
        <span className="nvu-op-sheet-status" data-tone={tone}><i aria-hidden="true" />{LABEL[tone]}</span>
      </div>
      <dl className="nvu-op-sheet-list">
        <div><dt>Veículo</dt><dd>{p.vehicleName ? `${p.vehicleName}${p.vehiclePlate ? ` · ${p.vehiclePlate}` : ""}` : "A definir"}</dd></div>
        {p.trailerName || p.trailerRequirement ? <div><dt>Reboque</dt><dd className="nvu-op-sheet-trailer">{p.trailerName || p.trailerRequirement}</dd></div> : null}
        <div><dt>Entregas</dt><dd>{p.progress} de {p.totalTrips} entregas<small>{Math.max(0, p.totalTrips - p.progress)} restantes · {percent}%</small></dd></div>
        <div><dt>Prazo</dt><dd>{p.deadlineMs ? new Date(p.deadlineMs).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : p.durationDays ? formatDays(p.durationDays) : "Não definido"}</dd></div>
        <div><dt>{tone === "done" || tone === "cancelled" ? "Situação" : "Restante"}</dt><dd data-warning={late || undefined}>{time}</dd></div>
        {p.agreedAmountCents ? <div><dt>Valor do acordo</dt><dd>{money(p.agreedAmountCents)}</dd></div> : null}
        {s ? <div><dt>{contractor ? "A pagar" : "A receber"}</dt><dd data-warning={s.late || undefined}>{money(s.finalCents)}<small>{s.late ? `−${s.penaltyPercent}% fora do prazo · ` : ""}{pay?.status === "settled" ? "Liquidado" : pay?.status === "paid" ? "Pago · aguarda confirmação" : contractor ? "A pagar" : "A receber"}</small></dd></div> : null}
      </dl>
      <div className="nvu-central-progress nvu-op-sheet-bar" role="progressbar" aria-label="Progresso da operação" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${percent}%` }} /></div>
      {p.conditions ? <p className="nvu-op-sheet-note b2p-cond" role="note">{p.conditions}</p> : null}
      <div className="nvu-op-sheet-actions">
        {p.progress > 0 || p.status === "completed" ? <button type="button" className="nvu-op-sheet-action" data-action="results" onClick={() => { onClose(); onResults(); }}><BarChart3 className="nvu-op-sheet-action-icon" size={20} strokeWidth={1.7} aria-hidden="true" /><span>Resultados</span></button> : null}
        {contractor && ["completed", "declined", "cancelled"].includes(p.status) ? <button type="button" className="nvu-op-sheet-action" data-action="repeat" onClick={() => { onClose(); onRepeat(); }}><Repeat className="nvu-op-sheet-action-icon" size={20} strokeWidth={1.7} aria-hidden="true" /><span>Repetir oferta</span></button> : null}
      </div>
    </div>
  </ManagementDialog>;
}
