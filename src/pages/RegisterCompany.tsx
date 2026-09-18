import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useOperationalStore, useSessionStore } from "../context/AppContext";
import { Card, CardContent } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { SafeSelect } from "../components/ui/SafeSelect";
import { db, storage, auth } from "../lib/firebase";
import { signInWithGoogleAccount } from "../services/googleAuthService";
import { collection, addDoc, doc, setDoc } from "firebase/firestore";
import { ref, uploadString, getDownloadURL } from "firebase/storage";
import { toast } from "sonner";
import { Upload, ImageIcon, ArrowLeft, LogIn } from "lucide-react";
import { generateCnpj } from "../lib/cnpj";
import {
  normalizeFileAccessError,
  snapshotSelectedFile,
} from "../lib/fileAccess";

const REGISTRATION_IMAGE_MAX_BYTES = 280_000;
const REGISTRATION_UPLOAD_TIMEOUT_MS = 25_000;

const dataUrlByteLength = (dataUrl: string) => {
  const base64 = dataUrl.split(",")[1] || "";
  return Math.ceil((base64.length * 3) / 4);
};

const compressRegistrationImage = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Selecione um arquivo de imagem válido."));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () =>
        reject(new Error("Não foi possível processar a imagem selecionada."));
      image.onload = () => {
        const maxDimension = 420;
        const ratio = Math.min(1, maxDimension / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * ratio));
        canvas.height = Math.max(1, Math.round(image.height * ratio));

        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("Não foi possível preparar a imagem."));
          return;
        }

        context.drawImage(image, 0, 0, canvas.width, canvas.height);

        const qualities = [0.76, 0.68, 0.58, 0.48, 0.38];
        let result = canvas.toDataURL("image/jpeg", qualities[0]);
        for (const quality of qualities.slice(1)) {
          if (dataUrlByteLength(result) <= REGISTRATION_IMAGE_MAX_BYTES) break;
          result = canvas.toDataURL("image/jpeg", quality);
        }

        if (dataUrlByteLength(result) > REGISTRATION_IMAGE_MAX_BYTES) {
          reject(new Error("A imagem ficou muito grande mesmo após a compactação."));
          return;
        }

        resolve(result);
      };
      image.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("storage-upload-timeout")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

type PersistedRegistrationImage = {
  value: string;
  transport: "none" | "storage" | "firestore-data-url";
  storagePath: string;
};

const persistRegistrationImage = async (
  dataUrl: string | null,
  suffix: "logo" | "owner",
): Promise<PersistedRegistrationImage> => {
  if (!dataUrl || !dataUrl.startsWith("data:image/")) {
    return { value: "", transport: "none", storagePath: "" };
  }

  const storagePath =
    `empresas/company_registrations/recruitment_photos/${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 10)}_${suffix}.jpg`;
  const imageRef = ref(
    storage,
    storagePath,
  );

  try {
    await withTimeout(
      uploadString(imageRef, dataUrl, "data_url", {
        contentType: "image/jpeg",
        cacheControl: "public,max-age=31536000,immutable",
      }),
      REGISTRATION_UPLOAD_TIMEOUT_MS,
    );
    const downloadUrl = await withTimeout(
      getDownloadURL(imageRef),
      REGISTRATION_UPLOAD_TIMEOUT_MS,
    );
    return { value: downloadUrl, transport: "storage", storagePath };
  } catch (error) {
    // The registration must not silently lose an image when Storage is slow,
    // unavailable or rejects the public registration flow. The compressed
    // data URL is small enough to remain inside the Firestore document limit.
    console.warn(
      `[RegisterCompany] Firebase Storage unavailable for ${suffix}; using Firestore fallback.`,
      error,
    );
    return { value: dataUrl, transport: "firestore-data-url", storagePath };
  }
};

