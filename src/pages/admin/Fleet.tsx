import React, {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useLayoutEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "../../lib/utils";
import { useOperationalStore, useSessionStore } from "../../context/AppContext";
import { useCompanyStore } from "../../context/CompanyContext";
import {
  ChevronLeft,
  Bell,
  ChevronDown,
  LayoutGrid,
  LayoutDashboard,
  FileText,
  Truck,
  Container,
  Users,
  Building2,
  ShieldCheck,
  Gamepad2,
  Check,
  RefreshCw,
  Activity,
  Settings,
  Pencil,
  Eye,
} from "lucide-react";
import { toast } from "sonner";
import { StableImage } from "../../components/common/StableImage";
import { prepareAndCommitNavigation } from "../../lib/navigationTransition";
import { preloadRoute } from "../../lib/routePreload";
import { markProfilePerf } from "../../lib/profilePerformanceTelemetry";
import { resolveSimulatorDisplayLabel } from "../../lib/simulatorOptions";
import { isTrailerlessSimulator } from "../../lib/resolveSimulator";
import OperationsTab from "./fleet/OperationsTab";

const loadOperationsTab = () => import("./fleet/OperationsTab");
const loadCompanyTab = () => import("./fleet/CompanyTab");
const loadVehiclesTab = () => import("./fleet/VehiclesTab");
const loadTrailersTab = () => import("./fleet/TrailersTab");
const loadDriversTab = () => import("./fleet/DriversTab");
const loadContractsTab = () => import("./fleet/ContractsTab");
const loadRecruitmentTab = () => import("./fleet/RecruitmentTab");
const loadTripHistory = () => import("../driver/TripHistory");

const CompanyTab = lazy(loadCompanyTab);
const VehiclesTab = lazy(loadVehiclesTab);
const TrailersTab = lazy(loadTrailersTab);
const DriversTab = lazy(loadDriversTab);
const ContractsTab = lazy(loadContractsTab);
const RecruitmentTab = lazy(loadRecruitmentTab);
const TripHistory = lazy(loadTripHistory);

type Tab = "operations" | "company" | "fleet" | "hr" | "history" | "reports";

type FleetTab = "drivers" | "contracts" | "vehicles" | "trailers";

const tabOptions = [
  { id: "operations", label: "Painel Operacional", icon: LayoutDashboard },
  { id: "company", label: "Perfil da Empresa", icon: LayoutGrid },
  { id: "hr", label: "Recursos Humanos", icon: Building2 },
  { id: "fleet", label: "Frota", icon: Truck },
  { id: "history", label: "Histórico de Viagens", icon: FileText },
  { id: "reports", label: "Relatórios", icon: Activity },
];

const fleetOptions = [
  { id: "drivers", label: "Funcionários", icon: Users },
  { id: "contracts", label: "Operações", icon: FileText },
  { id: "vehicles", label: "Veículos", icon: Truck },
  { id: "trailers", label: "Reboques", icon: Container },
];

const topLevelTabIds: readonly Tab[] = [
  "operations",
  "company",
  "fleet",
  "hr",
  "history",
  "reports",
];

const fleetTabIds: readonly FleetTab[] = [
  "drivers",
  "contracts",
  "vehicles",
  "trailers",
];

const FleetPanelTransition = () => (
  <div className="min-h-[220px]" aria-hidden="true" />
);

const preloadTopLevelTab = (tab: Tab): Promise<void> => {
  const loader =
    tab === "operations"
      ? loadOperationsTab
      : tab === "company"
        ? loadCompanyTab
        : tab === "hr"
          ? loadRecruitmentTab
          : tab === "history"
            ? loadTripHistory
            : tab === "fleet"
              ? loadDriversTab
              : null;
  return loader
    ? loader().then(() => undefined).catch(() => undefined)
    : Promise.resolve();
};

const preloadFleetSubTab = (tab: FleetTab): Promise<void> => {
  const loader =
    tab === "drivers"
      ? loadDriversTab
      : tab === "contracts"
        ? loadContractsTab
        : tab === "vehicles"
          ? loadVehiclesTab
          : loadTrailersTab;
  return loader().then(() => undefined).catch(() => undefined);
};

type FleetNavigation = {
  activeTab: Tab;
  activeFleetTab: FleetTab;
  editContractId: string | null;
  openCompanyEditor: boolean;
};

const getFleetNavigation = (state: unknown): FleetNavigation => {
  const routeState =
    state && typeof state === "object"
      ? (state as Record<string, unknown>)
      : {};
  const requestedTab = routeState.activeTab;
  const requestedFleetTab = routeState.activeFleetTab ?? routeState.fleetTab;
  const editContractId =
    typeof routeState.editContractId === "string"
      ? routeState.editContractId
      : null;
  const openCompanyEditor = routeState.openCompanyEditor === true;

  // Preserve compatibility with older links that used activeTab for a
  // nested fleet selector.
  if (
    typeof requestedTab === "string" &&
    fleetTabIds.includes(requestedTab as FleetTab)
  ) {
    return {
      activeTab: "fleet",
      activeFleetTab: requestedTab as FleetTab,
      editContractId,
      openCompanyEditor,
    };
  }

  const activeTab =
    typeof requestedTab === "string" &&
    topLevelTabIds.includes(requestedTab as Tab)
      ? (requestedTab as Tab)
      : "operations";
  const activeFleetTab =
    typeof requestedFleetTab === "string" &&
    fleetTabIds.includes(requestedFleetTab as FleetTab)
      ? (requestedFleetTab as FleetTab)
      : "drivers";

  return { activeTab, activeFleetTab, editContractId, openCompanyEditor };
};

export default function Fleet() {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser } = useSessionStore();
  const { simulators } = useOperationalStore();
  const {
    activeCompanyId,
    setActiveCompanyId,
    companies,
    memberships,
    recruitmentApplications,
  } = useCompanyStore();
  const activeCompany = companies.find((c) => c.id === activeCompanyId);
  const trailerlessSimulator = isTrailerlessSimulator(
    activeCompany,
    simulators as unknown[],
  );
  const visibleFleetOptions = trailerlessSimulator
    ? fleetOptions.filter((option) => option.id !== "trailers")
    : fleetOptions;
  const profilePaintMarkedRef = useRef(false);

  useLayoutEffect(() => {
    if (profilePaintMarkedRef.current || !currentUser || !activeCompanyId) return;
    const frame = window.requestAnimationFrame(() => {
      profilePaintMarkedRef.current = true;
      markProfilePerf("T11_PROFILE_FIRST_PAINT", {
        route: "/admin/fleet",
        role: "admin",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeCompanyId, currentUser]);

  const initialFleetNavigation = getFleetNavigation(location.state);
  const initialFleetTab =
    trailerlessSimulator && initialFleetNavigation.activeFleetTab === "trailers"
      ? "vehicles"
      : initialFleetNavigation.activeFleetTab;
  const [activeTab, setActiveTab] = useState<Tab>(
    initialFleetNavigation.activeTab,
  );
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(new Set([activeTab]));
  const [activeFleetTab, setActiveFleetTab] = useState<FleetTab>(initialFleetTab);
  const [visitedFleetTabs, setVisitedFleetTabs] = useState<Set<string>>(new Set([initialFleetTab]));
  // The selected panel is the visual acknowledgement of the user's click.
  // Deferring these values made the active tab wait for React's background
  // scheduler on slower WebViews, even though the click had already
  // committed the new state.
  const renderedTab = activeTab;
  const renderedFleetTab =
    trailerlessSimulator && activeFleetTab === "trailers"
      ? "vehicles"
      : activeFleetTab;
  // Only the selected panel is mounted initially, so no timer is needed
  // before displaying it.
  const [showSecondary] = useState(true);

  useEffect(() => {
    setVisitedTabs((previous) =>
      previous.has(renderedTab)
        ? previous
        : new Set(previous).add(renderedTab),
    );
  }, [renderedTab]);

  useEffect(() => {
    setVisitedFleetTabs((prev) => {
      if (prev.has(renderedFleetTab)) return prev;
      const next = new Set(prev);
      next.add(renderedFleetTab);
      return next;
    });
  }, [renderedFleetTab]);
  const [editContractId, setEditContractId] = useState<string | null>(null);
  const [preselectedDriverId, setPreselectedDriverId] = useState<string | null>(
    null,
  );
  const [preselectedContractId, setPreselectedContractId] = useState<
    string | null
  >(null);
  const [isTabMenuOpen, setIsTabMenuOpen] = useState(false);
  const [isFleetMenuOpen, setIsFleetMenuOpen] = useState(false);
  const [isSimulatorMenuOpen, setIsSimulatorMenuOpen] = useState(false);
  const [isRecruitmentFormOpen, setIsRecruitmentFormOpen] = useState(false);
  const [isTripDetailsOpen, setIsTripDetailsOpen] = useState(false);
  const [isCompanyEditMode, setIsCompanyEditMode] = useState(
    initialFleetNavigation.openCompanyEditor,
  );
  const [isCompanyViewMode, setIsCompanyViewMode] = useState(false);
  const [isCompanySettingsOpen, setIsCompanySettingsOpen] = useState(false);
  const tabRequestRef = useRef(0);

  useEffect(() => {
    if (!isTabMenuOpen) return;
    // Opening the selector itself must stay light. Warm only the visible
    // panel here; the remaining chunks are handled by the idle warm-up.
    void preloadTopLevelTab(activeTab);
  }, [activeTab, isTabMenuOpen]);

  useEffect(() => {
    if (!isFleetMenuOpen) return;
    void preloadFleetSubTab(activeFleetTab);
  }, [activeFleetTab, isFleetMenuOpen]);

  useEffect(() => {
    const connection = (navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }).connection;
    if (connection?.saveData || connection?.effectiveType === "2g") return;

    // The company profile is a frequent first tap and its chunk is small.
    // Warm it shortly after the operational shell commits instead of making
    // mobile users wait for a long idle callback that may never fire.
    const companyTimer = window.setTimeout(() => {
      void loadCompanyTab().catch(() => undefined);
    }, 180);

    const warmAllPanels = () => {
      const loaders = [
        loadRecruitmentTab,
        loadTripHistory,
        loadDriversTab,
        loadContractsTab,
        loadVehiclesTab,
        loadTrailersTab,
      ];
      let index = 0;
      const worker = async () => {
        while (index < loaders.length) {
          const loader = loaders[index++];
          try {
            await loader();
          } catch {
            // Best-effort warm-up; click navigation can retry.
          }
        }
      };
      void Promise.all([worker(), worker()]);
    };

    // Parsing every secondary panel in the first frame competes with the
    // first user interaction. Use an idle slice after the shell is usable.
    const idleApi = window as Window & {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number },
      ) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (idleApi.requestIdleCallback) {
      const idleId = idleApi.requestIdleCallback(warmAllPanels, { timeout: 1400 });
      return () => {
        window.clearTimeout(companyTimer);
        idleApi.cancelIdleCallback?.(idleId);
      };
    }
    const timer = window.setTimeout(warmAllPanels, 900);
    return () => {
      window.clearTimeout(companyTimer);
      window.clearTimeout(timer);
    };
  }, []);

  const handleContractEditComplete = React.useCallback(() => {
    setEditContractId(null);
  }, []);

  const getSimulatorLabel = (company: any) =>
    resolveSimulatorDisplayLabel(
      company,
      simulators as any[],
      companies as any[],
    ) || company?.simulatorName || "";

  const pendingRecruitmentCount = React.useMemo(
    () =>
      recruitmentApplications.filter(
        (application) =>
          application.companyId === activeCompanyId &&
          application.status === "pending" &&
          application.isCurrent !== false &&
          application.type !== "company_registration",
      ).length,
    [activeCompanyId, recruitmentApplications],
  );

  useEffect(() => {
    const nextNavigation = getFleetNavigation(location.state);
    setActiveTab((current) =>
      current === nextNavigation.activeTab ? current : nextNavigation.activeTab,
    );
    const nextFleetTab =
      trailerlessSimulator && nextNavigation.activeFleetTab === "trailers"
        ? "vehicles"
        : nextNavigation.activeFleetTab;
    setActiveFleetTab((current) =>
      current === nextFleetTab ? current : nextFleetTab,
    );
    setEditContractId((current) =>
      current === nextNavigation.editContractId
        ? current
        : nextNavigation.editContractId,
    );
    if (nextNavigation.openCompanyEditor) {
      setIsCompanyEditMode(true);
      setIsCompanyViewMode(false);
    }
  }, [location.state, trailerlessSimulator]);

  // These selectors are views inside the same route. Keeping their state in
  // React Router creates real browser/WebView history entries, so Back
  // returns through the previous corporate view instead of closing the app.
  const selectFleetTab = (nextTab: Tab) => {
    setIsTabMenuOpen(false);
    if (nextTab === activeTab) return;
    const requestId = ++tabRequestRef.current;

    const currentState =
      location.state && typeof location.state === "object"
        ? (location.state as Record<string, unknown>)
        : {};
    const nextState: Record<string, unknown> = {
      ...currentState,
      activeTab: nextTab,
    };
    if (nextTab === "fleet") nextState.activeFleetTab = activeFleetTab;
    else delete nextState.editContractId;

    // Start the module request and switch the selected panel in the click frame.
    void prepareAndCommitNavigation(
      () => preloadTopLevelTab(nextTab),
      () => {
        if (requestId !== tabRequestRef.current) return;
        setActiveTab(nextTab);
        navigate(location.pathname, { state: nextState });
      },
    );
  };

  const selectFleetSubTab = (nextTab: FleetTab) => {
    const safeNextTab =
      trailerlessSimulator && nextTab === "trailers" ? "vehicles" : nextTab;
    setIsFleetMenuOpen(false);
    if (activeTab === "fleet" && safeNextTab === activeFleetTab) return;
    const requestId = ++tabRequestRef.current;

    const currentState =
      location.state && typeof location.state === "object"
        ? (location.state as Record<string, unknown>)
        : {};
    const nextState: Record<string, unknown> = {
      ...currentState,
      activeTab: "fleet",
      activeFleetTab: safeNextTab,
    };
    if (safeNextTab !== "contracts") delete nextState.editContractId;

    void prepareAndCommitNavigation(
      () => preloadFleetSubTab(safeNextTab),
      () => {
        if (requestId !== tabRequestRef.current) return;
        setActiveTab("fleet");
        setActiveFleetTab(safeNextTab);
        navigate(location.pathname, { state: nextState });
      },
    );
  };

  const activeTabDetails =
    tabOptions.find((t) => t.id === activeTab) || tabOptions[0];
  const ActiveIcon = activeTabDetails.icon;

  return (
    <div className="nvu-admin-company-page min-h-[calc(100vh-64px)] bg-slate-50 dark:bg-[#09090b] font-sans pb-8 w-full box-border">
      <div className={cn(
        "flex flex-col gap-4 pt-4 sm:pt-6 w-full px-4 sm:px-4 md:px-0 box-border",
        activeTab === "company" ? "max-w-none" : "max-w-3xl mx-auto",
      )}>
        {/* Company Profile Hero — visual parity with the Driver Profile. */}
        {activeCompany && !isRecruitmentFormOpen && !isTripDetailsOpen && (
          <section
            data-nvu-profile-banner
            className="nvu-admin-company-hero nvu-profile-hero relative isolate -mx-4 h-[300px] min-h-0 overflow-hidden rounded-b-[18px] bg-[#0e1d29] shadow-[0_18px_45px_rgba(7,23,37,0.18)] sm:-mt-6 sm:h-[320px] sm:rounded-b-[22px]"
            onClick={() => window.dispatchEvent(new CustomEvent("nvu-profile-banner-tapped", { detail: { scope: "company" } }))}
          >
            <div className="absolute inset-0 overflow-hidden rounded-b-[18px] sm:rounded-b-[22px]">
              <div className="absolute inset-0 overflow-hidden bg-[#0e1d29]">
                {activeCompany.logoUrl || (activeCompany as any).logoURL ? (
                  <StableImage
                    src={activeCompany.logoUrl || (activeCompany as any).logoURL}
                    alt={`Logo de ${activeCompany.companyName || "Empresa"}`}
                    loading="eager"
                    decoding="async"
                    fetchPriority="high"
                    wrapperClassName="absolute inset-0 h-full w-full"
                    className="object-cover object-center opacity-100"
                    referrerPolicy="no-referrer"
                    fallback={<span className="h-full w-full bg-[radial-gradient(circle_at_72%_22%,#1a5362_0%,#102839_46%,#07131e_100%)]" />}
                  />
                ) : (
                  <div className="h-full w-full bg-[radial-gradient(circle_at_72%_22%,#1a5362_0%,#102839_46%,#07131e_100%)]" />
                )}
              </div>
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(4,16,28,0.02)_0%,rgba(4,16,28,0.06)_42%,rgba(4,16,28,0.40)_100%)]" />
              <div className="absolute inset-y-0 left-0 w-2/3 bg-[linear-gradient(90deg,rgba(4,16,28,0.26)_0%,rgba(4,16,28,0.18)_62%,transparent_100%)]" />
            </div>

            <div className="relative z-10 flex h-full min-h-0 flex-col justify-end p-4 pb-5 pt-[calc(env(safe-area-inset-top)+3.75rem)] sm:p-6 sm:pb-6 sm:pt-[calc(env(safe-area-inset-top)+3.75rem)]">
              <div className="flex items-end justify-between gap-4 sm:gap-6">
                <div className="flex min-w-0 flex-1 items-end gap-3 sm:gap-4">
                  <div className="flex h-11 w-1 shrink-0 items-center justify-center rounded-full bg-[#13c9b4] shadow-[0_0_18px_rgba(19,201,180,0.55)] sm:h-16" />
                  <div className="min-w-0 text-white">
                    <div className="flex items-center gap-2">
                      <Building2 size={19} className="shrink-0 text-white/95 sm:h-6 sm:w-6" />
                      <h2 className="truncate text-[18px] font-extrabold leading-tight tracking-[-0.02em] text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.65)] sm:text-[22px]">
                        {activeCompany.companyName || "Empresa"}
                      </h2>
                    </div>
                    <p className="mt-1 truncate text-[12px] font-medium text-white/90 sm:text-[14px]">
                      Administrador · {activeCompany.ownerName || currentUser?.name || "NVU"}
                    </p>
                  </div>
                </div>

                <div className="relative w-[118px] shrink-0 self-end rounded-xl border border-white/25 bg-slate-950/12 p-1 shadow-[0_6px_18px_rgba(0,0,0,0.12)] backdrop-blur-sm sm:w-[134px] sm:rounded-2xl sm:p-1.5">
                  <span className="block px-1 text-[8px] font-bold uppercase tracking-[0.17em] text-white/75 sm:text-[9px]">Simulador</span>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      setIsSimulatorMenuOpen(!isSimulatorMenuOpen);
                    }}
                    className="mt-0.5 flex w-full items-center justify-between gap-1 rounded-lg border border-white/35 bg-white/8 px-1.5 py-1 text-left transition-colors hover:bg-white/15 active:scale-[0.98] sm:px-2 sm:py-1.5"
                    aria-expanded={isSimulatorMenuOpen}
                    aria-haspopup="listbox"
                  >
                    <span className="flex min-w-0 items-center gap-1 text-[10px] font-bold text-white sm:text-[11px]">
                      <Truck size={15} className="shrink-0 text-white/95 sm:h-4 sm:w-4" />
                      <span className="truncate">{getSimulatorLabel(activeCompany) || "G. Truck"}</span>
                    </span>
                    <ChevronDown size={15} className={cn("shrink-0 text-white/90 transition-transform", isSimulatorMenuOpen && "rotate-180")} />
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {isSimulatorMenuOpen && typeof document !== "undefined" && createPortal(
          <div
            className="nvu-simulator-modal-overlay nvu-simulator-modal-overlay-native fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/35 px-4 py-6 backdrop-blur-[2px]"
            role="presentation"
            onClick={(event) => {
              if (event.target === event.currentTarget) setIsSimulatorMenuOpen(false);
            }}
          >
            <div
              className="nvu-simulator-modal w-full max-w-[380px] max-h-[min(72vh,520px)] overflow-y-auto rounded-[28px] border border-slate-200 bg-white p-3 shadow-[0_24px_80px_rgba(15,23,42,0.30)] animate-in fade-in zoom-in-95 dark:border-[#2A2F3A] dark:bg-[#1A1F26]"
              role="dialog"
              aria-modal="true"
              aria-labelledby="company-simulator-modal-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3 px-3 pb-2 pt-1">
                <div>
                  <p id="company-simulator-modal-title" className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Selecione o simulador</p>
                  <p className="mt-1 text-[12px] text-slate-400 dark:text-slate-500">Escolha o ambiente corporativo ativo.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsSimulatorMenuOpen(false)}
                  className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-[#2A2F3A] dark:hover:text-white"
                  aria-label="Fechar seletor de simulador"
                >
                  <ChevronLeft size={18} className="rotate-90" />
                </button>
              </div>
              <div className="grid gap-1.5 pt-1" role="listbox" aria-label="Simuladores disponíveis">
                {companies
                  .filter((c) => memberships?.some((m) => m.companyId === c.id && (m.roles?.includes("admin") || m.roles?.includes("owner" as any))))
                  .map((c) => {
                    const isSelected = c.id === activeCompanyId;
                    return (
                      <button
                        key={c.id}
                        onClick={() => {
                          setActiveCompanyId(c.id);
                          setIsSimulatorMenuOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-center justify-between rounded-2xl border px-3.5 py-3 text-left transition-colors active:scale-[0.99]",
                          isSelected
                            ? "border-teal-300 bg-teal-50 text-slate-900 dark:border-teal-500/40 dark:bg-teal-500/10 dark:text-white"
                            : "border-transparent text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-[#2A2F3A]",
                        )}
                        role="option"
                        aria-selected={isSelected}
                      >
                        <span className="truncate text-[13px] font-semibold">{getSimulatorLabel(c) || "Global Truck"}</span>
                        {isSelected && <Check size={17} className="shrink-0 text-teal-600 dark:text-teal-300" />}
                      </button>
                    );
                  })}
              </div>
            </div>
          </div>,
          document.body,
        )}

        {/* Custom Tab Selector */}
        {activeCompany && !isRecruitmentFormOpen && !isTripDetailsOpen && (
          <div className="w-full flex flex-col gap-2 sm:gap-3 mb-4 z-20">
            <div className="flex items-center justify-between sm:justify-start gap-2 w-full sm:w-auto">
              <div className="flex items-center gap-2 min-w-0 flex-1 sm:flex-none">
                {/* Primary Tab Selector */}
                <div className="min-w-0 flex-1 sm:flex-none">
                  <button
                    onClick={() => setIsTabMenuOpen(!isTabMenuOpen)}
                    className="w-full sm:w-auto h-9 bg-white dark:bg-[#1A1F26] border border-slate-200 dark:border-[#2A2F3A] rounded-lg px-3 flex items-center justify-center sm:justify-start gap-2 shadow-sm focus:outline-none transition-colors hover:bg-slate-50 dark:hover:bg-[#2A2F3A]"
                  >
                    <ActiveIcon
                      size={14}
                      className="text-slate-600 dark:text-slate-400 shrink-0"
                    />
                    <span className="text-[11px] sm:text-[12px] font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                      {activeTabDetails.label}
                    </span>
                    {activeTab === "hr" && pendingRecruitmentCount > 0 && (
                      <span
                        className="inline-flex min-w-4 h-4 px-1 items-center justify-center rounded-full bg-slate-100 dark:bg-[#2A2F3A] border border-slate-200 dark:border-[#3A3F4A] text-[9px] leading-none font-semibold text-slate-600 dark:text-slate-300"
                        aria-label={`${pendingRecruitmentCount} inscrições pendentes`}
                      >
                        {pendingRecruitmentCount > 99
                          ? "99+"
                          : pendingRecruitmentCount}
                      </span>
                    )}
                    <ChevronDown
                      size={14}
                      className={cn(
                        "text-slate-400 shrink-0 transition-transform",
                        isTabMenuOpen && "rotate-180",
                      )}
                    />
                  </button>
                </div>

                {/* Sub-selector for Fleet */}
                {activeTab === "fleet" && (
                  <div className="min-w-0 flex-1 sm:flex-none">
                    <button
                      onClick={() => setIsFleetMenuOpen(!isFleetMenuOpen)}
                      className="w-full sm:w-auto h-9 bg-white dark:bg-[#1A1F26] border border-slate-200 dark:border-[#2A2F3A] rounded-lg px-3 flex items-center justify-center sm:justify-start gap-2 shadow-sm focus:outline-none transition-colors hover:bg-slate-50 dark:hover:bg-[#2A2F3A]"
                    >
                      {visibleFleetOptions.find((o) => o.id === renderedFleetTab)?.icon &&
                        React.createElement(
                          visibleFleetOptions.find((o) => o.id === renderedFleetTab)!.icon,
                          {
                            size: 14,
                            className:
                              "text-slate-600 dark:text-slate-400 shrink-0",
                          },
                        )}
                      <span className="text-[11px] sm:text-[12px] font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                        {visibleFleetOptions.find((o) => o.id === renderedFleetTab)?.label}
                      </span>
                      <ChevronDown
                        size={14}
                        className={cn(
                          "text-slate-400 shrink-0 transition-transform",
                          isFleetMenuOpen && "rotate-180",
                        )}
                      />
                    </button>
                  </div>
                )}
              </div>

              {/* Settings Button */}
              {activeTab === "company" && (
                <div className="shrink-0 relative">
                  <button
                    onClick={() => setIsCompanySettingsOpen(!isCompanySettingsOpen)}
                    className="w-9 h-9 bg-white dark:bg-[#1A1F26] border border-slate-200 dark:border-[#2A2F3A] rounded-lg flex items-center justify-center shadow-sm active:scale-[0.99] transition-transform hover:bg-slate-50 dark:hover:bg-[#2A2F3A]"
                  >
                    <Settings
                      size={16}
                      className="text-slate-600 dark:text-slate-400"
                    />
                  </button>

                  {isCompanySettingsOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setIsCompanySettingsOpen(false)}
                      />
                      <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-[#1A1F26] border border-slate-200 dark:border-[#2A2F3A] rounded-xl shadow-lg z-50 overflow-hidden animate-in fade-in slide-in-from-top-2">
                        <button
                          onClick={() => {
                            setIsCompanySettingsOpen(false);
                            setIsCompanyEditMode(true);
                          }}
                          className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-[#2A2F3A] transition-colors border-b border-slate-100 dark:border-[#2A2F3A]"
                        >
                          <Pencil size={16} className="text-blue-600 dark:text-blue-400" />
                          <span className="text-[13px] font-medium text-slate-700 dark:text-slate-300">
                            Editar Perfil
                          </span>
                        </button>
                        <button
                          onClick={() => {
                            setIsCompanySettingsOpen(false);
                            setIsCompanyViewMode(true);
                          }}
                          className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-[#2A2F3A] transition-colors"
                        >
                          <Eye size={16} className="text-slate-600 dark:text-slate-400" />
                          <span className="text-[13px] font-medium text-slate-700 dark:text-slate-300">
                            Visualizar Informações
                          </span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Dropdown in normal document flow for Tab Menu */}
            {isTabMenuOpen && (
              <div className="w-full bg-white dark:bg-[#1A1F26] border border-slate-200 dark:border-[#2A2F3A] rounded-lg shadow-sm overflow-hidden animate-in fade-in slide-in-from-top-2">
                {tabOptions.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => {
                        if (tab.id === "reports") {
                          void prepareAndCommitNavigation(
                            () => preloadRoute("/admin/reports"),
                            () => navigate("/admin/reports"),
                          );
                        } else {
                          selectFleetTab(tab.id as Tab);
                        }
                        setIsTabMenuOpen(false);
                      }}
                      className={cn(
                        "w-full flex items-center gap-2.5 px-3 py-2.5 border-b border-slate-100 dark:border-[#2A2F3A]/60 last:border-0 hover:bg-slate-50 dark:hover:bg-[#2A2F3A] transition-colors text-left",
                        activeTab === tab.id
                          ? "bg-slate-50 dark:bg-[#2A2F3A]"
                          : "",
                      )}
                    >
                      <Icon
                        size={14}
                        className={cn(
                          activeTab === tab.id
                            ? "text-blue-600 dark:text-[#0cb49f]"
                            : "text-slate-500",
                        )}
                      />
                      <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                        <span
                          className={cn(
                            "text-[12px] font-semibold whitespace-nowrap",
                            activeTab === tab.id
                              ? "text-blue-700 dark:text-[#0cb49f]"
                              : "text-slate-600 dark:text-slate-300",
                          )}
                        >
                          {tab.label}
                        </span>
                        {tab.id === "hr" && pendingRecruitmentCount > 0 && (
                          <span
                            className={cn(
                              "inline-flex min-w-4 h-4 px-1 items-center justify-center rounded-full border text-[9px] leading-none font-semibold",
                              activeTab === tab.id
                                ? "bg-blue-50 dark:bg-[#0cb49f]/10 border-blue-100 dark:border-[#0cb49f]/20 text-blue-600 dark:text-[#0cb49f]"
                                : "bg-slate-100 dark:bg-[#27272a] border-slate-200 dark:border-[#3f3f46] text-slate-500 dark:text-slate-400",
                            )}
                            aria-label={`${pendingRecruitmentCount} inscrições pendentes`}
                          >
                            {pendingRecruitmentCount > 99
                              ? "99+"
                              : pendingRecruitmentCount}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Dropdown in normal document flow for Fleet Menu */}
            {isFleetMenuOpen && activeTab === "fleet" && (
              <div className="w-full bg-white dark:bg-[#1A1F26] border border-slate-200 dark:border-[#2A2F3A] rounded-lg shadow-sm overflow-hidden animate-in fade-in slide-in-from-top-2">
                {visibleFleetOptions.map((opt) => {
                  const Icon = opt.icon;
                  const isSelected = activeFleetTab === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => {
                        selectFleetSubTab(opt.id as FleetTab);
                        setIsFleetMenuOpen(false);
                      }}
                      className={cn(
                        "w-full flex items-center gap-2.5 px-3 py-2.5 border-b border-slate-100 dark:border-[#2A2F3A]/60 last:border-0 hover:bg-slate-50 dark:hover:bg-[#2A2F3A] transition-colors text-left",
                        isSelected ? "bg-slate-50 dark:bg-[#2A2F3A]" : "",
                      )}
                    >
                      <Icon
                        size={14}
                        className={cn(
                          isSelected ? "text-blue-600" : "text-slate-500",
                        )}
                      />
                      <span
                        className={cn(
                          "text-[12px] font-semibold whitespace-nowrap",
                          isSelected
                            ? "text-blue-700 dark:text-blue-400"
                            : "text-slate-600 dark:text-slate-300",
                        )}
                      >
                        {opt.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Content Area */}
        <div className="relative">
          <Suspense fallback={<FleetPanelTransition />}>
            {(visitedTabs.has("operations") || renderedTab === "operations") && <div className={cn(renderedTab !== "operations" && "hidden")}>{showSecondary && <OperationsTab />}</div>}
            {(visitedTabs.has("company") || renderedTab === "company") && (
              <div className={cn(renderedTab !== "company" && "hidden")}>
                {showSecondary && <CompanyTab
                  isEditingProp={isCompanyEditMode}
                  setIsEditingProp={setIsCompanyEditMode}
                  isViewingProp={isCompanyViewMode}
                  setIsViewingProp={setIsCompanyViewMode}
                />}
              </div>
            )}
            {(visitedTabs.has("hr") || renderedTab === "hr") && (
              <div className={cn(renderedTab !== "hr" && "hidden")}>
                {showSecondary && <RecruitmentTab onFormOpen={setIsRecruitmentFormOpen} />}
              </div>
            )}
            {(visitedTabs.has("history") || renderedTab === "history") && (
              <div className={cn(renderedTab !== "history" && "hidden")}>
                {showSecondary && <TripHistory
                  isInsideAdminTab={true}
                  onTripDetailsOpen={setIsTripDetailsOpen}
                  mode="company"
                  companyId={activeCompanyId || undefined}
                />}
              </div>
            )}

            {(visitedTabs.has("fleet") || renderedTab === "fleet") && (
              <div className={cn("space-y-4", renderedTab !== "fleet" && "hidden")}>
                {(visitedFleetTabs.has("drivers") || renderedFleetTab === "drivers") && <div className={cn(renderedFleetTab !== "drivers" && "hidden")}>{showSecondary && <DriversTab />}</div>}
                {(visitedFleetTabs.has("contracts") || renderedFleetTab === "contracts") && (
                  <div className={cn(renderedFleetTab !== "contracts" && "hidden")}>
                    {showSecondary && <ContractsTab
                      editContractId={editContractId}
                      onEditComplete={handleContractEditComplete}
                    />}
                  </div>
                )}
                {(visitedFleetTabs.has("vehicles") || renderedFleetTab === "vehicles") && <div className={cn(renderedFleetTab !== "vehicles" && "hidden")}><VehiclesTab /></div>}
                {!trailerlessSimulator && (visitedFleetTabs.has("trailers") || renderedFleetTab === "trailers") && <div className={cn(renderedFleetTab !== "trailers" && "hidden")}><TrailersTab /></div>}
              </div>
            )}
          </Suspense>
        </div>
      </div>
    </div>
  );
}
