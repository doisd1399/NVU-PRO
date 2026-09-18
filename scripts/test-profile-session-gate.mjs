import assert from "node:assert/strict";
import { resolveProfileSessionGate } from "../src/services/profileSessionGate.ts";

const base = {
  authReady: true,
  identityReconciliationStatus: "complete",
  membershipsLoaded: true,
  membershipsCount: 1,
  availableCompaniesCount: 1,
  sessionRecovering: false,
  diagnosticCode: null,
  hasSessionDiagnostic: false,
};

const scenarios = [
  [
    "auth pending",
    { ...base, authReady: false },
    "auth-pending",
  ],
  [
    "identity pending without visible membership",
    {
      ...base,
      identityReconciliationStatus: "pending",
      membershipsLoaded: false,
      membershipsCount: 0,
      availableCompaniesCount: 0,
      sessionRecovering: true,
    },
    "identity-pending",
  ],
  [
    "membership pending without visible membership",
    {
      ...base,
      membershipsLoaded: false,
      membershipsCount: 0,
      availableCompaniesCount: 0,
      sessionRecovering: true,
      diagnosticCode: "MEMBERSHIP_SERVER_PENDING",
    },
    "membership-pending",
  ],
  [
    "server error has diagnostic priority",
    {
      ...base,
      membershipsLoaded: false,
      membershipsCount: 0,
      availableCompaniesCount: 0,
      sessionRecovering: false,
      diagnosticCode: "MEMBERSHIP_SERVER_ERROR",
      hasSessionDiagnostic: true,
    },
    "diagnostic",
  ],
  [
    "identity failure without diagnostic card",
    {
      ...base,
      identityReconciliationStatus: "failed",
      membershipsCount: 0,
      availableCompaniesCount: 0,
    },
    "identity-failed",
  ],
  [
    "server-confirmed empty",
    {
      ...base,
      membershipsCount: 0,
      availableCompaniesCount: 0,
      diagnosticCode: "MEMBERSHIP_SERVER_EMPTY",
    },
    "empty",
  ],
  [
    "visible memberships remain usable during recovery",
    {
      ...base,
      membershipsLoaded: false,
      sessionRecovering: true,
      diagnosticCode: "MEMBERSHIP_CACHE_ONLY",
    },
    "ready",
  ],
  [
    "visible memberships remain usable after transient server error",
    {
      ...base,
      membershipsLoaded: false,
      sessionRecovering: true,
      diagnosticCode: "MEMBERSHIP_SERVER_ERROR",
      hasSessionDiagnostic: true,
    },
    "ready",
  ],
  ["ready", base, "ready"],
];

for (const [label, input, expected] of scenarios) {
  assert.equal(resolveProfileSessionGate(input), expected, label);
}

console.log(`profile-session-gate: PASS ${scenarios.length} scenarios`);
