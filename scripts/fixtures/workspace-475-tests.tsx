import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { WorkspaceDock } from "../../src/components/WorkspaceDock";
import { DriverQueuePanel } from "../../src/components/operations/AutomaticDriverQueue";
import { RankingGamerLeaderboard } from "../../src/components/RankingGamerLeaderboard";
import { session } from "./workspace-475-ports";
import { workspaceDockActive, workspaceDockRole, workspaceDockTarget } from "../../src/lib/workspaceDock";
import type { DriverQueueView } from "../../functions/src/operationalQueueModel";

export { act, workspaceDockActive, workspaceDockRole, workspaceDockTarget };
let root: ReturnType<typeof createRoot> | undefined;
function RouteDock() {
  const location = useLocation();
  return <><output id="route-state">{JSON.stringify(location)}</output><WorkspaceDock /></>;
}
export async function resetDock(role: "admin" | "driver", pathname: string, state?: Record<string, unknown>) {
  session.activeRole = role;
  await act(async () => { root?.unmount(); root = createRoot(document.getElementById("root")!);
    root.render(<MemoryRouter initialEntries={[{ pathname, state }]}><RouteDock /></MemoryRouter>); });
}
export const rankingNames = ["MATECOM", "Cooper log", "COCAL TRANSPORTE", "Tijoleira Transportes", "DC Transportes", "Transportadora de Cargas do Brasil", "EMPRESACOMNOMEMUITOLONGOSEMPAUSAS"];
export async function showRanking() {
  const items = rankingNames.map((name, i) => ({ id: `co${i}`, name, trips: 191 - i, logo: "" }));
  await act(async () => { root?.unmount(); root = createRoot(document.getElementById("root")!);
    root.render(<div className="nvu-gamer-ranking"><RankingGamerLeaderboard items={items} assetType="company"
      showPhotos={false} criticalLimit={0} formatCurrency={() => "R$ 4.884.127,00"} onOpen={() => {}} /></div>); });
}
export function queueView(): DriverQueueView {
  return { companyId: "company", driverId: "fixture-driver", simulatorId: "gto", configRevision: 1,
    viewToken: "view-1", historyToken: "history-1", generatedAt: new Date().toISOString(),
    queues: [{ id: "q1", name: "Operação padrão", state: "active", audience: "all", count: 20, done: 13, review: 0 }],
    items: Array.from({ length: 20 }, (_, i) => ({ id: `c${i + 1}`, companyId: "company", name: `BLS - ${(i + 1) * 10}`,
      queueId: "q1", folderName: "Operação padrão", position: i, state: i < 13 ? "done" : "pending", totalDeliveries: 10, deadlineDays: 4 })),
    vehicles: [{ id: "v1", companyId: "company", name: "Volvo FH 16" }, { id: "v2", companyId: "company", name: "Scania R450" }],
    next: { queueId: "q1", contractId: "c14", configRevision: 1, previewToken: "preview-14" }, currentJob: null,
    manualPendingIds: [], lastVehicleId: "v1", reason: "ready" };
}
let latestView = queueView(), flags: Record<string, boolean> = {}, start: (next: any, vehicle: string) => Promise<void>, refreshCount = 0;
function QueueFixture() {
  return <div className="nvu-driver-workspace"><DriverQueuePanel api={{ view: latestView, scopeKey: "fixture-scope",
    fresh: true, loading: false, offline: false, error: null, offlineAvailable: false, ...flags,
    refresh: async () => { refreshCount++; } }} onStart={start} /></div>;
}
export async function showQueue(view: DriverQueueView, onStart: typeof start, options: Record<string, boolean> = {}) {
  latestView = view; start = onStart; flags = options; refreshCount = 0;
  await act(async () => { root?.unmount(); root = createRoot(document.getElementById("root")!); root.render(<QueueFixture />); });
}
export async function updateQueue(view: DriverQueueView, options: Record<string, boolean> = {}) {
  latestView = view; flags = options;
  await act(async () => { root?.render(<QueueFixture />); });
}
export const refreshes = () => refreshCount;
export async function cleanup() { await act(async () => root?.unmount()); }
