import { buildRankingUtcPeriodKey } from "./rankingPeriods";
import { onAuthTeardown } from "./authLifecycle";
import type { SeniorMonthlyMetricsResult } from "../services/seniorMonthlyMetricsService";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
export type SeniorMetricsSnapshot = SeniorMonthlyMetricsResult & {
  viewerId: string;
  savedAt: number;
  stale: boolean;
};
export const SENIOR_MONTHLY_CACHE_PREFIX = "nvu-senior-monthly-v1:";
const FRESH_MS = 5 * 60_000;

/** Only server-confirmed aggregates are cached. Unknown values never become zero. */
export function createSeniorMonthlyMetricsCache(options: {
  storage: () => StorageLike | null;
  now?: () => number;
  online?: () => boolean;
}) {
  const now = options.now ?? Date.now;
  const online = options.online ?? (() => typeof navigator === "undefined" || navigator.onLine);
  const records = new Map<string, SeniorMetricsSnapshot>();
  const requests = new Map<string, Promise<SeniorMetricsSnapshot>>();
  const revisions = new Map<string, number>();
  let generation = 0;
  const period = () => buildRankingUtcPeriodKey("mes", new Date(now()));
  const keyFor = (viewerId: string) => `${SENIOR_MONTHLY_CACHE_PREFIX}${encodeURIComponent(viewerId)}:${period()}`;
  const storageKeys = () => {
    try {
      const storage = options.storage();
      return storage ? Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((key): key is string => Boolean(key?.startsWith(SENIOR_MONTHLY_CACHE_PREFIX))) : [];
    } catch { return []; }
  };
  const validCompanies = (companies: unknown): companies is SeniorMonthlyMetricsResult["companies"] => {
    if (!companies || typeof companies !== "object" || Array.isArray(companies)) return false;
    return Object.entries(companies).every(([id, value]) => id.trim() && value &&
      Number.isInteger(value.tripCount) && value.tripCount >= 0 && Number.isFinite(value.earnings) && value.earnings >= 0);
  };
  const validSnapshot = (value: any): value is SeniorMetricsSnapshot => Boolean(value &&
    typeof value.viewerId === "string" && value.viewerId && typeof value.periodKey === "string" &&
    Number.isFinite(value.savedAt) && value.savedAt > 0 && value.savedAt <= now() + 60_000 &&
    typeof value.stale === "boolean" && validCompanies(value.companies));
  const persist = (key: string, snapshot: SeniorMetricsSnapshot) => {
    records.set(key, snapshot);
    while (records.size > 8) records.delete(records.keys().next().value!);
    try {
      const storage = options.storage();
      storage?.setItem(key, JSON.stringify({ version: 1, ...snapshot }));
      const keys = storageKeys().map(key => {
        try { return { key, savedAt: JSON.parse(storage!.getItem(key) || "{}").savedAt || 0 }; }
        catch { return { key, savedAt: 0 }; }
      }).sort((a, b) => a.savedAt - b.savedAt);
      keys.slice(0, Math.max(0, keys.length - 8)).forEach(item => storage?.removeItem(item.key));
    } catch { /* Quota/private mode: retain the confirmed memory snapshot. */ }
  };
  const read = (viewerId: string): SeniorMetricsSnapshot | null => {
    if (!viewerId) return null;
    const key = keyFor(viewerId);
    let value: any = records.get(key);
    if (!value) {
      try {
        const stored = JSON.parse(options.storage()?.getItem(key) || "null");
        if (stored?.version === 1) value = stored;
      } catch { return null; }
    }
    if (!validSnapshot(value) || value.viewerId !== viewerId || value.periodKey !== period()) return null;
    records.set(key, value);
    return value;
  };
  const invalidate = () => {
    const keys = new Set([...storageKeys(), ...records.keys(), ...requests.keys()]);
    for (const key of keys) {
      revisions.set(key, (revisions.get(key) || 0) + 1);
      let snapshot: any = records.get(key);
      try { snapshot ??= JSON.parse(options.storage()?.getItem(key) || "null"); } catch { /* ignore damaged storage */ }
      if (validSnapshot(snapshot)) persist(key, { ...snapshot, stale: true });
    }
  };
  const clear = () => {
    generation++;
    records.clear(); requests.clear(); revisions.clear();
    for (const key of storageKeys()) {
      try { options.storage()?.removeItem(key); } catch { /* best effort on logout */ }
    }
  };
  const load = (viewerId: string, fetchMetrics: () => Promise<SeniorMonthlyMetricsResult>): Promise<SeniorMetricsSnapshot> => {
    if (!viewerId) return Promise.reject(new Error("Sessão sênior não identificada."));
    const key = keyFor(viewerId);
    const pending = requests.get(key);
    if (pending) return pending;
    const cached = read(viewerId);
    if (cached && (!online() || (!cached.stale && now() - cached.savedAt < FRESH_MS))) return Promise.resolve(cached);
    if (!online()) return Promise.reject(new Error("Nenhuma consulta confirmada disponível neste aparelho."));
    const requestGeneration = generation, requestedPeriod = period();
    const request = (async () => {
      // An update during a read coalesces into one follow-up, never a polling loop.
      for (let attempt = 0; attempt < 2; attempt++) {
        const revision = revisions.get(key) || 0;
        const result = await fetchMetrics();
        if (generation !== requestGeneration) throw new Error("Sessão encerrada durante a consulta.");
        if (result.periodKey !== requestedPeriod || period() !== requestedPeriod || !validCompanies(result.companies)) throw new Error("Consulta mensal incompatível com o período atual.");
        if (revision !== (revisions.get(key) || 0)) continue;
        const snapshot = { ...result, viewerId, savedAt: now(), stale: false };
        persist(key, snapshot);
        return snapshot;
      }
      throw new Error("Os totais mudaram durante a consulta. A última consulta foi preservada.");
    })().finally(() => { if (requests.get(key) === request) requests.delete(key); });
    requests.set(key, request);
    return request;
  };
  return { read, load, invalidate, clear, period };
}

export const seniorMonthlyMetricsCache = createSeniorMonthlyMetricsCache({
  storage: () => { try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; } },
});
// Keep invalidation active even while the panel is unmounted.
if (typeof window !== "undefined") window.addEventListener("nvu:canonical-trip-updated", () => seniorMonthlyMetricsCache.invalidate());
onAuthTeardown(() => seniorMonthlyMetricsCache.clear());
