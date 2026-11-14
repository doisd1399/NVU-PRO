import assert from "node:assert/strict";
import { presentProPendingTrip, pendingRetryFeedback } from "../src/lib/proPendingPresentation";

const rejected = {
  queueStatus: "FAILED", retryAllowed: false,
  lastQueueError: "Registro rejeitado por uma condição permanente. A viagem foi preservada para revisão.",
  lastQueueErrorCode: "GTO_PRO_REGISTRATION_FAILED:INVALID_ARGUMENT:Recibo ou contexto GTO inválido.",
};
assert.equal(presentProPendingTrip(rejected).blocked, true);
assert.equal(presentProPendingTrip(rejected).failureMessage, "Recibo ou contexto GTO inválido.");
assert.equal(presentProPendingTrip({ ...rejected, queueStatus: "WAITING" }).blocked, true,
  "a stale visual status cannot override the native terminal verdict");
assert.equal(presentProPendingTrip({ queueStatus: "FAILED" }).blocked, true, "old native bridges fail closed");
assert.equal(presentProPendingTrip({ queueStatus: "FAILED", retryAllowed: true }).blocked, false,
  "an explicitly recoverable old transport rejection retains the retry action");
assert.match(presentProPendingTrip({ ...rejected, reasonCode: "GTO_SERVER_CONTRACT_MISMATCH" }).failureMessage, /compatibilidade/);
const safe = presentProPendingTrip({ ...rejected, serverReason: "Falha uid=Abc123456789123456789 token=secret https://example.com/proof" });
assert.ok(!safe.failureMessage.includes("Abc123456789123456789") && !safe.failureMessage.includes("secret") && !safe.failureMessage.includes("https://"));
assert.equal(pendingRetryFeedback("pending-retry-requested").kind, "info");
assert.equal(pendingRetryFeedback("retry-blocked").kind, "warning");
assert.equal(pendingRetryFeedback("pending-operation-completed").kind, "info");
assert.equal(pendingRetryFeedback("unknown-success").kind, "error");
assert.equal(pendingRetryFeedback(undefined).kind, "error");
assert.ok(!pendingRetryFeedback("retry-blocked").message.includes("solicitado"));
console.log("pro-pending-presentation: PASS rejected receipt, recoverable old state, safe cause, explicit retry outcomes");
