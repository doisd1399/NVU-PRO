/** Last successful reads remain useful offline; freshness only controls revalidation. */
import { getAuthTeardownGeneration, isAuthTeardownActive } from "./authLifecycle";
export type PageSnapshot<T> = { savedAt: number; value: T };
const PREFIX = "nvu.session.page.v1:";
const flights = new Map<string, Promise<unknown>>();
export const PAGE_READ_FRESH_MS = 2 * 60_000;

export function pageCacheKey(viewerId: string, kind: string, scope: string): string {
  return viewerId && kind && scope
    ? `${PREFIX}${[viewerId, kind, scope].map(encodeURIComponent).join(":")}` : "";
}

export function readPageSnapshot<T>(key: string): PageSnapshot<T> | null {
  if (!key) return null;
  try {
    const entry = JSON.parse(localStorage.getItem(key) || "null");
    return entry && Number.isFinite(entry.savedAt) && entry.savedAt > 0 && "value" in entry ? entry : null;
  } catch { return null; }
}

export function writePageSnapshot<T>(key: string, value: T, savedAt = Date.now()): void {
  if (!key) return;
  try {
    const serialized = JSON.stringify({ savedAt, value });
    // Never mark a truncated private snapshot as complete.
    if (serialized.length > 256 * 1024) return;
    const ownerPrefix = key.slice(0, key.indexOf(":", PREFIX.length) + 1);
    const entries = Object.keys(localStorage).filter(item => item.startsWith(ownerPrefix) && item !== key)
      .sort((a, b) => (readPageSnapshot(a)?.savedAt || 0) - (readPageSnapshot(b)?.savedAt || 0));
    while (entries.length >= 12) localStorage.removeItem(entries.shift()!);
    localStorage.setItem(key, serialized);
  } catch { /* Private mode/quota cannot block the live page. */ }
}

export function removePageSnapshot(key: string): void {
  try { localStorage.removeItem(key); } catch { /* Best effort. */ }
}

export function isReadFresh(savedAt: number | undefined, now = Date.now()): boolean {
  return Boolean(savedAt && savedAt <= now && now - savedAt < PAGE_READ_FRESH_MS);
}

export function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

export function withReadDeadline<T>(read: Promise<T>, timeoutMs = 10_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error("Tempo de consulta esgotado"), { code: "unavailable" })), timeoutMs);
    read.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/** Share only the transport; callers must check their active scope before publishing. */
export function coalescePageRead<T>(key: string, read: () => Promise<T>, timeoutMs = 10_000): Promise<T> {
  if (!isOnline()) return Promise.reject(Object.assign(new Error("Offline"), { code: "unavailable" }));
  const generation = getAuthTeardownGeneration();
  if (isAuthTeardownActive()) return Promise.reject(new Error("Sessão encerrada"));
  const flightKey = `${generation}:${key}`;
  const existing = flights.get(flightKey);
  if (existing) return existing as Promise<T>;
  let transport: Promise<T>;
  try { transport = read(); } catch (error) { return Promise.reject(error); }
  const task = withReadDeadline(transport, timeoutMs).then(value => {
    if (generation !== getAuthTeardownGeneration() || isAuthTeardownActive()) throw new Error("Sessão encerrada");
    return value;
  });
  flights.set(flightKey, task);
  void task.finally(() => { if (flights.get(flightKey) === task) flights.delete(flightKey); }).catch(() => undefined);
  return task;
}

export function isPermissionFailure(error: unknown): boolean {
  return /(?:permission-denied|unauthenticated)$/.test(String((error as { code?: string })?.code || ""));
}
