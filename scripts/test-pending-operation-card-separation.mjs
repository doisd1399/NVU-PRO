import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relativePath) =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const currentOperation = read("src/lib/currentOperation.ts");
const jobStatus = read("src/lib/jobStatus.ts");
const dashboard = read("src/pages/driver/Dashboard.tsx");
const profile = read("src/pages/driver/Profile.tsx");
const appContext = read("src/context/AppContext.tsx");
const proAvailability = read("src/lib/proLaunchAvailability.ts");

assert.match(currentOperation, /import \{ isRunningJobStatus \} from "\.\/jobStatus"/);
assert.match(currentOperation, /isRunningJobStatus\(job\.status\)/);
assert.match(jobStatus, /OPEN_JOB_STATUSES = \[[\s\S]*"pending"/);
assert.match(jobStatus, /RUNNING_JOB_STATUSES = \[[\s\S]*"active"/);
assert.doesNotMatch(
  jobStatus.match(/RUNNING_JOB_STATUSES = \[[\s\S]*?\] as const;/)?.[0] || "",
  /"pending"/,
);

assert.match(dashboard, /j\.status === "pending"/);
assert.match(dashboard, /await startJob\(job\.id\)/);
const dashboardCard = dashboard.match(/\/\* Main Job Card \*\/[\s\S]*?\/\* Content Area \*\//)?.[0] || "";
assert.ok(dashboardCard, "Dashboard must keep a dedicated current-operation card section");
assert.match(dashboardCard, /TRABALHO ATIVO/);
assert.doesNotMatch(dashboardCard, /PENDENTE/);

assert.match(profile, /isRunningJobStatus\(\s*String\(cachedOperationSnapshot\.job\.status \|\| ""\)/);
assert.match(profile, /isRunningJobStatus\(displayActiveJob\.status\)/);
const profileCard = profile.match(/\/\* Active Job Section \*\/[\s\S]*?\{activeOperationCardJob \? \(/)?.[0] || "";
assert.ok(profileCard, "Profile must gate the active card with activeOperationCardJob");
assert.doesNotMatch(profileCard, /PENDENTE/);

assert.match(appContext, /isRunningJobStatus\(job\.status\)/);
assert.match(proAvailability, /status === "pending"/);
assert.match(proAvailability, /canLaunch: false/);

console.log("pending-operation-card-separation: PASS pending stays assigned-only; current operation requires running state");
