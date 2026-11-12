import React, { useState } from "react";
import { toast } from "sonner";
import { ChevronRight } from "lucide-react";
import { rewardService } from "../../services/rewardService";
import { formatMoney } from "../../lib/partnerships";
import { COMPANY_PAYMENT_LABEL, PAYMENT_TONE, WEEKDAYS, dateTimeText, nextPayDayText, pendingBalance, type RewardPayment } from "../../lib/rewardPayments";
import type { RewardOffer } from "../../lib/rewards";
import { rewardErrorMessage } from "../../lib/rewards";
import { BackLink, Section } from "../../components/partnerships/shared";
import { PixPayPanel, ReceiptCard, Row } from "../../components/rewards/PaymentParts";
import { ReceiptAttach } from "../../components/rewards/ReceiptAttach";
import { DriverAvatar } from "../../components/rewards/DriverAvatar";

const Pill = ({ status }: { status: RewardPayment["status"] }) => <span className="b2p-pill" data-tone={PAYMENT_TONE[status]} style={{ padding: "1px 9px", fontSize: 11 }}><i aria-hidden="true" />{COMPANY_PAYMENT_LABEL[status]}</span>;
const PaymentRow = ({ payment, onOpen, showDate }: { payment: RewardPayment; onOpen: () => void; showDate?: boolean }) => <button type="button" className="b2p-wrow" onClick={onOpen} aria-label={`${payment.driverName}, ${formatMoney(payment.amountCents)}, ${COMPANY_PAYMENT_LABEL[payment.status]}`} style={{ width: "100%", textAlign: "left" }}>
  <DriverAvatar id={payment.driverId} name={payment.driverName} />
  <div><b>{payment.driverName}</b><small>{showDate ? dateTimeText(payment.paidAtMs || payment.payrollAtMs) : payment.status === "contested" ? "Contestado pelo motorista" : payment.pixKey ? "Chave Pix cadastrada" : "Sem chave Pix"}</small></div>
  <span className="b2p-amt"><strong data-k="x">{formatMoney(payment.amountCents)}</strong><Pill status={payment.status} /></span>
  <ChevronRight className="b2p-row-chev" size={16} aria-hidden="true" /></button>;

