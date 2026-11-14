import React, { createContext, useContext } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useNavigate } from "react-router-dom";
import RecruitmentApply from "../../src/pages/RecruitmentApply";

// The real company application page ("/apply/:companyId") with an injected read model, reached from a stand-in "Empresas".
const Context = createContext<any>(null);
export const useSessionStore = () => useContext(Context);
export const useCompanyStore = () => useContext(Context);
export const useOperationalStore = () => useContext(Context);
export const auth = { currentUser: { uid: "me", displayName: "David Canto", email: "david@example.test", photoURL: "" } };
export const storage = {};
export const signInWithGoogleAccount = async () => ({ uid: "me" });

const norte = { id: "norte", companyName: "Norte Cargas", simulatorId: "gto", simulatorName: "GTO", ownerId: "owner", status: "active", recruitmentSettings: { isActive: true, title: "Motorista" } };
const value = {
  sessionUiReady: true, currentUser: { id: "me", name: "David Canto", email: "david@example.test" },
  simulators: [{ id: "gto", name: "GTO", active: true }], simulatorsLoading: false, simulatorsError: null,
  allCompanies: [norte], companyCatalogLoaded: true, companyCatalogAttempted: true, loadCompanyCatalog: async () => [norte],
  loadCompanyById: async (id: string) => (id === "norte" ? norte : null), memberships: [], submitRecruitmentApplication: async () => "app-1",
};

function Empresas() {
  const navigate = useNavigate();
  return <div><h1>Empresas</h1><button onClick={() => navigate("/apply/norte", { state: { returnTo: "/driver/companies" } })}>Enviar</button></div>;
}
function App() {
  return <Context.Provider value={value}><Routes><Route path="/driver/companies" element={<Empresas />} /><Route path="/apply/:companyId" element={<RecruitmentApply />} /></Routes></Context.Provider>;
}
history.replaceState({}, "", "/driver/companies");
createRoot(document.getElementById("root")!).render(<BrowserRouter><App /></BrowserRouter>);
