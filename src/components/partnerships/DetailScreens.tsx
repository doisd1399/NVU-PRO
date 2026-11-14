import { ReceiptAttach, ProofLine, type ReceiptProofInput } from "../rewards/ReceiptAttach";
import { PROOF_LABEL } from "../../lib/rewardPayments";
import React from "react";
import { ArrowRight } from "lucide-react";
import { formatDays, formatMoney, LATE_PENALTY_PERCENT, remainingText, resultsOf, roleIn, type Partnership, type PixType, shortName } from "../../lib/partnerships";
import { Avatar, BackLink, fmtDateTime } from "./shared";
import { PartnershipOperationCard } from "./PanelParts";
import { PixSection } from "./PixSection";

const Row = ({ label, value, strong, neg }: { label: string; value: React.ReactNode; strong?: boolean; neg?: boolean }) =>
  <div data-total={strong ? "1" : undefined} data-neg={neg ? "1" : undefined}><span>{label}</span><b>{value}</b></div>;

/** Oferta recebida (executora): detalhes do que foi pedido e, abaixo, Aceitar / Recusar. Sem veículo: a escolha é dela. */
export function OfferDetail({ p, busy, notReady, onBack, onAccept, onDecline, onPrepare }: { p: Partnership; busy: boolean; notReady?: boolean; onBack: () => void; onAccept: () => void; onDecline: () => void; onPrepare?: () => void }) {
  const open = p.status === "pending";
  return <>
    <BackLink label="Parcerias" onClick={onBack} />
    <section className="nvu-central-section b2p-sec"><div className="b2p-form">
      <div className="nvu-central-driver-row"><span className="nvu-central-driver"><Avatar name={shortName(p.contractorName)} companyId={p.contractorCompanyId} /><strong>{shortName(p.contractorName)}<span className="b2p-sub">enviada em {fmtDateTime(p.createdAtMs)}</span></strong></span></div>
      <div className="b2p-settle">
        <Row label="Operação" value={p.operationName} />
        <Row label="Viagens" value={p.totalTrips} />
        <Row label="Prazo" value={p.durationDays ? `${formatDays(p.durationDays)} após aceitar` : "—"} />
        <Row label="Reboque" value={p.trailerRequirement || "Sem exigência"} />
        <Row label="Valor do acordo" value={p.agreedAmountCents ? formatMoney(p.agreedAmountCents, p.currency) : "Não informado"} />
        {p.goalAmountCents ? <Row label="Meta de ganhos" value={formatMoney(p.goalAmountCents, p.currency)} /> : null}
      </div>
      {p.goalAmountCents ? <p className="b2p-note-box" data-tone="warn" role="note"><b>Meta de ganhos:</b> a operação só é paga se os ganhos das viagens chegarem a {formatMoney(p.goalAmountCents, p.currency)}. Concluindo abaixo da meta, <b>não há pagamento</b> pelo trabalho.</p> : null}
      {p.agreedAmountCents ? <p className="b2p-note-box" data-tone="warn">Concluindo fora do prazo, o valor final é <b>{formatMoney(Math.round(p.agreedAmountCents * (100 - LATE_PENALTY_PERCENT) / 100), p.currency)}</b> (−{LATE_PENALTY_PERCENT}%), calculado pelo app.</p> : null}
      {p.conditions ? <div className="b2p-field"><span className="b2p-label">Condições do acordo</span><p className="b2p-note-box">{p.conditions}</p></div> : null}
      <p className="b2p-note-box">Após aceitar, você escolhe o <b>motorista</b> da sua equipe e o <b>veículo</b> da sua frota. A pontuação do ranking vai para {shortName(p.contractorName)}, e o motorista mantém o histórico dele.</p>
      {open && notReady ? <div className="b2p-note-box" data-tone="warn" role="alert">
        <b>Falta um passo para aceitar.</b> Sua empresa ainda não usa a confirmação operacional, que as parcerias exigem. Toque em <b>Preparar e aceitar</b>: o app liga esse recurso (se não houver trabalhos simultâneos em conflito) e aceita a oferta em seguida.</div> : null}
      {open ? <div className="b2p-actions">
        {notReady && onPrepare ? <button type="button" className="b2p-btn" data-v="primary" disabled={busy} onClick={onPrepare}>{busy ? "Aguarde…" : "Preparar e aceitar"}</button>
          : <button type="button" className="b2p-btn" data-v="primary" disabled={busy} onClick={onAccept}>{busy ? "Aguarde…" : "Aceitar"}</button>}
        <button type="button" className="b2p-btn" data-v="ghost" disabled={busy} onClick={onDecline}>Recusar</button>
      </div> : <p className="b2p-hint">Esta oferta já foi respondida.</p>}
    </div></section>
  </>;
}

