import fs from "node:fs";
import assert from "node:assert/strict";

const dashboard = fs.readFileSync("src/pages/driver/Dashboard.tsx", "utf8");
const history = fs.readFileSync("src/pages/driver/TripHistory.tsx", "utf8");

assert.match(dashboard, /canonicalOperationTripsOverride=\{currentOperationTrips\}/,
  "Dashboard must pass the exact canonical operation projection to embedded TripHistory");
assert.match(history, /embeddedJob && Array\.isArray\(canonicalOperationTripsOverride\)/,
  "Embedded TripHistory must prefer the canonical operation projection");
assert.match(history, /canonicalOperationTripsOverride[\s\S]*?normalizeTrip[\s\S]*?trip\.isValid/,
  "Canonical override must retain normal history validity filtering");
console.log("PASS: operation counter and embedded history consume one canonical trip set");
