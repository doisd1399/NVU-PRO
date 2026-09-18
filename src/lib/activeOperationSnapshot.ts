import { onAuthTeardown } from "./authLifecycle";

const SNAPSHOT_VERSION = 2;
const SNAPSHOT_PREFIX = "nvu.persisted.v2.active-operation.";

export type ActiveOperationSnapshot = {
  version: number;
  cachedAt: number;
  userId: string;
  companyId: string;
  job: Record<string, unknown>;
  contract: Record<string, unknown> | null;
};

const clean = (value: unknown) => String(value || "").trim();

const snapshotKey = (userId: string, companyId: string) =>
  `${SNAPSHOT_PREFIX}${encodeURIComponent(clean(userId))}.${encodeURIComponent(clean(companyId))}`;

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
    const raw = window.localStorage.getItem(
      snapshotKey(normalizedUserId, normalizedCompanyId),
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActiveOperationSnapshot>;
    if (
      parsed.version !== SNAPSHOT_VERSION ||
      parsed.userId !== normalizedUserId ||
      parsed.companyId !== normalizedCompanyId ||
      typeof parsed.cachedAt !== "number" ||
      !Number.isFinite(parsed.cachedAt) ||
      parsed.cachedAt <= 0 ||
      !isRecord(parsed.job) ||
      !clean(parsed.job.id)
    ) {
      window.localStorage.removeItem(snapshotKey(normalizedUserId, normalizedCompanyId));
      return null;
    }
    return {
      version: SNAPSHOT_VERSION,
      cachedAt: parsed.cachedAt,
      userId: normalizedUserId,
      companyId: normalizedCompanyId,
      job: parsed.job,
      contract: isRecord(parsed.contract) ? parsed.contract : null,
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
      window.localStorage.removeItem(
        snapshotKey(normalizedUserId, normalizedCompanyId),
      );
    }
  } catch {
    // Best-effort cleanup only.
  }
}

export function clearAllActiveOperationSnapshots() {
  if (typeof window === "undefined") return;
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(SNAPSHOT_PREFIX)) window.localStorage.removeItem(key);
    }
  } catch {
    // Best-effort cleanup only.
  }
}

if (typeof window !== "undefined") {
  onAuthTeardown(() => clearAllActiveOperationSnapshots());
}
