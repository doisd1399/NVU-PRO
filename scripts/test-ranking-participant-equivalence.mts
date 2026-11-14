import assert from "node:assert/strict";
import { reduceJobRow, limitRows, ownerOfJob } from "../functions/src/rankingParticipantOperations.ts";
import { scopeJobs, selectFromProjectionRows, selectParticipantOperation, vehiclesNeedingEvidence } from "../src/lib/rankingParticipantSelection.ts";

// The Ranking must show the same operation/vehicle whether it reads the participant's full job history (old path) or the
// server's compact rows (new path). Random histories, every company/simulator filter, many seeds.
let seed = 20261031;
const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const pick = <T,>(items: T[]) => items[Math.floor(random() * items.length)];
const chance = (p: number) => random() < p;
const DAY = 86_400_000, base = Date.UTC(2026, 0, 1);
const simulators = [{ id: "gto", name: "GTO" }, { id: "ets2", name: "ETS2" }];
const companies = [{ id: "a", simulatorId: "gto" }, { id: "b", simulatorId: "ets2" }, { id: "c" }];
const stamp = (ms: number) => pick([ms, new Date(ms).toISOString(), { seconds: Math.floor(ms / 1000) }, { toMillis: () => ms }]);

function history(participant: string) {
  const vehicles = new Map<string, any>();
  for (let i = 0; i < 6; i += 1) vehicles.set(`v${i}`, chance(0.1) ? null : { id: `v${i}`, name: `Caminhão ${i}`, ...(chance(0.5) ? { simulatorId: pick(["gto", "ets2"]) } : {}) });
  const jobs: any[] = [];
  const count = Math.floor(random() * (chance(0.15) ? 90 : 14));
  for (let i = 0; i < count; i += 1) {
    const at = base + Math.floor(random() * 300) * DAY + Math.floor(random() * DAY);
    const status = pick(["pending", "active", "active", "delayed", "awaiting_completion", "completed", "completed", "completed", "cancelled", "invalid"]);
    const job: any = { id: `job-${i}-${Math.floor(random() * 1e6)}`, companyId: pick(["a", "b", "c"]), status, vehicleId: chance(0.93) ? `v${Math.floor(random() * 6)}` : undefined,
      ...(chance(0.4) ? { vehicleName: `Nome ${i}` } : {}) };
    const ownerField = pick(["driverId", "driverId", "motoristaId", "assignedDriverId", "driver_id"]);
    job[ownerField] = participant;
    if (chance(0.15)) job.userId = pick(["manager-1", participant]);
    if (chance(0.7)) job.assignedAt = stamp(at); if (chance(0.5)) job.createdAt = stamp(at - DAY); if (chance(0.4)) job.startedAt = stamp(at + 1000);
    if (!job.assignedAt && !job.createdAt && !job.startedAt && chance(0.7)) job.updatedAt = stamp(at);
    if (status === "completed" && chance(0.8)) job.completedAt = stamp(at + DAY);
    if (chance(0.15)) job.operationalCommandVersion = 1;
    if (chance(0.5)) Object.assign(job, { simulatorId: pick(["gto", "ets2"]) });
    if (chance(0.1)) job.simulatorName = pick(["GTO", "ETS2"]);
    jobs.push(job);
  }
  // Jobs of other drivers must be ignored by both paths.
  for (let i = 0; i < 4; i += 1) jobs.push({ id: `other-${i}`, driverId: "someone-else", companyId: "a", status: "active", vehicleId: "v1", assignedAt: base + i });
  return { jobs, vehicles };
}

