import React from "react";
import { ArrowDownLeft, ArrowUpRight, Check, ChevronRight, Clock, FileText, Truck } from "lucide-react";
import {
  formatDays, formatMoney, paceOf, remainingText, resultsOf, roleIn, WALLET_STATUS_LABEL, type Partnership, type WalletEntry, type WalletTotals,
} from "../../lib/partnerships";
import { Avatar, fmtDay, fmtDayTime } from "./shared";

const otherOf = (p: Partnership, me: string) => roleIn(p, me) === "contractor" ? { name: p.executorName, id: p.executorCompanyId } : { name: p.contractorName, id: p.contractorCompanyId };
const roleText = (p: Partnership, me: string) => roleIn(p, me) === "contractor" ? "Você contratou" : "Você executa";

/** Resumo das parcerias: a receber e a pagar (valores calculados pelo app) e a contagem do que está em andamento. */
export function SummaryBody({ totals, active, toAnswer, done }: { totals: WalletTotals; active: number; toAnswer: number; done: number }) {
  return <>
    <div className="b2p-sum">
      <div><small>A receber</small><b data-tone={totals.toReceiveCents ? "pos" : undefined}>{formatMoney(totals.toReceiveCents)}</b><em>{totals.forecastGainCents ? `+ ${formatMoney(totals.forecastGainCents)} previsto` : "ganhos em parcerias"}</em></div>
      <div><small>A pagar</small><b data-tone={totals.toPayCents ? "warn" : undefined}>{formatMoney(totals.toPayCents)}</b><em>{totals.forecastInvestCents ? `+ ${formatMoney(totals.forecastInvestCents)} previsto` : "investimento em parcerias"}</em></div>
    </div>
    <div className="b2p-facts"><div><b>{active}</b><span>Em andamento</span></div><div><b data-warn={toAnswer ? "1" : "0"}>{toAnswer}</b><span>Para responder</span></div><div><b>{done}</b><span>Concluídas</span></div></div>
  </>;
}

