import { isRunningJobStatus } from "./jobStatus";
import { normalizeTrip, type RawTrip } from "./tripNormalizer";

export type CurrentOperationJob = {
  id: string;
  driverId?: string;
  status?: string;
  createdAt?: unknown;
  assignedAt?: unknown;
  updatedAt?: unknown;
  contractId?: string;
  companyId?: string;
  completedAt?: unknown;
};

const toMillis = (value: unknown): number => {
  if (!value) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const millis = new Date(value as string | number | Date).getTime();
  return Number.isFinite(millis) ? millis : 0;
};

const statusPriority = (status: unknown): number => {
  switch (String(status || "").toLowerCase()) {
    case "active":
      return 0;
    case "awaiting_completion":
      return 1;
    case "delayed":
      return 2;
    case "pending":
      return 3;
    default:
      return 4;
  }
};

/**
 * Selects the driver's current operation, never an assignment that is still
 * pending. Pending jobs belong to the assigned-work queue and become current
 * only after the authoritative pending -> active transition is confirmed.
 */
export function selectCurrentOperationJob<T extends CurrentOperationJob>(
  jobs: readonly T[],
  driverId?: string | null,
  companyId?: string | null,
): T | null {
  const normalizedDriverId = String(driverId || "").trim();
  const normalizedCompanyId = String(companyId || "").trim();
  if (!normalizedDriverId) return null;

  return jobs
    .filter(
      (job) =>
        String(job.driverId || "").trim() === normalizedDriverId &&
        (!normalizedCompanyId || String(job.companyId || "").trim() === normalizedCompanyId) &&
        isRunningJobStatus(job.status),
    )
    .slice()
    .sort((a, b) => {
      const statusDiff = statusPriority(a.status) - statusPriority(b.status);
      if (statusDiff !== 0) return statusDiff;

      const timestamp = (job: CurrentOperationJob) =>
        toMillis(job.assignedAt) || toMillis(job.updatedAt) || toMillis(job.createdAt);
      const timestampDiff = timestamp(b) - timestamp(a);
      if (timestampDiff !== 0) return timestampDiff;

      return String(b.id || "").localeCompare(String(a.id || ""));
    })[0] || null;
}

export function deriveCurrentOperationProgress(
  job: CurrentOperationJob | null | undefined,
  trips: readonly RawTrip[],
  driverId?: string | null,
): number {
  const persistedProgress = Math.max(0, Number((job as any)?.progress) || 0);
  const normalizedDriverId = String(driverId || "").trim();
  if (!job || !normalizedDriverId) return persistedProgress;

  const assignedTime = toMillis(job.assignedAt) || toMillis(job.createdAt);
  const completedTime = toMillis(job.completedAt) || Number.POSITIVE_INFINITY;
  const jobId = String(job.id || "").trim();
  const contractId = String(job.contractId || "").trim();

  const liveProgress = trips
    .map((trip) => normalizeTrip(trip))
    .filter((trip) => {
      if (!trip.isValid) return false;
      const tripDriverId = String(
        (trip as any).driverId ||
          (trip as any).motoristaId ||
          (trip as any).motorista_id ||
          (trip as any).userId ||
          "",
      ).trim();
      // Driver identity is always checked first. A matching jobId from another
      // driver must never contribute to this user's operation progress.
      if (tripDriverId !== normalizedDriverId) return false;

      const tripJobId = String(
        (trip as any).jobId ||
          (trip as any).trabalhoId ||
          (trip as any).job_id ||
          "",
      ).trim();
      if (tripJobId && tripJobId === jobId) return true;

      const tripContractId = String(
        (trip as any).contractId ||
          (trip as any).contratoId ||
          (trip as any).contrato_id ||
          "",
      ).trim();
      if (!contractId || tripContractId !== contractId) return false;

      const tripTime = trip.metricDate.getTime();
      return tripTime >= assignedTime && tripTime <= completedTime;
    }).length;

  return Math.max(persistedProgress, liveProgress);
}

export const __currentOperationTestOnly = {
  statusPriority,
  toMillis,
  deriveCurrentOperationProgress,
};
