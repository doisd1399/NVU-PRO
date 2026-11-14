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
for (const name of ["window", "document", "localStorage", "sessionStorage", "CustomEvent", "Event", "navigator", "Image", "HTMLElement", "requestAnimationFrame", "cancelAnimationFrame"]) {
  Object.defineProperty(globalThis, name, { value: (dom.window as any)[name], configurable: true });
}
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
// JSDOM has no layout engine; these tests assert lifecycle/content, while
// the Chromium suite verifies actual viewport geometry and hit testing.
(dom.window.Range.prototype as any).getBoundingClientRect ||= () => new dom.window.DOMRect();
const hasPreviousWork = () => Number(document.querySelector('[data-testid="driver-previous-work"] .nvu-idle-history-count')?.textContent || 0) > 0;
const openPreviousWork = async () => {
  const toggle = document.querySelector('[data-testid="driver-previous-work"] > button') as HTMLElement | null;
  if (toggle?.getAttribute("aria-expanded") !== "true") await act(async () => toggle?.click());
};

const baseline = process.argv.includes("--baseline-445");
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
    useActivityStore=()=>({jobDemands:[]}), useRankingFilterStore=()=>({globalPeriodPreset:"week",setGlobalPeriodPreset:()=>{},globalStartDateStr:"2026-10-01",globalEndDateStr:"2026-10-10"}), useApp=()=>({...fixture().session,...fixture().operational,...fixture().company});`,
  "src/context/CompanyContext.tsx": `export const useCompanyStore=()=>globalThis.__NVU_PROFILE_FIXTURE__.company;`,
  "src/hooks/useDriverTrips.ts": `export const useDriverTrips=()=>globalThis.__NVU_PROFILE_FIXTURE__.trips;
    export const publishDriverTripOptimistically=()=>{}, removeDriverTripOptimistically=()=>{};`,
  "src/hooks/useTripHistory.ts": `export const useTripHistory=()=>({...globalThis.__NVU_PROFILE_FIXTURE__.trips,historicoTrips:globalThis.__NVU_PROFILE_FIXTURE__.trips.trips,historicoTripsLoading:false,serverConfirmed:true});
    export const removeTripHistoryOptimistically=()=>{}, updateTripHistoryOptimistically=()=>{}, publishTripHistoryOptimistically=()=>{};`,
  "src/services/simpleAutomationCityService.ts": `export const getCachedSimpleAutomationCities=()=>[], loadSimpleAutomationCities=async()=>[];`,
  "src/services/workModeAvailabilityService.ts": `export const prefetchWorkModeAvailability=()=>{}, assertWorkModeEntryAllowed=async()=>{}, assertServerNewOperationAllowed=async()=>{};`,
  "src/lib/routePreload.ts": `export const preloadRoute=async()=>{}, preloadFleetPanel=async()=>{}, preloadRoleRoutes=async()=>{};`,
};
const outfile = path.resolve(`node_modules/.cache/nvu-audit/multi-operation-ui-446${baseline ? "-baseline" : ""}-${Date.now()}.mjs`);
await fs.mkdir(path.dirname(outfile), { recursive: true });
await build({
  stdin: { contents: `export {default as Profile} from './src/pages/driver/Profile';
    export {default as Dashboard} from './src/pages/driver/Dashboard';
    export {default as CompanyOperationsTab} from './src/pages/admin/fleet/OperationsTab';
    export {default as RecordTrip} from './src/pages/driver/RecordTrip';
    export {putVehiclePhotoRecord,getVehiclePhotoRecord} from './src/services/vehiclePhotoStore';
    export {vehiclePhotoService} from './src/services/vehiclePhotoService';
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
      if (!replacement && baseline && ["src/pages/driver/Profile.tsx", "src/pages/driver/Dashboard.tsx", "src/lib/currentOperation.ts", "src/lib/fleetUsage.ts", "src/pages/admin/fleet/OperationsTab.tsx"].includes(relative)) {
        return { contents: execFileSync("git", ["show", `81426ea4539abfc78739bbd7db23b16cece83d09:${relative}`], { encoding: "utf8" }), loader: "tsx" };
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
const render = async (component = tested.Dashboard) => {
  const route = component === tested.RecordTrip ? "/driver/record-trip?mode=print" : "/driver";
  await act(async () => root.render(React.createElement(MemoryRouter, { key: route, initialEntries: [route] }, React.createElement(component))));
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
let finishCalls = 0;
fixture.operational.finishJob = async () => { finishCalls++; throw new Error("TEST_NETWORK_FAILURE"); };
const originalConsoleError = console.error;
const handledErrors: unknown[] = [];
console.error = (...values) => { handledErrors.push(values); };
try {
  console.log("multi-operation: BLS120 vs June legacy and BLS10 history");
  const current = { ...job, id: "october-bls120", operationId: "october-bls120", status: "awaiting_completion",
    contractNameSnapshot: "BLS - 120", totalDeliveries: 10, progress: 10,
    assignedAt: { seconds: Date.parse("2026-10-01T10:00:00Z") / 1000 }, createdAt: "2026-10-01T10:00:00Z",
    dueAt: "2026-10-07T10:00:00Z", deadlineDate: "2026-10-07T10:00:00Z", trailerId: "rodotrem" };
  const legacy = { ...job, id: "june-legacy", operationId: "june-legacy", status: "active", contractId: "removed-contract",
    contractNameSnapshot: undefined, totalDeliveries: 0, progress: 0, assignedAt: "2026-06-29T10:00:00Z",
    createdAt: "2026-06-29T10:00:00Z", updatedAt: "2026-10-10T23:36:00Z", deadlineDate: "2026-07-05T10:00:00Z" };
  const historical = { ...job, id: "september-bls10", operationId: "september-bls10", status: "completed",
    contractId: "bls10", contractNameSnapshot: "BLS - 10", totalDeliveries: 12, progress: 12,
    assignedAt: "2026-09-01T10:00:00Z", createdAt: "2026-09-01T10:00:00Z", completedAt: "2026-09-07T18:32:00Z",
    vehicleId: "iveco", trailerId: "bau" };
  fixture.operational.jobs = [legacy, historical, current];
  fixture.operational.contracts = [{ id: current.contractId, companyId: current.companyId, name: "BLS - 120",
    totalDeliveries: 10, simulator: "gto", deadlineDays: 6, mode: "simple", trailerId: "rodotrem" }];
  fixture.operational.users = [{ ...fixture.session.currentUser, status: "active" }];
  fixture.operational.trailers = [{ id: "rodotrem", name: "Rodotrem Graneleiro 6 eixos", companyId: job.companyId },
    { id: "bau", name: "Baú 3 eixos", companyId: job.companyId }];
  fixture.operational.vehicles = [...fixture.operational.vehicles, { id: "iveco", name: "Iveco S Way", companyId: job.companyId }];
  fixture.operational.operationalDataReady = true;
  fixture.company.allCompanyMembers = [{ userId: job.driverId, companyId: job.companyId, status: "active", roles: ["driver"] }];
  const currentReceipts = Array.from({ length: 10 }, (_, i) => trip(`current-${i}`, {
    jobId: current.id, operationId: current.id, createdAt: current.createdAt, valorCents: 2491700 }));
  const previousReceipts = Array.from({ length: 12 }, (_, i) => trip(`previous-${i}`, {
    jobId: historical.id, operationId: historical.id, contractId: historical.contractId,
    createdAt: historical.createdAt, completedAt: historical.completedAt, valorCents: 764883 }));
  fixture.trips.trips = [...currentReceipts, ...previousReceipts, { ...currentReceipts[0], id: "duplicate-view" },
    trip("foreign", { jobId: current.id, operationId: current.id, companyId: "foreign" }),
    trip("pending", { jobId: current.id, operationId: current.id, status: "REGISTERED_LOCAL", uploadedAt: undefined, serverValidatedAt: undefined })];
  await render();
  assert.ok(button("Finalizar Operação"), "the current BLS120 awaiting manual finish must outrank an older active job");
  assert.match(document.body.textContent || "", /BLS - 120/);
  assert.match(document.body.textContent || "", /10\/10/);
  assert.match(document.body.textContent || "", /Rodotrem Graneleiro 6 eixos/);
  assert.equal(Boolean(document.querySelector('[data-testid="completed-operation-card"]')), false, "BLS10 historical result cannot look like current completion");
  if (baseline) throw new Error("Baseline unexpectedly passed the multi-operation regression");
  await render(tested.CompanyOperationsTab);
  const companyCards = [...document.querySelectorAll('[data-operation-id]')];
  assert.ok(companyCards.length);
  assert.ok(companyCards.every(card => card.getAttribute("data-operation-id") === current.id));
  await act(async () => (companyCards[0].querySelector("button") as HTMLButtonElement).click());
  await flush();
  assert.match(companyCards[0].textContent || "", /10\/10/, "company and driver count exactly the same confirmed deduplicated ledger");
  // The registration screen used a separate status-first sort as well.
  // A newer delayed operation must win over an older active catalog entry.
  fixture.company.memberships = [{ userId: job.driverId, companyId: job.companyId, status: "active", roles: ["driver"] }];
  const restoredContracts = fixture.operational.contracts;
  fixture.operational.contracts = [...restoredContracts, { id: legacy.contractId, companyId: job.companyId,
    name: "Legacy June catalog", totalDeliveries: 10, simulator: "gto", deadlineDays: 6, mode: "simple" }];
  fixture.operational.jobs = [legacy, historical, { ...current, status: "delayed", progress: 3 }];
  fixture.trips.trips = currentReceipts.slice(0, 3);
  await render(tested.RecordTrip);
  assert.match(document.body.textContent || "", /Lançar Viagem/, "the actual Print form is mounted");
  assert.match(document.body.textContent || "", /BLS - 120/, "Print registration must bind to the same most recent operation");
  assert.ok(!document.body.textContent?.includes("Legacy June catalog"));
  // The immutable assignment remains usable if its catalog is absent.
  fixture.operational.contracts = [];
  await render(tested.RecordTrip);
  assert.match(document.body.textContent || "", /BLS - 120/);
  fixture.operational.contracts = restoredContracts;
  fixture.operational.jobs = [legacy, historical, current];
  fixture.trips.trips = currentReceipts.slice(0, 3);
  let attemptedId = "";
  fixture.operational.finishJob = async (id: string) => { attemptedId = id; throw new Error("TEST_NETWORK_FAILURE"); };
  await render();
  assert.ok(button("Finalizar Operação"), "server awaiting_completion retains the manual action with partial local history");
  await act(async () => button("Finalizar Operação").click());
  await flush();
  assert.equal(attemptedId, current.id);
  assert.equal(fixture.operational.jobs.find((value: any) => value.id === current.id).status, "awaiting_completion");
  assert.equal(Boolean(document.querySelector('[data-testid="completed-operation-card"]')), false);
  fixture.operational.finishJob = async (id: string) => {
    assert.equal(id, current.id);
    fixture.operational.jobs = fixture.operational.jobs.map((value: any) => value.id === id
      ? { ...current, status: "completed", completedAt: new Date().toISOString() } : value);
    return { completed: true, jobId: id, status: "completed", progress: 10, total: 10 };
  };
  await render();
  await act(async () => button("Finalizar Operação").click());
  await render();
  const resultCard = document.querySelector('[role="dialog"]');
  assert.ok(resultCard);
  assert.match(resultCard.textContent || "", /BLS - 120/);
  assert.match(resultCard.textContent || "", /Viagens\s*10(?=Ganhos)/);
  assert.ok(!resultCard.textContent?.includes("BLS - 10"));
  assert.equal(Boolean(button("Finalizar Operação")), false, "the legacy June job cannot resurrect after explicit current completion");
  await render(tested.CompanyOperationsTab);
  assert.equal(document.querySelectorAll('[data-operation-id]').length, 0);
  await act(async () => root.unmount());
  sessionStorage.clear(); localStorage.clear();
  root = createRoot(document.getElementById("root")!);
  fixture.operational.jobs = [job]; fixture.operational.contracts = [];
  fixture.trips.trips = [trip("first"), trip("second")];
  fixture.operational.finishJob = async () => { finishCalls++; throw new Error("TEST_NETWORK_FAILURE"); };
  console.log("MULTI_OPERATION_UI_PASS real driver/company/Print; legacy+history+current; confirmed dedup; partial history; failed/manual ACK; exact result; no resurrection");
  console.log("lifecycle: catalog");
  await render();
  assert.ok(!document.body.textContent?.includes("Nenhum contrato ativo"), "missing catalog cannot conceal an active assignment");
  assert.ok(button("Finalizar Operação"), "immutable assignment target must expose the manual finish button even without catalog");
  assert.equal(finishCalls, 0, "rendering a full target must never finalize it");
  if (baseline) throw new Error("Baseline unexpectedly passed the missing-contract regression");
  fixture.operational.contracts = [{ id: job.contractId, companyId: job.companyId, name: "Catalog edited later", totalDeliveries: 10, simulator: "gto", deadlineDays: 10, mode: "simple" }];
  await render();
  assert.ok(button("Finalizar Operação"), "an edited catalog cannot enlarge the current assignment's target");
  await act(async () => button("Finalizar Operação").click());
  await flush();
  assert.equal(fixture.operational.jobs[0].status, "active", "a failed ACK leaves the operation current");
  assert.equal(Boolean(document.querySelector('[data-testid="completed-operation-card"]')), false);
  assert.ok(button("Finalizar Operação") && !button("Finalizar Operação").hasAttribute("disabled"));
  let confirm!: () => void;
  fixture.operational.finishJob = () => { finishCalls++; return new Promise(resolve => { confirm = () => {
    fixture.operational.jobs = [{ ...job, status: "completed", completedAt: new Date().toISOString() }];
    resolve({ completed: true, jobId: job.id, status: "completed", progress: 2, total: 2 });
  }; }); };
  await render();
  await act(async () => button("Finalizar Operação").click());
  await flush();
  assert.equal(fixture.operational.jobs[0].status, "active", "the operation remains current while ACK is pending");
  assert.equal(Boolean(document.querySelector('[data-testid="completed-operation-card"]')), false);
  console.log("lifecycle: ACK");
  await act(async () => confirm());
  await render();
  assert.ok(hasPreviousWork());
  assert.ok(document.querySelector('[role="dialog"]'), "manual ACK publishes the result modal");
  const completedAt = Date.parse(fixture.operational.jobs[0].completedAt);
  const startedAt = Date.parse(job.assignedAt || job.startedAt || job.createdAt);
  const elapsedMinutes = Math.floor(Math.max(0, completedAt - startedAt) / 60_000);
  const elapsedDays = Math.floor(elapsedMinutes / 1440);
  const expectedExecution = `${elapsedDays ? `${elapsedDays}d ` : ""}${Math.floor(elapsedMinutes / 60) % 24}h ${elapsedMinutes % 60}min`;
  assert.ok((document.body.textContent || "").includes(expectedExecution), "completed result duration is frozen at the ACK timestamp");
  assert.equal(Boolean(button("Finalizar Operação")), false);
  await act(async () => root.unmount());
  console.log("lifecycle: cold result");
  sessionStorage.clear();
  root = createRoot(document.getElementById("root")!);
  await render();
  assert.ok(hasPreviousWork(), "the result survives a fresh root without session handoff");
  await openPreviousWork();
  await act(async () => (document.querySelector('button[aria-label^="Ver trabalho "]') as HTMLElement).click());
  assert.ok(document.querySelector('[role="dialog"]'));
  fixture.company.activeCompanyId = "company-b";
  await render();
  assert.equal(Boolean(document.querySelector('[data-testid="completed-operation-card"]')), false);
  assert.equal(Boolean(document.querySelector('[role="dialog"]')), false, "result dialog cannot leak across company scope");
  fixture.company.activeCompanyId = "company-a";
  fixture.session.currentUser = { ...fixture.session.currentUser, id: "another-user" };
  await render();
  assert.equal(Boolean(document.querySelector('[data-testid="completed-operation-card"]')), false);
  assert.equal(Boolean(document.querySelector('[role="dialog"]')), false, "result dialog cannot leak across accounts");
  await act(async () => root.unmount());
  console.log("lifecycle: submission");
  // The same coordinator that drives Print and Pro must handle failures once.
  const unhandled: unknown[] = [];
  const onUnhandled = (error: unknown) => unhandled.push(error);
  process.on("unhandledRejection", onUnhandled);
  const input: any = { userId: job.driverId, companyId: job.companyId, job, tripData: trip("submission", { status: "REGISTERED_LOCAL", serverValidatedAt: undefined }),
    addTrip: async () => { throw new Error("TEST_NETWORK_FAILURE"); } };
  await assert.rejects(tested.completeTripWithCoordinator(input), /TEST_NETWORK_FAILURE/);
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.deepEqual(unhandled, [], "a handled send failure must not spawn an unhandled finally promise");
  assert.equal(tested.getOperationalCompletionInFlightCount(), 0);
  process.off("unhandledRejection", onUnhandled);
  const calls: string[] = [];
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const first = tested.completeTripWithCoordinator({ ...input, tripData: { ...input.tripData, idempotencyKey: "shared-request-key" },
    addTrip: async () => { calls.push("a"); await wait; return { id: "local-a", offline: true }; } });
  const second = tested.completeTripWithCoordinator({ ...input, userId: "driver-b", companyId: "company-b", job: { ...job, id: "job-b" },
    tripData: trip("submission-b", { driverId: "driver-b", companyId: "company-b", jobId: "job-b", operationId: "job-b", idempotencyKey: "shared-request-key" }),
    addTrip: async () => { calls.push("b"); await wait; return { id: "local-b", offline: true }; } });
  assert.deepEqual(calls, ["a", "b"], "in-flight deduplication must include account, company and operation");
  release();
  assert.deepEqual((await Promise.all([first, second])).map(value => value.docRef.id), ["local-a", "local-b"]);
  console.log("lifecycle: snapshots");
  // A trip change invalidates only its own operation snapshot.
  tested.writeActiveOperationSnapshot(job.driverId, job.companyId, job, fixture.operational.contracts[0]);
  tested.writeActiveOperationSnapshot(job.driverId, "company-b", { ...job, companyId: "company-b", id: "job-b" }, null);
  tested.emitCanonicalTripUpdated(trip("first"));
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(tested.readActiveOperationSnapshot(job.driverId, job.companyId), null);
  assert.ok(tested.readActiveOperationSnapshot(job.driverId, "company-b"), "a receipt from company A cannot clear company B's offline snapshot");
  tested.canonicalTripRepository.applyServerSnapshots([trip("first"), trip("second")]);
  const metadata = { operationId: job.id, driverId: job.driverId, companyId: job.companyId, contractId: job.contractId, simulatorId: "gto", totalDeliveries: 2, status: "active" };
  const full = tested.operationReconciliationService.rebuild(metadata);
  assert.equal(full.status, "awaiting_completion");
  assert.equal(full.closed, false);
  assert.equal(full.readyToFinalize, true);
  assert.equal(tested.operationReconciliationService.rebuild(metadata), full, "an unchanged projection reuses its reference");
  assert.equal(tested.operationReconciliationService.reconcileAfterTripChange(trip("first")).totalDeliveries, 2, "receipt updates preserve the assignment target");
  console.log("PASS real Dashboard: missing/edited catalog, full target without auto-close, failed/pending/manual ACK, persistent result, true idle time, company/account isolation; real coordinator failure/dedup and scoped snapshots/projection reuse.");
} finally {
  console.error = originalConsoleError;
  try { await act(async () => root.unmount()); } catch {}
  await terminate(tested.db);
  await Promise.all(getApps().map(app => deleteApp(app)));
  dom.window.close();
}
