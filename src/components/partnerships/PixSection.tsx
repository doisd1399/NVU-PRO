import React, { useState } from "react";
import { Copy } from "lucide-react";
import { normalizePixKey, PIX_LABEL, roleIn, type Partnership, type PixType } from "../../lib/partnerships";
import { PixPayCard } from "../rewards/PaymentParts";

const TYPES = Object.keys(PIX_LABEL) as PixType[];
const HINT: Record<PixType, string> = { cpf: "000.000.000-00", cnpj: "00.000.000/0000-00", phone: "(11) 91234-5678", email: "nome@empresa.com", random: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" };

/**
 * Chave Pix do recebimento. A empresa que recebe (executora) informa a chave; a que paga (contratante) a vê aqui, copia e paga fora do NVU
 * (o app não move dinheiro). Depois a pagadora marca "pago" e a recebedora confirma "recebido".
 */
export function PixSection({ p, me, busy, onSave }: { p: Partnership; me: string; busy: boolean; onSave: (type: PixType, key: string) => Promise<void> }) {
  const role = roleIn(p, me), pay = p.payment;
  const [editing, setEditing] = useState(false), [type, setType] = useState<PixType>(p.payeePix?.type || "cpf"), [key, setKey] = useState(""), [error, setError] = useState(""), [copied, setCopied] = useState(false);
  if (!p.agreedAmountCents || !["accepted", "active", "completed"].includes(p.status) || pay?.status === "settled" || p.settlement?.goalMissed) return null;
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { setError("Não foi possível copiar. Selecione a chave."); }
  };
  // Concluída com valor a pagar: o mesmo método do pagamento aos motoristas da empresa — chave, valor, Pix copia e cola e QR Code do valor exato.
  if (role === "contractor" && p.payeePix && p.status === "completed" && pay?.status === "pending" && Number(p.settlement?.finalCents) > 0)
    return <PixPayCard pixKey={p.payeePix.key} pixType={p.payeePix.type} holder={p.payeePix.holder || p.executorName || "Recebedor"} amountCents={Number(p.settlement!.finalCents)}
      missingText="A empresa que recebe ainda não informou a chave Pix." />;
  if (role === "contractor") return <section className="b2p-pix" aria-label="Chave Pix para pagamento">
    <h3>Pix para pagar</h3>
    {p.payeePix ? <div className="b2p-pix-row"><div><small>{PIX_LABEL[p.payeePix.type]} · {p.payeePix.holder || "recebedor"}</small><b>{p.payeePix.key}</b></div>
      <button type="button" className="b2p-btn" data-v="ghost" data-size="sm" onClick={() => void copy(p.payeePix!.key)}><Copy size={15} aria-hidden="true" />{copied ? "Copiada" : "Copiar"}</button></div>
      : <p className="b2p-hint">A empresa que recebe ainda não informou a chave Pix. Você será avisado quando ela informar.</p>}
    {error ? <p className="b2p-alert" role="alert">{error}</p> : null}
  </section>;
  if (role !== "executor") return null;
  const save = async () => {
    try { const clean = normalizePixKey(type, key); setError(""); await onSave(clean.type, clean.key); setEditing(false); setKey(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível salvar a chave Pix."); }
  };
  const missing = p.status === "completed" && !p.payeePix;
  return <section className="b2p-pix" aria-label="Sua chave Pix para receber">
    <h3>Sua chave Pix para receber</h3>
    {p.payeePix && !editing ? <div className="b2p-pix-row"><div><small>{PIX_LABEL[p.payeePix.type]}</small><b>{p.payeePix.key}</b></div>
      <button type="button" className="b2p-btn" data-v="ghost" data-size="sm" disabled={busy} onClick={() => { setEditing(true); setType(p.payeePix!.type); }}>Alterar</button></div>
      : <div className="b2p-form">
        {missing ? <p className="b2p-note-box" data-tone="warn" role="note">A operação foi concluída. Informe sua chave Pix para a contratante poder pagar.</p> : <p className="b2p-hint">A contratante vê esta chave ao fim da operação para fazer o pagamento.</p>}
        <div className="b2p-seg" role="group" aria-label="Tipo da chave Pix">{TYPES.map(item => <button type="button" key={item} data-on={type === item ? "1" : "0"} aria-pressed={type === item} onClick={() => { setType(item); setError(""); }}>{PIX_LABEL[item]}</button>)}</div>
        <div className="b2p-input"><input value={key} onChange={event => { setKey(event.target.value); setError(""); }} placeholder={HINT[type]} inputMode={type === "email" || type === "random" ? "text" : "tel"} autoComplete="off" aria-label="Chave Pix" /></div>
        {error ? <p className="b2p-alert" role="alert">{error}</p> : null}
        <div className="b2p-actions"><button type="button" className="b2p-btn" data-v="primary" disabled={busy || !key.trim()} onClick={() => void save()}>{busy ? "Salvando…" : "Salvar chave Pix"}</button>
          {editing ? <button type="button" className="b2p-btn" data-v="ghost" onClick={() => { setEditing(false); setError(""); }}>Cancelar</button> : null}</div>
      </div>}
  </section>;
}
