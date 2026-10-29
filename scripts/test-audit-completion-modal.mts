import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { disableNetwork, terminate } from "firebase/firestore";
import { deleteApp, getApps } from "firebase/app";
import { execFileSync } from "node:child_process";

const dom = new JSDOM('<div id="root"></div>', { url: "http://127.0.0.1/driver/profile", pretendToBeVisual: true });
for (const name of ["window", "document", "localStorage", "sessionStorage", "CustomEvent", "Event", "navigator", "Image", "HTMLElement", "Element", "SVGElement", "requestAnimationFrame", "cancelAnimationFrame"]) {
  Object.defineProperty(globalThis, name, { value: (dom.window as any)[name], configurable: true });
}
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const baseline = process.argv.includes("--baseline");
(window as any).matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
const noop = () => undefined;
const fixture: any = {
  session: { currentUser: { id: "profile-user", name: "Motorista", role: "driver", memberships: {}, isOnline: true },
    authInitialized: true, sessionUiReady: true, activeRole: "driver", setCurrentUser: noop },
  company: { activeCompanyId: "company-a", companies: [{ id: "company-a", companyName: "Empresa A", simulatorId: "gto", simulatorName: "GTO" }],
    memberships: [], allCompanyMembers: [], allCompanies: [], companiesLoading: false, companyCatalogLoaded: true,
    companyCatalogAttempted: true, driverRequests: [], setActiveCompanyId: noop, loadCompanyCatalog: noop },
  operational: { jobs: [{ id: "job-a", driverId: "profile-user", companyId: "company-a", contractId: "contract-a", vehicleId: "scania-g", progress: 6, status: "active" }],
    contracts: [{ id: "contract-a", name: "BLS - 120", companyId: "company-a", simulatorId: "gto", totalDeliveries: 10, status: "active", deliveries: [] }],
    vehicles: [{ id: "scania-g", name: "Scania G", companyId: "company-a" }], trailers: [], users: [], simulators: [],
    jobsReady: true, contractsReady: true, updateUserOnlineStatus: noop, requestNewJobDemand: noop },
  trips: { trips: [], loading: false, historyReady: true, refreshing: false, coverage: "complete", readCoverage: null, error: null },
};
(globalThis as any).__NVU_PROFILE_FIXTURE__ = fixture;
// Compile the real route and its real integrated Dashboard. Only store boundaries
// and network/preload transports are injected; neither modal caller is replaced.
const mocks: Record<string, string> = {
  "src/context/AppContext.tsx": `const fixture=()=>globalThis.__NVU_PROFILE_FIXTURE__;
    export const useSessionStore=()=>fixture().session, useOperationalStore=()=>fixture().operational,
    useActivityStore=()=>({jobDemands:[]}), useRankingFilterStore=()=>({}), useApp=()=>({...fixture().session,...fixture().operational,...fixture().company});`,
  "src/context/CompanyContext.tsx": `export const useCompanyStore=()=>globalThis.__NVU_PROFILE_FIXTURE__.company;`,
  "src/hooks/useDriverTrips.ts": `export const useDriverTrips=()=>globalThis.__NVU_PROFILE_FIXTURE__.trips;
    export const publishDriverTripOptimistically=()=>{}, removeDriverTripOptimistically=()=>{};`,
  "src/hooks/useTripHistory.ts": `export const useTripHistory=()=>({...globalThis.__NVU_PROFILE_FIXTURE__.trips,historicoTrips:[],historicoTripsLoading:false,serverConfirmed:true});
    export const removeTripHistoryOptimistically=()=>{}, updateTripHistoryOptimistically=()=>{}, publishTripHistoryOptimistically=()=>{};`,
  "src/services/simpleAutomationCityService.ts": `export const getCachedSimpleAutomationCities=()=>[], loadSimpleAutomationCities=async()=>[];`,
  "src/services/workModeAvailabilityService.ts": `export const prefetchWorkModeAvailability=()=>{}, assertWorkModeEntryAllowed=async()=>{}, assertServerNewOperationAllowed=async()=>{};`,
  "src/lib/routePreload.ts": `export const preloadRoute=async()=>{}, preloadFleetPanel=async()=>{}, preloadRoleRoutes=async()=>{};`,
};
const outfile = path.resolve(`node_modules/.cache/nvu-audit/audit-504-modal-integration.mjs`);
await fs.mkdir(path.dirname(outfile), { recursive: true });
await build({
  stdin: { contents: `export {default as Profile} from './src/pages/driver/Profile';
    export {default as Dashboard} from './src/pages/driver/Dashboard';
    export {putVehiclePhotoRecord,getVehiclePhotoRecord} from './src/services/vehiclePhotoStore';
    export {vehiclePhotoService} from './src/services/vehiclePhotoService';
    export {presentConfirmedOperationResult} from './src/services/operationCompletionPresentation';
    export {db} from './src/lib/firebase';
    export {vehiclePhotoKey} from './src/lib/vehiclePhotoIdentity';
    export {completeTripWithCoordinator,getOperationalCompletionInFlightCount} from './src/services/operationalCompletionCoordinator';
    export {operationReconciliationService} from './src/services/operationReconciliationService';
    export {canonicalTripRepository} from './src/repositories/CanonicalTripRepository';
    export {writeActiveOperationSnapshot,readActiveOperationSnapshot} from './src/lib/activeOperationSnapshot';
    export {emitCanonicalTripUpdated} from './src/lib/CanonicalTripUpdateEvent';`, resolveDir: process.cwd(), loader: "ts" },
  outfile, bundle: true, format: "esm", platform: "node", packages: "external", jsx: "automatic",
  define: { "import.meta.env": JSON.stringify({ VITE_FIREBASE_PROJECT_ID: "demo-nvu-v36-4-staging", VITE_USE_FIREBASE_EMULATORS: "true" }) },
  loader: { ".css": "empty", ".svg": "dataurl" },
  plugins: [{ name: "isolated-transport-fixtures", setup(builder) {
    builder.onResolve({ filter: /\.css$/ }, ({ path: file }) => ({ path: file, namespace: "empty-css" }));
    builder.onLoad({ filter: /.*/, namespace: "empty-css" }, () => ({ contents: "", loader: "js" }));
    builder.onLoad({ filter: /\/src\/.*\.[tj]sx?$/ }, async ({ path: file }) => {
      const relative = path.relative(process.cwd(), file);
      const replacement = mocks[relative];
      if (!replacement && baseline && ["src/pages/driver/Profile.tsx", "src/pages/driver/Dashboard.tsx", "src/hooks/useVehiclePhoto.ts"].includes(relative)) {
        return { contents: execFileSync("git", ["show", `cc3b7bc8cccf6af89a392cf4665096757c4690cb:${relative}`], { encoding: "utf8" }), loader: "tsx" };
      }
      return replacement ? { contents: replacement, loader: "tsx" } : undefined;
    });
  } }],
});
const tested = await import(pathToFileURL(outfile).href);
await disableNetwork(tested.db);
tested.vehiclePhotoService.load = (identity: any) => tested.getVehiclePhotoRecord(identity);
tested.vehiclePhotoService.syncPending = async () => [];

