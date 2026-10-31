import { ModalSelect } from "../../components/ui/ModalSelect";
import React, { useEffect, useRef, useState, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useOperationalStore, useSessionStore } from "../../context/AppContext";
import { useCompanyStore } from "../../context/CompanyContext";
import { Button } from "../../components/ui/Button";
import { resolveSimulatorId } from "../../lib/resolveSimulator";
import { resolveSimulatorDisplayLabel } from "../../lib/simulatorOptions";
import { StableImage } from "../../components/common/StableImage";
import { MyCompanyApplications, type MyApplicationRow } from "../../components/driver/MyCompanyApplications";
import { useCurrentUserPendingApplications } from "../../hooks/useCurrentUserPendingApplications";
import { loadMembershipCapabilities, withdrawApplication } from "../../services/applicationWithdrawService";
import { withdrawFailureMessage } from "../../services/applicationWithdrawCore";
import { companyApplyState, isCompanyListable, toApplicationDate } from "../../lib/companyCatalog";
import {
  UserCog,
  Building2,
  Search,
  ArrowLeft,
  RefreshCw,
} from "lucide-react";

/**
 * "join": the first-access screen of a driver without a company (unchanged behaviour).
 * "browse": "Empresas", open to a driver who already has a company; it lists the public catalog, shows which companies the
 * driver already belongs to or applied to, and "Minhas inscrições". It never changes the current link.
 */
