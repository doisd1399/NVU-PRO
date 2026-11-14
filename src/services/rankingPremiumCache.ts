const PREFIX = "nvu-ranking-premium-v1:";
const MAX_RECORDS = 24;
const MAX_RECORD_BYTES = 4_000_000;

export type RankingPremiumCacheRecord = {
  key: string;
  viewerId: string;
  participantId: string;
  scope: string;
  companyId: string;
  simulatorId: string;
  periodType: string;
  periodStart: string;
  periodEnd: string;
  updatedAt: number;
  item?: Record<string, unknown>;
  summary?: Record<string, unknown>;
};

const storageKey = (key: string) => PREFIX + key;

export function makeRankingPremiumCacheKey(input: {
  viewerId?: string;
  participantId: string;
  scope: string;
  companyId?: string;
  simulatorId?: string;
  periodType: string;
  periodStart: Date | string;
  periodEnd: Date | string;
}) {
  return [
    input.viewerId || "anonymous",
    input.participantId,
    input.scope,
    input.companyId || "all-companies",
    input.simulatorId || "all-simulators",
    input.periodType,
    new Date(input.periodStart).toISOString(),
    new Date(input.periodEnd).toISOString(),
  ].map((value) => encodeURIComponent(String(value))).join("|");
}

export function readRankingPremiumCache(key: string): RankingPremiumCacheRecord | null {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(key)) || "null");
    if (!value || value.key !== key || typeof value.updatedAt !== "number") return null;
    return value as RankingPremiumCacheRecord;
  } catch {
    return null;
  }
}

export function writeRankingPremiumCache(record: RankingPremiumCacheRecord): void {
  try {
    localStorage.setItem(storageKey(record.key), JSON.stringify(record));
    const records: { key: string; updatedAt: number; size: number }[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index) || "";
      if (!key.startsWith(PREFIX)) continue;
      const raw = localStorage.getItem(key) || "";
      try { records.push({ key, updatedAt: Number(JSON.parse(raw).updatedAt || 0), size: raw.length }); }
      catch { localStorage.removeItem(key); }
    }
    records.sort((a, b) => a.updatedAt - b.updatedAt);
    let total = records.reduce((sum, entry) => sum + entry.size, 0);
    while (records.length > MAX_RECORDS || total > MAX_RECORD_BYTES) {
      const removed = records.shift();
      if (!removed) break;
      localStorage.removeItem(removed.key);
      total -= removed.size;
    }
  } catch { /* cache is optional; confirmed live data remains authoritative */ }
}

export function invalidateRankingPremiumCache(key: string): void {
  try { localStorage.removeItem(storageKey(key)); } catch { /* optional cache */ }
}

export function clearRankingPremiumCache(): void {
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index) || "";
      if (key.startsWith(PREFIX)) localStorage.removeItem(key);
    }
  } catch { /* optional cache */ }
}