let root = createRoot(document.getElementById("root")!);
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
const render = async () => {
  await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: ["/driver"] }, React.createElement(tested.Dashboard))));
  await flush();
};
const button = (label: string) => [...document.querySelectorAll("button")].find(value => value.textContent?.trim() === label)!;
const createdAt = "2026-09-27T10:00:00.000Z";
const job: any = { ...fixture.operational.jobs[0], totalDeliveries: 2, progress: 2, createdAt, assignedAt: createdAt,
  dueAt: "2026-10-30T10:00:00Z", contractNameSnapshot: "BLS - 120" };
const trip = (id: string, patch = {}) => ({ id, canonicalTripId: id, tripId: id, idempotencyKey: id,
  jobId: job.id, operationId: job.id, driverId: job.driverId, companyId: job.companyId, contractId: job.contractId,
  simulatorId: "gto", source: "gto_auto", status: "SERVER_CONFIRMED", recordStatus: "concluida",
  createdAt, completedAt: new Date().toISOString(), serverValidatedAt: new Date().toISOString(), uploadedAt: new Date().toISOString(),
  origem: "Agro Grão", destino: "Lages", valorCents: 2491700, currency: "BRL", ...patch });
fixture.operational.jobs = [job];
fixture.operational.contracts = [];
fixture.trips.trips = [trip("first"), trip("second")];

let finishCalls=0;
fixture.operational.finishJob=async()=>{finishCalls++;return {pendingSync:true,completed:false,status:"pending_sync",progress:2,total:2};};
try {
 await render();
 assert.ok(button("Finalizar Operação"));
 await act(async()=>button("Finalizar Operação").click());await flush();
 assert.equal(finishCalls,1);assert.equal(Boolean(document.querySelector('[role="dialog"]')),false);
 fixture.operational.jobs=[{...job,status:"completed",completedAt:new Date().toISOString()}];
 await act(async()=>tested.presentConfirmedOperationResult({uid:job.driverId,companyId:job.companyId,
 entries:[{id:'finish:'+job.id,actorId:job.driverId,companyId:job.companyId,jobId:job.id,kind:'finish',state:'CONFIRMED',createdAt:Date.now(),
 result:{completed:true,job:fixture.operational.jobs[0]}}],contracts:fixture.operational.contracts,trips:fixture.trips.trips,acknowledge:()=>{}}));
 await render();await flush();
 assert.ok(document.querySelector('[data-testid="driver-idle-panel"]'));
 assert.equal(Boolean(document.querySelector('[role="dialog"]')),true);
 const app=await fs.readFile('src/context/AppContext.tsx','utf8');
 const finish=app.slice(app.indexOf('const finishJob ='),app.indexOf('const finishJob =')+3000);
 assert.match(finish,/pendingSync: true, completed: false/);
 console.log('PASS C01: real Dashboard + queued finish + later confirmed outbox presentation = result modal');
 await fs.writeFile('reports/audit-modal-regression.json',JSON.stringify({id:'C01',result:'PASS',realComponent:'Dashboard',finishBoundary:'matches AppContext durable outbox response',laterJobStatus:'completed',completedCard:true,resultModal:true,productionAccess:false},null,2)+'\n');
} finally {
 await act(async()=>root.unmount());
 await Promise.all(getApps().map(deleteApp));
 dom.window.close();
}
