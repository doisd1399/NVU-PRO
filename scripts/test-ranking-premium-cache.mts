import assert from "node:assert/strict";
import { makeRankingPremiumCacheKey, readRankingPremiumCache, writeRankingPremiumCache, invalidateRankingPremiumCache } from "../src/services/rankingPremiumCache";

class MemoryStorage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });

const base = {
  viewerId: "viewer-a", participantId: "driver-1", scope: "internal", companyId: "company-a",
  simulatorId: "sim-a", periodType: "semana", periodStart: new Date("2026-10-05T00:00:00Z"), periodEnd: new Date("2026-10-11T23:59:59Z"),
};
const key = makeRankingPremiumCacheKey(base);
const otherViewer = makeRankingPremiumCacheKey({ ...base, viewerId: "viewer-b" });
const otherCompany = makeRankingPremiumCacheKey({ ...base, companyId: "company-b" });
const monthly = makeRankingPremiumCacheKey({ ...base, periodType: "mes" });
assert.notEqual(key, otherViewer, "contas distintas não compartilham cache");
assert.notEqual(key, otherCompany, "empresas distintas não compartilham cache");
assert.notEqual(key, monthly, "períodos distintos não compartilham cache");
assert.equal(readRankingPremiumCache(key), null, "cache começa vazio");
writeRankingPremiumCache({ ...base, key, updatedAt: Date.now(), summary: { current: { val: 123.45, currency: "BRL", trips: 2 } } });
const restored = readRankingPremiumCache(key);
assert.equal((restored?.summary?.current as any)?.val, 123.45, "centavos são persistidos");
assert.equal((restored?.summary?.current as any)?.currency, "BRL", "moeda é persistida");
invalidateRankingPremiumCache(key);
assert.equal(readRankingPremiumCache(key), null, "invalidação remove somente a chave escopada");
console.log("RANKING_PREMIUM_CACHE_PASS 8 assertions; local persistence/isolation test");
