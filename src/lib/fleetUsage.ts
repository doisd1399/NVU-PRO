import { isRunningJobStatus } from "./jobStatus";
import { selectCurrentOperationJobs } from "./currentOperation";
import { buildClientOperationProjection } from "../application/operation/operationProjectionSelectors";

export type FleetAssetKind = "vehicle" | "trailer";

export interface FleetUsageMemberLike {
  userId?: unknown;
  companyId?: unknown;
  status?: unknown;
  role?: unknown;
  roles?: readonly unknown[];
}

export interface FleetUsageJobLike {
  operationalCommandVersion?: unknown;
  id?: unknown;
  companyId?: unknown;
  driverId?: unknown;
  motoristaId?: unknown;
  motorista_id?: unknown;
  assignedDriverId?: unknown;
  driver_id?: unknown;
  vehicleId?: unknown;
  vehicle_id?: unknown;
  vehicle?: { id?: unknown } | null;
  trailerId?: unknown;
  trailer_id?: unknown;
  trailer?: { id?: unknown } | null;
  contractId?: unknown;
  status?: unknown;
  totalDeliveries?: unknown;
  assignedAt?: unknown;
  startedAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface FleetUsageContractLike {
  id?: unknown;
  companyId?: unknown;
  trailerId?: unknown;
  trailer_id?: unknown;
  totalDeliveries?: unknown;
}

const normalizeId = (value: unknown): string => String(value ?? "").trim();

const firstId = (...values: unknown[]): string => {
  for (const value of values) {
    const normalized = normalizeId(value);
    if (normalized) return normalized;
  }
  return "";
};

export const resolveFleetJobDriverId = (job: FleetUsageJobLike): string =>
  firstId(
    job.driverId,
    job.motoristaId,
    job.motorista_id,
    job.assignedDriverId,
    job.driver_id,
  );

const resolveContract = (
  job: FleetUsageJobLike,
  contractsById: Map<string, FleetUsageContractLike>,
): FleetUsageContractLike | undefined => {
  const contractId = normalizeId(job.contractId);
  if (!contractId) return undefined;
  const contract = contractsById.get(contractId);
  if (!contract) return undefined;
  const jobCompanyId = normalizeId(job.companyId);
  const contractCompanyId = normalizeId(contract.companyId);
  if (jobCompanyId && contractCompanyId && jobCompanyId !== contractCompanyId) {
    return undefined;
  }
  return contract;
};

export const resolveFleetJobAssetId = (
  job: FleetUsageJobLike,
  kind: FleetAssetKind,
  contractsById: Map<string, FleetUsageContractLike> = new Map(),
): string => {
  if (kind === "vehicle") {
    return firstId(job.vehicleId, job.vehicle_id, job.vehicle?.id);
  }

  if (job.operationalCommandVersion === 1) return firstId(job.trailerId, job.trailer_id);

  const contract = resolveContract(job, contractsById);
  return firstId(
    job.trailerId,
    job.trailer_id,
    job.trailer?.id,
    contract?.trailerId,
    contract?.trailer_id,
  );
};

const normalizeRoleValues = (member: FleetUsageMemberLike): Set<string> => {
  const roles = Array.isArray(member.roles) ? member.roles : [];
  return new Set(
    [...roles, member.role]
      .map((role) => normalizeId(role).toLowerCase())
      .filter(Boolean),
  );
};

export const isActiveFleetDriver = (
  member: FleetUsageMemberLike,
  companyId?: unknown,
): boolean => {
  const normalizedCompanyId = normalizeId(companyId);
  const memberCompanyId = normalizeId(member.companyId);
  if (normalizedCompanyId && memberCompanyId !== normalizedCompanyId) return false;
  if (normalizeId(member.status).toLowerCase() !== "active") return false;
  return normalizeRoleValues(member).has("driver");
};

const isResourceOccupyingJob = (
  job: FleetUsageJobLike,
  confirmedTrips: readonly unknown[],
): boolean => {
  // A pending job is only an assignment waiting to start, not the current
  // operation reported by the employee. Fleet usage must follow the same
  // running-operation semantics as the operational dashboard.
  if (!isRunningJobStatus(job.status)) return false;
  const projection = buildClientOperationProjection(job as Record<string, unknown>, confirmedTrips);
  // The assigned resources remain in use until the driver explicitly closes
  // the operation, including the interval between the last trip and that ACK.
  if (!projection) return true;
  return projection.status !== "completed" && projection.status !== "cancelled";
};

export interface ResolveCurrentFleetUsageJobsOptions {
  jobs: readonly FleetUsageJobLike[];
  members: readonly FleetUsageMemberLike[];
  companyId?: unknown;
  contracts?: readonly FleetUsageContractLike[];
  confirmedTrips?: readonly unknown[];
}

/**
 * Returns one current resource assignment per active driver. Membership is the
 * authority for whether the person still belongs to the company; the job is
 * the authority for which vehicle/trailer is currently assigned.
 */
export const resolveCurrentFleetUsageJobs = ({
  jobs,
  members,
  companyId,
  confirmedTrips = [],
}: ResolveCurrentFleetUsageJobsOptions): FleetUsageJobLike[] => {
  const normalizedCompanyId = normalizeId(companyId);

  const activeDriverIds = new Set(
    members
      .filter((member) => isActiveFleetDriver(member, normalizedCompanyId))
      .map((member) => normalizeId(member.userId))
      .filter(Boolean),
  );
  if (activeDriverIds.size === 0) return [];

  const scopedJobs = jobs.filter((job) => {
    if (normalizedCompanyId && normalizeId(job.companyId) !== normalizedCompanyId) return false;
    return activeDriverIds.has(resolveFleetJobDriverId(job));
  });
  return selectCurrentOperationJobs(scopedJobs, normalizedCompanyId)
    .filter((job) => isResourceOccupyingJob(job, confirmedTrips));
};

export interface CountFleetAssetUsageOptions
  extends ResolveCurrentFleetUsageJobsOptions {
  assetId: unknown;
  kind: FleetAssetKind;
  confirmedTrips?: readonly unknown[];
}

/**
 * Counts current distinct active company drivers using one fleet asset. Only
 * running operations reported by the employee can occupy an asset; pending
 * assignments and terminal operations are deliberately excluded. It is also
 * deliberately fail-closed while the active membership snapshot is empty.
 */
export const countFleetAssetUsage = ({
  jobs,
  members,
  assetId,
  kind,
  companyId,
  contracts = [],
  confirmedTrips = [],
}: CountFleetAssetUsageOptions): number => {
  const normalizedAssetId = normalizeId(assetId);
  if (!normalizedAssetId) return 0;

  const contractsById = new Map<string, FleetUsageContractLike>();
  for (const contract of contracts) {
    const id = normalizeId(contract.id);
    if (id) contractsById.set(id, contract);
  }

  const uniqueDrivers = new Set<string>();
  for (const job of resolveCurrentFleetUsageJobs({
    jobs,
    members,
    companyId,
    contracts,
    confirmedTrips,
  })) {
    const jobAssetId = resolveFleetJobAssetId(job, kind, contractsById);
    if (jobAssetId === normalizedAssetId) {
      const driverId = resolveFleetJobDriverId(job);
      if (driverId) uniqueDrivers.add(driverId);
    }
  }

  return uniqueDrivers.size;
};
