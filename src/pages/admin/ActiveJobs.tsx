import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useOperationalStore } from "../../context/AppContext";
import { useCompanyStore } from "../../context/CompanyContext";
import { resolveSimulatorDisplayLabel } from "../../lib/simulatorOptions";
import { BackLink, PageHeader } from "../../components/partnerships/shared";
import OperationsTab from "./fleet/OperationsTab";
import "../../components/partnerships/Partnerships.css";

/** Trabalhos ativos (Central de gestão): página própria com as operações em andamento da empresa, com o card de cada uma. */
export default function ActiveJobs() {
  const { activeCompanyId, companies, allCompanies } = useCompanyStore();
  const { simulators } = useOperationalStore();
  const navigate = useNavigate();
  const me = activeCompanyId || "", ownCompany = companies.find(item => item.id === me) || allCompanies.find(item => item.id === me);
  const [resultsId, setResultsId] = useState<string | null>(null);
  useEffect(() => { window.scrollTo?.({ top: 0 }); }, [resultsId]);
  return <div className="nvu-central-page nvu-b2p"><div className="nvu-central-stack">
    <PageHeader title={resultsId ? "Resultados" : "Trabalhos ativos"} description={resultsId ? "Ganhos e ritmo da operação." : "Operações em andamento."} companyName={String(ownCompany?.companyName || ownCompany?.fleetName || "")}
      simulator={ownCompany ? resolveSimulatorDisplayLabel(ownCompany, simulators as any[], allCompanies) : ""} />
    <BackLink label={resultsId ? "Trabalhos ativos" : "Central"} onClick={() => resultsId ? setResultsId(null) : navigate("/admin/fleet", { state: { activeTab: "operations" } })} />
    {me ? <OperationsTab view="jobs" resultsId={resultsId} onResultsChange={setResultsId} /> : <p className="b2p-empty">Selecione uma empresa.</p>}
  </div></div>;
}
