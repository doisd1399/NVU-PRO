const assert = require("node:assert/strict");
const Module = require("node:module");

class Timestamp {}
class HttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
let state = new Map();
let writes = 0;
const logs = [];
const uid = "synthetic-driver";
const jobId = "syntheticJob123";
const tripId = `print:${jobId}:synthetic`;
const tripPath = `historico_viagens/${tripId}`;
const jobPath = `trabalhos/${jobId}`;
const slotPath = `trip_operation_slots/${tripId}`;
const auditPath = `trip_deletion_audits/gto-low-ocr-${tripId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
const missing = Symbol("delete-field");
const firestore = () => ({
  collection(collection) {
    return {
      doc(id) { return { path: `${collection}/${id}` }; },
      where(key, _operator, value) {
        const filters = [[key, value]];
        const query = { collection, filters, where(k, _op, v) { filters.push([k, v]); return query; } };
        return query;
      },
    };
  },
  async runTransaction(callback) {
    const operations = [];
    const snapshot = (path, value) => ({
      id: path.split("/").slice(1).join("/"), exists: value !== undefined,
      data: () => value,
    });
    const tx = {
      async get(ref) {
        if (ref.collection) {
          return { docs: [...state.entries()]
            .filter(([path, data]) => path.startsWith(`${ref.collection}/`) &&
              ref.filters.every(([key, value]) => data[key] === value))
            .map(([path, data]) => snapshot(path, data)) };
        }
        return snapshot(ref.path, state.get(ref.path));
      },
      update(ref, patch) { operations.push(["update", ref.path, patch]); },
      delete(ref) { operations.push(["delete", ref.path]); },
      create(ref, data) { operations.push(["create", ref.path, data]); },
    };
    const result = await callback(tx);
    for (const [op, path, data] of operations) {
      writes += 1;
      if (op === "delete") state.delete(path);
      else if (op === "create") {
        assert.ok(!state.has(path), "audit must not be overwritten");
        state.set(path, data);
      } else {
        const next = { ...state.get(path), ...data };
        for (const [key, value] of Object.entries(next)) if (value === missing) delete next[key];
        state.set(path, next);
      }
    }
    return result;
  },
});
firestore.Timestamp = Timestamp;
firestore.FieldValue = { serverTimestamp: () => new Timestamp(), delete: () => missing };
const firebaseAdmin = { firestore };
const firebaseFunctions = {
  region: () => ({ https: { onCall: (handler) => handler } }),
  https: { HttpsError },
  logger: { info: (...items) => logs.push(items), warn: (...items) => logs.push(items) },
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "firebase-admin") return firebaseAdmin;
  if (request === "firebase-functions") return firebaseFunctions;
  return originalLoad.call(this, request, parent, isMain);
};
const { repairInvalidGtoPrintProgress: repair } = require("../lib/repairInvalidGtoPrintProgress.js");
Module._load = originalLoad;
const request = { jobId, expectedTripId: tripId, expectedProgress: 4 };
function seed(value = 10100) {
  state = new Map(); writes = 0; logs.length = 0;
  state.set(jobPath, { id: jobId, driverId: uid, companyId: "company", contractId: "contract",
    progress: 4, totalDeliveries: 12, lastValidatedTripId: tripId });
  for (let slot = 1; slot <= 3; slot += 1) {
    const id = `confirmed-${slot}`;
    state.set(`historico_viagens/${id}`, { id, jobId, driverId: uid, companyId: "company",
      contractId: "contract", operationSlot: slot, status: "concluida",
      recordStatus: "concluida", serverValidatedAt: new Timestamp() });
  }
  state.set(tripPath, { jobId, driverId: uid, companyId: "company", contractId: "contract",
    operationSlot: 4, gtoEntryMode: "print", status: "concluida", valorCents: value,
    serverValidatedAt: new Timestamp() });
  state.set(slotPath, { jobId, driverId: uid, tripId, operationSlot: 4 });
}
async function rejects(code, call = request, caller = uid) {
  const before = writes;
  await assert.rejects(repair(call, { auth: { uid: caller } }), (error) => error.code === code);
  assert.equal(writes, before, "rejected repair must not write");
}
(async () => {
  seed();
  await rejects("failed-precondition");
  assert.equal(state.get(jobPath).progress, 4);
  assert.notEqual(state.get(tripPath).deleted, true);
  assert.equal(state.has(slotPath), true, "price-only repair must preserve the trip and its slot");
  assert.equal(state.has(auditPath), false);

  // A tombstone created by an older backend can still replay its lost ACK.
  state.set(tripPath, { ...state.get(tripPath), deleted: true, status: "DELETED",
    invalidReason: "GTO_PRINT_OCR_BELOW_1000" });
  state.delete(slotPath);
  state.set(auditPath, { reason: "GTO_PRINT_OCR_BELOW_1000", tripId, jobId,
    actorUserId: uid, previousProgress: 4 });
  state.set(jobPath, { ...state.get(jobPath), progress: 3 });
  const beforeReplay = writes;
  assert.deepEqual(await repair(request, { auth: { uid } }), {
    repaired: true, alreadyRepaired: true, progress: 3, reason: "ALREADY_REPAIRED",
  });
  assert.equal(writes, beforeReplay, "historical lost ACK replay must have no additional writes");
  state.delete(auditPath);
  await rejects("failed-precondition");
  seed();
  await rejects("permission-denied", request, "other-driver");
  await rejects("failed-precondition", { ...request, expectedProgress: 5 });
  state.set(`historico_viagens/other-trip`, { jobId, operationSlot: 4, status: "concluida" });
  await rejects("failed-precondition");
  seed(256300);
  await rejects("failed-precondition");
  seed();
  state.set(slotPath, { jobId, driverId: uid, tripId: "other-trip", operationSlot: 4 });
  await rejects("failed-precondition");
  assert.ok(logs.every((args) => !JSON.stringify(args[1]).includes(jobId) &&
    !JSON.stringify(args[1]).includes(uid) && !JSON.stringify(args[1]).includes(tripId)));
  console.log("GTO_REPAIR_REPLAY_PASS 8/8 (no new price-only deletion; historical replay preserved)");
})().catch((error) => { console.error(error); process.exitCode = 1; });
