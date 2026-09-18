export const OPEN_JOB_STATUSES = [
  "pending",
  "active",
  "awaiting_completion",
  "delayed",
] as const;

export const RUNNING_JOB_STATUSES = [
  "active",
  "awaiting_completion",
  "delayed",
] as const;

export const TRIP_RECORDABLE_JOB_STATUSES = ["active", "delayed"] as const;

export const TERMINAL_JOB_STATUSES = ["completed", "cancelled"] as const;

export const normalizeJobStatus = (status: unknown): string =>
  String(status || "").trim().toLowerCase();

export const isOpenJobStatus = (status: unknown): boolean =>
  (OPEN_JOB_STATUSES as readonly string[]).includes(normalizeJobStatus(status));

export const isRunningJobStatus = (status: unknown): boolean =>
  (RUNNING_JOB_STATUSES as readonly string[]).includes(normalizeJobStatus(status));

export const hasRemainingDeliveries = (
  status: unknown,
  progress = 0,
  totalDeliveries = 0,
): boolean => {
  const safeProgress = Number.isFinite(Number(progress)) ? Math.max(0, Number(progress)) : 0;
  const safeTotal = Number.isFinite(Number(totalDeliveries)) ? Math.max(0, Number(totalDeliveries)) : 0;
  return normalizeJobStatus(status) === "awaiting_completion"
    && safeTotal > 0
    && safeProgress < safeTotal;
};

export const isTripRecordableJobStatus = (
  status: unknown,
  progress = 0,
  totalDeliveries = 0,
): boolean => {
  const normalized = normalizeJobStatus(status);
  const safeProgress = Number.isFinite(Number(progress)) ? Math.max(0, Number(progress)) : 0;
  const safeTotal = Number.isFinite(Number(totalDeliveries)) ? Math.max(0, Number(totalDeliveries)) : 0;
  if ((TRIP_RECORDABLE_JOB_STATUSES as readonly string[]).includes(normalized)) {
    return safeTotal <= 0 || safeProgress < safeTotal;
  }
  return hasRemainingDeliveries(normalized, safeProgress, safeTotal);
};

export const isTerminalJobStatus = (status: unknown): boolean =>
  (TERMINAL_JOB_STATUSES as readonly string[]).includes(normalizeJobStatus(status));

export const isClosedJobStatus = (
  status: unknown,
  progress = 0,
  totalDeliveries = 0,
): boolean => {
  const normalized = normalizeJobStatus(status);
  if ((TERMINAL_JOB_STATUSES as readonly string[]).includes(normalized)) return true;
  const safeProgress = Number.isFinite(Number(progress)) ? Math.max(0, Number(progress)) : 0;
  const safeTotal = Number.isFinite(Number(totalDeliveries)) ? Math.max(0, Number(totalDeliveries)) : 0;
  if (["active", "delayed"].includes(normalized)) {
    return safeTotal > 0 && safeProgress >= safeTotal;
  }
  if (normalized === "awaiting_completion") {
    return safeTotal <= 0 || safeProgress >= safeTotal;
  }
  return false;
};
