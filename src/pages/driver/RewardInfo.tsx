import React from "react";
import { CalendarDays, ClipboardList, Wallet } from "lucide-react";
import { formatMoney } from "../../lib/partnerships";
import { WEEKDAYS, type RewardPayment } from "../../lib/rewardPayments";
import { goalOf, offerPhase, type RewardOffer } from "../../lib/rewards";
import { Section } from "../../components/partnerships/shared";

const STEPS = ["O trabalho chega na sua fila. Ao iniciar, aceite as condições.", "Conclua a operação dentro do prazo.", "Ao concluir, informe sua chave Pix.", "Entra na folha do dia de pagamento (se perder o dia, na semana seguinte).", "Receba por Pix e confirme."];

/** Seção exclusiva do motorista: ganhos, trabalho, dia de pagamento e como funciona, em resumo. */
export function InfoTab({ offers, payments }: { offers: RewardOffer[]; payments: RewardPayment[] }) {
  const accepted = offers.filter(offer => offerPhase(offer) === "active" || offerPhase(offer) === "done"), earned = accepted.reduce((sum, offer) => sum + offer.totalCents, 0);
  const sum = (status: RewardPayment["status"][]) => payments.filter(item => status.includes(item.status)).reduce((total, item) => total + item.amountCents, 0);
  const days = new Map<string, { company: string; day: number | null }>();
  for (const offer of offers.filter(item => item.status === "accepted" || item.status === "pending")) if (!days.has(offer.companyId) || (days.get(offer.companyId)!.day === null && offer.payDay !== null)) days.set(offer.companyId, { company: offer.companyName, day: offer.payDay });
  return <>
    <Section title="Ganhos">
      <div className="b2p-facts" style={{ borderTop: 0 }}>
        <div><b>{formatMoney(earned)}</b><span>Acumulado</span></div>
        <div><b>{formatMoney(sum(["pending", "paid", "contested"]))}</b><span>A receber</span></div>
        <div><b>{formatMoney(sum(["received"]))}</b><span>Recebido</span></div>
      </div>
    </Section>
    <Section title="Trabalho" count={accepted.filter(offer => offerPhase(offer) === "active").length}>
      {accepted.filter(offer => offerPhase(offer) === "active").length ? accepted.filter(offer => offerPhase(offer) === "active").map((offer, index) => <div className="b2p-wrow" key={offer.id} style={index ? undefined : { borderTop: 0 }}>
        <span className="b2p-wico" data-k="ganho"><ClipboardList size={18} aria-hidden="true" /></span>
        <div><b>{offer.contractName || offer.name}</b><small>{offer.companyName}{offer.deadlineDays ? ` · ${offer.deadlineDays} dias` : ""}</small>{goalOf(offer) ? <small>Meta {formatMoney(offer.simCents)} de {formatMoney(goalOf(offer))}</small> : null}</div>
        <span className="b2p-amt"><strong>{offer.maxTripsPerDriver ? `${offer.trips}/${offer.maxTripsPerDriver}` : offer.trips}</strong><small>{formatMoney(offer.perTripCents)}/viagem</small></span></div>)
        : <p className="b2p-empty">Nenhum trabalho em andamento.</p>}
    </Section>
    <Section title="Dia de pagamento">
      {days.size ? [...days.values()].map((row, index) => <div className="b2p-wrow" key={row.company} style={index ? undefined : { borderTop: 0 }}>
        <span className="b2p-wico" data-k="ganho"><CalendarDays size={18} aria-hidden="true" /></span><div><b>{row.company}</b></div>
        <span className="b2p-amt"><strong>{row.day === null ? "A definir" : `Toda ${WEEKDAYS[row.day].toLowerCase()}`}</strong></span></div>)
        : <p className="b2p-empty">Sem ofertas.</p>}
    </Section>
    <Section title="Como funciona">
      <ol className="b2p-steps">{STEPS.map((step, index) => <li key={step}><span aria-hidden="true">{index + 1}</span>{step}</li>)}</ol>
      <p className="b2p-note-box" data-tone="warn" role="note">Prazo vencido sem concluir: você perde o pagamento.</p>
      <p className="b2p-hint" style={{ display: "flex", gap: 6, alignItems: "center" }}><Wallet size={14} aria-hidden="true" />O NVU só registra: a empresa paga.</p>
    </Section>
  </>;
}
