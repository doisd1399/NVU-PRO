import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const critical = [
  "src/lib/proLaunchAvailability.ts",
  "src/services/simpleAutomationLauncher.ts",
  "src/services/simpleAutomationCompletionService.ts",
  "src/components/SimpleAutomationCompletionBridge.tsx",
  "src/services/gtoWorkLauncher.ts",
  "src/pages/driver/Dashboard.tsx",
  "src/pages/driver/Profile.tsx",
  "src/services/sync/FirebaseTripSyncAdapter.ts",
  "android/app/src/main/java/com/nvu/operacional/SimpleAutomationService.java",
  "android/app/src/main/java/com/nvu/operacional/SimpleAutomationPlugin.java",
  "android/app/src/main/java/com/nvu/operacional/SimpleProNativeSubmissionCoordinator.java",
];

const violations = [];
const forbiddenDecision = /(?:job|currentJob|jobState|preferences?|status)\??\.?(?:progress|jobProgress)\s*(?:>=|>|<=|<|===|!==|==|!=)|(?:progress|jobProgress)\s*\+\s*1|(?:operationSlot|slotNumber)\s*=\s*[^;\n]*(?:progress|jobProgress|job\.progress)/;
const oldCounterFallback = /(?:currentJob|job|jobState)\??\.progress\s*\?\?/;
const comment = (line) => /^\s*(?:\/\/|\*|\#)/.test(line);

for (const relative of critical) {
  const lines = read(relative).split("\n");
  lines.forEach((line, index) => {
    if (comment(line)) return;
    if (forbiddenDecision.test(line) || oldCounterFallback.test(line)) {
      violations.push(`${relative}:${index + 1}: ${line.trim()}`);
    }
  });
}

const adapter = read("src/services/sync/FirebaseTripSyncAdapter.ts");
assert.doesNotMatch(adapter, /maxConfirmedSlot/);
assert.doesNotMatch(adapter, /const\s+operationSlot\s*=\s*Math\.max/);
assert.doesNotMatch(adapter, /progress:\s*progress\s*\+\s*1/);
assert.doesNotMatch(adapter, /operationSlot,\s*operationSlotKey/);

const simpleService = read("android/app/src/main/java/com/nvu/operacional/SimpleAutomationService.java");
assert.match(simpleService, /confirmedTripCount/);
assert.doesNotMatch(simpleService, /confirmedTripCount\s*\+\s*pendingTripCountForCurrentScope\(\)\s*>=/);
assert.equal(violations.length, 0, `canonical read boundary violations:\n${violations.join("\n")}`);

console.log(`CANONICAL_OPERATION_READ_BOUNDARY_PASS ${critical.length} critical readers audited`);
