import React, { useEffect, useMemo } from "react";
import { ArrowLeft, ClipboardClock } from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";
import { useSessionStore } from "../context/AppContext";
import { useCompanyStore } from "../context/CompanyContext";
import { useCurrentUserPendingApplications } from "../hooks/useCurrentUserPendingApplications";
import { PendingApplicationsCarousel } from "../components/recruitment/PendingApplicationsCarousel";

export default function PendingApplications() {
  const navigate = useNavigate();
  const {
    currentUser,
    authInitialized,
    sessionUiReady,
    profileIndex,
    logOutApp,
    refreshSession,
  } = useSessionStore();
  const { companies, allCompanies } = useCompanyStore();
  const {
    applications: pendingApplications,
    loading: pendingApplicationsLoading,
    queryError: pendingApplicationsQueryError,
  } = useCurrentUserPendingApplications(currentUser?.id, currentUser?.email);

  useEffect(() => {
    if (authInitialized && !currentUser) {
      navigate("/", { replace: true });
    }
  }, [authInitialized, currentUser, navigate]);

  const handleLogout = async () => {
    await logOutApp();
    navigate("/", { replace: true });
  };

  const handleBackToStart = () => {
    navigate("/", { replace: true });
  };

  if (
    profileIndex.status === "ready" &&
    profileIndex.profiles.length > 0
  ) {
    return (
      <Navigate
        to="/select-profile"
        replace
        state={{ nvuExplicitProfileSelection: true }}
      />
    );
  }

  const pendingApplicationCompanies = useMemo(() => {
    const merged = new Map<string, (typeof allCompanies)[number]>();
    [...allCompanies, ...companies].forEach((company) => merged.set(company.id, company));
    return Array.from(merged.values());
  }, [allCompanies, companies]);

  // Render the destination shell as soon as the Firebase identity is coherent.
  // Membership hydration is not a prerequisite for this user-scoped surface;
  // only the pending-applications listener controls its local data state.
  if (!sessionUiReady || !currentUser) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#09090b]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-800 dark:border-slate-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#09090b] flex items-center justify-center p-4 sm:p-6 font-sans">
      <div className="w-full max-w-md">
        <div className="relative text-center mb-6">
          <button
            type="button"
            onClick={handleBackToStart}
            className="absolute left-0 top-0 p-2 text-slate-500 hover:text-slate-800 dark:text-[#a1a1aa] dark:hover:text-white bg-white dark:bg-[#18181b] border border-slate-200 dark:border-[#2A2F3A] rounded-full shadow-sm transition-colors"
            aria-label="Voltar para o início"
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
          {pendingApplications.length > 0 ? (
            <>
              <div className="w-12 h-12 bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-300 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-amber-100 dark:border-amber-500/20">
                <ClipboardClock size={24} />
              </div>
              <PendingApplicationsCarousel
                applications={pendingApplications}
                currentUser={currentUser}
                companies={pendingApplicationCompanies}
              />
              <p className="mt-5 text-center text-[11px] sm:text-xs text-slate-400 dark:text-[#a1a1aa] leading-relaxed px-1">
                Você será notificado(a) quando houver uma resposta, se as notificações estiverem ativas.
              </p>
            </>
          ) : pendingApplicationsLoading ? (
            <div className="text-center py-4" aria-live="polite">
              <div className="w-12 h-12 bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-300 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-amber-100 dark:border-amber-500/20">
                <ClipboardClock size={24} />
              </div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
                Atualizando pendências
              </h2>
              <p className="text-sm text-slate-500 dark:text-[#a1a1aa]">
                A tela já está disponível enquanto os dados são sincronizados.
              </p>
            </div>
          ) : pendingApplicationsQueryError ? (
            <div className="text-center py-4" role="alert">
              <div className="w-12 h-12 bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-300 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-amber-100 dark:border-amber-500/20">
                <ClipboardClock size={24} />
              </div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
                Pendências
              </h2>
              <p className="text-sm text-slate-500 dark:text-[#a1a1aa] mb-5">
                Não foi possível atualizar suas inscrições agora. Sua conta continua protegida nesta tela.
              </p>
              <button
                type="button"
                onClick={() => refreshSession("pending-applications-retry")}
                className="w-full py-2.5 rounded-xl bg-slate-100 dark:bg-[#27272a] hover:bg-slate-200 dark:hover:bg-[#3f3f46] text-slate-700 dark:text-white font-semibold text-sm transition-colors"
              >
                Tentar novamente
              </button>
            </div>
          ) : (
            <div className="text-center py-4">
              <div className="w-12 h-12 bg-slate-100 dark:bg-[#27272a] text-slate-500 dark:text-[#a1a1aa] rounded-2xl flex items-center justify-center mx-auto mb-4">
                <ClipboardClock size={24} />
              </div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
                Pendências
              </h2>
              <p className="text-sm text-slate-500 dark:text-[#a1a1aa]">
                Nenhuma inscrição ou cadastro pendente foi encontrado nesta conta.
              </p>
            </div>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="w-full py-2.5 rounded-xl bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 font-semibold text-xs transition-colors"
            >
              Desconectar
            </button>
            <button
              type="button"
              onClick={handleBackToStart}
              className="w-full py-2.5 rounded-xl bg-slate-100 dark:bg-[#27272a] hover:bg-slate-200 dark:hover:bg-[#3f3f46] text-slate-700 dark:text-white font-semibold text-xs transition-colors"
            >
              Início
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
