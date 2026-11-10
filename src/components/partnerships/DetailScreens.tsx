import React from "react";
import { formatDays, formatMoney, LATE_PENALTY_PERCENT, paceOf, remainingText, resultsOf, roleIn, type Partnership } from "../../lib/partnerships";
import { Avatar, BackLink, fmtDateTime, fmtDay } from "./shared";
import { OperationCard } from "./PanelParts";

const Row = ({ label, value, strong, neg }: { label: string; value: React.ReactNode; strong?: boolean; neg?: boolean }) =>
  <div data-total={strong ? "1" : undefined} data-neg={neg ? "1" : undefined}><span>{label}</span><b>{value}</b></div>;

/** Oferta recebida (executora): detalhes do que foi pedido e, abaixo, Aceitar / Recusar. Sem veículo: a escolha é dela. */
export function OfferDetail({ p, busy, onBack, onAccept, onDecline }: { p: Partnership; busy: boolean; onBack: () => void; onAccept: () => void; onDecline: () => void }) {
  const open = p.status === "pending";
  return <>
    <BackLink label="Parcerias" onClick={onBack} />
    <section className="nvu-central-section b2p-sec"><div className="b2p-form">
      <h2>Oferta recebida</h2>
      <div className="nvu-central-driver-row"><span className="nvu-central-driver"><Avatar name={p.contractorName} companyId={p.contractorCompanyId} /><strong>{p.contractorName}<span className="b2p-sub">enviada em {fmtDateTime(p.createdAtMs)}</span></strong></span></div>
      <div className="b2p-settle">
        <Row label="Operação" value={p.operationName} />
        <Row label="Viagens" value={p.totalTrips} />
        <Row label="Prazo" value={p.durationDays ? `${formatDays(p.durationDays)} após aceitar` : "—"} />
        <Row label="Reboque" value={p.trailerRequirement || "Sem exigência"} />
        <Row label="Valor do acordo" value={p.agreedAmountCents ? formatMoney(p.agreedAmountCents, p.currency) : "Não informado"} />
        {p.goalAmountCents ? <Row label="Meta de ganhos" value={formatMoney(p.goalAmountCents, p.currency)} /> : null}
      </div>
      {p.agreedAmountCents ? <p className="b2p-note-box" data-tone="warn">Concluindo fora do prazo, o valor final é <b>{formatMoney(Math.round(p.agreedAmountCents * (100 - LATE_PENALTY_PERCENT) / 100), p.currency)}</b> (−{LATE_PENALTY_PERCENT}%), calculado pelo app.</p> : null}
      {p.conditions ? <div className="b2p-field"><span className="b2p-label">Condições do acordo</span><p className="b2p-note-box">{p.conditions}</p></div> : null}
      <p className="b2p-note-box">Após aceitar, você escolhe o <b>motorista</b> da sua equipe e o <b>veículo</b> da sua frota. A pontuação do ranking vai para {p.contractorName}, e o motorista mantém o histórico dele.</p>
      {open ? <div className="b2p-actions">
        <button type="button" className="b2p-btn" data-v="primary" disabled={busy} onClick={onAccept}>{busy ? "Aguarde…" : "Aceitar"}</button>
        <button type="button" className="b2p-btn" data-v="ghost" disabled={busy} onClick={onDecline}>Recusar</button>
      </div> : <p className="b2p-hint">Esta oferta já foi respondida.</p>}
    </div></section>
  </>;
}

