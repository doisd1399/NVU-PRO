import React, { createContext, useContext, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import PendingApplications from "../../src/pages/PendingApplications";

// The real "Pendências" page. An account without a company is shown the personal area only when the server enabled it.
const Context = createContext<any>(null);
export const useSessionStore = () => useContext(Context);
export const useCompanyStore = () => useContext(Context);
export const useOperationalStore = () => useContext(Context);
export const useCurrentUserPendingApplications = () => useContext(Context).pendingApplications;
const q = new URLSearchParams(location.search);
const enabled = q.get("enabled") !== "0";
const state: any = (window as any).qaPersonal = { loads: 0, logouts: 0 };
const company = (id: string, name: string) => ({ id, companyName: name, simulatorId: "gto", simulatorName: "GTO", ownerName: "Dono", status: "active" });
const catalog = [company("dc", "DC Transportes"), company("norte", "Norte Cargas")];
const trips = [
  { id: "t1", driverId: "me", companyId: "dc", status: "concluida", recordStatus: "concluida", valor: 1500, value: 1500, currency: "BRL", simulatorId: "gto", createdAt: new Date().toISOString(), completedAt: new Date().toISOString() },
  { id: "t2", driverId: "me", companyId: "antiga", status: "concluida", recordStatus: "concluida", valor: 700, value: 700, currency: "BRL", simulatorId: "gto", createdAt: new Date().toISOString(), completedAt: new Date().toISOString() },
];
export const useDriverTrips = () => ({ trips, loading: false, error: null, historyReady: true, coverage: "complete", readCoverage: null, refreshing: false });

function App() {
  const [loaded, setLoaded] = useState(false);
  const loadCompanyCatalog = async () => { state.loads += 1; setLoaded(true); return catalog; };
  const value = {
    currentUser: { id: "me", name: "David Canto", email: "david@example.test", whatsapp: "11999990000", status: "active", driverProfileEnabled: enabled || undefined },
    authInitialized: true, sessionUiReady: true, profileIndex: { status: "ready", profiles: [], uid: "me" },
    logOutApp: async () => { state.logouts += 1; }, refreshSession: () => undefined,
    simulators: [{ id: "gto", name: "GTO", active: true }],
    allCompanies: loaded ? catalog : [], companies: [], companiesLoading: false, companyCatalogLoaded: loaded, companyCatalogAttempted: loaded, loadCompanyCatalog,
    memberships: [], driverRequests: [], requestJoinCompany: async () => undefined, cancelRequestJoinCompany: async () => undefined,
    pendingApplications: { applications: q.get("pending") === "1" ? [{ id: "app-1", userId: "me", companyId: "norte", status: "pending", type: "driver_application", companyName: "Norte Cargas", simulatorName: "GTO", createdAt: { seconds: Math.floor(Date.now() / 1000) } }] : [], loading: false, queryError: false },
  };
  return <Context.Provider value={value}><Routes><Route path="/pending-applications" element={<PendingApplications />} /><Route path="/" element={<p data-testid="home">Início</p>} /></Routes></Context.Provider>;
}
history.replaceState({}, "", "/pending-applications");
createRoot(document.getElementById("root")!).render(<BrowserRouter><App /></BrowserRouter>);
