import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relativePath) =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const selectProfile = read("src/pages/SelectProfile.tsx");
const profile = read("src/pages/driver/Profile.tsx");
const dashboard = read("src/pages/driver/Dashboard.tsx");
const performance = read("src/components/DriverPerformanceCard.tsx");
const rangeHook = read("src/hooks/useTripsRealtime.ts");
const snapshot = read("src/lib/activeOperationSnapshot.ts");

assert.doesNotMatch(selectProfile, /pendingProfileIntentRef/);
assert.doesNotMatch(selectProfile, /profileRefreshInFlightRef/);
assert.match(selectProfile, /commitProfileNavigation/);
assert.match(selectProfile, /profileIndex\.status !== "ready"/);
assert.doesNotMatch(selectProfile, /Estamos confirmando sua sessão/);
assert.doesNotMatch(selectProfile, /if \(!sessionReady\) \{/);

assert.match(profile, /readActiveOperationSnapshot/);
assert.match(profile, /writeActiveOperationSnapshot/);
assert.match(profile, /displayActiveJob/);
assert.match(profile, /const activeOperationCardJob =/);
assert.match(profile, /\{activeOperationCardJob \? \(/);
assert.doesNotMatch(profile, /\{displayActiveJob \? \(/);
assert.doesNotMatch(profile, /\{activeJob && activeContract \? \(/);
assert.match(profile, /activeOperationTotalDeliveries/);
assert.match(dashboard, /activeOperationResolved/);
assert.match(dashboard, /selectCurrentOperationJob\(jobs, currentUser\?\.id, activeCompanyId\)/);
assert.match(dashboard, /deriveCurrentOperationProgress\(/);
assert.match(dashboard, /jobProgress: currentOperationProgress/);

assert.match(performance, /hasVisibleDriverHistory/);
assert.match(performance, /rawGlobalTripsLoading/);
assert.match(performance, /cacheScope: tripsCacheScope/);
assert.doesNotMatch(profile, /globalTripsLoading=\{\s*!companyCatalogLoaded \|\| companiesLoading \? true : undefined\s*\}/);

assert.match(rangeHook, /PERSISTED_RANGE_CACHE_PREFIX/);
assert.match(rangeHook, /RANGE_CACHE_SCHEMA_VERSION/);
assert.match(rangeHook, /writePersistedRangeTrips/);
assert.match(rangeHook, /clearPersistedRangeTrips/);
assert.match(rangeHook, /cacheScope/);
assert.match(snapshot, /userId/);
assert.match(snapshot, /companyId/);
assert.match(snapshot, /onAuthTeardown/);
assert.doesNotMatch(snapshot, /SNAPSHOT_TTL_MS/);
assert.match(snapshot, /Number\.isFinite\(parsed\.cachedAt\)/);
assert.match(snapshot, /parsed\.cachedAt <= 0/);

console.log("profile-operation-instant-surface: PASS shared Profile/Dashboard operation source and live progress checks");
