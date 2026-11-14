import assert from "node:assert/strict";
import fs from "node:fs";

const args = process.argv.slice(2);
const value = (name: string, fallback: number) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && Number.isFinite(Number(args[index + 1])) ? Number(args[index + 1]) : fallback;
};
const seedInput = value("seed", 123456);
const runs = Math.max(1, Math.floor(value("runs", 5000)));
const steps = Math.max(1, Math.floor(value("steps", 100)));
const requiredValues = [1, 2, 5, 6, 10, 12, 13, 15, 20, 30, 37, 50, 100];
let state = (seedInput >>> 0) || 1;
const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x1_0000_0000; };
const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length) % items.length];

type Trip = { id: string; key: string; slot: number; source: "PRINT" | "PRO"; confirmed: boolean; deleted: boolean };
type Model = { required: number; online: boolean; trips: Map<string, Trip>; pending: Set<string>; tombstones: Set<string>; storedProgress: number; status: "ACTIVE" | "COMPLETED" };
const newModel = (required: number): Model => ({ required, online: true, trips: new Map(), pending: new Set(), tombstones: new Set(), storedProgress: 0, status: "ACTIVE" });
const confirmed = (m: Model) => [...m.trips.values()].filter((t) => t.confirmed && !t.deleted && !m.tombstones.has(t.id));
const reconcile = (m: Model) => { m.storedProgress = new Set(confirmed(m).map((t) => t.id)).size; m.status = m.storedProgress >= m.required ? "COMPLETED" : "ACTIVE"; };
function check(m: Model) {
  const ids = [...m.trips.values()].map((t) => t.id), keys = [...m.trips.values()].map((t) => t.key);
  assert.equal(new Set(ids).size, ids.length, "duplicate canonicalTripId");
  assert.equal(new Set(keys).size, keys.length, "duplicate idempotencyKey");
  const slots = confirmed(m).map((t) => t.slot);
  assert.equal(new Set(slots).size, slots.length, "duplicate confirmed slot");
  const count = confirmed(m).length;
  assert.equal(m.storedProgress, count, "storedProgress diverged from canonical set");
  assert.equal(Math.max(m.required - count, 0), Math.max(m.required - m.storedProgress, 0), "remainingTrips mismatch");
  assert.equal(m.status === "COMPLETED", count >= m.required, "completion mismatch");
  assert.ok([...m.pending].every((id) => !m.tombstones.has(id)), "tombstoned trip remained pending");
}
function submit(m: Model, id: string) {
  const t = m.trips.get(id); if (!t || m.tombstones.has(id)) return;
  if (!m.online || t.confirmed || m.status === "COMPLETED") return;
  const used = new Set(confirmed(m).map((x) => x.slot));
  if (used.size >= m.required) return;
  let nextSlot = 1; while (used.has(nextSlot)) nextSlot++;
  if (nextSlot > m.required) return;
  t.confirmed = true; t.slot = nextSlot; m.pending.delete(id); reconcile(m);
}
function action(m: Model, index: number) {
  const all = [...m.trips.values()];
  switch (Math.floor(random() * 14)) {
    case 0: case 1: { const id = `r${index}-${Math.floor(random() * 1e9)}`; if (!m.trips.has(id)) { m.trips.set(id, { id, key: `${index}:${id}`, slot: 0, source: pick(["PRINT", "PRO"]), confirmed: false, deleted: false }); m.pending.add(id); } break; }
    case 2: m.online = false; break;
    case 3: m.online = true; break;
    case 4: case 5: if (all.length) submit(m, pick(all).id); break;
    case 6: if (all.length) { const t = pick(all); if (t.confirmed && !t.deleted) { t.confirmed = true; reconcile(m); } else submit(m, t.id); } break;
    case 7: if (all.length) { const t = pick(all); if (t.confirmed && !t.deleted) { t.confirmed = false; m.pending.add(t.id); reconcile(m); } } break;
    case 8: case 9: if (all.length) submit(m, pick(all).id); break;
    case 10: if (all.length) { const t = pick(all); m.tombstones.add(t.id); t.deleted = true; m.pending.delete(t.id); reconcile(m); } break;
    case 11: reconcile(m); break;
    case 12: m.online = true; for (const id of [...m.pending]) submit(m, id); break;
    case 13: m.online = true; for (const id of [...m.pending]) submit(m, id); reconcile(m); break;
  }
  check(m);
}
const failures: any[] = [], started = Date.now();
let transitions = 0;
for (let run = 0; run < runs; run++) {
  const required = run < requiredValues.length ? requiredValues[run] : 1 + Math.floor(random() * 100);
  const m = newModel(required);
  try { check(m); for (let step = 0; step < steps; step++) { action(m, step); transitions++; } }
  catch (error) { failures.push({ seed: seedInput + run, requiredTrips: required, step: transitions, error: String(error), state: { ...m, trips: [...m.trips.values()], pending: [...m.pending], tombstones: [...m.tombstones] } }); break; }
}
const result = { seed: seedInput, runs, steps, totalTransitions: transitions, durationMs: Date.now() - started, requiredTripsCovered: requiredValues, failures, pass: failures.length === 0 };
fs.writeFileSync("PROPERTY_FUZZ_RESULTS.json", JSON.stringify(result, null, 2) + "\n");
fs.writeFileSync("PROPERTY_FUZZ_FAILURES.json", JSON.stringify(failures, null, 2) + "\n");
assert.equal(failures.length, 0, `property fuzz failed: ${JSON.stringify(failures[0])}`);
console.log(`PROPERTY_FUZZ_PASS runs=${runs} steps=${steps} transitions=${transitions} seed=${seedInput}`);
