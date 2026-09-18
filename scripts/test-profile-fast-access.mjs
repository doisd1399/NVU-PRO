import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relativePath) =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const selectProfile = read("src/pages/SelectProfile.tsx");
const gate = read("src/services/profileSessionGate.ts");
const projection = read("src/services/authSessionProjection.ts");
const appContext = read("src/context/AppContext.tsx");
const adminLayout = read("src/layouts/AdminLayout.tsx");
const driverLayout = read("src/layouts/DriverLayout.tsx");

assert.doesNotMatch(selectProfile, /pendingProfileIntentRef/);
assert.doesNotMatch(selectProfile, /profileRefreshInFlightRef/);
assert.match(selectProfile, /profileIndex\.status !== "ready"/);
assert.doesNotMatch(selectProfile, /Estamos confirmando sua sessão/);
assert.match(selectProfile, /if \(profileIndex\.status === "ready"\) setProfileActionError\(""\)/);
assert.match(gate, /hasDiagnosticFailure/);
assert.match(gate, /!input\.membershipsLoaded/);
assert.match(projection, /hasCoherentIdentity && membershipsLoaded/);
assert.match(appContext, /confirmedMembershipsRef/);
assert.match(appContext, /const retainConfirmedSnapshot = hasCurrentConfirmedSnapshot\(\)/);
assert.match(appContext, /setMembershipsLoaded\(retainConfirmedSnapshot\)/);
assert.match(adminLayout, /return \(/);
assert.match(driverLayout, /return \(/);
assert.doesNotMatch(adminLayout, /operationalReadiness.*return null/);
assert.doesNotMatch(driverLayout, /operationalReadiness.*return null/);

console.log("profile-fast-access: PASS 12 structural checks");
