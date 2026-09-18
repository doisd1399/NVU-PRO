import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSessionStore } from "../context/AppContext";
import type { RecruitmentApplication } from "../context/AppContext";
import { useCompanyStore } from "../context/CompanyContext";
import { Button } from "../components/ui/Button";
import { StableImage } from "../components/common/StableImage";
import { repairApprovedMembership } from "../services/recruitmentAccessService";
import { toast } from "sonner";
import { db } from "../lib/firebase";
import { doc, setDoc } from "firebase/firestore";
import {
  ShieldAlert,
  CheckCircle2,
  ArrowRight,
  ChevronLeft,
  Building2,
  User,
} from "lucide-react";

const PENDING_RECRUITMENT_APPLICATION_ID_KEY =
  "nvu.pendingRecruitmentApplicationId";

export default function ApplicationStatus() {
  const {
    currentUser,
    authInitialized,
    membershipsLoaded,
    sessionUiReady,
    memberships,
    logOutApp,
  } = useSessionStore();
  const { recruitmentApplications } = useCompanyStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [repairingAccess, setRepairingAccess] = React.useState(false);
  const repairAttemptedRef = React.useRef(false);

  const requestedApplicationId = React.useMemo(() => {
    const routeState = location.state as { applicationId?: unknown } | null;
    const routeApplicationId =
      typeof routeState?.applicationId === "string"
        ? routeState.applicationId.trim()
        : "";
    if (routeApplicationId) return routeApplicationId;
    const currentApplicationId = String(
      (currentUser as any)?.currentRecruitmentApplicationId || "",
    ).trim();
    if (currentApplicationId) return currentApplicationId;
    if (typeof window === "undefined") return "";
    return window.sessionStorage.getItem(PENDING_RECRUITMENT_APPLICATION_ID_KEY)?.trim() || "";
  }, [location.state, currentUser]);

  React.useEffect(() => {
    if (!requestedApplicationId || typeof window === "undefined") return;
    window.sessionStorage.setItem(
      PENDING_RECRUITMENT_APPLICATION_ID_KEY,
      requestedApplicationId,
    );
  }, [requestedApplicationId]);

  const myApp = React.useMemo(() => {
    if (!requestedApplicationId || !currentUser?.id) return null;
    const normalizedCurrentEmail = String(currentUser.email || "")
      .trim()
      .toLowerCase();

    // Driver applications remain strictly tied to their Firebase UID. Company
    // registrations may have been submitted before authentication, so the
    // verified Google e-mail is also accepted for that specific flow.
    return (
      recruitmentApplications.find((application) => {
        if (application.id !== requestedApplicationId) return false;
        const applicationType = String(
          application.type || (application as any).registrationType || "",
        );
        if (applicationType !== "company_registration") {
          return application.userId === currentUser.id;
        }

        const normalizedApplicationEmail = String(application.email || "")
          .trim()
          .toLowerCase();
        return (
          application.userId === currentUser.id ||
          (Boolean(normalizedCurrentEmail) &&
            normalizedApplicationEmail === normalizedCurrentEmail)
        );
      }) ?? null
    );
  }, [
    currentUser?.email,
    currentUser?.id,
    recruitmentApplications,
    requestedApplicationId,
  ]);

  const isCompanyRegistration = Boolean(
    myApp &&
      String(myApp.type || (myApp as any).registrationType || "") ===
        "company_registration",
  );
  const companyRegistration = (myApp || null) as
    | (RecruitmentApplication & {
        registrationType?: string;
        companyName?: string;
        ownerName?: string;
        companyLogoURL?: string;
        ownerPhotoUrl?: string;
        simulatorName?: string;
        rejectionReason?: string;
      })
    | null;

  React.useEffect(() => {
    if (!isCompanyRegistration || !companyRegistration || !currentUser?.id) return;
    const currentPointer = String(
      (currentUser as any).currentRecruitmentApplicationId || "",
    ).trim();
    const currentStatus = String(
      (currentUser as any).currentRecruitmentStatus || "",
    ).trim();
    if (
      currentPointer === companyRegistration.id &&
      currentStatus === companyRegistration.status
    ) {
      return;
    }

    void setDoc(
      doc(db, "users", currentUser.id),
      {
        applicationSubmitted: true,
        currentRecruitmentApplicationId: companyRegistration.id,
        currentRecruitmentStatus: companyRegistration.status,
        currentRecruitmentType: "company_registration",
        currentRecruitmentSimulatorId: companyRegistration.simulatorId || "",
      },
      { merge: true },
    ).catch((error) => {
      console.warn(
        "[NVU Company Registration] Não foi possível persistir o acompanhamento da solicitação.",
        error,
      );
    });
  }, [
    companyRegistration,
    currentUser,
    isCompanyRegistration,
  ]);

  const handleLogout = async () => {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(PENDING_RECRUITMENT_APPLICATION_ID_KEY);
    }
    await logOutApp();
    navigate("/");
  };

  const handleApply = () => {
    navigate("/apply");
  };

  const handleBackToStart = () => {
    navigate("/", { replace: true });
  };

  const handleContinueApproved = React.useCallback(async () => {
    if (repairingAccess) return;
    setRepairingAccess(true);
    try {
      if (!myApp) {
        throw new Error("Inscrição de referência não encontrada.");
      }
      await repairApprovedMembership(myApp.id);
      toast.success("Acesso sincronizado com sucesso.");
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(PENDING_RECRUITMENT_APPLICATION_ID_KEY);
      }
      // A membership já foi gravada; preserve a instância Auth e o AppContext.
      // Recarregar a página aqui reabria o bootstrap e podia devolver o usuário
      // ao estado de login enquanto o vínculo ainda era reconciliado.
      navigate("/select-profile", { replace: true });
    } catch (error: any) {
      console.error("[NVU Recruitment] Falha ao reparar acesso aprovado:", error);
      toast.error(
        error?.message ||
          "Não foi possível sincronizar seu acesso agora. Tente novamente em instantes.",
      );
      setRepairingAccess(false);
    }
  }, [myApp, navigate, repairingAccess]);

  React.useEffect(() => {
    if (
      !isCompanyRegistration &&
      myApp?.status === "approved" &&
      membershipsLoaded &&
      !memberships.some((membership) => membership.status === "active") &&
      !repairAttemptedRef.current
    ) {
      repairAttemptedRef.current = true;
      void handleContinueApproved();
    }
  }, [
    isCompanyRegistration,
    myApp?.status,
    membershipsLoaded,
    memberships,
    handleContinueApproved,
  ]);

  React.useEffect(() => {
    if (authInitialized && !currentUser) {
      navigate("/", { replace: true });
    } else if (sessionUiReady && currentUser && membershipsLoaded) {
      const hasActiveMembership = memberships.some((m) => m.status === "active");
      if (hasActiveMembership) {
        navigate("/select-profile", { replace: true });
      }
    }
  }, [authInitialized, sessionUiReady, currentUser, membershipsLoaded, memberships, navigate]);

  const isRejected = myApp?.status === "rejected";
  const isPending = myApp?.status === "pending";
  const isApproved = myApp?.status === "approved";

  React.useEffect(() => {
    if (!sessionUiReady || !currentUser || !isPending) return;
    navigate("/pending-applications", {
      replace: true,
      state: requestedApplicationId
        ? { applicationId: requestedApplicationId }
        : undefined,
    });
  }, [currentUser, isPending, navigate, requestedApplicationId, sessionUiReady]);

  // Membership confirmation is needed to repair/authorize an approved access,
  // but it is not needed to mount this status surface or show its local data.
  if (!sessionUiReady || !currentUser) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#09090b]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-800 dark:border-slate-400"></div>
      </div>
    );
  }

  if (requestedApplicationId && !myApp) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#09090b]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-800 dark:border-slate-400"></div>
      </div>
    );
  }

  const companyRegistrationDateTime = (() => {
    if (!companyRegistration?.createdAt) return "Data indisponível";
    const parsedDate = new Date(companyRegistration.createdAt);
    if (Number.isNaN(parsedDate.getTime())) return "Data indisponível";
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(parsedDate);
  })();

  const handleNewCompanyRegistration = () => {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(PENDING_RECRUITMENT_APPLICATION_ID_KEY);
    }
    navigate("/register-company");
  };

  const handleContinueCompanyApproved = () => {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(PENDING_RECRUITMENT_APPLICATION_ID_KEY);
      navigate("/select-profile", { replace: true });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#09090b] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-[#fafafa] tracking-tight mb-2">
            NVU
          </h1>
          <p className="text-slate-500 dark:text-[#a1a1aa] text-sm font-medium">
            {isCompanyRegistration ? "Cadastro de Empresa" : "Portal do Candidato"}
          </p>
        </div>

        <div className="bg-white dark:bg-[#1A1F26] rounded-3xl border border-slate-200 dark:border-[#2A2F3A] shadow-xl dark:shadow-none overflow-hidden text-center p-8">
          {isRejected ? (
            // Rejected
            <div className="flex flex-col items-center">
              <div className="w-16 h-16 bg-red-50 dark:bg-red-500/10 border border-transparent dark:border-red-500/20 text-red-500 dark:text-red-400 rounded-full flex items-center justify-center mb-6">
                <ShieldAlert size={32} />
              </div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-[#fafafa] mb-2">
                {isCompanyRegistration
                  ? "Cadastro da empresa não aprovado"
                  : "Inscrição Não Aprovada"}
              </h2>
              <p className="text-slate-500 dark:text-[#a1a1aa] mb-8 text-sm">
                {isCompanyRegistration
                  ? companyRegistration?.rejectionReason ||
                    "Sua solicitação de cadastro não foi aprovada. Você pode revisar os dados e enviar uma nova solicitação."
                  : "Seu vínculo foi encerrado pela empresa. Envie uma nova inscrição para voltar à análise."}
              </p>
              <Button
                onClick={
                  isCompanyRegistration ? handleNewCompanyRegistration : handleApply
                }
                className="w-full h-12 rounded-xl font-semibold mb-3"
              >
                {isCompanyRegistration
                  ? "Enviar novo cadastro"
                  : "Enviar Nova Inscrição"}
              </Button>
              <Button
                onClick={handleLogout}
                variant="outline"
                className="w-full h-12 rounded-xl font-semibold"
              >
                Sair
              </Button>
            </div>
          ) : isApproved ? (
            <div className="flex flex-col items-center">
              <div className="w-20 h-20 bg-emerald-50 dark:bg-green-500/10 border border-emerald-100 dark:border-green-500/20 rounded-2xl flex items-center justify-center mb-6">
                <CheckCircle2
                  size={40}
                  className="text-emerald-500 dark:text-green-400"
                />
              </div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-[#fafafa] mb-3 tracking-tight">
                {isCompanyRegistration ? "Empresa aprovada" : "Inscrição aprovada"}
              </h2>
              <p className="text-slate-500 dark:text-[#a1a1aa] mb-8 text-sm leading-relaxed px-4">
                {isCompanyRegistration
                  ? "Sua empresa foi aprovada e o perfil corporativo já pode ser acessado."
                  : "Sua inscrição foi aprovada. O acesso será liberado assim que o vínculo com a empresa terminar de sincronizar."}
              </p>
              <Button
                onClick={
                  isCompanyRegistration
                    ? handleContinueCompanyApproved
                    : handleContinueApproved
                }
                disabled={!isCompanyRegistration && repairingAccess}
                className="w-full h-12 rounded-xl font-semibold"
              >
                {!isCompanyRegistration && repairingAccess
                  ? "Sincronizando acesso..."
                  : "Continuar"}
                {(isCompanyRegistration || !repairingAccess) && (
                  <ArrowRight size={18} />
                )}
              </Button>
            </div>
          ) : isPending ? (
            isCompanyRegistration && companyRegistration ? (
              <div className="flex flex-col items-center">
                <div className="w-16 h-16 bg-emerald-50 dark:bg-green-500/10 border border-emerald-100 dark:border-green-500/20 rounded-2xl flex items-center justify-center mb-5">
                  <CheckCircle2
                    size={32}
                    className="text-emerald-500 dark:text-green-400"
                  />
                </div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-[#fafafa] mb-2 tracking-tight">
                  Cadastro em avaliação
                </h2>
                <p className="text-slate-500 dark:text-[#a1a1aa] mb-5 text-sm leading-relaxed px-2">
                  Sua empresa ainda está aguardando avaliação da NVU.
                </p>

                <div className="w-full rounded-2xl border border-slate-200 dark:border-[#2A2F3A] bg-slate-50/80 dark:bg-[#111318] p-3.5 text-left mb-5">
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-[#71717a]">
                        Cadastro enviado
                      </p>
                      <p className="text-xs text-slate-500 dark:text-[#a1a1aa] mt-0.5">
                        {companyRegistrationDateTime}
                      </p>
                    </div>
                    <span className="inline-flex items-center rounded-full bg-amber-50 dark:bg-amber-500/10 px-2 py-1 text-[10px] font-semibold text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-500/20 whitespace-nowrap">
                      Aguardando avaliação
                    </span>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-3 rounded-xl bg-white dark:bg-[#18181b] border border-slate-200 dark:border-[#2A2F3A] px-3 py-2">
                      <div className="w-10 h-10 rounded-xl overflow-hidden bg-slate-100 dark:bg-[#27272a] flex items-center justify-center shrink-0">
                        {companyRegistration.ownerPhotoUrl ? (
                          <StableImage
                            src={companyRegistration.ownerPhotoUrl}
                            alt={companyRegistration.ownerName || "Proprietário"}
                            wrapperClassName="w-full h-full"
                            className="object-cover"
                            fallback={
                              <User
                                size={16}
                                className="text-slate-400 dark:text-[#a1a1aa]"
                              />
                            }
                          />
                        ) : (
                          <User
                            size={16}
                            className="text-slate-400 dark:text-[#a1a1aa]"
                          />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400 dark:text-[#71717a] mb-0.5">
                          Proprietário
                        </p>
                        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                          {companyRegistration.ownerName || currentUser.name || "Proprietário"}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 rounded-xl bg-white dark:bg-[#18181b] border border-slate-200 dark:border-[#2A2F3A] px-3 py-2">
                      <div className="w-10 h-10 rounded-xl overflow-hidden bg-slate-100 dark:bg-[#27272a] flex items-center justify-center shrink-0">
                        {companyRegistration.companyLogoURL ? (
                          <StableImage
                            src={companyRegistration.companyLogoURL}
                            alt={companyRegistration.companyName || "Empresa"}
                            wrapperClassName="w-full h-full"
                            className="object-cover"
                            fallback={
                              <Building2
                                size={16}
                                className="text-slate-400 dark:text-[#a1a1aa]"
                              />
                            }
                          />
                        ) : (
                          <Building2
                            size={16}
                            className="text-slate-400 dark:text-[#a1a1aa]"
                          />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400 dark:text-[#71717a] mb-0.5">
                          Empresa
                        </p>
                        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                          {companyRegistration.companyName || "Empresa em análise"}
                        </p>
                        {(companyRegistration.simulatorName || companyRegistration.simulatorId) && (
                          <p className="text-[11px] text-slate-500 dark:text-[#a1a1aa] truncate mt-0.5">
                            {companyRegistration.simulatorName || companyRegistration.simulatorId}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Button
                    onClick={handleLogout}
                    variant="outline"
                    className="w-full h-12 rounded-xl font-semibold border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10"
                  >
                    Desconectar
                  </Button>
                  <Button
                    onClick={handleBackToStart}
                    variant="outline"
                    className="w-full h-12 rounded-xl font-semibold text-slate-600 dark:text-[#f4f4f5] hover:text-slate-900 dark:hover:text-[#fafafa]"
                  >
                    Voltar para o início
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <div className="w-20 h-20 bg-emerald-50 dark:bg-green-500/10 border border-emerald-100 dark:border-green-500/20 rounded-2xl flex items-center justify-center mb-6">
                  <CheckCircle2
                    size={40}
                    className="text-emerald-500 dark:text-green-400"
                  />
                </div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-[#fafafa] mb-3 tracking-tight">
                  Sua inscrição foi enviada
                </h2>
                <p className="text-slate-500 dark:text-[#a1a1aa] mb-8 text-sm leading-relaxed px-4">
                  Sua inscrição foi enviada com sucesso e está aguardando análise
                  da empresa.
                  <br />
                  <br />
                  Você receberá acesso ao sistema após aprovação do RH.
                </p>
                <Button
                  onClick={handleBackToStart}
                  variant="outline"
                  className="w-full h-12 rounded-xl font-semibold text-slate-600 dark:text-[#f4f4f5] hover:text-slate-900 dark:hover:text-[#fafafa]"
                >
                  Voltar para o início
                </Button>
              </div>
            )
          ) : (
            // Hasn't applied yet, just logged in with Google implicitly
            <div className="flex flex-col items-center">
              <div className="w-16 h-16 bg-blue-50 dark:bg-blue-500/10 border border-transparent dark:border-blue-500/20 text-blue-500 dark:text-blue-400 rounded-full flex items-center justify-center mb-6">
                <ShieldAlert size={32} />
              </div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-[#fafafa] mb-2">
                Complete seu cadastro
              </h2>
              <p className="text-slate-500 dark:text-[#a1a1aa] mb-8 text-sm">
                Sua conta foi criada, mas você ainda não enviou sua inscrição
                para a avaliação do RH.
              </p>
              <div className="w-full flex justify-center">
                <Button
                  onClick={handleApply}
                  className="w-full h-12 bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-500 text-white rounded-xl font-semibold gap-2 mb-4"
                >
                  Continuar Inscrição
                  <ArrowRight size={18} />
                </Button>
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 dark:text-[#a1a1aa] hover:text-slate-900 dark:hover:text-[#fafafa] transition-colors"
              >
                <ChevronLeft size={16} /> Voltar para login
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-xs font-semibold text-slate-400 dark:text-[#71717a] mt-8">
          NVU © {new Date().getFullYear()} — Plataforma Operacional
        </p>
      </div>
    </div>
  );
}
