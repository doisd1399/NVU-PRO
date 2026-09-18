const SNAPSHOT_VERSION = 1;
const SNAPSHOT_KEY_PREFIX = "nvu.session.v5.snapshot.";

export type OfflineSessionSnapshot = {
  version: number;
  uid: string;
  cachedAt: number;
  user: Record<string, unknown>;
  memberships: Record<string, unknown>[];
  companies: Record<string, unknown>[];
  simulators: Record<string, unknown>[];
  activeCompanyId: string | null;
  activeRole: "admin" | "driver" | null;
  profileContext: Record<string, unknown> | null;
};

const keyForUid = (uid: string) =>
  `${SNAPSHOT_KEY_PREFIX}${encodeURIComponent(uid)}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const normalizeUid = (uid: unknown) => String(uid || "").trim();

export const readOfflineSessionSnapshot = (
  uid: string | null | undefined,
): OfflineSessionSnapshot | null => {
  const normalizedUid = normalizeUid(uid);
  if (typeof window === "undefined" || !normalizedUid) return null;

  try {
    const raw = window.localStorage.getItem(keyForUid(normalizedUid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OfflineSessionSnapshot>;

    if (
      parsed.version !== SNAPSHOT_VERSION ||
      parsed.uid !== normalizedUid ||
      !Number.isFinite(parsed.cachedAt) ||
      !isRecord(parsed.user) ||
      parsed.user.id !== normalizedUid ||
      !Array.isArray(parsed.memberships) ||
      !Array.isArray(parsed.companies) ||
      !Array.isArray(parsed.simulators) ||
      (parsed.activeRole !== null &&
        parsed.activeRole !== "admin" &&
        parsed.activeRole !== "driver")
    ) {
      return null;
    }

    return {
      version: SNAPSHOT_VERSION,
      uid: normalizedUid,
      cachedAt: Number(parsed.cachedAt),
      user: parsed.user,
      memberships: parsed.memberships.filter(isRecord),
      companies: parsed.companies.filter(isRecord),
      simulators: parsed.simulators.filter(isRecord),
      activeCompanyId: parsed.activeCompanyId
        ? String(parsed.activeCompanyId).trim()
        : null,
      activeRole: parsed.activeRole ?? null,
      profileContext: isRecord(parsed.profileContext)
        ? parsed.profileContext
        : null,
    };
  } catch {
    return null;
  }
};

export const writeOfflineSessionSnapshot = (
  snapshot: Omit<OfflineSessionSnapshot, "version" | "cachedAt">,
): boolean => {
  const uid = normalizeUid(snapshot.uid);
  if (
    typeof window === "undefined" ||
    !uid ||
    !isRecord(snapshot.user) ||
    snapshot.user.id !== uid ||
    !Array.isArray(snapshot.memberships) ||
    !Array.isArray(snapshot.companies) ||
    !Array.isArray(snapshot.simulators)
  ) {
    return false;
  }

  try {
    window.localStorage.setItem(
      keyForUid(uid),
      JSON.stringify({
        ...snapshot,
        uid,
        version: SNAPSHOT_VERSION,
        cachedAt: Date.now(),
      }),
    );
    return true;
  } catch {
    return false;
  }
};

export const clearOfflineSessionSnapshot = (uid?: string | null) => {
  const normalizedUid = normalizeUid(uid);
  if (typeof window === "undefined" || !normalizedUid) return;
  try {
    window.localStorage.removeItem(keyForUid(normalizedUid));
  } catch {
    // Logout cleanup is best effort and must not interrupt native sign-out.
  }
};

export const OFFLINE_SESSION_SNAPSHOT_VERSION = SNAPSHOT_VERSION;
export const OFFLINE_SESSION_SNAPSHOT_KEY_PREFIX = SNAPSHOT_KEY_PREFIX;
