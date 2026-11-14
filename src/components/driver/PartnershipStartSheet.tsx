import { createPortal } from "react-dom";
import React, { useEffect, useRef, useState } from "react";
import { Handshake, ImagePlus, X } from "lucide-react";
import { auth } from "../../lib/firebase";
import { uploadService } from "../../services/uploadService";
import { preparePhoto } from "../../lib/vehiclePhotoPrepare";
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
  // O que aparece na caixa da foto: a original só se for pequena (abrir uma foto de 15 MB / 50 MP num <img> pode falhar no Android); depois, a foto já preparada (leve).
  const [shown, setShown] = useState<Blob | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!shown) { setPreview(""); return; }
    const url = URL.createObjectURL(shown);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [shown]);
  useEffect(() => { if (!open) { setFile(null); setShown(null); setError(""); setBusy(false); } }, [open]);
  if (!open) return null;
  // A operação inicia sozinha assim que a foto é escolhida; o botão só reaparece para tentar de novo se algo falhar.
  const confirm = async (chosen: File | null = file) => {
    if (!chosen || busy) return;
    if (navigator.onLine === false) { setError("Conecte-se à internet para enviar a foto e iniciar esta operação."); return; }
    setBusy(true); setError("");
    try {
      const uid = auth.currentUser?.uid || "";
      // Foto de até 20 MB de qualquer câmera: é reduzida aqui (leitura segura no Android) antes de subir ao Storage, que aceita menos de 2 MB.
      const prepared = await preparePhoto(chosen, { maxSide: 1600, targetBytes: 1_200_000, poster: false });
      setShown(prepared.blob);
      const ready = new File([prepared.blob], prepared.blob.type === "image/jpeg" ? "veiculo.jpg" : "veiculo.webp", { type: prepared.blob.type });
      const url = await uploadService.uploadImage({ file: ready, companyId: "", userId: uid, folder: partnershipId, storageScope: "partnership-start-photo" });
      await onConfirm(url);
    } catch (reason: any) {
      setError(reason?.message || "Não foi possível iniciar a operação. Tente novamente.");
      setBusy(false);
    }
  };
  return createPortal(<div className="nvu-pss-backdrop" role="presentation" onClick={() => !busy && onClose()}>
    <section className="nvu-pss" role="dialog" aria-modal="true" aria-labelledby="nvu-pss-title" onClick={event => event.stopPropagation()}>
      <header><span className="nvu-pss-badge"><Handshake size={14} aria-hidden="true" /> Parceria</span>
        <button type="button" aria-label="Fechar" disabled={busy} onClick={onClose}><X size={18} aria-hidden="true" /></button></header>
      <h2 id="nvu-pss-title">{operationName || "Operação em parceria"}</h2>
      {partnerName ? <p className="nvu-pss-partner">Acordo com {partnerName}</p> : null}
      <p className="nvu-pss-notice" role="note">{PARTNERSHIP_START_NOTICE}</p>
      {/* Sem `capture`: o Android abre a galeria/seletor de imagens (o motorista escolhe a foto já tirada), não a câmera. */}
      <input ref={input} type="file" accept="image/*" className="nvu-pss-input"
        onChange={event => { const chosen = event.target.files?.[0] || null; setFile(chosen); setShown(chosen && chosen.size <= 3 * 1024 * 1024 ? chosen : null); setError(""); event.target.value = ""; if (chosen) void confirm(chosen); }} />
      <button type="button" className="nvu-pss-photo" onClick={() => input.current?.click()} disabled={busy} data-filled={preview ? "true" : "false"}>
        {preview ? <img src={preview} alt="Foto do veículo selecionada" /> : <span><ImagePlus size={22} aria-hidden="true" />Escolher foto do veículo</span>}
      </button>
      <small className="nvu-pss-hint">{busy ? "Enviando a foto e iniciando a operação…" : error ? "Toque na foto para escolher outra, ou tente novamente." : "Obrigatória para iniciar. Escolha, na galeria, a foto do veículo: a operação inicia assim que você escolher."}</small>
      {error ? <p className="nvu-pss-error" role="alert">{error}</p> : null}
      {error ? <button type="button" className="nvu-pss-start" disabled={!file || busy} onClick={() => void confirm()}>{busy ? "Enviando foto e iniciando…" : "Tentar novamente"}</button> : null}
    </section>
  </div>, document.body);
}
