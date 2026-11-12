import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useSessionStore } from "../../context/AppContext";
import { useDriverPayments, useDriverRewards } from "../../hooks/useRewards";
import { rewardService } from "../../services/rewardService";
import { offerPhase, rewardErrorMessage, type RewardOffer } from "../../lib/rewards";
import { BackLink, Tabs } from "../../components/partnerships/shared";
import { ReceiptDetail, ReceiptsTab } from "./RewardPayments";
import { InfoTab } from "./RewardInfo";
import { ActiveTab, HistoryTab } from "./RewardWork";
import { OfferDetail } from "./RewardOfferDetail";
import "../../components/partnerships/Partnerships.css";

type Tab = "active" | "receipts" | "history" | "info";

/** Trabalhos do motorista (menu do painel): trabalhos ativos com prazo e ganhos, recebimentos, histórico de conclusões e resultados, e como funciona. */
export default function DriverRewards() {
  const { currentUser } = useSessionStore();
  const navigate = useNavigate();
  const { offers, ready, error } = useDriverRewards(currentUser?.id);
  const { payments, pix, ready: paymentsReady } = useDriverPayments(currentUser?.id);
  const [openId, setOpenId] = useState(""), [busy, setBusy] = useState(false), [tab, setTab] = useState<Tab>("active"), [paymentId, setPaymentId] = useState("");
  const now = useMemo(() => Date.now(), [offers, tab, openId]);
  const open = offers.find(offer => offer.id === openId);
  const respond = async (offer: RewardOffer, decision: "accept" | "decline") => {
    setBusy(true);
    try { await rewardService.respond(offer.id, decision); toast[decision === "accept" ? "success" : "message"](decision === "accept" ? "Oferta aceita." : "Oferta recusada."); setOpenId(""); }
    catch (reason) { toast.error(rewardErrorMessage(reason, "Não foi possível responder.")); } finally { setBusy(false); }
  };
  const shell = (title: string, description: string, children: React.ReactNode) => <div className="nvu-central-page nvu-b2p"><div className="nvu-central-stack"><header className="nvu-central-intro nvu-workspace-page-heading"><div className="nvu-workspace-page-title"><h1>{title}</h1><p>{description}</p></div></header>{children}</div></div>;
  if (paymentId) return shell("Recebimento", "Pagamento e comprovante.", <ReceiptDetail payment={payments.find(item => item.id === paymentId)} pix={pix} onBack={() => setPaymentId("")} />);
  if (open) return shell(offerPhase(open) === "pending" ? "Oferta" : "Trabalho", "Prazo, ganhos e pagamento.", <OfferDetail offer={open} now={now} busy={busy} onBack={() => setOpenId("")} onRespond={decision => void respond(open, decision)} />);
  const pending = offers.filter(offer => offerPhase(offer) === "pending" && offer.endMs >= now).length, toConfirm = payments.filter(item => item.status === "paid").length;
  const tabs = <Tabs<Tab> label="Seções de trabalhos" value={tab} onChange={setTab} items={[{ id: "active", label: "Ativos", count: pending, warn: true }, { id: "receipts", label: "Recebimentos", count: toConfirm, warn: true }, { id: "history", label: "Histórico" }, { id: "info", label: "Info" }]} />;
  const body = tab === "receipts" ? <ReceiptsTab payments={payments} pix={pix} ready={paymentsReady} onOpen={setPaymentId} />
    : tab === "history" ? <HistoryTab offers={offers} payments={payments} ready={ready} onOpen={setOpenId} />
    : tab === "info" ? <InfoTab offers={offers} payments={payments} />
    : <ActiveTab offers={offers} ready={ready} now={now} onOpen={setOpenId} />;
  return shell("Trabalhos", tab === "receipts" ? "Recebimentos e chave Pix." : tab === "history" ? "Conclusões e resultados." : tab === "info" ? "Como funciona." : "Seus trabalhos e ofertas.", <>
    <BackLink label="Painel" onClick={() => navigate("/driver/profile")} />
    {tabs}
    {error ? <p className="b2p-alert" role="alert">Não foi possível atualizar agora.</p> : null}
    {body}
  </>);
}