/** Operação em andamento (mesmo desenho de "Trabalhos ativos" da Central). */
export function OperationCard({ p, me, now, onOpen }: { p: Partnership; me: string; now: number; onOpen: () => void }) {
  const other = otherOf(p, me), pace = paceOf(p, now), pct = p.totalTrips ? Math.min(100, Math.round(p.progress / p.totalTrips * 100)) : 0;
  const remaining = remainingText(p.deadlineMs, now), late = pace.tone === "late" && pace.label === "Prazo vencido";
  return <article className="nvu-central-operation">
    <div className="nvu-central-driver-row">
      <button type="button" className="nvu-central-driver" onClick={onOpen} aria-label={`Abrir ${p.operationName}`}>
        <Avatar name={p.driverName || other.name} companyId={p.driverName ? undefined : other.id} />
        <strong>{p.driverName || other.name}<span className="b2p-sub">{other.name} · {roleText(p, me)}</span></strong>
      </button>
      <span className="nvu-central-job-status" data-state={late ? "overdue" : p.status === "accepted" ? "pending" : "active"}><i aria-hidden="true" />{late ? "Atrasada" : p.status === "accepted" ? "Aguardando início" : "Em andamento"}</span>
      <button type="button" className="nvu-central-operation-toggle" onClick={onOpen} aria-label="Abrir detalhes"><ChevronRight size={20} aria-hidden="true" /></button>
    </div>
    <div className="nvu-central-vehicle-line">
      <span className="b2p-ico"><Truck size={20} aria-hidden="true" /></span>
      <div className="nvu-central-vehicle-name"><strong>{p.vehicleName || "Veículo a definir"}</strong>{p.trailerName || p.trailerRequirement ? <small>{p.trailerName || p.trailerRequirement}</small> : null}</div>
      <span className="nvu-central-operation-name" title={p.operationName}>{p.operationName}</span>
    </div>
    <div className="nvu-central-operation-stats">
      <div className="nvu-central-operation-metrics">
        <div><strong>{p.progress}/{p.totalTrips}</strong><span>Viagens</span></div>
        <div><strong>{Math.max(0, p.totalTrips - p.progress)}</strong><span>Restantes</span></div>
        <div><strong>{pct}%</strong><span>Concluído</span></div>
      </div>
      <div className="nvu-central-progress" role="progressbar" aria-label={`Progresso de ${p.operationName}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ width: `${pct}%` }} /></div>
    </div>
    {remaining ? <p className="nvu-central-operation-timing"><Clock size={16} strokeWidth={1.8} aria-hidden="true" /><span>Prazo restante:</span><strong data-warning={late || undefined}>{remaining}</strong></p> : null}
    <p className="b2p-foot">Pontuação para <b>{p.contractorName}</b>{p.agreedAmountCents ? <> · Valor do acordo <b>{formatMoney(p.agreedAmountCents, p.currency)}</b></> : null}</p>
  </article>;
}

/** Oferta recebida/enviada: quem, qual operação e as condições (viagens, prazo em dias, valor). */
export function OfferCard({ p, me, busy, onOpen, onDecline, onCancel }: { p: Partnership; me: string; busy: boolean; onOpen: () => void; onDecline?: () => void; onCancel?: () => void }) {
  const role = roleIn(p, me), other = otherOf(p, me), received = role === "executor";
  const status = p.status === "pending" ? { text: received ? "Aguardando você" : "Aguardando resposta", tone: "warn" } : p.status === "accepted" ? { text: "Aceita", tone: "good" } : p.status === "declined" ? { text: "Recusada", tone: "muted" } : p.status === "cancelled" ? { text: "Cancelada", tone: "muted" } : { text: "Em andamento", tone: "good" };
  const needsDriver = received && p.status === "accepted" && !p.jobId;
  return <article className="nvu-central-operation">
    <div className="nvu-central-driver-row">
      <span className="nvu-central-driver"><Avatar name={other.name} companyId={other.id} /><strong>{other.name}<span className="b2p-sub">{received ? "enviou a oferta" : "recebeu a oferta"} · {fmtDayTime(p.createdAtMs)}</span></strong></span>
      <span className="b2p-pill" data-tone={status.tone}><i aria-hidden="true" />{status.text}</span>
    </div>
    <div className="b2p-op-row"><span className="b2p-ico"><FileText size={20} aria-hidden="true" /></span>
      <div><b>{p.operationName}</b><small>{p.trailerRequirement ? `Reboque ${p.trailerRequirement}` : "Sem exigência de reboque"}</small></div></div>
    <div className="nvu-central-operation-stats"><div className="nvu-central-operation-metrics">
      <div><strong>{p.totalTrips}</strong><span>Viagens</span></div>
      <div><strong>{p.durationDays ? formatDays(p.durationDays) : "—"}</strong><span>Prazo</span></div>
      <div><strong>{p.agreedAmountCents ? formatMoney(p.agreedAmountCents, p.currency) : "—"}</strong><span>Valor</span></div>
    </div></div>
    <p className="b2p-foot">Pontua para <b>{p.contractorName}</b>{p.status === "pending" && p.durationDays ? " · prazo conta a partir do aceite" : ""}</p>
    <div className="b2p-actions">
      {p.status === "pending" && received ? <><button type="button" className="b2p-btn" data-v="primary" onClick={onOpen}>Analisar</button><button type="button" className="b2p-btn" data-v="text" disabled={busy} onClick={onDecline}>Recusar</button></> : null}
      {needsDriver ? <button type="button" className="b2p-btn" data-v="primary" onClick={onOpen}>Designar trabalho</button> : null}
      {!received && p.status === "pending" ? <><button type="button" className="b2p-btn" data-v="ghost" onClick={onOpen}>Detalhes</button><button type="button" className="b2p-btn" data-v="danger" disabled={busy} onClick={onCancel}>Cancelar oferta</button></> : null}
      {!(p.status === "pending") && !needsDriver ? <button type="button" className="b2p-btn" data-v="ghost" onClick={onOpen}>Detalhes</button> : null}
    </div>
  </article>;
}

/** Linha do histórico (concluída, recusada ou cancelada). */
export function HistoryRow({ p, me, onOpen }: { p: Partnership; me: string; onOpen: () => void }) {
  const other = otherOf(p, me), results = resultsOf(p);
  const label = p.status === "completed" ? "Concluída" : p.status === "declined" ? "Recusada" : "Cancelada";
  return <button type="button" className="b2p-wrow" onClick={onOpen} aria-label={`Abrir ${p.operationName}`}>
    <span className="b2p-wico" data-k={p.status === "completed" ? "ganho" : "investimento"} style={p.status === "completed" ? undefined : { background: "var(--central-soft)", color: "var(--central-muted)" }}>{p.status === "completed" ? <Check size={17} aria-hidden="true" /> : <FileText size={17} aria-hidden="true" />}</span>
    <div><b>{p.operationName}</b><small>{other.name} · {roleText(p, me)} · {fmtDay(p.updatedAtMs)}</small></div>
    <span className="b2p-amt"><strong data-k="x">{p.status === "completed" ? `${p.progress}/${p.totalTrips}` : label}</strong><span>{p.status === "completed" ? (p.settlement ? formatMoney(p.settlement.finalCents, p.currency) : formatMoney(results.earningsCents, p.currency)) : "—"}</span></span>
  </button>;
}

/** Movimento da carteira: ganho (recebe) ou investimento (paga), com status e, se houve atraso, o desconto de 25%. */
export function WalletRow({ e, busy, onAction, actionLabel }: { e: WalletEntry; busy: boolean; onAction?: () => void; actionLabel?: string }) {
  const gain = e.kind === "ganho";
  return <>
    <div className="b2p-wrow">
      <span className="b2p-wico" data-k={e.kind}>{gain ? <ArrowDownLeft size={18} aria-hidden="true" /> : <ArrowUpRight size={18} aria-hidden="true" />}</span>
      <div><b>{e.title}</b><small>{e.counterpart} · {gain ? "Ganho" : "Investimento"} · {fmtDay(e.atMs)}</small>
        {e.late ? <small style={{ color: "var(--central-warning)" }}>Fora do prazo: −25% ({formatMoney(e.discountCents, e.currency)}) sobre {formatMoney(e.agreedCents, e.currency)}</small> : null}</div>
      <span className="b2p-amt"><strong data-k={e.kind}>{gain ? "+ " : "− "}{formatMoney(e.amountCents, e.currency)}</strong><span>{WALLET_STATUS_LABEL[e.status]}</span></span>
    </div>
    {onAction ? <div className="b2p-wactions"><button type="button" className="b2p-btn" data-v="primary" data-size="sm" disabled={busy} onClick={onAction}>{actionLabel}</button></div> : null}
  </>;
}
