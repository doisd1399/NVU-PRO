import assert from "node:assert/strict";
import { settleCompanyChunks, ABSENT_RECHECK_MS } from "../src/lib/rankingCompaniesSettlement.ts";
import { buildDriverRankingFromAggregate, parseRankingAggregateDocument } from "../src/lib/rankingAggregates.ts";

const doc = (id: string) => ({ id, data: () => ({ companyName: id }) });
const ok = (...ids: string[]) => ({ status: "fulfilled", value: { docs: ids.map(doc) } }) as const;
const bad = (message: string) => ({ status: "rejected", reason: new Error(message) }) as const;

// Everything answered and listed: complete, nothing absent.
let r = settleCompanyChunks(["a", "b"], [ok("a", "b")]);
assert.equal(r.confirmed, true); assert.deepEqual(r.absent, []); assert.deepEqual([...r.merged.keys()].sort(), ["a", "b"]);
// A deleted company: the server answered, it is not listed. That is a definite answer, not a failure.
r = settleCompanyChunks(["a", "gone", "b"], [ok("a"), ok("b")]);
assert.equal(r.confirmed, true, "an answered chunk without a company means confirmed absent");
assert.deepEqual(r.absent, ["gone"]); assert.equal(r.firstError, null);
// A chunk that failed or timed out leaves the whole set unconfirmed, with nothing claimed absent.
r = settleCompanyChunks(["a", "b"], [ok("a"), bad("timeout")]);
assert.equal(r.confirmed, false); assert.deepEqual(r.absent, []); assert.equal((r.firstError as Error).message, "timeout");
assert.equal(settleCompanyChunks(["a"], []).confirmed, false, "no answer at all is not a confirmation");
assert.ok(ABSENT_RECHECK_MS < 120_000, "absent companies are re-checked sooner than a normal confirmation");

// A past month whose aggregate names a deleted company ranks the remaining drivers and does not throw.
const aggregate = parseRankingAggregateDocument({ schemaVersion: 4, simulatorId: "gto", periodType: "mes", periodKey: "2026-09", complete: true, periodTimeZone: "America/Sao_Paulo", periodPolicy: "SAO_PAULO_CALENDAR",
  lastReconciledAt: "2026-10-20T00:00:00Z", companies: { live: { companyId: "live", val: 100, trips: 2 }, gone: { companyId: "gone", val: 900, trips: 9 } },
  drivers: { d1: { driverId: "d1", companyId: "live", val: 100, trips: 2 }, d2: { driverId: "d2", companyId: "gone", val: 900, trips: 9 } } } as any);
if (aggregate) {
  const ranking = buildDriverRankingFromAggregate(aggregate, [], [{ id: "live", companyName: "Viva", simulatorId: "gto", status: "active" }], [{ id: "gto", name: "GTO" }], []);
  assert(Array.isArray(ranking));
  assert(!ranking.some(item => item.companyId === "gone"), "a participant of a deleted company is not ranked");
}
console.log("RANKING_COMPANIES_SETTLEMENT_PASS", aggregate ? "with-aggregate" : "aggregate-shape-skipped");
