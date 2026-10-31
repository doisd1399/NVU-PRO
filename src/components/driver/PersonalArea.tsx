import React, { Suspense, lazy, useCallback, useState } from "react";
import { ArrowLeft, Building2, ClipboardClock, ClipboardList, Mail, Phone, UserRound } from "lucide-react";
import { StableImage } from "../common/StableImage";
// The Resultados card and its figures are styled by these two sheets; they are normally loaded by the company profile.
import "./DriverWorkspace.css";
import "./DriverProfileSummary.css";
import { ProfileResultsCard } from "./ProfileResultsCard";
import { PendingApplicationsCarousel } from "../recruitment/PendingApplicationsCarousel";
import { useDriverTrips } from "../../hooks/useDriverTrips";
import { filterAndSortTripHistory } from "../../lib/tripHistoryEngine";
import { getCanonicalTripCompanyId } from "../../lib/tripIdentity";
import { applySimulatorCurrencyContext } from "../../lib/metricsEngine";
import { useOperationalStore } from "../../context/AppContext";

const JoinCompany = lazy(() => import("../../pages/driver/JoinCompany"));

type Props = {
  currentUser: any;
  applications: any[];
  applicationsLoading: boolean;
  applicationsFailed: boolean;
  companies: any[];
  onRetry: () => void;
  onLogout: () => void;
  onHome: () => void;
};

/**
 * What a driver who is not linked to any company still has: the personal profile, the history and results of past work,
 * the company catalog and the applications. It reads only data owned by the driver (own profile, own trips, own
 * applications) and never asks for a company scope. Shown only to accounts the server enabled (`driverProfileEnabled`).
 */
