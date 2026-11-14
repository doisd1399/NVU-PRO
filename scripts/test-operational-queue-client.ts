import assert from "node:assert/strict";
import fs from "node:fs";
import "fake-indexeddb/auto";
import {
  OperationalQueueClient,
  collectOperationalQueuePages,
  type QueueMutation,
  type QueueMutationResult,
} from "../src/application/operation/OperationalQueueClient";
import { OperationalCommandClient } from "../src/application/operation/OperationalCommandClient";
import {
  automaticQueueScope,
  isCompleteQueueCache,
  readOperationalQueueCache,
  writeOperationalQueueCache,
} from "../src/lib/operationalQueueCache";
import {
  emptyQueueSettings,
  orderQueueContracts,
  visibleVehicleIds,
  type DriverQueueView,
  type QueuePage,
} from "../functions/src/operationalQueueModel";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}
let uid = "manager-a",
  sequence = 0;
const input: QueueMutation = {
  companyId: "a",
  expectedRevision: 4,
  action: "saveVehicles",
  vehicleIds: ["v1"],
};
const ack = (data: any): QueueMutationResult => ({
  success: true,
  version: 1,
  companyId: data.companyId,
  requestId: data.requestId,
  action: data.action,
  settings: {
    ...emptyQueueSettings(data.companyId),
    revision: data.expectedRevision + 1,
  },
});
const make = (
  storage: MemoryStorage,
  transport = async (data: any) => ack(data),
) =>
  new OperationalQueueClient({
    getUid: () => uid,
    storage: () => storage,
    randomId: () => `request-${++sequence}`,
    transport,
  });
const view = (count = 237): DriverQueueView => ({
  companyId: "a",
  driverId: "driver-a",
  simulatorId: "gto",
  configRevision: 4,
  viewToken: "revision-4",
  historyToken: "history",
  generatedAt: new Date().toISOString(),
  queues: [
    {
      id: "q",
      name: "Pasta",
      state: "active",
      audience: "all",
      count,
      done: 0,
      review: 0,
    },
  ],
  items: Array.from({ length: count }, (_, i) => ({
    id: `c${i}`,
    companyId: "a",
    name: `Operação ${i}`,
    queueId: "q",
    folderName: "Pasta",
    position: i,
    state: "pending",
    totalDeliveries: 1,
    deadlineDays: 3,
  })),
  vehicles: [{ id: "v1", name: "Veículo 1" }],
  next: {
    queueId: "q",
    contractId: "c0",
    configRevision: 4,
    previewToken: "preview",
  },
  currentJob: null,
  manualPendingIds: [],
  reason: "ready",
});
const page = (v: DriverQueueView, offset = 0, limit = 100): QueuePage => {
  const { items, ...metadata } = v;
  return {
    success: true,
    version: 1,
    kind: "driver",
    companyId: "a",
    viewToken: v.viewToken,
    totalItems: items.length,
    offset,
    nextOffset: offset + limit < items.length ? offset + limit : null,
    view: metadata,
    items: items.slice(offset, offset + limit),
  };
};
const scope = automaticQueueScope("driver-a", "a", "driver", "gto");
const results: { name: string; result: string; error?: string }[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    uid = "manager-a";
    await fn();
    results.push({ name, result: "PASS" });
    console.log(`PASS ${name}`);
  } catch (e: any) {
    results.push({ name, result: "FAIL", error: e.stack });
    console.error(`FAIL ${name}`, e);
  }
}

