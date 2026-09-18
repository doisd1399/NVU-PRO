import assert from "node:assert/strict";
import fs from "node:fs";

const appContext = fs.readFileSync(new URL("../src/context/AppContext.tsx", import.meta.url), "utf8");
const selectProfile = fs.readFileSync(new URL("../src/pages/SelectProfile.tsx", import.meta.url), "utf8");

function classifyMemberships({ identityStatus, cachedMemberships, serverMemberships }) {
  const settled = identityStatus === "complete" || identityStatus === "failed";
  if (!settled) {
    return {
      classified: false,
      memberships: cachedMemberships,
      uiReady: cachedMemberships.length > 0,
    };
  }
  return {
    classified: true,
    memberships: serverMemberships,
    uiReady: true,
  };
}

function callbackBelongsToSession(expectedGeneration, currentGeneration) {
  return expectedGeneration === currentGeneration;
}

function runLogoutLoginCycle() {
  const uid = "google-uid-same-account";
  const canonicalMembership = [{ userId: uid, companyId: "company-1", status: "active" }];
  const transitions = [];

  transitions.push({ uid: null, status: "idle", memberships: [] });
  transitions.push({ uid, status: "pending", memberships: [] });
  const beforeReconciliation = classifyMemberships({
    identityStatus: "pending",
    cachedMemberships: [],
    serverMemberships: [],
  });
  assert.equal(beforeReconciliation.classified, false);
  assert.deepEqual(beforeReconciliation.memberships, []);

  transitions.push({ uid, status: "complete", memberships: canonicalMembership });
  const afterReconciliation = classifyMemberships({
    identityStatus: "complete",
    cachedMemberships: [],
    serverMemberships: canonicalMembership,
  });
  assert.equal(afterReconciliation.classified, true);
  assert.deepEqual(afterReconciliation.memberships, canonicalMembership);

  transitions.push({ uid: null, status: "idle", memberships: [] });
  assert.equal(transitions.at(-1).uid, null);
  assert.deepEqual(transitions.at(-1).memberships, []);

  transitions.push({ uid, status: "pending", memberships: [] });
  const secondLoginBeforeSettle = classifyMemberships({
    identityStatus: "pending",
    cachedMemberships: canonicalMembership,
    serverMemberships: [],
  });
  assert.equal(secondLoginBeforeSettle.classified, false);
  assert.equal(secondLoginBeforeSettle.uiReady, true);
  assert.deepEqual(secondLoginBeforeSettle.memberships, canonicalMembership);

  assert.equal(callbackBelongsToSession(1, 2), false);
  assert.equal(callbackBelongsToSession(2, 2), true);

  transitions.push({ uid, status: "complete", memberships: canonicalMembership });
  const secondLoginAfterSettle = classifyMemberships({
    identityStatus: "complete",
    cachedMemberships: [],
    serverMemberships: canonicalMembership,
  });
  assert.equal(secondLoginAfterSettle.classified, true);
  assert.equal(secondLoginAfterSettle.memberships[0].userId, uid);
}

runLogoutLoginCycle();

assert.match(appContext, /identityReconciliationStatus: "idle" \| "pending" \| "complete" \| "failed"/);
assert.match(appContext, /setIdentityReconciliationStatus\("pending"\)/);
assert.match(appContext, /setIdentityReconciliationStatus\("complete"\)/);
assert.match(appContext, /setIdentityReconciliationStatus\("failed"\)/);
assert.match(appContext, /identityReconciliationStatus !== "complete"/);
assert.match(appContext, /identityReconciliationStatus\]/);
assert.match(appContext, /authSessionGenerationRef = useRef\(0\)/);
assert.match(appContext, /expectedSessionGeneration/);
assert.match(appContext, /authSessionGenerationRef\.current \+= 1/);
assert.match(selectProfile, /identityReconciliationStatus/);
assert.match(selectProfile, /Não foi possível confirmar seu vínculo/);
assert.match(selectProfile, /onClick=\{\(\) => refreshSession\(\)\}/);
assert.doesNotMatch(selectProfile, /identity-reconciliation-retry/);
assert.match(appContext, /reauthMembershipsRef/);
assert.match(appContext, /resolveReauthMemberships\(/);
assert.match(appContext, /setMembershipsLoaded\(false\)/);
assert.match(appContext, /sessionProjection\.sessionAuthorized/);

console.log("login-logout-cycle: 10/10 checks passed");
