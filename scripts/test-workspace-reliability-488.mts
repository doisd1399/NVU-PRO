import assert from "node:assert/strict";
import { formatGoalAmount, formatGoalDraft, parseGoalAmount } from "../src/lib/goalMoneyInput.ts";
import { needsSessionReconnect, nextSessionGeneration } from "../src/lib/sessionRefreshPolicy.ts";
import { createRuntimeStartup } from "../src/lib/runtimeStartup.ts";
import { CanonicalTripRepository } from "../src/repositories/CanonicalTripRepository.ts";
import type { OfflineDatabase } from "../src/services/offline/OfflineDatabase.ts";

for (const [raw, formatted, amount] of [["1000000", "1.000.000", 1000000], ["250000,50", "250.000,50", 250000.5], ["0,01", "0,01", .01], ["R$ 1.234.567,89", "1.234.567,89", 1234567.89]] as const) {
  assert.equal(formatGoalDraft(raw), formatted); assert.equal(parseGoalAmount(formatted), amount);
}
assert.equal(formatGoalAmount(1000000), "1.000.000,00");
assert.equal(formatGoalDraft("1234,"), "1.234,");
assert.equal(formatGoalDraft(""), "");
for (const raw of ["", "0", "-1", "1,234", "1e6", "1234.56", "1.23,00", "1,2,3", "Infinity", "1000000000000001"]) assert(Number.isNaN(parseGoalAmount(raw)), raw);
assert(Number.isNaN(parseGoalAmount(formatGoalDraft("1234.56"))), "Ambiguous pasted decimals cannot become a hundredfold larger amount");
assert.equal(formatGoalDraft("1.2345", true), "12.345", "Inserting a digit into an already grouped value preserves its intended whole reais");

const healthy = { manual: false, uid: "A", profileUid: "A", userListenerConnected: true, membershipListenerConnected: true, membershipConfirmed: true };
for (let n = 0; n < 100; n++) assert(!needsSessionReconnect(healthy), "Healthy resume and online events cannot rebuild listeners");
assert(needsSessionReconnect({ ...healthy, manual: true }));
assert(needsSessionReconnect({ ...healthy, uid: "B" }));
assert(needsSessionReconnect({ ...healthy, userListenerConnected: false }));
assert(needsSessionReconnect({ ...healthy, membershipListenerConnected: false }));
assert(needsSessionReconnect({ ...healthy, membershipConfirmed: false }));
assert(!needsSessionReconnect({ ...healthy, uid: null }));
assert.equal(nextSessionGeneration("A", "A", 7), 7);
assert.equal(nextSessionGeneration("A", "B", 7), 8);
assert.equal(nextSessionGeneration("A", null, 7), 8);
assert.equal(nextSessionGeneration(null, "A", 0), 1);

const calls: string[] = []; let available = false;
const start = createRuntimeStartup([() => { calls.push("migration"); }, () => { calls.push("hydrate"); if (!available) throw Error("OFFLINE_STORAGE_READ_FAILED"); }, () => { calls.push("sync"); }]);
assert.throws(start, /OFFLINE_STORAGE_READ_FAILED/);
assert.throws(start, /OFFLINE_STORAGE_READ_FAILED/);
available = true; start(); start();
assert.deepEqual(calls, ["migration", "hydrate", "hydrate", "hydrate", "sync"], "Retry cannot bypass the failed step or install background services twice");
let reads = 0;
const repository = new CanonicalTripRepository({ database: { list() { reads++; if (reads === 1) throw Error("OFFLINE_STORAGE_UNAVAILABLE"); return []; } } as unknown as OfflineDatabase });
assert.throws(() => repository.hydrate(), /OFFLINE_STORAGE_UNAVAILABLE/);
repository.hydrate(); repository.hydrate(); assert.equal(reads, 2, "Failed hydration must be retryable rather than permanently marked complete");
console.log("WORKSPACE_RELIABILITY_488_PASS money, resume deduplication, identity generation, startup retry and repository recovery");
