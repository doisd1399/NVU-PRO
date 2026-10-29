import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { KeyRound, Container } from "lucide-react";
import { useOperationalStore, useSessionStore } from "../../context/AppContext";
import { useCompanyStore } from "../../context/CompanyContext";
import { RetainedPanel } from "../../components/common/RetainedPanel";
import { WorkspaceProfileCover } from "../../components/common/WorkspaceProfileCover";
import { WorkspacePageHeader } from "../../components/common/WorkspacePageHeader";
import { SimulatorSelectionModal } from "../../components/SimulatorSelectionModal";
import { resolveSimulatorDisplayLabel } from "../../lib/simulatorOptions";
import { isTrailerlessSimulator } from "../../lib/resolveSimulator";
import { commitNavigation } from "../../lib/navigationTransition";
import { PanelLoading } from "../../components/common/RetainedPanel";
import OperationsTab from "./fleet/OperationsTab";
import "../../components/driver/DriverWorkspace.css";
import { DriverProfileToolbar } from "../../components/driver/DriverProfileToolbar";
import type { DriverProfileView } from "../../components/driver/DriverProfileSummary";
import { canManageCompanyProfile } from "../../lib/companyProfileDescription";

const loaders = {
  company: () => import("./fleet/CompanyTab"), hr: () => import("./fleet/RecruitmentTab"), history: () => import("../driver/TripHistory"),
  drivers: () => import("./fleet/DriversTab"), contracts: () => import("./fleet/ContractsTab"),
  vehicles: () => import("./fleet/VehiclesTab"), trailers: () => import("./fleet/TrailersTab"), reports: () => import("./Reports"),
};
const CompanyTab = lazy(loaders.company), RecruitmentTab = lazy(loaders.hr), TripHistory = lazy(loaders.history);
const DriversTab = lazy(loaders.drivers), ContractsTab = lazy(loaders.contracts), VehiclesTab = lazy(loaders.vehicles), TrailersTab = lazy(loaders.trailers), Reports = lazy(loaders.reports);
type Tab = "operations" | "company" | "fleet" | "hr" | "history" | "reports";
type FleetTab = "drivers" | "contracts" | "vehicles" | "trailers";
const tabs: readonly string[] = ["operations", "company", "fleet", "hr", "history", "reports"];
const fleetTabs: readonly string[] = ["drivers", "contracts", "vehicles", "trailers"];

/** Accept older deep links, but never default Frota to employees. */
export function getFleetNavigation(state: unknown) {
  const value = state && typeof state === "object" ? state as Record<string, unknown> : {};
  const legacy = fleetTabs.includes(String(value.activeTab));
  return {
    activeTab: (legacy ? "fleet" : tabs.includes(String(value.activeTab)) ? value.activeTab : "operations") as Tab,
    activeFleetTab: (legacy ? value.activeTab : fleetTabs.includes(String(value.activeFleetTab ?? value.fleetTab)) ? value.activeFleetTab ?? value.fleetTab : "vehicles") as FleetTab,
    editContractId: typeof value.editContractId === "string" ? value.editContractId : null,
    openCompanyEditor: value.openCompanyEditor === true,
  };
}

