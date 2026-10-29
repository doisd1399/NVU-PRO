import { isRunningJobStatus } from "./jobStatus";
import { normalizeTrip, type RawTrip } from "./tripNormalizer";
import { normalizeCanonicalOperation } from "../domain/operation/CanonicalOperation";
import { isCanonicalConfirmedTrip } from "../../functions/src/isCanonicalConfirmedTrip";

export type OperationSelectionJob = {
  id?: unknown;
  driverId?: unknown;
  motoristaId?: unknown;
  motorista_id?: unknown;
  assignedDriverId?: unknown;
  driver_id?: unknown;
  companyId?: unknown;
  empresaId?: unknown;
  status?: unknown;
  assignedAt?: unknown;
  startedAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  operationalCommandVersion?: unknown;
};

export type CurrentOperationJob = OperationSelectionJob & {
  id: string;
  driverId?: string;
  motoristaId?: string;
  status?: string;
  createdAt?: unknown;
  assignedAt?: unknown;
  updatedAt?: unknown;
  contractId?: string;
  companyId?: string;
  simulatorId?: string;
  operationId?: string;
  totalDeliveries?: number;
  progress?: number;
  lastValidatedTripId?: string;
  operationProgressReconciled?: boolean;
  completedAt?: unknown;
};

export type CurrentOperationProjection = {
  operationId: string;
  driverId: string;
  companyId: string;
  simulatorId: string;
  contractId: string;
  progress: number;
  confirmedProgress: number;
  pendingProgress: number;
  tripIds: string[];
};

export const selectCanonicalOperationTrips = (
  job: CurrentOperationJob,
  trips: readonly RawTrip[],
  driverId: string,
) => {
  const scope = {
    operationId: String(job.operationId || (job as any).id || "").trim(),
    driverId,
    companyId: String(job.companyId || (job as any).empresaId || "").trim(),
    contractId: String(job.contractId || (job as any).contratoId || "").trim(),
  };
  const unique = new Map<string, RawTrip>();
  for (const trip of trips) {
    const id = String(trip.canonicalTripId || trip.tripId || trip.id || trip.idempotencyKey || "").trim();
    if (id && isCanonicalConfirmedTrip(trip as any, scope)) unique.set(id, trip);
  }
  return [...unique.values()]
    .filter((trip) => isCanonicalConfirmedTrip(trip as any, scope))
    .map((trip) => normalizeTrip(trip))
    .filter((trip) => trip.isValid)
    .sort((left, right) => right.metricDate.getTime() - left.metricDate.getTime());
};

const toMillis = (value: unknown): number => {
  if (!value) return 0;
  try {
    let millis: number;
    if (typeof value === "object" && value !== null && "toMillis" in value && typeof value.toMillis === "function") {
      millis = value.toMillis();
    } else if (typeof value === "object" && value !== null && "toDate" in value && typeof value.toDate === "function") {
      millis = value.toDate().getTime();
    } else if (typeof value === "object" && value !== null && "seconds" in value) {
      millis = Number(value.seconds) * 1000;
    } else {
      millis = typeof value === "number" ? value : new Date(value as string | Date).getTime();
    }
    return Number.isFinite(millis) && millis > 0 ? millis : 0;
  } catch {
    return 0;
  }
};

export const operationSelectionDriverId = (job: OperationSelectionJob): string =>
  String(job.driverId || job.motoristaId || job.motorista_id || job.assignedDriverId || job.driver_id || "").trim();

const companyIdOf = (job: OperationSelectionJob): string =>
  String(job.companyId || job.empresaId || "").trim();

/** Assignment order is immutable; a later receipt/cache update cannot promote an old job. */
export const operationAssignmentTimestamp = (job: OperationSelectionJob): number =>
  toMillis(job.assignedAt) || toMillis(job.startedAt) || toMillis(job.createdAt) || toMillis(job.updatedAt);

