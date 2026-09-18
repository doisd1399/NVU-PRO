import { isClosedJobStatus, isRunningJobStatus } from "./jobStatus";

export type FleetAssetKind = "vehicle" | "trailer";

export interface FleetUsageMemberLike {
  userId?: unknown;
  companyId?: unknown;
  status?: unknown;
  role?: unknown;
  roles?: readonly unknown[];
}

export interface FleetUsageJobLike {
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
  progress?: unknown;
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

const toFiniteNumber = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const parseTimestamp = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  const raw = normalizeId(value);
  if (!raw) return 0;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
};

const jobPriority = (job: FleetUsageJobLike): number => {
  const status = normalizeId(job.status).toLowerCase();
  if (status === "active") return 0;
  if (status === "awaiting_completion") return 1;
  if (status === "delayed") return 2;
  if (status === "pending") return 3;
  return 4;
};

const jobTimestamp = (job: FleetUsageJobLike): number =>
  Math.max(
    parseTimestamp(job.assignedAt),
    parseTimestamp(job.startedAt),
    parseTimestamp(job.createdAt),
    parseTimestamp(job.updatedAt),
  );

const compareCurrentJobs = (
  left: FleetUsageJobLike,
  right: FleetUsageJobLike,
): number => {
  const priorityDiff = jobPriority(left) - jobPriority(right);
  if (priorityDiff !== 0) return priorityDiff;
  const timestampDiff = jobTimestamp(right) - jobTimestamp(left);
  if (timestampDiff !== 0) return timestampDiff;
  return normalizeId(right.id).localeCompare(normalizeId(left.id));
};

const isResourceOccupyingJob = (
  job: FleetUsageJobLike,
  contractsById: Map<string, FleetUsageContractLike>,
): boolean => {
  // A pending job is only an assignment waiting to start, not the current
  // operation reported by the employee. Fleet usage must follow the same
  // running-operation semantics as the operational dashboard.
  if (!isRunningJobStatus(job.status)) return false;
  const contract = resolveContract(job, contractsById);
  const totalDeliveries = toFiniteNumber(
    job.totalDeliveries ?? contract?.totalDeliveries ?? 0,
  );
  return !isClosedJobStatus(
    job.status,
    toFiniteNumber(job.progress),
    totalDeliveries,
  );
};

export interface ResolveCurrentFleetUsageJobsOptions {
  jobs: readonly FleetUsageJobLike[];
  members: readonly FleetUsageMemberLike[];
  companyId?: unknown;
  contracts?: readonly FleetUsageContractLike[];
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
  contracts = [],
}: ResolveCurrentFleetUsageJobsOptions): FleetUsageJobLike[] => {
  const normalizedCompanyId = normalizeId(companyId);
  const contractsById = new Map<string, FleetUsageContractLike>();
  for (const contract of contracts) {
    const id = normalizeId(contract.id);
    if (id) contractsById.set(id, contract);
  }

  const activeDriverIds = new Set(
    members
      .filter((member) => isActiveFleetDriver(member, normalizedCompanyId))
      .map((member) => normalizeId(member.userId))
      .filter(Boolean),
  );
  if (activeDriverIds.size === 0) return [];

  const currentByDriver = new Map<string, FleetUsageJobLike>();
  for (const job of jobs) {
    const jobCompanyId = normalizeId(job.companyId);
    if (normalizedCompanyId && jobCompanyId !== normalizedCompanyId) continue;
    const driverId = resolveFleetJobDriverId(job);
    if (!driverId || !activeDriverIds.has(driverId)) continue;
    if (!isResourceOccupyingJob(job, contractsById)) continue;

    const previous = currentByDriver.get(driverId);
    if (!previous || compareCurrentJobs(job, previous) < 0) {
      currentByDriver.set(driverId, job);
    }
  }

  return Array.from(currentByDriver.values());
};

export interface CountFleetAssetUsageOptions
  extends ResolveCurrentFleetUsageJobsOptions {
  assetId: unknown;
  kind: FleetAssetKind;
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
  })) {
    const jobAssetId = resolveFleetJobAssetId(job, kind, contractsById);
    if (jobAssetId === normalizedAssetId) {
      const driverId = resolveFleetJobDriverId(job);
      if (driverId) uniqueDrivers.add(driverId);
    }
  }

  return uniqueDrivers.size;
};
