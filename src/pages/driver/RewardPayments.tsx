import React, { useState } from "react";
import { toast } from "sonner";
import { ChevronRight } from "lucide-react";
import { rewardService } from "../../services/rewardService";
import { formatMoney } from "../../lib/partnerships";
import { DRIVER_PAYMENT_LABEL, PAYMENT_TONE, dateTimeText, type RewardPayment } from "../../lib/rewardPayments";
import { rewardErrorMessage } from "../../lib/rewards";
import { BackLink, Section } from "../../components/partnerships/shared";
import { DriverPixCard, ReceiptCard, Row } from "../../components/rewards/PaymentParts";

const Pill = ({ status }: { status: RewardPayment["status"] }) => <span className="b2p-pill" data-tone={PAYMENT_TONE[status]} style={{ padding: "1px 9px", fontSize: 11 }}><i aria-hidden="true" />{DRIVER_PAYMENT_LABEL[status]}</span>;

/** Recebimentos do motorista: chave Pix, o que cada empresa vai pagar e os comprovantes. */
export function ReceiptsTab({ payments, pix, ready, onOpen }: { payments: RewardPayment[]; pix: { type: string; key: string } | null; ready: boolean; onOpen: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const list = payments.filter(item => item.status !== "cancelled");
  const waiting = list.filter(item => item.status === "pending" || item.status === "paid" || item.status === "contested").reduce((sum, item) => sum + item.amountCents, 0), received = list.filter(item => item.status === "received").reduce((sum, item) => sum + item.amountCents, 0);
  return <>
    <section className="nvu-central-section b2p-sec"><div className="b2p-sum"><div><small>A receber</small><b data-tone={waiting ? "warn" : undefined}>{formatMoney(waiting)}</b><em>aguardando pagamento ou confirmação</em></div><div><small>Recebido</small><b data-tone={received ? "pos" : undefined}>{formatMoney(received)}</b><em>{list.filter(item => item.status === "received").length} confirmados</em></div></div></section>
    <DriverPixCard pix={pix} busy={busy} onSave={async (type, key) => { setBusy(true); try { await rewardService.setPix(type, key); toast.success("Chave Pix salva."); } catch (reason) { toast.error(rewardErrorMessage(reason, "Não foi possível salvar a chave Pix.")); throw reason; } finally { setBusy(false); } }} />
    <Section title="Recebimentos" count={list.length}>
      {list.length ? list.map((payment, index) => <button type="button" className="b2p-wrow" key={payment.id} onClick={() => onOpen(payment.id)} style={{ width: "100%", textAlign: "left", ...(index ? {} : { borderTop: 0 }) }} aria-label={`${payment.companyName}, ${formatMoney(payment.amountCents)}, ${DRIVER_PAYMENT_LABEL[payment.status]}`}>
        <div><b>{payment.companyName}</b><small>{payment.items.map(item => item.campaignName).join(", ") || "Salário"} · {dateTimeText(payment.paidAtMs || payment.payrollAtMs)}</small></div>
        <span className="b2p-amt"><strong data-k="ganho">{formatMoney(payment.amountCents)}</strong><Pill status={payment.status} /></span><ChevronRight className="b2p-row-chev" size={16} aria-hidden="true" /></button>)
        : <p className="b2p-empty">{ready ? "Nenhum pagamento ainda. Quando a empresa montar a folha, o valor aparece aqui." : "Carregando…"}</p>}
      <p className="b2p-hint">A empresa paga por Pix na sua chave. Quando o dinheiro chegar, confirme o recebimento; se não chegar ou não conferir, conteste.</p>
    </Section>
  </>;
}

/** Um recebimento: situação, comprovante e as ações do motorista (confirmar ou contestar). */
export function ReceiptDetail({ payment, pix, onBack }: { payment: RewardPayment | undefined; pix: { type: string; key: string } | null; onBack: () => void }) {
  const [busy, setBusy] = useState(false), [contesting, setContesting] = useState(false), [reason, setReason] = useState("");
  if (!payment) return <><BackLink label="Recebimentos" onClick={onBack} /><p className="b2p-empty">Este pagamento não está mais disponível.</p></>;
  const run = async (task: () => Promise<unknown>, fallback: string, done: string) => { setBusy(true); try { await task(); toast.success(done); setContesting(false); setReason(""); } catch (error) { toast.error(rewardErrorMessage(error, fallback)); } finally { setBusy(false); } };
  return <>
    <BackLink label="Recebimentos" onClick={onBack} />
    <section className="nvu-central-section b2p-sec">
      <div className="b2p-sec-head"><h2>{payment.companyName}</h2><Pill status={payment.status} /></div>
      <div className="b2p-sum"><div><small>Valor</small><b>{formatMoney(payment.amountCents)}</b><em>folha de {dateTimeText(payment.payrollAtMs)}</em></div></div>
      <div className="b2p-settle">{payment.items.map(item => <Row key={item.offerId} label={item.campaignName} value={formatMoney(item.cents)} />)}<Row label="Total" value={formatMoney(payment.amountCents)} strong /></div>
      {payment.status === "pending" ? <p className="b2p-note-box" data-tone={pix ? undefined : "warn"} role="note">{pix ? "A empresa vai pagar por Pix na sua chave cadastrada. Você será avisado quando ela marcar como pago." : "Cadastre sua chave Pix na aba Recebimentos para a empresa poder pagar."}</p> : null}
      {payment.status === "contested" ? <p className="b2p-note-box" data-tone="warn" role="note"><b>Você contestou:</b> {payment.contestReason}. A empresa foi avisada e vai pagar de novo ou cancelar.</p> : null}
      {payment.status === "paid" ? <p className="b2p-note-box" role="note">A empresa marcou como pago em {dateTimeText(payment.paidAtMs)}. Confira na sua conta e confirme abaixo.</p> : null}
    </section>
    <ReceiptCard payment={payment} />
    {payment.status === "paid" ? <section className="nvu-central-section b2p-sec"><div className="b2p-form">
      {contesting ? <>
        <div className="b2p-field"><span className="b2p-label">O que aconteceu?</span><div className="b2p-input"><textarea className="b2p-textarea" value={reason} maxLength={300} rows={3} placeholder="Ex.: o Pix não caiu na minha conta" onChange={event => setReason(event.target.value)} /></div></div>
        <div className="b2p-actions"><button type="button" className="b2p-btn" data-v="danger" disabled={busy || reason.trim().length < 5} onClick={() => void run(() => rewardService.contest(payment.id, reason), "Não foi possível contestar.", "Contestação enviada à empresa.")}>{busy ? "Enviando…" : "Enviar contestação"}</button><button type="button" className="b2p-btn" data-v="ghost" disabled={busy} onClick={() => setContesting(false)}>Voltar</button></div>
      </> : <div className="b2p-actions"><button type="button" className="b2p-btn" data-v="primary" disabled={busy} onClick={() => void run(() => rewardService.confirmReceived(payment.id), "Não foi possível confirmar.", "Recebimento confirmado.")}>{busy ? "Aguarde…" : "Confirmar recebimento"}</button><button type="button" className="b2p-btn" data-v="ghost" disabled={busy} onClick={() => setContesting(true)}>Não recebi / não confere</button></div>}
      <p className="b2p-hint">Confirme só depois de ver o dinheiro na sua conta. Depois de confirmado, o pagamento não muda mais.</p>
    </div></section> : null}
  </>;
}
