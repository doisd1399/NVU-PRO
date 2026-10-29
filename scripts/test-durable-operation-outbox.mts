import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { DurableOperationOutbox, automaticOperationJobId } from "../src/application/operation/DurableOperationOutbox.ts";

let checks = 0;
async function test(name, run) { await run(); checks++; console.log("PASS", name); }
const fakeStorage = () => {
  const values = new Map(); let fail = false;
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { if (fail) throw new Error("QuotaExceededError"); values.set(key, value); }, values, quota: value => { fail = value; } };
};
function harness(overrides: any = {}) {
  const storage = overrides.storage || fakeStorage();
  let uid = "driver", online = false, now = 100_000, waiting = true;
  const calls: string[] = [], receipts = new Map();
  const ports = { uid: () => uid, online: () => online, storage: () => storage, now: () => now,
    canFinish: async () => !waiting,
    sendStart: async entry => { calls.push("start:" + entry.requestId); const result = receipts.get(entry.requestId) || { ...entry.job, status: "active", operationalRevision: 1 }; receipts.set(entry.requestId, result); return result; },
    sendFinish: async entry => { calls.push("finish:" + entry.jobId); return { completed: true, jobId: entry.jobId, status: "completed", progress: 2, total: 2, operationalRevision: 2 }; },
    ...overrides,
  };
  const outbox = new DurableOperationOutbox(ports);
  const job = { id: "operation", companyId: "company", contractId: "contract", driverId: "driver", vehicleId: "vehicle", status: "pending", totalDeliveries: 2, progress: 0, operationalRevision: 0 };
  const start = (changes = {}, commandChanges = {}) => outbox.enqueueStart({ requestId: "request", transport: "managed", job: { ...job, ...changes }, command: { action: "start", companyId: "company", jobId: "operation", ...commandChanges } });
  return { outbox, ports, job, start, storage, calls, receipts, uid: value => { uid = value; }, online: value => { online = value; }, clock: value => { now = value; }, wait: value => { waiting = value; } };
}
await test("Automatic ID matches the existing server SHA-256 protocol", async () => {
  const expected = "oc1_" + createHash("sha256").update(JSON.stringify(["driver", "request"])).digest("hex");
  assert.equal(await automaticOperationJobId("driver", "request"), expected);
  assert.notEqual(await automaticOperationJobId("other", "request"), expected);
});
await test("Offline start returns a durable local receipt without transport", async () => {
  const h = harness(), start = performance.now(); const entry = h.start();
  assert.ok(performance.now() - start < 50); assert.equal(entry.state, "PENDING");
  await h.outbox.synchronize("start"); assert.equal(h.calls.length, 0);
  assert.equal(h.outbox.project([], "driver", "company")[0].operationSyncState, "pending_start");
  assert.equal(h.outbox.project([], "driver", "company")[0].progress, 0);
});
await test("Duplicate taps preserve one request and one operation", async () => {
  const h = harness(); h.start(); assert.equal(h.start().requestId, "request"); assert.equal(h.outbox.entries().length, 1);
  assert.throws(() => h.start({ id: "another" }, { jobId: "another" }), /aguardando sincronização/);
});
await test("Reload preserves identity; another account cannot replay/project it", async () => {
  const h = harness(); h.start(); const restored = new DurableOperationOutbox(h.ports);
  assert.equal(restored.entries()[0].requestId, "request");
  h.uid("other"); h.online(true); await restored.synchronize("start");
  assert.equal(h.calls.length, 0); assert.deepEqual(restored.entries(), []);
  assert.deepEqual(restored.project([], "driver", "company"), []);
  h.uid("driver"); await restored.synchronize("start"); assert.equal(h.calls.length, 1);
});
await test("Storage failure never produces a successful local command", async () => {
  const h = harness(); h.storage.quota(true); assert.throws(h.start, /QuotaExceeded/); assert.equal(h.calls.length, 0);
});
await test("Corrupt durable data is retained and never overwritten", async () => {
  const h = harness(); h.storage.values.set("nvu.operation.outbox.v1.driver", "corrupt");
  assert.throws(h.start); assert.equal(h.storage.values.get("nvu.operation.outbox.v1.driver"), "corrupt");
});
await test("Foreign driver/company/physical ID fail before persistence", async () => {
  const h = harness(); assert.throws(() => h.start({ driverId: "other" }));
  assert.throws(() => h.start({ companyId: "foreign" })); assert.throws(() => h.start({ id: "foreign" }));
  assert.equal(h.outbox.entries().length, 0);
});
await test("Finish waits for start, then all pending receipts, then server ACK", async () => {
  const h = harness(); h.start(); h.outbox.enqueueFinish({ ...h.job, status: "active", progress: 0 }, "finish-request");
  const pending = h.outbox.project([h.job], "driver", "company")[0];
  assert.equal(pending.status, "active"); assert.equal(pending.operationSyncState, "pending_finish");
  h.online(true); await h.outbox.synchronize("finish"); assert.equal(h.calls.length, 0);
  await h.outbox.synchronize("start"); await h.outbox.synchronize("finish"); assert.equal(h.calls.length, 1);
  h.wait(false); await h.outbox.synchronize("finish");
  assert.deepEqual(h.calls, ["start:request", "finish:operation"]);
  assert.equal(h.outbox.project([h.job], "driver", "company")[0].status, "completed");
});
await test("Lost reply replays the exact committed request without allocating", async () => {
  const h = harness(); let first = true; const remote = h.ports.sendStart;
  h.ports.sendStart = async entry => { const receipt = await remote(entry); if (first) { first = false; throw { code: "functions/unavailable" }; } return receipt; };
  h.start(); h.online(true); await h.outbox.synchronize("start");
  assert.equal(h.outbox.entries()[0].state, "PENDING"); assert.equal(h.receipts.size, 1);
  h.clock(102_000); await new DurableOperationOutbox(h.ports).synchronize("start");
  assert.equal(h.receipts.size, 1); assert.equal(h.outbox.entries()[0].state, "CONFIRMED");
  assert.deepEqual(h.calls, ["start:request", "start:request"]);
});
await test("Permanent denial preserves evidence without an automatic retry loop", async () => {
  let sends = 0; const h = harness({ sendStart: async () => { sends++; throw { code: "functions/permission-denied", message: "Acesso revogado" }; } });
  h.start(); h.online(true); await h.outbox.synchronize("start"); h.clock(900_000); await h.outbox.synchronize("start");
  assert.equal(sends, 1); assert.equal(h.outbox.entries()[0].state, "REJECTED");
  assert.equal(h.outbox.project([], "driver", "company")[0].status, "pending");
  h.outbox.retry("operation"); await h.outbox.synchronize("start"); assert.equal(sends, 2);
});
for (const changed of [{ id: "foreign" }, { driverId: "foreign" }, { companyId: "foreign" }, { contractId: "foreign" }, { vehicleId: "foreign" }, { totalDeliveries: 3 }]) {
  await test("Reject mismatched server start ACK: " + Object.keys(changed)[0], async () => {
    const h = harness({ sendStart: async entry => ({ ...entry.job, ...changed, status: "active" }) });
    h.start(); h.online(true); await h.outbox.synchronize("start"); assert.equal(h.outbox.entries()[0].state, "REJECTED");
  });
}
await test("Invalid completion ACK never marks the operation completed", async () => {
  const h = harness({ sendFinish: async () => ({ completed: false, jobId: "operation", status: "completed", progress: 1, total: 2 }) });
  h.outbox.enqueueFinish({ ...h.job, status: "active" }, "f"); h.wait(false); h.online(true); await h.outbox.synchronize("finish");
  assert.equal(h.outbox.entries()[0].state, "REJECTED"); assert.equal(h.outbox.project([{ ...h.job, status: "active" }], "driver", "company")[0].status, "active");
});
await test("Unresponsive transport has a bounded lease and recoverable identity", async () => {
  const h = harness({ syncTimeoutMs: 2, sendStart: () => new Promise(() => {}) }); h.start(); h.online(true);
  await h.outbox.synchronize("start"); assert.equal(h.outbox.entries()[0].state, "PENDING");
  assert.equal(h.outbox.entries()[0].requestId, "request");
});
await test("A crash with an abandoned SENDING lease is recovered", async () => {
  const h = harness(); h.start(); const key = "nvu.operation.outbox.v1.driver", raw = JSON.parse(h.storage.values.get(key));
  raw.entries[0].state = "SENDING"; raw.entries[0].sendingAt = 1; h.storage.values.set(key, JSON.stringify(raw));
  h.online(true); await h.outbox.synchronize("start"); assert.equal(h.outbox.entries()[0].state, "CONFIRMED");
});
await test("Terminal realtime rows cannot be resurrected by a late start ACK", async () => {
  const h = harness(); h.start(); h.online(true); await h.outbox.synchronize("start");
  assert.equal(h.outbox.project([{ ...h.job, status: "cancelled", operationalRevision: 3 }], "driver", "company")[0].status, "cancelled");
});
await test("Same-revision fresh progress beats an older start response", async () => {
  const h = harness(); h.start(); h.online(true); await h.outbox.synchronize("start");
  assert.equal(h.outbox.project([{ ...h.job, status: "active", progress: 1, operationalRevision: 1 }], "driver", "company")[0].progress, 1);
});
await test("Observed server rows do not become immortal local jobs", async () => {
  const h = harness(); h.start(); h.online(true); await h.outbox.synchronize("start");
  h.outbox.observe("driver", "company", [{ ...h.job, status: "active" }]);
  assert.deepEqual(h.outbox.project([], "driver", "company"), []);
});
await test("Concurrent supervisors share one flight", async () => {
  const h = harness(); h.start(); h.online(true); await Promise.all([h.outbox.synchronize("start"), h.outbox.synchronize("start")]);
  assert.equal(h.calls.length, 1);
});
await test("Company switching never paints another company's local operation", async () => {
  const h = harness(); h.start(); assert.deepEqual(h.outbox.project([], "driver", "other-company"), []);
});
await test("Verified native cleanup is remembered across reload without changing server confirmation", async () => {
  const h=harness();h.start();h.outbox.enqueueFinish({...h.job,status:"active"},"finish");
  h.outbox.acknowledgeNativeCleanup("driver","finish:operation");
  assert.equal(h.outbox.entries().find(e=>e.kind==="finish")?.nativeCleanupDone,undefined,"pending cannot be marked cleaned");
  h.online(true);h.wait(false);await h.outbox.synchronize("start");await h.outbox.synchronize("finish");
  h.outbox.acknowledgeNativeCleanup("driver","finish:operation");
  const restored=new DurableOperationOutbox(h.ports);
  assert.equal(restored.entries().find(e=>e.kind==="finish")?.nativeCleanupDone,true);
  assert.equal(restored.entries().find(e=>e.kind==="finish")?.state,"CONFIRMED");
});
console.log(`DURABLE_OPERATION_OUTBOX_PASS (${checks} checks)`);
