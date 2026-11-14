import React, { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { DriverQueuePanel } from "../../src/components/operations/AutomaticDriverQueue";
import { DriverDock } from "../../src/components/driver/DriverDock";
import { CompletedOperationCard } from "../../src/components/CompletedOperationCard";
import { DriverWorkRequest } from "../../src/components/driver/DriverWorkRequest";
import { queue477, result477 } from "./driver-queue-477-data";

declare global { interface Window { __workspace477: any } }
const calls: any[] = [];
let release: (() => void) | undefined;
function App() {
  const [config, setConfig] = useState<any>({}), [generation, setGeneration] = useState(0);
  useLayoutEffect(() => { document.documentElement.classList.toggle("dark", Boolean(config.dark)); }, [config.dark]);
  window.__workspace477 = {
    reset: (options: any = {}) => { calls.length = 0; setConfig(options); setGeneration(value => value + 1); },
    update: (options: any) => setConfig((value: any) => ({ ...value, ...options })),
    calls: () => calls, release: () => release?.(),
  };
  const view = queue477();
  if (config.reason) {
    view.reason = config.reason;
    if (view.reason !== "ready") view.next = null;
    if (view.reason === "running") view.currentJob = { id: "active-job", contractId: "c14", status: "active" };
    if (view.reason === "complete") { view.queues[0].done = 20; view.items.forEach(item => { item.state = "done"; }); }
  }
  if (config.token && view.next) view.next.previewToken = config.token;
  if (config.longName) view.items[13].name = "OPERAÇÃODETRANSPORTENACIONALCOMNOMEEXTREMAMENTELONGOSEMESPAÇOS";
  if (config.singleVehicle) view.vehicles = [view.vehicles[0]];
  if (config.noQueues) { view.queues = []; view.items = []; view.next = null; }
  const result = structuredClone(result477);
  if (config.partialMoney) result.moneyGroups = [{ currency: "BRL", currencyStatus: "known", value: 100, tripCount: 2 },
    { currency: "USD", currencyStatus: "known", value: 50, tripCount: 1 }, { currencyStatus: "missing", value: null, tripCount: 1 }];
  return <div className="nvu-workspace-shell nvu-driver-workspace nvu-workspace-theme">
    <div className="nvu-profile-stack flex flex-col"><section className="nvu-profile-hero nvu-driver-hero" style={{ height: 260, background: "#328d98", color: "white", padding: 24, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      <strong>NVU · Ambiente isolado de validação</strong><span>Motorista de teste · GTO</span>
    </section>
    <main className="nvu-driver-surface" data-page="dashboard"><div className="nvu-driver-idle-workspace">
      <DriverQueuePanel key={generation} blocked={Boolean(config.blocked)} api={{ view, scopeKey: config.scope || "fixture-scope",
        loading: Boolean(config.loading), error: null, offline: Boolean(config.offline), fresh: config.fresh !== false,
        offlineAvailable: config.offlineAvailable ?? Boolean(config.offline), localCommandPending: Boolean(config.localCommandPending),
        refresh: async () => { calls.push({ action: "refresh" }); } }}
        onStart={async (next, vehicleId) => { calls.push({ action: "start", next, vehicleId });
          if (config.slowStart) await new Promise<void>(resolve => { release = resolve; }); }} />
      {config.manual && <DriverWorkRequest online={config.online !== false} suspended={Boolean(config.blocked)} busy={false}
        pending={Boolean(config.pending)} success={Boolean(config.success)} requestedAt="11:20"
        onRequest={() => calls.push({ action: "request" })} onCancel={() => calls.push({ action: "cancel" })} />}
      <CompletedOperationCard result={result} onReview={() => calls.push({ action: "review" })} />
    </div></main></div>
    <div className="nvu-workspace-dock-space" />
    <DriverDock active="dashboard" variant={config.company ? "company" : "driver"}
      onSelect={id => calls.push({ action: "navigate", id })} />
    <output id="fixture-ready" hidden>{generation}</output>
  </div>;
}
createRoot(document.getElementById("root")!).render(<App />);
