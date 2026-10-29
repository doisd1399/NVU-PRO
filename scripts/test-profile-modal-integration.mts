import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { disableNetwork, terminate } from "firebase/firestore";
import { deleteApp, getApps } from "firebase/app";
import { execFileSync } from "node:child_process";

const dom = new JSDOM('<div id="root"></div>', { url: "http://127.0.0.1/driver/profile", pretendToBeVisual: true });
for (const name of ["window", "document", "localStorage", "sessionStorage", "CustomEvent", "Event", "navigator", "Image", "Element", "HTMLElement", "SVGElement", "Node", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) {
  Object.defineProperty(globalThis, name, { value: (dom.window as any)[name], configurable: true });
}
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const baseline = process.argv.includes("--baseline");
(window as any).matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
const noop = () => undefined;
window.scrollTo = noop;
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
    export const removeTripHistoryOptimistically=()=>{}, updateTripHistoryOptimistically=()=>{};`,
  "src/services/simpleAutomationCityService.ts": `export const getCachedSimpleAutomationCities=()=>[], loadSimpleAutomationCities=async()=>[];`,
  "src/services/workModeAvailabilityService.ts": `export const prefetchWorkModeAvailability=()=>{}, assertWorkModeEntryAllowed=async()=>{}, assertServerNewOperationAllowed=async()=>{};`,
  "src/lib/routePreload.ts": `export const preloadRoute=async()=>{}, preloadFleetPanel=async()=>{}, preloadRoleRoutes=async()=>{};`,
};
const outfile = path.resolve("node_modules/.cache/nvu-audit/profile-integration.mjs");
await fs.mkdir(path.dirname(outfile), { recursive: true });
await build({
  stdin: { contents: `export {default as Profile} from './src/pages/driver/Profile';
    export {default as Dashboard} from './src/pages/driver/Dashboard';
    export {putVehiclePhotoRecord,getVehiclePhotoRecord} from './src/services/vehiclePhotoStore';
    export {vehiclePhotoService} from './src/services/vehiclePhotoService';
    export {db} from './src/lib/firebase';
    export {handleSafeAppBack} from './src/lib/safeBackNavigation';
    export {vehiclePhotoKey} from './src/lib/vehiclePhotoIdentity';
    export {WorkspaceDock} from './src/components/WorkspaceDock';`, resolveDir: process.cwd(), loader: "ts" },
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
        return { contents: execFileSync("git", ["show", `df89bab2bdb9d325b51998bd818135701ba4b778:${relative}`], { encoding: "utf8" }), loader: "tsx" };
      }
      return replacement ? { contents: replacement, loader: "tsx" } : undefined;
    });
  } }],
});
const tested = await import(pathToFileURL(outfile).href);
await disableNetwork(tested.db);
tested.vehiclePhotoService.load = (identity: any) => tested.getVehiclePhotoRecord(identity);
tested.vehiclePhotoService.syncPending = async () => [];
const photo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOZkAAAAASUVORK5CYII=";
const identity = { userId: "profile-user", simulatorId: "gto", vehicleId: "scania-g", vehicleName: "Scania G" };
await tested.putVehiclePhotoRecord({ ...identity, key: tested.vehiclePhotoKey(identity), companyId: "company-a", revision: "photo-a",
  imageDataUrl: photo, posterDataUrl: photo, status: "pending", contentType: "image/png", updatedAt: Date.now() });
let root = createRoot(document.getElementById("root")!);
let observedLocation: any;
let routeNavigate: ReturnType<typeof useNavigate>;
function RouteObserver() {
  observedLocation = useLocation();
  routeNavigate = useNavigate();
  return null;
}
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
// Flush React between animation frames; one long async act can batch the exit
// completion until its deadline and make a correct native Back look flaky.
const waitForSummaryExit = async () => {
  for (let frame = 0; frame < 80 && document.querySelector('[role="dialog"][id]'); frame++) await flush();
};
const render = async (Component = tested.Profile) => {
  await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: ["/driver/profile"] },
    React.createElement(React.Fragment, null, React.createElement(RouteObserver), React.createElement(Component),
      React.createElement(tested.WorkspaceDock, { role: "driver" })))));
  await flush();
};
const button = (text: string) => [...document.querySelectorAll("button")].find(element =>
  element.textContent?.trim() === text || element.getAttribute("aria-label") === text || element.title === text)!;
await render();
assert.ok(!document.body.textContent?.includes("Algo deu errado"));
const cardPhoto = document.querySelector('button[aria-label="Substituir foto do veículo"] img') as HTMLImageElement;
assert.equal(cardPhoto?.src, photo, "real integrated vehicle card has the local photo");
if (!baseline) {
  const dock = document.querySelector('nav[aria-label="Navegação do motorista"]')!;
  assert.deepEqual([...dock.querySelectorAll("button")].map(item => item.getAttribute("aria-label")),
    ["Trabalho", "Atividade", "Resultados", "NVU News", "Ranking", "Perfil"]);
  const info = document.querySelector('button[aria-label="Informações da operação em andamento"]') as HTMLButtonElement;
  assert.ok(info.parentElement === cardPhoto.closest("button")?.parentElement, "Info belongs to the vehicle photograph, never the driver banner");
  assert.ok(info.closest("button") !== cardPhoto.closest("button"), "Info and photo-upload controls are independent");
  let uploadOpened = false;
  const fileInput = document.querySelector('input[type="file"][accept="image/*"]') as HTMLInputElement;
  fileInput.click = () => { uploadOpened = true; };
  info.focus();
  await act(async () => info.click());
  await flush();
  const summary = document.querySelector('[role="dialog"][id]')!;
  assert.ok(summary.textContent?.includes("Operação em andamento"));
  assert.ok(summary.textContent?.includes("Empresa A"));
  assert.ok(summary.textContent?.includes("Scania G"));
  assert.ok(summary.textContent?.includes("Número de viagens:"));
  assert.ok(summary.textContent?.includes("Total de ganhos:"));
  assert.ok(summary.textContent?.includes("Prazo limite:"));
  assert.equal(uploadOpened, false, "Opening operation data must not trigger image upload");
  await act(async () => tested.handleSafeAppBack());
  await waitForSummaryExit();
  assert.ok(document.querySelector('[role="dialog"][id]') === null, "Native Back dismisses the summary");
  assert.equal(observedLocation.pathname, "/driver/profile");
  assert.ok(document.activeElement === info, "Closing restores the info control's focus");
  await act(async () => info.click());
  fixture.company.companies = [{ ...fixture.company.companies[0], companyName: "Empresa A atualizada" }];
  await render();
  assert.ok(document.querySelector('[role="dialog"][id]')?.textContent?.includes("Empresa A atualizada"), "Open modal follows the same company's live data");
  await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await waitForSummaryExit();
  assert.ok(document.querySelector('[role="dialog"][id]') === null, "Escape also closes the summary");
  await act(async () => info.click());
  fixture.operational.jobs = fixture.operational.jobs.map((job: any) => ({ ...job, id: "replacement-job" }));
  await render();
  assert.ok(document.querySelector('[role="dialog"][id]') === null, "A replaced operation never inherits an open summary");
  await act(async () => button("Atividade").click());
  await act(async () => button("NVU News").click());
  assert.equal(observedLocation.pathname, "/driver/news", "News dock entry commits the actual application route");
  await act(async () => routeNavigate(-1));
  assert.equal(observedLocation.state?.profileTab, "activity", "Back restores the prior workspace view");
  const rankingOrigin = observedLocation;
  await act(async () => button("Ranking").click());
  assert.equal(observedLocation.pathname, "/ranking");
  assert.deepEqual(observedLocation.state?.backgroundLocation, rankingOrigin, "Ranking retains the workspace beneath its existing overlay route");
  await act(async () => routeNavigate(-1));
  await act(async () => button("Trabalho").click());
  fixture.company.companies = [{ ...fixture.company.companies[0], companyName: "Empresa A" }];
  fixture.operational.jobs = fixture.operational.jobs.map((job: any) => ({ ...job, id: "job-a" }));
  await render();
  console.log("PASS dock and live operation modal: six destinations, vehicle-photo control, independent upload, company updates, Android Back/Escape/focus, assignment replacement, News route and Ranking overlay/back state.");
}
await act(async () => button("Iniciar trabalho").click());
await flush();
const modalPhoto = document.querySelector('[data-testid="work-mode-vehicle-card"] img') as HTMLImageElement;
if (baseline) {
  assert.equal(modalPhoto, null, "443 reproduces the missing photo in the real Profile modal");
  console.log("BASELINE 443 REPRODUCED: integrated Dashboard displays the photo; Profile's Iniciar trabalho modal has no vehicle image.");
} else {
  assert.equal(modalPhoto?.src, cardPhoto.src, "Profile modal uses exactly the integrated card's local bytes");
  const printButton = [...document.querySelectorAll("button")].find(element => element.textContent?.trim().startsWith("Modo print"))!;
  assert.ok(modalPhoto.compareDocumentPosition(printButton) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  await act(async () => (document.querySelector('button[aria-label="Fechar"]') as HTMLElement).click());
  await act(async () => button("Iniciar trabalho").click());
  assert.equal(document.querySelector('[data-testid="work-mode-vehicle-card"] img')?.getAttribute("src"), photo);
  fixture.operational.jobs = fixture.operational.jobs.map((job: any) => ({ ...job, id: "future-operation-same-vehicle" }));
  await render();
  assert.equal(document.querySelector('[data-testid="work-mode-vehicle-card"] img')?.getAttribute("src"), photo, "future assignment reuses the user's saved vehicle photo");
  fixture.session.currentUser = { ...fixture.session.currentUser, id: "another-user" };
  fixture.operational.jobs = fixture.operational.jobs.map((job: any) => ({ ...job, driverId: "another-user" }));
  await render();
  assert.equal(document.querySelector('[data-testid="work-mode-vehicle-card"] img'), null, "no photo leaks to another account");
  fixture.session.currentUser = { ...fixture.session.currentUser, id: "profile-user" };
  fixture.operational.jobs = fixture.operational.jobs.map((job: any) => ({ ...job, driverId: "profile-user" }));
  fixture.company.companies = [{ ...fixture.company.companies[0], simulatorId: "ets2", simulatorName: "ETS2" }];
  await render();
  assert.equal(document.querySelector('[data-testid="work-mode-vehicle-card"] img'), null, "no photo leaks to another simulator");
  fixture.company.companies = [{ ...fixture.company.companies[0], simulatorId: "gto", simulatorName: "GTO" }];
  await act(async () => root.unmount());
  root = createRoot(document.getElementById("root")!);
  localStorage.clear();
  await render();
  await act(async () => button("Iniciar trabalho").click());
  assert.equal(document.querySelector('[data-testid="work-mode-vehicle-card"] img')?.getAttribute("src"), photo, "fresh Profile root restores full IndexedDB bytes without posters/network");
  await act(async () => root.unmount());
  root = createRoot(document.getElementById("root")!);
  await render(tested.Dashboard);
  await act(async () => button("Iniciar trabalho").click());
  assert.equal(document.querySelector('[data-testid="work-mode-vehicle-card"] img')?.getAttribute("src"), photo, "standalone Dashboard caller also remains functional");
  console.log("PASS real Profile + Dashboard: actual buttons in both callers, local image before Print, shared bytes, close/reopen, future assignment, account/simulator isolation and fresh-root offline rehydration.");
}
await act(async () => root.unmount());
await terminate(tested.db);
await Promise.all(getApps().map(app => deleteApp(app)));
dom.window.close();
