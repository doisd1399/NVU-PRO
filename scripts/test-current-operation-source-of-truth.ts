import assert from "node:assert/strict";
import {
  deriveCurrentOperationProgress,
  selectCurrentOperationJob,
} from "../src/lib/currentOperation";

const job = (input: Record<string, unknown>) => ({
  id: String(input.id),
  driverId: "driver-1",
  status: "active",
  progress: 0,
  createdAt: "2026-09-12T10:00:00.000Z",
  ...input,
});

const activeOlder = job({
  id: "active-older",
  assignedAt: "2026-09-12T10:00:00.000Z",
});
const pendingNewer = job({
  id: "pending-newer",
  status: "pending",
  assignedAt: "2026-09-12T12:00:00.000Z",
});
assert.equal(
  selectCurrentOperationJob([pendingNewer, activeOlder], "driver-1")?.id,
  "active-older",
  "an active operation must outrank a pending assignment",
);
assert.equal(
  selectCurrentOperationJob([pendingNewer], "driver-1"),
  null,
  "a pending assignment must remain in the assigned queue and never become the current operation",
);

const activeNewestAssignment = job({
  id: "active-newest-assignment",
  assignedAt: "2026-09-12T13:00:00.000Z",
  updatedAt: "2026-09-12T13:30:00.000Z",
});
assert.equal(
  selectCurrentOperationJob([activeOlder, activeNewestAssignment], "driver-1")?.id,
  "active-newest-assignment",
  "same-status operations must use the newest assignment timestamp",
);

const updatedOnly = job({
  id: "active-updated-only",
  assignedAt: undefined,
  updatedAt: "2026-09-12T14:00:00.000Z",
});
assert.equal(
  selectCurrentOperationJob([activeOlder, updatedOnly], "driver-1")?.id,
  "active-updated-only",
  "updatedAt must be used when assignedAt is absent",
);

const otherDriver = job({
  id: "other-driver",
  driverId: "driver-2",
  assignedAt: "2026-09-12T23:00:00.000Z",
});
assert.equal(
  selectCurrentOperationJob([otherDriver, activeOlder], "driver-1")?.id,
  "active-older",
  "another driver operation must never become current",
);

assert.equal(
  selectCurrentOperationJob([job({ id: "completed", status: "completed" })], "driver-1"),
  null,
  "terminal jobs must not become current",
);

const liveJob = job({
  id: "job-live",
  contractId: "contract-1",
  companyId: "company-1",
  progress: 2,
  assignedAt: "2026-09-12T10:00:00.000Z",
});
const liveTrips = [
  { id: "trip-1", jobId: "job-live", driverId: "driver-1", status: "completed", completedAt: "2026-09-12T11:00:00.000Z" },
  { id: "trip-2", trabalhoId: "job-live", motoristaId: "driver-1", status: "concluida", completedAt: "2026-09-12T12:00:00.000Z" },
  { id: "trip-3", contrato_id: "contract-1", motorista_id: "driver-1", status: "completed", completedAt: "2026-09-12T13:00:00.000Z" },
  { id: "wrong-driver", jobId: "job-live", driverId: "driver-2", status: "completed", completedAt: "2026-09-12T14:00:00.000Z" },
  { id: "wrong-job", contractId: "contract-2", driverId: "driver-1", status: "completed", completedAt: "2026-09-12T14:00:00.000Z" },
];
assert.equal(
  deriveCurrentOperationProgress(liveJob, liveTrips, "driver-1"),
  3,
  "live historical trips must replace a stale job progress without crossing operation/driver boundaries",
);

assert.equal(
  selectCurrentOperationJob(
    [
      { ...activeOlder, companyId: "company-1" },
      { ...activeNewestAssignment, companyId: "company-2" },
    ],
    "driver-1",
    "company-1",
  )?.id,
  "active-older",
  "active company must constrain current operation selection",
);

console.log("current-operation-source-of-truth: PASS shared job/company selection and live progress aliases");
