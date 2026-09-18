import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relativePath) =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const app = read("src/App.tsx");
const admin = read("src/layouts/AdminLayout.tsx");
const driver = read("src/layouts/DriverLayout.tsx");
const routeWarmup = read("src/lib/routePreload.ts");
const company = read("src/context/CompanyContext.tsx");
const pending = read("src/hooks/useCurrentUserPendingApplications.ts");

assert.match(app, /const AdminLayout = lazy\(\(\) => import\("\.\/layouts\/AdminLayout"\)\)/);
assert.match(app, /const DriverLayout = lazy\(\(\) => import\("\.\/layouts\/DriverLayout"\)\)/);
assert.match(app, /preloadRoute\("\/admin\/fleet"\)/);
assert.match(app, /preloadRoute\("\/driver\/profile"\)/);
assert.doesNotMatch(app, /operationalReadiness/);
assert.match(admin, /if \(!currentUser\) return null/);
assert.match(driver, /if \(!currentUser\) return null/);
assert.doesNotMatch(admin, /operationalReadiness/);
assert.doesNotMatch(driver, /operationalReadiness/);
assert.match(routeWarmup, /AdminLayout/);
assert.match(routeWarmup, /DriverLayout/);
assert.match(company, /getDocFromServer/);
assert.match(pending, /Promise\.all/);

console.log("workspace-shell-fast: PASS 13 structural checks");
