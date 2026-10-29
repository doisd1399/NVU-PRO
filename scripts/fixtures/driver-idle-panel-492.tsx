import React, { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { DriverIdlePanel, DriverPreviousWork, DriverAssignedQueue } from "../../src/components/driver/DriverIdlePanel";
import { DriverWorkRequest } from "../../src/components/driver/DriverWorkRequest";
import { DriverQueuePanel } from "../../src/components/operations/AutomaticDriverQueue";
import { ProfileHero } from "../../src/components/common/ProfileHero";
import { DriverDock } from "../../src/components/driver/DriverDock";
import { selectCompletedOperationJobs } from "../../src/lib/operationResultSummary";
import { queue477 } from "./driver-queue-477-data";

declare global { interface Window { __idle492: any } }
const calls: any[] = [];
const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect fill="#23535f" width="600" height="400"/></svg>')}`;
const jobs: any[] = [
  { id: "done-a", companyId: "a", driverId: "driver", contractId: "ca", status: "completed", completedAt: "2026-10-20", contractSnapshot: { name: "Operação finalizada A", totalDeliveries: 10 } },
  { id: "done-b", companyId: "b", driverId: "driver", contractId: "cb", status: "completed", completedAt: "2026-10-21", contractSnapshot: { name: "Operação finalizada B", totalDeliveries: 8 } },
  { id: "foreign", companyId: "a", driverId: "another-driver", contractId: "foreign", status: "completed", completedAt: "2026-10-21", contractSnapshot: { name: "Trabalho de outro motorista" } },
  { id: "cancelled", companyId: "a", driverId: "driver", contractId: "cancelled", status: "cancelled" },
];
const manual: any = { id: "manual", companyId: "a", driverId: "driver", status: "pending", contractId: "cm", contractSnapshot: { name: "Encaminhamento manual", totalDeliveries: 6, deadlineDays: 2 } };
function App() {
  const [config, setConfig] = useState<any>({}), [generation, setGeneration] = useState(0);
  const companyId = config.company || "a";
  useLayoutEffect(() => { document.documentElement.classList.toggle("dark", Boolean(config.dark)); }, [config.dark]);
  window.__idle492 = {
    reset(options: any = {}) { calls.length = 0; setConfig(options); setGeneration(v => v + 1); },
    update(options: any) { setConfig((v: any) => ({ ...v, ...options })); },
    calls: () => calls,
  };
  const company: any = { id: companyId, companyName: config.longName ? "EMPRESADEVÁRIOSVEÍCULOSCOMNOMECOMPRIDOSEMESPAÇOS" : `Empresa de teste ${companyId.toUpperCase()}`, logoUrl: config.brokenLogo ? "http://127.0.0.1/broken-logo.png" : image };
  const completed = selectCompletedOperationJobs(jobs, [], "driver", companyId);
  const view = queue477();
  return <div className="nvu-workspace-shell nvu-driver-workspace nvu-workspace-theme">
    <div className="nvu-profile-stack">
      <ProfileHero scope="driver" name="Motorista de validação" description="Motorista Parceiro" image={image}
        viewerId="driver" assetId="qa-banner" simulator="WBDS" simulatorOpen={false} onSimulator={() => calls.push({ action: "simulator" })} />
      <main className="nvu-driver-surface" data-page="dashboard">
        <DriverIdlePanel company={company} viewerId="driver" online={config.online !== false} suspended={Boolean(config.suspended)}
          onAvailabilityChange={online => { calls.push({ action: "availability", online }); setConfig((v: any) => ({ ...v, online })); }}>
          <DriverWorkRequest variant="panel" online={config.online !== false} suspended={Boolean(config.suspended)} busy={Boolean(config.busy)}
            pending={Boolean(config.pending)} requestedAt="12:00" success={Boolean(config.success)}
            onRequest={() => { calls.push({ action: "request" }); setConfig((v: any) => ({ ...v, pending: true })); }}
            onCancel={() => { calls.push({ action: "cancel" }); setConfig((v: any) => ({ ...v, pending: false })); }} />
          {config.manual ? <DriverAssignedQueue key={`assigned:${generation}:${companyId}`} jobs={[manual]} contracts={[]} suspended={Boolean(config.suspended)} startingJobId={null} onStart={job => calls.push({ action: "manual-start", id: job.id })} />
            : <DriverQueuePanel key={`queue:${generation}:${companyId}`} blocked={Boolean(config.suspended)} api={{ view, scopeKey: companyId, loading: false, error: null,
              offline: Boolean(config.offline), fresh: !config.offline, offlineAvailable: Boolean(config.offline), localCommandPending: false,
              refresh: async () => { calls.push({ action: "refresh" }); } }} onStart={async (next, vehicleId) => { calls.push({ action: "automatic-start", next, vehicleId }); }} />}
          <DriverPreviousWork key={`history:${generation}:${companyId}`} jobs={completed} contracts={[]} trips={[]} driverId="driver" historyReady={false}
            onReview={job => calls.push({ action: "review", id: job.id })} />
        </DriverIdlePanel>
      </main>
    </div>
    <div className="nvu-workspace-dock-space" />
    <DriverDock active="dashboard" onSelect={id => calls.push({ action: "navigate", id })} />
    <output id="idle-fixture-ready" hidden>{generation}</output>
  </div>;
}
createRoot(document.getElementById("root")!).render(<App />);
