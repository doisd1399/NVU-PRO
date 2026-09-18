import React, { useState } from "react";
import { useSessionStore } from "../context/AppContext";
import { Button } from "./ui/Button";
import { Camera, X } from "lucide-react";
import { cn, convertFileToBase64, compressImage } from "../lib/utils";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { resolveProfilePhoto } from "../lib/resolveProfilePhoto";
import {
  normalizeFileAccessError,
  snapshotSelectedFile,
} from "../lib/fileAccess";

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

  React.useEffect(() => {
    if (isOpen && currentUser) {
      setName(currentUser.name || "");
      setWhatsapp(currentUser.whatsapp || "");
      setPhotoBase64(resolveProfilePhoto(currentUser) || null);
      setError("");
    }
  }, [isOpen, currentUser]);

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
        const base64 = await convertFileToBase64(file);
        const compressed = await compressImage(base64, 500, 500, 0.7);
        setPhotoBase64(compressed);
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
      await updateDoc(doc(db, "users", currentUser.id), {
        name,
        whatsapp,
        profilePhotoURL: photoBase64,
        authPhotoURL: currentUser.authPhotoURL || null,
      });
      setCurrentUser({
        ...currentUser,
        name,
        whatsapp,
        profilePhotoURL: photoBase64,
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 min-h-[100dvh]">
      <div className="bg-white dark:bg-[#1A1F26] rounded-2xl w-full max-w-sm shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="px-6 py-4 flex items-center justify-between border-b border-gray-100 dark:border-[#2A2F3A]">
          <h3 className="text-xl font-bold text-gray-900 dark:text-[#fafafa]">
            Editar Perfil
          </h3>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 dark:text-[#d4d4d8] dark:hover:text-[#a1a1aa] hover:bg-gray-100 dark:bg-[#27272a] dark:hover:bg-[#3f3f46]/50 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 dark:bg-red-500/10 dark:border-red-500/20 text-red-600 dark:text-red-400 p-3 rounded-xl text-sm mb-4">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-bold text-gray-700 dark:text-[#d4d4d8] mb-1">
              Foto de Perfil
            </label>
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-[#18181b] border border-gray-200 dark:border-[#2A2F3A] flex items-center justify-center overflow-hidden shrink-0">
                {photoBase64 ? (
                  <img
                    src={photoBase64}
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
                  className="w-full text-sm text-gray-500 dark:text-[#a1a1aa] file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 dark:bg-blue-500/10 dark:border-blue-500/20 file:text-blue-700 hover:file:bg-blue-100 dark:bg-blue-500/20 transition-colors"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 dark:text-[#d4d4d8] mb-1">
              Nome Completo
            </label>
            <input
              type="text"
              className="w-full bg-gray-50 dark:bg-[#1A1F26] border border-gray-200 dark:border-[#2A2F3A] rounded-xl px-4 py-2 text-gray-900 dark:text-[#fafafa] focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 dark:text-[#d4d4d8] mb-1">
              WhatsApp
            </label>
            <input
              type="tel"
              className="w-full bg-gray-50 dark:bg-[#1A1F26] border border-gray-200 dark:border-[#2A2F3A] rounded-xl px-4 py-2 text-gray-900 dark:text-[#fafafa] focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="(00) 00000-0000"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
            />
          </div>
        </div>

        <div className="bg-gray-50 dark:bg-[#1A1F26] px-6 py-4 flex justify-end gap-3 border-t border-gray-100 dark:border-[#2A2F3A]">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button
            className="bg-blue-600 hover:bg-blue-700 text-white"
            onClick={handleSave}
            disabled={loading}
          >
            {loading ? "Salvando..." : "Salvar Alterações"}
          </Button>
        </div>
      </div>
    </div>
  );
}