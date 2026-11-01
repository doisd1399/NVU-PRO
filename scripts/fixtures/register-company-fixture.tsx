import "../../src/index.css";
import React, { createContext, useContext } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import RegisterCompany from "../../src/pages/RegisterCompany";

// The real company registration page with a scripted session and catalog; Firestore/Storage writes only record what they got.
const Context = createContext<any>(null);
export const useSessionStore = () => useContext(Context);
export const useOperationalStore = () => useContext(Context);
export const auth = { currentUser: { uid: "owner-1", email: "Owner@Example.test", displayName: "David Canto" } };
export const db = {}; export const storage = {};
export const signInWithGoogleAccount = async () => ({ uid: "owner-1" });
const value = {
  currentUser: { id: "owner-1", name: "David Canto", email: "owner@example.test", whatsapp: "22998291399" }, authInitialized: true, sessionUiReady: true, logOutApp: async () => undefined,
  simulators: [{ id: "gto", name: "GTO", active: true }, { id: "ats", name: "ATS", active: true }, { id: "ets-2", name: "ETS 2", active: true }, { id: "off", name: "Desligado", active: false }],
  simulatorsLoading: false, simulatorsError: null,
};
function Done() { const location = useLocation(); return <p data-testid="done">{location.pathname}</p>; }
history.replaceState({}, "", "/register-company");
createRoot(document.getElementById("root")!).render(<MemoryRouter initialEntries={["/register-company"]}><Context.Provider value={value}>
  <Routes><Route path="/register-company" element={<RegisterCompany />} /><Route path="/pending-applications" element={<Done />} /></Routes></Context.Provider></MemoryRouter>);
