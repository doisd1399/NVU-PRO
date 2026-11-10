import React from "react";
import { Trophy } from "lucide-react";
import { formatMoney } from "../../lib/partnerships";
import { WEEKDAYS, dateTimeText } from "../../lib/rewardPayments";
import { PHASE_LABEL, goalOf, offerPhase, termText, timeLeftText, type RewardOffer } from "../../lib/rewards";
import { BackLink } from "../../components/partnerships/shared";

const Row = ({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) => <div data-total={strong ? "1" : undefined}><span>{label}</span><b>{value}</b></div>;

/** Uma oferta: condições, prazo, progresso e o que acontece em cada situação (inclusive perder o pagamento). */
export function OfferDetail({ offer, now, busy, onBack, onRespond }: { offer: RewardOffer; now: number; busy: boolean; onBack: () => void; onRespond: (decision: "accept" | "decline") => void }) {
  const sim = Number(offer.simCents) || 0, phase = offerPhase(offer), accepted = offer.status === "accepted", goal = goalOf(offer), days = offer.deadlineDays, left = timeLeftText(offer.deadlineMs, now);
  const payDay = offer.payDay === null ? "" : ` (toda ${WEEKDAYS[offer.payDay].toLowerCase()})`;
  return <>
    <BackLink label="Pagamentos" onClick={onBack} />
    <section className="nvu-central-section b2p-sec"><div className="b2p-form">
      <div className="b2p-op-row"><span className="nvu-central-avatar b2p-logo" style={{ display: "inline-grid", placeItems: "center", width: 44, height: 44 }}><Trophy size={22} aria-hidden="true" /></span><div><b>{offer.name}</b><small>{offer.companyName} · {termText(offer)}</small></div></div>
      <div className="b2p-settle">
        {offer.contractName ? <Row label="Operação" value={offer.contractName} /> : null}
        <Row label="Valor por viagem" value={formatMoney(offer.perTripCents)} />
        {offer.maxTripsPerDriver ? <Row label="Viagens da operação" value={offer.maxTripsPerDriver} /> : null}
        {goal ? <Row label="Meta da operação" value={formatMoney(goal)} /> : null}
        {offer.bonusCents ? <><Row label="Bônus da meta" value={formatMoney(offer.bonusCents)} /><Row label="Meta" value={`${offer.bonusGoalTrips} viagens`} /></> : null}
        {accepted ? <>
          <Row label="Suas viagens" value={offer.maxTripsPerDriver ? `${offer.trips} de ${offer.maxTripsPerDriver}` : String(offer.trips)} />
          {offer.deadlineMs ? <Row label="Prazo" value={phase === "active" ? `${dateTimeText(offer.deadlineMs)} (${left})` : dateTimeText(offer.deadlineMs)} /> : null}
          <Row label={phase === "expired" ? "Pagamento perdido" : "Você já ganhou"} value={formatMoney(Number(phase === "expired" ? offer.lostCents : offer.totalCents) || 0)} strong />
          {goal ? <Row label="Ganhos na operação" value={`${formatMoney(sim)} de ${formatMoney(goal)}`} /> : null}
        </> : null}
      </div>
      {accepted && goal ? (() => { const pct = Math.min(100, sim / goal * 100); return <div className="nvu-central-progress" role="progressbar" aria-label="Progresso até a meta da operação" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}><span style={{ width: `${pct}%` }} /></div>; })() : null}
      {phase === "pending" ? <p className="b2p-note-box" data-tone="warn">{days ? `Conclua a operação em ${days} ${days === 1 ? "dia" : "dias"} depois de aceitar. ` : ""}Sem concluir no prazo, você perde o pagamento.</p> : null}
      {phase === "active" ? <p className="b2p-note-box" data-tone={offer.deadlineMs && offer.deadlineMs - now < 48 * 3_600_000 ? "warn" : undefined}>{left ? `Prazo: ${left}. ` : ""}Sem concluir no prazo, você perde o pagamento.</p> : null}
      {phase === "done" ? <p className="b2p-note-box">Operação concluída. Pagamento na folha do dia de pagamento{payDay}.</p> : null}
      {phase === "expired" ? <p className="b2p-alert" role="alert">Prazo encerrado. Você não concluiu a operação e perdeu o pagamento.</p> : null}
      {phase === "pending" || phase === "active" ? <p className="b2p-hint">Pago por Pix só depois da operação concluída. O NVU só registra: não paga nem garante.</p> : null}
      {phase === "pending" ? <div className="b2p-actions"><button type="button" className="b2p-btn" data-v="primary" disabled={busy} onClick={() => onRespond("accept")}>{busy ? "Aguarde…" : "Aceitar"}</button><button type="button" className="b2p-btn" data-v="ghost" disabled={busy} onClick={() => onRespond("decline")}>Recusar</button></div>
        : phase === "declined" || phase === "cancelled" ? <p className="b2p-hint">{PHASE_LABEL[phase]}.</p> : null}
    </div></section>
  </>;
}
