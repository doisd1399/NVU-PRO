// Test-only ports. Production Firebase is never initialized by this harness.
import { useSyncExternalStore } from "react";
const listeners = new Set<() => void>();
let version = 0;
export const state: any = { uid: "driver-476", role: "driver", companyId: "company-476", jobs: [] };
export const auth: any = { currentUser: { uid: state.uid } };
export const db = {}, functions = {};
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const useVersion = () => useSyncExternalStore(subscribe, () => version, () => version);
export function changeState(patch: any) {
  Object.assign(state, patch); auth.currentUser = { uid: state.uid };
  version++; listeners.forEach(fn => fn());
}
export function useSessionStore() { useVersion(); return { currentUser: { id: state.uid }, activeRole: state.role }; }
export function useOperationalStore() { useVersion(); return { jobs: state.jobs }; }
export function useCompanyStore() {
  useVersion(); return { activeCompanyId: state.companyId, companies: [{ id: state.companyId, simulatorId: "gto", automaticQueuesConfigured: true }] };
}
let transport: (name: string, input: any) => Promise<any> = async () => { throw Error("Set isolated callable fixture"); };
export const setTransport = (fn: typeof transport) => { transport = fn; };
export const httpsCallable = (_functions: any, name: string) => async (input: any) => ({ data: await transport(name, input) });
const signals = new Set<(snapshot: any) => void>();
export const doc = (..._args: any[]) => ({});
export const getDoc = async () => { throw Error("Unplanned Firestore read in local test"); };
export const getDocFromServer = getDoc;
export const onSnapshot = (_ref: any, fn: (snapshot: any) => void) => { signals.add(fn); return () => { signals.delete(fn); }; };
export const emitSignal = (revision: number) => signals.forEach(fn => fn({ data: () => ({ revision }) }));
export const signalListeners = () => signals.size;
export const automaticQueueScope = (...parts: string[]) => parts.every(Boolean) ? JSON.stringify(parts) : "";
let cacheWriter: (...args: any[]) => Promise<boolean> = async () => true;
let cacheReader: (...args: any[]) => Promise<any> = async () => null;
export const setCacheWriter = (fn: typeof cacheWriter) => { cacheWriter = fn; };
export const setCacheReader = (fn: typeof cacheReader) => { cacheReader = fn; };
export const writeOperationalQueueCache = (...args: any[]) => cacheWriter(...args);
export const readOperationalQueueCache = (...args: any[]) => cacheReader(...args);
export const firebaseTripSyncAdapter = { push: async () => { throw Error("Default sender is disabled in local tests"); } };
export class TripReconciliationService { async reconcileConfirmedTrip(_trip: any) {} }