/** Detalhe da parceria: o card da operação e, abaixo, um resumo curto em lista (ganhos, duração, valor, pagamento). O resto fica em "Informações da operação" (ⓘ). */
export function Detail({ p, me, now, busy, onBack, onDesignate, onCancel, onPay, onInfo, company, onDriver, onSavePix }: {
  p: Partnership; me: string; now: number; busy: boolean; onBack: () => void; onDesignate: () => void; onCancel: () => void; onPay: (action: "paid" | "received", proof?: ReceiptProofInput) => Promise<unknown> | void; onInfo: () => void;
  company: { name: string; simulator: string }; onDriver?: () => void; onSavePix: (type: PixType, key: string) => Promise<void>;
}) {
  const role = roleIn(p, me), s = p.settlement, pay = p.payment, r = resultsOf(p);
  const needsDriver = role === "executor" && p.status === "accepted" && !p.jobId;
  const money = (cents: number) => formatMoney(cents, p.currency);
  const duration = p.status === "completed" ? (s ? (s.late ? "Fora do prazo" : "No prazo") : "Concluída") : p.deadlineMs ? `${formatDays(p.durationDays)} · restam ${remainingText(p.deadlineMs, now) || "—"}` : p.durationDays ? `${formatDays(p.durationDays)} após o aceite` : "—";
  const payment = s && pay && !s.goalMissed ? (pay.status === "settled" ? "Liquidado" : pay.status === "paid" ? "Pago · aguarda confirmação" : role === "contractor" ? "A pagar" : "A receber") : "";
  const rows: [string, React.ReactNode][] = [
    ["Ganhos nas viagens", r.earningsCents ? money(r.earningsCents) : "—"],
    ["Duração", duration],
    ["Valor do acordo", p.agreedAmountCents ? money(p.agreedAmountCents) : "Não informado"],
  ];
  if (s?.goalMissed) rows.push(["Meta de ganhos", <>{money(s.earningsCents || r.earningsCents)} de {money(s.goalCents || 0)}</>], ["Pagamento", "Sem pagamento · meta não atingida"]);
  else if (s) rows.push([role === "contractor" ? "A pagar" : "A receber", <>{money(s.finalCents)}{s.late ? <small> −{s.penaltyPercent}%</small> : null}</>], ["Pagamento", payment]);
  return <>
    <BackLink label="Parcerias" onClick={onBack} />
    <PartnershipOperationCard p={p} me={me} now={now} company={company} onInfo={onInfo} onDriver={onDriver} />
    <section className="b2p-summary" aria-label="Resumo da operação">
      {rows.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}
      <button type="button" className="b2p-summary-more" onClick={onInfo}>Mais informações da operação<ArrowRight size={18} aria-hidden="true" /></button>
    </section>
    {s?.goalMissed ? <p className="b2p-alert" role="alert"><b>Meta não atingida.</b> A operação foi concluída, mas os ganhos das viagens ({money(s.earningsCents || r.earningsCents)}) ficaram abaixo da meta ({money(s.goalCents || 0)}). Sem a meta, <b>não há pagamento</b> pelo trabalho.</p> : null}
    <PixSection p={p} me={me} busy={busy} onSave={onSavePix} />
    {role === "contractor" && s && pay?.status === "pending" ? <section className="nvu-central-section b2p-sec"><div className="b2p-form">
      <ReceiptAttach scope="partnership-receipt" refId={p.id} expectedCents={s.finalCents} busy={busy} onConfirm={async proof => { await onPay("paid", proof); }} /></div></section> : null}
    {pay?.proof ? <ProofLine proof={pay.proof} label={`${PROOF_LABEL[pay.proof.check]}.`} /> : null}
    {(needsDriver || (role === "executor" && pay && pay.status !== "settled") || (role === "contractor" && p.status === "pending")) ? <div className="b2p-actions b2p-detail-actions">
      {needsDriver ? <button type="button" className="b2p-btn" data-v="primary" onClick={onDesignate}>Designar trabalho</button> : null}
      {role === "executor" && pay && pay.status !== "settled" ? <button type="button" className="b2p-btn" data-v="primary" disabled={busy} onClick={() => onPay("received")}>Confirmar recebimento</button> : null}
      {role === "contractor" && p.status === "pending" ? <button type="button" className="b2p-btn" data-v="danger" disabled={busy} onClick={onCancel}>Cancelar oferta</button> : null}
    </div> : null}
  </>;
}

