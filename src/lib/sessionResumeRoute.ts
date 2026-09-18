const SESSION_RESUME_PREFIX = "nvu.auth.resume-route.v1";
const SESSION_RESUME_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type SessionResumeRoute = {
  pathname: string;
  search: string;
  savedAt: number;
};

const allowedRoute = (pathname: string): boolean =>
  pathname === "/select-profile" ||
  pathname === "/pending-applications" ||
  pathname === "/status" ||
  pathname === "/diagnostics" ||
  pathname === "/ranking" ||
  pathname.startsWith("/admin/") ||
  pathname.startsWith("/driver/");

const keyForUid = (uid: string): string => `${SESSION_RESUME_PREFIX}.${uid}`;

const safeStorage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const canResumeRoute = (pathname: string): boolean => {
  const normalized = String(pathname || "").trim();
  return normalized.startsWith("/") && !normalized.includes("//") && allowedRoute(normalized);
};

export const writeSessionResumeRoute = (
  uid: string | null | undefined,
  pathname: string,
  search = "",
): void => {
  const normalizedUid = String(uid || "").trim();
  const normalizedPath = String(pathname || "").trim();
  if (!normalizedUid || !canResumeRoute(normalizedPath)) return;
  const storage = safeStorage();
  if (!storage) return;
  try {
    const value: SessionResumeRoute = {
      pathname: normalizedPath,
      search: String(search || "").slice(0, 512),
      savedAt: Date.now(),
    };
    storage.setItem(keyForUid(normalizedUid), JSON.stringify(value));
  } catch {
    // Session restoration is an acceleration only; Auth remains authoritative.
  }
};

export const readSessionResumeRoute = (
  uid: string | null | undefined,
): SessionResumeRoute | null => {
  const normalizedUid = String(uid || "").trim();
  if (!normalizedUid) return null;
  const storage = safeStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(keyForUid(normalizedUid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionResumeRoute>;
    if (
      typeof parsed.pathname !== "string" ||
      !canResumeRoute(parsed.pathname) ||
      typeof parsed.search !== "string" ||
      typeof parsed.savedAt !== "number" ||
      !Number.isFinite(parsed.savedAt) ||
      Date.now() - parsed.savedAt > SESSION_RESUME_TTL_MS
    ) {
      storage.removeItem(keyForUid(normalizedUid));
      return null;
    }
    return {
      pathname: parsed.pathname,
      search: parsed.search.slice(0, 512),
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
};

export const clearSessionResumeRoute = (uid: string | null | undefined): void => {
  const normalizedUid = String(uid || "").trim();
  if (!normalizedUid) return;
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.removeItem(keyForUid(normalizedUid));
  } catch {
    // Best-effort cleanup.
  }
};
