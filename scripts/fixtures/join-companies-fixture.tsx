import React, { createContext, useContext, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation, useParams } from "react-router-dom";
import JoinCompany from "../../src/pages/driver/JoinCompany";

// Real "Empresas" screen with an injected read model: the session, the company catalog (whose first load can fail), the
// driver's links, simple requests and recruitment applications. Writes only record what they were asked to do.
const Context = createContext<any>(null);
export const useSessionStore = () => useContext(Context);
export const useCompanyStore = () => useContext(Context);
export const useOperationalStore = () => useContext(Context);
export const useCurrentUserPendingApplications = () => useContext(Context).pendingApplications;

const company = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, companyName: name, simulatorId: "gto", simulatorName: "GTO", ownerName: "Dono", cnpj: "", status: "active", ...extra });
const catalog = [
  company("dc", "DC Transportes"), company("norte", "Norte Cargas"), company("rapida", "Rápida Logística", { recruitmentSettings: { isActive: false } }),
  company("sul", "Sul Fretes"), company("rural", "Rural Express"), company("zeta", "Zeta Frotas"),
  company("excluida", "Excluída Ltda", { deleted: true }), company("pendente", "Pendente SA", { status: "pending" }),
  company("wbds1", "Outro Simulador", { simulatorId: "wbds", simulatorName: "WBDS" }),
];
if (location.search.includes("offline=1")) Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
const state: any = (window as any).qaJoin = { loads: [] as boolean[], failNext: true, requested: [] as string[], cancelled: [] as string[],
  withdrawn: [] as any[], withdrawFailures: [] as any[], withdrawDelay: 0, removeApplication: (_id: string) => undefined as void };
// Stand-in for src/services/applicationWithdrawService.ts: the server command is scripted from the test.
const withdrawOffered = location.search.includes("withdraw=1"); // read before the URL is rewritten below
export const loadMembershipCapabilities = async () => withdrawOffered ? ["withdraw-application"] : [];
export const withdrawApplication = async (companyId: string, applicationId: string, diagnosticId: string) => {
  state.withdrawn.push({ companyId, applicationId, diagnosticId });
  await new Promise(resolve => setTimeout(resolve, state.withdrawDelay));
  const failure = state.withdrawFailures.shift();
  if (failure) throw failure;
  state.removeApplication(applicationId);
  return { success: true, withdrawn: true, companyId, applicationId };
};

// Stand-in for the company's recruitment form (/apply/:companyId): records where it was opened and where it returns to.
function ApplyForm() {
  const { companyId } = useParams(); const location = useLocation();
  return <p data-testid="apply-form" data-company={companyId} data-return={(location.state as any)?.returnTo || ""}>Formulário de inscrição</p>;
}

function App() {
  const [attempted, setAttempted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [applications, setApplications] = useState([{ id: "app-sul", userId: "me", companyId: "sul", status: "pending", type: "driver_application", companyName: "Sul Fretes", simulatorName: "GTO",
      createdAt: { seconds: Math.floor(Date.parse("2026-10-25T12:00:00.000Z") / 1000) } }]);
  state.removeApplication = (id: string) => setApplications(rows => rows.filter(row => row.id !== id));
  const [requests, setRequests] = useState([{ id: "req-rural", motoristaId: "me", empresaId: "rural", status: "pending", createdAt: "2026-10-20T12:00:00.000Z" }]);
  const loadCompanyCatalog = async (force = false) => {
    if (loaded && !force) return catalog;
    state.loads.push(force);
    setLoading(true); setAttempted(false);
    await new Promise(resolve => setTimeout(resolve, 30));
    const fail = state.failNext; state.failNext = false;
    setAttempted(true); setLoading(false); if (!fail) setLoaded(true);
    return catalog;
  };
  const value = {
    currentUser: { id: "me", name: "David Canto", email: "david@example.test" },
    simulators: [{ id: "gto", name: "GTO", active: true }, { id: "wbds", name: "WBDS", active: true }],
    allCompanies: loaded ? catalog : [], companies: loaded ? catalog.filter(item => item.id === "dc") : [],
    companiesLoading: loading, companyCatalogLoaded: loaded, companyCatalogAttempted: attempted, loadCompanyCatalog,
    memberships: [{ userId: "me", companyId: "dc", status: "active", roles: ["driver"] }, { userId: "someone", companyId: "norte", status: "active", roles: ["driver"] }],
    driverRequests: requests,
    requestJoinCompany: async (id: string) => { state.requested.push(id); },
    cancelRequestJoinCompany: async (id: string) => { state.cancelled.push(id); setRequests(rows => rows.filter(row => row.id !== id)); },
    pendingApplications: { applications, loading: false, queryError: false },
  };
  return <Context.Provider value={value}><Routes><Route path="/driver/companies" element={<JoinCompany mode="browse" />} /><Route path="/apply/:companyId" element={<ApplyForm />} /></Routes></Context.Provider>;
}
history.replaceState({}, "", "/driver/companies");
createRoot(document.getElementById("root")!).render(<BrowserRouter><App /></BrowserRouter>);