const same = (x: any, y: any, label: string) => assert.deepEqual(x, y, label);
let compared = 0, selected = 0, truncatedCases = 0, explained = 0;
for (let round = 0; round < 3000; round += 1) {
  const participant = "driver-1", { jobs, vehicles } = history(participant);
  // Server side: the rows exactly as the trigger would store them (owner check included, vehicle facts attached).
  const reduced = jobs.flatMap(job => ownerOfJob(job) === participant ? [reduceJobRow(job.id, job)].filter(Boolean) as any[] : []);
  const limited = limitRows(reduced);
  if (limited.truncated) truncatedCases += 1;
  const rows = limited.rows.map(row => ({ ...row, vehicle: row.vehicleId ? (vehicles.get(row.vehicleId) ? (({ id, name, simulatorId }) => ({ id, name, ...(simulatorId ? { simulatorId } : {}) }))(vehicles.get(row.vehicleId)) : null) : null }));
  for (const simulatorId of ["", "all", "gto", "ets2"]) for (const companyId of ["", "a", "b"]) {
    const context = { simulatorId, simulators, companies };
    // Old path: the full history, vehicle documents read only where the job has no simulator evidence.
    const scoped = scopeJobs(jobs, participant, companyId || undefined);
    const evidence = new Map<string, any>();
    for (const id of vehiclesNeedingEvidence(scoped, context)) evidence.set(id, vehicles.get(id) ? { ...vehicles.get(id) } : null);
    const legacy = selectParticipantOperation(scoped, participant, companyId || undefined, context, evidence);
    const legacyVehicle = legacy.operation ? vehicles.get(String(legacy.operation.vehicleId || legacy.operation.veiculoId || "").trim()) ?? null : null;
    const projected = selectFromProjectionRows(rows, participant, companyId || undefined, context);
    const label = `round ${round} sim=${simulatorId || "-"} company=${companyId || "-"}`;
    const projNeeds = vehiclesNeedingEvidence(scopeJobs(rows, participant, companyId || undefined), context);
    const legacyNeeds = [...evidence.keys()];
    if ((projected.operation?.id ?? null) !== (legacy.operation?.id ?? null)) {
      // The old path reads a vehicle document once ANY of its jobs (even a cancelled one the compact rows drop) lacks
      // simulator evidence, and then applies it to every job of that vehicle. That can only ADD conflicts. So a
      // difference must be fully explained by those extra vehicles, and the compact rows must then show MORE, never less.
      assert(legacyNeeds.length > projNeeds.length, `${label}: difference without extra vehicle evidence`);
      const withLegacyEvidence = selectParticipantOperation(scopeJobs(rows, participant, companyId || undefined), participant, companyId || undefined, context,
        new Map(legacyNeeds.map(id => [id, vehicles.get(id) ? { ...vehicles.get(id) } : null])));
      same(withLegacyEvidence.operation?.id ?? null, legacy.operation?.id ?? null, `${label}: compact rows with the same evidence must agree`);
      assert(!(legacy.operation && !projected.operation), `${label}: compact rows hid a vehicle the full history showed`);
      explained += 1; continue;
    }
    same(projected.operation?.vehicleId ?? null, legacy.operation?.vehicleId ?? null, `${label}: vehicleId`);
    // The "evidence incomplete" flag only decides whether an empty answer may erase a cached vehicle. The full history also
    // counts cancelled/pending jobs that can never be selected, so the compact rows may be more certain, never less.
    if (projected.unresolvedContext) assert(legacy.unresolvedContext, `${label}: compact rows reported doubt the full history did not have`);
    if (!legacy.unresolvedContext) same(projected.unresolvedContext, false, `${label}: unresolvedContext`);
    same(projected.vehicle?.name ?? null, legacyVehicle?.name ?? null, `${label}: vehicle name`);
    same(projected.vehicle?.id ?? null, legacyVehicle?.id ?? null, `${label}: vehicle id`);
    compared += 1; if (legacy.operation) selected += 1;
  }
}
assert(selected > 5000, "the generator must select an operation in most cases");

// Row limits: running jobs are always kept, the newest used jobs of each company/simulator are kept, nothing else grows.
{
  const many = Array.from({ length: 200 }, (_, i) => reduceJobRow(`j${i}`, { driverId: "d", companyId: "a", status: "completed", vehicleId: "v1", assignedAt: base + i * DAY, simulatorId: "gto" })!);
  const running = reduceJobRow("run", { driverId: "d", companyId: "a", status: "active", vehicleId: "v1", assignedAt: base - DAY, simulatorId: "gto" })!;
  const out = limitRows([...many, running]);
  assert.equal(out.truncated, true);
  assert(out.rows.some(row => row.id === "run"), "a running job is never dropped");
  assert.equal(out.rows.filter(row => row.status === "completed").length, 10);
  assert.equal(out.rows.find(row => row.status === "completed")!.id, "j199", "the newest comes first");
  // Progress-only changes do not change the row (so the trigger skips them).
  const a = reduceJobRow("x", { driverId: "d", companyId: "a", status: "active", vehicleId: "v1", assignedAt: base, progress: 1, updatedAt: base + 5 });
  const b = reduceJobRow("x", { driverId: "d", companyId: "a", status: "active", vehicleId: "v1", assignedAt: base, progress: 4, lastValidatedTripId: "t", updatedAt: base + 99 });
  assert.deepEqual(a, b);
  // Rows never leak money, deadlines, deliveries or contract snapshots.
  const row = reduceJobRow("y", { driverId: "d", companyId: "a", status: "active", vehicleId: "v1", assignedAt: base, contractSnapshot: { deliveries: [1] }, dueAt: "x", totalDeliveries: 9, progress: 3, contractName: "N" })!;
  assert.deepEqual(Object.keys(row).sort(), ["assignedAt", "companyId", "completedAt", "createdAt", "driverId", "id", "startedAt", "status", "vehicleId", "vehicleName"]);
}
console.log(`RANKING_PARTICIPANT_EQUIVALENCE_PASS compared=${compared} withOperation=${selected} truncatedHistories=${truncatedCases} differencesExplainedByConflictingVehicleData=${explained}`);
