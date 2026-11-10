import React from "react";
import { ChevronRight, ClipboardList, Trophy } from "lucide-react";
import { formatMoney } from "../../lib/partnerships";
import { type RewardPayment } from "../../lib/rewardPayments";
import { PHASE_LABEL, PHASE_TONE, goalOf, offerPhase, termText, timeLeftText, type RewardOffer } from "../../lib/rewards";
import { Section } from "../../components/partnerships/shared";

const Pill = ({ offer }: { offer: RewardOffer }) => { const phase = offerPhase(offer); return <span className="b2p-pill" data-tone={PHASE_TONE[phase]} style={{ padding: "1px 9px", fontSize: 11 }}><i aria-hidden="true" />{PHASE_LABEL[phase]}</span>; };
const title = (offer: RewardOffer) => offer.contractName || offer.name;

/** Ativos: ofertas para responder e trabalhos em andamento (com prazo e progresso). */
export function ActiveTab({ offers, ready, now, onOpen }: { offers: RewardOffer[]; ready: boolean; now: number; onOpen: (id: string) => void }) {
  const pending = offers.filter(offer => offerPhase(offer) === "pending" && offer.endMs >= now), active = offers.filter(offer => offerPhase(offer) === "active");
  return <>
    <section className="nvu-central-section b2p-sec"><div className="b2p-sum"><div><small>Em andamento</small><b>{active.length}</b><em>{active.length === 1 ? "trabalho" : "trabalhos"}</em></div><div><small>Ofertas novas</small><b data-tone={pending.length ? "warn" : undefined}>{pending.length}</b><em>para responder</em></div></div></section>
    {pending.length ? <Section title="Para responder" count={pending.length}>
      {pending.map((offer, index) => <button type="button" className="b2p-wrow" key={offer.id} onClick={() => onOpen(offer.id)} style={{ width: "100%", textAlign: "left", ...(index ? {} : { borderTop: 0 }) }}>
        <span className="b2p-wico" data-k="ganho"><Trophy size={18} aria-hidden="true" /></span><div><b>{title(offer)}</b><small>{offer.companyName} · {termText(offer)}</small></div>
        <span className="b2p-amt"><strong data-k="ganho">{formatMoney(offer.perTripCents)}/viagem</strong><Pill offer={offer} /></span></button>)}
    </Section> : null}
    <Section title="Em andamento" count={active.length}>
      {active.length ? active.map((offer, index) => { const left = timeLeftText(offer.deadlineMs, now), urgent = offer.deadlineMs > 0 && offer.deadlineMs - now < 48 * 3_600_000;
        return <button type="button" className="b2p-wrow" key={offer.id} onClick={() => onOpen(offer.id)} style={{ width: "100%", textAlign: "left", ...(index ? {} : { borderTop: 0 }) }}>
          <span className="b2p-wico" data-k="ganho"><ClipboardList size={18} aria-hidden="true" /></span>
          <div><b>{title(offer)}</b><small>{offer.companyName} · {offer.trips}/{offer.maxTripsPerDriver || offer.trips} viagens</small>{left ? <small style={urgent ? { color: "var(--central-warning)" } : undefined}>Prazo: {left}</small> : null}</div>
          <span className="b2p-amt"><strong data-k="ganho">{formatMoney(offer.perTripCents * (offer.maxTripsPerDriver || offer.trips))}</strong><small>ao concluir</small></span><ChevronRight className="b2p-row-chev" size={16} aria-hidden="true" /></button>; })
        : <p className="b2p-empty">{ready ? "Nenhum trabalho em andamento." : "Carregando…"}</p>}
    </Section>
  </>;
}

/** Histórico: conclusões e resultados (concluídas, prazos perdidos, recusadas) e o total recebido. */
export function HistoryTab({ offers, payments, ready, onOpen }: { offers: RewardOffer[]; payments: RewardPayment[]; ready: boolean; onOpen: (id: string) => void }) {
  const finished = offers.filter(offer => ["done", "expired", "declined", "cancelled"].includes(offerPhase(offer))).sort((a, b) => (b.completedAtMs || b.expiredAtMs || b.createdAtMs) - (a.completedAtMs || a.expiredAtMs || a.createdAtMs));
  const done = finished.filter(offer => offerPhase(offer) === "done").length, lost = finished.filter(offer => offerPhase(offer) === "expired"), received = payments.filter(item => item.status === "received").reduce((sum, item) => sum + item.amountCents, 0);
  return <>
    <section className="nvu-central-section b2p-sec"><div className="b2p-facts" style={{ borderTop: 0 }}>
      <div><b>{done}</b><span>Concluídas</span></div><div><b data-tone={lost.length ? "late" : undefined}>{lost.length}</b><span>Prazo perdido</span></div><div><b>{formatMoney(received)}</b><span>Recebido</span></div>
    </div></section>
    <Section title="Histórico" count={finished.length}>
      {finished.length ? finished.map((offer, index) => { const phase = offerPhase(offer);
        return <button type="button" className="b2p-wrow" key={offer.id} onClick={() => onOpen(offer.id)} style={{ width: "100%", textAlign: "left", ...(index ? {} : { borderTop: 0 }) }}>
          <div><b>{title(offer)}</b><small>{offer.companyName}{phase === "done" || phase === "expired" ? ` · ${offer.trips}/${offer.maxTripsPerDriver || offer.trips} viagens` : ""}</small></div>
          <span className="b2p-amt"><strong data-k={phase === "done" ? "ganho" : undefined} style={phase === "expired" ? { textDecoration: "line-through", opacity: 0.7 } : undefined}>{phase === "done" ? formatMoney(offer.totalCents) : phase === "expired" ? formatMoney(offer.lostCents) : "—"}</strong><Pill offer={offer} /></span><ChevronRight className="b2p-row-chev" size={16} aria-hidden="true" /></button>; })
        : <p className="b2p-empty">{ready ? "Nada por aqui ainda." : "Carregando…"}</p>}
    </Section>
  </>;
}
