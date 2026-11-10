import React, { useEffect, useMemo, useState } from "react";
import { Copy } from "lucide-react";
import qrcode from "qrcode-generator";
import { PIX_LABEL, formatMoney, normalizePixKey, type PixType } from "../../lib/partnerships";
import { buildPixBrCode } from "../../lib/pixBrCode";
import { dateTimeText, formatPixKey, type RewardPayment } from "../../lib/rewardPayments";

const TYPES = Object.keys(PIX_LABEL) as PixType[];
const HINT: Record<PixType, string> = { cpf: "000.000.000-00", cnpj: "00.000.000/0000-00", phone: "(11) 91234-5678", email: "nome@email.com", random: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" };
export const copyText = async (value: string): Promise<boolean> => { try { await navigator.clipboard.writeText(value); return true; } catch { return false; } };
export const Row = ({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) => <div data-total={strong ? "1" : undefined}><span>{label}</span><b>{value}</b></div>;

/** QR Code do código Pix (gerado aqui, no aparelho; nada é enviado para fora). */
export function PixQr({ code }: { code: string }) {
  const svg = useMemo(() => { try { const qr = qrcode(0, "M"); qr.addData(code); qr.make(); return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch { return ""; } }, [code]);
  return svg ? <div className="b2p-qr" role="img" aria-label="QR Code do Pix" dangerouslySetInnerHTML={{ __html: svg }} /> : <p className="b2p-hint">Não foi possível gerar o QR Code. Use o código copia e cola.</p>;
}

/** Como a empresa paga: chave Pix, código copia e cola e QR Code do valor exato. O pagamento é feito no app do banco (o NVU não move dinheiro). */
export function PixPayPanel({ payment }: { payment: RewardPayment }) {
  const [copied, setCopied] = useState(""), [qr, setQr] = useState(false);
  const code = useMemo(() => { try { return payment.pixKey ? buildPixBrCode({ key: payment.pixKey, amountCents: payment.amountCents, name: payment.driverName }) : ""; } catch { return ""; } }, [payment.pixKey, payment.amountCents, payment.driverName]);
  useEffect(() => { if (!copied) return; const timer = window.setTimeout(() => setCopied(""), 2000); return () => window.clearTimeout(timer); }, [copied]);
  const copy = async (what: string, value: string) => setCopied(await copyText(value) ? what : "falhou");
  if (!payment.pixKey) return <p className="b2p-note-box" data-tone="warn" role="note">O motorista ainda não cadastrou a chave Pix. Ele já foi avisado; a chave aparece aqui assim que ele salvar.</p>;
  return <section className="b2p-pix" aria-label="Pagar por Pix">
    <h3>Pagar por Pix</h3>
    <div className="b2p-pix-row"><div><small>{PIX_LABEL[payment.pixType as PixType] || "Chave Pix"} · {payment.driverName}</small><b>{formatPixKey(payment.pixType, payment.pixKey)}</b></div>
      <button type="button" className="b2p-btn" data-v="ghost" data-size="sm" onClick={() => void copy("chave", payment.pixKey)}><Copy size={15} aria-hidden="true" />{copied === "chave" ? "Copiada" : "Copiar chave"}</button></div>
    <div className="b2p-pix-row"><div><small>Valor</small><b>{formatMoney(payment.amountCents)}</b></div></div>
    {code ? <>
      <div className="b2p-pix-code" aria-label="Pix copia e cola">{code}</div>
      <div className="b2p-actions"><button type="button" className="b2p-btn" data-v="primary" data-size="sm" onClick={() => void copy("codigo", code)}><Copy size={15} aria-hidden="true" />{copied === "codigo" ? "Código copiado" : "Copiar Pix copia e cola"}</button>
        <button type="button" className="b2p-btn" data-v="ghost" data-size="sm" aria-expanded={qr} onClick={() => setQr(value => !value)}>{qr ? "Ocultar QR Code" : "Mostrar QR Code"}</button></div>
      {qr ? <PixQr code={code} /> : null}
    </> : null}
    {copied === "falhou" ? <p className="b2p-alert" role="alert">Não foi possível copiar. Selecione o texto e copie manualmente.</p> : null}
    <p className="b2p-hint">Cole o código no app do seu banco (Pix → Pix copia e cola) ou leia o QR Code. Depois de pagar, volte aqui e toque em <b>Marcar como pago</b>.</p>
  </section>;
}

export const receiptText = (payment: RewardPayment): string => {
  const r = payment.receipt;
  if (!r) return "";
  return [`COMPROVANTE DE RECOMPENSA ${r.number}`, `Pago em: ${dateTimeText(r.paidAtMs)}`, `Valor: ${formatMoney(r.amountCents)}`, `Pagador: ${r.payerName}`, `Recebedor: ${r.payeeName}`,
    r.pixKeyMasked ? `Chave Pix: ${r.pixKeyMasked}` : "", r.e2eId ? `Código da transação Pix: ${r.e2eId}` : "", r.campaigns.length ? `Campanhas: ${r.campaigns.join(", ")}` : "",
    "Registro feito no NVU a partir da informação da empresa. O NVU não processa nem confirma o pagamento no banco."].filter(Boolean).join("\n");
};
/** Comprovante: registro do pagamento que a empresa informou, visto pelas duas partes. Não é um comprovante bancário. */
export function ReceiptCard({ payment }: { payment: RewardPayment }) {
  const [copied, setCopied] = useState(false), r = payment.receipt;
  if (!r) return null;
  return <section className="b2p-pix" aria-label="Comprovante">
    <h3>Comprovante {r.number}</h3>
    <div className="b2p-settle">
      <Row label="Pago em" value={dateTimeText(r.paidAtMs)} /><Row label="Valor" value={formatMoney(r.amountCents)} strong /><Row label="Pagador" value={r.payerName} /><Row label="Recebedor" value={r.payeeName} />
      {r.pixKeyMasked ? <Row label="Chave Pix" value={r.pixKeyMasked} /> : null}{r.e2eId ? <Row label="Código da transação" value={r.e2eId} /> : null}
      {r.campaigns.length ? <Row label="Campanhas" value={r.campaigns.join(", ")} /> : null}
      {payment.receivedAtMs ? <Row label="Recebimento confirmado" value={dateTimeText(payment.receivedAtMs)} /> : null}
    </div>
    <p className="b2p-hint">Registro feito no NVU a partir da informação da empresa. O NVU não processa nem confirma o pagamento no banco.</p>
    <div className="b2p-actions"><button type="button" className="b2p-btn" data-v="ghost" data-size="sm" onClick={async () => { setCopied(await copyText(receiptText(payment))); window.setTimeout(() => setCopied(false), 2000); }}><Copy size={15} aria-hidden="true" />{copied ? "Comprovante copiado" : "Copiar comprovante"}</button></div>
  </section>;
}

/** Chave Pix em que o motorista recebe (cadastro e alteração). */
export function DriverPixCard({ pix, busy, onSave }: { pix: { type: string; key: string } | null; busy: boolean; onSave: (type: PixType, key: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false), [type, setType] = useState<PixType>((pix?.type as PixType) || "cpf"), [key, setKey] = useState(""), [error, setError] = useState("");
  const save = async () => { try { const clean = normalizePixKey(type, key); setError(""); await onSave(clean.type, clean.key); setEditing(false); setKey(""); } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível salvar a chave Pix."); } };
  return <section className="b2p-pix" aria-label="Minha chave Pix">
    <h3>Minha chave Pix</h3>
    {pix && !editing ? <div className="b2p-pix-row"><div><small>{PIX_LABEL[pix.type as PixType] || "Chave Pix"}</small><b>{formatPixKey(pix.type, pix.key)}</b></div><button type="button" className="b2p-btn" data-v="ghost" data-size="sm" disabled={busy} onClick={() => { setEditing(true); setType((pix.type as PixType) || "cpf"); }}>Alterar</button></div>
      : <div className="b2p-form">
        {!pix ? <p className="b2p-note-box" data-tone="warn" role="note">Cadastre a chave Pix em que você quer receber. As empresas veem esta chave para pagar você.</p> : null}
        <div className="b2p-seg" role="group" aria-label="Tipo da chave Pix">{TYPES.map(item => <button type="button" key={item} data-on={type === item ? "1" : "0"} aria-pressed={type === item} onClick={() => { setType(item); setError(""); }}>{PIX_LABEL[item]}</button>)}</div>
        <div className="b2p-input"><input value={key} onChange={event => { setKey(event.target.value); setError(""); }} placeholder={HINT[type]} inputMode={type === "email" || type === "random" ? "text" : "tel"} autoComplete="off" aria-label="Chave Pix" /></div>
        {error ? <p className="b2p-alert" role="alert">{error}</p> : null}
        <div className="b2p-actions"><button type="button" className="b2p-btn" data-v="primary" disabled={busy || !key.trim()} onClick={() => void save()}>{busy ? "Salvando…" : "Salvar chave Pix"}</button>{editing ? <button type="button" className="b2p-btn" data-v="ghost" onClick={() => { setEditing(false); setError(""); }}>Cancelar</button> : null}</div>
      </div>}
  </section>;
}
