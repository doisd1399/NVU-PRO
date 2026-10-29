import assert from "node:assert/strict";
import fs from "node:fs";
import { buildOperationProjection } from "../src/application/operation/OperationProjectionEngine.ts";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const projection = read("src/application/operation/OperationProjectionEngine.ts");
const selector = read("src/application/operation/operationProjectionSelectors.ts");
const operation = read("src/application/trip/CanonicalTripOperationService.ts");
const adapter = read("src/services/sync/FirebaseTripSyncAdapter.ts");
const senior = read("src/pages/admin/SeniorPanel.tsx");
const offline = read("src/lib/offlineTripQueue.ts");
const syncEngine = read("src/services/sync/SyncEngine.ts");

assert.match(projection, /export type CanonicalOperationProjection/);
assert.match(projection, /confirmedTripCount/);
// Exercise the real shared predicate, so moving it into a helper does not
// turn a correct refactor into a false failure.
const identity = { operationId: "job", companyId: "company", driverId: "driver", contractId: "contract", simulatorId: "gto" };
const confirmed = { canonicalTripId: "confirmed", jobId: "job", companyId: "company", driverId: "driver", contractId: "contract", status: "concluida", serverValidatedAt: new Date() };
const behavior = buildOperationProjection({ identity, operation: { totalDeliveries: 5, status: "active" }, confirmedHistory: [confirmed,
  { ...confirmed, canonicalTripId: "foreign-company", companyId: "other" },
  { ...confirmed, canonicalTripId: "foreign-driver", driverId: "other" },
  { ...confirmed, canonicalTripId: "pending", offlineSyncStatus: "pending_sync" },
] });
assert.deepEqual(behavior.confirmedTripIds, ["confirmed"]);
assert.equal(behavior.confirmedTripCount, 1);
assert.match(selector, /buildClientOperationProjection/);
assert.match(selector, /confirmedTripCountForOperation/);
assert.match(operation, /isCanonicalConfirmedTrip/);
assert.match(operation, /confirmedTripCount/);
assert.doesNotMatch(adapter, /maxConfirmedSlot/);
assert.doesNotMatch(adapter, /Math\.max\(progress, maxConfirmedSlot\) \+ 1/);
assert.match(adapter, /reconcileOperation/);
assert.doesNotMatch(adapter, /throw new Error\("OPERATION_PROGRESS_RECONCILIATION_REQUIRED"\)/);
assert.match(senior, /Viagens \(mês\)/);
assert.doesNotMatch(senior, /monthlyEarningsLabel/);
assert.doesNotMatch(senior, /Ganhos: \$\{SENIOR_CURRENCY_FORMATTER/);
assert.match(offline, /item\.status === "SYNCING"/);
assert.match(offline, /setOfflineTripStatus\(item\.id, "PENDING_SYNC"\)/);
assert.match(syncEngine, /state: "SERVER_CONFIRMED"/);
assert.match(syncEngine, /reconcileConfirmedTrip\(confirmedTrip\)/);

console.log("OPERATION_SENIOR_CONSISTENCY_PASS canonical projection, confirmed history, sync and identity consistency");
