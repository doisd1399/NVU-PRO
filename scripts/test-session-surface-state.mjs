import assert from "node:assert/strict";
import { resolveSessionSurfaceState } from "../src/services/sessionSurfaceState.ts";

const base = {
  authReady: true,
  identityReconciliationStatus: "complete",
  membershipsLoaded: true,
  membershipsCount: 1,
  sessionRecovering: false,
  diagnosticCode: "MEMBERSHIP_SERVER_FOUND",
};

assert.equal(
  resolveSessionSurfaceState({ ...base, authReady: false }),
  "auth-pending",
);
assert.equal(
  resolveSessionSurfaceState({ ...base, identityReconciliationStatus: "pending", membershipsCount: 0 }),
  "identity-pending",
);
assert.equal(
  resolveSessionSurfaceState({ ...base, identityReconciliationStatus: "failed", membershipsCount: 0, diagnosticCode: "IDENTITY_RECONCILIATION_FAILED" }),
  "diagnostic",
);
assert.equal(
  resolveSessionSurfaceState({ ...base, membershipsLoaded: false, membershipsCount: 0, sessionRecovering: true, diagnosticCode: "MEMBERSHIP_SERVER_PENDING" }),
  "membership-pending",
);
assert.equal(
  resolveSessionSurfaceState({ ...base, membershipsLoaded: false, membershipsCount: 0, sessionRecovering: true, diagnosticCode: "MEMBERSHIP_SERVER_ERROR" }),
  "diagnostic",
  "erro server-side não pode ficar escondido pelo spinner",
);
assert.equal(
  resolveSessionSurfaceState({ ...base, membershipsCount: 0, diagnosticCode: "MEMBERSHIP_SERVER_EMPTY" }),
  "empty",
);
assert.equal(
  resolveSessionSurfaceState({ ...base, membershipsCount: 0, diagnosticCode: "MEMBERSHIP_CACHE_ONLY" }),
  "membership-pending",
);
assert.equal(resolveSessionSurfaceState(base), "ready");

console.log("session-surface-state: PASS 8 assertions");
