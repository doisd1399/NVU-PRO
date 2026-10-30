"use strict";
// Server rules of the "changeVehicle" operational command, run against an in-memory Firestore (same transaction contract
// as the real one for the calls the command uses). The official emulator test of the other commands lives in
// scripts/test-operational-commands-emulator.mjs; this one needs no emulator download.
const assert = require("node:assert/strict");
const { executeOperationalCommand } = require("../lib/operationalCommands");

class Snap {
  constructor(ref, data) { this.ref = ref; this.id = ref.id; this._data = data; this.exists = data !== undefined; }
  data() { return this._data === undefined ? undefined : structuredClone(this._data); }
  get(field) { return this._data?.[field]; }
}
class Ref {
  constructor(db, path) { this.db = db; this.path = path; this.id = path.split("/").at(-1); }
  collection(name) { return new Query(this.db, `${this.path}/${name}`); }
  async get() { return new Snap(this, this.db.store.get(this.path)); }
}
class Query {
  constructor(db, path, filters = []) { this.db = db; this.path = path; this.filters = filters; }
  doc(id) { return new Ref(this.db, `${this.path}/${id}`); }
  where(field, op, value) { return new Query(this.db, this.path, [...this.filters, { field, op, value }]); }
  async get() {
    const prefix = this.path + "/";
    const docs = [...this.db.store].filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes("/"))
      .filter(([, data]) => this.filters.every(({ field, op, value }) => op === "==" ? data[field] === value : op === "in" ? value.includes(data[field]) : false))
      .map(([key, data]) => new Snap(new Ref(this.db, key), data));
    return { docs, empty: !docs.length };
  }
}
class Tx {
  constructor(db) { this.db = db; this.writes = []; this.wrote = false; }
  async get(target) { assert(!this.wrote, "All reads come before the writes"); return target.get(); }
  update(ref, changes) { this.wrote = true; this.writes.push(() => { const current = this.db.store.get(ref.path); assert(current, "update of a missing document " + ref.path); this.db.store.set(ref.path, { ...current, ...changes }); }); }
  set(ref, data, options) { this.wrote = true; this.writes.push(() => this.db.store.set(ref.path, options?.merge ? { ...(this.db.store.get(ref.path) || {}), ...data } : data)); }
  create(ref, data) { this.wrote = true; this.writes.push(() => { assert(!this.db.store.has(ref.path), "create over an existing document " + ref.path); this.db.store.set(ref.path, data); }); }
}
class FakeDb {
  constructor(seed) { this.store = new Map(Object.entries(structuredClone(seed))); }
  collection(name) { return new Query(this, name); }
  doc(path) { return new Ref(this, path); }
  async runTransaction(fn) { const tx = new Tx(this); const result = await fn(tx); tx.writes.forEach(write => write()); return result; }
}

const seed = () => ({
  "frotas/dc": { status: "active", ownerId: "admin", operationalCommandVersion: 1, simulatorId: "gto" },
  "frotas/legacy": { status: "active", ownerId: "admin", simulatorId: "gto" },
  "frotas/other": { status: "active", ownerId: "someone", operationalCommandVersion: 1 },
  "users/admin": { status: "active" }, "users/stranger": { status: "active" },
  "companyMembers/m1": { companyId: "dc", userId: "admin", status: "active", roles: ["admin"] },
  "companyMembers/m2": { companyId: "dc", userId: "stranger", status: "active", roles: ["driver"] },
  "veiculos/v1": { companyId: "dc", name: "Scania G", plate: "AAA-1111", status: "in_use" },
  "veiculos/v2": { companyId: "dc", name: "Volvo FH", plate: "BBB-2222", status: "available" },
  "veiculos/v3": { companyId: "dc", name: "Em manutenção", status: "maintenance" },
  "veiculos/v4": { companyId: "other", name: "De outra empresa", status: "available" },
  "veiculos/v5": { companyId: "dc", name: "Excluído", status: "available", deleted: true },
  "veiculos/lv": { companyId: "legacy", name: "Legado A", status: "in_use" }, "veiculos/lv2": { companyId: "legacy", name: "Legado B", status: "available" },
  "trabalhos/j1": { companyId: "dc", driverId: "d1", vehicleId: "v1", vehicleName: "Scania G", status: "active", progress: 4, totalDeliveries: 10, dueAt: "2026-11-01T00:00:00.000Z", operationalCommandVersion: 1, operationalRevision: 3, contractSnapshot: { name: "BLS - 150" } },
  "trabalhos/j2": { companyId: "dc", driverId: "d2", vehicleId: "v1", vehicleName: "Scania G", status: "delayed", progress: 1, totalDeliveries: 10, operationalCommandVersion: 1, operationalRevision: 1 },
  "trabalhos/j3": { companyId: "dc", driverId: "d3", vehicleId: "v1", vehicleName: "Scania G", status: "pending", operationalCommandVersion: 1, operationalRevision: 0 },
  "trabalhos/j4": { companyId: "dc", driverId: "d4", vehicleId: "v1", status: "completed", operationalCommandVersion: 1 },
  "trabalhos/j5": { companyId: "dc", driverId: "d5", vehicleId: "v1", status: "cancelled", operationalCommandVersion: 1 },
  "trabalhos/j6": { companyId: "other", driverId: "d6", vehicleId: "v4", status: "active", operationalCommandVersion: 1 },
  "trabalhos/jl": { companyId: "legacy", driverId: "d7", vehicleId: "lv", status: "active", progress: 2 },
});
const admin = { auth: { uid: "admin", token: {} } };
const call = (db, input, context = admin) => executeOperationalCommand(db, input, context);
const change = (jobId, vehicleId, requestId, companyId = "dc") => ({ action: "changeVehicle", companyId, jobId, vehicleId, requestId });
async function rejects(promise, code, pattern) {
  await assert.rejects(promise, error => { assert.equal(error.code, code, error.message); if (pattern) assert.match(error.message, pattern); return true; });
}
let count = 0;
async function check(name, run) { await run(); count++; console.log("PASS " + name); }

