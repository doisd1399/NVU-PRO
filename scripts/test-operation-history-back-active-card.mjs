import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relativePath) =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const profile = read("src/pages/driver/Profile.tsx");
const dashboard = read("src/pages/driver/Dashboard.tsx");
const tripHistory = read("src/pages/driver/TripHistory.tsx");
const app = read("src/App.tsx");
const safeBack = read("src/lib/safeBackNavigation.ts");

// Both entry points now retain one Dashboard, so the canonical guard lives
// in that shared component instead of a second, independently styled card.
assert.equal((profile.match(/<Dashboard\b/g) || []).length, 1);
assert.match(profile, /operationCardOnly=\{activeTab === "operations"\}/);
assert.match(profile, /activeOperationResolved/);
assert.match(dashboard, /selectCurrentOperationJob\(jobs, currentUser\?\.id, activeCompanyId\)/);
assert.match(dashboard, /if \(!myJob \|\| !contract\) \{/);
assert.match(dashboard, /if \(operationCardOnly\) \{/);
assert.doesNotMatch(profile, /\{displayActiveJob \? \(/);

assert.match(tripHistory, /handleSafeRouteBack\(navigate, "\/driver\/profile"/);
assert.match(tripHistory, /profileTab: "operations"/);
assert.match(safeBack, /handleSafeAppBack/);
assert.match(safeBack, /replaceAppLocation\("\/driver\/profile"/);
assert.match(app, /handleSafeAppBack\(\{/);
assert.doesNotMatch(app, /if \(canGoBack\) \{[\s\S]{0,100}exitApp\(\)/);

console.log("operation-history-back-active-card: PASS active-card authority and safe Android back");
