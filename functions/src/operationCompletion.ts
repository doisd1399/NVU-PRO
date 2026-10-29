const completionTiming = (
  job: Record<string, any>,
  contract: Record<string, any>,
) => {
  const now = new Date();
  const due = job.dueAt || job.deadlineDate;
  const dueMs = due && typeof due.toMillis === "function" ? due.toMillis() : Date.parse(String(due || ""));
  const diff = dueMs - now.getTime();
  const minutes = Math.floor(Math.abs(diff) / 60_000);
  const timeOffset = Number.isFinite(diff)
    ? (diff >= 0 ? `Restavam ${minutes} minutos para o prazo final.` : `Prazo excedido em ${minutes} minutos.`)
    : "";
  return {
    now,
    completionStatus: Number.isFinite(diff) && diff < 0 ? "late" : "on_time",
    completionTimeOffset: timeOffset,
    contractNameSnapshot: String(job.contractSnapshot?.name || job.contractNameSnapshot || contract.name || contract.nome || "Contrato"),
  };
};

/**
 * Marks a full operation as ready for the driver's explicit confirmation.
 * Reaching the required number of receipts must stop new trips, but it must
 * not silently close the operation or skip the result screen.
 */
export function operationAwaitingCompletionPatch(
  job: Record<string, any>,
  contract: Record<string, any>,
  confirmedCount: number,
  total: number,
): Record<string, unknown> {
  if (total <= 0 || confirmedCount < total) return {};
  const timing = completionTiming(job, contract);
  return {
    status: "awaiting_completion",
    completionReadyAt: timing.now.toISOString(),
    contractNameSnapshot: timing.contractNameSnapshot,
    operationReadyForManualCompletion: true,
  };
}

/**
 * Terminal patch used only by the authenticated manual-finalization callable.
 * Writers/reconcilers must use operationAwaitingCompletionPatch instead.
 */
export function operationCompletionPatch(
  job: Record<string, any>,
  contract: Record<string, any>,
  confirmedCount: number,
  total: number,
): Record<string, unknown> {
  if (total <= 0 || confirmedCount < total) return {};
  const timing = completionTiming(job, contract);
  return {
    status: "completed",
    completedAt: timing.now.toISOString(),
    completionStatus: timing.completionStatus,
    completionTimeOffset: timing.completionTimeOffset,
    contractNameSnapshot: timing.contractNameSnapshot,
    operationStatusUpdatedByCanonicalGateway: true,
    operationReadyForManualCompletion: false,
  };
}
