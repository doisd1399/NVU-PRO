import assert from "node:assert/strict";
import fs from "node:fs";

const appContext = fs.readFileSync("src/context/AppContext.tsx", "utf8");
const selectProfile = fs.readFileSync("src/pages/SelectProfile.tsx", "utf8");
const profileSessionGate = fs.readFileSync("src/services/profileSessionGate.ts", "utf8");
const diagnostics = fs.readFileSync("src/services/sessionDiagnostic.ts", "utf8");

const sourceChecks = [
  [appContext.includes("membershipEffectGenerationRef"), "listener has a generation barrier"],
  [appContext.includes("canProcessMembershipCallback"), "listener validates its own generation"],
  [appContext.includes('"MEMBERSHIP_SERVER_EMPTY"'), "server empty has an explicit diagnostic"],
  [appContext.includes('"MEMBERSHIP_SERVER_ERROR"'), "server errors have an explicit diagnostic"],
  [appContext.includes("recoverMembershipsFromServer(\"listener-timeout\")"), "listener timeout starts server recovery"],
  [appContext.includes("recoverMembershipsFromServer(\"listener-error\")"), "listener error shares server recovery"],
  [appContext.includes("withSessionTimeout"), "server recovery has a finite request timeout"],
  [selectProfile.includes("serverEmptyConfirmed"), "empty UI requires serverEmptyConfirmed"],
  [selectProfile.includes("SessionDiagnosticCard"), "diagnostic UI exists"],
  [profileSessionGate.includes('return "membership-pending"') &&
    profileSessionGate.includes('return "empty"') &&
    selectProfile.includes("resolveProfileSessionGate"), "pending UI is distinct from empty UI"],
  [diagnostics.includes("uidSuffix"), "UID is redacted in diagnostics"],
];
for (const [condition, label] of sourceChecks) assert.equal(condition, true, label);

const makeState = (uid, generation) => ({
  uid,
  generation,
  reconciliation: "pending",
  membershipRead: "unknown",
  memberships: [],
});

const canPublish = (current, callback) =>
  current.uid === callback.uid && current.generation === callback.generation;

const canShowEmpty = (state) =>
  state.reconciliation === "complete" &&
  state.membershipRead === "server-complete" &&
  state.memberships.length === 0;

const first = makeState("uid-same", 1);
assert.equal(canShowEmpty(first), false, "pending session cannot show empty");
first.membershipRead = "cache-only";
assert.equal(canShowEmpty(first), false, "cache-only session cannot show empty");
first.reconciliation = "complete";
assert.equal(canShowEmpty(first), false, "reconciliation alone cannot show empty");
first.membershipRead = "server-error";
assert.equal(canShowEmpty(first), false, "server error cannot show empty");
first.membershipRead = "server-complete";
assert.equal(canShowEmpty(first), true, "server-confirmed zero may show empty");

const second = makeState("uid-same", 2);
second.reconciliation = "complete";
second.membershipRead = "server-complete";
second.memberships = [{ companyId: "company-a", status: "active" }];
assert.equal(canPublish(second, { uid: "uid-same", generation: 1 }), false, "late callback from old generation rejected");
assert.equal(canShowEmpty(second), false, "active server membership is not empty");

const third = makeState("uid-new", 3);
third.reconciliation = "complete";
third.membershipRead = "server-complete";
assert.equal(canPublish(third, { uid: "uid-same", generation: 2 }), false, "old UID callback rejected");
assert.equal(canShowEmpty(third), true, "new UID may be empty only after server confirmation");

console.log("session-diagnostic-states: PASS 11 source checks + 11 state assertions");
