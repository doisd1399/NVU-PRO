import React from "react";
import { createPortal } from "react-dom";
import { Camera, Check, ImagePlus, LoaderCircle, Pencil, X } from "lucide-react";
import { doc, updateDoc } from "firebase/firestore";
import { toast } from "sonner";
import { useSessionStore } from "../context/AppContext";
import { useCompanyStore } from "../context/CompanyContext";
import { db } from "../lib/firebase";
import { resolveProfilePhoto } from "../lib/resolveProfilePhoto";
import { convertFileToBase64, compressImage } from "../lib/utils";
import { normalizeFileAccessError, snapshotSelectedFile } from "../lib/fileAccess";
import { uploadService } from "../services/uploadService";

export type CompactProfileEditorMode = "driver" | "company";

interface CompactProfileEditorModalProps {
  open: boolean;
  mode: CompactProfileEditorMode;
  onClose: () => void;
}

export function CompactProfileEditorModal({
  open,
  mode,
  onClose,
}: CompactProfileEditorModalProps) {
  const { currentUser, setCurrentUser } = useSessionStore();
  const { activeCompanyId, companies, allCompanies, updateCompany } = useCompanyStore();
  const activeCompany =
    companies.find((company) => company.id === activeCompanyId) ||
    allCompanies.find((company) => company.id === activeCompanyId) ||
    null;
  const [name, setName] = React.useState("");
  const [whatsapp, setWhatsapp] = React.useState("");
  const [photoValue, setPhotoValue] = React.useState<string | null>(null);
  const [logoFile, setLogoFile] = React.useState<File | null>(null);
  const [logoPreview, setLogoPreview] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [processingImage, setProcessingImage] = React.useState(false);
  const [error, setError] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;
    setError("");
    setLogoFile(null);
    setLogoPreview(null);
    if (mode === "driver") {
      setName(currentUser?.name || "");
      setWhatsapp(currentUser?.whatsapp || "");
      setPhotoValue(resolveProfilePhoto(currentUser) || null);
    } else {
      setName(activeCompany?.companyName || "");
      setWhatsapp(activeCompany?.whatsapp || "");
      setPhotoValue(activeCompany?.logoUrl || (activeCompany as any)?.logoURL || null);
    }
  }, [activeCompany, currentUser, mode, open]);

  React.useEffect(() => {
    return () => {
      if (logoPreview?.startsWith("blob:")) URL.revokeObjectURL(logoPreview);
    };
  }, [logoPreview]);

  React.useEffect(() => {
    if (!open) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [loading, onClose, open]);

  if (!open || typeof document === "undefined") return null;

  const isCompany = mode === "company";
  const title = isCompany ? "Editar empresa" : "Editar perfil";
  const subtitle = isCompany
    ? "Atualize o nome e a logo da empresa."
    : "Atualize seu nome e sua foto de perfil.";
  const image = logoPreview || photoValue;

  const handleImageChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const selectedFile = input.files?.[0];
    input.value = "";
    if (!selectedFile) return;
    setError("");
    setProcessingImage(true);
    try {
      if (selectedFile.size > 10 * 1024 * 1024) {
        throw new Error("A imagem é muito grande. Tamanho máximo: 10 MB.");
      }
      const declaredType = String(selectedFile.type || "").toLowerCase();
      if (declaredType && !["image/jpeg", "image/png", "image/webp"].includes(declaredType)) {
        throw new Error("Escolha uma imagem JPG, PNG ou WEBP.");
      }
      const { file } = await snapshotSelectedFile(selectedFile, {
        maxBytes: 10 * 1024 * 1024,
        fallbackName: `${isCompany ? "logo" : "perfil"}-${Date.now()}.jpg`,
      });
      if (isCompany) {
        setLogoFile(file);
        setLogoPreview(URL.createObjectURL(file));
      } else {
        const base64 = await convertFileToBase64(file);
        setPhotoValue(await compressImage(base64, 500, 500, 0.7));
      }
    } catch (cause) {
      const normalized = normalizeFileAccessError(cause);
      setError(normalized.message);
    } finally {
      setProcessingImage(false);
    }
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(isCompany ? "Nome da empresa é obrigatório." : "Nome é obrigatório.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      if (isCompany) {
        if (!activeCompany?.id) throw new Error("Empresa ativa não encontrada.");
        let logoUrl = photoValue || "";
        if (logoFile) {
          if (!currentUser?.id) throw new Error("Sua sessão expirou. Entre novamente.");
          logoUrl = await uploadService.uploadImage({
            file: logoFile,
            companyId: activeCompany.id,
            userId: currentUser.id,
            folder: "company-logos",
            compressionMaxSizeMB: 0.4,
            maxWidthOrHeight: 800,
            maxOutputBytes: 480_000,
          });
        }
        await updateCompany(activeCompany.id, {
          companyName: trimmedName,
          logoUrl,
          whatsapp,
        });
        toast.success("Perfil da empresa atualizado.");
      } else {
        if (!currentUser?.id) throw new Error("Sua sessão expirou. Entre novamente.");
        await updateDoc(doc(db, "users", currentUser.id), {
          name: trimmedName,
          whatsapp,
          profilePhotoURL: photoValue,
          authPhotoURL: currentUser.authPhotoURL || null,
        });
        setCurrentUser({
          ...currentUser,
          name: trimmedName,
          whatsapp,
          profilePhotoURL: photoValue || undefined,
          authPhotoURL: currentUser.authPhotoURL || undefined,
        });
        toast.success("Perfil atualizado.");
      }
      onClose();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Não foi possível salvar as alterações.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div
      className="nvu-profile-edit-modal-overlay fixed inset-0 z-[270] flex items-start justify-center bg-slate-950/35 px-3 pb-4 pt-[calc(300px+env(safe-area-inset-top,0px)+0.75rem)] backdrop-blur-[2px] sm:px-5"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loading) onClose();
      }}
    >
      <section
        className="nvu-profile-edit-modal w-full max-w-[360px] overflow-hidden rounded-[22px] border border-white/70 bg-white/95 shadow-[0_24px_80px_rgba(15,23,42,0.28)] dark:border-white/10 dark:bg-[#17191f]/95"
        role="dialog"
        aria-modal="true"
        aria-labelledby="compact-profile-editor-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-slate-200/80 px-4 py-3 dark:border-white/10">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900">
              <Pencil size={16} />
            </span>
            <div className="min-w-0">
              <h2 id="compact-profile-editor-title" className="truncate text-[15px] font-extrabold text-slate-900 dark:text-white">{title}</h2>
              <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{subtitle}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={loading} aria-label="Fechar edição" className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50 dark:hover:bg-white/10 dark:hover:text-white">
            <X size={18} />
          </button>
        </header>

        <div className="space-y-3 p-4">
          {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700 dark:bg-rose-500/10 dark:text-rose-300" role="alert">{error}</p>}
          <div className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3 dark:bg-white/[0.05]">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-black/10">
              {image ? <img src={image} alt="Pré-visualização" className="h-full w-full object-cover" /> : isCompany ? <ImagePlus size={21} className="text-slate-400" /> : <Camera size={21} className="text-slate-400" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-bold text-slate-800 dark:text-slate-100">{isCompany ? "Logo da empresa" : "Foto do perfil"}</p>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">JPG, PNG ou WEBP · até 10 MB</p>
              <button type="button" onClick={() => inputRef.current?.click()} disabled={loading || processingImage} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 dark:border-white/15 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10">
                {processingImage ? <LoaderCircle size={13} className="animate-spin" /> : <ImagePlus size={13} />}
                Alterar imagem
              </button>
              <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleImageChange} />
            </div>
          </div>

          <label className="block">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">{isCompany ? "Nome da empresa" : "Nome"}</span>
            <input value={name} onChange={(event) => setName(event.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-[13px] font-semibold text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-300/40 dark:border-white/10 dark:bg-white/[0.05] dark:text-white dark:focus:border-white/35" />
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">WhatsApp</span>
            <input type="tel" value={whatsapp} onChange={(event) => setWhatsapp(event.target.value)} placeholder="(00) 00000-0000" className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-[13px] font-semibold text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-300/40 dark:border-white/10 dark:bg-white/[0.05] dark:text-white dark:focus:border-white/35" />
          </label>
        </div>

        <footer className="flex justify-end gap-2 border-t border-slate-200/80 bg-slate-50/75 px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]">
          <button type="button" onClick={onClose} disabled={loading} className="rounded-xl px-3 py-2 text-[12px] font-bold text-slate-500 transition hover:bg-slate-200/70 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-white/10">Cancelar</button>
          <button type="button" onClick={() => void handleSave()} disabled={loading || processingImage} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-[12px] font-extrabold text-white transition hover:bg-slate-700 disabled:cursor-wait disabled:opacity-60 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200">
            {loading ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}
            {loading ? "Salvando…" : "Salvar"}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
