import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
let release!: () => void;
const finish = new Promise<void>(resolve => { release = resolve; });
const qa = (globalThis as any).__supervisor520 = {
  sends: 0, finishing: false, teardown: false,
  engine: { synchronize: async () => { qa.sends++; return { synchronized: 0, results: [] }; }, getPending: () => [] },
  operationOutbox: { pending: () => [], synchronize: async (kind: string) => { if (kind === "finish") { qa.finishing = true; await finish; } } },
};
const win = Object.assign(new EventTarget(), { setInterval: () => 0 });
Object.defineProperty(globalThis, "window", { value: win, configurable: true });
Object.defineProperty(globalThis, "document", { value: new EventTarget(), configurable: true });
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
const result = await build({ stdin: { contents: 'export {SyncManager} from "./src/services/syncManager";', resolveDir: process.cwd() }, bundle: true, platform: "node", format: "esm", write: false, plugins: [{ name: "slow-finish-boundary", setup(b) {
  b.onResolve({ filter: /^firebase\/auth$/ }, () => ({ path: "auth", namespace: "qa" }));
  b.onLoad({ filter: /.*/, namespace: "qa" }, () => ({ contents: "export const onAuthStateChanged=()=>()=>{};" }));
  b.onLoad({ filter: /src\/lib\/firebase\.ts$/ }, () => ({ contents: 'export const auth={currentUser:{uid:"driver"}}; export const db={};export const functions={};' }));
  b.onLoad({ filter: /src\/lib\/authLifecycle\.ts$/ }, () => ({ contents: 'export const isAuthTeardownActive=()=>globalThis.__supervisor520.teardown;export const onAuthTeardown=()=>()=>{};' }));
  b.onLoad({ filter: /src\/lib\/tripTombstones\.ts$/ }, () => ({ contents: 'export const isTripTombstoned=()=>false;' }));
  b.onLoad({ filter: /src\/lib\/CanonicalTripUpdateEvent\.ts$/ }, () => ({ contents: 'export const CANONICAL_TRIP_UPDATED="canonical-updated";' }));
  b.onLoad({ filter: /src\/services\/offline\/OfflineDatabase\.ts$/ }, () => ({ contents: 'export class OfflineDatabase { static storageKey="qa-journal"; }' }));
  b.onLoad({ filter: /src\/services\/sync\/SyncEngine\.ts$/ }, () => ({ contents: "export const syncEngine=globalThis.__supervisor520.engine;" }));
  b.onLoad({ filter: /src\/services\/operationOutbox\.ts$/ }, () => ({ contents: 'export const operationOutbox=globalThis.__supervisor520.operationOutbox;export const OPERATION_OUTBOX_CHANGED="operation-change";export const reconcileOperationOutboxNativeState=async()=>{};export const setOperationPendingTripReader=()=>{};' }));
  b.onLoad({ filter: /src\/lib\/offlineTripQueue\.ts$/ }, () => ({ contents: 'export const getOfflineTrips=()=>[];export const removeOfflineTrip=()=>{};export const markOfflineTripFailed=()=>{};export const setOfflineTripStatus=()=>{};export const recoverInterruptedOfflineTrips=()=>{};export const retryOfflineTrip=()=>false;' }));
  b.onLoad({ filter: /src\/application\/trip\/TripRegistrationService\.ts$/ }, () => ({ contents: 'export const TripRegistrationService={register:t=>t};' }));
} }] });
const file = path.resolve("verification/release-520/supervisor-isolated.mjs");
fs.writeFileSync(file, result.outputFiles[0].text);
const { SyncManager } = await import(file);
SyncManager.initialize();
for (let i = 0; i < 100 && !qa.finishing; i++) await new Promise(resolve => setTimeout(resolve, 1));
assert(qa.finishing); assert.equal(qa.sends, 1);
win.dispatchEvent(new Event("nvu-canonical-trip-queued"));
assert.equal(qa.sends, 2, "New receipt must start while old finish is still blocked");
release(); await SyncManager.syncPendingTrips();
const before = qa.sends; qa.teardown = true;
win.dispatchEvent(new Event("nvu-canonical-trip-queued"));
assert.equal(qa.sends, before, "Auth teardown still blocks all sends");
fs.mkdirSync("reports/release-520", { recursive: true });
fs.writeFileSync("reports/release-520/supervisor-tests.json", JSON.stringify({ checks: ["Fresh canonical command bypasses another operation's blocked finish", "Auth teardown still blocks new sends"], method: "Actual SyncManager bundled with controlled operation/transport boundaries." }, null, 2));
console.log("SYNC_SUPERVISOR_520_PASS 2");