/** Resultados da parceria (ganhos por viagem, meta, média e melhor viagem). */
export function Results({ p, me, onBack }: { p: Partnership; me: string; onBack: () => void }) {
  const r = resultsOf(p), r1 = 2 * Math.PI * 38;
  return <>
    <BackLink label="Detalhes" onClick={onBack} />
    <section className="nvu-central-section b2p-sec"><div className="b2p-form">
      <p className="b2p-hint">{p.operationName} · {shortName(roleIn(p, me) === "contractor" ? p.executorName : p.contractorName)}</p>
      <div className="b2p-gauge">
        <svg width="96" height="96" viewBox="0 0 96 96" role="img" aria-label={`Meta ${r.goalPercent ?? 0}%`}><circle className="b2p-g-bg" cx="48" cy="48" r="38" />
          <circle className="b2p-g-fg" cx="48" cy="48" r="38" strokeDasharray={r1} strokeDashoffset={r1 * (1 - Math.min(100, r.goalPercent ?? Math.round(r.trips / Math.max(1, r.totalTrips) * 100)) / 100)} transform="rotate(-90 48 48)" />
          <text x="48" y="55" textAnchor="middle">{r.goalPercent ?? Math.round(r.trips / Math.max(1, r.totalTrips) * 100)}%</text></svg>
        <div><b>{formatMoney(r.earningsCents, p.currency)}</b><span className="b2p-hint">{r.goalPercent !== null ? `da meta de ${formatMoney(p.goalAmountCents || 0, p.currency)}` : `${r.trips}/${r.totalTrips} viagens`}</span></div>
      </div>
      <div className="b2p-settle">
        <Row label="Ganho em viagens" value={formatMoney(r.earningsCents, p.currency)} />
        <Row label="Média por viagem" value={formatMoney(r.averageCents, p.currency)} />
        <Row label="Melhor viagem" value={r.bestCents ? `${formatMoney(r.bestCents, p.currency)}${r.bestN ? ` (nº ${r.bestN})` : ""}` : "—"} />
      </div>
      {r.bars.length ? <div className="b2p-bars" aria-label="Ganho por viagem">{r.bars.map(bar => <i key={bar.n} data-best={bar.cents === r.bestCents ? "1" : "0"} style={{ height: `${bar.height}%` }} title={`Viagem ${bar.n}: ${formatMoney(bar.cents, p.currency)}`} />)}</div> : null}
      {p.ledger.length ? <div className="b2p-ledger">{p.ledger.map(entry => <div key={entry.n}><i>{entry.n}</i><span>{fmtDateTime(entry.at)}</span><em>{formatMoney(entry.cents, p.currency)}</em></div>)}</div> : null}
    </div></section>
  </>;
}
