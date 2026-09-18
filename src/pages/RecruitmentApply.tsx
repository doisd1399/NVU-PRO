import { resolveSimulatorId } from "../lib/resolveSimulator";
import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useOperationalStore, useSessionStore } from "../context/AppContext";
import { useCompanyStore } from "../context/CompanyContext";
import {
  CheckCircle2,
  ChevronRight,
  UserPlus,
  Info,
  Navigation2,
  LogIn,
  ChevronLeft,
  Upload,
  X,
  Image as ImageIcon,
  Briefcase,
  FileText,
  ArrowRight,
  Star,
  Gamepad2,
  Truck,
} from "lucide-react";
import { Button } from "../components/ui/Button";
import { SafeSelect } from "../components/ui/SafeSelect";
import Markdown from "react-markdown";
import { auth, storage } from "../lib/firebase";
import { signInWithGoogleAccount } from "../services/googleAuthService";
import { ref, uploadString, getDownloadURL } from "firebase/storage";
import {
  normalizeFileAccessError,
  snapshotSelectedFile,
} from "../lib/fileAccess";

const RECRUITMENT_PHOTO_MAX_BYTES = 280_000;
const RECRUITMENT_PHOTO_TIMEOUT_MS = 30_000;

const dataUrlByteLength = (dataUrl: string) => {
  const base64 = dataUrl.split(",")[1] || "";
  return Math.ceil((base64.length * 3) / 4);
};

const compressRecruitmentPhoto = (file: File): Promise<string> =>
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
        const ratio = Math.min(
          1,
          maxDimension / Math.max(image.width, image.height),
        );
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * ratio));
        canvas.height = Math.max(1, Math.round(image.height * ratio));
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("Não foi possível preparar a imagem."));
          return;
        }

        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const qualities = [0.8, 0.7, 0.6, 0.5, 0.4];
        let result = canvas.toDataURL("image/jpeg", qualities[0]);
        for (const quality of qualities.slice(1)) {
          if (dataUrlByteLength(result) <= RECRUITMENT_PHOTO_MAX_BYTES) break;
          result = canvas.toDataURL("image/jpeg", quality);
        }
        if (dataUrlByteLength(result) > RECRUITMENT_PHOTO_MAX_BYTES) {
          reject(new Error("A imagem ficou muito grande após a compactação."));
          return;
        }
        resolve(result);
      };
      image.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number) => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("upload-timeout")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

type RecruitmentFormData = {
  applicationPhotoURL: string;
  fullName: string;
  whatsapp: string;
  email: string;
  reason: string;
  objective: string;
  deliveriesPerWeek: string;
  hasExperience: boolean;
  primaryVehicle: string;
  secondaryVehicle: string;
};

type RecruitmentIdentityLike = {
  displayName?: string | null;
  email?: string | null;
} | null;

const buildRecruitmentDraft = (
  identity: RecruitmentIdentityLike,
): RecruitmentFormData => ({
  applicationPhotoURL: "",
  // Nome, WhatsApp, foto e respostas pertencem exclusivamente ao novo
  // formulário; não herdar identidade de uma inscrição anterior.
  fullName: "",
  whatsapp: "",
  email: identity?.email?.trim() || "",
  reason: "",
  objective: "",
  deliveriesPerWeek: "",
  hasExperience: false,
  primaryVehicle: "",
  secondaryVehicle: "",
});

const PENDING_RECRUITMENT_APPLICATION_ID_KEY =
  "nvu.pendingRecruitmentApplicationId";

