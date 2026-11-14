import assert from "node:assert/strict";
import { OperationalCommandClient, type OperationalCommandInput, type OperationalCommandResult } from "../src/application/operation/OperationalCommandClient";
import { mergeManagedOperationAcknowledgement, ManagedOperationAcknowledgementCache } from "../src/lib/managedOperationAcknowledgement";
import { selectCurrentOperationJob } from "../src/lib/currentOperation";
import { resolveOperationContract } from "../src/lib/operationResultSummary";
import { operationTrailerId, operationContractName } from "../functions/src/operationSnapshotFields";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
const input: OperationalCommandInput = { action: "assign", companyId: "a", driverId: "driver-a", contractId: "contract-a", vehicleId: "vehicle-a", trailerId: null };
let currentUid = "owner-a", sequence = 0;
const ack = (data: OperationalCommandInput & { requestId: string }): OperationalCommandResult => ({ success: true, version: 1, action: data.action,
  requestId: data.requestId, jobId: data.jobId || "job-a", job: { id: data.jobId || "job-a", companyId: data.companyId,
    driverId: data.driverId || currentUid, contractId: data.contractId, vehicleId: data.vehicleId,
    status: data.action === "assign" ? "pending" : data.action === "start" ? "active" : data.action === "cancel" ? "cancelled" : "completed", archived: data.action === "archive" } });
