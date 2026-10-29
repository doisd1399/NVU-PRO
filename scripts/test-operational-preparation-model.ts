import assert from "node:assert/strict";
import { analyzeOperationalPreparation } from "../functions/src/operationalPreparationModel";
const base = { companyId: "a", driverId: "d", contractId: "c", vehicleId: "v", status: "active" };
const analyze = (...rows: Record<string, any>[]) => analyzeOperationalPreparation(rows.map((data, i) => ({ id: `j${i}`, data })), "a");
let passed = 0;
function test(name: string, fn: () => void) { fn(); passed++; console.log(`PASS ${name}`); }
test("valid executions are ready and never proposed for mutation", () => {
  const a = analyze(base); assert.equal(a.ready, true); assert.deepEqual(a.jobs[0].patch, {});
  assert.equal(a.jobs[0].canNormalize, false);
});
test("completed, cancelled and deleted records do not block activation", () => {
  assert.equal(analyze({ status: "completed" }, { status: "canceled" }, { status: "cancelled" }, { ...base, deleted: true }).ready, true);
});
test("all five unambiguous aliases generate scope-only patches", () => {
  const a = analyze({ empresaId: "a", motoristaId: "d", contratoId: "c", veiculoId: "v", reboqueId: "t", status: "pending", progress: 9 });
  assert.deepEqual(a.jobs[0].patch, { companyId: "a", driverId: "d", contractId: "c", vehicleId: "v", trailerId: "t" });
  assert.equal(a.ready, false); assert.equal(a.jobs[0].canNormalize, true);
});
test("null canonical vehicle can be repaired from a compatible alias", () => {
  const a = analyze({ ...base, vehicleId: null, veiculoId: "v" });
  assert.deepEqual(a.jobs[0].patch, { vehicleId: "v" }); assert.equal(a.jobs[0].canNormalize, true);
});
test("status spelling is repaired without inferring a terminal transition", () => {
  const a = analyze({ ...base, status: " ACTIVE " });
  assert.deepEqual(a.jobs[0].patch, { status: "active" });
  assert.equal(a.jobs[0].canNormalize, true);
});
test("trimmed canonical fields receive exact indexed values", () => {
  const a = analyze({ ...base, driverId: " d " });
  assert.equal(a.jobs[0].patch.driverId, "d"); assert.equal(a.ready, false);
});
test("divergent aliases are never automatically chosen", () => {
  for (const [alias, value] of [["empresaId", "b"], ["motoristaId", "other"], ["contratoId", "other"], ["veiculoId", "other"], ["reboqueId", "other"]]) {
    const a = analyze({ ...base, trailerId: "t", [alias]: value });
    assert.equal(a.jobs[0].canNormalize, false); assert.deepEqual(a.jobs[0].patch, {});
  }
});
test("actor userId is never mistaken for the assigned driver", () => {
  const a = analyze({ ...base, driverId: null, userId: "manager" });
  assert.equal(a.jobs[0].canNormalize, false); assert.equal(a.jobs[0].driverId, "");
});
test("missing and invalid identifiers require a manual data decision", () => {
  for (const driverId of [null, "", "../x", ".", "..", "a\0b", "x".repeat(181), 5])
    assert.equal(analyze({ ...base, driverId }).jobs[0].canNormalize, false);
});
test("unknown states and foreign scope remain blocked", () => {
  assert.equal(analyze({ ...base, status: "finished" }).jobs[0].canNormalize, false);
  assert.equal(analyze({ ...base, companyId: "b", empresaId: "a" }).ready, false);
});
test("duplicate running jobs require an explicit choice; pending jobs do not", () => {
  const a = analyze(base, { ...base, status: "awaiting_completion" }, { ...base, status: "pending" });
  assert.deepEqual(a.conflicts, [{ driverId: "d", jobIds: ["j0", "j1"] }]);
  assert.equal(a.ready, false);
});
test("different drivers retain independent running operations", () => {
  assert.equal(analyze(base, { ...base, driverId: "other" }).ready, true);
});
test("diagnostic analysis does not mutate source objects or trip progress", () => {
  const row = { ...base, status: " ACTIVE ", progress: 12, totalDeliveries: 12, contractSnapshot: { name: "Frozen" } };
  const before = structuredClone(row); analyze(row); assert.deepEqual(row, before);
});
console.log(`${passed}/${passed} preparation model cases passed`);
