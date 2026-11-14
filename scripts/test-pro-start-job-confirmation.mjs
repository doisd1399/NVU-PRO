import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const appContext = fs.readFileSync(path.join(root, "src/context/AppContext.tsx"), "utf8");
const dashboard = fs.readFileSync(path.join(root, "src/pages/driver/Dashboard.tsx"), "utf8");
const idlePanel = fs.readFileSync(path.join(root, "src/components/driver/DriverIdlePanel.tsx"), "utf8");
const availability = fs.readFileSync(path.join(root, "src/lib/proLaunchAvailability.ts"), "utf8");
const rules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");
const outbox = fs.readFileSync(path.join(root, "src/application/operation/DurableOperationOutbox.ts"), "utf8");
const adapter = fs.readFileSync(path.join(root, "src/services/operationOutbox.ts"), "utf8");
const gateway = fs.readFileSync(path.join(root, "src/application/operation/CanonicalOperationCommandService.ts"), "utf8");

function count(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

// A durable local start is usable offline and is explicitly pending. Remote
// confirmation is still required before receipts can reach the canonical writer.
assert.match(appContext, /operationOutbox\.enqueueStart/, "startJob must await durable local persistence");
assert.match(appContext, /await mirrorOperationStart/, "native upload barrier must precede the local start");
assert.match(outbox, /operationSyncState: "pending_start"/, "provisional active state must carry its pending marker");
assert.match(outbox, /storage\.getItem\(prefix \+ uid\) !== raw/, "local success must verify persisted bytes");
assert.match(outbox, /job\?\.id !== entry\.jobId \|\| job\.companyId !== entry\.companyId \|\| job\.driverId !== uid/, "start ACK must match exact operation/owner/company");
assert.match(adapter, /canonicalOperationCommandService\.startLegacyOperation/);
assert.match(gateway, /runTransaction/, "legacy server transition must be atomic");
assert.match(appContext, /startJobInFlightRef/, "startJob must have an in-flight guard");
assert.match(appContext, /operationOutbox\.project\(serverJobs/, "server rows and owner-scoped local state converge in one projection");
assert.ok(count(appContext, /startJobInFlightRef\.current\.add/g) === 1, "startJob should register one in-flight guard");
assert.ok(count(appContext, /startJobInFlightRef\.current\.delete/g) === 1, "startJob should release one in-flight guard");

// The UI must await the transition and visibly block the button.
assert.match(dashboard, /await startJob\(job\.id\)/, "Dashboard must await startJob");
assert.doesNotMatch(dashboard, /void startJob\(job\.id\)/, "Dashboard must not fire-and-forget startJob");
assert.match(dashboard, /startingJobId/, "Dashboard must expose starting state");
assert.match(dashboard, /startingJobId=\{startingJobId\}/, "Dashboard must pass the starting state to the assigned queue");
assert.match(dashboard, /suspended=\{operationalSuspension\.active\}/, "Dashboard must pass the suspension state to the assigned queue");
assert.match(idlePanel, /Iniciando operação/, "Assigned queue must show transition feedback");
assert.match(idlePanel, /disabled=\{suspended \|\| Boolean\(startingJobId\)\}/, "Assigned queue must block duplicate starts");

// Pending remains visible but cannot launch Pro; recordable states remain governed by jobStatus.
assert.match(availability, /status === \"pending\"[\s\S]{0,220}canLaunch: false/, "pending must remain blocked");
assert.match(availability, /isTripRecordableJobStatus\(status, progress, totalDeliveries\)/, "ready states must use the existing recordable guard");

// Firestore rules must continue to restrict the driver transition to pending -> active.
assert.match(rules, /resource\.data\.status == 'pending'/, "rules must identify pending source state");
assert.match(rules, /request\.resource\.data\.status == 'active'/, "rules must identify active target state");
assert.match(rules, /changed\.hasOnly\(\['status'\]\)/, "driver transition must only change status");

console.log("PASS: startJob commits durable pending state, blocks duplicate starts and pre-ACK uploads, validates exact server ACK and keeps Firestore transition narrow");
