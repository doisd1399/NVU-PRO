import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`PASS ${message}`);
};

const appContext = read("src/context/AppContext.tsx");
const companyContext = read("src/context/CompanyContext.tsx");
const operation = read("src/lib/activeOperationSnapshot.ts");
const trips = read("src/hooks/useTripsRealtime.ts");
const projection = read("src/services/authSessionProjection.ts");

assert(
  appContext.includes("const isValidCacheTimestamp") &&
    appContext.includes("!isValidCacheTimestamp(parsed.cachedAt)"),
  "session snapshots reject malformed timestamps without treating age as corruption",
);
assert(
  !appContext.includes("SESSION_USER_CACHE_MAX_AGE_MS") &&
    !appContext.includes("!isFreshCache(parsed.cachedAt, SESSION_USER_CACHE_MAX_AGE_MS)"),
  "expired user snapshots remain available for visual hydration",
);
assert(
  appContext.includes("parsed.uid !== uid") &&
    appContext.includes("Array.isArray(parsed.memberships)") &&
    appContext.includes("isValidCacheTimestamp(parsed.cachedAt)"),
  "membership snapshots remain UID-scoped and structurally validated",
);
assert(
  appContext.includes("const hasFreshCachedMembershipSnapshot") &&
    appContext.includes("SESSION_MEMBERSHIP_CACHE_MAX_AGE_MS") &&
    appContext.includes("hasFreshServerConfirmedMemberships"),
  "membership freshness is retained only for recent server-confirmed warm authorization",
);
assert(
  !appContext.includes("OPERATIONAL_SCOPE_CACHE_TTL_MS") &&
    appContext.includes("readPersistedOperationalScopeSnapshot") &&
    appContext.includes("return snapshot;"),
  "stale operational snapshots remain available while Firestore refreshes them",
);
assert(
  !companyContext.includes("PUBLIC_COMPANIES_CACHE_MAX_AGE_MS") &&
    !companyContext.includes("SCOPED_COMPANIES_CACHE_MAX_AGE_MS") &&
    companyContext.includes("isValidCacheTimestamp(parsed.cachedAt)"),
  "public and UID-scoped company catalogs preserve structurally valid stale data",
);
assert(
  !operation.includes("SNAPSHOT_TTL_MS") &&
    operation.includes("Number.isFinite(parsed.cachedAt)") &&
    operation.includes("parsed.cachedAt <= 0"),
  "active operation snapshot rejects invalid timestamps but not old valid snapshots",
);
assert(
  !trips.includes("PERSISTED_RANGE_CACHE_TTL_MS") &&
    trips.includes("Number.isFinite(parsed.cachedAt)") &&
    trips.includes("parsed.cachedAt <= 0"),
  "persisted trip ranges remain available after long idle periods unless malformed",
);
assert(
  projection.includes("hasCoherentIdentity && membershipsLoaded") &&
    projection.includes("sessionUiReady: hasVisualIdentity || hasCoherentIdentity"),
  "visual hydration stays separate from server-authoritative protected authorization",
);
assert(
  appContext.includes("clearAllPrivateClientCaches") &&
    appContext.includes("clearSessionStorage()"),
  "explicit logout still clears private projections and session-only state",
);

console.log("LAST KNOWN GOOD STATE PASS: stale snapshots hydrate locally; server remains authoritative");