export default function RegisterCompany() {
  const navigate = useNavigate();
  const {
    currentUser,
    authInitialized,
    sessionUiReady,
    logOutApp,
  } = useSessionStore();
  const { simulators = [], simulatorsLoading, simulatorsError } = useOperationalStore();
  const verifiedCurrentUser =
    authInitialized &&
    sessionUiReady &&
    auth.currentUser?.uid === currentUser?.id
      ? currentUser
      : null;

  const [formData, setFormData] = useState({
    companyName: "",
    ownerName: "",
    email: "",
    whatsapp: "",
    cnpj: generateCnpj(),
    simulatorName: "",
    simulatorId: "",
    companyLogoURL: "",
    ownerPhotoUrl: "",
  });

  const activeSimulators = (Array.isArray(simulators) ? simulators : []).filter(
    (s: any) => s.active !== false,
  );

  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [ownerPhotoPreview, setOwnerPhotoPreview] = useState<string | null>(
    null,
  );
  const [uploadingImage, setUploadingImage] = useState(false);
  const imageSelectionVersion = useRef(0);
  const formIdentityUidRef = useRef<string | null>(null);
  const activeIdentityUid =
    verifiedCurrentUser?.id || auth.currentUser?.uid || null;

  useEffect(() => {
    if (activeIdentityUid === formIdentityUidRef.current) return;

    formIdentityUidRef.current = activeIdentityUid;
    setFormData((prev) => ({
      ...prev,
      ownerName: activeIdentityUid
        ? verifiedCurrentUser?.name || auth.currentUser?.displayName || prev.ownerName
        : "",
      email: activeIdentityUid
        ? verifiedCurrentUser?.email || auth.currentUser?.email || prev.email
        : "",
      whatsapp: activeIdentityUid
        ? verifiedCurrentUser?.whatsapp || prev.whatsapp
        : "",
      cnpj: prev.cnpj || generateCnpj(),
      ownerPhotoUrl: "",
    }));
    setOwnerPhotoPreview(null);
  }, [
    activeIdentityUid,
    verifiedCurrentUser?.name,
    verifiedCurrentUser?.email,
    verifiedCurrentUser?.whatsapp,
  ]);

  const handleImageSelect = async (
    e: React.ChangeEvent<HTMLInputElement>,
    isOwnerPhoto: boolean = false,
  ) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    const selectionVersion = ++imageSelectionVersion.current;
    setUploadingImage(true);
    try {
      const { file: stableFile } = await snapshotSelectedFile(file, {
        maxBytes: 10 * 1024 * 1024,
        fallbackName: `cadastro-${Date.now()}.jpg`,
      });
      const dataUrl = await compressRegistrationImage(stableFile);
      if (selectionVersion !== imageSelectionVersion.current) return;
      if (isOwnerPhoto) {
        setOwnerPhotoPreview(dataUrl);
      } else {
        setPhotoPreview(dataUrl);
      }
    } catch (error: unknown) {
      const normalizedError = normalizeFileAccessError(error);
      toast.error(normalizedError.message);
    } finally {
      if (selectionVersion === imageSelectionVersion.current) {
        setUploadingImage(false);
      }
    }
  };

  const [submitting, setSubmitting] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);

  const handleGoogleAccess = async () => {
    if (auth.currentUser?.uid || authenticating) return;

    setAuthenticating(true);
    try {
      const resultUser = await signInWithGoogleAccount();

      // Bind the company registration to the exact Google identity that will
      // later receive the approval/rejection state. This mirrors the driver
      // application flow and prevents a pending registration from becoming
      // detached from its owner.
      formIdentityUidRef.current = resultUser.uid;
      setFormData((current) => ({
        ...current,
        ownerName: current.ownerName || resultUser.displayName || "",
        email: resultUser.email || current.email,
      }));
    } catch (error: any) {
      const errorText = `${error?.message || ""} ${error?.code || ""} ${error?.name || ""} ${error?.cause?.message || ""}`.toLowerCase();
      const cancelled =
        error?.code === "auth/popup-closed-by-user" ||
        error?.code === "auth/cancelled-popup-request" ||
        errorText.includes("12501") ||
        errorText.includes("cancel") ||
        errorText.includes("fechar");

      if (!cancelled) {
        console.error("[RegisterCompany] Falha no login Google:", error);
        toast.error("Não foi possível acessar com Google. Tente novamente.");
      }
    } finally {
      setAuthenticating(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (uploadingImage) {
      toast.info("Aguarde o processamento da imagem terminar.");
      return;
    }
    if (!photoPreview) {
      toast.error("A foto da logo da empresa é obrigatória.");
      return;
    }
    if (!ownerPhotoPreview) {
      toast.error("A foto do proprietário é obrigatória.");
      return;
    }
    const authenticatedUid = auth.currentUser?.uid || null;
    if (!authenticatedUid) {
      toast.error("Acesse com Google antes de enviar o cadastro da empresa.");
      return;
    }
    if (
      formIdentityUidRef.current &&
      formIdentityUidRef.current !== authenticatedUid
    ) {
      toast.error(
        "Sua sessão mudou durante o cadastro. Confirme novamente a conta Google.",
      );
      return;
    }
    setSubmitting(true);
    try {
      setUploadingImage(Boolean(photoPreview || ownerPhotoPreview));

      const [companyLogo, ownerPhoto] = await Promise.all([
        persistRegistrationImage(photoPreview, "logo"),
        persistRegistrationImage(ownerPhotoPreview, "owner"),
      ]);

      const normalizedEmail = String(auth.currentUser?.email || "")
        .trim()
        .toLowerCase();
      const applicationRef = await addDoc(collection(db, "recruitment_applications"), {
        ...formData,
        email: normalizedEmail,
        userId: authenticatedUid || "",
        type: "company_registration",
        registrationType: "company_registration",
        companyLogoURL: companyLogo.value,
        ownerPhotoUrl: ownerPhoto.value,
        companyLogoStoragePath: companyLogo.storagePath,
        ownerPhotoStoragePath: ownerPhoto.storagePath,
        imageTransport: {
          companyLogo: companyLogo.transport,
          ownerPhoto: ownerPhoto.transport,
        },
        status: "pending",
        createdAt: new Date().toISOString(),
      });

      // Preserve the exact company-registration reference so the next Google
      // login can open the same request instead of guessing by historical data.
      if (typeof window !== "undefined") {
        try {
          window.sessionStorage.setItem(
            "nvu.pendingRecruitmentApplicationId",
            applicationRef.id,
          );
        } catch {
          // Restricted previews can block Web Storage; the login fallback by
          // verified e-mail still recovers the pending company registration.
        }
      }

      // Persist the canonical pointer before opening the status screen. The
      // owner stays authenticated, exactly like the driver application flow.
      try {
        await setDoc(
          doc(db, "users", authenticatedUid),
          {
            applicationSubmitted: true,
            currentRecruitmentApplicationId: applicationRef.id,
            currentRecruitmentStatus: "pending",
            currentRecruitmentType: "company_registration",
            currentRecruitmentSimulatorId: formData.simulatorId || "",
          },
          { merge: true },
        );
      } catch (pointerError) {
        console.warn(
          "[RegisterCompany] Cadastro salvo; falha apenas ao persistir o ponteiro de acompanhamento.",
          pointerError,
        );
      }

      navigate("/pending-applications", { replace: true });
    } catch (error: any) {
      toast.error("Erro ao enviar solicitação: " + error.message);
    } finally {
      setSubmitting(false);
      setUploadingImage(false);
    }
  };

  const handleCancel = async () => {
    if (auth.currentUser) {
      await logOutApp();
    }
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#09090b] flex flex-col items-center p-4 sm:p-6 overflow-y-auto">
      <div className="w-full max-w-[440px] my-auto py-8">
        <div className="relative mb-6">
          <button
              type="button"
              onClick={handleCancel}
              className="absolute left-0 top-1/2 -translate-y-1/2 p-2 w-10 h-10 text-slate-500 hover:text-slate-900 dark:text-[#a1a1aa] dark:hover:text-white transition-colors bg-white dark:bg-[#1A1F26] rounded-full border border-slate-200 dark:border-[#2A2F3A] shadow-sm flex items-center justify-center group"
              title="Voltar para a tela anterior"
            >
              <ArrowLeft
                size={18}
                className="group-hover:-translate-x-0.5 transition-transform"
              />
            </button>
          <div className="text-center">
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-[#fafafa] tracking-tight mb-1">
              NVU
            </h1>
            <p className="text-slate-500 dark:text-[#a1a1aa] text-sm font-medium">
              Cadastro de Nova Empresa
            </p>
          </div>
        </div>

        <Card className="rounded-[24px] border border-slate-200/60 dark:border-[#2A2F3A] shadow-xl shadow-slate-200/40 dark:shadow-none bg-white dark:bg-[#1A1F26] overflow-hidden">
          <CardContent className="p-5 sm:p-7">
            {!auth.currentUser?.uid ? (
              <div className="flex flex-col items-center text-center py-6 sm:py-8">
                <div className="w-16 h-16 bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 rounded-2xl flex items-center justify-center mb-5">
                  <LogIn size={28} className="text-blue-600 dark:text-blue-400" />
                </div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-[#fafafa] mb-2">
                  Identifique o proprietário
                </h2>
                <p className="text-sm text-slate-500 dark:text-[#a1a1aa] leading-relaxed mb-6 max-w-sm">
                  Acesse com a conta Google do proprietário para enviar o cadastro e acompanhar a avaliação da empresa.
                </p>
                <Button
                  type="button"
                  onClick={handleGoogleAccess}
                  disabled={authenticating}
                  className="w-full h-12 bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-500 text-white rounded-xl font-semibold"
                >
                  {authenticating ? "Abrindo Google..." : "Acessar com Google"}
                </Button>
              </div>
            ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="flex items-center gap-4 bg-slate-50/50 dark:bg-[#18181b] p-3.5 rounded-2xl border border-slate-200 dark:border-[#2A2F3A]/60 w-full mb-1">
                  <div className="relative group shrink-0">
                    {photoPreview ? (
                      <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-white dark:border-[#2A2F3A] shadow-sm relative">
                        <img
                          src={photoPreview}
                          alt="Preview"
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <label className="cursor-pointer text-white p-2">
                            <Upload size={16} />
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => handleImageSelect(e, false)}
                            />
                          </label>
                        </div>
                      </div>
                    ) : (
                      <label className="w-14 h-14 rounded-full bg-slate-100 dark:bg-[#2A2F3A] border border-dashed border-slate-300 dark:border-[#3f3f46] flex flex-col items-center justify-center cursor-pointer hover:bg-slate-200 dark:hover:bg-[#3f3f46] transition-colors">
                        <ImageIcon
                          size={18}
                          className="text-slate-400 dark:text-[#71717a]"
                        />
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => handleImageSelect(e, false)}
                        />
                      </label>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <label className="block text-[14px] font-semibold text-slate-800 dark:text-[#d4d4d8] mb-0.5">
                      Logo da Empresa
                    </label>
                    {photoPreview ? (
                      <button
                        type="button"
                        onClick={() => {
                          imageSelectionVersion.current += 1;
                          setPhotoPreview(null);
                          setFormData((f) => ({ ...f, companyLogoURL: "" }));
                        }}
                        className="text-rose-500 hover:text-rose-600 text-[12px] font-medium flex items-center gap-1 transition-colors"
                      >
                        Remover foto
                      </button>
                    ) : (
                      <p className="text-[12px] text-slate-500 dark:text-[#a1a1aa] truncate">
                        Envie uma imagem opcional
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-4 bg-slate-50/50 dark:bg-[#18181b] p-3.5 rounded-2xl border border-slate-200 dark:border-[#2A2F3A]/60 w-full mb-1">
                  <div className="relative group shrink-0">
                    {ownerPhotoPreview ? (
                      <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-white dark:border-[#2A2F3A] shadow-sm relative">
                        <img
                          src={ownerPhotoPreview}
                          alt="Owner Preview"
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <label className="cursor-pointer text-white p-2">
                            <Upload size={16} />
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => handleImageSelect(e, true)}
                            />
                          </label>
                        </div>
                      </div>
                    ) : (
                      <label className="w-14 h-14 rounded-full bg-slate-100 dark:bg-[#2A2F3A] border border-dashed border-slate-300 dark:border-[#3f3f46] flex flex-col items-center justify-center cursor-pointer hover:bg-slate-200 dark:hover:bg-[#3f3f46] transition-colors">
                        <ImageIcon
                          size={18}
                          className="text-slate-400 dark:text-[#71717a]"
                        />
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => handleImageSelect(e, true)}
                        />
                      </label>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <label className="block text-[14px] font-semibold text-slate-800 dark:text-[#d4d4d8] mb-0.5">
                      Foto do Proprietário
                    </label>
                    {ownerPhotoPreview ? (
                      <button
                        type="button"
                        onClick={() => {
                          imageSelectionVersion.current += 1;
                          setOwnerPhotoPreview(null);
                          setFormData((f) => ({ ...f, ownerPhotoUrl: "" }));
                        }}
                        className="text-rose-500 hover:text-rose-600 text-[12px] font-medium flex items-center gap-1 transition-colors"
                      >
                        Remover foto
                      </button>
                    ) : (
                      <p className="text-[12px] text-slate-500 dark:text-[#a1a1aa] truncate">
                        Entrará no seu perfil de motorista
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-[13px] font-medium text-slate-700 dark:text-[#d4d4d8] mb-1.5 ml-0.5">
                    Nome da Empresa
                  </label>
                  <input
                    required
                    value={formData.companyName}
                    onChange={(e) =>
                      setFormData({ ...formData, companyName: e.target.value })
                    }
                    className="w-full bg-white dark:bg-[#09090b] border border-slate-200 dark:border-[#2A2F3A] rounded-xl px-4 h-12 text-[15px] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:text-[#fafafa] transition-all shadow-sm"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 dark:text-[#d4d4d8] mb-1.5 ml-0.5">
                    Nome do Proprietário
                  </label>
                  <input
                    required
                    value={formData.ownerName}
                    onChange={(e) =>
                      setFormData({ ...formData, ownerName: e.target.value })
                    }
                    className="w-full bg-white dark:bg-[#09090b] border border-slate-200 dark:border-[#2A2F3A] rounded-xl px-4 h-12 text-[15px] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:text-[#fafafa] transition-all shadow-sm"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[13px] font-medium text-slate-700 dark:text-[#d4d4d8] mb-1.5 ml-0.5">
                      Email
                    </label>
                    <input
                      required
                      disabled
                      type="email"
                      inputMode="email"
                      value={formData.email}
                      onChange={(e) =>
                        setFormData({ ...formData, email: e.target.value })
                      }
                      title="E-mail vinculado do Google"
                      className="w-full bg-slate-50 dark:bg-[#09090b]/50 border border-slate-200 dark:border-[#2A2F3A] rounded-xl px-4 h-12 text-[15px] text-slate-500 dark:text-[#a1a1aa] cursor-not-allowed shadow-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[13px] font-medium text-slate-700 dark:text-[#d4d4d8] mb-1.5 ml-0.5">
                      WhatsApp
                    </label>
                    <input
                      required
                      type="tel"
                      inputMode="tel"
                      value={formData.whatsapp}
                      onChange={(e) =>
                        setFormData({ ...formData, whatsapp: e.target.value })
                      }
                      className="w-full bg-white dark:bg-[#09090b] border border-slate-200 dark:border-[#2A2F3A] rounded-xl px-4 h-12 text-[15px] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:text-[#fafafa] transition-all shadow-sm"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[13px] font-medium text-slate-700 dark:text-[#d4d4d8] mb-1.5 ml-0.5">
                      CNPJ{" "}
                      <span className="font-normal opacity-70">
                        (Automático)
                      </span>
                    </label>
                    <input
                      required
                      disabled
                      value={formData.cnpj}
                      onChange={(e) =>
                        setFormData({ ...formData, cnpj: e.target.value })
                      }
                      className="w-full bg-slate-50 dark:bg-[#09090b]/50 border border-slate-200 dark:border-[#2A2F3A] rounded-xl px-4 h-12 text-[15px] text-slate-500 dark:text-[#a1a1aa] cursor-not-allowed shadow-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[13px] font-medium text-slate-700 dark:text-[#d4d4d8] mb-1.5 ml-0.5">
                      Simulador
                    </label>
                    {simulatorsLoading ? (
                      <div
                        role="status"
                        aria-live="polite"
                        className="w-full bg-slate-50 dark:bg-[#09090b]/50 border border-slate-200 dark:border-[#2A2F3A] rounded-xl px-4 h-12 flex items-center text-[15px] text-slate-500 dark:text-[#a1a1aa] shadow-none"
                      >
                        Carregando simuladores...
                      </div>
                    ) : simulatorsError ? (
                      <div className="w-full bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl px-4 py-3 text-[13px] text-red-700 dark:text-red-300">
                        Não foi possível carregar os simuladores do Firebase.
                      </div>
                    ) : activeSimulators.length === 0 ? (
                      <div className="w-full bg-slate-50 dark:bg-[#09090b]/50 border border-slate-200 dark:border-[#2A2F3A] rounded-xl px-4 h-12 flex items-center text-[15px] text-slate-500 dark:text-[#a1a1aa] shadow-none">
                        Nenhum simulador disponível no sistema.
                      </div>
                    ) : (
                      <SafeSelect
                        title="Selecionar simulador"
                        placeholder="Selecione..."
                        value={formData.simulatorId}
                        options={activeSimulators.map((sim: any) => ({
                          value: sim.id,
                          label: sim.name,
                        }))}
                        onChange={(simulatorId) => {
                          const selected = activeSimulators.find(
                            (sim: any) => sim.id === simulatorId,
                          );
                          setFormData((current) => ({
                            ...current,
                            simulatorId,
                            simulatorName: selected?.name || "",
                          }));
                        }}
                        emptyMessage="Nenhum simulador disponível."
                      />
                    )}
                  </div>
                </div>

                <div className="pt-2 flex flex-col sm:flex-row gap-3">
                  <Button
                    type="button"
                    onClick={handleCancel}
                    variant="outline"
                    className="w-full sm:w-1/3 rounded-xl h-12 text-[15px] font-semibold border-slate-200 dark:border-[#2A2F3A]"
                  >
                    Cancelar
                  </Button>
                  <Button
                    disabled={submitting || uploadingImage || !formData.simulatorId}
                    type="submit"
                    className="w-full sm:w-2/3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl h-12 text-[15px] font-bold shadow-sm transition-all disabled:opacity-50"
                  >
                    {uploadingImage
                      ? "Processando imagem..."
                      : submitting
                        ? "Enviando..."
                        : "Enviar Solicitação"}
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