await test("lost configuration reply survives reload and recovers the same request", async () => {
  const storage = new MemoryStorage();
  let first = "";
  await assert.rejects(() =>
    make(storage, async (data) => {
      first = data.requestId;
      throw new Error("reply lost");
    }).execute(input),
  );
  const result = await make(storage).execute({ ...input, vehicleIds: ["v1"] });
  assert.equal(result.requestId, first);
  assert.equal(storage.values.size, 0);
});
await test("double click joins one mutation and intentional later save creates a new identity", async () => {
  let release!: () => void,
    calls = 0;
  const waiting = new Promise<void>((r) => (release = r)),
    client = make(new MemoryStorage(), async (data) => {
      calls++;
      await waiting;
      return ack(data);
    });
  const first = client.execute(input),
    second = client.execute(input);
  assert.equal(first, second);
  release();
  const a = await first;
  assert.equal(calls, 1);
  assert.notEqual((await client.execute(input)).requestId, a.requestId);
});
await test("stable object order reuses retry but a new revision and company stay separate", async () => {
  const storage = new MemoryStorage(),
    seen: string[] = [];
  const client = make(storage, async (data) => {
    seen.push(data.requestId);
    throw new Error("offline");
  });
  await assert.rejects(() => client.execute(input));
  await assert.rejects(() =>
    client.execute({
      vehicleIds: ["v1"],
      action: "saveVehicles",
      expectedRevision: 4,
      companyId: "a",
    }),
  );
  await assert.rejects(() => client.execute({ ...input, expectedRevision: 5 }));
  await assert.rejects(() => client.execute({ ...input, companyId: "b" }));
  assert.equal(seen[0], seen[1]);
  assert.equal(new Set(seen).size, 3);
});
await test("unavailable journal prevents a mutation before any network request", async () => {
  const storage = new MemoryStorage();
  storage.setItem = () => {
    throw new Error("quota");
  };
  let calls = 0;
  await assert.rejects(
    () =>
      make(storage, async (data) => {
        calls++;
        return ack(data);
      }).execute(input),
    /preservar/,
  );
  assert.equal(calls, 0);
});
await test("a late response after account switch is not published or removed from recovery", async () => {
  const storage = new MemoryStorage();
  await assert.rejects(
    () =>
      make(storage, async (data) => {
        uid = "manager-b";
        return ack(data);
      }).execute(input),
    /SESSION_CHANGED/,
  );
  assert.equal(storage.values.size, 1);
});
await test("foreign, mismatched and missing revision acknowledgements keep the recovery identity", async () => {
  for (const corrupt of [
    (v: any) => ({ ...v, companyId: "b" }),
    (v: any) => ({ ...v, requestId: "foreign" }),
    (v: any) => ({ ...v, settings: { ...v.settings, revision: 4 } }),
  ]) {
    const storage = new MemoryStorage();
    await assert.rejects(
      () => make(storage, async (data) => corrupt(ack(data))).execute(input),
      /confirmou/,
    );
    assert.equal(storage.values.size, 1);
  }
});
await test("journal cleanup failure retains the acknowledged request without failing the save", async () => {
  const storage = new MemoryStorage();
  storage.removeItem = () => {
    throw new Error("quota");
  };
  const client = make(storage),
    a = await client.execute(input);
  assert.equal((await client.execute(input)).requestId, a.requestId);
});
await test("all pages are collected above legacy limits before any snapshot is returned", async () => {
  const source = view(),
    seen: number[] = [];
  const result = (await collectOperationalQueuePages(
    async (args) => {
      seen.push(Number(args.offset));
      return page(source, Number(args.offset));
    },
    { companyId: "a", driverId: "driver-a", kind: "driver" },
  )) as DriverQueueView;
  assert.deepEqual(seen, [0, 100, 200]);
  assert.equal(result.items.length, 237);
  assert.equal(source.items.length, 237);
});
await test("a revision change restarts from zero and never merges versions", async () => {
  const old = view(137),
    updated = { ...view(138), viewToken: "revision-5", configRevision: 5 };
  let switched = false;
  const seen: number[] = [];
  const result = (await collectOperationalQueuePages(
    async (args) => {
      const offset = Number(args.offset);
      seen.push(offset);
      if (offset && !switched) {
        switched = true;
        throw Object.assign(new Error("changed"), {
          code: "functions/aborted",
        });
      }
      return page(switched ? updated : old, offset);
    },
    { companyId: "a", driverId: "driver-a", kind: "driver" },
  )) as DriverQueueView;
  assert.deepEqual(seen, [0, 100, 0, 100]);
  assert.equal(result.items.length, 138);
  assert.equal(result.configRevision, 5);
});
await test("incomplete, duplicate and foreign pages fail instead of accepting a cut", async () => {
  for (const corrupt of [
    (p: QueuePage) => ({ ...p, nextOffset: null }),
    (p: QueuePage) => ({
      ...p,
      items: [p.items[0], p.items[0]],
      nextOffset: null,
      totalItems: 2,
    }),
    (p: QueuePage) => ({
      ...p,
      items: [{ ...p.items[0], companyId: "b" }],
      nextOffset: null,
      totalItems: 1,
    }),
  ]) {
    await assert.rejects(
      () =>
        collectOperationalQueuePages(async () => corrupt(page(view(137))), {
          companyId: "a",
          driverId: "driver-a",
          kind: "driver",
        }),
      /QUEUE_PAGE/,
    );
  }
});
await test("invalid cursor and another driver's metadata cannot enter the current scope", async () => {
  await assert.rejects(
    () =>
      collectOperationalQueuePages(
        async () => ({ ...page(view(137)), nextOffset: 99 }),
        { companyId: "a", driverId: "driver-a", kind: "driver" },
      ),
    /CURSOR/,
  );
  await assert.rejects(
    () =>
      collectOperationalQueuePages(
        async () => ({
          ...page(view(1)),
          view: { ...page(view(1)).view, driverId: "other" },
        }),
        { companyId: "a", driverId: "driver-a", kind: "driver" },
      ),
    /INVALID/,
  );
});
await test("account switch between pages stops publication immediately", async () => {
  let current = true,
    calls = 0;
  await assert.rejects(
    () =>
      collectOperationalQueuePages(
        async (args) => {
          calls++;
          const p = page(view(), Number(args.offset));
          if (calls === 2) current = false;
          return p;
        },
        { companyId: "a", driverId: "driver-a", kind: "driver" },
        () => current,
      ),
    /SESSION_CHANGED/,
  );
  assert.equal(calls, 2);
});
await test("persistent offline cache retains the entire validated queue and isolates account, company, role and simulator", async () => {
  const source = view();
  assert.equal(await writeOperationalQueueCache(scope, source), true);
  assert.equal(
    (await readOperationalQueueCache(scope))?.snapshot.items.length,
    237,
  );
  for (const values of [
    ["driver-b", "a", "driver", "gto"],
    ["driver-a", "b", "driver", "gto"],
    ["driver-a", "a", "admin", "gto"],
    ["driver-a", "a", "driver", "ets2"],
  ])
    assert.equal(
      await readOperationalQueueCache(
        automaticQueueScope(...(values as [string, string, string, string])),
      ),
      null,
    );
});
await test("a partial cache write does not replace the last full offline snapshot", async () => {
  const partial = { ...view(), items: view().items.slice(0, 100) };
  assert.equal(await writeOperationalQueueCache(scope, partial), false);
  assert.equal(
    (await readOperationalQueueCache(scope))?.snapshot.items.length,
    237,
  );
});
await test("corrupt cache records, malformed scope and duplicate items are rejected safely", async () => {
  const source = view(2),
    record = {
      schemaVersion: 1,
      scopeKey: scope,
      complete: true,
      storedAt: Date.now(),
      totalItems: 2,
      snapshot: source,
    };
  assert.equal(isCompleteQueueCache(record, scope), true);
  assert.equal(
    isCompleteQueueCache({ ...record, scopeKey: "bad" }, "bad"),
    false,
  );
  assert.equal(
    isCompleteQueueCache(
      {
        ...record,
        snapshot: { ...source, items: [source.items[0], source.items[0]] },
      },
      scope,
    ),
    false,
  );
  assert.equal(await writeOperationalQueueCache("bad", source), false);
  assert.equal(
    isCompleteQueueCache(
      {
        ...record,
        snapshot: {
          ...source,
          items: source.items.map((i) => ({ ...i, queueId: "another" })),
        },
      },
      scope,
    ),
    false,
  );
});
await test("configuration distinguishes unset, saved empty and driver-specific intersection", () => {
  const settings = emptyQueueSettings("a");
  assert.equal(settings.vehicleIds, null);
  settings.vehicleIds = [];
  assert.equal(visibleVehicleIds(settings, "d").size, 0);
  settings.vehicleIds = ["v1", "v2"];
  settings.driverVehicles = [{ driverId: "d", vehicleIds: ["v1", "v3"] }];
  assert.deepEqual([...visibleVehicleIds(settings, "d")], ["v1"]);
  assert.equal(visibleVehicleIds(settings, "new").size, 2);
});
await test("published order survives source changes and new operations append deterministically", () => {
  const rows = [
    { id: "b", companyId: "a", name: "Igual", sequenceOrder: 0 },
    { id: "a", companyId: "a", name: "Igual", sequenceOrder: 0 },
    { id: "new", companyId: "a", name: "Nova", sequenceOrder: -1 },
  ];
  assert.deepEqual(
    orderQueueContracts(rows, ["b", "a"]).map((i) => i.id),
    ["b", "a", "new"],
  );
  assert.deepEqual(
    orderQueueContracts(rows).map((i) => i.id),
    ["a", "b", "new"],
  );
});
await test("automatic start accepts only the exact operation, vehicle and queue that were confirmed", async () => {
  const request = {
    action: "startAutomatic" as const,
    companyId: "a",
    queueId: "q",
    contractId: "c0",
    configRevision: 4,
    previewToken: "preview",
    vehicleId: "v1",
  };
  uid = "driver-a";
  const result = (data: any) => ({
    success: true as const,
    version: 1 as const,
    action: data.action,
    requestId: data.requestId,
    jobId: "j1",
    job: {
      id: "j1",
      companyId: "a",
      driverId: "driver-a",
      contractId: "c0",
      vehicleId: "v1",
      queueId: "q",
      queueRevision: 4,
      status: "active",
    },
  });
  for (const change of [
    { contractId: "other" },
    { vehicleId: "other" },
    { queueId: "other" },
    { queueRevision: 3 },
    { driverId: "other" },
  ]) {
    const storage = new MemoryStorage(),
      client = new OperationalCommandClient({
        getUid: () => uid,
        getStorage: () => storage,
        randomId: () => "id",
        transport: async (data) => {
          const r = result(data);
          return { ...r, job: { ...r.job, ...change } };
        },
      });
    await assert.rejects(() => client.execute(request), /confirmou/);
    assert.equal(storage.values.size, 1);
  }
  const client = new OperationalCommandClient({
    getUid: () => uid,
    getStorage: () => new MemoryStorage(),
    randomId: () => "id",
    transport: async (data) => result(data),
  });
  assert.equal((await client.execute(request)).jobId, "j1");
});
if (process.env.NVU_TEST_OUTPUT)
  fs.writeFileSync(
    process.env.NVU_TEST_OUTPUT,
    JSON.stringify({ results }, null, 2),
  );
console.log(
  `OPERATIONAL_QUEUE_CLIENT ${results.filter((r) => r.result === "PASS").length}/${results.length} PASS`,
);
if (results.some((r) => r.result !== "PASS")) process.exitCode = 1;
