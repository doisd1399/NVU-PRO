import assert from "node:assert/strict";
import {
  deriveCurrentOperationProgress,
  selectCurrentOperationJob,
} from "../src/lib/currentOperation";
import { filterAndSortTripHistory } from "../src/lib/tripHistoryEngine";

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
  createdAt: undefined,
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
const confirmed = { source: "gto_auto", uploadedAt: "2026-09-12T15:00:00.000Z", serverValidatedAt: "2026-09-12T15:00:00.000Z" };
const liveTrips = [
  { id: "trip-1", ...confirmed, jobId: "job-live", driverId: "driver-1", companyId: "company-1", contractId: "contract-1", status: "completed", completedAt: "2026-09-12T11:00:00.000Z" },
  { id: "trip-2", ...confirmed, jobId: "job-live", trabalhoId: "job-live", motoristaId: "driver-1", empresaId: "company-1", contratoId: "contract-1", status: "concluida", completedAt: "2026-09-12T12:00:00.000Z" },
  // Legacy history without a physical job binding is not attached to the
  // current operation, even when driver/company/contract/date look similar.
  { id: "trip-3", ...confirmed, contratoId: "contract-1", motoristaId: "driver-1", companyId: "company-1", status: "completed", completedAt: "2026-09-12T13:00:00.000Z" },
  { id: "wrong-driver", ...confirmed, jobId: "job-live", driverId: "driver-2", companyId: "company-1", contractId: "contract-1", status: "completed", completedAt: "2026-09-12T14:00:00.000Z" },
  { id: "wrong-job", ...confirmed, jobId: "job-other", contractId: "contract-2", driverId: "driver-1", companyId: "company-1", status: "completed", completedAt: "2026-09-12T14:00:00.000Z" },
];
assert.equal(
  deriveCurrentOperationProgress(liveJob, liveTrips, "driver-1"),
  2,
  "only server-confirmed and explicitly operation-bound trips can define current operation progress",
);
assert.equal(
  filterAndSortTripHistory(liveTrips, { embeddedJob: liveJob, driverId: "driver-1" }).some((trip) => trip.id === "trip-3"),
  false,
  "an unbound legacy trip must remain outside the embedded operational history",
);
assert.equal(
  filterAndSortTripHistory(liveTrips, { driverId: "driver-1" }).some((trip) => trip.id === "trip-3"),
  true,
  "an unbound legacy trip remains visible only in generic history",
);
assert.equal(
  deriveCurrentOperationProgress({ ...liveJob, progress: 4, totalDeliveries: 12,
    operationProgressReconciled: true }, liveTrips, "driver-1"),
  2,
  "a server cursor must not invent a trip missing from canonical operation history",
);
assert.equal(
  deriveCurrentOperationProgress({ ...liveJob, progress: 0, totalDeliveries: 12,
    operationProgressReconciled: true }, liveTrips, "driver-1"),
  2,
  "a server cursor must not promote unbound legacy history into confirmed operation progress",
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

console.log("current-operation-source-of-truth: PASS canonical progress, legacy history visibility and job/company selection");
