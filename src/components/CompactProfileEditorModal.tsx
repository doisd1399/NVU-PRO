import { CachedImage } from "./common/CachedImage";
import React from "react";
import { ModalPortal } from "./ui/ModalPortal";
import { MultiSelectField } from "./ui/MultiSelectField";
import { AlertTriangle, Camera, Check, ImagePlus, LoaderCircle, Trash2, UserRound, Building2, X } from "lucide-react";
import { doc, setDoc } from "firebase/firestore";
import { toast } from "sonner";
import { useOperationalStore, useSessionStore } from "../context/AppContext";
import { useCompanyStore } from "../context/CompanyContext";
import { auth, db } from "../lib/firebase";
import { resolveProfilePhoto } from "../lib/resolveProfilePhoto";
import { resolveProfileCover } from "../lib/profileCover";
import { normalizeFileAccessError, snapshotSelectedFile } from "../lib/fileAccess";
import { uploadService } from "../services/uploadService";
import { saveProfileCover } from "../services/profileCoverService";
import { useProfileCover } from "../hooks/useProfileCover";
import { addCompanySimulators, deactivateCompanySimulators, loadCompanyGroupCapabilities, renameCompanyGroup } from "../services/companyGroupService";
import { addSummary, deactivateSummary, fleetsOfGroup, groupFailureMessage, groupSimulatorSelection, simulatorChanges } from "../services/companyGroupCore";
import { BannerPhotoCrop } from "./BannerPhotoCrop";
import { cn } from "../lib/utils";

export type CompactProfileEditorMode = "driver" | "company";

interface CompactProfileEditorModalProps {
  open: boolean;
  mode: CompactProfileEditorMode;
  onClose: () => void;
}

type ImageKind = "avatar" | "cover";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const cleanName = (value: string) => value.replace(/\s+/g, " ").trim();

const fieldLabel = "mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-nvu-muted";
const fieldInput = "h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-[14px] font-semibold text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-white/[0.06] dark:text-nvu-text";

/**
 * One edit form for the driver profile and for the company profile: cover, profile photo or logo, name, WhatsApp and, for the
 * company, the simulators it works with (checking one adds it, unchecking one switches it off without deleting anything).
 */
