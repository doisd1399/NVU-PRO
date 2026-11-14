import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const checks = [
  ["src/pages/admin/fleet/OperationsTab.tsx", [/fallbackCandidates/, /matchedJob\s*=\s*candidates/]],
  ["src/lib/tripHistoryEngine.ts", [/trip\.operationId\s*\|\|/, /metricDate.*assignedAt/]],
  ["src/lib/operationTripRecovery.ts", [/trip\.jobId\s*\|\|\s*trip\.operationId/]],
  ["src/services/operationReconciliationService.ts", [/trip\.operationId\s*\|\|\s*trip\.jobId/]],
  ["src/services/sync/SyncEngine.ts", [/trip\.operationId\s*\|\|\s*trip\.jobId/]],
  ["src/services/syncManager.ts", [/trip\.operationId\s*\|\|\s*trip\.jobId/, /payload\.operationId\s*\|\|/]],
  ["src/services/sync/FirebaseTripSyncAdapter.ts", [/current\.jobId\s*\|\|\s*current\.operationId/, /trip as any\)\.jobId\s*\|\|\s*\(trip as any\)\.operationId/]],
  ["functions/src/canonicalOperationProjection.ts", [/field\(row,\s*["']jobId["'],\s*["']operationId["']/]],
  ["functions/src/reconcileOperationProjectionOnTripWrite.ts", [/field\(row,\s*["']jobId["'],\s*["']operationId["']/]],
  ["functions/src/reconcileOperationTrips.ts", [/field\((?:row|claim|claimData),\s*["']jobId["'],\s*["']operationId["']/]],
  ["functions/src/registerCanonicalSimpleTrip.ts", [/trip\.jobId\s*\|\|\s*trip\.operationId/]],
  ["functions/src/registerGtoProReceipt.ts", [/field\(row,\s*["']jobId["'],\s*["']operationId["']/]],
];
const failures = [];
for (const [relative, patterns] of checks) {
  const content = fs.readFileSync(`${root}${relative}`, "utf8");
  for (const pattern of patterns) if (pattern.test(content)) failures.push(`${relative}: forbidden ${pattern}`);
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`JOBID_EXECUTION_BOUNDARY_PASS ${checks.length} critical files; exact jobId scope enforced`);
