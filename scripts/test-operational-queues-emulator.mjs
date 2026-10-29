import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, updateDoc } from "firebase/firestore";
const projectId = "demo-nvu-v36-4-staging";
assert.equal(process.env.GCLOUD_PROJECT, projectId);
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^127\.0\.0\.1:\d+$/);
const require = createRequire(
  new URL("../functions/package.json", import.meta.url),
);
const admin = require(process.cwd()+"/functions/lib/firebaseAdmin.js");
if (!admin.apps.length) admin.initializeApp({ projectId });
const {
  executeOperationalCommand,
  operationalCompletionId,
  prepareCompanyOperationalCommands,
} = require("./lib/operationalCommands.js");
const {
  getOperationalQueues,
  configureOperationalQueues,
  refreshOperationalQueueTrailer,
} = require("./lib/operationalQueues.js");
const {
  completeCanonicalOperation,
} = require("./lib/completeCanonicalOperation.js");
const env = await initializeTestEnvironment({
  projectId,
  firestore: { rules: fs.readFileSync("firestore.rules", "utf8") },
});
const db = admin.firestore(),
  context = (uid) => ({ auth: { uid, token: {} } });
const owner = context("owner-a"),
  driver = context("driver-a"),
  other = context("driver-b");
let sequence = 0;
const denied = (fn, code = "permission-denied") =>
  assert.rejects(fn, (err) => String(err.code).includes(code));
const hash = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const get = (kind = "driver", actor = driver, args = {}) =>
  getOperationalQueues.run({ companyId: "a", kind, ...args }, actor);
const settings = async () => (await get("settings", owner)).settings;
const configure = async (
  args,
  actor = owner,
  requestId = `config-${++sequence}`,
) =>
  configureOperationalQueues.run(
    {
      companyId: "a",
      expectedRevision: (await settings()).revision,
      ...args,
      requestId,
    },
    actor,
  );
async function catalog() {
  const first = await get("catalog", owner),
    all = [...first.items];
  let next = first.nextOffset;
  while (next !== null) {
    const page = await get("catalog", owner, {
      offset: next,
      viewToken: first.viewToken,
    });
    all.push(...page.items);
    next = page.nextOffset;
  }
  return { ...first.view, contracts: all, viewToken: first.viewToken };
}
async function view(actor = driver) {
  const first = await get("driver", actor),
    all = [...first.items];
  let next = first.nextOffset;
  while (next !== null) {
    const page = await get("driver", actor, {
      offset: next,
      viewToken: first.viewToken,
    });
    all.push(...page.items);
    next = page.nextOffset;
  }
  return { ...first.view, items: all, viewToken: first.viewToken };
}
async function queue(folderId = "folder-a", args = {}) {
  const data = await catalog(),
    f = data.folders.find((row) => row.id === folderId);
  return configure({
    action: "saveQueue",
    folderToken: f.token,
    queue: {
      folderId,
      state: "active",
      audience: "all",
      driverIds: [],
      orderIds: data.contracts
        .filter((c) => c.sequenceId === folderId)
        .sort((a, b) => a.sequenceOrder - b.sequenceOrder)
        .map((c) => c.id),
      ...args,
    },
  });
}
const vehicles = (vehicleIds = ["vehicle-a", "vehicle-2"], args = {}) =>
  configure({ action: "saveVehicles", vehicleIds, ...args });