export default function RecruitmentApply() {
  const { companyId } = useParams();
  const navigate = useNavigate();
  const { sessionUiReady, currentUser } = useSessionStore();
  const {
    allCompanies,
    companiesLoading,
    companyCatalogLoaded,
    companyCatalogAttempted,
    loadCompanyCatalog,
    loadCompanyById,
    memberships,
    submitRecruitmentApplication,
  } = useCompanyStore();
  const { simulators, simulatorsLoading, simulatorsError } = useOperationalStore();

  const [selectedSimulatorId, setSelectedSimulatorId] = useState("");
  // simulatorName is only for display; simulatorId is the canonical key.
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [company, setCompany] = useState<any>(null);
  const [directCompanyLoading, setDirectCompanyLoading] = useState(false);
  const [directCompanyAttempted, setDirectCompanyAttempted] = useState(
    () => !String(companyId || "").trim(),
  );

  useEffect(() => {
    const directCompanyId = String(companyId || "").trim();
    if (!directCompanyId) {
      setDirectCompanyAttempted(true);
      if (companyCatalogLoaded || companyCatalogAttempted) return;
      void loadCompanyCatalog();
      return;
    }

    if (String(company?.id || "").trim() === directCompanyId) {
      const resolvedSimulatorId = resolveSimulatorId(company, simulators);
      if (resolvedSimulatorId && resolvedSimulatorId !== selectedSimulatorId) {
        setSelectedSimulatorId(resolvedSimulatorId);
      }
      setDirectCompanyAttempted(true);
      setDirectCompanyLoading(false);
      return;
    }

    let active = true;
    setDirectCompanyLoading(true);
    setDirectCompanyAttempted(false);
    void loadCompanyById(directCompanyId)
      .then((resolvedCompany) => {
        if (!active) return;
        if (
          resolvedCompany &&
          resolvedCompany.recruitmentSettings?.isActive !== false
        ) {
          setSelectedSimulatorId(resolveSimulatorId(resolvedCompany, simulators));
          setSelectedCompanyId(resolvedCompany.id);
          setCompany(resolvedCompany);
        } else {
          setCompany(null);
          setSelectedCompanyId("");
          setSelectedSimulatorId("");
        }
      })
      .finally(() => {
        if (!active) return;
        setDirectCompanyAttempted(true);
        setDirectCompanyLoading(false);
      });

    return () => {
      active = false;
    };
  }, [
    company?.id,
    companyCatalogAttempted,
    companyCatalogLoaded,
    companyId,
    loadCompanyById,
    loadCompanyCatalog,
    selectedSimulatorId,
    simulators,
  ]);
  // Applying is a user-scoped flow. Membership confirmation is relevant only
  // to the optional owner/member hint, not to identifying the applicant.
  const verifiedCurrentUser =
    sessionUiReady && auth.currentUser?.uid === currentUser?.id
      ? currentUser
      : null;

  const userApplicationStatus = React.useMemo(() => {
    if (!verifiedCurrentUser || !company || !selectedSimulatorId) return 'eligible';
    
    // Check if owner
    if (company.ownerId === verifiedCurrentUser.id) return 'owner';
    
    // Check if member (is active)
    const activeMembership = memberships.find(m => m.userId === verifiedCurrentUser.id && m.companyId === company.id && m.status === 'active');
    if (activeMembership) {
      return 'member';
    }

    return 'eligible';
  }, [verifiedCurrentUser, company, selectedSimulatorId, memberships]);

  const [step, setStep] = useState(1); // 1 = info, 2 = form, 3 = success
  const [submitting, setSubmitting] = useState(false);

  const [formData, setFormData] = useState<RecruitmentFormData>(() =>
    buildRecruitmentDraft(null),
  );
  const [googleUid, setGoogleUid] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const imageSelectionVersion = useRef(0);
  const activeIdentityUid =
    verifiedCurrentUser?.id || auth.currentUser?.uid || null;
  const formScope = `${activeIdentityUid || ""}::${selectedCompanyId || companyId || ""}::${selectedSimulatorId || ""}`;
  const formScopeRef = useRef("");

  // A route can remain mounted while Firebase changes accounts or companies.
  // Never carry the previous applicant's data into the next draft.
  useEffect(() => {
    if (formScopeRef.current === formScope) return;
    formScopeRef.current = formScope;
    setGoogleUid(activeIdentityUid);
    setSubmitting(false);
    setUploadingImage(false);
    setPhotoPreview(null);
    imageSelectionVersion.current += 1;
    setFormData(buildRecruitmentDraft(null));
    setStep(1);
  }, [
    activeIdentityUid,
    auth.currentUser,
    companyId,
    formScope,
    selectedCompanyId,
    selectedSimulatorId,
  ]);

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    const selectionVersion = ++imageSelectionVersion.current;
    setUploadingImage(true);
    try {
      const { file: stableFile } = await snapshotSelectedFile(file, {
        maxBytes: 10 * 1024 * 1024,
        fallbackName: `recrutamento-${Date.now()}.jpg`,
      });
      const dataUrl = await compressRecruitmentPhoto(stableFile);
      if (selectionVersion !== imageSelectionVersion.current) return;
      setPhotoPreview(dataUrl);
      setFormData((previous) => ({
        ...previous,
        applicationPhotoURL: "",
      }));
    } catch (error: unknown) {
      const normalizedError = normalizeFileAccessError(error);
      alert(normalizedError.message);
    } finally {
      if (selectionVersion === imageSelectionVersion.current) {
        setUploadingImage(false);
      }
    }
  };

  // Fonte oficial de simuladores. Empresas são usadas somente depois da
  // seleção para listar vagas compatíveis; nunca para descobrir simuladores.
  const activeSimulators = React.useMemo(
    () =>
      (Array.isArray(simulators) ? simulators : [])
        .filter((s: any) => s.active !== false)
        .slice()
        .sort((a: any, b: any) =>
          String(a.name || "").localeCompare(String(b.name || "")),
        ),
    [simulators],
  );

  const availableSimulators = activeSimulators;

  const filteredCompanies = React.useMemo(
    () =>
      (Array.isArray(allCompanies) ? allCompanies : [])
        .filter((c) => {
          const companySimulatorId = resolveSimulatorId(c, simulators);
          return (
            companySimulatorId === selectedSimulatorId &&
            c.recruitmentSettings?.isActive !== false
          );
        })
        .slice()
        .sort((a, b) =>
          String(a.companyName || "").localeCompare(
            String(b.companyName || ""),
          ),
        ),
    [allCompanies, selectedSimulatorId, simulators],
  );

  const hasDirectCompany = Boolean(String(companyId || "").trim());
  const directCompanyReady =
    !hasDirectCompany ||
    (directCompanyAttempted && !directCompanyLoading && Boolean(company));
  const formReady =
    !simulatorsLoading &&
    !companiesLoading &&
    (hasDirectCompany ? directCompanyReady : companyCatalogAttempted);

  useEffect(() => {
    if (selectedCompanyId) {
      const c = allCompanies.find((item) => item.id === selectedCompanyId);
      if (c) {
        setCompany(c);
      } else if (!hasDirectCompany) {
        setCompany(null);
      }
    } else if (!hasDirectCompany) {
      setCompany(null);
    }
  }, [allCompanies, hasDirectCompany, selectedCompanyId]);

  if (
    hasDirectCompany &&
    directCompanyAttempted &&
    !directCompanyLoading &&
    !company
  ) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-[#18181b] px-4 text-center">
        <Briefcase size={48} className="text-slate-300 mb-4" />
        <h1 className="text-xl font-bold text-slate-900 dark:text-[#fafafa] mb-2">
          Empresa não disponível
        </h1>
        <p className="text-slate-500 dark:text-[#71717a] mb-6 max-w-sm">
          Esta empresa não está disponível para novas inscrições.
        </p>
        <Button onClick={() => navigate("/")}>Voltar ao Início</Button>
      </div>
    );
  }

  if (!formReady) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center gap-3 bg-slate-50 dark:bg-[#18181b]"
        role="status"
        aria-live="polite"
      >
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-800 dark:border-slate-200"></div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Carregando simuladores e empresas...
        </p>
      </div>
    );
  }

  if (availableSimulators.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-[#18181b] px-4 text-center">
        <Gamepad2 size={48} className="text-slate-300 mb-4" />
        <h1 className="text-xl font-bold text-slate-900 dark:text-[#fafafa] mb-2">
          {simulatorsError
            ? "Falha ao carregar simuladores"
            : "Nenhum simulador disponível"}
        </h1>
        <p className="text-slate-500 dark:text-[#71717a] mb-6 max-w-sm">
          {simulatorsError
            ? "O Firebase não permitiu carregar a lista pública de simuladores. Verifique as regras publicadas do Firestore."
            : "Não há simuladores ativos disponíveis para novas inscrições no momento."}
        </p>
        <Button onClick={() => navigate("/")}>Voltar ao Início</Button>
      </div>
    );
  }

  if (!hasDirectCompany && companyCatalogAttempted && !companyCatalogLoaded) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-[#18181b] px-4 text-center">
        <Briefcase size={48} className="text-slate-300 mb-4" />
        <h1 className="text-xl font-bold text-slate-900 dark:text-[#fafafa] mb-2">
          Falha ao carregar empresas
        </h1>
        <p className="text-slate-500 dark:text-[#71717a] mb-6 max-w-sm">
          Não foi possível carregar o catálogo público de empresas. Tente abrir
          esta página novamente.
        </p>
        <Button onClick={() => navigate("/")}>Voltar ao Início</Button>
      </div>
    );
  }

  if (!hasDirectCompany && allCompanies.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-[#18181b] px-4 text-center">
        <Briefcase size={48} className="text-slate-300 mb-4" />
        <h1 className="text-xl font-bold text-slate-900 dark:text-[#fafafa] mb-2">
          Nenhuma empresa encontrada
        </h1>
        <p className="text-slate-500 dark:text-[#71717a] mb-6 max-w-sm">
          Ainda não existem empresas cadastradas no sistema, ou houve um erro de
          permissão ao tentar carregar a lista pública de empresas.
        </p>
        <Button onClick={() => navigate("/")}>Voltar ao Início</Button>
      </div>
    );
  }

  const hasSettings =
    company?.recruitmentSettings &&
    Object.values(company.recruitmentSettings).some((v) => !!v);
  const recruitmentSettings = company?.recruitmentSettings || {};

  const handleReturnToCompanies = () => {
    setCompany(null);
    setSelectedCompanyId("");
    setStep(1);
  };

  const renderActionButton = (isFullWidth = false) => {
    if (userApplicationStatus === 'owner') {
      return (
        <div className="flex flex-col gap-3 w-full">
          <div className="bg-amber-500/10 text-amber-600 dark:text-amber-400 p-4 rounded-xl border border-amber-500/20 text-center font-medium w-full text-[15px]">
            Você é proprietário desta empresa.
          </div>
          <Button onClick={handleReturnToCompanies} variant="outline" className={`w-full font-medium ${isFullWidth ? "" : "sm:mx-auto sm:max-w-xs"}`}>
            Voltar para Empresas
          </Button>
        </div>
      );
    }
    if (userApplicationStatus === 'member') {
      return (
        <div className="flex flex-col gap-3 w-full">
          <div className="bg-blue-500/10 text-blue-600 dark:text-blue-400 p-4 rounded-xl border border-blue-500/20 text-center font-medium w-full text-[15px]">
            Você já faz parte desta empresa.
          </div>
          <Button onClick={handleReturnToCompanies} variant="outline" className={`w-full font-medium ${isFullWidth ? "" : "sm:mx-auto sm:max-w-xs"}`}>
            Voltar para Empresas
          </Button>
        </div>
      );
    }
    const buttonLabel = !verifiedCurrentUser
      ? "Acessar com Google"
      : "Continuar Inscrição";

    return (
      <Button
        onClick={handleNext}
        className={`bg-slate-900 hover:bg-slate-800 text-white shadow-md dark:shadow-none shadow-slate-900/10 px-6 py-3 h-[52px] text-[15px] flex items-center justify-center gap-3 font-semibold rounded-xl transition-all ${
          isFullWidth ? "w-full mx-auto" : "w-full sm:w-auto"
        }`}
      >
        {!verifiedCurrentUser && (
          <svg
            className="w-5 h-5 bg-white dark:bg-[#1A1F26] rounded-full p-0.5"
            viewBox="0 0 24 24"
          >
            <path
              fill="currentColor"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
        )}
        {buttonLabel}
      </Button>
    );
  };

  const handleNext = async () => {
    if (!company) {
      alert("Selecione uma empresa primeiro.");
      return;
    }
    if (verifiedCurrentUser) {
      if (userApplicationStatus === 'owner') {
        alert("Você é proprietário desta empresa e não pode se inscrever como motorista.");
        return;
      }
      if (userApplicationStatus === 'member') {
        alert("Você já faz parte desta empresa e não precisa enviar uma nova inscrição.");
        return;
      }
      setFormData(buildRecruitmentDraft(null));
      setGoogleUid(auth.currentUser?.uid || verifiedCurrentUser.id);
      setPhotoPreview(null);
      setStep(2);
      return;
    }

    try {
      const resultUser = await signInWithGoogleAccount();

      // Depois do login, valide somente a empresa e o vínculo atual. O
      // histórico de inscrições não participa da abertura deste formulário.
      const isOwner = company.ownerId === resultUser.uid;
      const isMember = memberships.find(m => m.userId === resultUser.uid && m.companyId === company.id && m.status === 'active');

      if (isOwner) {
        alert("Você é proprietário desta empresa e não pode se inscrever como motorista.");
        return;
      }
      if (isMember) {
        alert("Você já faz parte desta empresa e não precisa enviar uma nova inscrição.");
        return;
      }
      setFormData(buildRecruitmentDraft(null));
      setGoogleUid(resultUser.uid);
      setPhotoPreview(null);
      setStep(2);
    } catch (err: any) {
      const errStr = `${err.message || ""} ${err.code || ""} ${err.name || ""} ${err?.cause?.message || ""} ${err?.cause?.name || ""}`.toLowerCase();
      
      const isCancel = 
        err.code === "auth/popup-closed-by-user" || 
        err.code === "auth/cancelled-popup-request" ||
        errStr.includes("12501") || 
        errStr.includes("cancel") || 
        errStr.includes("fechar");

      const isCredentialManager = 
        errStr.includes("credential manager") ||
        errStr.includes("credentialmanager") ||
        errStr.includes("getcredentialunsupportedexception") ||
        errStr.includes("createcredentialexception") ||
        errStr.includes("unsupportedoperationexception") ||
        errStr.includes("provider configuration") ||
        errStr.includes("no credential provider") ||
        errStr.includes("play services") ||
        errStr.includes("not supported");

      if (isCancel) {
        console.log("[Recruitment] Cancelado pelo usuário");
      } else if (isCredentialManager) {
        console.error("[Recruitment] Credential Manager error:", { name: err.name, code: err.code, message: err.message, cause: err.cause });
        alert("Não foi possível abrir o login com Google neste dispositivo. Atualize os Serviços do Google Play e tente novamente.");
      } else {
        console.error("[Recruitment] Generic error:", { name: err.name, code: err.code, message: err.message });
        alert("Erro ao fazer login com Google: " + (err.message || "Erro desconhecido"));
      }
    }
  };
  const handleBack = () => setStep(1);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company) return;

    if (!photoPreview) {
      alert("A foto do motorista é obrigatória.");
      return;
    }

    const authenticatedUser = auth.currentUser;
    const uid = authenticatedUser?.uid || "";
    if (
      !uid ||
      (googleUid && googleUid !== uid) ||
      (currentUser?.id && currentUser.id !== uid)
    ) {
      alert(
        "Sua sessão mudou durante a inscrição. Volte e confirme novamente a conta Google.",
      );
      setGoogleUid(null);
      setStep(1);
      return;
    }
    const email = String(authenticatedUser?.email || formData.email || "")
      .trim()
      .toLowerCase();
    
    if (company.ownerId === uid) {
      alert("Você é proprietário desta empresa e não pode se inscrever como motorista.");
      return;
    }
    
    const isMember = memberships.find(m => m.userId === uid && m.companyId === company.id && m.status === 'active');
    if (isMember) {
      alert("Você já faz parte desta empresa e não precisa enviar uma nova inscrição.");
      return;
    }

    setSubmitting(true);
    try {
      let uploadedPhotoUrl = formData.applicationPhotoURL;
      let applicationPhotoTransport:
        | "none"
        | "storage"
        | "firestore-data-url"
        | "legacy" = uploadedPhotoUrl ? "legacy" : "none";

      if (photoPreview && photoPreview.startsWith("data:image")) {
        setUploadingImage(true);
        try {
          const imageRef = ref(
            storage,
            `empresas/${company.id || "default"}/recruitment_photos/${Date.now()}_${Math.random()
              .toString(36)
              .slice(2, 10)}.jpg`,
          );
          await withTimeout(
            uploadString(imageRef, photoPreview, "data_url", {
              contentType: "image/jpeg",
              cacheControl: "public,max-age=31536000,immutable",
            }),
            RECRUITMENT_PHOTO_TIMEOUT_MS,
          );
          uploadedPhotoUrl = await withTimeout(
            getDownloadURL(imageRef),
            RECRUITMENT_PHOTO_TIMEOUT_MS,
          );
          applicationPhotoTransport = "storage";
        } catch (uploadError) {
          console.warn(
            "Falha no upload da foto. O cadastro usará a cópia compactada do Firestore.",
            uploadError,
          );
          uploadedPhotoUrl = photoPreview;
          applicationPhotoTransport = "firestore-data-url";
        } finally {
          setUploadingImage(false);
        }
      }

      const selectedSimulator = (Array.isArray(simulators) ? simulators : []).find(
        (simulator: any) => String(simulator.id || "") === selectedSimulatorId,
      );
      const applicationCompanyName = String(
        company.companyName || company.fleetName || "",
      ).trim();
      const applicationCompanyLogoURL = String(
        company.logoUrl || company.logoURL || company.companyLogoURL || "",
      ).trim();
      const applicationSimulatorName = String(
        selectedSimulator?.name || company.simulatorName || "",
      ).trim();

      const applicationId = await submitRecruitmentApplication({
        companyId: company.id,
        simulatorId: selectedSimulatorId,
        companyName: applicationCompanyName,
        companyLogoURL: applicationCompanyLogoURL,
        simulatorName: applicationSimulatorName,
        ...formData,
        userId: uid,
        email,
        applicationPhotoURL:
          uploadedPhotoUrl ||
          "",
        applicationPhotoTransport,
      });
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(
          PENDING_RECRUITMENT_APPLICATION_ID_KEY,
          applicationId,
        );
      }
      // Every submitted driver application enters the shared Pendências surface.
      // The durable session pointer above lets that page resolve this exact request.
      navigate("/pending-applications", { replace: true });
    } catch (e: any) {
      alert("Erro ao enviar solicitação: " + (e?.message || e));
    } finally {
      setSubmitting(false);
      setUploadingImage(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#09090b] flex flex-col font-sans">
      <header
        className="bg-white dark:bg-[#1A1F26] border-b border-slate-200 dark:border-[#2A2F3A] sticky top-0 z-10 transition-colors"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="max-w-5xl mx-auto px-4 sm:px-6 min-h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={() => {
                if (company) {
                  setCompany(null);
                  setSelectedCompanyId("");
                  setStep(1);
                } else {
                  navigate("/");
                }
              }}
              className="p-1.5 sm:p-2 flex shrink-0 items-center justify-center text-slate-500 hover:text-slate-900 dark:text-[#a1a1aa] dark:hover:text-white transition-colors rounded-full hover:bg-slate-100 dark:hover:bg-[#27272a]"
              title="Voltar"
            >
              <ChevronLeft size={20} />
            </button>
            <div>
              <h1 className="text-[15px] sm:text-[16px] font-bold text-slate-900 dark:text-[#fafafa] leading-tight tracking-tight">
                NVU
              </h1>
              <p className="text-[11px] sm:text-[12px] font-medium text-slate-500 dark:text-[#a1a1aa]">
                Inscrição de motorista
              </p>
            </div>
          </div>
          {step === 2 && (
            <button
              onClick={handleBack}
              className="text-slate-500 hover:text-slate-900 dark:text-[#fafafa] flex items-center gap-1.5 text-[12px] sm:text-[13px] font-semibold transition-colors bg-slate-100 dark:bg-[#27272a] hover:bg-slate-200 px-2.5 sm:px-3 py-1.5 rounded-lg shrink-0"
            >
              <ChevronLeft size={14} />{" "}
              <span className="hidden sm:inline">Voltar</span>
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-8 flex flex-col items-center">
        {!company ? (
          <div className="w-full max-w-[440px] my-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="text-center mb-8">
              <div className="w-16 h-16 sm:w-20 sm:h-20 bg-blue-50 dark:bg-blue-500/10 rounded-[20px] flex items-center justify-center mx-auto mb-5 border border-blue-100 dark:border-blue-500/20">
                <Briefcase
                  size={32}
                  className="text-blue-600 dark:text-blue-500"
                />
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-[#fafafa] tracking-tight mb-2">
                Junte-se à Nossa Rede
              </h2>
              <p className="text-slate-500 dark:text-[#a1a1aa] text-[15px]">
                Selecione um simulador e a empresa para visualizar as vagas
                disponíveis.
              </p>
            </div>

            <div className="bg-white dark:bg-[#1A1F26] p-6 sm:p-7 rounded-[24px] border border-slate-200/60 dark:border-[#2A2F3A] shadow-xl shadow-slate-200/40 dark:shadow-none space-y-5">
              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-slate-700 dark:text-[#e4e4e7] ml-1">
                  Simulador
                </label>
                <SafeSelect
                  title="Selecionar simulador"
                  placeholder="Selecione..."
                  value={selectedSimulatorId}
                  options={availableSimulators.map((sim: any) => ({
                    value: sim.id,
                    label: sim.name,
                  }))}
                  onChange={(simulatorId) => {
                    setSelectedSimulatorId(simulatorId);
                    setSelectedCompanyId("");
                    setCompany(null);
                  }}
                  emptyMessage="Nenhum simulador disponível."
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-slate-700 dark:text-[#e4e4e7] ml-1">
                  Empresa
                </label>
                <SafeSelect
                  title="Selecionar empresa"
                  placeholder={
                    selectedSimulatorId
                      ? "Selecione a empresa"
                      : "Selecione um simulador antes"
                  }
                  value={selectedCompanyId}
                  disabled={!selectedSimulatorId}
                  options={filteredCompanies.map((comp) => ({
                    value: comp.id,
                    label: comp.companyName || "Empresa sem nome",
                  }))}
                  onChange={setSelectedCompanyId}
                  emptyMessage="Nenhuma empresa disponível para este simulador."
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row gap-6 sm:gap-8 items-start w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Left Column (Info / Progression) */}
            <div className="w-full lg:w-[320px] shrink-0 space-y-4">
              <div className="bg-white dark:bg-[#1A1F26] rounded-2xl border border-slate-200 shadow-sm dark:shadow-none overflow-hidden pb-4">
                <div className="px-5 py-4 border-b border-slate-100 dark:border-[#2A2F3A] bg-slate-50/50 dark:bg-[#09090b]/20">
                  <h3 className="font-semibold text-slate-800 dark:text-[#f4f4f5] flex items-center gap-2">
                    <Briefcase size={16} className="text-slate-500" /> Vagas
                    Abertas
                  </h3>
                </div>
                <div className="px-5 pt-4">
                  <p className="text-slate-900 dark:text-[#fafafa] font-semibold text-[15px] mb-1">
                    Motorista
                  </p>
                  <p className="text-slate-500 dark:text-[#a1a1aa] text-[14px] leading-relaxed">
                    Faça parte da operação logística de {company.companyName}.
                    Buscamos motoristas dedicados para nossas rotas.
                  </p>
                </div>
              </div>

              <div className="bg-white dark:bg-[#1A1F26] rounded-2xl border border-slate-200 shadow-sm dark:shadow-none overflow-hidden pb-4">
                <div className="px-5 py-4 border-b border-slate-100 dark:border-[#2A2F3A] bg-slate-50/50 dark:bg-[#09090b]/20">
                  <h3 className="font-semibold text-slate-800 dark:text-[#f4f4f5] flex items-center gap-2">
                    <Navigation2 size={16} className="text-slate-500" /> Como
                    Funciona
                  </h3>
                </div>
                <div className="px-5 pt-5">
                  <div className="flex flex-col gap-4">
                    <div className="flex items-start gap-4">
                      <div
                        className={`mt-1 flex-shrink-0 w-3 h-3 rounded-full shadow-[0_0_0_4px_rgba(59,130,246,0.1)] ${step >= 1 ? "bg-blue-500" : "bg-slate-200 dark:bg-[#3f3f46]"}`}
                      />
                      <p
                        className={`text-[14px] font-medium leading-none ${step >= 1 ? "text-slate-900 dark:text-[#fafafa]" : "text-slate-500 dark:text-[#a1a1aa]"}`}
                      >
                        Escolher Empresa
                      </p>
                    </div>
                    <div className="w-[2px] h-4 bg-slate-100 dark:bg-[#2A2F3A] ml-1.5 -my-2" />
                    <div className="flex items-start gap-4">
                      <div
                        className={`mt-1 flex-shrink-0 w-3 h-3 rounded-full shadow-[0_0_0_4px_rgba(59,130,246,0.1)] ${step >= 2 ? "bg-blue-500" : "bg-slate-200 dark:bg-[#3f3f46]"}`}
                      />
                      <p
                        className={`text-[14px] font-medium leading-none ${step >= 2 ? "text-slate-900 dark:text-[#fafafa]" : "text-slate-500 dark:text-[#a1a1aa]"}`}
                      >
                        Preencher Perfil
                      </p>
                    </div>
                    <div className="w-[2px] h-4 bg-slate-100 dark:bg-[#2A2F3A] ml-1.5 -my-2" />
                    <div className="flex items-start gap-4">
                      <div
                        className={`mt-1 flex-shrink-0 w-3 h-3 rounded-full shadow-[0_0_0_4px_rgba(59,130,246,0.1)] ${step >= 3 ? "bg-blue-500" : "bg-slate-200 dark:bg-[#3f3f46]"}`}
                      />
                      <p
                        className={`text-[14px] font-medium leading-none ${step >= 3 ? "text-slate-900 dark:text-[#fafafa]" : "text-slate-500 dark:text-[#a1a1aa]"}`}
                      >
                        Aguardar RH
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column (Form / Main content) */}
            <div className="flex-1 w-full min-w-0">
              {step === 1 && (
                <div className="space-y-6">
                  {company ? (
                    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                      {!hasSettings ? (
                        <div className="bg-white dark:bg-[#1A1F26] p-8 sm:p-12 rounded-2xl border border-slate-200 shadow-sm dark:shadow-none text-center flex flex-col items-center">
                          <div className="w-16 h-16 bg-slate-50 dark:bg-[#18181b] border border-slate-100 dark:border-[#2A2F3A]/50 rounded-2xl mb-6 flex items-center justify-center">
                            <FileText
                              size={28}
                              className="text-slate-400 dark:text-[#71717a]"
                            />
                          </div>
                          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-[#fafafa] mb-3 tracking-tight">
                            Candidatura Online
                          </h2>
                          <p className="text-slate-500 dark:text-[#71717a] mb-8 max-w-sm text-[15px] leading-relaxed">
                            A empresa não possui informações preenchidas. Inicie
                            seu processo conectando sua conta.
                          </p>

                          <div className="w-full max-w-sm p-4 sm:p-5 border border-slate-200 dark:border-[#2A2F3A] rounded-xl bg-slate-50 dark:bg-[#18181b] mb-8 text-left space-y-3">
                            <div className="flex items-center gap-3 text-sm font-medium text-slate-700 dark:text-[#e4e4e7]">
                              <CheckCircle2
                                size={16}
                                className="text-emerald-500 shrink-0"
                              />{" "}
                              <span className="truncate">
                                Criação de perfil automático
                              </span>
                            </div>
                            <div className="flex items-center gap-3 text-sm font-medium text-slate-700 dark:text-[#e4e4e7]">
                              <CheckCircle2
                                size={16}
                                className="text-emerald-500 shrink-0"
                              />{" "}
                              <span className="truncate">
                                Sem senhas para decorar
                              </span>
                            </div>
                          </div>

                          <div className="w-full sm:w-auto">
                            {renderActionButton(true)}
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4 sm:space-y-6">
                          {recruitmentSettings.about && (
                            <div className="bg-white dark:bg-[#1A1F26] p-6 sm:p-7 rounded-2xl border border-slate-200 shadow-sm dark:shadow-none">
                              <h2 className="text-[16px] font-bold text-slate-900 dark:text-[#fafafa] mb-4 flex items-center gap-2">
                                <Info size={18} className="text-slate-400" />{" "}
                                Sobre a Empresa
                              </h2>
                              <div className="prose prose-sm prose-slate max-w-none prose-p:leading-relaxed dark:prose-invert">
                                <Markdown>{recruitmentSettings.about}</Markdown>
                              </div>
                            </div>
                          )}
                          {recruitmentSettings.rules && (
                            <div className="bg-white dark:bg-[#1A1F26] p-6 sm:p-7 rounded-2xl border border-slate-200 shadow-sm dark:shadow-none">
                              <h2 className="text-[16px] font-bold text-slate-900 dark:text-[#fafafa] mb-4 flex items-center gap-2">
                                <CheckCircle2
                                  size={18}
                                  className="text-slate-400"
                                />{" "}
                                Regras
                              </h2>
                              <div className="prose prose-sm prose-slate max-w-none prose-p:leading-relaxed dark:prose-invert">
                                <Markdown>{recruitmentSettings.rules}</Markdown>
                              </div>
                            </div>
                          )}
                          {recruitmentSettings.howItWorks && (
                            <div className="bg-white dark:bg-[#1A1F26] p-6 sm:p-7 rounded-2xl border border-slate-200 shadow-sm dark:shadow-none">
                              <h2 className="text-[16px] font-bold text-slate-900 dark:text-[#fafafa] mb-4 flex items-center gap-2">
                                <Navigation2
                                  size={18}
                                  className="text-slate-400"
                                />{" "}
                                Operações
                              </h2>
                              <div className="prose prose-sm prose-slate max-w-none prose-p:leading-relaxed dark:prose-invert">
                                <Markdown>
                                  {recruitmentSettings.howItWorks}
                                </Markdown>
                              </div>
                            </div>
                          )}
                          {recruitmentSettings.benefits && (
                            <div className="bg-white dark:bg-[#1A1F26] p-6 sm:p-7 rounded-2xl border border-slate-200 shadow-sm dark:shadow-none">
                              <h2 className="text-[16px] font-bold text-slate-900 dark:text-[#fafafa] mb-4 flex items-center gap-2">
                                <Star size={18} className="text-slate-400" />{" "}
                                Benefícios
                              </h2>
                              <div className="prose prose-sm prose-slate max-w-none prose-p:leading-relaxed dark:prose-invert">
                                <Markdown>
                                  {recruitmentSettings.benefits}
                                </Markdown>
                              </div>
                            </div>
                          )}

                          <div className="pt-2 pb-8">
                            {renderActionButton(false)}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              )}

              {step === 2 && (
                <div className="bg-white dark:bg-[#1A1F26] p-6 sm:p-8 rounded-[24px] border border-slate-200/60 dark:border-[#2A2F3A] shadow-xl shadow-slate-200/40 dark:shadow-none animate-in fade-in slide-in-from-bottom-2 duration-500">
                  <div className="mb-6 border-b border-slate-100 dark:border-[#2A2F3A]/50 pb-4">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-[#fafafa] tracking-tight">
                      Complete seu perfil
                    </h2>
                    <p className="text-[14px] text-slate-500 dark:text-[#a1a1aa] mt-1">
                      Quase lá. Preencha as informações abaixo.
                    </p>
                  </div>

                  <form onSubmit={handleSubmit} className="space-y-6">
                    {/* Profiling Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                      <div className="space-y-3 sm:col-span-2">
                        <label className="text-[15px] font-semibold text-slate-800 dark:text-[#fafafa]">
                          Identificação
                        </label>
                        <div className="flex flex-col sm:flex-row gap-4 bg-slate-50/50 dark:bg-[#09090b]/50 p-4 rounded-2xl border border-slate-200 dark:border-[#2A2F3A]/60 w-full overflow-hidden">
                          <div className="relative group shrink-0 pt-0.5">
                            {photoPreview ? (
                              <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-white dark:border-[#2A2F3A] shadow-sm relative">
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
                                      onChange={handleImageSelect}
                                    />
                                  </label>
                                </div>
                              </div>
                            ) : (
                              <label className="w-16 h-16 rounded-full bg-slate-100 dark:bg-[#2A2F3A] border border-dashed border-slate-300 dark:border-[#3f3f46] flex flex-col items-center justify-center cursor-pointer hover:bg-slate-200 dark:hover:bg-[#3f3f46] transition-colors">
                                <ImageIcon
                                  size={20}
                                  className="text-slate-400 dark:text-[#71717a]"
                                />
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={handleImageSelect}
                                />
                              </label>
                            )}
                          </div>
                          <div className="flex-1 space-y-2 w-full">
                            <div className="grid grid-cols-1 gap-2">
                              <input
                                required
                                type="text"
                                value={formData.fullName}
                                onChange={(e) =>
                                  setFormData({
                                    ...formData,
                                    fullName: e.target.value,
                                  })
                                }
                                className="w-full bg-white dark:bg-[#09090b] border border-slate-200 dark:border-[#2A2F3A] rounded-xl px-4 h-12 text-[15px] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:text-[#fafafa] transition-all shadow-sm"
                                placeholder="Nome Completo"
                              />
                              <input
                                required
                                disabled
                                type="email"
                                value={formData.email}
                                onChange={(e) =>
                                  setFormData({
                                    ...formData,
                                    email: e.target.value,
                                  })
                                }
                                className="w-full bg-slate-50 dark:bg-[#09090b]/50 border border-slate-200 dark:border-[#2A2F3A] rounded-xl px-4 h-12 text-[15px] text-slate-500 dark:text-[#a1a1aa] cursor-not-allowed shadow-none"
                                title="E-mail vinculado do Google"
                              />
                            </div>
                            {photoPreview && (
                              <button
                                type="button"
                                onClick={() => {
                                  imageSelectionVersion.current += 1;
                                  setPhotoPreview(null);
                                  setFormData((f) => ({ ...f, applicationPhotoURL: "" }));
                                }}
                                className="text-rose-500 hover:text-rose-600 text-[12px] font-medium flex items-center gap-1 transition-colors mt-2"
                              >
                                Remover foto
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-1.5 pt-2">
                        <label className="text-[13px] font-medium text-slate-700 dark:text-[#d4d4d8] ml-1">
                          WhatsApp
                        </label>
                        <input
                          required
                          type="tel"
                          inputMode="tel"
                          value={formData.whatsapp}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              whatsapp: e.target.value,
                            })
                          }
                          className="w-full bg-white dark:bg-[#09090b] border border-slate-200 dark:border-[#2A2F3A] rounded-xl px-4 h-12 text-[15px] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:text-[#fafafa] transition-all shadow-sm"
                          placeholder="(11) 90000-0000"
                        />
                      </div>

                      <div className="space-y-1.5 pt-2">
                        <label className="text-[13px] font-medium text-slate-700 dark:text-[#d4d4d8] ml-1">
                          Objetivo Logístico
                        </label>
                        <input
                          required
                          type="text"
                          value={formData.objective}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              objective: e.target.value,
                            })
                          }
                          className="w-full bg-white dark:bg-[#09090b] border border-slate-200 dark:border-[#2A2F3A] rounded-xl px-4 h-12 text-[15px] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:text-[#fafafa] transition-all shadow-sm"
                          placeholder="Ex: Simulação séria, diversão..."
                        />
                      </div>

                      <div className="space-y-4 sm:col-span-2 pt-4 border-t border-slate-100 dark:border-[#2A2F3A]/50">
                        <label className="text-[15px] font-semibold text-slate-800 dark:text-[#fafafa]">
                          Desempenho e Frota
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label className="text-[13px] font-medium text-slate-700 dark:text-[#d4d4d8] ml-1">
                              Experiência?
                            </label>
                            <div className="flex bg-slate-100 dark:bg-[#27272a]/50 p-1.5 rounded-xl h-12">
                              <label className="flex-1 relative cursor-pointer">
                                <input
                                  type="radio"
                                  name="hasExperience"
                                  checked={formData.hasExperience === true}
                                  onChange={() =>
                                    setFormData({
                                      ...formData,
                                      hasExperience: true,
                                    })
                                  }
                                  className="sr-only"
                                />
                                <div
                                  className={`text-[14px] h-full flex items-center justify-center font-medium rounded-lg transition-all ${formData.hasExperience === true ? "bg-white dark:bg-[#1A1F26] shadow-sm text-slate-900 dark:text-[#fafafa]" : "text-slate-500 hover:text-slate-700 dark:text-[#e4e4e7]"}`}
                                >
                                  Sim, tenho
                                </div>
                              </label>
                              <label className="flex-1 relative cursor-pointer">
                                <input
                                  type="radio"
                                  name="hasExperience"
                                  checked={formData.hasExperience === false}
                                  onChange={() =>
                                    setFormData({
                                      ...formData,
                                      hasExperience: false,
                                    })
                                  }
                                  className="sr-only"
                                />
                                <div
                                  className={`text-[14px] h-full flex items-center justify-center font-medium rounded-lg transition-all ${formData.hasExperience === false ? "bg-white dark:bg-[#1A1F26] shadow-sm text-slate-900 dark:text-[#fafafa]" : "text-slate-500 hover:text-slate-700 dark:text-[#e4e4e7]"}`}
                                >
                                  Não, 1ª vez
                                </div>
                              </label>
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <label className="text-[13px] font-medium text-slate-700 dark:text-[#d4d4d8] ml-1">
                              Meta viagens/semana
                            </label>
                            <input
                              required
                              type="number"
                              inputMode="numeric"
                              min="1"
                              value={formData.deliveriesPerWeek}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  deliveriesPerWeek: e.target.value,
                                })
                              }
                              className="w-full bg-white dark:bg-[#09090b] border border-slate-200 dark:border-[#2A2F3A] rounded-xl px-4 h-12 text-[15px] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:text-[#fafafa] transition-all shadow-sm"
                              placeholder="Ex: 5"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="space-y-1.5 pt-2">
                        <label className="text-[13px] font-medium text-slate-700 dark:text-[#d4d4d8] ml-1">
                          Veículo Principal
                        </label>
                        <input
                          required
                          type="text"
                          value={formData.primaryVehicle}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              primaryVehicle: e.target.value,
                            })
                          }
                          className="w-full bg-white dark:bg-[#09090b] border border-slate-200 dark:border-[#2A2F3A] rounded-xl px-4 h-12 text-[15px] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:text-[#fafafa] transition-all shadow-sm"
                          placeholder="Ex: Scania R..."
                        />
                      </div>
                      <div className="space-y-1.5 pt-2">
                        <label className="text-[13px] font-medium text-slate-700 dark:text-[#d4d4d8] ml-1">
                          Veículo Secundário{" "}
                          <span className="font-normal text-slate-400 dark:text-[#71717a] opacity-80">
                            (opic.)
                          </span>
                        </label>
                        <input
                          type="text"
                          value={formData.secondaryVehicle}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              secondaryVehicle: e.target.value,
                            })
                          }
                          className="w-full bg-white dark:bg-[#09090b] border border-slate-200 dark:border-[#2A2F3A] rounded-xl px-4 h-12 text-[15px] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:text-[#fafafa] transition-all shadow-sm"
                          placeholder="Ex: Volvo FH..."
                        />
                      </div>

                      <div className="space-y-1.5 sm:col-span-2 pt-4 border-t border-slate-100 dark:border-[#2A2F3A]/50">
                        <label className="text-[13px] font-medium text-slate-700 dark:text-[#d4d4d8] ml-1">
                          Motivo da Inscrição
                        </label>
                        <textarea
                          required
                          value={formData.reason}
                          onChange={(e) =>
                            setFormData({ ...formData, reason: e.target.value })
                          }
                          className="w-full bg-white dark:bg-[#09090b] border border-slate-200 dark:border-[#2A2F3A] rounded-xl px-4 py-3 text-[15px] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:text-[#fafafa] transition-all shadow-sm min-h-[100px] resize-none"
                          placeholder="Conte um pouco sobre sua vontade de ingressar à equipe..."
                        />
                      </div>
                    </div>

                    <div className="pt-6 border-t border-slate-100 dark:border-[#2A2F3A]/50 flex flex-col sm:flex-row gap-4 items-center justify-between">
                      <p className="text-[13px] text-slate-500 dark:text-[#a1a1aa] font-medium sm:max-w-xs text-center sm:text-left leading-snug">
                        Sua conta será ativada automaticamente após aprovação.
                      </p>
                      <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                        <Button
                          type="button"
                          onClick={() => setStep(1)}
                          variant="outline"
                          className="w-full sm:w-auto px-6 h-12 rounded-xl text-[15px] font-semibold border-slate-200 dark:border-[#2A2F3A]"
                        >
                          Cancelar
                        </Button>
                        <Button
                          type="submit"
                          disabled={submitting || uploadingImage}
                          className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-md shadow-blue-500/20 dark:shadow-none px-8 h-12 rounded-xl text-[15px] font-bold transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                        >
                          {submitting || uploadingImage
                            ? uploadingImage
                              ? "Processando foto..."
                              : "Enviando..."
                            : "Enviar Inscrição"}
                        </Button>
                      </div>
                    </div>
                  </form>
                </div>
              )}

              {step === 3 && (
                <div className="bg-white dark:bg-[#1A1F26] p-8 sm:p-12 rounded-[24px] border border-slate-200/60 dark:border-[#2A2F3A] shadow-xl shadow-slate-200/40 dark:shadow-none text-center flex flex-col items-center animate-in fade-in slide-in-from-bottom-2 duration-500">
                  <div className="w-16 h-16 bg-emerald-50 dark:bg-emerald-500/10 rounded-2xl flex items-center justify-center mb-6 border border-emerald-100 dark:border-emerald-500/20">
                    <CheckCircle2 size={32} className="text-emerald-500" />
                  </div>
                  <h2 className="text-2xl font-bold text-slate-900 dark:text-[#fafafa] mb-3 tracking-tight">
                    Candidatura Concluída
                  </h2>
                  <p className="text-slate-500 dark:text-[#a1a1aa] max-w-sm mb-8 text-[15px] leading-relaxed">
                    Seu perfil foi registrado no banco de dados e aguarda
                    análise da administração da{" "}
                    <span className="font-semibold text-slate-700 dark:text-[#e4e4e7]">
                      {company.companyName}
                    </span>
                    .
                  </p>

                  <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/20 rounded-xl p-5 mb-8 w-full max-w-sm text-center">
                    <p className="text-[14px] font-medium text-amber-800 dark:text-amber-400 leading-relaxed">
                      Sua conta será ativada automaticamente caso sua inscrição
                      seja aprovada. Fique de olho no WhatsApp ou Email
                      recebido.
                    </p>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                    <Button
                      onClick={() => window.location.reload()}
                      className="bg-white dark:bg-[#1A1F26] border border-slate-200 dark:border-[#2A2F3A] text-slate-700 dark:text-[#e4e4e7] hover:bg-slate-50 dark:hover:bg-[#2A2F3A]/50 px-8 h-12 rounded-xl text-[15px] font-bold w-full sm:w-auto transition-colors"
                    >
                      Nova Inscrição
                    </Button>
                    <Button
                      onClick={() => navigate("/")}
                      className="bg-slate-900 hover:bg-slate-800 text-white px-8 h-12 rounded-xl flex items-center justify-center gap-2 text-[15px] font-bold shadow-md dark:shadow-none w-full sm:w-auto transition-colors"
                    >
                      Acompanhar Status <ArrowRight size={18} />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
