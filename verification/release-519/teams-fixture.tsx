import React, { createContext, useContext, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import DriversTab from "../../src/pages/admin/fleet/DriversTab";
import { driverDisplayIdentity } from "../../src/lib/driverDisplayIdentity";
import { Toaster, toast } from "sonner";
const Context = createContext<any>(null);
export const useSessionStore = () => useContext(Context);
export const useCompanyStore = () => useContext(Context);
export const useOperationalStore = () => useContext(Context);
const photo = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="teal"/></svg>');
const raw = { id: "driver519", name: "Nome Google", authPhotoURL: "https://lh3.googleusercontent.com/avatar", profilePhotoURL: "https://lh3.googleusercontent.com/avatar", approvedIdentityApplicationId: "app519", companyId: "company519", roles: ["driver"], status: "active" };
const form = { id: "app519", userId: raw.id, companyId: raw.companyId, status: "approved", fullName: "Nome Cadastro NVU", applicationPhotoURL: photo };
const member = (userId: string, roles = ["driver"]) => ({ userId, companyId: "company519", status: "active", roles });
function App() {
  const [present, setPresent] = useState(true);
  const [pending, setPending] = useState(false);
  const [edited, setEdited] = useState(false);
  const driver = { ...raw, ...(edited ? { name: "Nome Editado NVU", profileNameSource: "user_edit", profilePhotoSource: "user_edit", profilePhotoURL: "" } : {}),
    ...driverDisplayIdentity(edited ? { ...raw, name: "Nome Editado NVU", profileNameSource: "user_edit", profilePhotoSource: "user_edit", profilePhotoURL: "" } : raw, form),
    companyId: present ? "company519" : null, status: present ? "active" : "pending" };
  const remove = async () => {
    (window as any).qa519.calls++;
    await new Promise<void>((resolve, reject) => { (window as any).qa519.finish = (ok: boolean) => ok ? resolve() : reject(Error("refused")); });
    setPresent(false);
  };
  const approve = async () => {
    (window as any).qa519.approvals++;
    await new Promise<void>(resolve => { (window as any).qa519.approve = resolve; });
    setPending(false); setPresent(true);
  };
  (window as any).qa519 = { ...(window as any).qa519, edit: () => setEdited(true), reset: () => { setPresent(true); setPending(false); setEdited(false); }, pending: () => { setPresent(false); setPending(true); } };
  return <Context.Provider value={{ currentUser: { id: "owner519", name: "Gestor", role: "admin", companyId: "company519", status: "active", roles: ["admin"] },
    companies: [{ id: "company519", ownerId: "owner519" }], allCompanyMembersReady: true,
    activeCompanyId: "company519", allCompanyMembers: [member("owner519", ["admin"]), ...(present ? [member(raw.id)] : [])], users: [{ id: "owner519", name: "Gestor", status: "active", roles: ["admin"] }, driver], jobs: [], contracts: [],
    driverRequests: pending ? [{ id: "request519", motoristaId: raw.id, empresaId: "company519", status: "pending" }] : [],
    removeDriverFromFleet: remove, approveDriver: approve, rejectDriver: async () => {}, promoteDriverToAdmin: async () => {}, demoteAdminToDriver: async () => {}, createManualDriver: async () => {} }}><DriversTab/><Toaster/></Context.Provider>;
}
(window as any).qa519 = { calls: 0, approvals: 0 };
createRoot(document.getElementById("root")!).render(<BrowserRouter><App/></BrowserRouter>);
