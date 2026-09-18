import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relativePath) =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const profile = read("src/pages/driver/Profile.tsx");
const tripHistory = read("src/pages/driver/TripHistory.tsx");
const app = read("src/App.tsx");
const safeBack = read("src/lib/safeBackNavigation.ts");

assert.match(profile, /const activeOperationCardJob =/);
assert.match(profile, /activeOperationResolved/);
assert.match(profile, /isRunningJobStatus\(displayActiveJob\.status\)/);
assert.match(profile, /displayActiveContract\.status !== "completed"/);
assert.match(profile, /\{activeOperationCardJob \? \(/);
assert.doesNotMatch(profile, /\{displayActiveJob \? \(/);

assert.match(tripHistory, /handleSafeRouteBack\(navigate, "\/driver\/profile"/);
assert.match(tripHistory, /profileTab: "operations"/);
assert.match(safeBack, /handleSafeAppBack/);
assert.match(safeBack, /replaceAppLocation\("\/driver\/profile"/);
assert.match(app, /handleSafeAppBack\(\{/);
assert.doesNotMatch(app, /if \(canGoBack\) \{[\s\S]{0,100}exitApp\(\)/);

console.log("operation-history-back-active-card: PASS active-card authority and safe Android back");
