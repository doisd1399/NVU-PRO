import { CachedImage } from "./common/CachedImage";
import { ModalPortal } from "./ui/ModalPortal";
import React, { useState } from "react";
import { useSessionStore } from "../context/AppContext";
import { Button } from "./ui/Button";
import { Camera, X } from "lucide-react";
import { doc, setDoc } from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { resolveProfilePhoto } from "../lib/resolveProfilePhoto";
import {
  normalizeFileAccessError,
  snapshotSelectedFile,
} from "../lib/fileAccess";
import { uploadService } from "../services/uploadService";
import { BannerPhotoCrop } from "./BannerPhotoCrop";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function ProfileModal({ isOpen, onClose }: Props) {
  const { currentUser, setCurrentUser } = useSessionStore();
  const [name, setName] = useState(currentUser?.name || "");
  const [whatsapp, setWhatsapp] = useState(currentUser?.whatsapp || "");
  const [photoBase64, setPhotoBase64] = useState<string | undefined>(
    resolveProfilePhoto(currentUser) || null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pendingCrop, setPendingCrop] = useState<File | null>(null);
  const [croppedFile, setCroppedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");

  React.useEffect(() => {
    if (!croppedFile) { setPreview(""); return; }
    const url = URL.createObjectURL(croppedFile);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [croppedFile]);

  React.useEffect(() => {
    if (isOpen && currentUser) {
      setName(currentUser.name || "");
      setWhatsapp(currentUser.whatsapp || "");
      setPhotoBase64(resolveProfilePhoto(currentUser) || null);
      setError("");
      setPendingCrop(null);
      setCroppedFile(null);
    }
  }, [isOpen, currentUser?.id]);

  if (!isOpen || !currentUser) return null;

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const selectedFile = input.files?.[0];
    input.value = "";

    if (selectedFile) {
      if (selectedFile.size > 20 * 1024 * 1024) {
        setError("A imagem é muito grande.");
        return;
      }
      try {
        setError("");
        const { file } = await snapshotSelectedFile(selectedFile, {
          maxBytes: 20 * 1024 * 1024,
          fallbackName: `perfil-${Date.now()}.jpg`,
        });
        setPendingCrop(file);
      } catch (error) {
        const normalizedError = normalizeFileAccessError(error);
        console.error("Error compressing image:", normalizedError);
        setError(normalizedError.message);
      }
    }
  };

  const handleSave = async () => {
    if (!name.trim()) return setError("Nome é obrigatório");

    setLoading(true);
    setError("");

    try {
      const uid = auth.currentUser?.uid;
      if (!uid) throw new Error("Sua sessão expirou. Entre novamente.");
      const persistedPhoto = croppedFile ? await uploadService.uploadImage({
        file: croppedFile, companyId: uid, userId: uid, storageScope: "profile-photo",
        folder: "avatars", compressionMaxSizeMB: 1.7,
        maxWidthOrHeight: 1600, maxOutputBytes: 1_800_000,
      }) : photoBase64;
      const trimmedName = name.trim();
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
        profilePhotoURL: persistedPhoto,
        authPhotoURL: currentUser.authPhotoURL || null,
      });
      onClose();
    } catch (err: any) {
      setError(err.message || "Erro ao atualizar perfil.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalPortal label="Editar perfil" onClose={onClose} busy={loading}>
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 min-h-[100dvh]">
      <div className="nvu-viewport-modal-card flex flex-col bg-white dark:bg-nvu-surface rounded-2xl w-full max-w-sm shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="px-6 py-4 flex items-center justify-between border-b border-gray-100 dark:border-nvu-line">
          <h3 className="text-xl font-bold text-gray-900 dark:text-nvu-text">
            Editar Perfil
          </h3>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 dark:text-nvu-text-soft dark:hover:text-nvu-muted hover:bg-gray-100 dark:bg-nvu-strip dark:hover:bg-nvu-strip/50 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="nvu-modal-body p-6 space-y-4">
          {error && (
            <div role="alert" className="bg-red-50 dark:bg-red-500/10 dark:border-red-500/20 text-red-600 dark:text-red-400 p-3 rounded-xl text-sm mb-4">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-bold text-gray-700 dark:text-nvu-text-soft mb-1">
              Foto de Perfil
            </label>
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-nvu-surface border border-gray-200 dark:border-nvu-line flex items-center justify-center overflow-hidden shrink-0">
                {preview || photoBase64 ? (
                  <CachedImage
                    src={preview || photoBase64}
                    alt="Avatar"
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <Camera size={24} className="text-gray-400" />
                )}
              </div>
              <div className="flex-1">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoChange}
                  className="w-full text-sm text-gray-500 dark:text-nvu-muted file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 dark:bg-blue-500/10 dark:border-blue-500/20 file:text-blue-700 hover:file:bg-blue-100 dark:bg-blue-500/20 transition-colors"
                />
              </div>
            </div>
          </div>

          {pendingCrop && <BannerPhotoCrop file={pendingCrop} onCancel={() => setPendingCrop(null)}
            onConfirm={(file) => { setCroppedFile(file); setPendingCrop(null); }} />}

          <div>
            <label className="block text-sm font-bold text-gray-700 dark:text-nvu-text-soft mb-1">
              Nome Completo
            </label>
            <input
              type="text"
              className="w-full bg-gray-50 dark:bg-nvu-surface border border-gray-200 dark:border-nvu-line rounded-xl px-4 py-2 text-gray-900 dark:text-nvu-text focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 dark:text-nvu-text-soft mb-1">
              WhatsApp
            </label>
            <input
              type="tel"
              className="w-full bg-gray-50 dark:bg-nvu-surface border border-gray-200 dark:border-nvu-line rounded-xl px-4 py-2 text-gray-900 dark:text-nvu-text focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="(00) 00000-0000"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
            />
          </div>
        </div>

        <div className="bg-gray-50 dark:bg-nvu-surface px-6 py-4 flex justify-end gap-3 border-t border-gray-100 dark:border-nvu-line">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button
            className="bg-blue-600 hover:bg-blue-700 text-white"
            onClick={handleSave}
            disabled={loading || Boolean(pendingCrop)}
          >
            {loading ? "Salvando..." : "Salvar Alterações"}
          </Button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
