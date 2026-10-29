import assert from "node:assert/strict";
import { selectCurrentOperationJob, selectCurrentOperationJobs } from "../src/lib/currentOperation";
import { resolveCurrentFleetUsageJobs } from "../src/lib/fleetUsage";

const stamp = (iso: string) => ({ seconds: Date.parse(iso) / 1000 });
const scope = { driverId: "david", companyId: "dc", vehicleId: "scania-g" };
const legacy = { ...scope, id: "june-legacy", status: "active", assignedAt: stamp("2026-06-29T10:00:00Z"), updatedAt: "2026-10-10T23:36:00Z" };
const historical = { ...scope, id: "september-bls10", status: "completed", assignedAt: stamp("2026-09-01T10:00:00Z"), completedAt: "2026-09-07T10:00:00Z" };
const current = { ...scope, id: "october-bls120", status: "awaiting_completion", assignedAt: stamp("2026-10-01T10:00:00Z"), progress: 10, totalDeliveries: 10 };
const members = [{ userId: "david", companyId: "dc", role: "driver", status: "active" }];
for (const jobs of [[legacy, historical, current], [current, legacy, historical], [historical, current, legacy]]) {
  assert.equal(selectCurrentOperationJob(jobs, "david", "dc")?.id, current.id);
  assert.deepEqual(selectCurrentOperationJobs(jobs, "dc").map(job => job.id), [current.id]);
  assert.deepEqual(resolveCurrentFleetUsageJobs({ jobs, members, companyId: "dc" }).map(job => job.id), [current.id]);
}
const pending = { ...scope, id: "tomorrow", status: "pending", assignedAt: "2026-10-11T10:00:00Z" };
assert.equal(selectCurrentOperationJob([legacy, historical, current, pending], "david", "dc")?.id, current.id);
assert.equal(selectCurrentOperationJob([legacy, historical, current, { ...pending, status: "cancelled" }], "david", "dc")?.id, current.id);
const completed = { ...current, status: "completed" };
assert.equal(selectCurrentOperationJob([legacy, historical, completed, pending], "david", "dc"), null, "closing current cannot resurrect the June record or start a pending assignment");
assert.deepEqual(resolveCurrentFleetUsageJobs({ jobs: [legacy, historical, completed], members, companyId: "dc" }), []);
assert.equal(selectCurrentOperationJob([current, { ...current, companyId: "foreign", assignedAt: "2026-10-12T10:00:00Z" }], "david", "dc")?.companyId, "dc");
const dateMethod = { ...current, assignedAt: { toDate: () => new Date("2026-10-01T10:00:00Z") } };
const millisMethod = { ...current, assignedAt: { toMillis: () => Date.parse("2026-10-01T10:00:00Z") } };
assert.equal(selectCurrentOperationJob([legacy, dateMethod], "david", "dc")?.id, current.id);
assert.equal(selectCurrentOperationJob([legacy, millisMethod], "david", "dc")?.id, current.id);
console.log("OPERATION_SELECTION_PARITY_PASS driver/company/fleet, Timestamp, immutable assignment order, awaiting confirmation, no legacy resurrection, account/company scope");
