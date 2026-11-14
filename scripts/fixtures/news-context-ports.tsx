import React from "react";

export const ports = {
  session: {} as any,
  company: {} as any,
  simulators: [] as any[],
  captured: null as any,
  queries: [] as any[],
  warmup: false,
  readResult: null as any,
  readError: null as any,
  listeners: new Set<any>(),
};
export const useSessionStore = () => ports.session;
export const useCompanyStore = () => ports.company;
export const useOperationalStore = () => ({ simulators: ports.simulators });
export const db = {};
export const preloadImages = () => {};
export const getRuntimePerformanceProfile = () => ({ allowSecondaryRouteWarmup: ports.warmup });
export default function CaptureNews(props: any) {
  ports.captured = props;
  return <output>{props.selectedSimulator}</output>;
}
export const StableImage = ({ fallback, wrapperClassName }: any) => <span className={wrapperClassName}>{fallback}</span>;

export const collection = (_db: unknown, name: string) => ({ collection: name });
export const doc = (_db: unknown, ...path: string[]) => ({ path: path.join("/") });
export const where = (field: string, operator: string, value: unknown) => ({ type: "where", field, operator, value });
export const orderBy = (...args: unknown[]) => ({ type: "orderBy", args });
export const limit = (value: number) => ({ type: "limit", value });
export const startAfter = (value: unknown) => ({ type: "startAfter", value });
export const query = (ref: any, ...constraints: any[]) => ({ ...ref, constraints });
export const getDocs = async (ref: any) => {
  ports.queries.push({ ...ref, method: "getDocs" });
  if (ports.readError) throw ports.readError;
  return ports.readResult || { docs: [], size: 0, empty: true };
};
export const getDocsFromServer = getDocs;
export const onSnapshot = (ref: any, options: any, callback?: (value: any) => void) => {
  if (typeof options === "function") callback = options;
  ports.queries.push({ ...ref, method: "onSnapshot" });
  ports.listeners.add(callback);
  return () => { ports.listeners.delete(callback); };
};
export const getDoc = async () => ({ exists: () => false });
export const getCountFromServer = async () => ({ data: () => ({ count: 0 }) });
export const setDoc = async () => {};
export const serverTimestamp = () => ({});
export const Timestamp = { fromMillis: (value: number) => ({ toMillis: () => value }) };
