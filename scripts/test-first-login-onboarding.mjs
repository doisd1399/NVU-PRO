import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relativePath) =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const appContext = read("src/context/AppContext.tsx");
const projection = read("src/services/authSessionProjection.ts");
const membershipRepository = read("src/services/membershipRepository.ts");
const selector = read("src/pages/SelectProfile.tsx");
const firebase = read("src/lib/firebase.ts");

const sourceOrder = (source, first, second) => source.indexOf(first) < source.indexOf(second);

// The first-login path may need identity provisioning, but it must publish the
// Firebase identity before that work completes so the selector can mount.
assert.ok(sourceOrder(appContext, "setAuthInitialized(true);\n        setSessionRecovering(true);", "void identityReconciliation"));
assert.match(appContext, /createFirebaseIdentityFallback\(firebaseUser\)/);
assert.match(appContext, /void unifyUserDocument\(firebaseUser\)\.then/);
assert.match(appContext, /identity-reconciliation-timeout/);

// A non-empty companyMembers snapshot is already server-confirmed and is enough
// for explicit profile selection even while onboarding continues in background.
assert.match(appContext, /identityPendingAtStart && fetchedMemberships\.length === 0/);
assert.match(appContext, /identityPendingAtStart && fetchedMemberships\.length > 0/);
assert.match(appContext, /identity-reconciliation-background/);
assert.match(appContext, /setMembershipsLoaded\(true\)/);

// An empty canonical result remains strict until first-login reconciliation
// settles, preventing a false "no profiles" result during legacy migration.
assert.match(appContext, /empty canonical query can be a transient first-login result/);
assert.match(appContext, /setMembershipsLoaded\(false\)/);
assert.match(appContext, /setSessionRecovering\(true\)/);

// Persisted sessions retain the UID-scoped warm snapshot while server
// confirmation remains independent from visual hydration.
assert.match(appContext, /readOfflineSessionSnapshot\(uid\)/);
assert.match(appContext, /bootSession\.membershipsServerConfirmed/);
assert.match(appContext, /confirmedMembershipsRef\.current/);
assert.match(projection, /sessionAuthorized:\n      hasCoherentIdentity && membershipsLoaded/);

// The selector keeps the canonical authorization boundary without starting
// recovery work on the first tap; only a resolved Profile Index is interactive.
assert.doesNotMatch(selector, /pendingProfileIntentRef/);
assert.doesNotMatch(selector, /profileRefreshInFlightRef/);
assert.match(selector, /profileIndex\.status !== "ready"/);
assert.match(selector, /void switchRole\(profile\.role, profile\.companyId\)/);
assert.match(selector, /navigate\(profile\.destination, \{ replace: true \}\)/);

// Membership subscription distinguishes Firestore cache from server data and
// has a UID-scoped server fallback with bounded retries.
assert.match(membershipRepository, /getDocsFromServer\(membershipQuery\)/);
assert.match(membershipRepository, /snapshot\.metadata\.fromCache/);
assert.match(membershipRepository, /attempts = 3/);
assert.match(firebase, /browserLocalPersistence/);

console.log("first-login-onboarding: PASS");
console.log("Provisionamento continua; Profile Index canônico não bloqueia seleção; sessão persistida preservada.");
