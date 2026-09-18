import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relativePath) =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const appContext = read("src/context/AppContext.tsx");
const app = read("src/App.tsx");
const routePreload = read("src/lib/routePreload.ts");
const projection = read("src/services/authSessionProjection.ts");
const selectProfile = read("src/pages/SelectProfile.tsx");

assert.match(appContext, /SESSION_MEMBERSHIP_WARM_AUTH_MAX_AGE_MS = 15 \* 60 \* 1000/);
assert.match(appContext, /sessionMembershipConfirmationKey/);
assert.match(appContext, /membershipsServerConfirmed/);
assert.match(appContext, /markServerConfirmedMemberships/);
assert.match(appContext, /confirmedMembershipsRef/);
assert.match(appContext, /sessionGeneration/);
assert.match(appContext, /setMembershipsLoaded\(hasConfirmedSnapshot\)/);
assert.match(appContext, /setMembershipsLoaded\(retainConfirmedSnapshot\)/);
assert.match(projection, /hasCoherentIdentity && membershipsLoaded/);
assert.match(app, /profileIndex\.profiles\.length === 1/);
assert.match(app, /preloadRoute\(targetPath\)/);
assert.match(routePreload, /AdminLayout/);
assert.match(routePreload, /DriverLayout/);
assert.doesNotMatch(selectProfile, /pendingProfileIntentRef/);
assert.doesNotMatch(selectProfile, /profileRefreshInFlightRef/);
assert.match(selectProfile, /profileIndex\.status !== "ready"/);
assert.doesNotMatch(selectProfile, /Estamos confirmando sua sessão/);

console.log("auth-instant-path: PASS 16 structural checks");