export default function Fleet() {
  const location = useLocation(), navigate = useNavigate();
  const { currentUser, seniorCompanyId } = useSessionStore();
  const { simulators } = useOperationalStore();
  const { companies, allCompanies, activeCompanyId, setActiveCompanyId, memberships } = useCompanyStore();
  const activeCompany = companies.find(company => company.id === activeCompanyId) || allCompanies.find(company => company.id === activeCompanyId);
  const canEditCompany = canManageCompanyProfile(currentUser?.id || "", activeCompany, memberships, seniorCompanyId);
  const [profileView, setProfileView] = useState<DriverProfileView>("summary");
  useEffect(() => { setProfileView("summary"); }, [activeCompanyId]);
  const navigation = getFleetNavigation(location.state);
  const { activeTab } = navigation;
  const trailerless = isTrailerlessSimulator(activeCompany, simulators as unknown[]);
  const activeFleetTab = trailerless && navigation.activeFleetTab === "trailers" ? "vehicles" : navigation.activeFleetTab;
  const visited = useRef(new Set<Tab>()), visitedFleet = useRef(new Set<FleetTab>());
  visited.current.add(activeTab);
  if (activeTab === "fleet") visitedFleet.current.add(activeFleetTab);
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [recruitmentFormOpen, setRecruitmentFormOpen] = useState(false);
  const [tripDetailsOpen, setTripDetailsOpen] = useState(false);
  const [editing, setEditing] = useState(navigation.openCompanyEditor);
  const [viewing, setViewing] = useState(false);
  const [editContractId, setEditContractId] = useState(navigation.editContractId);
  const editComplete = useCallback(() => setEditContractId(null), []);
  useEffect(() => {
    setEditContractId(navigation.editContractId);
    if (navigation.openCompanyEditor) setEditing(true);
    setSimulatorOpen(false);
  }, [location.key]);
  // Load code, not data, in small idle slices. Navigation never waits for this.
  useEffect(() => {
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (connection?.saveData || connection?.effectiveType === "2g") return;
    let stopped = false, timer = 0;
    const queue = [loaders.vehicles, loaders.trailers, loaders.drivers, loaders.contracts, loaders.company, loaders.hr, loaders.history];
    const warm = async () => {
      const next = queue.shift();
      if (stopped || !next) return;
      try { await next(); } catch { /* Intent/click can retry. */ }
      if (!stopped) timer = window.setTimeout(warm, 180);
    };
    timer = window.setTimeout(warm, 600);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, []);
  const simulatorLabel = (company: any) => resolveSimulatorDisplayLabel(company, simulators as any[], companies as any[]) || company?.simulatorName || "Simulador";
  const descriptions = {
    operations: ["Central de gestão", "Resultados e ferramentas da sua empresa."],
    company: ["Meu perfil", "Informações e resultados da empresa."],
    hr: ["Recursos humanos", "Acompanhe candidaturas e contratações."],
    history: ["Viagens", "Consulte as viagens da sua empresa."],
    reports: ["Relatórios", "Acompanhe os resultados da empresa."],
    fleet: activeFleetTab === "drivers" ? ["Equipes", "Gerencie os funcionários da sua empresa."] : activeFleetTab === "contracts" ? ["Operações", "Organize as operações da sua empresa."] : ["Frota", "Gerencie veículos e reboques da sua empresa."],
  };
  const [title, description] = descriptions[activeTab];
  const isProfile = activeTab === "company" && Boolean(activeCompany);
  const hasCover = ["company", "history", "reports"].includes(activeTab) && Boolean(activeCompany);
  const showHeading = activeCompany && !(activeTab === "hr" && recruitmentFormOpen) && !(activeTab === "history" && tripDetailsOpen);
  const selectAsset = (tab: "vehicles" | "trailers") => {
    if (tab === activeFleetTab) return;
    commitNavigation(() => navigate("/admin/fleet", { state: { activeTab: "fleet", activeFleetTab: tab } }));
    void loaders[tab]().catch(() => undefined);
  };
  const simulatorItems = companies.filter(company => company.ownerId === currentUser?.id || company.userId === currentUser?.id || memberships?.some(member => member.companyId === company.id && member.status === "active" && (member.roles?.includes("admin") || member.roles?.includes("owner" as any))));

  return <Suspense fallback={<PanelLoading />}><div className={hasCover ? "nvu-company-profile-page nvu-driver-workspace nvu-workspace-theme" : "nvu-central-page nvu-company-tools-page"}>
    <div className={hasCover ? "nvu-profile-stack nvu-profile-cover-stack" : "nvu-central-stack"}>
      {hasCover && <WorkspaceProfileCover scope="company"/>}
      {showHeading && !hasCover && <WorkspacePageHeader key="tool-heading" title={title} description={description} companyName={activeCompany.companyName || "Empresa"} simulator={simulatorLabel(activeCompany)} onSimulator={() => setSimulatorOpen(true)} />}
      <SimulatorSelectionModal open={simulatorOpen} items={simulatorItems.map(company => ({ id: company.id, label: simulatorLabel(company) }))} selectedId={activeCompanyId || ""} onSelect={setActiveCompanyId} onClose={() => setSimulatorOpen(false)} description="Escolha o ambiente da empresa." />
      <div key="company-content" className={hasCover ? "nvu-driver-surface" : "nvu-central-content"} data-page={isProfile ? "profile" : activeTab}>
        {isProfile && !editing && <DriverProfileToolbar company view={profileView} onViewChange={setProfileView} infoOpen={viewing}
          onInfo={() => setViewing(value => !value)} onEdit={() => setEditing(true)} canEdit={canEditCompany}/>}
        {activeTab === "fleet" && (activeFleetTab === "vehicles" || activeFleetTab === "trailers") && <div role="group" aria-label="Tipo de frota" className="nvu-fleet-assets-switch" data-nvu-swipe-ignore>
          <button type="button" aria-pressed={activeFleetTab === "vehicles"} onClick={() => selectAsset("vehicles")} onPointerDown={() => void loaders.vehicles()}><KeyRound size={17} />Veículos</button>
          {!trailerless && <button type="button" aria-pressed={activeFleetTab === "trailers"} onClick={() => selectAsset("trailers")} onPointerDown={() => void loaders.trailers()}><Container size={17} />Reboques</button>}
        </div>}
        {!activeCompanyId ? <CompanyTab /> : <>
          {visited.current.has("operations") && <RetainedPanel active={activeTab === "operations"} keepEffects><OperationsTab active={activeTab === "operations"} /></RetainedPanel>}
          {visited.current.has("company") && <RetainedPanel active={activeTab === "company"}><CompanyTab key={activeCompanyId} profileView={profileView} isEditingProp={editing} setIsEditingProp={setEditing} isViewingProp={viewing} setIsViewingProp={setViewing} /></RetainedPanel>}
          {visited.current.has("hr") && <RetainedPanel active={activeTab === "hr"}><RecruitmentTab onFormOpen={setRecruitmentFormOpen} /></RetainedPanel>}
          {visited.current.has("history") && <RetainedPanel active={activeTab === "history"}><TripHistory isInsideAdminTab onTripDetailsOpen={setTripDetailsOpen} mode="company" companyId={activeCompanyId || undefined} /></RetainedPanel>}
          {visited.current.has("reports") && <RetainedPanel active={activeTab === "reports"}><Reports /></RetainedPanel>}
          {visited.current.has("fleet") && <RetainedPanel active={activeTab === "fleet"}>
            {visitedFleet.current.has("drivers") && <RetainedPanel active={activeFleetTab === "drivers"}><DriversTab /></RetainedPanel>}
            {visitedFleet.current.has("contracts") && <RetainedPanel active={activeFleetTab === "contracts"}><ContractsTab editContractId={editContractId} onEditComplete={editComplete} /></RetainedPanel>}
            {visitedFleet.current.has("vehicles") && <RetainedPanel active={activeFleetTab === "vehicles"}><VehiclesTab /></RetainedPanel>}
            {!trailerless && visitedFleet.current.has("trailers") && <RetainedPanel active={activeFleetTab === "trailers"}><TrailersTab /></RetainedPanel>}
          </RetainedPanel>}
        </>}
      </div>
    </div>
  </div></Suspense>;
}
