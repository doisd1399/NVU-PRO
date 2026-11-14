import assert from "node:assert/strict";
import { buildCanonicalProductionAudit } from "../functions/src/canonicalProductionAudit";
import { canonicalizeHistoricalTrip } from "../functions/src/historicalTripCanonicalizer";

const op = (id: string, driver = "d1", contract = "c1", company = "co1", start = "2026-09-01T00:00:00Z", end = "2026-09-02T00:00:00Z") => ({ id, jobId: id, driverId: driver, contractId: contract, companyId: company, status: "active", startedAt: start, completedAt: end, totalDeliveries: 1, progress: 0 });
const legacy = (id: string, operationId = "job-1", extra: Record<string, unknown> = {}) => ({ id, tripId: id, jobId: operationId, driverId: "d1", companyId: "co1", contractId: "c1", status: "concluida", uploadedAt: "2026-09-01T12:00:00Z", completedAt: "2026-09-01T12:01:00Z", ...extra });

const operations = [op("job-1"), op("job-2", "d1", "c1", "co1", "2026-09-01T06:00:00Z", "2026-09-03T00:00:00Z")];
assert.equal(canonicalizeHistoricalTrip({ trip: legacy("t1", "", { jobId: undefined }), operations }).classification, "LEGACY_AMBIGUOUS");
assert.equal(canonicalizeHistoricalTrip({ trip: legacy("t2", "job-1"), operations: [operations[0]] }).classification, "LEGACY_PROVEN");
assert.equal(canonicalizeHistoricalTrip({ trip: { ...legacy("t3", ""), jobId: undefined }, operations: [operations[0]] }).classification, "LEGACY_PROBABLE_NOT_SAFE");
assert.equal(canonicalizeHistoricalTrip({ trip: legacy("t4", "job-1", { status: "pending_sync" }), operations: [operations[0]] }).classification, "LEGACY_INVALID");
assert.equal(canonicalizeHistoricalTrip({ trip: legacy("t5", "job-1", { operationSlot: 1, canonicalTripId: "t5", operationProjectionVersion: 4, serverValidatedAt: "2026-09-01T12:01:00Z", recordStatus: "concluida" }), operations: [operations[0]] }).classification, "CANONICAL");

const audit = buildCanonicalProductionAudit({ operations: [operations[0]], trips: [legacy("t2", "job-1"), legacy("t3", ""), { ...legacy("t4", "job-1"), status: "pending_sync" }] });
assert.equal(audit.auditorVersion, "historical-canonicalizer-v3");
assert.equal(audit.totals.physicalTrips, 3);
assert.equal(audit.totals.classificationAttempts, 3);
assert.equal(audit.totals.legacyProven, 1);
assert.equal(audit.totals.legacyProbableNotSafe, 1);
assert.equal(audit.totals.legacyInvalid, 1);
console.log("HISTORICAL_CANONICALIZER_PASS");
