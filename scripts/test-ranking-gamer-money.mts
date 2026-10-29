import assert from "node:assert/strict";
import { getRankingLeadershipGap } from "../src/lib/rankingGamerMoney";

const entry = (val: unknown, currency = "BRL") => ({ name: "Participante", val, currency });
assert.equal(getRankingLeadershipGap([entry(125480.9), entry(98750.4)])?.amount, 26730.5);
assert.equal(getRankingLeadershipGap([entry(.3), entry(.2)])?.amount, .1);
assert.equal(getRankingLeadershipGap([entry(1.005), entry(1)])?.amount, .01);
assert.equal(getRankingLeadershipGap([entry(10), entry(10)])?.amount, 0);
assert.equal(getRankingLeadershipGap([entry(10, "EUR"), entry(2, "EUR")])?.currency, "EUR");
assert.equal(getRankingLeadershipGap([]), null);
assert.equal(getRankingLeadershipGap([entry(10)]), null);
assert.equal(getRankingLeadershipGap([entry(10), entry(2, "EUR")]), null);
assert.equal(getRankingLeadershipGap([entry(10, "UNKNOWN"), entry(2, "UNKNOWN")]), null);
assert.equal(getRankingLeadershipGap([{ ...entry(10), currencyUnresolvedTrips: 1 }, entry(2)]), null);
assert.equal(getRankingLeadershipGap([{ ...entry(10), currencyMissingValueTrips: 1 }, entry(2)]), null);
assert.equal(getRankingLeadershipGap([{ ...entry(10), currencyBreakdown: [{currency:"BRL",value:10},{currency:"EUR",value:2}] }, entry(2)]), null);
assert.equal(getRankingLeadershipGap([{ ...entry(10), currencyBreakdown: [{currency:"BRL",value:10,missingValueTrips:1}] }, entry(2)]), null);
assert.equal(getRankingLeadershipGap([{ ...entry(99), currencyBreakdown: [{currency:"BRL",value:10}] }, entry(2)])?.amount, 8);
for (const invalid of [-1, NaN, Infinity, undefined, "1.000,00", true, Number.MAX_SAFE_INTEGER]) {
  assert.equal(getRankingLeadershipGap([entry(invalid), entry(0)]), null);
}
assert.equal(getRankingLeadershipGap([entry(2), entry(10)]), null);
console.log("RANKING_GAMER_MONEY_PASS: comparison, cents, ties, mixed/unknown/incomplete currency and invalid values");