(async () => {
  await check("A running job gets the new vehicle; deliveries, deadline, progress and status are untouched", async () => {
    const db = new FakeDb(seed());
    const before = db.store.get("trabalhos/j1");
    const result = await call(db, change("j1", "v2", "r1"));
    const job = db.store.get("trabalhos/j1");
    assert.deepEqual([job.vehicleId, job.vehicleName, job.vehiclePlate, job.previousVehicleId, job.vehicleChangedBy, job.operationalRevision], ["v2", "Volvo FH", "BBB-2222", "v1", "admin", 4]);
    for (const key of ["status", "progress", "totalDeliveries", "dueAt", "driverId", "contractSnapshot", "companyId"]) assert.deepEqual(job[key], before[key], key);
    assert.equal(db.store.get("veiculos/v2").status, "in_use");
    assert.equal(db.store.get("veiculos/v1").status, "in_use", "Another running job still uses the shared vehicle");
    assert.deepEqual([result.success, result.action, result.job.vehicleId], [true, "changeVehicle", "v2"]);
    assert.deepEqual([...db.store.keys()].filter(key => key.startsWith("viagens") || key.startsWith("trips")), [], "No trip document is read or written");
  });
  await check("The old vehicle is released only when no other running job uses it", async () => {
    const db = new FakeDb(seed());
    await call(db, change("j1", "v2", "r1"));
    await call(db, change("j2", "v2", "r2"));
    assert.equal(db.store.get("veiculos/v1").status, "available");
    assert.equal(db.store.get("veiculos/v2").status, "in_use");
  });
  await check("A pending job changes the link only (the vehicles are not occupied before the start)", async () => {
    const db = new FakeDb(seed());
    await call(db, change("j3", "v2", "r3"));
    assert.equal(db.store.get("trabalhos/j3").vehicleId, "v2");
    assert.equal(db.store.get("veiculos/v2").status, "available");
    assert.equal(db.store.get("veiculos/v1").status, "in_use");
  });
  await check("Same request id: a retry replays the result and never changes the job twice", async () => {
    const db = new FakeDb(seed());
    await call(db, change("j1", "v2", "same"));
    const replay = await call(db, change("j1", "v2", "same"));
    assert.equal(replay.replayed, true);
    assert.equal(db.store.get("trabalhos/j1").operationalRevision, 4);
    await rejects(call(db, change("j1", "v3", "same")), "failed-precondition", /outros dados/);
  });
  await check("Refused: same vehicle, maintenance, deleted, missing and vehicles of another company", async () => {
    const db = new FakeDb(seed());
    await rejects(call(db, change("j1", "v1", "a1")), "failed-precondition", /já é o veículo/);
    for (const [vehicle, n] of [["v3", 2], ["v4", 3], ["v5", 4], ["nope", 5]]) await rejects(call(db, change("j1", vehicle, "a" + n)), "failed-precondition", /não está disponível/);
    assert.equal(db.store.get("trabalhos/j1").vehicleId, "v1");
    assert.equal(db.store.get("trabalhos/j1").operationalRevision, 3);
  });
  await check("Refused: finished jobs, jobs of another company and invalid identifiers", async () => {
    const db = new FakeDb(seed());
    await rejects(call(db, change("j4", "v2", "b1")), "failed-precondition", /pendentes ou em andamento/);
    await rejects(call(db, change("j5", "v2", "b2")), "failed-precondition", /pendentes ou em andamento/);
    await rejects(call(db, change("j6", "v2", "b3")), "not-found");
    await rejects(call(db, change("missing", "v2", "b4")), "not-found");
    await rejects(call(db, { ...change("j1", "", "b5") }), "invalid-argument");
    await rejects(call(db, { ...change("j1/x", "v2", "b6") }), "invalid-argument");
  });
  await check("Permissions: only a company manager; not a driver of the company, not a stranger, not anonymous", async () => {
    const db = new FakeDb(seed());
    await rejects(call(db, change("j1", "v2", "p1"), { auth: { uid: "stranger", token: {} } }), "permission-denied");
    await rejects(call(db, change("j1", "v2", "p2"), { auth: { uid: "ghost", token: {} } }), "permission-denied");
    await rejects(call(db, change("j1", "v2", "p3"), {}), "unauthenticated");
    assert.equal(db.store.get("trabalhos/j1").vehicleId, "v1");
  });
  await check("A company that has not enabled the managed commands can still change the vehicle of its jobs (and only that)", async () => {
    const db = new FakeDb(seed());
    await call(db, change("jl", "lv2", "l1", "legacy"));
    assert.equal(db.store.get("trabalhos/jl").vehicleId, "lv2");
    assert.equal(db.store.get("trabalhos/jl").progress, 2);
    await rejects(call(db, { action: "cancel", companyId: "legacy", jobId: "jl", requestId: "l2" }), "failed-precondition", /não foi preparada/);
  });
  console.log(`CHANGE_VEHICLE_COMMAND_PASS ${count} checks`);
})().catch(error => { console.error(error); process.exit(1); });
