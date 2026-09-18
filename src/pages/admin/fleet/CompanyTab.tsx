import React, { useEffect, useState, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useTripHistory } from "../../../hooks/useTripHistory";
import { useOperationalStore, useSessionStore } from "../../../context/AppContext";
import { useCompanyStore } from "../../../context/CompanyContext";
import { Button } from "../../../components/ui/Button";
import { SafeSelect } from "../../../components/ui/SafeSelect";
import {
  Pencil,
  Calendar,
  Check,
  Trash2,
  AlertTriangle,
  Camera,
  LoaderCircle,
  X,
  Building2,
} from "lucide-react";
import { toast } from "sonner";
import { doc, getDoc } from "firebase/firestore";
import { PeriodSelector, DateRange } from "./PeriodSelector";
import { CompanyPerformanceCard } from "../../../components/CompanyPerformanceCard";
import { StableImage } from "../../../components/common/StableImage";
import {
  parseISO,
  isWithinInterval,
  startOfDay,
  endOfDay,
  subDays,
} from "date-fns";
import { convertFileToBase64, compressImage } from "../../../lib/utils";
import {
  normalizeFileAccessError,
  snapshotSelectedFile,
} from "../../../lib/fileAccess";
import {
  buildSimulatorSelectorOptions,
  findSimulatorOption,
  resolveCompanySimulatorFilterValue,
} from "../../../lib/simulatorOptions";
import { uploadService } from "../../../services/uploadService";
import { db } from "../../../lib/firebase";