const statusPriority = (status: unknown): number => {
  switch (String(status || "").toLowerCase()) {
    case "awaiting_completion":
      return 0;
    case "active":
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
export function selectCurrentOperationJob<T extends OperationSelectionJob>(
  jobs: readonly T[],
  driverId?: string | null,
  companyId?: string | null,
): T | null {
  const normalizedDriverId = String(driverId || "").trim();
  const normalizedCompanyId = String(companyId || "").trim();
  if (!normalizedDriverId) return null;

  const scopedJobs = jobs.filter((job) =>
    operationSelectionDriverId(job) === normalizedDriverId &&
    (!normalizedCompanyId || companyIdOf(job) === normalizedCompanyId));
  const completedAssignment = scopedJobs.reduce((latest, job) =>
    String(job.status || "").toLowerCase() === "completed"
      ? Math.max(latest, operationAssignmentTimestamp(job)) : latest, 0);

  return scopedJobs
    // An older leftover assignment must not reappear when the current one closes.
    // The server record stays intact; only explicit manual confirmation closes it.
    .filter((job) => isRunningJobStatus(job.status) &&
      (job.operationalCommandVersion === 1 || !completedAssignment || operationAssignmentTimestamp(job) >= completedAssignment))
    .slice()
    .sort((a, b) => {
      const managed = Number(b.operationalCommandVersion === 1) - Number(a.operationalCommandVersion === 1);
      if (managed) return managed;
      const timestampDiff = operationAssignmentTimestamp(b) - operationAssignmentTimestamp(a);
      if (timestampDiff !== 0) return timestampDiff;
      const statusDiff = statusPriority(a.status) - statusPriority(b.status);
      if (statusDiff !== 0) return statusDiff;

      return String(b.id || "").localeCompare(String(a.id || ""));
    })[0] || null;
}

/** All company/fleet surfaces consume the same current operation per driver/company. */
export function selectCurrentOperationJobs<T extends OperationSelectionJob>(
  jobs: readonly T[], companyId?: string | null,
): T[] {
  const normalizedCompanyId = String(companyId || "").trim();
  const grouped = new Map<string, T[]>();
  for (const job of jobs) {
    const driverId = operationSelectionDriverId(job);
    const company = companyIdOf(job);
    if (!driverId || (normalizedCompanyId && company !== normalizedCompanyId)) continue;
    const key = JSON.stringify([driverId, company]);
    const group = grouped.get(key) || [];
    group.push(job);
    grouped.set(key, group);
  }
  return [...grouped.values()].flatMap((group) => {
    const selected = selectCurrentOperationJob(group, operationSelectionDriverId(group[0]), companyIdOf(group[0]));
    return selected ? [selected] : [];
  });
}

export function deriveCurrentOperationProgress(
  job: CurrentOperationJob | null | undefined,
  trips: readonly RawTrip[],
  driverId?: string | null,
): number {
  const normalizedDriverId = String(driverId || "").trim();
  if (!job || !normalizedDriverId) return 0;
  // All operational surfaces count the same canonical, displayed receipts.
  // A denormalized job counter is a server write cursor, not proof that a
  // sixth document still exists or passes the history validity rules.
  return selectCanonicalOperationTrips(job, trips, normalizedDriverId).length;
}

/** Shared operation projection consumed by Print and Pro surfaces. */
export function projectCurrentOperation(
  job: CurrentOperationJob | null | undefined,
  trips: readonly RawTrip[],
  driverId?: string | null,
): CurrentOperationProjection | null {
  const normalizedDriverId = String(driverId || job?.driverId || job?.motoristaId || "").trim();
  if (!job || !normalizedDriverId) return null;
  try {
    const operation = normalizeCanonicalOperation({
      ...job,
      operationId: job.operationId || job.id,
      driverId: normalizedDriverId,
      companyId: job.companyId,
      simulatorId: job.simulatorId || "unknown",
      contractId: job.contractId,
      totalDeliveries: job.totalDeliveries || 0,
    });
    const selected = selectCanonicalOperationTrips({ ...job, ...operation }, trips, normalizedDriverId);
    const tripIds = selected.map((trip: any) => String(trip.canonicalTripId || trip.tripId || trip.id || "").trim()).filter(Boolean);
    const visibleConfirmed = selected.length; // The history filter has already excluded pending/deleted rows.
    const confirmedProgress = visibleConfirmed;
    const pendingProgress = 0; // Pending Pro receipts are shown by the native queue, outside confirmed history.
    return {
      operationId: operation.operationId,
      driverId: operation.driverId,
      companyId: operation.companyId,
      simulatorId: operation.simulatorId,
      contractId: operation.contractId,
      // Progress is server-confirmed only. Pending is exposed separately so an
      // offline capture cannot look like a confirmed delivery or close a job.
      progress: confirmedProgress,
      confirmedProgress,
      pendingProgress,
      tripIds,
    };
  } catch {
    return null;
  }
}

export const __currentOperationTestOnly = {
  statusPriority,
  toMillis,
  deriveCurrentOperationProgress,
};
