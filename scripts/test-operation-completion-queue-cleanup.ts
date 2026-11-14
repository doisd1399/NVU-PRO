import assert from "node:assert/strict";
import { finalizeOperationWithServerConfirmation, type ConfirmedOperationCompletion } from "../src/application/operation/FinalizeOperation";
const jobId = "operation-twelve-verified";
const ack: ConfirmedOperationCompletion = { completed: true, jobId, status: "completed", progress: 12, total: 12 };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
let cases = 0;
for (const localState of ["WAITING", "SENDING", "FAILED", "AUTH_REQUIRED", "PERMISSION_PAUSED", "CONFLICT", "UNKNOWN"]) {
  const events: string[] = [];
  let releaseServer!: (value: ConfirmedOperationCompletion) => void;
  const server = new Promise<ConfirmedOperationCompletion>((resolve) => { releaseServer = resolve; });
  const completion = finalizeOperationWithServerConfirmation(jobId, {
    finalize: async () => { events.push("server-request"); return server; },
    onConfirmed: () => { events.push("completed-published"); },
    discardPending: async (id) => { assert.equal(id, jobId); events.push(`discard-${localState}`); },
  });
  await flush(); assert.deepEqual(events, ["server-request"]);
  releaseServer(ack); assert.equal(await completion, ack);
  await flush(); assert.deepEqual(events, ["server-request", "completed-published", `discard-${localState}`]); cases++;
}
for (const invalid of [{ ...ack, completed: false }, { ...ack, jobId: "other-operation" },
  { ...ack, status: "awaiting_completion" }, { ...ack, progress: 11 }, { ...ack, progress: 13 },
  { ...ack, progress: Number.NaN }, { ...ack, total: 0 }]) {
  let effects = 0;
  await assert.rejects(() => finalizeOperationWithServerConfirmation(jobId, {
    finalize: async () => invalid, onConfirmed: () => { effects++; }, discardPending: async () => { effects++; },
  }), /OPERATION_COMPLETION_NOT_SETTLED/);
  await flush(); assert.equal(effects, 0); cases++;
}
for (const message of ["OPERATION_TRIPS_NOT_VALIDATED", "unavailable", "permission-denied"]) {
  let effects = 0;
  await assert.rejects(() => finalizeOperationWithServerConfirmation(jobId, {
    finalize: async () => { throw new Error(message); },
    onConfirmed: () => { effects++; }, discardPending: async () => { effects++; },
  }), new RegExp(message));
  await flush(); assert.equal(effects, 0); cases++;
}
let cleanupErrors = 0;
assert.equal(await finalizeOperationWithServerConfirmation(jobId, {
  finalize: async () => ack, onConfirmed: () => {},
  discardPending: async () => { throw new Error("native-auth-offline-or-disk-failure"); },
  onCleanupError: () => { cleanupErrors++; },
}), ack);
await flush(); assert.equal(cleanupErrors, 1); cases++;
assert.equal(await finalizeOperationWithServerConfirmation(jobId, {
  finalize: async () => ack, onConfirmed: () => {}, discardPending: () => new Promise(() => {}),
}), ack); cases++;
let alreadyCleaned = 0;
await finalizeOperationWithServerConfirmation(jobId, {
  finalize: async () => ({ ...ack, alreadyCompleted: true }), onConfirmed: () => {},
  discardPending: async () => { alreadyCleaned++; },
});
await flush(); assert.equal(alreadyCleaned, 1); cases++;
console.log(`PASS ${cases} completion cases: server authority, post-ACK discard, invalid/offline ACK protection, non-blocking cleanup and idempotent recovery`);
