type Callback = (...args: any[]) => void;
export const reads: any[] = [];
export const auth = { currentUser: { uid: "viewer", getIdToken: async () => "token" } as any };
export const db = {};
export function onCanonicalTripUpdated(callback: Callback) { const handler=(event: Event)=>callback((event as CustomEvent).detail);window.addEventListener('nvu:canonical-trip-updated',handler);return()=>window.removeEventListener('nvu:canonical-trip-updated',handler); }
export const tokens = new Set<Callback>();
export function onIdTokenChanged(_auth: unknown, callback: Callback) { tokens.add(callback); queueMicrotask(() => callback(auth.currentUser)); return () => tokens.delete(callback); }
export const goalState = { directDenied: false, managedError: "", amount: 100000, delay: null as Promise<unknown> | null, calls: [] as any[], directStarts: 0, writes: 0 };
export const doc = (_db: unknown, collection: string, id: string) => ({ collection, id });
export const serverTimestamp = () => "timestamp";
export function onSnapshot(_ref: unknown, _options: unknown, onData: Callback, onError: Callback) {
  goalState.directStarts++; let active = true;
  queueMicrotask(() => { if (active) goalState.directDenied ? onError({code:"permission-denied"}) : onData({exists:()=>true,metadata:{fromCache:false},data:()=>({targetAmount:goalState.amount})}); });
  return () => { active = false; };
}
export async function setDoc(_ref: unknown, data: any) { if (goalState.directDenied) throw {code:"permission-denied"}; goalState.writes++; goalState.amount=data.targetAmount; }
export async function accessManagedGoal(scope: any, documentId: string, amount?: number) {
  goalState.calls.push({scope,documentId,amount});
  if (goalState.delay) await goalState.delay;
  if (goalState.managedError) throw {code:goalState.managedError};
  if (amount !== undefined) { goalState.writes++; goalState.amount=amount; }
  return {...scope,periodKey:"range:2026-10-01:2026-10-31",targetAmount:goalState.amount,exists:true};
}
export class CanonicalTripQueryService {
  static listenCompanyTrips(companyId: string, data: Callback, error: Callback, coverage: Callback, owners: string[]) { const entry={kind:"company",companyId,data,error,coverage,owners,active:true};reads.push(entry);return()=>{entry.active=false;}; }
  static listenDriverTrips(driverId: string, data: Callback, error: Callback, remote: Callback, coverage: Callback) { const entry={kind:"driver",driverId,data,error,remote,coverage,active:true};reads.push(entry);return()=>{entry.active=false;}; }
}
