import React, { useEffect, useRef, useState } from "react";
import { CheckCircle2, ImagePlus, TriangleAlert } from "lucide-react";
import { auth } from "../../lib/firebase";
import { formatMoney } from "../../lib/partnerships";
import { preparePhoto } from "../../lib/vehiclePhotoPrepare";
import { checkReceiptAmount } from "../../lib/receiptAmounts";
import { readReceiptImage } from "../../services/paymentReceiptOcr";
import { uploadService } from "../../services/uploadService";

export type ReceiptProofInput = { url: string; readCents: number | null; override?: boolean };
type Reading = { check: "verified" | "different" | "unread"; readCents: number | null };

/**
 * Comprovante do pagamento: a empresa anexa a imagem do banco, o app lê o valor nela e confere com o valor a pagar.
 * Valor igual: confirma. Valor diferente: só confirma se a empresa marcar que está correto. Sem leitura: confirma com o aviso "valor não lido".
 * A leitura é feita no aparelho; o servidor guarda o resultado e o motorista ainda confirma o recebimento.
 */
export function ReceiptAttach({ scope, refId, expectedCents, busy, confirmLabel = "Marcar como pago", onConfirm }: {
  scope: "reward-receipt" | "partnership-receipt"; refId: string; expectedCents: number; busy?: boolean; confirmLabel?: string;
  onConfirm: (proof: ReceiptProofInput) => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [blob, setBlob] = useState<Blob | null>(null), [preview, setPreview] = useState(""), [reading, setReading] = useState<Reading | null>(null);
  const [working, setWorking] = useState<"" | "read" | "send">(""), [override, setOverride] = useState(false), [error, setError] = useState("");
  useEffect(() => { if (!blob) { setPreview(""); return; } const url = URL.createObjectURL(blob); setPreview(url); return () => URL.revokeObjectURL(url); }, [blob]);
  useEffect(() => { setBlob(null); setReading(null); setOverride(false); setError(""); }, [refId, expectedCents]);

  const choose = async (file: File) => {
    setError(""); setReading(null); setOverride(false); setWorking("read");
    try {
      const prepared = await preparePhoto(file, { maxSide: 1800, targetBytes: 1_400_000, poster: false });
      setBlob(prepared.blob);
      setReading(checkReceiptAmount(await readReceiptImage(prepared.blob), expectedCents));
    } catch (reason: any) { setBlob(null); setError(reason?.message || "Não foi possível abrir a imagem. Escolha outra."); }
    finally { setWorking(""); }
  };
  const send = async () => {
    if (!blob || !reading || working) return;
    if (navigator.onLine === false) { setError("Conecte-se à internet para enviar o comprovante."); return; }
    setWorking("send"); setError("");
    try {
      const uid = auth.currentUser?.uid || "";
      const file = new File([blob], blob.type === "image/jpeg" ? "comprovante.jpg" : "comprovante.webp", { type: blob.type || "image/jpeg" });
      const url = await uploadService.uploadImage({ file, companyId: "", userId: uid, folder: refId, storageScope: scope });
      await onConfirm({ url, readCents: reading.readCents, ...(reading.check === "different" ? { override: true } : {}) });
    } catch (reason: any) { setError(reason?.message || "Não foi possível enviar o comprovante."); }
    finally { setWorking(""); }
  };
  const blocked = reading?.check === "different" && !override, disabled = !blob || !reading || blocked || Boolean(busy) || Boolean(working);
  return <div className="b2p-field" data-testid="receipt-attach">
    <span className="b2p-label">Comprovante do pagamento</span>
    <input ref={input} type="file" accept="image/*" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void choose(file); }} />
    <button type="button" className="b2p-btn" data-v="ghost" disabled={Boolean(working) || Boolean(busy)} onClick={() => input.current?.click()} style={{ justifySelf: "start" }}>
      <ImagePlus size={16} aria-hidden="true" />{blob ? "Trocar comprovante" : "Anexar comprovante"}</button>
    {preview ? <img src={preview} alt="Comprovante selecionado" style={{ width: "100%", maxHeight: 220, objectFit: "contain", borderRadius: 10, background: "var(--central-soft)" }} /> : null}
    {working === "read" ? <p className="b2p-hint" role="status">Lendo o valor do comprovante…</p> : null}
    {reading?.check === "verified" ? <p className="b2p-note-box" role="status"><CheckCircle2 size={15} aria-hidden="true" style={{ verticalAlign: "-2px" }} /> Valor conferido: <b>{formatMoney(reading.readCents || 0)}</b></p> : null}
    {reading?.check === "unread" ? <p className="b2p-note-box" data-tone="warn" role="status"><TriangleAlert size={15} aria-hidden="true" style={{ verticalAlign: "-2px" }} /> Não consegui ler o valor. Confira se o comprovante mostra <b>{formatMoney(expectedCents)}</b>; o motorista também confirma o recebimento.</p> : null}
    {reading?.check === "different" ? <div className="b2p-note-box" data-tone="warn" role="alert">
      <TriangleAlert size={15} aria-hidden="true" style={{ verticalAlign: "-2px" }} /> O comprovante mostra <b>{formatMoney(reading.readCents || 0)}</b>, mas o pagamento é de <b>{formatMoney(expectedCents)}</b>.
      <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}><input type="checkbox" checked={override} onChange={event => setOverride(event.target.checked)} />A leitura está errada, o valor pago é o correto</label></div> : null}
    {error ? <p className="b2p-alert" role="alert">{error}</p> : null}
    {!blob && !working ? <p className="b2p-hint">Anexe o comprovante do banco para marcar como pago.</p> : null}
    <div className="b2p-actions"><button type="button" className="b2p-btn" data-v="primary" disabled={disabled} onClick={() => void send()}>{working === "send" || busy ? "Enviando…" : confirmLabel}</button></div>
  </div>;
}

/** Linha com o resultado da conferência do comprovante e o link para abri-lo. */
export function ProofLine({ proof, label }: { proof: { url: string; check: "verified" | "unverified" | "override"; readCents: number | null }; label: string }) {
  return <p className="b2p-note-box" role="note" data-tone={proof.check === "verified" ? undefined : "warn"}>{label}{" "}
    <a href={proof.url} target="_blank" rel="noreferrer noopener" style={{ fontWeight: 700 }}>Ver comprovante</a></p>;
}
