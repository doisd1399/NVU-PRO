import type { DriverQueueView } from "../../functions/src/operationalQueueModel";
import type { OperationResultData } from "../../src/components/OperationResultModal";

export function queue477(): DriverQueueView {
  return { companyId: "fixture-company", driverId: "fixture-driver", simulatorId: "gto", configRevision: 1,
    viewToken: "view-477", historyToken: "history-477", generatedAt: "2026-10-18T14:00:00Z",
    queues: [{ id: "q1", name: "Operação padrão", state: "active", audience: "all", count: 20, done: 13, review: 0 }],
    items: Array.from({ length: 20 }, (_, i) => ({ id: `c${i + 1}`, companyId: "fixture-company", name: `BLS - ${(i + 1) * 10}`,
      queueId: "q1", folderName: "Operação padrão", position: i, state: i < 13 ? "done" : "pending",
      totalDeliveries: 10, deadlineDays: 4, mode: "free", trailerName: "Rodocaçamba 6 eixos" })),
    vehicles: [{ id: "v1", name: "Volvo FH 16" }, { id: "v2", name: "Scania R450" }],
    next: { queueId: "q1", contractId: "c14", configRevision: 1, previewToken: "preview-477" },
    currentJob: null, manualPendingIds: [], lastVehicleId: "v1", reason: "ready" };
}
export const result477: OperationResultData = { contractName: "BLS - 130", tempoExecucao: "7d 16h 37min",
  tempoRestante: "Finalizada", isAtrasado: false, prazoTotal: "4 dias", totalViagens: 12,
  moneyGroups: [{ currency: "BRL", currencyStatus: "known", value: 249961, tripCount: 12 }] };
