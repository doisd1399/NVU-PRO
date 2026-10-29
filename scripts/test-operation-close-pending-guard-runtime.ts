import assert from "node:assert/strict";
import { inspectOperationCloseQueue } from "../src/lib/operationCloseQueueGuard";

const jobA = "job-a-immutable-id";
const sameNameDifferentJob = "job-b-same-display-name";
const blockedStatuses = ["WAITING", "SENDING", "AUTH_REQUIRED", "FAILED", "PERMISSION_PAUSED"];

assert.deepEqual(
  inspectOperationCloseQueue({ ownerAuthenticated: false, pendingProTrips: [{ jobId: jobA, queueStatus: "FAILED" }] }, jobA),
  { status: "unverified", unresolvedCount: 0 },
);
assert.deepEqual(
  inspectOperationCloseQueue({ ownerAuthenticated: true }, jobA),
  { status: "unverified", unresolvedCount: 0 },
);
assert.deepEqual(
  inspectOperationCloseQueue({ ownerAuthenticated: true, ownerMismatch: true, pendingProTrips: [] }, jobA),
  { status: "unverified", unresolvedCount: 0 },
);

for (const queueStatus of blockedStatuses) {
  assert.deepEqual(
    inspectOperationCloseQueue({
      ownerAuthenticated: true,
      pendingProTrips: [{ jobId: jobA, queueStatus }],
    }, jobA),
    { status: "pending", unresolvedCount: 1 },
    `${queueStatus} must block completion for the exact operation`,
  );
}

const otherOperationOnly = Object.freeze([
  Object.freeze({ jobId: sameNameDifferentJob, operationName: "Carga Norte", queueStatus: "FAILED" }),
]);
assert.deepEqual(
  inspectOperationCloseQueue({ ownerAuthenticated: true, pendingProTrips: otherOperationOnly }, jobA),
  { status: "ready", unresolvedCount: 0 },
  "same display name never couples different immutable jobIds",
);
assert.deepEqual(
  inspectOperationCloseQueue({
    ownerAuthenticated: true,
    pendingProTrips: [
      { jobId: jobA, queueStatus: "SYNCED" },
      { jobId: sameNameDifferentJob, queueStatus: "FAILED" },
    ],
  }, jobA),
  { status: "ready", unresolvedCount: 0 },
);

const frozenInput = Object.freeze({
  ownerAuthenticated: true,
  pendingProTrips: Object.freeze([Object.freeze({ jobId: jobA, queueStatus: "FAILED" })]),
});
const before = JSON.stringify(frozenInput);
assert.equal(inspectOperationCloseQueue(frozenInput, jobA).status, "pending");
assert.equal(JSON.stringify(frozenInput), before, "inspection must not mutate preferences, queue, or status");

console.log(`OPERATION CLOSE QUEUE GUARD PASS: ${blockedStatuses.length} blocking states, auth fail-closed, exact jobId, no mutation/retry`);