const make = (storage: MemoryStorage, transport = async (data: any) => ack(data)) => new OperationalCommandClient({
  getUid: () => currentUid, getStorage: () => storage, randomId: () => `id-${++sequence}`, transport,
});
let cases = 0;
async function test(name: string, fn: () => void | Promise<void>) { await fn(); cases++; console.log(`PASS ${name}`); }
await test("transport retry and process reload reuse the persisted request", async () => {
  const storage = new MemoryStorage(); let firstId = "";
  await assert.rejects(() => make(storage, async data => { firstId = data.requestId; throw new Error("response lost"); }).execute(input));
  const result = await make(storage).execute(input, "different-form-id");
  assert.equal(result.requestId, firstId); assert.equal(storage.values.size, 0);
});
await test("offline identity reservation recovers a pre-existing journal before deriving the physical job ID", async () => {
  const storage = new MemoryStorage(); let lostId="", calls=0;
  await assert.rejects(()=>make(storage,async data=>{calls++;lostId=data.requestId;throw new Error("response lost before upgrade");}).execute(input));
  const client=make(storage,async data=>{calls++;return ack(data);});
  assert.equal(client.reserveRequestId(input,"new-form-id"),lostId);
  assert.equal(client.reserveRequestId(input),lostId);
  assert.equal(calls,1,"reservation does not invoke transport");
  assert.equal((await client.execute(input,lostId)).requestId,lostId);
  assert.equal(storage.values.size,0);
});
await test("simultaneous taps join the same in-flight command", async () => {
  const storage = new MemoryStorage(); let count = 0, release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const client = make(storage, async data => { count++; await waiting; return ack(data); });
  const a = client.execute(input), b = client.execute(input); assert.equal(a, b); release();
  await Promise.all([a, b]); assert.equal(count, 1);
});
await test("intentional second manual dispatch receives a new request after the first ACK", async () => {
  const client = make(new MemoryStorage());
  assert.notEqual((await client.execute(input)).requestId, (await client.execute(input)).requestId);
});
await test("arguments and company identity have separate durable request scopes", async () => {
  const storage = new MemoryStorage(), seen: string[] = [];
  const client = make(storage, async data => { seen.push(data.requestId); throw new Error("offline"); });
  await assert.rejects(() => client.execute(input));
  await assert.rejects(() => client.execute({ ...input, vehicleId: "vehicle-b" }));
  await assert.rejects(() => client.execute({ ...input, companyId: "b" }));
  assert.equal(new Set(seen).size, 3);
});
await test("account switch discards the late publication and preserves its recovery journal", async () => {
  const storage = new MemoryStorage(); currentUid = "owner-a";
  await assert.rejects(() => make(storage, async data => { const result = ack(data); currentUid = "owner-b"; return result; }).execute(input), /SESSION_CHANGED/);
  assert.equal(storage.values.size, 1);
  currentUid = "owner-a"; await make(storage).execute(input); assert.equal(storage.values.size, 0);
});
await test("storage failure prevents dispatch before the network call", async () => {
  const storage = new MemoryStorage(); let count = 0;
  storage.setItem = () => { throw new Error("quota"); };
  await assert.rejects(() => make(storage, async data => { count++; return ack(data); }).execute(input), /preservar/);
  assert.equal(count, 0);
});
await test("cleanup failure retains successful ACK and its original request identity", async () => {
  const storage = new MemoryStorage(); storage.removeItem = () => { throw new Error("quota"); };
  const client = make(storage), first = await client.execute(input), again = await client.execute(input);
  assert.equal(first.requestId, again.requestId);
});
await test("a malformed or cross-company ACK never clears the journal", async () => {
  for (const patch of [{ version: 2 }, { requestId: "wrong" }, { job: { ...ack({ ...input, requestId: "x" }).job, companyId: "b" } }]) {
    const storage = new MemoryStorage();
    await assert.rejects(() => make(storage, async data => ({ ...ack(data), ...patch } as any)).execute(input));
    assert.equal(storage.values.size, 1);
  }
});
await test("unconfirmed or wrong-owner start is never presented as active", async () => {
  currentUid = "driver-a";
  for (const jobPatch of [{ status: "pending" }, { driverId: "driver-b" }]) {
    await assert.rejects(() => make(new MemoryStorage(), async data => { const result = ack(data); return { ...result, job: { ...result.job, ...jobPatch } }; })
      .execute({ action: "start", companyId: "a", jobId: "job-a" }));
  }
  currentUid = "owner-a";
});
await test("corrupt journal fails closed without allocating another request", async () => {
  const storage = new MemoryStorage(); storage.getItem = () => "{invalid";
  let calls = 0;
  await assert.rejects(() => make(storage, async data => { calls++; return ack(data); }).execute(input));
  assert.equal(calls, 0);
});
await test("late start response and stale realtime snapshots cannot reopen a terminal operation", () => {
  const completed = { id: "a", companyId: "a", operationalCommandVersion: 1, operationalRevision: 3, status: "completed" };
  assert.equal(mergeManagedOperationAcknowledgement(completed, { ...completed, operationalRevision: 2, status: "active" }).status, "completed");
  assert.equal(mergeManagedOperationAcknowledgement(completed, { ...completed, status: "active" }).status, "completed");
  assert.equal(mergeManagedOperationAcknowledgement({ ...completed, status: "active", operationalRevision: 2 }, completed).status, "completed");
});
await test("archived revisions survive removal from the visible list, with scope reset on account change", () => {
  const cache = new ManagedOperationAcknowledgementCache<any>(); cache.resetScope("driver-a/company-a");
  const row = { id: "a", companyId: "a", operationalCommandVersion: 1, operationalRevision: 4, status: "cancelled", archived: true };
  cache.merge(row);
  assert.equal(cache.merge({ ...row, archived: false, operationalRevision: 2, status: "active" }).archived, true);
  cache.resetScope("driver-b/company-b");
  assert.equal(cache.merge({ ...row, archived: false, operationalRevision: 2, status: "active" }).archived, false);
});
await test("replayed command keeps its original acknowledgement and carries the latest terminal state", async () => {
  const storage = new MemoryStorage();
  const result = await make(storage, async data => {
    const original = ack(data);
    return { ...original, replayed: true, currentJob: { ...original.job, status: "completed", archived: true, operationalRevision: 4 } };
  }).execute(input);
  assert.equal(result.job.status, "pending"); assert.equal(result.currentJob?.status, "completed");
  assert.equal(storage.values.size, 0);
});
await test("managed running job remains visible despite a future timestamp in legacy history", () => {
  const managed = { id: "managed", companyId: "a", driverId: "driver-a", status: "active", operationalCommandVersion: 1, assignedAt: "2026-10-16" };
  const future = { id: "old", companyId: "a", driverId: "driver-a", status: "completed", assignedAt: "2099-01-01" };
  assert.equal(selectCurrentOperationJob([future, managed], "driver-a", "a")?.id, managed.id);
  assert.equal(selectCurrentOperationJob([future, managed], "driver-b", "a"), null);
});
await test("snapshot mode and target take precedence over an edited source catalog", () => {
  const job: any = { id: "job-a", companyId: "a", contractId: "contract-a", totalDeliveries: 1, contractNameSnapshot: "Original",
    contractSnapshot: { mode: "simple", name: "Original", totalDeliveries: 1, deliveries: [] } };
  const resolved = resolveOperationContract(job, [{ id: "contract-a", companyId: "a", mode: "detailed", totalDeliveries: 20, name: "Edited" }] as any);
  assert.equal(resolved?.mode, "simple"); assert.equal(resolved?.totalDeliveries, 1); assert.equal(resolved?.name, "Original");
});
await test("managed null trailer is preserved by receipt writers while legacy fallback stays compatible", () => {
  const catalog = { trailerId: "new-trailer", name: "Edited" };
  assert.equal(operationTrailerId({ operationalCommandVersion: 1, trailerId: null }, catalog), "");
  assert.equal(operationTrailerId({}, catalog), "new-trailer");
  assert.equal(operationContractName({ contractSnapshot: { name: "Original" } }, catalog), "Original");
});
console.log(`OPERATIONAL_COMMAND_CLIENT ${cases}/${cases} PASS`);
