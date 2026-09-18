import React, { useCallback, useEffect, useState, useMemo, useRef } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useSessionStore } from "../context/AppContext";
import { useCompanyStore } from "../context/CompanyContext";
import { resolveProfilePhoto } from "../lib/resolveProfilePhoto";
import {
  ChevronRight,
  ShieldCheck,
  Building2,
  ChevronDown,
  Check,
  Truck,
  Briefcase,
  ClipboardClock,
  ArrowLeft,
} from "lucide-react";
import { StableImage } from "../components/common/StableImage";
import { preloadRoute } from "../lib/routePreload";
import { markProfilePerf } from "../lib/profilePerformanceTelemetry";
import { useCurrentUserPendingApplications } from "../hooks/useCurrentUserPendingApplications";
import { PendingApplicationsCarousel } from "../components/recruitment/PendingApplicationsCarousel";
import { sessionDiagnosticMessage } from "../services/sessionDiagnostic";
import { resolveProfileSessionGate } from "../services/profileSessionGate";
import type { ProfileIndexProfile } from "../services/profileIndex";

const ProfileSelectionTransition = ({
  label = "Preparando seus perfis",
}: {
  label?: string;
}) => (
  <div
    className="min-h-screen bg-slate-50 dark:bg-[#09090b] flex items-center justify-center"
    role="status"
    aria-live="polite"
  >
    <div className="flex flex-col items-center gap-2 opacity-70">
      <span className="text-lg font-bold tracking-[0.22em] text-slate-800 dark:text-white">
        NVU
      </span>
      <span className="h-0.5 w-10 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
        <span className="block h-full w-1/2 rounded-full bg-blue-500 motion-safe:animate-[nvu-progress_900ms_ease-in-out_infinite]" />
      </span>
    </div>
    <span className="sr-only">{label}</span>
  </div>
);

