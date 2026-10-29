import React, { useState } from "react";
import { useOperationalStore, useSessionStore } from "../../context/AppContext";
import { useCompanyStore } from "../../context/CompanyContext";
import { resolveDriverPhoto } from "../../lib/resolveDriverPhoto";
import { resolveSimulatorDisplayLabel } from "../../lib/simulatorOptions";
import { SimulatorSelectionModal } from "../SimulatorSelectionModal";
import { ProfileCoverHero } from "./ProfileCoverHero";

/** Shared by company profile/activity/results and legacy driver report routes. */
export function WorkspaceProfileCover({ scope }: { scope: "driver" | "company" }) {
  const { currentUser, seniorCompanyId } = useSessionStore();
  const { companies, allCompanies, activeCompanyId, setActiveCompanyId, memberships } = useCompanyStore();
  const { simulators } = useOperationalStore();
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const company = companies.find(item => item.id === activeCompanyId) || allCompanies.find(item => item.id === activeCompanyId);
  if (!currentUser || (scope === "company" && !company)) return null;
  const label = (item: typeof company) => resolveSimulatorDisplayLabel(item, simulators, companies) || item?.simulatorName || "Simulador";
  const isManager = (companyId: string) => {
    const item = companies.find(candidate => candidate.id === companyId) || allCompanies.find(candidate => candidate.id === companyId);
    return item?.ownerId === currentUser.id || item?.userId === currentUser.id || seniorCompanyId === companyId
      || (currentUser.companyId === companyId && currentUser.status === "active" && (currentUser.role === "admin" || currentUser.roles?.includes("admin")))
      || memberships.some(member => member.companyId === companyId && member.status === "active" && (member.role === "admin" || member.roles?.includes("admin")));
  };
  const available = companies.filter(item => scope === "company" ? isManager(item.id) : memberships.some(member => member.companyId === item.id && member.status === "active") || item.id === activeCompanyId);
  return <div className="nvu-workspace-cover">
    <ProfileCoverHero key={`${scope}:${scope === "driver" ? currentUser.id : company.id}`} scope={scope} profileId={scope === "driver" ? currentUser.id : company.id} profile={scope === "driver" ? currentUser : company}
      name={scope === "driver" ? currentUser.name : company.companyName || "Empresa"} description={scope === "driver" ? "Motorista Parceiro" : "Perfil da empresa"}
      avatar={scope === "driver" ? resolveDriverPhoto(currentUser) : company.logoUrl || company.logoURL || company.companyLogoURL || ""} viewerId={currentUser.id}
      simulator={label(company)} simulatorOpen={simulatorOpen} onSimulator={() => setSimulatorOpen(true)} canEdit={scope === "driver" || isManager(company.id)}/>
    <SimulatorSelectionModal open={simulatorOpen} items={available.map(item => ({ id: item.id, label: label(item) }))} selectedId={activeCompanyId || ""} onSelect={setActiveCompanyId} onClose={() => setSimulatorOpen(false)}/>
  </div>;
}