export default function JoinCompany({ mode = "join", onBack, initialFocus }: { mode?: "join" | "browse"; onBack?: () => void; initialFocus?: "applications" }) {
  const browse = mode === "browse";
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser } = useSessionStore();
  const { simulators } = useOperationalStore();
  const {
    allCompanies,
    companiesLoading,
    companyCatalogLoaded,
    companyCatalogAttempted,
    loadCompanyCatalog,
    memberships,
    requestJoinCompany,
    cancelRequestJoinCompany,
    driverRequests,
  } = useCompanyStore();

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSimulatorId, setSelectedSimulatorId] = useState("");
  const [isRequestingId, setIsRequestingId] = useState<string | null>(null);

  // The catalog is loaded by the screen that needs it (idempotent: a loaded or in-flight catalog is reused).
  useEffect(() => { void loadCompanyCatalog().catch(() => undefined); }, []);
  const retryCatalog = () => { void loadCompanyCatalog(true).catch(() => undefined); };
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;

  const { applications: pendingApplications, loading: applicationsLoading, queryError: applicationsFailed } =
    useCurrentUserPendingApplications(browse ? currentUser?.id : undefined, browse ? currentUser?.email : undefined);
  // Withdrawing a full application is a server command: offered only once the published server lists it.
  const [canWithdraw, setCanWithdraw] = useState(false);
  useEffect(() => {
    if (!browse) return;
    let current = true;
    loadMembershipCapabilities().then(list => { if (current) setCanWithdraw(list.includes("withdraw-application")); }, () => undefined);
    return () => { current = false; };
  }, [browse, currentUser?.id]);
  // One command id per application: a retry after a lost answer replays the same command.
  const withdrawIds = useRef(new Map<string, string>());
  const withdrawRow = async (row: MyApplicationRow) => {
    const key = `${row.companyId}:${row.id}`;
    if (!withdrawIds.current.has(key)) withdrawIds.current.set(key, `withdraw-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`);
    try { await withdrawApplication(row.companyId, row.id, withdrawIds.current.get(key)!); }
    catch (error) { throw new Error(withdrawFailureMessage(error)); }
  };
  const applicationsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (browse && ((location.state as { focus?: string } | null)?.focus === "applications" || initialFocus === "applications")) applicationsRef.current?.scrollIntoView({ block: "start" });
  }, [browse, location.state, initialFocus]);

  const activeSimulators = simulators.filter((s:any) => s.active !== false).sort((a:any, b:any) => a.name.localeCompare(b.name));
  const getSimulatorLabel = (company: any) =>
    resolveSimulatorDisplayLabel(
      company,
      simulators as any[],
      allCompanies as any[],
    ) || company?.simulatorName || "Global Truck";

  // Check if there is an active request
  const myPendingRequest = driverRequests.find(
    (r) => r.motoristaId === currentUser?.id && r.status === "pending",
  );

  if (!browse && myPendingRequest) {
    const company = allCompanies.find((c) => c.id === myPendingRequest.empresaId);
    return (
      <div className="w-full max-w-7xl mx-auto py-4 sm:py-10 px-4 sm:px-6">
        <div className="max-w-md mx-auto w-full mb-8">
          <button
            onClick={() => navigate("/select-profile")}
            className="flex items-center gap-2 text-sm font-semibold text-gray-500 dark:text-nvu-muted hover:text-gray-900 dark:hover:text-nvu-text transition-colors"
          >
            <ArrowLeft size={16} />
            Voltar
          </button>
        </div>
        <div className="flex flex-col items-center justify-center h-[50vh] text-center max-w-md mx-auto">
          <div className="w-24 h-24 bg-orange-50 dark:bg-orange-500/10 rounded-full flex items-center justify-center mb-6 text-orange-500">
            <UserCog size={40} />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-nvu-text mb-2">
            Aguardando Aprovação
          </h2>
          <p className="text-gray-500 dark:text-nvu-muted mb-8">
            Seu convite para a empresa{" "}
            <strong className="text-gray-900 dark:text-nvu-text">
              {company?.companyName || "Carregando..."}
            </strong>{" "}
            foi enviado. O administrador da frota precisa aprovar seu acesso.
          </p>
          <Button
            variant="outline"
            onClick={() => void cancelRequestJoinCompany(myPendingRequest.id).catch(() => {})}
            className="text-gray-500 dark:text-nvu-muted hover:text-gray-900 dark:hover:text-nvu-text"
          >
            Cancelar Convite
          </Button>
        </div>
      </div>
    );
  }

  // Not linked to any company yet
  const memberCompanyIds = useMemo(() => new Set((memberships || [])
    .filter((member) => member.userId === currentUser?.id && member.status === "active").map((member) => member.companyId)), [memberships, currentUser?.id]);
  const myRequests = driverRequests.filter((r) => r.motoristaId === currentUser?.id && r.status === "pending");
  const applicationRows = useMemo<MyApplicationRow[]>(() => {
    const byId = new Map(allCompanies.map((company: any) => [company.id, company]));
    const rows: MyApplicationRow[] = [
      ...pendingApplications.filter((app: any) => String(app.type || app.registrationType || "driver_application") !== "company_registration").map((app: any) => {
        const company: any = byId.get(String(app.companyId || ""));
        return { id: app.id, kind: "recruitment" as const, companyId: String(app.companyId || ""), companyName: String(app.companyName || company?.companyName || ""),
          companyLogo: app.companyLogoURL || company?.logoUrl, simulatorName: app.simulatorName || company?.simulatorName, createdAt: app.createdAt };
      }),
      ...myRequests.map((request) => {
        const company: any = byId.get(request.empresaId);
        return { id: request.id, kind: "request" as const, companyId: request.empresaId, companyName: String(company?.companyName || ""),
          companyLogo: company?.logoUrl, simulatorName: company?.simulatorName, createdAt: request.createdAt };
      }),
    ];
    return rows.sort((a, b) => (toApplicationDate(b.createdAt)?.getTime() || 0) - (toApplicationDate(a.createdAt)?.getTime() || 0));
  }, [pendingApplications, myRequests, allCompanies]);
  const appliedCompanyIds = useMemo(() => new Set(applicationRows.map((row) => row.companyId).filter(Boolean)), [applicationRows]);

  const handleRequest = async (companyId: string) => {
    setIsRequestingId(companyId);
    try {
      // Never hold the action behind an artificial delay.
      await requestJoinCompany(companyId);
    } catch {
      // The context reports the failure; keep the selected company available.
    } finally {
      setIsRequestingId(null);
    }
  };

  // Only companies that can receive candidates are offered; the order is alphabetical. The number of members is not shown:
  // the member list the app holds is limited to the driver's own scope and would not be the company's real size.
  const filteredCompanies = allCompanies
    .filter((c) => {
      if (!selectedSimulatorId || !isCompanyListable(c)) return false;
      const matchesSimulator = resolveSimulatorId(c as any, simulators as any[], allCompanies as any[]) === selectedSimulatorId;
      const matchesSearch = String(c.companyName || "").toLowerCase().includes(searchTerm.toLowerCase());
      return matchesSimulator && matchesSearch;
    })
    .slice()
    .sort((a, b) => String(a.companyName || "").localeCompare(String(b.companyName || "")));

  const isSearching = searchTerm.length > 0;

  return (
    <div className="w-full max-w-7xl mx-auto py-4 sm:py-10 px-4 sm:px-6">
      <div className="max-w-2xl mx-auto w-full mb-6 sm:mb-10">
        <button
          onClick={() => (onBack ? onBack() : browse ? (window.history.length > 1 ? navigate(-1) : navigate("/driver/profile")) : navigate("/select-profile"))}
          className="flex items-center gap-2 text-sm font-semibold text-gray-500 dark:text-nvu-muted hover:text-gray-900 dark:hover:text-nvu-text transition-colors"
        >
          <ArrowLeft size={16} />
          Voltar
        </button>
      </div>

      {/* HERO */}
      {!isSearching && (
        <div className="text-center mb-10 transition-all duration-300">
          <div className="w-16 h-16 bg-blue-50 dark:bg-blue-500/10 dark:border-blue-500/40 rounded-2xl flex items-center justify-center mx-auto mb-5 text-blue-600 shadow-sm dark:shadow-none border border-blue-100 dark:border-blue-500/20/50">
            <Building2 size={28} strokeWidth={2} />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 dark:text-nvu-text tracking-tight">
            {browse ? "Empresas" : "Encontre sua Frota"}
          </h1>
          <p className="nvu-page-description text-gray-500 dark:text-nvu-muted mt-2 max-w-[280px] sm:max-w-md mx-auto">
            {browse ? "Conheça as empresas de cada simulador e envie uma solicitação. Você continua na sua empresa atual até ser aprovado." : "Pesquise o nome da empresa ou frota e envie sua solicitação de acesso."}
          </p>
        </div>
      )}

      {browse && <div ref={applicationsRef} className="max-w-2xl mx-auto px-4 sm:px-0 mb-8 scroll-mt-20">
        <MyCompanyApplications rows={applicationRows} loading={applicationsLoading} failed={Boolean(applicationsFailed)} onCancelRequest={cancelRequestJoinCompany} onWithdrawApplication={canWithdraw ? withdrawRow : undefined} />
      </div>}

      {/* SIMULATOR SELECT */}
      <div className="max-w-2xl mx-auto px-4 sm:px-0 mb-4">
        <label className="block text-[13px] font-medium text-slate-700 dark:text-nvu-text-soft mb-1.5 ml-0.5">
          Simulador
        </label>
        <ModalSelect title="Selecionar simulador"
          value={selectedSimulatorId}
          onChange={(e) => setSelectedSimulatorId(e.target.value)}
          className="w-full bg-white dark:bg-nvu-page border border-slate-200 dark:border-nvu-line rounded-xl px-4 h-14 text-[15px] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:text-nvu-text transition-all shadow-sm appearance-none cursor-pointer"
        >
          <option value="" disabled>Selecione um simulador</option>
          {activeSimulators.map((sim:any) => (
            <option key={sim.id} value={sim.id}>
              {sim.name}
            </option>
          ))}
        </ModalSelect>
      </div>

      {/* SEARCH INPUT */}
      <div className="relative mb-8 group max-w-2xl mx-auto px-4 sm:px-0">
        <div className="absolute inset-y-0 left-4 sm:left-0 pl-4 sm:pl-5 flex items-center pointer-events-none">
          <Search
            className="text-gray-400 group-focus-within:text-blue-500 transition-colors"
            size={20}
          />
        </div>
        <input
          type="text"
          disabled={!selectedSimulatorId}
          placeholder={selectedSimulatorId ? "Buscar empresa ou frota..." : "Selecione um simulador antes"}
          autoFocus
          className="w-full pl-12 sm:pl-14 pr-4 h-14 bg-white dark:bg-nvu-surface rounded-2xl border border-gray-200 dark:border-nvu-line focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 text-[15px] font-medium text-gray-900 dark:text-nvu-text placeholder:text-gray-400 dark:placeholder:text-nvu-muted shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* LIST */}
      <div className="space-y-3 max-w-2xl mx-auto px-4 sm:px-0">
        {!companyCatalogAttempted || companiesLoading ? (
          <div role="status" aria-busy="true" className="text-center py-12 text-sm text-gray-500 dark:text-nvu-muted">
            Carregando empresas...
          </div>
        ) : !companyCatalogLoaded ? (
          <div role="alert" className="text-center py-12 text-sm text-red-500 dark:text-red-400">
            <p>{offline ? "Sem conexão. Conecte-se à internet para ver as empresas." : "Não foi possível carregar as empresas agora."}</p>
            <button type="button" onClick={retryCatalog} className="mt-4 inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-nvu-line px-4 py-2 text-[13px] font-semibold text-gray-700 dark:text-nvu-text-soft">
              <RefreshCw size={14} aria-hidden="true" /> Tentar novamente
            </button>
          </div>
        ) : !selectedSimulatorId ? (
          <div className="text-center py-12 px-4 rounded-2xl border border-dashed border-gray-200 dark:border-nvu-line bg-gray-50 dark:bg-nvu-surface">
            <Building2 size={32} className="mx-auto text-gray-300 mb-3" />
            <p className="text-[15px] font-medium text-gray-900 dark:text-nvu-text">
              Selecione um simulador
            </p>
            <p className="text-sm text-gray-500 dark:text-nvu-muted mt-1">
              Escolha um simulador acima para listar as empresas disponíveis.
            </p>
          </div>
        ) : filteredCompanies.length === 0 ? (
          <div className="text-center py-12 px-4 rounded-2xl border border-dashed border-gray-200 dark:border-nvu-line bg-gray-50 dark:bg-nvu-surface">
            <Search size={32} className="mx-auto text-gray-300 mb-3" />
            <p className="text-[15px] font-medium text-gray-900 dark:text-nvu-text">
              {isSearching ? "Nenhuma empresa encontrada" : "Nenhuma empresa neste simulador por enquanto"}
            </p>
            <p className="text-sm text-gray-500 dark:text-nvu-muted mt-1">
              {isSearching ? "Verifique a ortografia ou tente outro termo." : "Escolha outro simulador ou volte mais tarde."}
            </p>
          </div>
        ) : (
          filteredCompanies.map((company) => {
            const applyState = companyApplyState(company, memberCompanyIds, appliedCompanyIds);
            const stateLabel = { member: "Você participa", applied: "Inscrição enviada", closed: "Recrutamento fechado", open: "Solicitar" }[applyState];
            return (
            <div
              key={company.id}
              data-apply-state={applyState}
              className="flex items-center p-3 sm:p-4 bg-white dark:bg-nvu-surface rounded-2xl border border-gray-100 dark:border-nvu-line hover:border-blue-200 dark:border-blue-500/30 shadow-[0_2px_8px_-4px_rgba(0,0,0,0.05)] hover:shadow-[0_8px_24px_-8px_rgba(0,0,0,0.05)] transition-all group"
            >
              <div className="flex-1 flex items-center gap-3 sm:gap-4 min-w-0 pr-4">
                {/* AVATAR */}
                <div className="flex flex-col items-center gap-1.5 shrink-0">
                  {company.logoUrl ? (
                    <StableImage
                      src={company.logoUrl}
                      alt="Logo"
                      loading="lazy"
                      decoding="async"
                      wrapperClassName="w-10 h-10 sm:w-12 sm:h-12 rounded-full border border-gray-100 dark:border-nvu-line shrink-0"
                      className="object-cover"
                      referrerPolicy="no-referrer"
                      fallback={
                        <span className="h-full w-full bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center font-bold text-blue-700 dark:text-blue-400 text-sm sm:text-base">
                          {company.companyName.substring(0, 2).toUpperCase()}
                        </span>
                      }
                    />
                  ) : (
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-blue-50 dark:bg-blue-500/10 dark:border-blue-500/20 border border-blue-100 dark:border-blue-500/20/50 flex items-center justify-center font-bold text-blue-700 dark:text-blue-400 text-sm sm:text-base group-hover:bg-blue-600 group-hover:text-white transition-colors">
                      {company.companyName.substring(0, 2).toUpperCase()}
                    </div>
                  )}
                  <span className="sm:hidden px-1.5 py-0.5 bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 rounded-md text-[9px] font-bold tracking-wide truncate max-w-[60px]">
                    {getSimulatorLabel(company)}
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <h3 className="text-[15px] sm:text-[16px] font-bold text-gray-900 dark:text-nvu-text tracking-tight truncate leading-tight group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                    {company.companyName}
                  </h3>
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-1 sm:gap-3 mt-1 sm:mt-1.5">
                    <span className="hidden sm:inline px-2 py-0.5 bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 rounded-md text-xs font-bold tracking-wide border border-blue-100 dark:border-blue-500/20/50">
                      {getSimulatorLabel(company)}
                    </span>
                  </div>
                </div>
              </div>

              <Button
                onClick={() => handleRequest(company.id)}
                disabled={isRequestingId === company.id || applyState !== "open"}
                aria-label={applyState === "open" ? `Solicitar entrada em ${company.companyName}` : `${company.companyName}: ${stateLabel}`}
                className="shrink-0 h-10 px-4 text-[13px] font-bold bg-gray-900 dark:bg-[#fafafa] text-white dark:text-[#10151c] hover:bg-black dark:hover:bg-white rounded-xl shadow-[0_2px_10px_-3px_rgba(0,0,0,0.1)] active:scale-95 transition-all w-24 sm:w-28 relative overflow-hidden group/btn"
              >
                {isRequestingId === company.id ? (
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 dark:border-black/30 border-t-white dark:border-t-black rounded-full animate-spin"></div>
                  </div>
                ) : (
                  <span className="relative z-10 flex items-center justify-center">
                    {stateLabel}
                  </span>
                )}
                {/* Shine effect logic */}
                {applyState === "open" && <div className="absolute inset-0 -translate-x-[150%] animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/20 dark:via-black/10 to-transparent skew-x-[-20deg] z-0"></div>}
              </Button>
            </div>
            );
          })
        )}
      </div>
    </div>
  );
}