const SessionDiagnosticCard = ({
  diagnostic,
  onRetry,
}: {
  diagnostic: NonNullable<ReturnType<typeof useSessionStore>["sessionDiagnostic"]>;
  onRetry: () => void;
}) => (
  <div className="min-h-screen bg-slate-50 dark:bg-[#09090b] flex items-center justify-center p-4 font-sans">
    <div className="w-full max-w-md rounded-3xl bg-white dark:bg-[#18181b] border border-amber-200 dark:border-amber-500/20 shadow-xl dark:shadow-none p-7">
      <div className="mx-auto mb-4 w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-300 flex items-center justify-center">
        <Building2 size={28} />
      </div>
      <h2 className="text-xl font-bold text-slate-900 dark:text-white text-center">
        Não foi possível confirmar seus vínculos
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-[#a1a1aa] text-center">
        {sessionDiagnosticMessage(diagnostic)}
      </p>
      <div className="mt-5 rounded-xl bg-slate-50 dark:bg-[#202124] border border-slate-200 dark:border-[#303136] p-3 text-left text-[11px] leading-relaxed text-slate-500 dark:text-[#a1a1aa]">
        <div><strong>Código:</strong> {diagnostic.code}</div>
        <div><strong>UID:</strong> {diagnostic.uidSuffix || "não autenticada"}</div>
        <div><strong>Geração:</strong> {diagnostic.generation}</div>
        <div><strong>Horário:</strong> {diagnostic.at}</div>
        {diagnostic.detail && <div><strong>Detalhe:</strong> {diagnostic.detail}</div>}
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="mt-6 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
      >
        Tentar novamente
      </button>
    </div>
  </div>
);

interface PendingApplicationsAccessProps {
  applications: Parameters<typeof PendingApplicationsCarousel>[0]["applications"];
  currentUser: Parameters<typeof PendingApplicationsCarousel>[0]["currentUser"];
  companies: Parameters<typeof PendingApplicationsCarousel>[0]["companies"];
}

/**
 * The pending page uses a native <dialog>. While closed the browser keeps it
 * out of layout/paint, avoiding the permanent full-screen transparent
 * compositing layer that previously existed above SelectProfile. showModal()
 * is synchronous and does not trigger navigation, Firestore or parent renders.
 */
const PendingApplicationsAccess = React.memo(function PendingApplicationsAccess({
  applications,
  currentUser,
  companies,
}: PendingApplicationsAccessProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  if (applications.length === 0) return null;

  const openPanel = (event?: React.SyntheticEvent) => {
    event?.preventDefault();
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
  };

  const closePanel = (event?: React.SyntheticEvent) => {
    event?.preventDefault();
    const dialog = dialogRef.current;
    if (!dialog?.open) return;
    dialog.close();
  };

  const handleOpenKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    openPanel(event);
  };

  return (
    <>
      <button
        type="button"
        onPointerDown={openPanel}
        onKeyDown={handleOpenKeyDown}
        className="absolute -top-3 right-0 z-20 w-11 h-11 inline-flex items-center justify-center text-amber-600 dark:text-amber-300 hover:text-amber-700 dark:hover:text-amber-200 bg-white dark:bg-[#18181b] border border-amber-200 dark:border-amber-500/30 rounded-full shadow-sm touch-manipulation select-none"
        title="Inscrições e cadastros pendentes"
        aria-label={`Abrir ${applications.length} solicitação${applications.length > 1 ? "ões" : ""} pendente${applications.length > 1 ? "s" : ""}`}
      >
        <ClipboardClock size={16} />
        <span className="absolute -top-1 -right-1 min-w-[17px] h-[17px] px-1 rounded-full bg-amber-500 text-white text-[9px] font-bold flex items-center justify-center border-2 border-slate-50 dark:border-[#09090b]">
          {applications.length > 9 ? "9+" : applications.length}
        </span>
      </button>

      <dialog
        ref={dialogRef}
        data-nvu-pending-dialog
        aria-label="Inscrições e cadastros pendentes"
        className="fixed inset-0 m-0 h-[100dvh] max-h-none w-screen max-w-none border-0 p-0 overflow-y-auto overscroll-contain bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white"
      >
        <div className="min-h-full flex items-center justify-center p-4 sm:p-6 font-sans">
          <div className="w-full max-w-md">
            <div className="relative text-center mb-6">
              <button
                type="button"
                onPointerDown={closePanel}
                className="absolute left-0 -top-2 w-11 h-11 inline-flex items-center justify-center text-slate-500 hover:text-slate-800 dark:text-[#a1a1aa] dark:hover:text-white bg-white dark:bg-[#18181b] border border-slate-200 dark:border-[#2A2F3A] rounded-full shadow-sm touch-manipulation"
                aria-label="Voltar para seleção de perfil"
              >
                <ArrowLeft size={17} />
              </button>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                Pendências
              </h1>
              <p className="text-sm text-slate-500 dark:text-[#a1a1aa] mt-1">
                Inscrições e cadastros aguardando avaliação
              </p>
            </div>

            <div className="bg-white dark:bg-[#18181b] rounded-3xl border border-slate-100 dark:border-[#2A2F3A] shadow-xl dark:shadow-none p-5 sm:p-6">
              <div className="w-12 h-12 bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-300 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-amber-100 dark:border-amber-500/20">
                <ClipboardClock size={24} />
              </div>
              <PendingApplicationsCarousel
                applications={applications}
                currentUser={currentUser}
                companies={companies}
                deferImages
              />
              <p className="mt-5 text-center text-[11px] sm:text-xs text-slate-400 dark:text-[#a1a1aa] leading-relaxed px-1">
                Você será notificado(a) quando houver uma resposta, se as notificações estiverem ativas.
              </p>
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
});

export default function SelectProfile() {
  const {
    currentUser,
    switchRole,
    membershipsLoaded,
    identityReconciliationStatus,
    sessionDiagnostic,
    sessionRecovering,
    activeRole,
    profileIndex,
    logOutApp,
    refreshSession,
    setSeniorCompanyId,
    setIsSeniorAuthenticated,
  } = useSessionStore();
  const {
    companies,
    allCompanies,
    activeCompanyId,
    memberships,
    companiesLoading,
  } = useCompanyStore();
  const navigate = useNavigate();
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(
    null,
  );
  const [isSelectorOpen, setIsSelectorOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [profileActionError, setProfileActionError] = useState("");
  const switchingRoleRef = useRef(false);

  useEffect(() => {
    if (profileIndex.status === "ready") setProfileActionError("");
  }, [profileIndex.status]);

  const availableCompanies = useMemo(() => {
    const grouped = new Map<
      string,
      { companyId: string; companyName: string; roles: string[] }
    >();
    profileIndex.profiles.forEach((profile) => {
      const existing = grouped.get(profile.companyId);
      if (existing) {
        if (!existing.roles.includes(profile.role)) existing.roles.push(profile.role);
        return;
      }
      grouped.set(profile.companyId, {
        companyId: profile.companyId,
        companyName: profile.displayName,
        roles: [profile.role],
      });
    });
    return Array.from(grouped.values());
  }, [profileIndex.profiles]);

  const {
    applications: pendingApplications,
    loading: pendingApplicationsLoading,
    queryError: pendingApplicationsQueryError,
  } = useCurrentUserPendingApplications(currentUser?.id, currentUser?.email);

  const pendingApplicationCompanies = useMemo(() => {
    const merged = new Map<string, (typeof allCompanies)[number]>();
    [...allCompanies, ...companies].forEach((company) => merged.set(company.id, company));
    return Array.from(merged.values());
  }, [allCompanies, companies]);

  // The access icon becomes interactive only after the small identity/company
  // snapshots that feed its already-mounted content have settled. This avoids
  // presenting a tappable control while an initial Firestore callback is still
  // scheduled to invalidate the same screen. Once visible, opening the panel is
  // a synchronous DOM-only operation.
  const pendingAccessReady =
    !pendingApplicationsLoading && !companiesLoading;

  // Handle default company selection only after every active membership has a
  // corresponding company document. This prevents a stale activeCompanyId from
  // becoming the visible "Empresa vinculada (carregando...)" profile.
  useEffect(() => {
    const selectedCompanyIsAvailable = availableCompanies.some(
      (company) => company.companyId === String(selectedCompanyId || "").trim(),
    );
    if (
      availableCompanies.length === 0 ||
      selectedCompanyIsAvailable
    ) {
      return;
    }
    const normalizedActiveCompanyId = String(activeCompanyId || "").trim();
    const normalizedUserCompanyId = String(currentUser?.companyId || "").trim();
    const lastUsed =
      availableCompanies.find((c) => c.companyId === normalizedActiveCompanyId) ||
      availableCompanies.find((c) => c.companyId === normalizedUserCompanyId);
    setSelectedCompanyId(
      lastUsed ? lastUsed.companyId : availableCompanies[0].companyId,
    );
  }, [
    activeCompanyId,
    availableCompanies,
    currentUser?.companyId,
    selectedCompanyId,
  ]);

  const activeCompany = availableCompanies.find(
    (c) => c.companyId === String(selectedCompanyId || "").trim(),
  );
  const activeCompanyIsCurrent =
    Boolean(activeCompany) &&
    String(activeCompanyId || "").trim() === activeCompany?.companyId;
  const profilesToSelect = activeCompany ? activeCompany.roles || [] : [];
  const profileGateState = resolveProfileSessionGate({
    // The selector is a visual session surface. A cached user/membership may
    // paint it immediately; protected navigation below still requires the
    // strict sessionReady flag backed by Firebase.
    authReady: Boolean(currentUser),
    identityReconciliationStatus,
    membershipsLoaded,
    membershipsCount: memberships.length,
    availableCompaniesCount: availableCompanies.length,
    sessionRecovering,
    diagnosticCode: sessionDiagnostic?.code,
    hasSessionDiagnostic: Boolean(sessionDiagnostic),
  });

  const commitProfileNavigation = useCallback(
    (profile: ProfileIndexProfile) => {
      if (
        switchingRoleRef.current ||
        !currentUser?.id ||
        profileIndex.status !== "ready" ||
        !profile.valid
      ) {
        return;
      }
      switchingRoleRef.current = true;
      setProfileActionError("");

      // ProfileIndex is already canonical here. switchRole performs the final
      // membership guard, while its persistence stays in the background.
      markProfilePerf("T1_SWITCH_ROLE_START", {
        route: profile.destination,
        role: profile.role,
      });
      void switchRole(profile.role, profile.companyId);
      markProfilePerf("T2_SWITCH_ROLE_RETURN", {
        route: profile.destination,
        role: profile.role,
      });
      markProfilePerf("T3_NAVIGATE_START", {
        route: profile.destination,
        role: profile.role,
      });
      navigate(profile.destination, { replace: true });
      markProfilePerf("T3_NAVIGATE_RETURN", {
        route: profile.destination,
        role: profile.role,
      });
      try {
        sessionStorage.removeItem("seniorAccess");
        sessionStorage.removeItem("seniorCompanyId");
      } catch {
        // React state remains authoritative in restricted previews.
      }
      setSeniorCompanyId(null);
      setIsSeniorAuthenticated(false);
      switchingRoleRef.current = false;
      void preloadRoute(profile.destination).catch(() => undefined);
    },
    [
      currentUser?.id,
      navigate,
      profileIndex.status,
      setIsSeniorAuthenticated,
      setSeniorCompanyId,
      switchRole,
    ],
  );

  useEffect(() => {
    if (
      profileIndex.status !== "ready" ||
      profileIndex.profiles.length !== 1 ||
      !currentUser?.id
    ) {
      return;
    }
    const [onlyProfile] = profileIndex.profiles;
    if (
      activeRole === onlyProfile.role &&
      activeCompanyId === onlyProfile.companyId
    ) {
      return;
    }
    commitProfileNavigation(onlyProfile);
  }, [
    activeCompanyId,
    activeRole,
    commitProfileNavigation,
    currentUser?.id,
    profileIndex.profiles,
    profileIndex.status,
  ]);

  const handleSelect = (role: "admin" | "driver", companyId: string) => {
    if (switchingRoleRef.current || !currentUser?.id) return;
    const profile = profileIndex.profiles.find(
      (candidate) =>
        candidate.role === role && candidate.companyId === companyId,
    );
    if (!profile) {
      setProfileActionError("Este perfil não está disponível nesta sessão.");
      return;
    }
    markProfilePerf("T0_SELECT_PROFILE", { route: profile.destination, role });
    commitProfileNavigation(profile);
  };

  const handleLogout = async () => {
    try {
      await logOutApp();
      navigate("/", { replace: true });
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  const handleBackToStart = () => {
    navigate("/", { replace: true });
  };

  // A restored role/company may remain selected as a visual preference, but it
  // must never become navigation intent. Every startup therefore remains on
  // this selector until the user explicitly clicks a profile action.

  if (!currentUser) {
    return <ProfileSelectionTransition label="Identificando sua conta" />;
  }

  // The selector is reserved for canonical approved profiles. A ready empty
  // index means the account has no active membership; route it to the single
  // Pendências surface instead of exposing an empty profile chooser.
  if (profileIndex.status === "ready" && profileIndex.profiles.length === 0) {
    return <Navigate to="/pending-applications" replace />;
  }

  if (profileIndex.status === "resolving") {
    return <ProfileSelectionTransition label="Validando seus perfis" />;
  }

  if (profileIndex.status === "error") {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-[#09090b] flex items-center justify-center p-4 font-sans">
        <div className="w-full max-w-md rounded-3xl bg-white dark:bg-[#18181b] border border-amber-200 dark:border-amber-500/20 shadow-xl dark:shadow-none p-7 text-center">
          <div className="mx-auto mb-4 w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-300 flex items-center justify-center">
            <Building2 size={28} />
          </div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            Perfil operacional não resolvido
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-[#a1a1aa]">
            Nenhum perfil será aberto com empresa ou simulador não confirmado.
          </p>
          <button
            type="button"
            onClick={() => refreshSession("profile-index-retry")}
            className="mt-6 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  if (profileGateState === "diagnostic" && sessionDiagnostic) {
    return (
      <SessionDiagnosticCard
        diagnostic={sessionDiagnostic}
        onRetry={() => refreshSession()}
      />
    );
  }

  const profileHydrationPending =
    profileGateState === "identity-pending" ||
    profileGateState === "membership-pending";

  if (profileGateState === "identity-failed") {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-[#09090b] flex items-center justify-center p-4 font-sans">
        <div className="w-full max-w-md rounded-3xl bg-white dark:bg-[#18181b] border border-amber-200 dark:border-amber-500/20 shadow-xl dark:shadow-none p-7 text-center">
          <div className="mx-auto mb-4 w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-300 flex items-center justify-center">
            <Building2 size={28} />
          </div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            Não foi possível confirmar seu vínculo
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-[#a1a1aa]">
            A autenticação foi concluída, mas a leitura dos vínculos falhou. Tente novamente sem desconectar.
          </p>
          <button
            type="button"
            onClick={() => refreshSession()}
            className="mt-6 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  const trackedRecruitmentStatus = String(
    (currentUser as any).currentRecruitmentStatus || "",
  ).trim();
  const trackedRecruitmentApplicationId = String(
    (currentUser as any).currentRecruitmentApplicationId || "",
  ).trim();
  if (
    availableCompanies.length === 0 &&
    trackedRecruitmentStatus === "pending" &&
    trackedRecruitmentApplicationId &&
    pendingApplicationsLoading
  ) {
    return <ProfileSelectionTransition />;
  }

  const serverEmptyConfirmed =
    identityReconciliationStatus === "complete" &&
    membershipsLoaded &&
    !sessionRecovering &&
    !pendingApplicationsLoading &&
    !pendingApplicationsQueryError &&
    sessionDiagnostic?.code === "MEMBERSHIP_SERVER_EMPTY";

  // A membership-empty snapshot is not enough to conclude that the account has
  // no onboarding path. The user-scoped recruitment queries must settle first;
  // otherwise a newly submitted application briefly appears as "Sem vínculos".
  if (pendingApplicationsLoading) {
    return <ProfileSelectionTransition label="Consultando inscrições e cadastros" />;
  }

  if (pendingApplicationsQueryError && pendingApplications.length === 0) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-[#09090b] flex items-center justify-center p-4 font-sans">
        <div className="w-full max-w-md rounded-3xl bg-white dark:bg-[#18181b] border border-amber-200 dark:border-amber-500/20 shadow-xl dark:shadow-none p-7 text-center">
          <div className="mx-auto mb-4 w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-300 flex items-center justify-center">
            <Building2 size={28} />
          </div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            Não foi possível consultar suas pendências
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-[#a1a1aa]">
            Sua sessão está preservada. Tente novamente para confirmar inscrições e cadastros antes de concluir que não há vínculo.
          </p>
          <button
            type="button"
            onClick={() => refreshSession("pending-applications-retry")}
            className="mt-6 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  // Handle empty state only after the server has confirmed zero memberships and
  // the pending-application queries have completed successfully.
  if (profileGateState === "empty" && serverEmptyConfirmed) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-[#09090b] flex flex-col items-center justify-center p-4 font-sans">
        <div className="w-full max-w-md bg-white dark:bg-[#18181b] p-6 sm:p-8 rounded-3xl shadow-xl dark:shadow-none border border-slate-100 dark:border-[#2A2F3A] text-center">
          <div className="w-14 h-14 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <Building2 size={28} />
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white mb-2">
            Pendências
          </h2>
          <p className="text-sm text-slate-500 dark:text-[#a1a1aa] mb-6 leading-relaxed px-1">
            Suas inscrições e cadastros são acompanhados nesta tela até que um perfil aprovado seja disponibilizado.
          </p>
          {pendingApplications.length > 0 && (
            <>
              <PendingApplicationsCarousel
                applications={pendingApplications}
                currentUser={currentUser}
                companies={pendingApplicationCompanies}
                className="mb-5"
              />
              <p className="text-[11px] sm:text-xs text-slate-400 dark:text-[#a1a1aa] leading-relaxed mb-5 px-1">
                Você será notificado(a) assim que houver resposta (se as notificações estiverem ativas).
              </p>
            </>
          )}
          <div className="flex flex-col sm:grid sm:grid-cols-2 gap-3">
            {showLogoutConfirm ? (
              <div className="sm:col-span-2 flex flex-col gap-3 p-4 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20">
                <p className="text-[12px] sm:text-[13px] font-medium text-red-800 dark:text-red-200 leading-relaxed text-center">
                  Ao desconectar, você não receberá a notificação da resposta. Continuar?
                </p>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <button
                    onClick={() => setShowLogoutConfirm(false)}
                    className="w-full py-2.5 rounded-lg bg-white dark:bg-[#18181b] border border-red-200 dark:border-red-500/30 text-slate-700 dark:text-slate-300 font-semibold text-sm transition-colors hover:bg-slate-50 dark:hover:bg-[#22252d]"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleLogout}
                    className="w-full py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold text-sm transition-colors"
                  >
                    Desconectar
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button
                  onClick={() => setShowLogoutConfirm(true)}
                  className="w-full py-3 sm:py-3.5 rounded-xl bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 font-semibold text-sm sm:text-base transition-colors"
                >
                  Desconectar
                </button>
                <button
                  onClick={handleBackToStart}
                  className="w-full py-3 sm:py-3.5 rounded-xl bg-slate-100 dark:bg-[#27272a] hover:bg-slate-200 dark:hover:bg-[#3f3f46] text-slate-700 dark:text-white font-semibold text-sm sm:text-base transition-colors"
                >
                  Ir para o início
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#09090b] flex flex-col items-center justify-center p-4 sm:p-6 font-sans selection:bg-blue-100 dark:selection:bg-blue-900">
      <div className="w-full max-w-[420px] flex flex-col relative z-10">
        {/* Header Section */}
        <div className="text-center mb-8 relative">
          {pendingAccessReady && (
            <PendingApplicationsAccess
              applications={pendingApplications}
              currentUser={currentUser}
              companies={pendingApplicationCompanies}
            />
          )}
          {profileHydrationPending && (
            <p
              role="status"
              className="mb-3 text-center text-xs font-medium text-slate-500 dark:text-[#a1a1aa]"
            >
              Seus perfis preservados estão visíveis. A autorização será confirmada em segundo plano antes da abertura.
            </p>
          )}
          {profileActionError && (
            <p
              role="alert"
              className="mb-3 text-center text-xs font-medium text-amber-700 dark:text-amber-300"
            >
              {profileActionError}
            </p>
          )}
          <p className="text-slate-500 dark:text-[#a1a1aa] text-[13px] font-medium mb-1.5 opacity-80 uppercase tracking-wider">
            Bem-vindo(a) de volta
          </p>
          <h1 className="text-2xl sm:text-[26px] font-semibold text-slate-900 dark:text-white tracking-tight">
            Selecionar Perfil
          </h1>
        </div>

        {/* Company Selector Area */}
        {availableCompanies.length > 1 && (
          <div className="flex justify-center mb-6 relative z-50">
            <button
              onClick={() => setIsSelectorOpen(!isSelectorOpen)}
              className="flex items-center gap-2.5 px-4 py-2 bg-white dark:bg-[#18181b] border border-slate-200 dark:border-[#2A2F3A] rounded-full shadow-sm hover:border-slate-300 dark:hover:border-slate-600 transition-all focus:outline-none focus:ring-2 focus:ring-slate-200 dark:focus:ring-[#2A2F3A]"
            >
              <Building2
                size={16}
                className="text-slate-400 text-opacity-80 dark:text-[#71717a]"
              />
              <span className="text-[14px] font-medium text-slate-700 dark:text-[#e4e4e7] truncate max-w-[240px] sm:max-w-[280px]">
                {activeCompany?.companyName}
              </span>
              <ChevronDown
                size={14}
                className={`text-slate-400 transition-transform ${isSelectorOpen ? "rotate-180" : ""}`}
              />
            </button>

            {isSelectorOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setIsSelectorOpen(false)}
                ></div>
                <div className="absolute top-12 left-1/2 -translate-x-1/2 w-[280px] bg-white dark:bg-[#18181b] border border-slate-200 dark:border-[#2A2F3A] rounded-2xl shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="max-h-[300px] overflow-y-auto p-1.5">
                    {availableCompanies.map((comp) => (
                      <button
                        key={comp.companyId}
                        onClick={() => {
                          setSelectedCompanyId(comp.companyId);
                          setIsSelectorOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-[14px] transition-colors ${selectedCompanyId === comp.companyId ? "bg-slate-50 dark:bg-[#27272a] text-slate-900 dark:text-white font-medium" : "text-slate-600 dark:text-[#a1a1aa] hover:bg-slate-50 dark:hover:bg-[#27272a] font-normal"}`}
                      >
                        <span className="truncate">{comp.companyName}</span>
                        {selectedCompanyId === comp.companyId && (
                          <Check
                            size={16}
                            className="text-slate-600 dark:text-[#a1a1aa] shrink-0 ml-2"
                          />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Profiles Section */}
        <div className="flex flex-col gap-3">
          {profilesToSelect.includes("admin") && (
            <button
              onClick={() => handleSelect("admin", activeCompany!.companyId)}
              className="group relative flex items-center justify-between bg-white dark:bg-[#121214] border border-slate-200 dark:border-[#27272A] hover:border-slate-300 dark:hover:border-[#3F3F46] rounded-[20px] p-4 sm:p-5 hover:shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] dark:hover:shadow-none transition-all duration-200 text-left outline-none focus-visible:ring-2 focus-visible:ring-slate-300 dark:focus-visible:ring-[#3F3F46]"
            >
              <div className="flex items-center gap-4">
                <div className="w-[46px] h-[46px] rounded-[14px] bg-slate-50 dark:bg-[#18181B] border border-slate-100 dark:border-[#27272A] flex items-center justify-center text-slate-500 dark:text-[#A1A1AA] group-hover:bg-indigo-50 group-hover:text-indigo-600 dark:group-hover:bg-indigo-500/10 dark:group-hover:text-indigo-400 group-hover:border-indigo-100 dark:group-hover:border-indigo-500/20 transition-all duration-300 overflow-hidden">
                  {allCompanies.find(
                    (company) =>
                      String(company.id || "").trim() ===
                      activeCompany?.companyId,
                  )?.logoUrl ? (
                    <StableImage
                      src={
                        allCompanies.find(
                          (company) =>
                            String(company.id || "").trim() ===
                            activeCompany?.companyId,
                        )!.logoUrl
                      }
                      alt="Empresa"
                      loading="eager"
                      decoding="async"
                      wrapperClassName="w-full h-full"
                      className="object-cover"
                      fallback={<Briefcase size={22} strokeWidth={1.8} />}
                    />
                  ) : (
                    <Briefcase size={22} strokeWidth={1.8} />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <h3 className="text-[15px] sm:text-base font-semibold text-slate-900 dark:text-[#FAFAFA] tracking-tight">
                      Administrador
                    </h3>
                    {activeRole === "admin" &&
                      activeCompanyIsCurrent && (
                        <span className="flex items-center px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200/60 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-[10px] uppercase font-bold tracking-wide">
                          Atual
                        </span>
                      )}
                  </div>
                  <p className="text-[13px] text-slate-500 dark:text-[#A1A1AA]">
                    Gestão e controle operacional
                  </p>
                </div>
              </div>
              <ChevronRight
                size={18}
                className="text-slate-300 dark:text-[#52525B] group-hover:text-indigo-500 dark:group-hover:text-indigo-400 group-hover:translate-x-0.5 transition-all duration-300"
              />
            </button>
          )}

          {profilesToSelect.includes("driver") && (
            <button
              onClick={() => handleSelect("driver", activeCompany!.companyId)}
              className="group relative flex items-center justify-between bg-white dark:bg-[#121214] border border-slate-200 dark:border-[#27272A] hover:border-slate-300 dark:hover:border-[#3F3F46] rounded-[20px] p-4 sm:p-5 hover:shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] dark:hover:shadow-none transition-all duration-200 text-left outline-none focus-visible:ring-2 focus-visible:ring-slate-300 dark:focus-visible:ring-[#3F3F46]"
            >
              <div className="flex items-center gap-4">
                <div className="w-[46px] h-[46px] rounded-[14px] bg-slate-50 dark:bg-[#18181B] border border-slate-100 dark:border-[#27272A] flex items-center justify-center text-slate-500 dark:text-[#A1A1AA] group-hover:bg-blue-50 group-hover:text-blue-600 dark:group-hover:bg-blue-500/10 dark:group-hover:text-blue-400 group-hover:border-blue-100 dark:group-hover:border-blue-500/20 transition-all duration-300 overflow-hidden">
                  {resolveProfilePhoto(currentUser) || null ? (
                    <StableImage
                      src={resolveProfilePhoto(currentUser) || null}
                      alt="Motorista"
                      loading="eager"
                      decoding="async"
                      wrapperClassName="w-full h-full"
                      className="object-cover"
                      referrerPolicy="no-referrer"
                      fallback={<Truck size={22} strokeWidth={1.8} />}
                    />
                  ) : (
                    <Truck size={22} strokeWidth={1.8} />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <h3 className="text-[15px] sm:text-base font-semibold text-slate-900 dark:text-[#FAFAFA] tracking-tight">
                      Motorista
                    </h3>
                    {activeRole === "driver" &&
                      activeCompanyIsCurrent && (
                        <span className="flex items-center px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200/60 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-[10px] uppercase font-bold tracking-wide">
                          Atual
                        </span>
                      )}
                  </div>
                  <p className="text-[13px] text-slate-500 dark:text-[#A1A1AA]">
                    Rotas, entregas e checklist
                  </p>
                </div>
              </div>
              <ChevronRight
                size={18}
                className="text-slate-300 dark:text-[#52525B] group-hover:text-blue-500 dark:group-hover:text-blue-400 group-hover:translate-x-0.5 transition-all duration-300"
              />
            </button>
          )}
        </div>

        {/* Security / Footer Area */}
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-6 text-slate-400 dark:text-[#71717A] opacity-90">
          <div className="flex items-center gap-1.5">
            <ShieldCheck
              size={14}
              strokeWidth={2}
              className="text-emerald-500/70"
            />
            <span className="text-[12px] font-medium tracking-wide border-b border-transparent">
              Sessão segura
            </span>
          </div>
          <span className="hidden sm:inline text-slate-300 dark:text-[#3F3F46]">
            •
          </span>
          <button
            onClick={handleLogout}
            className="text-[12px] font-medium tracking-wide border-b border-transparent hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
          >
            Sair desta conta
          </button>
        </div>
      </div>
    </div>
  );
}
