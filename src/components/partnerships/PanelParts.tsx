import React from "react";
import { ArrowDownLeft, ArrowUpRight, Check, ChevronRight, Clock, Container, FileText, Info, Truck } from "lucide-react";
import {
  formatDays, formatMoney, paceOf, remainingText, resultsOf, roleIn, WALLET_STATUS_LABEL, type Partnership, type WalletEntry, type WalletTotals, shortName } from "../../lib/partnerships";
import { Avatar, fmtDay, fmtDayTime } from "./shared";

const otherOf = (p: Partnership, me: string) => roleIn(p, me) === "contractor" ? { name: shortName(p.executorName), id: p.executorCompanyId } : { name: shortName(p.contractorName), id: p.contractorCompanyId };

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
export function OperationCard({ p, me, now, onOpen, onInfo }: { p: Partnership; me: string; now: number; onOpen?: () => void; onInfo?: () => void }) {
  const other = otherOf(p, me), pace = paceOf(p, now), pct = p.totalTrips ? Math.min(100, Math.round(p.progress / p.totalTrips * 100)) : 0;
  const remaining = remainingText(p.deadlineMs, now), late = pace.tone === "late" && pace.label === "Prazo vencido";
  return <article className="nvu-central-operation">
    <div className="nvu-central-driver-row">
      <button type="button" className="nvu-central-driver" onClick={onOpen} disabled={!onOpen} aria-label={`Abrir ${p.operationName}`}>
        <Avatar name={p.driverName || other.name} companyId={p.driverName ? undefined : other.id} driverId={p.driverName ? p.driverId || undefined : undefined} />
        <strong>{p.driverName || other.name}<span className="b2p-sub">{other.name}</span></strong>
      </button>
      <span className="nvu-central-job-status" data-state={late ? "overdue" : p.status === "accepted" || p.status === "pending" ? "pending" : "active"}><i aria-hidden="true" />{late ? "Atrasada" : p.status === "completed" ? "Concluída" : p.status === "accepted" ? "Aguardando início" : p.status === "pending" ? "Aguardando resposta" : "Em andamento"}</span>
      {onOpen ? <button type="button" className="nvu-central-operation-toggle" onClick={onOpen} aria-label="Abrir detalhes"><ChevronRight size={20} aria-hidden="true" /></button> : null}
    </div>
    <div className="nvu-central-vehicle-line">
      <span className="b2p-ico"><Truck size={20} aria-hidden="true" /></span>
      <div className="nvu-central-vehicle-name"><strong>{p.vehicleName || "Veículo a definir"}</strong>{p.trailerName || p.trailerRequirement ? <small>{p.trailerName || p.trailerRequirement}</small> : null}</div>
      {onInfo ? <button type="button" className="nvu-central-operation-info" onClick={onInfo} aria-label="Informações da operação"><Info size={18} strokeWidth={1.8} aria-hidden="true" /></button> : null}
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
    <p className="b2p-foot">Contratado por <b>{shortName(p.contractorName)}</b></p>
  </article>;
}

/** "há 5 min", "há 3 h", "ontem", "há 4 dias" (mais antigo: dia/mês). */
export function agoText(ms: number, now: number): string {
  if (!ms) return "";
  const diff = Math.max(0, now - ms), min = Math.floor(diff / 60000), hours = Math.floor(diff / 3600000), days = Math.floor(diff / 86400000);
  if (min < 1) return "agora"; if (min < 60) return `há ${min} min`; if (hours < 24) return `há ${hours} h`; if (days === 1) return "ontem"; if (days < 7) return `há ${days} dias`;
  return fmtDay(ms);
}

/** Oferta como linha de lista (no desenho das listas de opções da Central): logo, operação, empresa e três dados alinhados; toque abre os detalhes. */
export function OfferRow({ p, me, now, onOpen }: { p: Partnership; me: string; now: number; onOpen: () => void }) {
  const role = roleIn(p, me), other = otherOf(p, me), received = role === "executor";
  const needsDriver = received && p.status === "accepted" && !p.jobId;
  const status = p.status === "pending" ? { text: received ? "Responder" : "Aguardando", tone: "warn" } : needsDriver ? { text: "Designar", tone: "warn" }
    : p.status === "accepted" ? { text: "Aceita", tone: "good" } : p.status === "declined" ? { text: "Recusada", tone: "muted" } : p.status === "cancelled" ? { text: "Cancelada", tone: "muted" } : { text: "Em andamento", tone: "good" };
  const facts = [`${p.totalTrips} ${p.totalTrips === 1 ? "viagem" : "viagens"}`, p.durationDays ? formatDays(p.durationDays) : "", p.agreedAmountCents ? formatMoney(p.agreedAmountCents, p.currency) : ""].filter(Boolean);
  return <button type="button" className="b2p-row" onClick={onOpen} aria-label={`${p.operationName}, ${other.name}, ${status.text}`}>
    <Avatar name={other.name} companyId={other.id} size={44} />
    <span className="b2p-row-head"><strong className="b2p-row-title">{p.operationName}</strong>
      <span className="b2p-pill b2p-row-status" data-tone={status.tone}><i aria-hidden="true" />{status.text}</span></span>
    <span className="b2p-row-sub">{other.name} · {received ? "recebida" : "enviada"} {agoText(p.createdAtMs, now)}</span>
    <span className="b2p-row-facts">{facts.map((fact, index) => <span key={index}>{fact}</span>)}</span>
    <ChevronRight className="b2p-row-chev" size={18} aria-hidden="true" />
  </button>;
}

/** Linha do histórico (concluída, recusada ou cancelada). */
export function HistoryRow({ p, me, onOpen }: { p: Partnership; me: string; onOpen: () => void }) {
  const other = otherOf(p, me), results = resultsOf(p);
  const label = p.status === "completed" ? "Concluída" : p.status === "declined" ? "Recusada" : "Cancelada";
  return <button type="button" className="b2p-wrow" onClick={onOpen} aria-label={`Abrir ${p.operationName}`}>
    <span className="b2p-wico" data-k={p.status === "completed" ? "ganho" : "investimento"} style={p.status === "completed" ? undefined : { background: "var(--central-soft)", color: "var(--central-muted)" }}>{p.status === "completed" ? <Check size={17} aria-hidden="true" /> : <FileText size={17} aria-hidden="true" />}</span>
    <div><b>{p.operationName}</b><small>{other.name} · {fmtDay(p.updatedAtMs)}</small></div>
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
