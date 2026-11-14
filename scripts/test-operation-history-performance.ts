import assert from "node:assert/strict";
import { getDriverLevelData } from "../src/lib/levelUtils";
import { selectCompletedOperationJobs, operationDateMs } from "../src/lib/operationResultSummary";

let identityReads = 0;
const jobs: any[] = Array.from({ length: 100 }, (_, index) => ({
  id: `job-${index}`, companyId: "company", driverId: "driver", contractId: "contract",
  status: "completed", totalDeliveries: 10, progress: 999,
  createdAt: "2026-09-01T00:00:00Z", completedAt: new Date(Date.UTC(2026, 9, 10, 0, index)).toISOString(),
}));
const trips: any[] = jobs.flatMap(job => Array.from({ length: 10 }, (_, slot) => ({
  id: `${job.id}-${slot}`, tripId: `${job.id}-${slot}`, canonicalTripId: `${job.id}-${slot}`,
  get jobId() { identityReads++; return job.id; },
  operationId: job.id, driverId: job.driverId, companyId: job.companyId, contractId: job.contractId,
  status: "SERVER_CONFIRMED", recordStatus: "completed", source: "gto_auto", uploadedAt: job.completedAt,
  serverValidatedAt: job.completedAt, completedAt: job.completedAt, createdAt: job.completedAt,
  origem: "A", destino: "B", valor: 10, currency: "BRL",
})));
const level = getDriverLevelData("driver", jobs, [{ id: "contract" }], trips);
assert.equal(level.totalDeliveries, 1000, "XP counts confirmed receipts instead of denormalized progress");
assert.equal(level.xp, 155000);
assert.equal(level.allCompletedJobs[0].id, "job-99");
assert.ok(identityReads < trips.length * 20, `history must be indexed before sorting/counting jobs: ${identityReads} identity reads for ${trips.length} trips`);
const reads = identityReads;
const scoped = selectCompletedOperationJobs([...jobs, { ...jobs[0], id: "foreign", companyId: "other", completedAt: "2027-01-01" }], trips, "driver", "company");
assert.equal(scoped.length, 100);
assert.equal(scoped[0].id, "job-99");
assert.equal(operationDateMs({ seconds: 1791633600 }), 1791633600000, "Firestore timestamps are valid completion dates");
console.log(JSON.stringify({ result: "PASS", jobs: jobs.length, trips: trips.length, levelHistoryIdentityReads: reads, deliveries: level.totalDeliveries, xp: level.xp, scopedCompletedJobs: scoped.length }));
