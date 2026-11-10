import React, { useMemo, useState } from "react";
import { toast } from "sonner";
import { Trophy } from "lucide-react";
import { useSessionStore } from "../../context/AppContext";
import { useDriverPayments, useDriverRewards } from "../../hooks/useRewards";
import { rewardService } from "../../services/rewardService";
import { formatMoney } from "../../lib/partnerships";
import { OFFER_STATE_LABEL, goalOf, periodText, rewardErrorMessage, type RewardOffer } from "../../lib/rewards";
import { BackLink, Section, Tabs } from "../../components/partnerships/shared";
import { ReceiptDetail, ReceiptsTab } from "./RewardPayments";
import "../../components/partnerships/Partnerships.css";

const Row = ({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) => <div data-total={strong ? "1" : undefined}><span>{label}</span><b>{value}</b></div>;
const TONE: Record<string, string> = { pending: "warn", accepted: "good", declined: "muted", cancelled: "muted" };

/** Recompensas do motorista: ofertas das empresas (aceitar ou recusar) e o ganho acumulado em cada campanha. */
export default function DriverRewards() {
  const { currentUser } = useSessionStore();
  const { offers, ready, error } = useDriverRewards(currentUser?.id);
  const { payments, pix, ready: paymentsReady } = useDriverPayments(currentUser?.id);
  const [openId, setOpenId] = useState(""), [busy, setBusy] = useState(false), [tab, setTab] = useState<"offers" | "receipts">("offers"), [paymentId, setPaymentId] = useState("");
  const now = useMemo(() => Date.now(), [offers]);
  const open = offers.find(offer => offer.id === openId);
  const respond = async (offer: RewardOffer, decision: "accept" | "decline") => {
    setBusy(true);
    try { await rewardService.respond(offer.id, decision); toast[decision === "accept" ? "success" : "message"](decision === "accept" ? "Campanha aceita. As viagens confirmadas a partir de agora contam." : "Oferta recusada."); setOpenId(""); }
    catch (reason) { toast.error(rewardErrorMessage(reason, "Não foi possível responder.")); } finally { setBusy(false); }
  };
  const pending = offers.filter(offer => offer.status === "pending" && offer.endMs >= now), mine = offers.filter(offer => offer.status === "accepted"), total = mine.reduce((sum, offer) => sum + offer.totalCents, 0);
  const shell = (title: string, description: string, children: React.ReactNode) => <div className="nvu-central-page nvu-b2p"><div className="nvu-central-stack"><header className="nvu-central-intro nvu-workspace-page-heading"><div className="nvu-workspace-page-title"><h1>{title}</h1><p>{description}</p></div></header>{children}</div></div>;
  if (paymentId) return shell("Recebimento", "Confira o pagamento e o comprovante.", <ReceiptDetail payment={payments.find(item => item.id === paymentId)} pix={pix} onBack={() => setPaymentId("")} />);
  if (open) return shell("Oferta de recompensa", "Analise as condições e responda.", <>
    <BackLink label="Recompensas" onClick={() => setOpenId("")} />
    <section className="nvu-central-section b2p-sec"><div className="b2p-form">
      <div className="b2p-op-row"><span className="nvu-central-avatar b2p-logo" style={{ display: "inline-grid", placeItems: "center", width: 44, height: 44 }}><Trophy size={22} aria-hidden="true" /></span><div><b>{open.name}</b><small>{open.companyName} · {periodText(open.startMs, open.endMs)}</small></div></div>
      <div className="b2p-settle">
        {open.contractName ? <Row label="Operação" value={open.contractName} /> : null}
        <Row label="Ganho por viagem" value={formatMoney(open.perTripCents)} />
        {open.maxTripsPerDriver ? <><Row label="Viagens da operação" value={open.maxTripsPerDriver} /><Row label="Meta de ganhos" value={formatMoney(goalOf(open))} /></> : null}
        {open.bonusCents ? <><Row label="Bônus da meta" value={formatMoney(open.bonusCents)} /><Row label="Meta" value={`${open.bonusGoalTrips} viagens`} /></> : null}
        {open.status === "accepted" ? <><Row label="Suas viagens" value={`${open.trips}${open.goalReached ? " · meta atingida" : ""}`} /><Row label="Você já ganhou" value={formatMoney(open.totalCents)} strong /></> : null}
      </div>
      {open.status === "accepted" && open.maxTripsPerDriver ? (() => { const goal = goalOf(open), pct = goal ? Math.min(100, open.tripCents / goal * 100) : 0; return <div><div className="nvu-central-progress" role="progressbar" aria-label="Progresso até a meta de ganhos" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}><span style={{ width: `${pct}%` }} /></div>
        <p className="b2p-hint">{open.tripCents >= goal ? "Meta de ganhos alcançada!" : `Você ganhou ${formatMoney(open.tripCents)} de ${formatMoney(goal)}. Faltam ${formatMoney(goal - open.tripCents)}.`}</p></div>; })() : null}
      <p className="b2p-note-box">Cada viagem confirmada{open.contractName ? <> na operação <b>{open.contractName}</b></> : null} da empresa <b>{open.companyName}</b>, depois do seu aceite e dentro do período, soma ao seu ganho.</p>
      <p className="b2p-note-box" data-tone="warn">O pagamento é feito pela empresa, por Pix, na chave que você cadastrar. O NVU calcula o ganho, organiza a folha e registra o comprovante, mas não paga nem garante o pagamento.</p>
      {open.status === "pending" ? <div className="b2p-actions"><button type="button" className="b2p-btn" data-v="primary" disabled={busy} onClick={() => void respond(open, "accept")}>{busy ? "Aguarde…" : "Aceitar"}</button><button type="button" className="b2p-btn" data-v="ghost" disabled={busy} onClick={() => void respond(open, "decline")}>Recusar</button></div>
        : <p className="b2p-hint">{OFFER_STATE_LABEL[open.status]}.</p>}
    </div></section></>);
  const toConfirm = payments.filter(item => item.status === "paid").length;
  const tabs = <Tabs<"offers" | "receipts"> label="Seções de recompensas" value={tab} onChange={setTab} items={[{ id: "offers", label: "Ofertas", count: pending.length, warn: true }, { id: "receipts", label: "Recebimentos", count: toConfirm, warn: true }]} />;
  if (tab === "receipts") return shell("Recompensas", "Campanhas, pagamentos e comprovantes.", <>{tabs}<ReceiptsTab payments={payments} pix={pix} ready={paymentsReady} onOpen={setPaymentId} /></>);
  return shell("Recompensas", "Campanhas das empresas para você.", <>
    {tabs}
    {error ? <p className="b2p-alert" role="alert">Não foi possível atualizar as recompensas agora.</p> : null}
    <section className="nvu-central-section b2p-sec"><div className="b2p-sum"><div><small>Ganho acumulado</small><b data-tone={total ? "pos" : undefined}>{formatMoney(total)}</b><em>{mine.length} {mine.length === 1 ? "campanha aceita" : "campanhas aceitas"}</em></div><div><small>Ofertas novas</small><b data-tone={pending.length ? "warn" : undefined}>{pending.length}</b><em>aguardando resposta</em></div></div></section>
    <Section title="Campanhas" count={offers.length}>
      {offers.length ? offers.map((offer, index) => <button type="button" className="b2p-wrow" key={offer.id} onClick={() => setOpenId(offer.id)} style={index ? undefined : { borderTop: 0 }}>
        <span className="b2p-wico" data-k="ganho"><Trophy size={18} aria-hidden="true" /></span><div><b>{offer.name}</b><small>{offer.companyName} · {periodText(offer.startMs, offer.endMs)}</small></div>
        <span className="b2p-amt"><strong data-k="ganho">{offer.status === "accepted" ? formatMoney(offer.totalCents) : formatMoney(offer.perTripCents) + "/viagem"}</strong><span className="b2p-pill" data-tone={TONE[offer.status]} style={{ padding: "1px 9px", fontSize: 11 }}><i aria-hidden="true" />{offer.status === "pending" ? "Responder" : OFFER_STATE_LABEL[offer.status]}</span></span></button>)
        : <p className="b2p-empty">{ready ? "Nenhuma campanha por enquanto. Quando uma empresa enviar, ela aparece aqui." : "Carregando…"}</p>}
    </Section>
  </>);
}
