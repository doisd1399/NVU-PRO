import { CachedImage } from "./common/CachedImage";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ImagePlus, LoaderCircle, X } from "lucide-react";
import { toast } from "sonner";
import type { ProfileCoverTarget } from "../lib/profileCover";
import { normalizeFileAccessError, snapshotSelectedFile } from "../lib/fileAccess";
import { registerOptionModal } from "../lib/optionModalStack";
import { saveProfileCover } from "../services/profileCoverService";
import { BannerPhotoCrop } from "./BannerPhotoCrop";

export default function ProfileCoverEditorModal({ viewerId, target, image, onClose }: {
  viewerId: string; target: ProfileCoverTarget; image: string; onClose: () => void;
}) {
  const [crop, setCrop] = useState<File | null>(null), [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState(image), [removed, setRemoved] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null), dialog = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose), busyRef = useRef(busy); closeRef.current = onClose; busyRef.current = busy;
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const close = () => { if (!busyRef.current) closeRef.current(); };
    const modal = registerOptionModal(close);
    const frame = requestAnimationFrame(() => dialog.current?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (!modal.isTop()) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); close(); }
      if (event.key !== "Tab") return;
      const elements = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])') || [])].filter(node => node.getClientRects().length > 0);
      const first = elements[0], last = elements.at(-1);
      if (!first || !last) { event.preventDefault(); dialog.current?.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", keydown, true); window.addEventListener("popstate", close);
    return () => { cancelAnimationFrame(frame); modal.dispose(); window.removeEventListener("keydown", keydown, true); window.removeEventListener("popstate", close); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  const select = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.currentTarget.files?.[0]; event.currentTarget.value = "";
    if (!selected) return;
    setError(""); setBusy(true);
    try {
      if (selected.type && !["image/png", "image/jpeg", "image/webp"].includes(selected.type)) throw new Error("Escolha uma imagem JPG, PNG ou WEBP.");
      const captured = await snapshotSelectedFile(selected, { maxBytes: 10 * 1024 * 1024, fallbackName: "capa.jpg" });
      setCrop(captured.file);
    } catch (cause) { setError(normalizeFileAccessError(cause).message); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!file && !removed) return;
    setBusy(true); setError("");
    try {
      await saveProfileCover(viewerId, target, removed ? null : file);
      toast.success(navigator.onLine === false ? "Capa salva neste aparelho. Será sincronizada quando a conexão voltar." : "Capa salva. Sincronizando…");
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar a capa."); }
    finally { setBusy(false); }
  };
  return createPortal(<div className="nvu-cover-editor-overlay" onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={dialog} tabIndex={-1} className="nvu-cover-editor" role="dialog" aria-modal="true" aria-labelledby="nvu-cover-editor-title" aria-describedby="nvu-cover-editor-description">
      <header><div><h2 id="nvu-cover-editor-title">Capa do perfil</h2><p id="nvu-cover-editor-description">Escolha uma imagem que represente {target.scope === "company" ? "a empresa" : "você"}.</p></div><button type="button" aria-label="Fechar edição da capa" onClick={onClose} disabled={busy}><X size={21}/></button></header>
      <div className="nvu-cover-editor-body">
        {error && <p role="alert" className="nvu-cover-error">{error}</p>}
        {crop ? <BannerPhotoCrop file={crop} aspectRatio={8 / 3} onCancel={() => setCrop(null)} onConfirm={cropped => { setFile(cropped); setRemoved(false); setCrop(null); }} /> : <>
          <div className="nvu-cover-editor-preview">{preview && !removed ? <CachedImage src={preview} alt="Prévia da capa do perfil"/> : <ImagePlus size={30}/>}</div>
          <p>JPG, PNG ou WEBP · até 10 MB</p>
          <div className="nvu-cover-editor-actions"><button type="button" onClick={() => input.current?.click()} disabled={busy}><ImagePlus size={17}/>Escolher imagem</button>{image && <button type="button" onClick={() => { setRemoved(true); setFile(null); setPreview(""); }} disabled={busy}>Remover capa</button>}</div>
        </>}
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" onChange={select} hidden />
      </div>
      <footer><button type="button" disabled={busy} onClick={onClose}>Cancelar</button><button type="button" className="nvu-cover-save" onClick={() => void save()} disabled={busy || Boolean(crop) || (!file && !removed)}>{busy ? <LoaderCircle size={16} className="animate-spin"/> : <Check size={16}/>}Salvar capa</button></footer>
    </section>
  </div>, document.body);
}