export function CompactProfileEditorModal({ open, mode, onClose }: CompactProfileEditorModalProps) {
  const { currentUser, setCurrentUser, seniorCompanyId } = useSessionStore();
  const { simulators } = useOperationalStore();
  const { activeCompanyId, companies, allCompanies, updateCompany, deleteCompany } = useCompanyStore();
  const activeCompany =
    companies.find((company) => company.id === activeCompanyId) ||
    allCompanies.find((company) => company.id === activeCompanyId) ||
    null;
  const isCompany = mode === "company";
  const viewerId = currentUser?.id || "";
  const coverTarget = React.useMemo(() => ({ scope: mode, profileId: (isCompany ? activeCompany?.id : viewerId) || "" }) as const, [activeCompany?.id, isCompany, mode, viewerId]);
  const cover = useProfileCover(viewerId, coverTarget, resolveProfileCover(isCompany ? activeCompany : currentUser));

  const [name, setName] = React.useState("");
  const [ownerName, setOwnerName] = React.useState("");
  const [whatsapp, setWhatsapp] = React.useState("");
  const [photoValue, setPhotoValue] = React.useState<string | null>(null);
  const [photoFile, setPhotoFile] = React.useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = React.useState<string | null>(null);
  const [coverFile, setCoverFile] = React.useState<File | null>(null);
  const [coverPreview, setCoverPreview] = React.useState<string | null>(null);
  const [coverRemoved, setCoverRemoved] = React.useState(false);
  const [coverFailed, setCoverFailed] = React.useState("");
  const [pendingCrop, setPendingCrop] = React.useState<{ kind: ImageKind; file: File } | null>(null);
  const [simulatorValues, setSimulatorValues] = React.useState<string[]>([]);
  const [simulatorNote, setSimulatorNote] = React.useState("");
  const [capabilities, setCapabilities] = React.useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [processingImage, setProcessingImage] = React.useState(false);
  const [error, setError] = React.useState("");
  const photoInput = React.useRef<HTMLInputElement>(null);
  const coverInput = React.useRef<HTMLInputElement>(null);

  const fleets = React.useMemo(() => isCompany ? fleetsOfGroup(activeCompany, companies as any[]) : [], [activeCompany, companies, isCompany]);
  const selection = React.useMemo(() => groupSimulatorSelection(activeCompany, companies as any[], simulators as any[]), [activeCompany, companies, simulators]);
  const isOwner = Boolean(activeCompany && viewerId && (activeCompany.ownerId === viewerId || activeCompany.userId === viewerId));
  const canManage = isOwner || Boolean(activeCompany && seniorCompanyId && seniorCompanyId === activeCompany.id);
  const showSimulators = isCompany && canManage && capabilities.includes("add-simulators");
  const canSwitchOff = capabilities.includes("deactivate-simulators");
  const changes = React.useMemo(() => simulatorChanges(selection, simulatorValues), [selection, simulatorValues]);

  React.useEffect(() => {
    if (!open) return;
    setError(""); setSimulatorNote(""); setConfirmDelete(false);
    setPhotoFile(null); setPhotoPreview(null); setCoverFile(null); setCoverPreview(null); setCoverRemoved(false); setPendingCrop(null);
    if (mode === "driver") {
      setName(currentUser?.name || "");
      setWhatsapp(currentUser?.whatsapp || "");
      setPhotoValue(resolveProfilePhoto(currentUser) || null);
    } else {
      setName(activeCompany?.companyName || "");
      setOwnerName(activeCompany?.ownerName || "");
      setWhatsapp(activeCompany?.whatsapp || "");
      setPhotoValue(activeCompany?.logoUrl || (activeCompany as any)?.logoURL || null);
    }
  // Live presence/profile snapshots must not discard an in-progress form.
  }, [activeCompany?.id, currentUser?.id, mode, open]);

  React.useEffect(() => { if (open) setSimulatorValues(selection.selected); }, [open, activeCompany?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (!open || !isCompany) return;
    let current = true;
    loadCompanyGroupCapabilities().then(list => { if (current) setCapabilities(list); }, () => undefined);
    return () => { current = false; };
  }, [open, isCompany, viewerId]);

  React.useEffect(() => () => { if (photoPreview?.startsWith("blob:")) URL.revokeObjectURL(photoPreview); }, [photoPreview]);
  React.useEffect(() => () => { if (coverPreview?.startsWith("blob:")) URL.revokeObjectURL(coverPreview); }, [coverPreview]);

  if (!open || typeof document === "undefined") return null;

  const title = isCompany ? "Editar empresa" : "Editar perfil";
  const subtitle = isCompany ? "Capa, logo, nome, contato e simuladores da empresa." : "Capa, foto, nome e contato do seu perfil.";
  const avatarImage = photoPreview || photoValue;
  const coverImage = coverRemoved ? "" : coverPreview || cover.src;
  const busy = loading || deleting;

  const chooseImage = (kind: ImageKind) => async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const selectedFile = input.files?.[0];
    input.value = "";
    if (!selectedFile) return;
    setError("");
    setProcessingImage(true);
    try {
      if (selectedFile.size > MAX_IMAGE_BYTES) throw new Error("A imagem é muito grande. Tamanho máximo: 10 MB.");
      const declaredType = String(selectedFile.type || "").toLowerCase();
      if (declaredType && !IMAGE_TYPES.includes(declaredType)) throw new Error("Escolha uma imagem JPG, PNG ou WEBP.");
      const { file } = await snapshotSelectedFile(selectedFile, {
        maxBytes: MAX_IMAGE_BYTES,
        fallbackName: `${kind === "cover" ? "capa" : isCompany ? "logo" : "perfil"}-${Date.now()}.jpg`,
      });
      setPendingCrop({ kind, file });
    } catch (cause) {
      setError(normalizeFileAccessError(cause).message);
    } finally {
      setProcessingImage(false);
    }
  };

  const changeSimulators = (next: string[]) => {
    const keep = new Set(next);
    // The simulator of the environment being edited stays, and a server that cannot switch simulators off keeps them all.
    const locked = !canSwitchOff ? selection.selected : selection.currentValue ? [selection.currentValue] : [];
    const missing = locked.filter(value => !keep.has(value));
    if (missing.length) {
      setSimulatorNote(!canSwitchOff
        ? "Desativar simuladores estará disponível após a atualização do servidor."
        : "Esse é o simulador do ambiente atual. Troque para outro simulador da empresa antes de desativá-lo.");
      setSimulatorValues([...new Set([...next, ...missing])]);
      return;
    }
    setSimulatorNote("");
    setSimulatorValues(next);
  };

  const saveCover = async (uid: string, profileId: string) => {
    if (!coverFile && !coverRemoved) return;
    await saveProfileCover(uid, { scope: mode, profileId }, coverRemoved ? null : coverFile);
  };

  const handleSave = async () => {
    const trimmedName = cleanName(name);
    if (!trimmedName) {
      setError(isCompany ? "Nome da empresa é obrigatório." : "Nome é obrigatório.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      if (isCompany) {
        if (!activeCompany?.id) throw new Error("Empresa ativa não encontrada.");
        if (!viewerId) throw new Error("Sua sessão expirou. Entre novamente.");
        const trimmedOwner = cleanName(ownerName);
        if (!trimmedOwner) throw new Error("Informe o proprietário (responsável).");
        let logoUrl = photoValue || "";
        if (photoFile) {
          logoUrl = await uploadService.uploadImage({
            file: photoFile, companyId: activeCompany.id, userId: viewerId, folder: "company-logos",
            compressionMaxSizeMB: 1.7, maxWidthOrHeight: 1600, maxOutputBytes: 1_800_000,
          });
        }
        const nameChanged = canManage && trimmedName !== cleanName(activeCompany.companyName || "");
        const renameThroughServer = nameChanged && (capabilities.includes("rename") || fleets.length > 1);
        if (renameThroughServer) {
          if (!capabilities.includes("rename")) throw new Error("Para trocar o nome de uma empresa com vários simuladores, o servidor precisa estar atualizado. Tente novamente mais tarde.");
          try { await renameCompanyGroup(activeCompany.id, trimmedName); }
          catch (cause) { throw new Error(groupFailureMessage(cause)); }
        }
        // Logo, contact and owner are shared by every simulator of the company; each fleet document keeps its own copy.
        const shared = { logoUrl, whatsapp, ownerName: trimmedOwner };
        for (const fleet of fleets.length ? fleets : [activeCompany]) {
          await updateCompany(fleet.id, fleet.id === activeCompany.id && nameChanged && !renameThroughServer ? { ...shared, companyName: trimmedName } : shared);
        }
        await saveCover(viewerId, activeCompany.id);
        let simulatorMessage = "";
        if (showSimulators && (changes.add.length || changes.remove.length)) {
          try {
            const parts: string[] = [];
            if (changes.add.length) parts.push(addSummary(await addCompanySimulators(activeCompany.id, changes.add)));
            if (changes.remove.length) parts.push(deactivateSummary(await deactivateCompanySimulators(activeCompany.id, changes.remove.map(item => item.companyId))));
            simulatorMessage = parts.join(" ");
          } catch (cause) {
            throw new Error(`Dados salvos, mas os simuladores não foram alterados. ${groupFailureMessage(cause)}`);
          }
        }
        toast.success(simulatorMessage ? `Perfil da empresa atualizado. ${simulatorMessage}` : "Perfil da empresa atualizado.");
      } else {
        const uid = auth.currentUser?.uid;
        if (!uid) throw new Error("Sua sessão expirou. Entre novamente.");
        let persistedPhoto = photoValue;
        if (photoFile) {
          persistedPhoto = await uploadService.uploadImage({
            file: photoFile, companyId: uid, userId: uid, storageScope: "profile-photo",
            folder: "avatars", compressionMaxSizeMB: 1.7,
            maxWidthOrHeight: 1600, maxOutputBytes: 1_800_000,
          });
        }
        const profileUpdatedAt = new Date().toISOString();
        await setDoc(doc(db, "users", uid), {
          name: trimmedName,
          whatsapp,
          profilePhotoURL: persistedPhoto,
          authPhotoURL: currentUser.authPhotoURL || null,
          profileNameSource: "user_edit",
          profileNameUpdatedAt: profileUpdatedAt,
          profilePhotoSource: "user_edit",
          profilePhotoUpdatedAt: profileUpdatedAt,
          updatedAt: profileUpdatedAt,
        }, { merge: true });
        setCurrentUser({
          ...currentUser,
          name: trimmedName,
          profileNameSource: "user_edit",
          profileNameUpdatedAt: profileUpdatedAt,
          profilePhotoSource: "user_edit",
          profilePhotoUpdatedAt: profileUpdatedAt,
          whatsapp,
          profilePhotoURL: persistedPhoto || undefined,
          authPhotoURL: currentUser.authPhotoURL || undefined,
        });
        await saveCover(uid, uid);
        toast.success("Perfil atualizado.");
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar as alterações.");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!activeCompany?.id) return;
    setDeleting(true);
    setError("");
    try {
      await deleteCompany(activeCompany.id);
      setConfirmDelete(false);
      onClose();
    } catch (cause) {
      setConfirmDelete(false);
      setError(cause instanceof Error ? cause.message : "Não foi possível excluir a empresa.");
    } finally {
      setDeleting(false);
    }
  };

  const AvatarIcon = isCompany ? Building2 : UserRound;
  const preview = simulatorValues.length === 0 && showSimulators ? "Escolha ao menos um simulador." : "";

  return (
    <ModalPortal label={title} onClose={onClose} busy={busy}>
    <div
      className="nvu-profile-edit-modal-overlay fixed inset-0 z-[270] flex items-center justify-center bg-slate-950/45 px-3 py-4 backdrop-blur-[2px] sm:px-5"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}
    >
      <section
        className="nvu-profile-edit-modal nvu-viewport-modal-card flex max-h-[calc(100dvh-32px)] w-full max-w-[440px] flex-col overflow-hidden rounded-[22px] border border-white/70 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.32)] dark:border-white/10 dark:bg-nvu-surface"
        data-testid="profile-editor"
        data-mode={mode}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200/80 px-4 py-3 dark:border-white/10">
          <div className="min-w-0">
            <h2 id="compact-profile-editor-title" className="truncate text-[16px] font-extrabold text-slate-900 dark:text-white">{title}</h2>
            <p className="truncate text-[11.5px] text-slate-500 dark:text-nvu-muted">{subtitle}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Fechar edição" className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50 dark:hover:bg-white/10 dark:hover:text-white">
            <X size={18} />
          </button>
        </header>

        <div className="nvu-modal-body min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {error && <p className="mx-4 mt-3 rounded-xl bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700 dark:bg-rose-500/10 dark:text-rose-300" role="alert">{error}</p>}
          {pendingCrop && (
            <div className="px-4 pt-3">
              <BannerPhotoCrop file={pendingCrop.file} aspectRatio={pendingCrop.kind === "cover" ? 8 / 3 : 1}
                onCancel={() => setPendingCrop(null)}
                onConfirm={(cropped) => {
                  const url = URL.createObjectURL(cropped);
                  if (pendingCrop.kind === "cover") { setCoverFile(cropped); setCoverPreview(url); setCoverRemoved(false); }
                  else { setPhotoFile(cropped); setPhotoPreview(url); }
                  setPendingCrop(null);
                }} />
            </div>
          )}

          {/* Cover with the profile photo on its lower edge, like the profile page. */}
          <div className="px-4 pt-4">
            <div className="relative" data-testid="profile-editor-cover-area">
              <div className="relative aspect-[8/3] w-full overflow-hidden rounded-[15px] border border-slate-200 bg-slate-100 dark:border-white/10 dark:bg-white/[0.06]" data-testid="profile-editor-cover">
                {coverImage && coverFailed !== coverImage
                  ? <CachedImage src={coverImage} alt="Capa do perfil" className="h-full w-full object-cover" onError={() => setCoverFailed(coverImage)} />
                  : <span className="grid h-full w-full place-items-center text-[11.5px] text-slate-400 dark:text-nvu-muted"><span className="flex flex-col items-center gap-1.5"><ImagePlus size={22} aria-hidden="true" />Sem capa</span></span>}
                <div className="absolute bottom-2 right-2 flex gap-1.5">
                  {coverImage && (
                    <button type="button" onClick={() => { setCoverRemoved(true); setCoverFile(null); setCoverPreview(null); }} disabled={busy || processingImage}
                      aria-label="Remover capa" className="grid h-8 w-8 place-items-center rounded-lg bg-black/60 text-white backdrop-blur disabled:opacity-50"><Trash2 size={15} /></button>
                  )}
                  <button type="button" onClick={() => coverInput.current?.click()} disabled={busy || processingImage}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-black/60 px-2.5 text-[12px] font-bold text-white backdrop-blur disabled:opacity-50">
                    {processingImage ? <LoaderCircle size={14} className="animate-spin" /> : <Camera size={14} />}Alterar capa
                  </button>
                </div>
                <input ref={coverInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={chooseImage("cover")} aria-label="Escolher capa" />
              </div>
              <div className="-mt-7 flex items-end gap-3 px-3">
                <button type="button" onClick={() => photoInput.current?.click()} disabled={busy || processingImage}
                  aria-label={isCompany ? "Alterar logo da empresa" : "Alterar foto do perfil"} data-testid="profile-editor-avatar"
                  className="relative h-[68px] w-[68px] shrink-0 overflow-visible rounded-2xl border-[3px] border-white bg-slate-100 shadow-sm dark:border-nvu-surface dark:bg-white/[0.08]">
                  <span className="grid h-full w-full place-items-center overflow-hidden rounded-[13px]">
                    {avatarImage ? <CachedImage src={avatarImage} alt="Pré-visualização" className="h-full w-full object-cover" /> : <AvatarIcon size={24} className="text-slate-400" />}
                  </span>
                  <span className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full border-2 border-white bg-sky-600 text-white dark:border-nvu-surface"><Camera size={12} aria-hidden="true" /></span>
                </button>
                <div className="min-w-0 pb-1">
                  <p className="text-[12.5px] font-bold text-slate-800 dark:text-nvu-text">{isCompany ? "Logo da empresa" : "Foto do perfil"}</p>
                  <p className="text-[11px] text-slate-500 dark:text-nvu-muted">JPG, PNG ou WEBP · até 10 MB</p>
                </div>
                <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={chooseImage("avatar")} aria-label={isCompany ? "Escolher logo" : "Escolher foto"} />
              </div>
            </div>
          </div>

          <div className="space-y-3.5 px-4 pb-4 pt-4">
            <label className="block">
              <span className={fieldLabel}>{isCompany ? "Nome da empresa" : "Nome"}</span>
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={200} disabled={isCompany && !canManage} className={fieldInput} autoComplete="off" />
              {isCompany && (
                <span className="mt-1 block text-[11.5px] text-slate-500 dark:text-nvu-muted">
                  {canManage ? "O novo nome vale para todos os simuladores da empresa." : "Só o proprietário da empresa troca o nome."}
                </span>
              )}
            </label>

            {isCompany && (
              <label className="block">
                <span className={fieldLabel}>Proprietário (responsável)</span>
                <input value={ownerName} onChange={(event) => setOwnerName(event.target.value)} maxLength={120} className={fieldInput} autoComplete="off" />
              </label>
            )}

            <label className="block">
              <span className={fieldLabel}>WhatsApp</span>
              <input type="tel" value={whatsapp} onChange={(event) => setWhatsapp(event.target.value)} placeholder="(00) 00000-0000" className={fieldInput} autoComplete="off" />
            </label>

            {showSimulators && (
              <div data-testid="profile-editor-simulators">
                <span className={fieldLabel}>Simuladores de atuação</span>
                <MultiSelectField title="Simuladores de atuação" description="Marque os simuladores em que a empresa atua."
                  placeholder="Selecione os simuladores" options={selection.options} values={simulatorValues} onChange={changeSimulators} emptyMessage="Nenhum simulador ativo disponível." />
                <p className="mt-1 text-[11.5px] leading-snug text-slate-500 dark:text-nvu-muted">
                  Marcar adiciona o simulador à empresa. Desmarcar desativa, sem apagar motoristas nem histórico; marcar de novo reativa.
                </p>
                {simulatorNote && <p role="status" className="mt-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11.5px] font-semibold text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">{simulatorNote}</p>}
                {(changes.add.length > 0 || changes.remove.length > 0) && (
                  <ul className="mt-1.5 space-y-0.5 text-[11.5px] font-semibold text-slate-700 dark:text-nvu-text" data-testid="profile-editor-simulator-changes">
                    {changes.add.length > 0 && <li>Será adicionado: {changes.add.map(value => selection.options.find(option => option.value === value)?.label || value).join(", ")}</li>}
                    {changes.remove.length > 0 && <li>Será desativado: {changes.remove.map(item => selection.options.find(option => option.value === item.value)?.label || item.value).join(", ")}</li>}
                  </ul>
                )}
                {preview && <p role="alert" className="mt-1 text-[11.5px] font-semibold text-rose-600">{preview}</p>}
              </div>
            )}

            {isCompany && canManage && activeCompany && (
              <div className="border-t border-slate-200/80 pt-3 dark:border-white/10">
                <button type="button" onClick={() => setConfirmDelete(true)} disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50 dark:text-rose-400 dark:hover:bg-rose-500/10">
                  <Trash2 size={15} />Excluir empresa
                </button>
              </div>
            )}
          </div>
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-slate-200/80 bg-slate-50/80 px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-xl px-3.5 py-2 text-[13px] font-bold text-slate-500 transition hover:bg-slate-200/70 disabled:opacity-50 dark:text-nvu-text-soft dark:hover:bg-white/10">Cancelar</button>
          <button type="button" onClick={() => void handleSave()} disabled={busy || processingImage || Boolean(pendingCrop) || (showSimulators && simulatorValues.length === 0)}
            className={cn("inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2 text-[13px] font-extrabold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50")}>
            {loading ? <LoaderCircle size={15} className="animate-spin" /> : <Check size={15} />}
            {loading ? "Salvando…" : "Salvar"}
          </button>
        </footer>

        {confirmDelete && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-slate-950/60 p-4" role="alertdialog" aria-modal="true" aria-label="Excluir empresa">
            <div className="w-full max-w-[340px] rounded-2xl bg-white p-5 text-center shadow-2xl dark:bg-nvu-surface">
              <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400"><AlertTriangle size={24} /></div>
              <h3 className="text-[17px] font-bold text-slate-900 dark:text-white">Excluir empresa</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-slate-600 dark:text-nvu-muted">
                Tem certeza que deseja excluir <b>{activeCompany?.companyName}</b>? A empresa será arquivada e os vínculos serão removidos. O histórico será preservado. Encerre as operações em aberto antes de continuar.
              </p>
              <div className="mt-4 flex gap-2">
                <button type="button" onClick={() => setConfirmDelete(false)} disabled={deleting} className="h-11 flex-1 rounded-xl border border-slate-200 text-[14px] font-semibold text-slate-700 dark:border-white/10 dark:text-nvu-text-soft">Cancelar</button>
                <button type="button" onClick={() => void handleDelete()} disabled={deleting} className="h-11 flex-1 rounded-xl bg-rose-600 text-[14px] font-semibold text-white disabled:opacity-60">{deleting ? "Excluindo…" : "Sim, excluir"}</button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
    </ModalPortal>
  );
}
