import React, { useEffect, useRef, useState } from "react";
import { Handshake, ImagePlus, X } from "lucide-react";
import { auth } from "../../lib/firebase";
import { uploadService } from "../../services/uploadService";
import "./PartnershipStartSheet.css";

export const PARTNERSHIP_START_NOTICE = "Essa operação é um acordo entre empresas, conclua a operação dentro das especificações.";

/**
 * Início de uma operação em parceria (B2P): aviso do acordo + foto obrigatória do veículo.
 * A foto vai para o Storage da parceria e a URL segue no comando de início, que o servidor valida.
 */
export function PartnershipStartSheet({ open, partnershipId, operationName, partnerName, onClose, onConfirm }: {
  open: boolean; partnershipId: string; operationName: string; partnerName?: string;
  onClose: () => void; onConfirm: (startPhotoUrl: string) => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!file) { setPreview(""); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => { if (!open) { setFile(null); setError(""); setBusy(false); } }, [open]);
  if (!open) return null;
  const confirm = async () => {
    if (!file || busy) return;
    if (navigator.onLine === false) { setError("Conecte-se à internet para enviar a foto e iniciar esta operação."); return; }
    setBusy(true); setError("");
    try {
      const uid = auth.currentUser?.uid || "";
      const url = await uploadService.uploadImage({ file, companyId: "", userId: uid, folder: partnershipId, storageScope: "partnership-start-photo" });
      await onConfirm(url);
    } catch (reason: any) {
      setError(reason?.message || "Não foi possível iniciar a operação. Tente novamente.");
      setBusy(false);
    }
  };
  return <div className="nvu-pss-backdrop" role="presentation" onClick={() => !busy && onClose()}>
    <section className="nvu-pss" role="dialog" aria-modal="true" aria-labelledby="nvu-pss-title" onClick={event => event.stopPropagation()}>
      <header><span className="nvu-pss-badge"><Handshake size={14} aria-hidden="true" /> Parceria</span>
        <button type="button" aria-label="Fechar" disabled={busy} onClick={onClose}><X size={18} aria-hidden="true" /></button></header>
      <h2 id="nvu-pss-title">{operationName || "Operação em parceria"}</h2>
      {partnerName ? <p className="nvu-pss-partner">Acordo com {partnerName}</p> : null}
      <p className="nvu-pss-notice" role="note">{PARTNERSHIP_START_NOTICE}</p>
      {/* Sem `capture`: o Android abre a galeria/seletor de imagens (o motorista escolhe a foto já tirada), não a câmera. */}
      <input ref={input} type="file" accept="image/*" className="nvu-pss-input"
        onChange={event => { setFile(event.target.files?.[0] || null); setError(""); event.target.value = ""; }} />
      <button type="button" className="nvu-pss-photo" onClick={() => input.current?.click()} disabled={busy} data-filled={preview ? "true" : "false"}>
        {preview ? <img src={preview} alt="Foto do veículo selecionada" /> : <span><ImagePlus size={22} aria-hidden="true" />Escolher foto do veículo</span>}
      </button>
      <small className="nvu-pss-hint">{file ? "Toque na foto para trocar." : "Obrigatória para iniciar. Escolha, na galeria, a foto do veículo da operação."}</small>
      {error ? <p className="nvu-pss-error" role="alert">{error}</p> : null}
      <button type="button" className="nvu-pss-start" disabled={!file || busy} onClick={() => void confirm()}>{busy ? "Enviando foto e iniciando…" : "Iniciar operação"}</button>
    </section>
  </div>;
}