function CompanyTab({
  isEditingProp,
  setIsEditingProp,
  isViewingProp,
  setIsViewingProp,
}: {
  isEditingProp?: boolean;
  setIsEditingProp?: (val: boolean) => void;
  isViewingProp?: boolean;
  setIsViewingProp?: (val: boolean) => void;
} = {}) {
  const { currentUser } = useSessionStore();
  const {
    companies,
    allCompanies,
    companiesLoading,
    companyCatalogLoaded,
    companyCatalogAttempted,
    loadCompanyCatalog,
    loadCompanyById,
    activeCompanyId,
    memberships,
    updateCompany,
    createCompany,
    deleteCompany,
  } = useCompanyStore();
  const { jobs, contracts, simulators } = useOperationalStore();
  // Keep the targeted Senior handoff locally as a render fallback. The shared
  // CompanyContext remains authoritative, but a route transition must not
  // discard a successfully resolved company before its context repaint lands.
  const [resolvedCompany, setResolvedCompany] = useState<any | null>(null);
  const [companyResolution, setCompanyResolution] = useState<{
    companyId: string;
    status: "idle" | "loading" | "ready" | "failed";
  }>({ companyId: "", status: "idle" });
  const activeCompany =
    companies.find((company) => company.id === activeCompanyId) ||
    allCompanies.find((company) => company.id === activeCompanyId) ||
    (resolvedCompany?.id === activeCompanyId ? resolvedCompany : null);
  const [resolvedCompanyEmail, setResolvedCompanyEmail] = useState("");

  const resolveActiveCompany = React.useCallback(
    async (companyId: string) => {
      const direct = await loadCompanyById(companyId);
      if (direct) return direct;

      // Rare recovery path: if the targeted read is unavailable, reconcile the
      // complete public catalog once. This is intentionally not the normal
      // Senior navigation path, which is primed before route transition.
      const catalog = await loadCompanyCatalog(true);
      return catalog.find((company) => company.id === companyId) || null;
    },
    [loadCompanyById, loadCompanyCatalog],
  );

  useEffect(() => {
    const companyId = String(activeCompanyId || "").trim();
    if (!companyId) {
      setResolvedCompany(null);
      setCompanyResolution({ companyId: "", status: "idle" });
      return;
    }
    if (resolvedCompany && resolvedCompany.id !== companyId) {
      setResolvedCompany(null);
    }
    if (activeCompany) {
      setCompanyResolution({ companyId, status: "ready" });
      return;
    }

    let cancelled = false;
    setCompanyResolution({ companyId, status: "loading" });
    void resolveActiveCompany(companyId).then((company) => {
      if (cancelled) return;
      if (company) setResolvedCompany(company);
      setCompanyResolution({
        companyId,
        status: company ? "ready" : "failed",
      });
    });

    return () => {
      cancelled = true;
    };
  }, [activeCompany?.id, activeCompanyId, resolveActiveCompany, resolvedCompany]);

  const retryCompanyResolution = () => {
    const companyId = String(activeCompanyId || "").trim();
    if (!companyId) return;
    setCompanyResolution({ companyId, status: "loading" });
    void resolveActiveCompany(companyId).then((company) => {
      if (company) setResolvedCompany(company);
      setCompanyResolution({
        companyId,
        status: company ? "ready" : "failed",
      });
    });
  };
  const companyDirectEmail = useMemo(() => {
    if (!activeCompany) return "";
    const emailCandidates = [
      activeCompany.email,
      activeCompany.ownerEmail,
      activeCompany.contactEmail,
      activeCompany.companyEmail,
    ];

    return (
      emailCandidates
        .map((value) => String(value || "").trim())
        .find(Boolean) || ""
    );
  }, [activeCompany]);
  const companyInfoEmail = companyDirectEmail || resolvedCompanyEmail || "-";
  const {
    historicoTrips = [],
    loading: companyTripsLoading,
  } = useTripHistory(activeCompanyId, {
    enabled: Boolean(activeCompanyId),
    userId: currentUser?.id,
  });
  const [internalIsEditing, setInternalIsEditing] = useState(false);

  useEffect(() => {
    if (companyCatalogLoaded || companyCatalogAttempted) return;

    // The full company catalog is useful for global position, but it must not
    // compete with the identity and company-trip reads required for the first
    // visible frame. Schedule it as background work.
    let cancelled = false;
    const run = () => {
      if (!cancelled) void loadCompanyCatalog();
    };
    const requestIdle = (window as any).requestIdleCallback as
      | ((callback: () => void, options?: { timeout: number }) => number)
      | undefined;
    const cancelIdle = (window as any).cancelIdleCallback as
      | ((id: number) => void)
      | undefined;

    if (requestIdle) {
      const idleId = requestIdle(run, { timeout: 1_200 });
      return () => {
        cancelled = true;
        cancelIdle?.(idleId);
      };
    }

    const timer = window.setTimeout(run, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [companyCatalogAttempted, companyCatalogLoaded, loadCompanyCatalog]);

  useEffect(() => {
    let cancelled = false;

    setResolvedCompanyEmail("");
    if (!activeCompany || companyDirectEmail) return;

    const ownerId = String(activeCompany.ownerId || activeCompany.userId || "").trim();
    const sourceRegistrationId = String(activeCompany.sourceRegistrationId || "").trim();

    const resolveCompanyEmail = async () => {
      try {
        if (ownerId) {
          const ownerSnapshot = await getDoc(doc(db, "users", ownerId));
          const ownerEmail = String(ownerSnapshot.data()?.email || "").trim();
          if (!cancelled && ownerEmail) {
            setResolvedCompanyEmail(ownerEmail);
            return;
          }
        }

        if (sourceRegistrationId) {
          const registrationSnapshot = await getDoc(
            doc(db, "recruitment_applications", sourceRegistrationId),
          );
          const registrationEmail = String(
            registrationSnapshot.data()?.email || "",
          ).trim();
          if (!cancelled && registrationEmail) {
            setResolvedCompanyEmail(registrationEmail);
          }
        }
      } catch (error) {
        console.warn("[NVU Company] Falha ao resolver email da empresa:", error);
      }
    };

    void resolveCompanyEmail();

    return () => {
      cancelled = true;
    };
  }, [
    activeCompany?.id,
    activeCompany?.ownerId,
    activeCompany?.sourceRegistrationId,
    activeCompany?.userId,
    companyDirectEmail,
  ]);
  
  const isEditing =
    isEditingProp !== undefined ? isEditingProp : internalIsEditing;
  const setIsEditing =
    setIsEditingProp !== undefined ? setIsEditingProp : setInternalIsEditing;
  const [internalIsViewing, setInternalIsViewing] = useState(false);
  const isViewing =
    isViewingProp !== undefined ? isViewingProp : internalIsViewing;
  const setIsViewing =
    setIsViewingProp !== undefined ? setIsViewingProp : setInternalIsViewing;

  const [isAddingNew, setIsAddingNew] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 6),
    to: new Date(),
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [pendingLogoFile, setPendingLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [isProcessingLogo, setIsProcessingLogo] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [logoUploadProgress, setLogoUploadProgress] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    companyName: "",
    simulatorId: "",
    simulatorName: "",
    ownerName: "",
    whatsapp: "",
    logoUrl: "",
  });

  const simulatorOptions = useMemo(
    () =>
      buildSimulatorSelectorOptions(
        (Array.isArray(simulators) ? simulators : []).filter(
          (simulator: Record<string, unknown>) => simulator.active !== false,
        ),
        allCompanies,
      ),
    [allCompanies, simulators],
  );

  const activeCompanySimulatorOption = useMemo(() => {
    if (!activeCompany) return undefined;
    return findSimulatorOption(
      resolveCompanySimulatorFilterValue(
        activeCompany,
        simulators as Record<string, unknown>[],
        allCompanies,
      ),
      simulatorOptions,
    );
  }, [activeCompany, allCompanies, simulatorOptions, simulators]);

  const selectedSimulatorValue = useMemo(() => {
    const selected = findSimulatorOption(
      resolveCompanySimulatorFilterValue(
        formData,
        simulators as Record<string, unknown>[],
        allCompanies,
      ),
      simulatorOptions,
    );
    return selected?.canonicalId || selected?.value || "";
  }, [allCompanies, formData, simulatorOptions, simulators]);

  const safeSimulatorOptions = useMemo(
    () =>
      simulatorOptions.map((option) => ({
        value: option.canonicalId || option.value,
        label: option.label,
      })),
    [simulatorOptions],
  );

  React.useEffect(() => {
    setPendingLogoFile(null);
    setLogoPreviewUrl(null);
    setLogoUploadProgress(0);
    setSaveError(null);
  }, [activeCompany?.id]);

  React.useEffect(() => {
    if (activeCompany) {
      setFormData({
        companyName: activeCompany.companyName,
        simulatorId:
          activeCompanySimulatorOption?.canonicalId ||
          activeCompany.simulatorId ||
          activeCompanySimulatorOption?.value ||
          "",
        simulatorName:
          activeCompanySimulatorOption?.label ||
          activeCompany.simulatorName ||
          "",
        ownerName: activeCompany.ownerName || "",
        whatsapp: activeCompany.whatsapp || "",
        logoUrl: activeCompany.logoUrl || "",
      });
      setIsAddingNew(false);
      setIsEditing(false);
    } else {
      const hasAnyCompany =
        activeCompanyId ||
        currentUser?.companyId ||
        (memberships && memberships.length > 0);
      if (!hasAnyCompany) {
        setIsAddingNew(true);
      }
    }
  }, [
    activeCompany,
    activeCompanyId,
    activeCompanySimulatorOption,
    currentUser,
    memberships,
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isProcessingLogo || isSaving) return;

    setIsSaving(true);
    setSaveError(null);
    setLogoUploadProgress(0);

    try {
      let logoUrl = formData.logoUrl;

      if (pendingLogoFile) {
        if (!currentUser?.id) {
          throw new Error("Sua sessão expirou. Entre novamente para alterar a logo.");
        }

        logoUrl = await uploadService.uploadImage({
          file: pendingLogoFile,
          companyId: activeCompany?.id || `draft-${currentUser.id}`,
          userId: currentUser.id,
          folder: "company-logos",
          compressionMaxSizeMB: 0.4,
          maxWidthOrHeight: 800,
          // storage.rules accepts image objects smaller than 500,000 bytes.
          maxOutputBytes: 480_000,
          onProgress: setLogoUploadProgress,
        });
        setPendingLogoFile(null);
        setLogoPreviewUrl(logoUrl);
        setFormData((current) => ({ ...current, logoUrl }));
      }

      const companyData = { ...formData, logoUrl };

      if (isEditing && activeCompany && !isAddingNew) {
        // The banner editor is an administrative identity surface: it may
        // change the company name/logo, while simulator assignment remains
        // owned by the existing operational controls.
        const editableCompanyData = {
          companyName: String(companyData.companyName || "").trim(),
          ownerName: companyData.ownerName,
          whatsapp: companyData.whatsapp,
          logoUrl: companyData.logoUrl,
        };
        if (!editableCompanyData.companyName) {
          throw new Error("Nome da empresa é obrigatório.");
        }
        await updateCompany(activeCompany.id, editableCompanyData);
        setFormData({
          ...companyData,
          companyName: editableCompanyData.companyName,
          simulatorId:
            activeCompanySimulatorOption?.canonicalId ||
            activeCompany.simulatorId ||
            activeCompanySimulatorOption?.value ||
            "",
          simulatorName:
            activeCompanySimulatorOption?.label ||
            activeCompany.simulatorName ||
            "",
        });
        setPendingLogoFile(null);
        setLogoPreviewUrl(null);
        setIsEditing(false);
        toast.success("Dados da empresa atualizados.");
      } else if (isAddingNew) {
        await createCompany(companyData);
        setPendingLogoFile(null);
        setLogoPreviewUrl(null);
        setIsAddingNew(false);
        toast.success("Empresa criada com sucesso.");
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Não foi possível salvar os dados da empresa.";
      setSaveError(message);
    } finally {
      setIsSaving(false);
      setLogoUploadProgress(0);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const selectedFile = input.files?.[0];
    input.value = "";

    if (selectedFile) {
      if (selectedFile.size > 10 * 1024 * 1024) {
        const message = "A imagem é muito grande. Tamanho máximo: 10 MB.";
        setSaveError(message);
        toast.error(message);
        return;
      }
      const declaredType = String(selectedFile.type || "").toLowerCase();
      if (
        declaredType &&
        !["image/jpeg", "image/png", "image/webp"].includes(declaredType)
      ) {
        const message = "Formato inválido. Use uma imagem JPG, PNG ou WEBP.";
        setSaveError(message);
        toast.error(message);
        return;
      }

      setIsProcessingLogo(true);
      setSaveError(null);
      try {
        // Keep a browser-owned copy. The original picker File can lose its
        // Android content-provider permission before the user presses Save.
        const { file } = await snapshotSelectedFile(selectedFile, {
          maxBytes: 10 * 1024 * 1024,
          fallbackName: `logo-${Date.now()}.jpg`,
        });
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
          throw new Error("Formato inválido. Use uma imagem JPG, PNG ou WEBP.");
        }
        const base64 = await convertFileToBase64(file);
        const compressed = await compressImage(base64, 400, 400, 0.8);
        setLogoPreviewUrl(compressed);
        setPendingLogoFile(file);
      } catch (error) {
        const normalizedError = normalizeFileAccessError(error);
        console.error("Erro ao processar logo:", normalizedError);
        const message = normalizedError.message;
        setSaveError(message);
        toast.error(message);
      } finally {
        setIsProcessingLogo(false);
      }
    }
  };

  const handleDelete = async () => {
    if (!activeCompany) return;
    setIsDeleting(true);
    try {
      await deleteCompany(activeCompany.id);
      setShowDeleteConfirm(false);
    } catch (e: any) {
      alert("Erro ao excluir frota: " + e.message);
    } finally {
      setIsDeleting(false);
    }
  };

  const isDateInRange = (dateStr?: string) => {
    if (!dateStr || !dateRange || !dateRange.from) return true;
    try {
      const date = parseISO(dateStr);
      const start = startOfDay(dateRange.from);
      const end = dateRange.to
        ? endOfDay(dateRange.to)
        : endOfDay(dateRange.from);
      return isWithinInterval(date, { start, end });
    } catch (e) {
      return true; // Fallback to true if date is unparseable
    }
  };

  const companyJobs = useMemo(
    () =>
      jobs.filter(
        (j) => j.companyId === activeCompanyId && isDateInRange(j.createdAt),
      ),
    [jobs, activeCompanyId, dateRange],
  );
  const companyContracts = useMemo(
    () =>
      contracts.filter(
        (c) =>
          c.companyId === activeCompanyId &&
          isDateInRange((c as any).createdAt),
      ),
    [contracts, activeCompanyId, dateRange],
  );

  if (isEditing || isAddingNew) {
    return (
      <div className="nvu-company-profile-view space-y-4">
        <div className="bg-white dark:bg-[#1A1F26] border border-slate-200 dark:border-[#2A2F3A] rounded-[20px] shadow-sm p-5 mt-4">
        <div className="flex items-center justify-between mb-6 border-b border-slate-100 dark:border-[#2A2F3A] pb-4">
          <h3 className="text-[17px] font-bold text-slate-900 dark:text-white tracking-tight">
            {isEditing ? "Editar Empresa" : "Nova Empresa"}
          </h3>
          <Button
            type="submit"
            form="company-profile-form"
            disabled={isProcessingLogo || isSaving}
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl h-9 text-[14px] font-semibold px-4 flex items-center gap-1.5"
          >
            {isProcessingLogo || isSaving ? (
              <LoaderCircle size={16} className="animate-spin" />
            ) : (
              <Check size={16} />
            )}
            {isProcessingLogo
              ? "Processando"
              : isSaving
                ? logoUploadProgress > 0 && logoUploadProgress < 100
                  ? `${Math.round(logoUploadProgress)}%`
                  : "Salvando"
                : "Salvar"}
          </Button>
        </div>
        <form
          id="company-profile-form"
          onSubmit={handleSubmit}
          className="space-y-4"
        >
          <div className="space-y-4">
            {isAddingNew && (
              <>
                <div>
                  <label className="block text-[14px] font-medium text-slate-700 dark:text-[#a1a1aa] mb-1.5 ml-1">
                    Nome da Empresa
                  </label>
                  <input
                    name="companyName"
                    value={formData.companyName}
                    onChange={handleChange}
                    className="w-full bg-slate-50 dark:bg-[#09090b] border border-slate-200 dark:border-[#2A2F3A] rounded-xl px-4 h-12 text-[15px] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:text-white transition-all shadow-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[14px] font-medium text-slate-700 dark:text-[#a1a1aa] mb-1.5 ml-1">
                    Simulador Padrão
                  </label>
                  <SafeSelect
                    title="Selecionar simulador"
                    placeholder="Selecione um simulador"
                    value={selectedSimulatorValue}
                    options={safeSimulatorOptions}
                    onChange={(simulatorId) => {
                      const option = simulatorOptions.find(
                        (item) => (item.canonicalId || item.value) === simulatorId,
                      );
                      setFormData((current) => ({
                        ...current,
                        simulatorId,
                        simulatorName: option?.label || "",
                      }));
                    }}
                    emptyMessage="Nenhum simulador ativo disponível."
                  />
                </div>
              </>
            )}
            <div>
              <label className="block text-[14px] font-medium text-slate-700 dark:text-[#a1a1aa] mb-1.5 ml-1">
                Proprietário (Responsável)
              </label>
              <input
                name="ownerName"
                value={formData.ownerName}
                onChange={handleChange}
                className="w-full bg-slate-50 dark:bg-[#09090b] border border-slate-200 dark:border-[#2A2F3A] rounded-xl px-4 h-12 text-[15px] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:text-white transition-all shadow-sm"
                required
              />
            </div>
            <div>
              <label className="block text-[14px] font-medium text-slate-700 dark:text-[#a1a1aa] mb-1.5 ml-1">
                WhatsApp
              </label>
              <input
                name="whatsapp"
                value={formData.whatsapp}
                onChange={handleChange}
                placeholder="(00) 00000-0000"
                className="w-full bg-slate-50 dark:bg-[#09090b] border border-slate-200 dark:border-[#2A2F3A] rounded-xl px-4 h-12 text-[15px] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:text-white transition-all shadow-sm"
              />
            </div>
            <div>
              <label className="block text-[14px] font-medium text-slate-700 dark:text-[#a1a1aa] mb-1.5 ml-1">
                Logo da Empresa
              </label>
              <div className="flex items-center gap-4">
                <div
                  className={`w-16 h-16 rounded-xl bg-slate-100 dark:bg-[#2A2F3A] border border-slate-200 dark:border-[#3A3F4A] overflow-hidden flex flex-col items-center justify-center relative group shrink-0 ${
                    isProcessingLogo || isSaving
                      ? "cursor-wait opacity-70"
                      : "cursor-pointer"
                  }`}
                  onClick={() => {
                    if (!isProcessingLogo && !isSaving) {
                      fileInputRef.current?.click();
                    }
                  }}
                >
                  {logoPreviewUrl || formData.logoUrl ? (
                    <img
                      src={logoPreviewUrl || formData.logoUrl}
                      alt="Logo"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Camera
                      className="text-slate-400 group-hover:text-blue-500 transition-colors"
                      size={24}
                    />
                  )}
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Camera className="text-white" size={20} />
                  </div>
                </div>
                <div className="flex flex-col">
                  <span className="text-[13px] text-slate-500 dark:text-slate-400">
                    {isProcessingLogo
                      ? "Processando a imagem..."
                      : pendingLogoFile
                        ? "Nova logo pronta para salvar"
                        : "Clique para enviar uma imagem"}
                  </span>
                  <span className="text-[12px] text-slate-400 dark:text-slate-500">
                    JPG, PNG ou WEBP • máximo de 10 MB
                  </span>
                </div>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  ref={fileInputRef}
                  onChange={handlePhotoUpload}
                  disabled={isProcessingLogo || isSaving}
                />
              </div>
              {saveError && (
                <p
                  className="mt-2 text-[12px] font-medium text-rose-600 dark:text-rose-400"
                  role="alert"
                >
                  {saveError}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between pt-6 mt-4 border-t border-slate-100 dark:border-[#2A2F3A]">
            {activeCompany && isEditing ? (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="text-rose-600 dark:text-rose-400 flex items-center gap-1.5 text-[14px] font-semibold p-2 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition-colors"
              >
                <Trash2 size={16} /> Excluir
              </button>
            ) : (
              <div />
            )}
            {activeCompany && (
              <button
                type="button"
                onClick={() => {
                  setPendingLogoFile(null);
                  setLogoPreviewUrl(null);
                  setSaveError(null);
                  setIsEditing(false);
                  setIsAddingNew(false);
                }}
                disabled={isSaving}
                className="text-slate-500 dark:text-slate-400 font-semibold px-4 py-2 hover:bg-slate-100 dark:hover:bg-[#2A2F3A] rounded-xl transition-colors"
              >
                Cancelar
              </button>
            )}
          </div>
        </form>

        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white dark:bg-[#1A1F26] rounded-3xl p-6 max-w-sm w-full shadow-2xl relative">
              <div className="flex justify-center mb-5">
                <div className="w-14 h-14 bg-rose-100 dark:bg-rose-500/10 rounded-full flex items-center justify-center text-rose-600 dark:text-rose-400">
                  <AlertTriangle size={28} />
                </div>
              </div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2 text-center tracking-tight">
                Excluir Empresa
              </h3>
              <p className="text-slate-600 dark:text-slate-400 text-[14px] text-center mb-8 leading-relaxed">
                Tem certeza que deseja excluir{" "}
                <b>{activeCompany?.companyName}</b>? Esta ação removerá tudo.
              </p>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1 font-semibold border-slate-200 dark:border-[#2A2F3A] text-slate-700 dark:text-slate-300 h-12 rounded-xl"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={isDeleting}
                >
                  Cancelar
                </Button>
                <Button
                  onClick={handleDelete}
                  className="flex-1 font-semibold bg-rose-600 hover:bg-rose-700 text-white border-0 h-12 rounded-xl"
                  disabled={isDeleting}
                >
                  {isDeleting ? "Progresso..." : "Sim, excluir"}
                </Button>
              </div>
            </div>
          </div>
        )}
        </div>
      </div>
    );
  }

  const companyTargetId = String(
    activeCompanyId || currentUser?.companyId || "",
  ).trim();
  const resolutionFailed =
    Boolean(companyTargetId) &&
    companyResolution.companyId === companyTargetId &&
    companyResolution.status === "failed";
  const isStillLoading =
    !activeCompany &&
    Boolean(
      companyTargetId || (memberships && memberships.length > 0),
    ) &&
    !resolutionFailed;

  if (isStillLoading) {
    return (
      <div
        className="flex min-h-[220px] items-center justify-center"
        role="status"
        aria-live="polite"
      >
        <div className="text-center">
          <div className="mx-auto mb-3 h-1 w-24 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-500/10">
            <div className="h-full w-1/3 rounded-full bg-blue-500 motion-safe:animate-[nvu-progress_900ms_ease-in-out_infinite]" />
          </div>
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            Sincronizando empresa
          </p>
        </div>
      </div>
    );
  }

  if (!activeCompany && resolutionFailed) {
    return (
      <div className="flex min-h-[220px] items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-2xl border border-amber-200 bg-amber-50 p-5 text-center dark:border-amber-900/50 dark:bg-amber-950/20">
          <AlertTriangle
            size={24}
            className="mx-auto mb-2 text-amber-600 dark:text-amber-400"
          />
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Não foi possível sincronizar esta empresa.
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            O painel não ficará preso. Tente novamente para refazer a leitura.
          </p>
          <Button
            type="button"
            onClick={retryCompanyResolution}
            className="mt-4 h-9 rounded-xl bg-blue-600 px-4 text-white hover:bg-blue-700"
          >
            Tentar novamente
          </Button>
        </div>
      </div>
    );
  }

  if (!activeCompany) return null;

  return (
    <div className="nvu-company-profile-view space-y-4">
      {/* Info Card Modal */}
      {isViewing && createPortal(
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#1A1F26] rounded-3xl p-6 max-w-md w-full shadow-2xl relative animate-in zoom-in-95 fade-in duration-200">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight ml-1">
                Informações da Empresa
              </h3>
              <button
                onClick={() => setIsViewing(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-[#2A2F3A] text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-0 text-[14px]">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-[#2A2F3A] py-3.5">
                <span className="text-slate-500 dark:text-slate-400 px-1">
                  Nome da Empresa
                </span>
                <span className="font-semibold text-slate-900 dark:text-white text-right ml-4">
                  {activeCompany.companyName || "-"}
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-[#2A2F3A] py-3.5">
                <span className="text-slate-500 dark:text-slate-400 px-1">
                  Proprietário
                </span>
                <span className="font-semibold text-slate-900 dark:text-white text-right break-all ml-4">
                  {activeCompany.ownerName || "-"}
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-[#2A2F3A] py-3.5">
                <span className="text-slate-500 dark:text-slate-400 px-1">
                  Email
                </span>
                <span className="font-semibold text-slate-900 dark:text-white text-right break-all ml-4">
                  {companyInfoEmail}
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-[#2A2F3A] py-3.5">
                <span className="text-slate-500 dark:text-slate-400 px-1">
                  WhatsApp
                </span>
                <span className="font-semibold text-slate-900 dark:text-white text-right ml-4">
                  {activeCompany.whatsapp || "-"}
                </span>
              </div>
              <div className="flex items-center justify-between py-3.5 pb-1">
                <span className="text-slate-500 dark:text-slate-400 px-1">
                  Simulador Padrão
                </span>
                <span className="font-semibold text-slate-900 dark:text-white text-right ml-4">
                  {activeCompanySimulatorOption?.label ||
                    activeCompany.simulatorName ||
                    "Simulador não identificado"}
                </span>
              </div>
            </div>
            
            <div className="mt-8">
              <Button
                onClick={() => setIsViewing(false)}
                className="w-full font-semibold h-12 rounded-xl"
              >
                Fechar
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <CompanyPerformanceCard
          historicoTrips={historicoTrips}
          companyId={activeCompanyId!}
          allCompanies={allCompanies}
          companiesLoading={!companyCatalogLoaded || companiesLoading}
          companyTripsLoading={companyTripsLoading}
          simulatorId={resolveCompanySimulatorFilterValue(
            activeCompany,
            simulators as Record<string, unknown>[],
            allCompanies as Record<string, unknown>[],
          )}
          simulators={simulators as Record<string, unknown>[]}
        />
    </div>
  );
}

export default React.memo(CompanyTab);
