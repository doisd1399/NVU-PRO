import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { DurableOperationOutbox, automaticOperationJobId, FINISH_UPLOAD_GRACE_MS, FINISH_WAIT_HINT, friendlyOperationError } from "../src/application/operation/DurableOperationOutbox.ts";

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
// --- A finish must never be held hostage by a local attempt (the "Finalização salva" lock) ---------------------------------
const serverRejects = (code: string, message: string) => Object.assign(new Error(message), { code });
const settledOperation = (h: any) => { h.start(); h.online(true); };
await test("A leftover local attempt blocks the finish only for a short grace, then the server decides", async () => {
  const h = harness(); settledOperation(h); await h.outbox.synchronize("start");
  h.outbox.enqueueFinish({ ...h.job, status: "active" }, "finish"); h.wait(true);            // an attempt that never uploads
  await h.outbox.synchronize("finish");
  assert.deepEqual(h.calls, ["start:request"], "inside the grace the saved receipts upload first");
  assert.equal(h.outbox.entries().find(e => e.kind === "finish")?.error, FINISH_WAIT_HINT.trips, "the reason is recorded");
  h.clock(100_000 + FINISH_UPLOAD_GRACE_MS + 1); await h.outbox.synchronize("finish");
  assert.deepEqual(h.calls, ["start:request", "finish:operation"], "past the grace the finish is sent anyway");
  assert.equal(h.outbox.entries().find(e => e.kind === "finish")?.state, "CONFIRMED", "the server accepted: the operation is completed");
  assert.equal(h.outbox.project([h.job], "driver", "company")[0].status, "completed");
});
await test("The server not having every trip yet is a wait with a reason, never a rejection", async () => {
  let ready = false;
  const h = harness({ sendFinish: async (entry: any) => { if (!ready) throw serverRejects("functions/failed-precondition", "OPERATION_TRIPS_NOT_VALIDATED");
    return { completed: true, jobId: entry.jobId, status: "completed", progress: 2, total: 2, operationalRevision: 2 }; } });
  settledOperation(h); await h.outbox.synchronize("start"); h.wait(false);
  h.outbox.enqueueFinish({ ...h.job, status: "active" }, "finish");
  await h.outbox.synchronize("finish");
  let finish = h.outbox.entries().find(e => e.kind === "finish")!;
  assert.equal(finish.state, "PENDING"); assert.equal(finish.error, FINISH_WAIT_HINT.trips); assert.ok(finish.retryAt > 100_000);
  assert.equal(h.outbox.project([h.job], "driver", "company")[0].operationSyncState, "pending_finish");
  ready = true; h.clock(finish.retryAt + 1); await h.outbox.synchronize("finish");
  finish = h.outbox.entries().find(e => e.kind === "finish")!;
  assert.equal(finish.state, "CONFIRMED"); assert.equal(finish.error, undefined);
});
await test("Offline is a wait with its own reason; a real rejection keeps a readable message", async () => {
  const h = harness({ sendFinish: async () => { throw serverRejects("functions/failed-precondition", "OPERATION_CAPACITY_OVERFLOW"); } });
  settledOperation(h); await h.outbox.synchronize("start"); h.wait(false);
  h.outbox.enqueueFinish({ ...h.job, status: "active" }, "finish");
  h.online(false); await h.outbox.synchronize("finish");
  assert.equal(h.outbox.entries().find(e => e.kind === "finish")?.state, "PENDING", "offline: nothing was sent");
  h.online(true); await h.outbox.synchronize("finish");
  const finish = h.outbox.entries().find(e => e.kind === "finish")!;
  assert.equal(finish.state, "REJECTED"); assert.match(finish.error!, /mais viagens do que o previsto/); assert.doesNotMatch(finish.error!, /OPERATION_CAPACITY_OVERFLOW/);
  assert.equal(h.outbox.project([h.job], "driver", "company")[0].operationSyncState, "finish_rejected");
});
await test("Tentar agora releases the backoff and clears the old reason", async () => {
  const h = harness({ sendFinish: async () => { throw serverRejects("functions/failed-precondition", "OPERATION_TRIPS_NOT_VALIDATED"); } });
  settledOperation(h); await h.outbox.synchronize("start"); h.wait(false);
  h.outbox.enqueueFinish({ ...h.job, status: "active" }, "finish"); await h.outbox.synchronize("finish");
  assert.ok(h.outbox.entries().find(e => e.kind === "finish")!.retryAt > 100_000);
  h.outbox.retryNow("operation");
  const finish = h.outbox.entries().find(e => e.kind === "finish")!;
  assert.equal(finish.state, "PENDING"); assert.equal(finish.retryAt, 0); assert.equal(finish.error, undefined);
});
await test("Cancelar finalização frees the driver; it is refused while a send is in flight and for confirmed finishes", async () => {
  const h = harness(); settledOperation(h); await h.outbox.synchronize("start");
  h.outbox.enqueueFinish({ ...h.job, status: "active" }, "finish"); h.wait(true);
  assert.equal(h.outbox.project([h.job], "driver", "company")[0].operationSyncState, "pending_finish");
  assert.equal(h.outbox.cancelFinish("operation"), true);
  assert.equal(h.outbox.entries().some(e => e.kind === "finish"), false);
  assert.equal(h.outbox.project([h.job], "driver", "company")[0].operationSyncState, undefined, "the Finalizar button is available again");
  assert.equal(h.outbox.cancelFinish("operation"), false, "nothing to cancel");
  // A finish whose request is on the wire is not cancelable (its answer could still confirm it).
  h.outbox.enqueueFinish({ ...h.job, status: "active" }, "finish-2");
  const id = "finish:operation"; (h.outbox as any).patch("driver", id, { state: "SENDING", sendingAt: 100_000 });
  assert.equal(h.outbox.cancelFinish("operation"), false);
  h.clock(100_000 + 46_000); assert.equal(h.outbox.cancelFinish("operation"), true, "a send stuck for 45 s no longer blocks the cancel");
  // A confirmed finish is history.
  h.wait(false); h.outbox.enqueueFinish({ ...h.job, status: "active" }, "finish-3"); await h.outbox.synchronize("finish");
  assert.equal(h.outbox.cancelFinish("operation"), false);
});
await test("The start still comes first: a finish waits for it and says so", async () => {
  const h = harness(); h.start(); h.outbox.enqueueFinish({ ...h.job, status: "active" }, "finish"); h.online(true);
  (h.ports as any).sendStart = async () => { throw serverRejects("functions/unavailable", "offline"); };
  await h.outbox.synchronize("finish");
  assert.equal(h.calls.length, 0); assert.equal(h.outbox.entries().find(e => e.kind === "finish")?.error, FINISH_WAIT_HINT.start);
});
await test("Friendly error text never leaks server codes", async () => {
  for (const code of ["OPERATION_CAPACITY_OVERFLOW", "OPERATION_TRIPS_NOT_VALIDATED", "OPERATION_FINISH_ACK_INVALID", "OPERATION_START_ACK_INVALID"])
    assert.doesNotMatch(friendlyOperationError(new Error(code)), /OPERATION_/);
  assert.match(friendlyOperationError({ code: "functions/permission-denied", message: "x" }), /Sem permissão/);
  assert.equal(friendlyOperationError(new Error("Mensagem do servidor")), "Mensagem do servidor");
});
console.log(`DURABLE_OPERATION_OUTBOX_PASS (${checks} checks)`);
