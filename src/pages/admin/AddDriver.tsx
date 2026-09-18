import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useOperationalStore } from "../../context/AppContext";
import { Button } from "../../components/ui/Button";
import { X, CheckCircle, Image as ImageIcon } from "lucide-react";
import { convertFileToBase64, compressImage } from "../../lib/utils";
import {
  normalizeFileAccessError,
  snapshotSelectedFile,
} from "../../lib/fileAccess";

export default function AddDriver() {
  const navigate = useNavigate();
  const { createManualDriver } = useOperationalStore();

  const [newDriverName, setNewDriverName] = useState("");
  const [newDriverEmail, setNewDriverEmail] = useState("");
  const [newDriverWhatsapp, setNewDriverWhatsapp] = useState("");
  const [newDriverPhoto, setNewDriverPhoto] = useState<string>("");
  const [addDriverLoading, setAddDriverLoading] = useState(false);
  const [addDriverError, setAddDriverError] = useState("");
  const [addDriverSuccess, setAddDriverSuccess] = useState(false);

  const handleAddManualDriver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDriverName || !newDriverEmail) return;

    setAddDriverLoading(true);
    setAddDriverError("");
    setAddDriverSuccess(false);

    try {
      await createManualDriver({
        name: newDriverName,
        email: newDriverEmail,
        whatsapp: newDriverWhatsapp,
        profilePhotoURL: newDriverPhoto, // Optional Base64
      });

      setAddDriverSuccess(true);
      setNewDriverName("");
      setNewDriverEmail("");
      setNewDriverWhatsapp("");
      setNewDriverPhoto("");

      setTimeout(() => {
        navigate(-1);
      }, 1500);
    } catch (e: any) {
      setAddDriverError(e.message || "Erro ao cadastrar motorista.");
    } finally {
      setAddDriverLoading(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const selectedFile = input.files?.[0];
    input.value = "";

    if (selectedFile) {
      if (selectedFile.size > 2 * 1024 * 1024) {
        setAddDriverError("A imagem deve ser menor que 2MB");
        return;
      }
      try {
        const { file } = await snapshotSelectedFile(selectedFile, {
          maxBytes: 2 * 1024 * 1024,
          fallbackName: `motorista-${Date.now()}.jpg`,
        });
        const base64 = await convertFileToBase64(file);
        const compressed = await compressImage(base64, 200, 200, 0.8);
        setNewDriverPhoto(compressed);
        setAddDriverError("");
      } catch (error) {
        const normalizedError = normalizeFileAccessError(error);
        console.error("Erro ao processar imagem do motorista:", normalizedError);
        setAddDriverError(normalizedError.message);
      }
    }
  };

  return (
    <div className="min-h-[calc(100vh-64px)] bg-slate-50 dark:bg-[#09090b] font-sans pb-8 px-4 pt-4 sm:pt-6 w-full box-border">
      <div className="max-w-2xl mx-auto flex flex-col">
        <div className="bg-white dark:bg-[#1A1F26] rounded-[16px] border border-gray-200 dark:border-[#2A2F3A] shadow-sm w-full flex flex-col relative overflow-hidden">
          <div className="h-1.5 w-full shrink-0 bg-blue-500"></div>

          {/* Header */}
          <div className="shrink-0 p-4 sm:p-5 border-b border-gray-100 dark:border-[#2A2F3A] flex items-center justify-between bg-white dark:bg-[#1A1F26] z-10">
            <h2 className="text-[19px] font-semibold tracking-tight text-gray-900 dark:text-[#fafafa]">
              Novo Motorista
            </h2>
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="w-8 h-8 rounded-full bg-gray-100 dark:bg-[#18181b] text-gray-500 dark:text-[#a1a1aa] flex items-center justify-center hover:bg-gray-200 dark:hover:bg-white/10 transition-colors shrink-0"
            >
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleAddManualDriver} className="flex flex-col flex-1">
            <div className="p-6">
              {addDriverSuccess && (
                <div className="p-4 bg-green-50 dark:bg-green-500/10 dark:border-green-500/20 text-green-700 dark:text-green-400 rounded-lg text-sm mb-6 font-medium flex items-center gap-2">
                  <CheckCircle size={16} /> Motorista cadastrado com sucesso!
                </div>
              )}
              {addDriverError && (
                <div className="p-4 bg-red-50 dark:bg-red-500/10 dark:border-red-500/20 text-red-600 dark:text-red-400 rounded-lg text-sm mb-6 font-medium">
                  {addDriverError}
                </div>
              )}

              <div className="flex flex-col items-center mb-8">
                <div className="w-24 h-24 rounded-full bg-gray-100 dark:bg-[#18181b] border-2 border-dashed border-gray-300 dark:border-[#52525b] flex items-center justify-center overflow-hidden relative group">
                  {newDriverPhoto ? (
                    <img
                      src={newDriverPhoto}
                      alt="Preview"
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <ImageIcon className="text-gray-400" size={32} />
                  )}
                  <label className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer text-white text-xs font-semibold">
                    Alterar
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                  </label>
                </div>
                <p className="text-[12px] text-gray-500 dark:text-[#a1a1aa] mt-2">
                  Foto opcional (Máx: 2MB)
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-[13px] font-semibold text-gray-700 dark:text-[#d4d4d8] mb-1.5">
                    Nome Completo <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={newDriverName}
                    onChange={(e) => setNewDriverName(e.target.value)}
                    placeholder="Ex: João da Silva"
                    className="w-full bg-white dark:bg-[#09090b] border border-gray-200 dark:border-[#2A2F3A] rounded-xl px-3.5 py-2.5 text-[14px] text-gray-900 dark:text-[#fafafa] focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-shadow"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-semibold text-gray-700 dark:text-[#d4d4d8] mb-1.5">
                    Email Corporativo / Login <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={newDriverEmail}
                    onChange={(e) => setNewDriverEmail(e.target.value)}
                    placeholder="joao@transportes.com"
                    className="w-full bg-white dark:bg-[#09090b] border border-gray-200 dark:border-[#2A2F3A] rounded-xl px-3.5 py-2.5 text-[14px] text-gray-900 dark:text-[#fafafa] focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-shadow"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-semibold text-gray-700 dark:text-[#d4d4d8] mb-1.5">
                    WhatsApp (Opcional)
                  </label>
                  <input
                    type="tel"
                    value={newDriverWhatsapp}
                    onChange={(e) => setNewDriverWhatsapp(e.target.value)}
                    placeholder="+55 11 99999-9999"
                    className="w-full bg-white dark:bg-[#09090b] border border-gray-200 dark:border-[#2A2F3A] rounded-xl px-3.5 py-2.5 text-[14px] text-gray-900 dark:text-[#fafafa] focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-shadow"
                  />
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="shrink-0 p-4 border-t border-gray-100 dark:border-[#2A2F3A] bg-gray-50/50 dark:bg-[#1A1F26] flex justify-end gap-3 z-10">
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto h-10 px-5 text-[14px] bg-white dark:bg-[#1A1F26] border-gray-200 dark:border-[#2A2F3A] text-gray-700 dark:text-[#d4d4d8]"
                onClick={() => navigate(-1)}
                disabled={addDriverLoading}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className="w-full sm:w-auto h-10 px-6 text-[14px] bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                disabled={!newDriverName || !newDriverEmail || addDriverLoading}
              >
                {addDriverLoading ? "Cadastrando..." : "Cadastrar"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
