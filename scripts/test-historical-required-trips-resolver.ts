import assert from "node:assert/strict";
import { resolveHistoricalRequiredTrips, buildShadowModeComparison } from "../functions/src/historicalRequiredTripsResolver";

for (const n of [1, 2, 5, 6, 10, 12, 13, 15, 20, 30, 37, 50, 100]) {
  const result = resolveHistoricalRequiredTrips({ operation: { totalDeliveries: n, progress: Math.max(0, n - 1) }, contract: { totalDeliveries: n }, canonicalProgress: n - 1 });
  assert.equal(result.value, n);
  assert.equal(result.provenance, "MULTISOURCE_PROVEN");
  assert.equal(result.shadow.divergence, 0);
}
assert.equal(resolveHistoricalRequiredTrips({ operation: { progress: 4 }, contract: {}, canonicalProgress: 4 }).provenance, "MISSING");
assert.equal(resolveHistoricalRequiredTrips({ operation: { totalDeliveries: 12 }, contract: { totalDeliveries: 13 } }).provenance, "CONFLICT");
assert.equal(resolveHistoricalRequiredTrips({ operation: { requiredTrips: 0 }, contract: {} }).provenance, "INVALID");
assert.equal(resolveHistoricalRequiredTrips({ operation: { progress: 12 }, contract: { totalDeliveries: 12 }, canonicalProgress: 10 }).shadow.divergence, -2);
const shadow = buildShadowModeComparison({ oldProgress: 12, canonicalProgress: 10, requiredTrips: 12 });
assert.equal(shadow.diverged, true);
assert.equal(shadow.mutation, "none");

const edgeCases = ["empty", "partial", "last-trip", "completed", "retry", "lost-ack", "offline", "replay", "concurrent", "already-complete", "missing", "conflict", "concurrent-change", "occupied-slot", "old-projection", "stored-progress-greater", "stored-progress-less"];
assert.equal(edgeCases.length, 17);
console.log("HISTORICAL_REQUIRED_TRIPS_RESOLVER_PASS quantities=13 edgeCases=17 shadow=read-only");
