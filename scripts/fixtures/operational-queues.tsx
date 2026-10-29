import "../../src/components/driver/DriverWorkspace.css";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import "../../src/index.css";
import { AutomaticOperationsContext } from "./queue-context";
import { DriverQueuePanel } from "../../src/components/operations/AutomaticDriverQueue";
import { OperationalQueuesManager } from "../../src/components/admin/OperationalQueuesManager";
import {
  emptyQueueSettings,
  type DriverQueueView,
  type QueueCatalog,
} from "../../functions/src/operationalQueueModel";
declare global {
  interface Window {
    __queues: any;
  }
}
const contracts = [
  {
    id: "c1",
    companyId: "a",
    name: "Entrega no porto",
    sequenceId: "f1",
    sequenceOrder: 0,
    totalDeliveries: 4,
    deadlineDays: 3,
    mode: "simple",
  },
  {
    id: "c2",
    companyId: "a",
    name: "Coleta de grãos",
    sequenceId: "f1",
    sequenceOrder: 1,
    totalDeliveries: 2,
    deadlineDays: 2,
    mode: "detailed",
    deliveries: [{ origin: "Curitiba", destination: "Santos" }],
  },
  {
    id: "c3",
    companyId: "a",
    name: "Abastecimento regional",
    sequenceId: "f2",
    sequenceOrder: 0,
    totalDeliveries: 6,
    deadlineDays: 4,
    mode: "simple",
  },
];
function initial() {
  const settings = emptyQueueSettings("a");
  settings.revision = 1;
  settings.vehicleIds = ["v1", "v2"];
  settings.queues = [
    {
      id: "f1",
      folderId: "f1",
      state: "active",
      audience: "all",
      driverIds: [],
      orderIds: ["c1", "c2"],
    },
    {
      id: "f2",
      folderId: "f2",
      state: "paused",
      audience: "selected",
      driverIds: ["d1"],
      orderIds: ["c3"],
    },
  ];
  return {
    companyId: "a",
    configRevision: 1,
    viewToken: "catalog-1",
    settings,
    contracts,
    folders: [
      { id: "f1", name: "Rotas da semana", token: "folder-1" },
      { id: "f2", name: "Distribuição regional", token: "folder-2" },
    ],
    vehicles: [
      {
        id: "v1",
        companyId: "a",
        name: "Scania R450",
        plate: "NVU-1042",
        status: "available",
      },
      {
        id: "v2",
        companyId: "a",
        name: "Volvo FH 540",
        plate: "NVU-2086",
        status: "available",
      },
    ],
    drivers: [
      { id: "d1", name: "João Silva" },
      { id: "d2", name: "Ana Costa" },
    ],
  } as QueueCatalog;
}
function driverView(c: QueueCatalog, scenario: string): DriverQueueView {
  const done = scenario === "review" ? 0 : 1;
  return {
    companyId: "a",
    driverId: "d1",
    simulatorId: "gto",
    configRevision: c.settings.revision,
    viewToken: "view",
    historyToken: "history",
    generatedAt: "2026-10-16T13:00:00Z",
    queues: c.settings.queues
      .filter((q) => q.state !== "archived")
      .map((q) => ({
        id: q.id,
        name: c.folders.find((f) => f.id === q.id)!.name,
        state: q.state,
        audience: q.audience,
        count: c.contracts.filter((i) => i.sequenceId === q.id).length,
        done: q.id === "f1" ? done : 0,
        review: scenario === "review" ? 2 : 0,
      })),
    items: c.settings.queues
      .filter((q) => q.state !== "archived")
      .flatMap((q) =>
        q.orderIds.map((id, position) => ({
          ...c.contracts.find((i) => i.id === id)!,
          queueId: q.id,
          folderName: c.folders.find((f) => f.id === q.id)!.name,
          position,
          state:
            scenario === "review" && q.id === "f1"
              ? ("review" as const)
              : id === "c1"
                ? ("done" as const)
                : ("pending" as const),
        })),
      ),
    vehicles: c.vehicles,
    next: {
      queueId: "f1",
      contractId: "c2",
      configRevision: c.settings.revision,
      previewToken: scenario === "stale" ? "changed" : "next-preview",
    },
    currentJob: null,
    manualPendingIds: [],
    lastVehicleId: "v1",
    reason: scenario === "review" ? "review" : "ready",
  };
}
let rerender: () => void,
  role = "driver",
  scenario = "ready",
  catalog = initial(),
  calls: any[] = [],
  open = true,
  generation = 0;
