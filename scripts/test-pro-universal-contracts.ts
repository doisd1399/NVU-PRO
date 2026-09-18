import assert from "node:assert/strict";
import {
  PRO_SIMULATOR_REGISTRY,
  isAllowedProContext,
  resolveProSimulatorCode,
  type ProAllowedContext,
} from "../src/services/pro-universal/proUniversalContracts";
import { applyProSessionEvent } from "../src/services/pro-universal/proSessionMachine";

assert.equal(PRO_SIMULATOR_REGISTRY.length, 4);
assert.deepEqual(
  PRO_SIMULATOR_REGISTRY.map((item) => item.simulatorCode),
  ["WTDS", "WBDS", "TOE3", "GTO"],
);
assert.equal(PRO_SIMULATOR_REGISTRY.find((item) => item.key === "toe-3")?.packageId, "com.WandaSoftware.TruckersofEurope3");
assert.equal(resolveProSimulatorCode("Truckers of Europe 3"), "TOE3");
assert.equal(resolveProSimulatorCode("Global Truck Online"), "GTO");
assert.equal(resolveProSimulatorCode("com.stargamesapps.gto"), "GTO");
assert.equal(PRO_SIMULATOR_REGISTRY.find((item) => item.key === "wbds")?.capabilities.trailer, false);

const toeContext: ProAllowedContext = {
  contextEpoch: "epoch-1",
  simulatorKey: "toe-3",
  expectedPackage: "com.WandaSoftware.TruckersofEurope3",
  companyId: "company-test",
  jobId: "job-test",
  contractId: "contract-test",
  operationName: "Operação TOE 3",
  createdAt: 1,
};
assert.equal(isAllowedProContext(toeContext), true);
assert.equal(isAllowedProContext({ ...toeContext, expectedPackage: "com.stargamesapps.gto" }), false);
assert.equal(isAllowedProContext({ ...toeContext, jobId: "" }), false);

let session = applyProSessionEvent(null, { type: "context_ready", context: toeContext, sessionId: "session-1", now: 1 });
assert.equal(session?.state, "CONTEXT_READY");
session = applyProSessionEvent(session, { type: "simulator_visibility", visibility: "VISIBLE" });
assert.equal(session?.state, "SIMULATOR_VISIBLE");
session = applyProSessionEvent(session, { type: "route_selected", origin: "Lisboa", destination: "Porto", now: 2 });
assert.equal(session?.state, "TRIP_ACTIVE");
session = applyProSessionEvent(session, { type: "capture_requested", attemptId: "attempt-1" });
assert.equal(session?.state, "CAPTURE_AUTH_PENDING");
session = applyProSessionEvent(session, { type: "projection_granted" });
assert.equal(session?.state, "CAPTURING");
session = applyProSessionEvent(session, { type: "capture_started" });
assert.equal(session?.state, "OCR_VALIDATING");
session = applyProSessionEvent(session, { type: "submission_started" });
assert.equal(session?.state, "SUBMITTING");
session = applyProSessionEvent(session, { type: "completed" });
assert.equal(session?.state, "COMPLETED");

let outside = applyProSessionEvent(null, { type: "context_ready", context: toeContext, sessionId: "session-2", now: 1 });
outside = applyProSessionEvent(outside, { type: "simulator_visibility", visibility: "OUTSIDE" });
outside = applyProSessionEvent(outside, { type: "route_selected", origin: "Lisboa", destination: "Porto", now: 2 });
outside = applyProSessionEvent(outside, { type: "capture_requested", attemptId: "attempt-2" });
assert.equal(outside?.state, "TRIP_ACTIVE");
assert.equal(outside?.lastFailureCode, "FOREGROUND_MISMATCH");

assert.throws(
  () => applyProSessionEvent(null, { type: "context_ready", context: { ...toeContext, expectedPackage: "com.stargamesapps.gto" }, sessionId: "bad", now: 1 }),
  /PRO_CONTEXT_NOT_ALLOWED/,
);
assert.equal(applyProSessionEvent(outside, { type: "reset" }), null);

console.log("pro-universal-contracts: PASS registry, allowed context, session transitions and fail-closed capture gate");