/** Detalhe da parceria: operação (card da Central), acordo/liquidação e ações conforme o papel. */
export function Detail({ p, me, now, busy, onBack, onResults, onDesignate, onCancel, onRepeat, onPay }: {
  p: Partnership; me: string; now: number; busy: boolean; onBack: () => void; onResults: () => void; onDesignate: () => void; onCancel: () => void; onRepeat: () => void; onPay: (action: "paid" | "received") => void;
}) {
  const role = roleIn(p, me), s = p.settlement, pay = p.payment, pace = paceOf(p, now);
  const needsDriver = role === "executor" && p.status === "accepted" && !p.jobId;
  return <>
    <BackLink label="Parcerias" onClick={onBack} />
    {p.status === "active" || p.status === "accepted" ? <OperationCard p={p} me={me} now={now} onOpen={() => undefined} /> : null}
    <section className="nvu-central-section b2p-sec"><div className="b2p-form">
      <h2>{p.operationName}</h2>
      <div className="b2p-settle">
        <Row label={role === "contractor" ? "Executora" : "Contratante"} value={role === "contractor" ? p.executorName : p.contractorName} />
        <Row label="Viagens" value={`${p.progress}/${p.totalTrips}`} />
        <Row label="Prazo" value={p.durationDays ? formatDays(p.durationDays) : "—"} />
        {p.deadlineMs ? <Row label={p.status === "completed" ? "Prazo final" : "Restante"} value={p.status === "completed" ? fmtDateTime(p.deadlineMs) : remainingText(p.deadlineMs, now) || "—"} /> : null}
        <Row label="Veículo" value={p.vehicleName || "A definir pela executora"} />
        {p.trailerName || p.trailerRequirement ? <Row label="Reboque" value={p.trailerName || p.trailerRequirement} /> : null}
        {p.status !== "completed" && p.status !== "pending" && pace.label ? <Row label="Ritmo" value={pace.label} /> : null}
      </div>
      {p.conditions ? <div className="b2p-field"><span className="b2p-label">Condições do acordo</span><p className="b2p-note-box">{p.conditions}</p></div> : null}
      {p.startPhotoUrl ? <div className="b2p-driver-card"><img src={p.startPhotoUrl} alt="Foto do veículo no início" loading="lazy" /><div><b>Foto do veículo</b><small>Enviada pelo motorista ao iniciar</small></div></div> : null}

      {p.agreedAmountCents ? <div className="b2p-field"><span className="b2p-label">{role === "contractor" ? "Pagamento (a pagar)" : "Pagamento (a receber)"}</span>
        <div className="b2p-settle">
          <Row label="Valor combinado" value={formatMoney(p.agreedAmountCents, p.currency)} />
          {s ? <>
            {s.late ? <Row label={`Fora do prazo (−${s.penaltyPercent}%)`} value={`− ${formatMoney(s.discountCents, p.currency)}`} neg /> : <Row label="Dentro do prazo" value="Sem desconto" />}
            <Row label={role === "contractor" ? "Valor a pagar" : "Valor a receber"} value={formatMoney(s.finalCents, p.currency)} strong />
            <Row label="Situação" value={pay?.status === "settled" ? `Liquidado em ${fmtDay(pay.settledAtMs)}` : pay?.status === "paid" ? `Pago em ${fmtDay(pay.paidAtMs)} · aguarda confirmação` : role === "contractor" ? "A pagar" : "A receber"} />
          </> : <Row label="Se concluir fora do prazo" value={`${formatMoney(Math.round(p.agreedAmountCents * (100 - LATE_PENALTY_PERCENT) / 100), p.currency)} (−${LATE_PENALTY_PERCENT}%)`} />}
        </div>
        {s && pay ? <p className="b2p-hint">O pagamento é feito entre as empresas, fora do NVU. Aqui você só registra.</p> : <p className="b2p-hint">O valor final é calculado quando a última viagem for concluída.</p>}
        {role === "contractor" && pay?.status === "pending" ? <div className="b2p-actions"><button type="button" className="b2p-btn" data-v="primary" disabled={busy} onClick={() => onPay("paid")}>Marcar como pago</button></div> : null}
        {role === "executor" && pay && pay.status !== "settled" ? <div className="b2p-actions"><button type="button" className="b2p-btn" data-v="primary" disabled={busy} onClick={() => onPay("received")}>Confirmar recebimento</button></div> : null}
      </div> : null}

      <div className="b2p-actions">
        {needsDriver ? <button type="button" className="b2p-btn" data-v="primary" onClick={onDesignate}>Designar trabalho</button> : null}
        {p.progress > 0 || p.status === "completed" ? <button type="button" className="b2p-btn" data-v="ghost" onClick={onResults}>Resultados</button> : null}
        {role === "contractor" && ["completed", "declined", "cancelled"].includes(p.status) ? <button type="button" className="b2p-btn" data-v="ghost" onClick={onRepeat}>Repetir oferta</button> : null}
        {role === "contractor" && p.status === "pending" ? <button type="button" className="b2p-btn" data-v="danger" disabled={busy} onClick={onCancel}>Cancelar oferta</button> : null}
      </div>
    </div></section>
  </>;
}

/** Resultados da parceria (ganhos por viagem, meta, média e melhor viagem). */
export function Results({ p, me, onBack }: { p: Partnership; me: string; onBack: () => void }) {
  const r = resultsOf(p), r1 = 2 * Math.PI * 38;
  return <>
    <BackLink label="Detalhes" onClick={onBack} />
    <section className="nvu-central-section b2p-sec"><div className="b2p-form">
      <h2>Resultados</h2>
      <p className="b2p-hint">{p.operationName} · {roleIn(p, me) === "contractor" ? p.executorName : p.contractorName}</p>
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
