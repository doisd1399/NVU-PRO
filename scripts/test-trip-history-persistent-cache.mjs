import assert from "node:assert/strict";
import fs from "node:fs";

const storage = new Map();
globalThis.window = {
  localStorage: {
    get length() {
      return storage.size;
    },
    key(index) {
      return [...storage.keys()][index] ?? null;
    },
    getItem(key) {
      return storage.get(key) ?? null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    },
  },
};

const {
  buildTripHistoryCacheScope,
  readTripHistoryCache,
  writeTripHistoryCache,
  clearTripHistoryCacheForUser,
  tripHistoryCacheContract,
} = await import("../src/lib/tripHistoryPersistentCache.ts");

const scopeACompany1 = { userId: "uid-a", companyId: "company-1" };
const scopeBCompany1 = { userId: "uid-b", companyId: "company-1" };
const scopeACompany2 = { userId: "uid-a", companyId: "company-2" };
const trips = [
  { id: "trip-2", companyId: "company-1", completedAt: "2026-09-07T12:00:00.000Z" },
  { id: "trip-1", companyId: "company-1", completedAt: "2026-09-06T12:00:00.000Z" },
];

assert.equal(tripHistoryCacheContract.version, 2);
assert.equal(
  buildTripHistoryCacheScope(scopeACompany1),
  "user:uid-a:company:company-1",
);

writeTripHistoryCache(scopeACompany1, trips);
writeTripHistoryCache(scopeBCompany1, [
  { id: "trip-b", companyId: "company-1", completedAt: "2026-09-07T13:00:00.000Z" },
]);
writeTripHistoryCache(scopeACompany2, [
  { id: "trip-a2", companyId: "company-2", completedAt: "2026-09-07T14:00:00.000Z" },
]);

assert.deepEqual(readTripHistoryCache(scopeACompany1)?.trips, trips);
assert.deepEqual(readTripHistoryCache(scopeBCompany1)?.trips.map((trip) => trip.id), ["trip-b"]);
assert.deepEqual(readTripHistoryCache(scopeACompany2)?.trips.map((trip) => trip.id), ["trip-a2"]);
assert.equal(readTripHistoryCache({ userId: "uid-c", companyId: "company-1" }), null);

// Age is metadata, not a destructive invalidation rule for first paint.
const keyA = [...storage.keys()].find((key) => key.includes("uid-a") && key.includes("company-1"));
assert.ok(keyA);
const staleRecord = JSON.parse(storage.get(keyA));
staleRecord.cachedAt = Date.now() - 30 * 24 * 60 * 60 * 1000;
storage.set(keyA, JSON.stringify(staleRecord));
assert.deepEqual(readTripHistoryCache(scopeACompany1)?.trips, trips);

// UID/company scope mismatch and corruption never produce visible data.
storage.set(keyA, JSON.stringify({ ...staleRecord, scope: "user:uid-b:company:company-1" }));
assert.equal(readTripHistoryCache(scopeACompany1), null);
writeTripHistoryCache(scopeACompany1, trips);
storage.set(keyA, JSON.stringify({ version: 999, scope: "bad", cachedAt: Date.now(), trips }));
assert.equal(readTripHistoryCache(scopeACompany1), null);

writeTripHistoryCache(scopeACompany1, trips);
clearTripHistoryCacheForUser("uid-a");
assert.equal(readTripHistoryCache(scopeACompany1), null);
assert.equal(readTripHistoryCache(scopeACompany2), null);
assert.deepEqual(readTripHistoryCache(scopeBCompany1)?.trips.map((trip) => trip.id), ["trip-b"]);

const hookSource = fs.readFileSync(new URL("../src/hooks/useTripHistory.ts", import.meta.url), "utf8");
assert.match(hookSource, /readTripHistoryCache/);
assert.match(hookSource, /refreshing/);
assert.doesNotMatch(hookSource, /sessionStorage/);
assert.match(hookSource, /userId/);

console.log(
  "trip-history-persistent-cache: PASS cold start, stale retention, UID/company isolation, corruption rejection and scoped logout cleanup",
);