/** Folha: o que cada motorista tem a receber (pendentes e contestados), dia de pagamento e geração da folha. */
export function PayrollTab({ companyId, payments, offers, payDay, ready, now, onOpen }: { companyId: string; payments: RewardPayment[]; offers: RewardOffer[]; payDay: number | null; ready: boolean; now: number; onOpen: (id: string) => void }) {
  const [busy, setBusy] = useState(false), [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const open = payments.filter(item => item.status === "pending" || item.status === "contested"), openTotal = open.reduce((sum, item) => sum + item.amountCents, 0), balance = pendingBalance(offers);
  const run = async (task: () => Promise<void>, fallback: string) => { setBusy(true); try { await task(); } catch (reason) { toast.error(rewardErrorMessage(reason, fallback)); } finally { setBusy(false); } };
  const generate = () => run(async () => {
    const result = await rewardService.generatePayroll(companyId, requestId); setRequestId(crypto.randomUUID());
    toast.success(result.payments ? `Folha gerada: ${formatMoney(result.totalCents)} para ${result.payments} ${result.payments === 1 ? "motorista" : "motoristas"}.` : "Não há valores novos para a folha.");
    if (result.partial) toast.message("Havia mais motoristas do que cabe em uma folha. Gere de novo para incluir o restante.");
  }, "Não foi possível gerar a folha.");
  return <>
    <section className="nvu-central-section b2p-sec">
      <div className="b2p-sec-head"><h2>Folha de pagamento</h2></div>
      <div className="b2p-sum"><div><small>A pagar</small><b>{formatMoney(openTotal)}</b><em>{open.length} {open.length === 1 ? "pagamento" : "pagamentos"} na folha</em></div><div><small>Pronto para a folha</small><b>{formatMoney(balance.totalCents)}</b><em>{balance.rows.length ? `${balance.rows.length} ${balance.rows.length === 1 ? "motorista concluiu" : "motoristas concluíram"}` : balance.waiting.length ? `${balance.waiting.length} em andamento` : "sem saldo novo"}</em></div></div>
      <div className="b2p-form">
        <div className="b2p-field"><span className="b2p-label">Dia do pagamento</span>
          <div className="b2p-input"><select value={payDay ?? ""} aria-label="Dia da semana do pagamento" disabled={busy} onChange={event => { const day = Number(event.target.value); void run(async () => { await rewardService.setPayDay(companyId, day); toast.success(`Pagamento toda ${WEEKDAYS[day].toLowerCase()}${day === 0 || day === 6 ? "" : "-feira"}.`); }, "Não foi possível salvar o dia."); }}>
            <option value="" disabled>Escolha o dia</option>{WEEKDAYS.map((label, index) => <option key={label} value={index}>{label}</option>)}</select></div>
          <span className="b2p-hint">{payDay === null ? "Escolha o dia da folha (8h)." : `Próxima folha: ${nextPayDayText(payDay, now)}, 8h.`}</span></div>
        <div className="b2p-actions"><button type="button" className="b2p-btn" data-v="primary" disabled={busy || !balance.totalCents} onClick={() => void generate()}>{busy ? "Gerando…" : "Gerar folha agora"}</button></div>
      </div>
    </section>
    <Section title="A pagar" count={open.length}>
      {open.length ? open.map(payment => <PaymentRow key={payment.id} payment={payment} onOpen={() => onOpen(payment.id)} />)
        : <p className="b2p-empty">{ready ? "Nenhum pagamento na folha." : "Carregando a folha…"}</p>}
      {balance.waiting.length ? <><p className="b2p-hint">Em andamento (recebem ao concluir):</p>{balance.waiting.map(row => <div className="b2p-wrow" key={row.id}><DriverAvatar id={row.driverId} name={row.driverName} /><div><b>{row.driverName}</b><small>em andamento{row.of ? ` · ${row.trips} de ${row.of} viagens` : ""}</small></div><span className="b2p-amt"><strong data-k="x">{formatMoney(row.cents)}</strong></span></div>)}</> : null}
      {balance.rows.length ? <><p className="b2p-hint">Prontos para a próxima folha:</p>{balance.rows.map(row => <div className="b2p-wrow" key={row.driverId}><DriverAvatar id={row.driverId} name={row.driverName} /><div><b>{row.driverName}</b><small>ganho ainda não pago</small></div><span className="b2p-amt"><strong data-k="x">{formatMoney(row.cents)}</strong></span></div>)}</> : null}
    </Section>
  </>;
}

/** Transferências: pagamentos já feitos pela empresa (com comprovante) e a confirmação do motorista. */
export function TransfersTab({ payments, ready, onOpen }: { payments: RewardPayment[]; ready: boolean; onOpen: (id: string) => void }) {
  const done = payments.filter(item => item.status === "paid" || item.status === "received").sort((a, b) => b.paidAtMs - a.paidAtMs);
  const total = done.reduce((sum, item) => sum + item.amountCents, 0), confirmed = done.filter(item => item.status === "received").reduce((sum, item) => sum + item.amountCents, 0);
  return <>
    <section className="nvu-central-section b2p-sec">
      <div className="b2p-sec-head"><h2>Transferências</h2></div>
      <div className="b2p-sum"><div><small>Total pago</small><b>{formatMoney(total)}</b><em>{done.length} {done.length === 1 ? "transferência" : "transferências"}</em></div><div><small>Confirmado pelos motoristas</small><b>{formatMoney(confirmed)}</b><em>{done.filter(item => item.status === "paid").length} aguardando confirmação</em></div></div>
    </section>
    <Section title="Pagamentos feitos" count={done.length}>
      {done.length ? done.map(payment => <PaymentRow key={payment.id} payment={payment} showDate onOpen={() => onOpen(payment.id)} />) : <p className="b2p-empty">{ready ? "Nenhuma transferência ainda." : "Carregando…"}</p>}
      <p className="b2p-hint">O dinheiro não passa pelo NVU.</p>
    </Section>
  </>;
}

/** Um pagamento: Pix para pagar (pendente/contestado) ou comprovante (pago/recebido). */
export function PaymentDetail({ payment, onBack, backLabel }: { payment: RewardPayment | undefined; onBack: () => void; backLabel: string }) {
  const [busy, setBusy] = useState(false), [e2e, setE2e] = useState("");
  if (!payment) return <><BackLink label={backLabel} onClick={onBack} /><p className="b2p-empty">Este pagamento não está mais disponível.</p></>;
  const run = async (task: () => Promise<unknown>, fallback: string, done: string) => { setBusy(true); try { await task(); toast.success(done); } catch (reason) { toast.error(rewardErrorMessage(reason, fallback)); } finally { setBusy(false); } };
  const needsPayment = payment.status === "pending" || payment.status === "contested";
  return <>
    <BackLink label={backLabel} onClick={onBack} />
    <section className="nvu-central-section b2p-sec">
      <div className="b2p-sec-head"><h2 style={{ display: "flex", gap: 10, alignItems: "center" }}><DriverAvatar id={payment.driverId} name={payment.driverName} size={40} />{payment.driverName}</h2><Pill status={payment.status} /></div>
      <div className="b2p-sum"><div><small>Valor</small><b>{formatMoney(payment.amountCents)}</b><em>folha de {dateTimeText(payment.payrollAtMs)}</em></div></div>
      <div className="b2p-settle">{payment.items.map(item => <Row key={item.offerId} label={item.campaignName} value={formatMoney(item.cents)} />)}<Row label="Total" value={formatMoney(payment.amountCents)} strong /></div>
      {payment.status === "contested" ? <p className="b2p-note-box" data-tone="warn" role="alert"><b>Contestado:</b> {payment.contestReason}</p> : null}
      {payment.status === "paid" ? <p className="b2p-note-box" role="note">Aguardando confirmação do motorista.</p> : null}
    </section>
    {needsPayment ? <>
      <PixPayPanel payment={payment} />
      <section className="nvu-central-section b2p-sec"><div className="b2p-form">
        <div className="b2p-field"><span className="b2p-label">Código da transação Pix (opcional)</span><div className="b2p-input"><input value={e2e} maxLength={40} autoComplete="off" placeholder="Ex.: E1234567890…" onChange={event => setE2e(event.target.value)} /></div><span className="b2p-hint">Aparece no comprovante do banco.</span></div>
        <ReceiptAttach scope="reward-receipt" refId={payment.id} expectedCents={payment.amountCents} busy={busy}
          onConfirm={proof => run(() => rewardService.markPaid(payment.id, proof, e2e), "Não foi possível marcar como pago.", "Marcado como pago. O motorista foi avisado.")} />
        <div className="b2p-actions"><button type="button" className="b2p-btn" data-v="danger" disabled={busy} onClick={() => { if (window.confirm("Cancelar este pagamento? O valor volta para a próxima folha.")) void run(() => rewardService.cancelPayment(payment.id), "Não foi possível cancelar.", "Pagamento cancelado."); }}>Cancelar pagamento</button></div>
      </div></section>
    </> : <ReceiptCard payment={payment} />}
  </>;
}
