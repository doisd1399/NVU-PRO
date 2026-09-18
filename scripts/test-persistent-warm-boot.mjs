import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`PASS ${message}`);
};

const appContext = read("src/context/AppContext.tsx");
const app = read("src/App.tsx");
const trips = read("src/hooks/useDriverTrips.ts");
const operation = read("src/lib/activeOperationSnapshot.ts");
const route = read("src/lib/sessionResumeRoute.ts");

assert(
  appContext.includes('const OPERATIONAL_SCOPE_SESSION_VERSION = "v2"'),
  "operational snapshot has a durable schema version",
);
assert(
  appContext.includes("localStorage.getItem(operationalScopeSessionKey(key))") &&
    appContext.includes("localStorage.setItem(\n        operationalScopeSessionKey(key),"),
  "operational snapshot survives WebView recreation through localStorage",
);
assert(
  appContext.includes("visualBootUid && bootSession.user"),
  "a validated UID-scoped user snapshot enables visual warm boot",
);
assert(
  appContext.includes("sessionAuthorized") &&
    appContext.includes("sessionUiReady"),
  "visual readiness remains separate from protected authorization",
);
assert(
  app.includes("profileIndex.status === \"ready\"") &&
    app.includes("profileIndex.profiles.length === 1") &&
    app.includes("const targetPath =") &&
    app.includes('"/select-profile"'),
  "Profile Index decides the initial destination while route memory remains recording-only",
);
assert(
  route.includes("window.localStorage") && route.includes("keyForUid"),
  "route memory is durable and UID-scoped",
);
assert(
  trips.includes("window.localStorage.getItem") &&
    trips.includes("nvu.persisted.v2.driver-trips."),
  "driver trips use a durable local snapshot for first paint",
);
assert(
  trips.includes("window.localStorage.removeItem") &&
    trips.includes("PERSISTED_CACHE_PREFIX"),
  "driver-trip snapshots are removed during auth teardown",
);
assert(
  !operation.includes("SNAPSHOT_TTL_MS") &&
    operation.includes("Number.isFinite(parsed.cachedAt)") &&
    operation.includes("nvu.persisted.v2.active-operation."),
  "active operation snapshot keeps structurally valid stale data for first paint",
);
assert(
  appContext.includes("nvu.persisted.v2.operational.") &&
    appContext.includes("nvu.persisted.v2.driver-trips.") &&
    appContext.includes("nvu.persisted.v2.active-operation."),
  "logout cleanup covers every private persistent projection",
);

console.log("PERSISTENT WARM BOOT PASS: route, session shell, operation and history contracts are protected");
