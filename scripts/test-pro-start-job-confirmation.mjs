import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const appContext = fs.readFileSync(path.join(root, "src/context/AppContext.tsx"), "utf8");
const dashboard = fs.readFileSync(path.join(root, "src/pages/driver/Dashboard.tsx"), "utf8");
const availability = fs.readFileSync(path.join(root, "src/lib/proLaunchAvailability.ts"), "utf8");
const rules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");

function count(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

// The transition must be confirmed from the server after the write.
assert.match(appContext, /getDocFromServer\(jobRef\)/, "startJob must read the authoritative job from the server");
assert.match(appContext, /await updateDoc\(jobRef, \{ status: \"active\" \}\)/, "startJob must write active status");
assert.match(appContext, /!confirmation\.exists\(\) \|\| confirmedStatus !== \"active\"/, "startJob must fail closed unless confirmation is active");
assert.match(appContext, /startJobInFlightRef/, "startJob must have an in-flight guard");
assert.match(appContext, /publishConfirmedJob[\s\S]{0,1800}mergeOperationalScopeSnapshot\(cacheKey, \{ jobs: nextCachedJobs \}\)/, "confirmed active job must update the scoped operational cache");
assert.ok(count(appContext, /startJobInFlightRef\.current\.add/g) === 1, "startJob should register one in-flight guard");
assert.ok(count(appContext, /startJobInFlightRef\.current\.delete/g) === 1, "startJob should release one in-flight guard");

// The UI must await the transition and visibly block the button.
assert.match(dashboard, /await startJob\(job\.id\)/, "Dashboard must await startJob");
assert.doesNotMatch(dashboard, /void startJob\(job\.id\)/, "Dashboard must not fire-and-forget startJob");
assert.match(dashboard, /startingJobId/, "Dashboard must expose starting state");
assert.match(dashboard, /Iniciando operação/, "Dashboard must show transition feedback");
assert.match(dashboard, /disabled=\{operationalSuspension\.active \|\| Boolean\(startingJobId\)\}/, "Dashboard must block duplicate starts");

// Pending remains visible but cannot launch Pro; recordable states remain governed by jobStatus.
assert.match(availability, /status === \"pending\"[\s\S]{0,220}canLaunch: false/, "pending must remain blocked");
assert.match(availability, /isTripRecordableJobStatus\(status, progress, totalDeliveries\)/, "ready states must use the existing recordable guard");

// Firestore rules must continue to restrict the driver transition to pending -> active.
assert.match(rules, /resource\.data\.status == 'pending'/, "rules must identify pending source state");
assert.match(rules, /request\.resource\.data\.status == 'active'/, "rules must identify active target state");
assert.match(rules, /affectedKeys\(\)\.hasOnly\(\['status'\]\)/, "driver transition must only change status");

console.log("PASS: startJob awaits server confirmation, blocks duplicates, preserves pending guard and keeps Firestore transition narrow");