let preparation: any = { companyId: "company-1", ready: true, enabled: true, token: "fixture-ready", conflicts: [], invalidScopes: [], jobs: [] };
window.__queues = {
  reset: (options: any = {}) => {
    generation++;
    role = options.role || "driver";
    scenario = options.scenario || "ready";
    catalog = initial();
    if (options.empty) catalog.settings.queues = [];
    if (options.noFolders) { catalog.folders = []; catalog.contracts = []; catalog.settings.queues = []; }
    preparation = scenario === "preparation-blocked" ? {
      companyId: "company-1", ready: false, enabled: false, token: "fixture-blocked", invalidScopes: ["old-1"],
      conflicts: [{ driverId: "d1", jobIds: ["old-1", "old-2"] }],
      jobs: [
        { jobId: "old-1", driverId: "d1", contractId: "c1", name: "Entrega no porto", status: "active",
          vehicleIds: ["v1"], trailerIds: [], issues: ["Veículo: campo antigo ou fora do padrão"], canNormalize: true, patch: { vehicleId: "v1" } },
        { jobId: "old-2", driverId: "d1", contractId: "c2", name: "Coleta de grãos", status: "active",
          vehicleIds: ["v2"], trailerIds: [], issues: [], canNormalize: false, patch: {} },
      ],
    } : { companyId: "company-1", ready: true, enabled: true, token: "fixture-ready", conflicts: [], invalidScopes: [], jobs: [] };
    calls = [];
    open = true;
    document.documentElement.classList.toggle("dark", Boolean(options.dark));
    rerender();
  },
  setScenario: (value: string) => {
    scenario = value;
    rerender();
  },
  calls: () => calls,
  catalog: () => catalog,
};
function App() {
  const [, render] = useState(0);
  rerender = () => render((i) => i + 1);
  const view = driverView(catalog, scenario);
  const api = {
    scopeKey: "fixture-a",
    view,
    settings: scenario === "manager-stale" ? { ...catalog.settings, revision: catalog.settings.revision + 1 } : catalog.settings,
    loading: false,
    error: null,
    offline: scenario === "offline" || scenario === "offline-no-cache",
    fresh: scenario !== "offline" && scenario !== "offline-no-cache",
    offlineAvailable: scenario !== "offline-no-cache",
    refresh: async () => {
      calls.push({ action: "refresh" });
    },
    loadCatalog: async () => structuredClone(catalog),
    loadProgress: async () => driverView(catalog, "review"),
    loadPreparation: async () => structuredClone(preparation),
    enableOperationalCommands: async () => {
      calls.push({ action: "enableOperationalCommands", companyId: preparation.companyId, enable: true });
      preparation.enabled = true;
      return { success: true, version: 1, companyId: preparation.companyId, ready: preparation.ready, enabled: true };
    },
    save: async (input: any) => {
      calls.push(input);
      if (scenario === "save-failed") throw new Error("Não foi possível confirmar a alteração. Tente novamente.");
      if (scenario === "save-slow") await new Promise((resolve) => setTimeout(resolve, 350));
      const settings = structuredClone(catalog.settings);
      if (input.action === "normalizeLegacyJobs") {
        preparation.invalidScopes = [];
        preparation.jobs = preparation.jobs.map((job: any) => ({ ...job, issues: [], canNormalize: false, patch: {} }));
        preparation.token = "fixture-normalized";
      }
      if (input.action === "resolveLegacyConflict") {
        preparation.conflicts = [];
        preparation.ready = true;
        preparation.token = "fixture-resolved";
      }
      if (input.action === "saveQueue") {
        const q = { ...input.queue, id: input.queue.folderId };
        settings.queues = settings.queues.filter((r) => r.id !== q.id);
        settings.queues.push(q);
      }
      if (input.action === "reorderQueues")
        settings.queues = input.queueIds.map((id: string) =>
          settings.queues.find((q) => q.id === id),
        );
      if (input.action === "setState")
        settings.queues = settings.queues.map((q) =>
          q.id === input.queueId ? { ...q, state: input.state } : q,
        );
      if (input.action === "saveVehicles") {
        if (input.driverId) {
          settings.driverVehicles = settings.driverVehicles.filter(
            (d) => d.driverId !== input.driverId,
          );
          if (!input.useDefault)
            settings.driverVehicles.push({
              driverId: input.driverId,
              vehicleIds: input.vehicleIds,
            });
        } else settings.vehicleIds = input.vehicleIds;
      }
      settings.revision++;
      catalog = { ...catalog, settings, configRevision: settings.revision };
      rerender();
      return { success: true, version: 1, companyId: "a", settings };
    },
  };
  return (
    <AutomaticOperationsContext.Provider value={api}>
      <main className="min-h-screen bg-slate-50 px-3 py-6 text-slate-900 dark:bg-[#0f1319] dark:text-slate-100">
        <div className="mx-auto max-w-md">
          <p className="mb-4 text-xs font-semibold tracking-wide text-slate-500">
            NVU · {role === "manager" ? "Gestor" : "Motorista"}
          </p>
          {role === "manager" ? (
            open ? (
              <OperationalQueuesManager
                key={generation}
                onClose={() => {
                  open = false;
                  rerender();
                }}
              />
            ) : (
              <p>Fechado</p>
            )
          ) : (
            <DriverQueuePanel
              key={generation}
              api={api}
              onStart={async (next, vehicleId) => {
                calls.push({ action: "start", next, vehicleId });
              }}
            />
          )}
        </div>
      </main>
      <Toaster />
    </AutomaticOperationsContext.Provider>
  );
}
const fixtureRoot = createRoot(document.getElementById("root")!);
window.__queues.unmount = () => fixtureRoot.unmount();
fixtureRoot.render(<App />);