async function start(
  actor = driver,
  args = {},
  requestId = `start-${++sequence}`,
) {
  const v = await view(actor);
  return executeOperationalCommand(
    db,
    {
      action: "startAutomatic",
      companyId: "a",
      ...v.next,
      vehicleId: "vehicle-a",
      ...args,
      requestId,
    },
    actor,
  );
}
async function receipt(job, uid = "driver-a") {
  await db.doc(`historico_viagens/trip-${job.jobId}`).set({
    jobId: job.jobId,
    operationId: job.jobId,
    companyId: "a",
    empresaId: "a",
    driverId: uid,
    motoristaId: uid,
    contractId: job.job.contractId,
    source: "gto_auto",
    recordStatus: "concluida",
    status: "concluida",
    uploadedAt: new Date(),
    serverValidatedAt: new Date(),
    operationSlot: 1,
  });
}
async function finish(job, actor = driver) {
  await receipt(job, actor.auth.uid);
  return completeCanonicalOperation.run({ jobId: job.jobId }, actor);
}
async function seed() {
  await env.clearFirestore();
  const rows = [
    [
      "frotas/a",
      {
        ownerId: "owner-a",
        userId: "owner-a",
        simulatorId: "GTO",
        status: "active",
        operationalCommandVersion: 1,
      },
    ],
    [
      "frotas/b",
      {
        ownerId: "owner-b",
        userId: "owner-b",
        simulatorId: "GTO",
        operationalCommandVersion: 1,
      },
    ],
    ["users/owner-a", { role: "admin", companyId: "a", status: "active" }],
    ["users/owner-b", { role: "admin", companyId: "b", status: "active" }],
    [
      "users/profile-admin",
      { role: "admin", companyId: "a", status: "active" },
    ],
    [
      "sequencias/folder-a",
      { companyId: "a", name: "Primeira pasta", scope: "operations" },
    ],
    [
      "sequencias/folder-b",
      { companyId: "a", name: "Segunda pasta", scope: "operations" },
    ],
    [
      "veiculos/vehicle-a",
      { companyId: "a", name: "Veículo A", status: "available", plate: "ABC" },
    ],
    [
      "veiculos/vehicle-2",
      { companyId: "a", name: "Veículo 2", status: "available" },
    ],
    [
      "veiculos/foreign",
      { companyId: "b", name: "Outra empresa", status: "available" },
    ],
  ];
  for (const uid of ["driver-a", "driver-b"])
    rows.push(
      [
        `users/${uid}`,
        { role: "driver", companyId: "a", name: uid, status: "active" },
      ],
      [
        `companyMembers/${uid}_a`,
        { userId: uid, companyId: "a", status: "active", roles: ["driver"] },
      ],
      [
        `simulator_members/${uid}_a`,
        { userId: uid, companyId: "a", status: "active", roles: ["driver"] },
      ],
    );
  for (const [cid, folder, order] of [
    ["contract-a", "folder-a", 0],
    ["contract-b", "folder-a", 1],
    ["contract-c", "folder-b", 0],
  ])
    rows.push([
      `contratos/${cid}`,
      {
        companyId: "a",
        name: "Mesmo nome",
        simulator: "GTO",
        sequenceId: folder,
        sequenceOrder: order,
        mode: "simple",
        totalDeliveries: 1,
        deadlineDays: 3,
        status: "active",
      },
    ]);
  const batch = db.batch();
  rows.forEach(([path, data]) => batch.set(db.doc(path), data));
  await batch.commit();
  // The Functions emulator is not started: explicitly run the real 501
  // projection that would be produced by membership triggers in production.
  const { refreshCompanyAccess } = require("./lib/companyAccess.js");
  for (const uid of ["owner-a", "driver-a", "driver-b", "member-admin", "profile-admin-a"])
    if ((await db.doc(`users/${uid}`).get()).exists) await refreshCompanyAccess(db, uid, "a");

}
const results = [];
async function test(name, fn) {
  const before = performance.now();
  try {
    await seed();
    await fn();
    results.push({
      name,
      result: "PASS",
      seconds: +((performance.now() - before) / 1000).toFixed(3),
    });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, result: "FAIL", error: error.stack });
    console.error(`FAIL ${name}`, error);
  }
}
try {
  await test("optional configuration starts empty and enables a legacy company only after explicit manager opt-in", async () => {
    assert.equal((await view()).reason, "no_queues");
    await db.doc("frotas/a").update({
      operationalCommandVersion: admin.firestore.FieldValue.delete(),
    });
    await queue("folder-a", { state: "paused" });
    assert.equal(
      (await db.doc("frotas/a").get()).get("operationalCommandVersion"),
      undefined,
    );
    const readiness = await prepareCompanyOperationalCommands.run(
      { companyId: "a", enable: false },
      owner,
    );
    assert.equal(readiness.ready, true);
    assert.equal(readiness.enabled, false);
    assert.equal((await db.doc("frotas/a").get()).get("operationalCommandVersion"), undefined);
    const enableResult = await prepareCompanyOperationalCommands.run(
      { companyId: "a", enable: true },
      owner,
    );
    assert.equal(enableResult.success, true);
    assert.equal(enableResult.enabled, true);
    await configure({
      action: "setState",
      queueId: "folder-a",
      state: "active",
    });
    assert.equal(
      (await db.doc("frotas/a").get()).get("operationalCommandVersion"),
      1,
    );
    assert.equal((await db.collection("trabalhos").get()).size, 0);
  });
  await test("same folder and equal names retain separate progress for each driver and original ID", async () => {
    await queue();
    await vehicles();
    const a = await start();
    assert.equal(a.job.contractId, "contract-a");
    assert.equal(a.job.status, "active");
    assert.equal(a.job.operationSource, "operational-queue-v1");
    await finish(a);
    const va = await view(),
      vb = await view(other);
    assert.equal(va.items.find((x) => x.id === "contract-a").state, "done");
    assert.equal(va.next.contractId, "contract-b");
    assert.equal(vb.next.contractId, "contract-a");
    assert.equal(vb.items.find((x) => x.id === "contract-b").state, "pending");
  });
  await test("all-fleet audience includes new active members and selected audience excludes others", async () => {
    await queue("folder-a", { audience: "selected", driverIds: ["driver-a"] });
    await vehicles();
    assert.equal((await view(other)).queues.length, 0);
    await queue();
    await db
      .doc("users/new-driver")
      .set({ role: "driver", companyId: "a", status: "active" });
    await db.doc("companyMembers/new-driver-a").set({
      userId: "new-driver",
      companyId: "a",
      roles: ["driver"],
      status: "active",
    });
    assert.equal(
      (await view(context("new-driver"))).next.contractId,
      "contract-a",
    );
  });
  await test("queue priority and item order use revision checks and reject stale start previews", async () => {
    await queue();
    await queue("folder-b");
    await vehicles();
    const old = await view();
    await configure({
      action: "reorderQueues",
      queueIds: ["folder-b", "folder-a"],
    });
    await denied(
      () =>
        executeOperationalCommand(
          db,
          {
            action: "startAutomatic",
            companyId: "a",
            ...old.next,
            vehicleId: "vehicle-a",
            requestId: "stale-priority",
          },
          driver,
        ),
      "aborted",
    );
    assert.equal((await view()).next.contractId, "contract-c");
    await configure({
      action: "setState",
      queueId: "folder-b",
      state: "paused",
    });
    await queue("folder-a", { orderIds: ["contract-b", "contract-a"] });
    assert.deepEqual(
      (await view()).items
        .filter((i) => i.queueId === "folder-a")
        .map((i) => i.id),
      ["contract-b", "contract-a"],
    );
    assert.equal((await view()).next.contractId, "contract-b");
  });
  await test("pause/archive/participant edits preserve an already started job and its vehicle", async () => {
    await queue();
    await vehicles();
    const a = await start();
    await queue("folder-a", { audience: "selected", driverIds: ["driver-b"] });
    await vehicles(["vehicle-2"]);
    await configure({
      action: "setState",
      queueId: "folder-a",
      state: "archived",
    });
    const saved = (await db.doc(`trabalhos/${a.jobId}`).get()).data();
    assert.equal(saved.vehicleId, "vehicle-a");
    assert.equal(saved.status, "active");
    await finish(a);
    assert.equal((await db.doc("sequencias/folder-a").get()).exists, true);
    assert.equal((await db.doc("contratos/contract-a").get()).exists, true);
    assert.equal((await view()).queues.length, 0);
  });
  await test("a manual pending assignment takes priority over automatic creation", async () => {
    await queue();
    await vehicles();
    const manual = await executeOperationalCommand(
      db,
      {
        action: "assign",
        companyId: "a",
        contractId: "contract-c",
        driverId: "driver-a",
        vehicleId: "vehicle-2",
        trailerId: null,
        requestId: "manual-first",
      },
      owner,
    );
    const v = await view();
    assert.equal(v.reason, "manual_pending");
    assert.equal(v.next, null);
    await denied(
      () =>
        executeOperationalCommand(
          db,
          {
            action: "startAutomatic",
            companyId: "a",
            queueId: "folder-a",
            contractId: "contract-a",
            configRevision: v.configRevision,
            previewToken: "old",
            vehicleId: "vehicle-a",
            requestId: "bypass-manual",
          },
          driver,
        ),
      "failed-precondition",
    );
    assert.equal((await db.collection("trabalhos").get()).size, 1);
    assert.equal(manual.job.vehicleId, "vehicle-2");
  });
  await test("idempotent automatic start and two-device contention allocate exactly one execution", async () => {
    await queue();
    await vehicles();
    const v = await view();
    const args = {
      action: "startAutomatic",
      companyId: "a",
      ...v.next,
      vehicleId: "vehicle-a",
      requestId: "same-start",
    };
    const replies = await Promise.all([
      executeOperationalCommand(db, args, driver),
      executeOperationalCommand(db, args, driver),
    ]);
    assert.equal(replies[0].jobId, replies[1].jobId);
    assert.equal((await db.collection("trabalhos").get()).size, 1);
    await denied(
      () =>
        executeOperationalCommand(
          db,
          { ...args, requestId: "different-start" },
          driver,
        ),
      "failed-precondition",
    );
    await denied(
      () =>
        executeOperationalCommand(
          db,
          { ...args, vehicleId: "vehicle-2" },
          driver,
        ),
      "failed-precondition",
    );
  });
  await test("vehicle visibility distinguishes unset, empty, inherited and restricted selections", async () => {
    await queue();
    assert.equal((await view()).reason, "vehicles_unconfigured");
    await vehicles([]);
    assert.equal((await view()).reason, "no_vehicles");
    await vehicles();
    await vehicles([], { driverId: "driver-a" });
    assert.equal((await view()).vehicles.length, 0);
    await vehicles(["vehicle-a"], { driverId: "driver-a" });
    assert.deepEqual(
      (await view()).vehicles.map((v) => v.id),
      ["vehicle-a"],
    );
    await vehicles(["vehicle-2"]);
    assert.equal((await view()).vehicles.length, 0);
    await vehicles([], { driverId: "driver-a", useDefault: true });
    assert.deepEqual(
      (await view()).vehicles.map((v) => v.id),
      ["vehicle-2"],
    );
    await denied(() => vehicles(["foreign"]), "failed-precondition");
  });
  await test("shared in-use vehicles stay selectable while maintenance and removed visibility invalidate start", async () => {
    await queue();
    await vehicles();
    await start(other);
    assert.ok((await view()).vehicles.some((v) => v.id === "vehicle-a"));
    const stale = await view();
    await db.doc("veiculos/vehicle-a").update({ status: "maintenance" });
    await denied(
      () =>
        executeOperationalCommand(
          db,
          {
            action: "startAutomatic",
            companyId: "a",
            ...stale.next,
            vehicleId: "vehicle-a",
            requestId: "maintenance",
          },
          driver,
        ),
      "aborted",
    );
    assert.ok(!(await view()).vehicles.some((v) => v.id === "vehicle-a"));
  });
  await test("two managers cannot silently overwrite settings and replay creates no second revision", async () => {
    const c = await catalog(),
      args = {
        companyId: "a",
        action: "saveVehicles",
        vehicleIds: ["vehicle-a"],
        expectedRevision: 0,
        requestId: "config-once",
      };
    await configureOperationalQueues.run(args, owner);
    await configureOperationalQueues.run(args, owner);
    assert.equal((await settings()).revision, 1);
    await denied(
      () =>
        configureOperationalQueues.run(
          { ...args, vehicleIds: ["vehicle-2"] },
          owner,
        ),
      "failed-precondition",
    );
    const outcomes = await Promise.allSettled(
      ["one", "two"].map((requestId) =>
        configureOperationalQueues.run(
          { ...args, expectedRevision: 1, requestId },
          owner,
        ),
      ),
    );
    assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await settings()).revision, 2);
  });
  await test("complete pagination exceeds legacy 120-contract and 100-vehicle cache cuts", async () => {
    const batch = db.batch();
    for (let i = 0; i < 135; i++)
      batch.set(db.doc(`contratos/many-${String(i).padStart(3, "0")}`), {
        companyId: "a",
        name: `Operação ${i}`,
        sequenceId: "folder-a",
        sequenceOrder: i + 2,
        simulator: "GTO",
        mode: "simple",
        totalDeliveries: 1,
        deadlineDays: 1,
        status: "active",
      });
    for (let i = 0; i < 125; i++)
      batch.set(db.doc(`veiculos/many-${i}`), {
        companyId: "a",
        name: `Veículo ${i}`,
        status: "available",
      });
    await batch.commit();
    const c = await catalog();
    assert.equal(c.contracts.length, 138);
    assert.equal(c.vehicles.length, 127);
    await queue();
    await vehicles(c.vehicles.map((v) => v.id));
    const v = await view();
    assert.equal(v.items.length, 137);
    assert.equal(v.vehicles.length, 127);
    const first = await get();
    assert.equal(first.items.length, 100);
    assert.equal(first.nextOffset, 100);
    await configure({
      action: "setState",
      queueId: "folder-a",
      state: "paused",
    });
    await denied(
      () => get("driver", driver, { offset: 100, viewToken: first.viewToken }),
      "aborted",
    );
  });
  await test("server history beyond 80 jobs recognizes qualified legacy completions by physical IDs", async () => {
    const batch = db.batch();
    for (let i = 0; i < 95; i++) {
      const cid = `old-contract-${i}`,
        jid = `old-job-${i}`;
      batch.set(db.doc(`contratos/${cid}`), {
        companyId: "a",
        name: "Mesmo nome",
        sequenceId: "folder-a",
        sequenceOrder: i,
        simulator: "GTO",
        mode: "simple",
        totalDeliveries: 1,
        deadlineDays: 1,
        status: "active",
      });
      batch.set(db.doc(`trabalhos/${jid}`), {
        companyId: "a",
        driverId: "driver-a",
        contractId: cid,
        totalDeliveries: 1,
        status: "completed",
      });
      batch.set(db.doc(`historico_viagens/old-trip-${i}`), {
        jobId: jid,
        driverId: "driver-a",
        companyId: "a",
        contractId: cid,
        recordStatus: "concluida",
        status: "concluida",
        source: "gto_auto",
        uploadedAt: new Date(),
      });
    }
    await batch.commit();
    await queue();
    await vehicles();
    const v = await view();
    assert.equal(v.items.filter((i) => i.state === "done").length, 95);
    assert.equal(v.next.contractId, "contract-a");
  });
  await test("unproven completed flags and orphan receipts require explicit audited manager review", async () => {
    await db.doc("trabalhos/forged-old").set({
      companyId: "a",
      driverId: "driver-a",
      contractId: "contract-a",
      status: "completed",
      totalDeliveries: 1,
    });
    await db.doc("historico_viagens/unbound").set({
      driverId: "driver-a",
      companyId: "a",
      contractId: "contract-b",
      recordStatus: "concluida",
      status: "concluida",
      source: "gto_auto",
      uploadedAt: new Date(),
    });
    await queue();
    await vehicles();
    const before = await view();
    assert.equal(before.reason, "review");
    assert.equal(before.items.filter((i) => i.state === "review").length, 2);
    await denied(() =>
      configure(
        {
          action: "reviewHistory",
          driverId: "driver-a",
          historyToken: before.historyToken,
          reviewedIds: ["contract-a", "contract-b"],
          doneIds: ["contract-a"],
          confirmed: true,
        },
        driver,
      ),
    );
    await configure({
      action: "reviewHistory",
      driverId: "driver-a",
      historyToken: before.historyToken,
      reviewedIds: ["contract-a", "contract-b"],
      doneIds: ["contract-a"],
      confirmed: true,
    });
    const after = await view();
    assert.equal(after.next.contractId, "contract-b");
    assert.equal(
      after.items.find((i) => i.id === "contract-a").completionSource,
      "manager-review",
    );
    await finish(await start());
    assert.equal(
      (await view()).items.find((i) => i.id === "contract-a").state,
      "done",
    );
    assert.equal(
      (await db.collection("automaticQueueHistoryReviews").get()).size,
      1,
    );
  });
  await test("history without source identity is never attached by operation name", async () => {
    await db.doc("historico_viagens/no-identity").set({
      driverId: "driver-a",
      companyId: "a",
      contractName: "Mesmo nome",
      recordStatus: "concluida",
      status: "concluida",
      source: "gto_auto",
      uploadedAt: new Date(),
    });
    await queue();
    await vehicles();
    const v = await view();
    assert.equal(v.reason, "review");
    assert.equal(
      v.items.every((i) => i.state === "review"),
      true,
    );
  });
  await test("catalog edits during confirmation reject a stale preview and started snapshots remain immutable", async () => {
    await queue();
    await vehicles();
    const v = await view();
    await db.doc("contratos/contract-a").update({ name: "Editada" });
    await denied(
      () =>
        executeOperationalCommand(
          db,
          {
            action: "startAutomatic",
            companyId: "a",
            ...v.next,
            vehicleId: "vehicle-a",
            requestId: "old-source",
          },
          driver,
        ),
      "aborted",
    );
    const a = await start();
    await db
      .doc("contratos/contract-a")
      .update({ name: "Outra edição", sequenceId: "folder-b" });
    assert.equal(
      (await db.doc(`trabalhos/${a.jobId}`).get()).get("contractSnapshot.name"),
      "Editada",
    );
    await finish(a);
    assert.equal((await view()).next.contractId, "contract-b");
  });
  await test("preparation reports exact blockers read-only and only to the company manager", async () => {
    const original = (await db.doc("frotas/a").get()).data();
    await db.doc("trabalhos/alias-job").set({ empresaId: "a", motoristaId: "driver-a",
      contratoId: "contract-a", veiculoId: "vehicle-a", status: " pending " });
    const check = await get("preparation", owner);
    assert.equal(check.ready, false);
    assert.deepEqual(check.invalidScopes, ["alias-job"]);
    assert.equal(check.jobs[0].canNormalize, true);
    assert.match(check.jobs[0].issues.join(" "), /campo antigo/);
    assert.match(check.token, /^[a-f0-9]{64}$/);
    assert.deepEqual((await db.doc("frotas/a").get()).data(), original);
    assert.equal((await db.doc("operationalQueueSettings/a").get()).exists, false);
    await denied(() => get("preparation", driver));
    await denied(() => getOperationalQueues.run({ companyId: "b", kind: "preparation" }, owner));
    await denied(() => configure({ action: "normalizeLegacyJobs", jobIds: ["alias-job"],
      preparationToken: check.token, confirmed: true }, driver));
  });
  await test("explicit alias repair preserves physical ID, receipts, progress, snapshots and deadlines", async () => {
    await db.doc("frotas/a").update({ operationalCommandVersion: admin.firestore.FieldValue.delete() });
    const old = { empresaId: "a", motoristaId: "driver-a", contratoId: "contract-a",
      veiculoId: "vehicle-a", vehicleId: null, status: " pending ", progress: 7,
      totalDeliveries: 12, dueAt: "2027-01-01T00:00:00.000Z", contractSnapshot: { name: "Frozen", totalDeliveries: 12 } };
    await db.doc("trabalhos/legacy-physical-id").set(old);
    const trip = { jobId: "legacy-physical-id", value: 123.45, companyId: "a" };
    await db.doc("historico_viagens/preserved-trip").set(trip);
    const check = await get("preparation", owner);
    const input = { action: "normalizeLegacyJobs", jobIds: ["legacy-physical-id"], preparationToken: check.token, confirmed: true };
    await denied(() => configure({ ...input, confirmed: false }), "invalid-argument");
    const result = await configure(input, owner, "repair-alias-idempotent");
    const replay = await configure({ ...input, expectedRevision: result.settings.revision - 1 }, owner, "repair-alias-idempotent");
    assert.equal(replay.replayed, true);
    const after = (await db.doc("trabalhos/legacy-physical-id").get()).data();
    for (const key of ["progress", "totalDeliveries", "dueAt", "contractSnapshot", "empresaId", "motoristaId"])
      assert.deepEqual(after[key], old[key]);
    assert.equal(after.companyId, "a"); assert.equal(after.driverId, "driver-a");
    assert.equal(after.contractId, "contract-a"); assert.equal(after.vehicleId, "vehicle-a");
    assert.equal(after.status, "pending");
    assert.deepEqual((await db.doc("historico_viagens/preserved-trip").get()).data(), trip);
    assert.equal((await get("preparation", owner)).ready, true);
    assert.equal((await db.doc("frotas/a").get()).get("operationalCommandVersion"), undefined);
    const audits = await db.collection("operationalQueueAudits").where("action", "==", "normalizeLegacyJobs").get();
    assert.equal(audits.size, 1);
    assert.equal(audits.docs[0].get("preparationReview.normalizedJobs")[0].jobId, "legacy-physical-id");
  });
  await test("legacy repair rejects changed evidence and leaves every selected row untouched", async () => {
    const old = { companyId: "a", driverId: "driver-a", contractId: "contract-a", vehicleId: null,
      veiculoId: "vehicle-a", status: "pending" };
    await db.doc("trabalhos/repair-stale").set(old);
    const check = await get("preparation", owner);
    await db.doc("trabalhos/another-job").set({ companyId: "a", driverId: "driver-b", status: "completed" });
    await denied(() => configure({ action: "normalizeLegacyJobs", jobIds: ["repair-stale"],
      preparationToken: check.token, confirmed: true }), "aborted");
    assert.deepEqual((await db.doc("trabalhos/repair-stale").get()).data(), old);
    assert.equal((await db.doc("operationalQueueSettings/a").get()).exists, false);
  });
  await test("ambiguous IDs, absent reference and cross-company reference cannot be normalized", async () => {
    const base = { companyId: "a", driverId: "driver-a", contractId: "contract-a", status: "pending" };
    for (const [jobId, fields] of [["ambiguous", { vehicleId: "vehicle-a", veiculoId: "vehicle-2" }],
      ["missing", { vehicleId: null, veiculoId: "absent" }], ["foreign", { vehicleId: null, veiculoId: "foreign" }]]) {
      const old = { ...base, ...fields };
      await db.doc(`trabalhos/${jobId}`).set(old);
      const check = await get("preparation", owner);
      await denied(() => configure({ action: "normalizeLegacyJobs", jobIds: [jobId],
        preparationToken: check.token, confirmed: true }), "failed-precondition");
      assert.deepEqual((await db.doc(`trabalhos/${jobId}`).get()).data(), old);
    }
    assert.equal((await db.doc("operationalQueueSettings/a").get()).exists, false);
  });
  await test("duplicate resolution keeps the explicitly chosen operation and protects receipts and shared resources", async () => {
    await db.doc("frotas/a").update({ operationalCommandVersion: admin.firestore.FieldValue.delete() });
    const base = { companyId: "a", driverId: "driver-a", contractId: "contract-a", vehicleId: "vehicle-a",
      status: "active", totalDeliveries: 1, progress: 0, dueAt: "2027-01-01T00:00:00.000Z" };
    await db.doc("trabalhos/keep-me").set(base);
    await db.doc("trabalhos/cancel-me").set({ ...base, vehicleId: "vehicle-2", progress: 1 });
    await db.doc("trabalhos/also-cancel").set(base);
    await db.doc("veiculos/vehicle-a").update({ status: "in_use" });
    await db.doc("veiculos/vehicle-2").update({ status: "in_use" });
    await db.doc("historico_viagens/preserved-cancelled-receipt").set({ jobId: "cancel-me", value: 345.67 });
    const stateRef = db.doc(`operationalDriverStates/${hash(["a", "driver-a"])}`);
    await stateRef.set({ companyId: "a", driverId: "driver-a", currentJobId: "cancel-me", schemaVersion: 1 });
    const check = await get("preparation", owner);
    const input = { action: "resolveLegacyConflict", driverId: "driver-a", keepJobId: "keep-me", preparationToken: check.token, confirmed: true };
    await denied(() => configure({ ...input, confirmed: false }), "invalid-argument");
    await denied(() => configure({ ...input, keepJobId: "not-in-conflict" }), "failed-precondition");
    await configure(input);
    assert.deepEqual((await db.doc("trabalhos/keep-me").get()).data(), base);
    const canceled = (await db.doc("trabalhos/cancel-me").get()).data();
    assert.equal(canceled.status, "cancelled"); assert.equal(canceled.progress, 1);
    assert.equal(canceled.cancellationSource, "queue-preparation-manager-review");
    assert.equal((await db.doc("trabalhos/also-cancel").get()).get("status"), "cancelled");
    assert.equal((await stateRef.get()).get("currentJobId"), "keep-me");
    assert.equal((await db.doc("veiculos/vehicle-a").get()).get("status"), "in_use");
    assert.equal((await db.doc("veiculos/vehicle-2").get()).get("status"), "available");
    assert.deepEqual((await db.doc("historico_viagens/preserved-cancelled-receipt").get()).data(), { jobId: "cancel-me", value: 345.67 });
    assert.equal((await get("preparation", owner)).ready, true);
    assert.equal((await db.doc("frotas/a").get()).get("operationalCommandVersion"), undefined);
  });
  await test("resolving a driver conflict never releases an asset held by another driver", async () => {
    const base = { companyId: "a", driverId: "driver-a", contractId: "contract-a", status: "active" };
    await db.doc("trabalhos/keep").set({ ...base, vehicleId: "vehicle-a" });
    await db.doc("trabalhos/cancel").set({ ...base, vehicleId: "vehicle-2" });
    await db.doc("trabalhos/other-driver").set({ ...base, driverId: "driver-b", vehicleId: "vehicle-2" });
    await db.doc("veiculos/vehicle-2").update({ status: "in_use" });
    const check = await get("preparation", owner);
    await configure({ action: "resolveLegacyConflict", driverId: "driver-a", keepJobId: "keep", preparationToken: check.token, confirmed: true });
    assert.equal((await db.doc("veiculos/vehicle-2").get()).get("status"), "in_use");
    assert.equal((await db.doc("trabalhos/other-driver").get()).get("status"), "active");
  });
  await test("concurrent conflicting manager choices commit only one audited resolution", async () => {
    const base = { companyId: "a", driverId: "driver-a", contractId: "contract-a", vehicleId: "vehicle-a", status: "active" };
    await db.doc("trabalhos/choice-1").set(base); await db.doc("trabalhos/choice-2").set(base);
    const check = await get("preparation", owner);
    const results = await Promise.allSettled(["choice-1", "choice-2"].map((keepJobId, i) => configure({
      action: "resolveLegacyConflict", expectedRevision: 0, driverId: "driver-a", keepJobId,
      preparationToken: check.token, confirmed: true }, owner, `concurrent-repair-${i}`)));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const jobs = await db.collection("trabalhos").get();
    assert.equal(jobs.docs.filter((row) => row.get("status") === "active").length, 1);
    assert.equal(jobs.docs.filter((row) => row.get("status") === "cancelled").length, 1);
    assert.equal((await db.collection("operationalQueueAudits").get()).size, 1);
  });
  await test("review, activate, finish a preserved legacy operation and start the next queue item", async () => {
    await db.doc("frotas/a").update({ operationalCommandVersion: admin.firestore.FieldValue.delete() });
    const base = { companyId: "a", driverId: "driver-a", contractId: "contract-a", vehicleId: "vehicle-a",
      status: "active", totalDeliveries: 1, progress: 0, dueAt: "2027-01-01T00:00:00.000Z" };
    await db.doc("trabalhos/current-legacy").set({ ...base, vehicleId: null, veiculoId: "vehicle-a" });
    await db.doc("trabalhos/duplicate-legacy").set(base);
    let check = await get("preparation", owner);
    await configure({ action: "normalizeLegacyJobs", jobIds: ["current-legacy"], preparationToken: check.token, confirmed: true });
    check = await get("preparation", owner);
    await configure({ action: "resolveLegacyConflict", driverId: "driver-a", keepJobId: "current-legacy", preparationToken: check.token, confirmed: true });
    await assert.rejects(
      () => queue(),
      (error) => error.code === "failed-precondition" &&
        error.details.reasonCode === "OPERATIONAL_COMMANDS_NOT_ENABLED",
    );
    assert.equal((await db.doc("frotas/a").get()).get("operationalCommandVersion"), undefined);
    const settingsAfterRejectedActivation = await db.doc("operationalQueueSettings/a").get();
    assert.equal(
      (settingsAfterRejectedActivation.get("queues") || []).some((queue) => queue.state === "active"),
      false,
    );
    const enableResult = await prepareCompanyOperationalCommands.run(
      { companyId: "a", enable: true },
      owner,
    );
    assert.equal(enableResult.enabled, true);
    assert.equal(enableResult.ready, true);
    await queue(); await vehicles();
    assert.equal((await db.doc("frotas/a").get()).get("operationalCommandVersion"), 1);
    assert.equal((await view()).reason, "running");
    await finish({ jobId: "current-legacy", job: { contractId: "contract-a" } });
    assert.equal((await view()).next.contractId, "contract-b");
    const next = await start();
    assert.equal(next.job.contractId, "contract-b");
    assert.equal(next.job.status, "active");
  });
  await test("activation with conflicting legacy jobs is atomic and leaves no automatic configuration", async () => {
    await db.doc("frotas/a").update({
      operationalCommandVersion: admin.firestore.FieldValue.delete(),
    });
    for (const jid of ["old-1", "old-2"])
      await db.doc(`trabalhos/${jid}`).set({
        companyId: "a",
        driverId: "driver-a",
        contractId: "contract-a",
        vehicleId: "vehicle-a",
        status: "active",
      });
    await assert.rejects(() => queue(), (error) => error.code === "failed-precondition" &&
      error.details.reasonCode === "LEGACY_OPERATION_PREPARATION_REQUIRED" && error.details.conflictCount === 1);
    assert.equal(
      (await db.doc("operationalQueueSettings/a").get()).exists,
      false,
    );
    assert.equal(
      (await db.doc("frotas/a").get()).get("operationalCommandVersion"),
      undefined,
    );
  });
  await test("different requests from two devices contend for one active execution", async () => {
    await queue();
    await vehicles();
    const v = await view();
    const outcomes = await Promise.allSettled(
      ["device-1", "device-2"].map((requestId) =>
        executeOperationalCommand(
          db,
          {
            action: "startAutomatic",
            companyId: "a",
            ...v.next,
            vehicleId: "vehicle-a",
            requestId,
          },
          driver,
        ),
      ),
    );
    assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await db.collection("trabalhos").get()).size, 1);
  });
  await test("manual dispatch racing an automatic start preserves one current job and manual priority", async () => {
    await queue();
    await vehicles();
    const v = await view();
    const results = await Promise.allSettled([
      executeOperationalCommand(
        db,
        {
          action: "startAutomatic",
          companyId: "a",
          ...v.next,
          vehicleId: "vehicle-a",
          requestId: "auto-race",
        },
        driver,
      ),
      executeOperationalCommand(
        db,
        {
          action: "assign",
          companyId: "a",
          contractId: "contract-c",
          driverId: "driver-a",
          vehicleId: "vehicle-2",
          trailerId: null,
          requestId: "manual-race",
        },
        owner,
      ),
    ]);
    assert.equal(results[1].status, "fulfilled");
    const jobs = (await db.collection("trabalhos").get()).docs;
    assert.ok(jobs.filter((j) => j.get("status") === "active").length <= 1);
    assert.equal(jobs.filter((j) => j.get("status") === "pending").length, 1);
    if (results[0].status === "fulfilled") await finish(results[0].value);
    assert.equal((await view()).reason, "manual_pending");
  });
  await test("cancellation permits a new physical execution while awaiting completion does not advance", async () => {
    await queue();
    await vehicles();
    const first = await start();
    await executeOperationalCommand(
      db,
      {
        action: "cancel",
        companyId: "a",
        jobId: first.jobId,
        requestId: "cancel-first",
      },
      owner,
    );
    assert.equal((await view()).next.contractId, "contract-a");
    const second = await start();
    assert.notEqual(second.jobId, first.jobId);
    await db
      .doc(`trabalhos/${second.jobId}`)
      .update({ status: "awaiting_completion" });
    const awaitingRevision = (await settings()).revision;
    assert.equal((await view()).next, null);
    await denied(
      () =>
        start(driver, {
          queueId: "folder-a",
          contractId: "contract-a",
          configRevision: awaitingRevision,
          previewToken: "previous-preview",
        }),
      "failed-precondition",
    );
    await finish(second);
    assert.equal((await view()).next.contractId, "contract-b");
  });
  await test("a repeated manual execution retains prior completion and the queue counter", async () => {
    await queue();
    await vehicles();
    await finish(await start());
    const manual = await executeOperationalCommand(
      db,
      {
        action: "assign",
        companyId: "a",
        contractId: "contract-a",
        driverId: "driver-a",
        vehicleId: "vehicle-2",
        requestId: "manual-repeat",
      },
      owner,
    );
    await executeOperationalCommand(
      db,
      {
        action: "start",
        companyId: "a",
        jobId: manual.jobId,
        requestId: "start-repeat",
      },
      driver,
    );
    const v = await view();
    assert.equal(v.queues[0].done, 1);
    assert.equal(v.items[0].state, "current");
    assert.equal(v.items[0].completionSource, "canonical");
    await executeOperationalCommand(
      db,
      {
        action: "cancel",
        companyId: "a",
        jobId: manual.jobId,
        requestId: "cancel-repeat",
      },
      owner,
    );
    assert.equal((await view()).next.contractId, "contract-b");
  });
  await test("history review cannot invent completion of a new pending operation and rejects changed evidence", async () => {
    await queue();
    await vehicles();
    let v = await view();
    await denied(
      () =>
        configure({
          action: "reviewHistory",
          driverId: "driver-a",
          historyToken: v.historyToken,
          reviewedIds: ["contract-a"],
          doneIds: ["contract-a"],
          confirmed: true,
        }),
      "failed-precondition",
    );
    await db.doc("historico_viagens/ambiguous-a").set({
      companyId: "a",
      driverId: "driver-a",
      contractId: "contract-a",
      source: "gto_auto",
      recordStatus: "concluida",
      uploadedAt: new Date(),
    });
    v = await view();
    await db.doc("historico_viagens/ambiguous-b").set({
      companyId: "a",
      driverId: "driver-a",
      contractId: "contract-b",
      source: "gto_auto",
      recordStatus: "concluida",
      uploadedAt: new Date(),
    });
    await denied(
      () =>
        configure({
          action: "reviewHistory",
          driverId: "driver-a",
          historyToken: v.historyToken,
          reviewedIds: ["contract-a"],
          doneIds: [],
          confirmed: true,
        }),
      "aborted",
    );
  });
  await test("resume validates live source data and foreign-company proof does not complete this queue", async () => {
    await queue("folder-a", { state: "paused" });
    await vehicles();
    await db.doc("contratos/contract-a").update({ totalDeliveries: 0 });
    await denied(
      () =>
        configure({ action: "setState", queueId: "folder-a", state: "active" }),
      "failed-precondition",
    );
    assert.equal((await settings()).queues[0].state, "paused");
    await db.doc("contratos/contract-a").update({ totalDeliveries: 1 });
    await configure({
      action: "setState",
      queueId: "folder-a",
      state: "active",
    });
    await db.doc("driverOperationCompletions/foreign-proof").set({
      companyId: "b",
      driverId: "driver-a",
      contractId: "contract-a",
      completed: true,
      schemaVersion: 1,
      proofSource: "canonical-explicit-completion-v1",
      proofJobId: "foreign-job",
    });
    assert.equal((await view()).next.contractId, "contract-a");
  });
  await test("trailer maintenance refreshes availability without changing a started execution", async () => {
    const ref = db.doc("reboques/trailer-a");
    await ref.set({ companyId: "a", name: "Reboque A", status: "available" });
    await db.doc("contratos/contract-a").update({ trailerId: "trailer-a" });
    await queue();
    await vehicles();
    const ready = await view();
    assert.equal(ready.reason, "ready");
    const before = await ref.get();
    await ref.update({ status: "maintenance" });
    const after = await ref.get();
    const revision = (await db.doc("operationalQueueSignals/a").get()).get(
      "revision",
    );
    await refreshOperationalQueueTrailer.run(
      { before, after },
      { params: { id: "trailer-a" } },
    );
    assert.equal(
      (await db.doc("operationalQueueSignals/a").get()).get("revision"),
      revision + 1,
    );
    const held = await view();
    assert.equal(held.reason, "review");
    assert.match(held.items[0].issue, /manutenção/);
    await denied(
      () =>
        executeOperationalCommand(
          db,
          {
            action: "startAutomatic",
            companyId: "a",
            ...ready.next,
            vehicleId: "vehicle-a",
            requestId: "maintenance-trailer",
          },
          driver,
        ),
      "failed-precondition",
    );
    await ref.update({ status: "available" });
    const started = await start();
    await ref.update({ status: "maintenance" });
    assert.equal((await view()).reason, "running");
    assert.equal(
      (await db.doc(`trabalhos/${started.jobId}`).get()).get("trailerId"),
      "trailer-a",
    );
  });
  await test("authorization and direct-write rules protect settings, signals, reviews and cross-company scope", async () => {
    await queue();
    await vehicles();
    await denied(() => get("catalog", driver));
    await denied(() => get("driver", driver, { driverId: "driver-b" }));
    await denied(() => get("catalog", context("profile-admin")));
    await denied(() =>
      getOperationalQueues.run({ companyId: "b", kind: "catalog" }, owner),
    );
    for (const collection of [
      "operationalQueueSettings",
      "operationalQueueSignals",
      "operationalQueueMutations",
      "operationalQueueAudits",
      "automaticQueueHistoryReviews",
    ]) {
      await denied(() =>
        setDoc(
          doc(env.authenticatedContext("owner-a").firestore(), collection, "a"),
          { companyId: "a", actorId: "owner-a", driverId: "driver-a" },
        ),
      );
    }
    assert.equal(
      (
        await getDoc(
          doc(
            env.authenticatedContext("driver-a").firestore(),
            "operationalQueueSignals/a",
          ),
        )
      ).exists(),
      true,
    );
    await denied(() =>
      getDoc(
        doc(
          env.authenticatedContext("owner-b").firestore(),
          "operationalQueueSettings/a",
        ),
      ),
    );
    assert.equal(
      (await db.doc("frotas/a").get()).get("automaticQueuesConfigured"),
      true,
    );
    await denied(() =>
      updateDoc(
        doc(env.authenticatedContext("owner-a").firestore(), "frotas/a"),
        { automaticQueuesConfigured: false },
      ),
    );
  });
} finally {
  if (process.env.NVU_TEST_OUTPUT)
    fs.writeFileSync(
      process.env.NVU_TEST_OUTPUT,
      JSON.stringify({ projectId, results }, null, 2),
    );
  await env.cleanup();
  await admin.deleteApp(admin.app());
}
console.log(
  `OPERATIONAL_QUEUES_EMULATOR ${results.filter((x) => x.result === "PASS").length}/${results.length} PASS`,
);
if (results.some((x) => x.result !== "PASS")) process.exitCode = 1;
