import React, {useSyncExternalStore} from "react";
const subscribers = new Set<() => void>();
let version = 0;
export function publish() { version++; subscribers.forEach(fn=>fn()); }
function useFixture() {useSyncExternalStore(fn=>{subscribers.add(fn);return()=>subscribers.delete(fn);},()=>version);}
export const ports = { viewer: "admin-a", companyId: "dc", queries: [] as any[], rows: [] as any[], error: null as any,
  pending: [] as any[], listeners: new Set<any>(), deferred: null as any, actions: 0 };
export const auth = { currentUser: { uid: "admin-a" } }, db = {}, storage = {};
const noop = async () => { ports.actions++; };
const companies = ["dc", "second"].map(id => ({id,companyName:id,ownerId:"admin-a",status:"active",recruitmentSettings:{}}));
export const useSessionStore = () => {useFixture(); return { currentUser: { id: ports.viewer } };};
export const useOperationalStore = () => ({ users: [] });
export const useCompanyStore = () => {useFixture(); return { activeCompanyId: ports.companyId, companies, recruitmentApplications: ports.pending,
  updateRecruitmentSettings: noop, approveRecruitmentApplication: noop, rejectRecruitmentApplication: noop, deleteRecruitmentApplication: noop };};
export const resolveNotifications = async () => {};
export const StableImage = ({fallback}: any) => <span>{fallback}</span>;
export const ref = () => ({}), getDownloadURL = async () => "";
export const collection = (_db: unknown, name: string) => ({collection: name});
export const doc = (_db: unknown, ...path: string[]) => ({path: path.join("/")});
export const documentId = () => "__name__";
export const where = (field: string, operator: string, value: unknown) => ({type:"where",field,operator,value});
export const orderBy = (...args: unknown[]) => ({type:"orderBy",args});
export const limit = (value: number) => ({type:"limit",value});
export const startAfter = (...value: unknown[]) => ({type:"startAfter",value});
export const or = (...value: unknown[]) => ({type:"or",value});
export const query = (ref: any, ...constraints: any[]) => ({...ref,constraints});
export const snapshot = (rows: any[], fromCache = false) => ({ metadata:{fromCache,hasPendingWrites:false}, size:rows.length,
  docs: rows.map(row => ({id:row.id,data:()=>row})), empty:!rows.length });
export const getDocsFromServer = async (ref: any) => {
  ports.queries.push(ref); if (ports.deferred) return ports.deferred;
  if (ports.error) throw ports.error;
  return snapshot(ports.rows);
};
export const getDocs = getDocsFromServer;
export const getDocFromServer = async () => ({exists:()=>false});
export const getDoc = getDocFromServer;
export const onSnapshot = (ref: any, options: any, callback?: any, error?: any) => {
  if (typeof options === "function") { error=callback; callback=options; }
  const entry = {ref,callback,error}; ports.listeners.add(entry);
  return () => ports.listeners.delete(entry);
};
