import { onAuthTeardown } from "./authLifecycle";
import { onCanonicalTripUpdated } from "./CanonicalTripUpdateEvent";

const SNAPSHOT_VERSION = 3;
const SNAPSHOT_PREFIX = "nvu.persisted.v3.active-operation.";
const LEGACY_SNAPSHOT_PREFIX = "nvu.persisted.v2.active-operation.";

export type ActiveOperationSnapshot = {
  version: number;
  cachedAt: number;
  userId: string;
  companyId: string;
  job: Record<string, unknown>;
  contract: Record<string, unknown> | null;
  vehicle: Record<string, unknown> | null;
  trailer: Record<string, unknown> | null;
  simulator: Record<string, unknown> | null;
};

const clean = (value: unknown) => String(value || "").trim();

const snapshotKeyWithPrefix = (prefix: string, userId: string, companyId: string) =>
  `${prefix}${encodeURIComponent(clean(userId))}.${encodeURIComponent(clean(companyId))}`;

const snapshotKey = (userId: string, companyId: string) =>
  snapshotKeyWithPrefix(SNAPSHOT_PREFIX, userId, companyId);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

export function readActiveOperationSnapshot(
  userId: string | null | undefined,
  companyId: string | null | undefined,
): ActiveOperationSnapshot | null {
  const normalizedUserId = clean(userId);
  const normalizedCompanyId = clean(companyId);
  if (!normalizedUserId || !normalizedCompanyId || typeof window === "undefined") {
    return null;
  }

  try {
    const currentKey = snapshotKey(normalizedUserId, normalizedCompanyId);
    const raw = window.localStorage.getItem(currentKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActiveOperationSnapshot>;
    const supportedVersion = parsed.version === SNAPSHOT_VERSION;
    if (
      !supportedVersion ||
      parsed.userId !== normalizedUserId ||
      parsed.companyId !== normalizedCompanyId ||
      typeof parsed.cachedAt !== "number" ||
      !Number.isFinite(parsed.cachedAt) ||
      parsed.cachedAt <= 0 ||
      parsed.cachedAt > Date.now() + 60_000 ||
      !isRecord(parsed.job) ||
      !clean(parsed.job.id) ||
      (clean(parsed.job.companyId) && clean(parsed.job.companyId) !== normalizedCompanyId)
    ) {
      window.localStorage.removeItem(currentKey);
      return null;
    }
    return {
      version: SNAPSHOT_VERSION,
      cachedAt: parsed.cachedAt,
      userId: normalizedUserId,
      companyId: normalizedCompanyId,
      job: parsed.job,
      contract: isRecord(parsed.contract) ? parsed.contract : null,
      vehicle: isRecord(parsed.vehicle) ? parsed.vehicle : null,
      trailer: isRecord(parsed.trailer) ? parsed.trailer : null,
      simulator: isRecord(parsed.simulator) ? parsed.simulator : null,
    };
  } catch {
    return null;
  }
}

export function writeActiveOperationSnapshot(
  userId: string | null | undefined,
  companyId: string | null | undefined,
  job: Record<string, unknown> | null | undefined,
  contract: Record<string, unknown> | null | undefined,
  assets: {
    vehicle?: Record<string, unknown> | null;
    trailer?: Record<string, unknown> | null;
    simulator?: Record<string, unknown> | null;
  } = {},
) {
  const normalizedUserId = clean(userId);
  const normalizedCompanyId = clean(companyId);
  if (
    !normalizedUserId ||
    !normalizedCompanyId ||
    !isRecord(job) ||
    !clean(job.id) ||
    typeof window === "undefined"
  ) {
    return;
  }

  const snapshot: ActiveOperationSnapshot = {
    version: SNAPSHOT_VERSION,
    cachedAt: Date.now(),
    userId: normalizedUserId,
    companyId: normalizedCompanyId,
    job,
    contract: isRecord(contract) ? contract : null,
    vehicle: isRecord(assets.vehicle) ? assets.vehicle : null,
    trailer: isRecord(assets.trailer) ? assets.trailer : null,
    simulator: isRecord(assets.simulator) ? assets.simulator : null,
  };
  try {
    window.localStorage.setItem(
      snapshotKey(normalizedUserId, normalizedCompanyId),
      JSON.stringify(snapshot),
    );
  } catch {
    // The snapshot accelerates rendering but is never authoritative.
  }
}

export function clearActiveOperationSnapshot(
  userId: string | null | undefined,
  companyId: string | null | undefined,
) {
  if (typeof window === "undefined") return;
  try {
    const normalizedUserId = clean(userId);
    const normalizedCompanyId = clean(companyId);
    if (normalizedUserId && normalizedCompanyId) {
      window.localStorage.removeItem(snapshotKey(normalizedUserId, normalizedCompanyId));
      window.localStorage.removeItem(
        snapshotKeyWithPrefix(LEGACY_SNAPSHOT_PREFIX, normalizedUserId, normalizedCompanyId),
      );
    }
  } catch {
    // Best-effort cleanup only.
  }
}


/**
 * Invalidates optimistic operation snapshots after a canonical trip update.
 * Snapshots accelerate rendering only and must never preserve stale trips.
 */
export function registerActiveOperationTripInvalidation(): () => void {
  return onCanonicalTripUpdated((trip) => {
    clearActiveOperationSnapshot(trip.driverId, trip.companyId);
  });
}

export function clearAllActiveOperationSnapshots() {
  if (typeof window === "undefined") return;
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(SNAPSHOT_PREFIX) || key?.startsWith(LEGACY_SNAPSHOT_PREFIX)) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Best-effort cleanup only.
  }
}

if (typeof window !== "undefined") {
  onAuthTeardown(() => clearAllActiveOperationSnapshots());
  registerActiveOperationTripInvalidation();
}