export function PersonalArea({ currentUser, applications, applicationsLoading, applicationsFailed, companies, onRetry, onLogout, onHome }: Props) {
  const [view, setView] = useState<"home" | "companies" | "applications">("home");
  const trips = useDriverTrips(currentUser.id);
  const { simulators } = useOperationalStore();
  // Past work is shown with the currency of the simulator it was done in, whichever company it belonged to.
  const getTrips = useCallback(() => filterAndSortTripHistory(trips.trips, { periodPreset: "todos" })
    .map(trip => applySimulatorCurrencyContext(trip, companies, simulators)), [trips.trips, companies, simulators]);
  const tripCompanies = new Set(trips.trips.map(trip => getCanonicalTripCompanyId(trip)).filter(Boolean)).size;

  if (view !== "home") return <div className="min-h-screen bg-slate-50 dark:bg-nvu-page font-sans" data-testid="personal-companies">
    <Suspense fallback={<div className="p-8 text-center text-sm text-slate-500" role="status">Carregando…</div>}>
      <JoinCompany mode="browse" onBack={() => setView("home")} initialFocus={view === "applications" ? "applications" : undefined} />
    </Suspense>
  </div>;

  const photo = currentUser.profilePhotoURL || currentUser.authPhotoURL;
  const button = "inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-nvu-line px-3.5 py-2.5 text-[13px] font-semibold text-slate-700 dark:text-nvu-text-soft hover:bg-slate-50 dark:hover:bg-nvu-strip";
  return <div className="min-h-screen bg-slate-50 dark:bg-nvu-page flex justify-center p-4 sm:p-6 font-sans" data-testid="personal-area">
    <div className="w-full max-w-md space-y-4">
      <div className="relative text-center">
        <button type="button" onClick={onHome} aria-label="Voltar para o início"
          className="absolute left-0 top-0 p-2 text-slate-500 hover:text-slate-800 dark:text-nvu-muted dark:hover:text-white bg-white dark:bg-nvu-surface border border-slate-200 dark:border-nvu-line rounded-full shadow-sm">
          <ArrowLeft size={17} />
        </button>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Meu perfil</h1>
        <p className="text-sm text-slate-500 dark:text-nvu-muted mt-1">Sem empresa vinculada</p>
      </div>

      <section className="bg-white dark:bg-nvu-surface rounded-3xl border border-slate-100 dark:border-nvu-line shadow-xl dark:shadow-none p-5 space-y-4" aria-label="Dados pessoais">
        <div className="flex items-center gap-3">
          <StableImage src={photo} persistentViewerId={currentUser.id} persistentAssetId={`personal-avatar:${currentUser.id}`} alt="" wrapperClassName="w-14 h-14 rounded-2xl overflow-hidden shrink-0 bg-slate-100 dark:bg-nvu-strip" className="object-cover"
            fallback={<span className="w-full h-full flex items-center justify-center text-slate-400"><UserRound size={26} /></span>} />
          <div className="min-w-0">
            <p className="text-[16px] font-bold text-slate-900 dark:text-white truncate">{currentUser.name || "Motorista"}</p>
            <p className="text-[12px] text-slate-500 dark:text-nvu-muted">Seu histórico continua com você</p>
          </div>
        </div>
        <dl className="grid gap-3 text-[13px]">
          <div className="flex items-center gap-2 min-w-0"><Mail size={15} className="text-blue-600 shrink-0" aria-hidden="true" /><dt className="sr-only">Email</dt><dd className="truncate font-semibold text-slate-800 dark:text-white">{currentUser.email || "Não informado"}</dd></div>
          <div className="flex items-center gap-2 min-w-0"><Phone size={15} className="text-green-600 shrink-0" aria-hidden="true" /><dt className="sr-only">WhatsApp</dt><dd className="truncate font-semibold text-slate-800 dark:text-white">{currentUser.whatsapp || "Não informado"}</dd></div>
        </dl>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={button} onClick={() => setView("companies")}><Building2 size={15} aria-hidden="true" /> Encontrar empresas</button>
          <button type="button" className={button} onClick={() => setView("applications")}><ClipboardList size={15} aria-hidden="true" /> Minhas inscrições</button>
        </div>
      </section>

      {(applications.length > 0 || applicationsLoading || applicationsFailed) && <section className="bg-white dark:bg-nvu-surface rounded-3xl border border-slate-100 dark:border-nvu-line shadow-xl dark:shadow-none p-5" aria-label="Pendências">
        {applications.length > 0 ? <>
          <div className="w-10 h-10 bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-300 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-amber-100 dark:border-amber-500/20"><ClipboardClock size={20} /></div>
          <PendingApplicationsCarousel applications={applications} currentUser={currentUser} companies={companies} />
          <p className="mt-4 text-center text-[11px] text-slate-400 dark:text-nvu-muted">Você será notificado(a) quando houver uma resposta, se as notificações estiverem ativas.</p>
        </> : applicationsFailed ? <div className="text-center" role="alert">
          <p className="text-sm text-slate-500 dark:text-nvu-muted mb-3">Não foi possível atualizar suas inscrições agora.</p>
          <button type="button" onClick={onRetry} className="w-full py-2.5 rounded-xl bg-slate-100 dark:bg-nvu-strip text-slate-700 dark:text-white font-semibold text-sm">Tentar novamente</button>
        </div> : <p className="text-center text-sm text-slate-500 dark:text-nvu-muted" aria-live="polite">Atualizando pendências…</p>}
      </section>}

      <div data-testid="personal-results" className="bg-white dark:bg-nvu-surface rounded-3xl border border-slate-100 dark:border-nvu-line shadow-xl dark:shadow-none p-3">
        <ProfileResultsCard getTrips={getTrips} loading={trips.loading} />
        {!trips.loading && !trips.error && trips.trips.length > 0 && <p className="mt-2 text-center text-[11px] text-slate-400 dark:text-nvu-muted">
          {trips.trips.length} {trips.trips.length === 1 ? "viagem registrada" : "viagens registradas"}{tripCompanies > 1 ? ` em ${tripCompanies} empresas` : ""}.
        </p>}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onLogout} className="w-full py-2.5 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 font-semibold text-xs">Desconectar</button>
        <button type="button" onClick={onHome} className="w-full py-2.5 rounded-xl bg-slate-100 dark:bg-nvu-strip text-slate-700 dark:text-white font-semibold text-xs">Início</button>
      </div>
    </div>
  </div>;
}
