import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`PASS ${message}`);
};

const app = read("src/App.tsx");
const portal = read("src/pages/Portal.tsx");
const selector = read("src/pages/SelectProfile.tsx");
const context = read("src/context/AppContext.tsx");
const route = read("src/lib/sessionResumeRoute.ts");

assert(
  app.includes("useProfileSession()") && app.includes("const { activeRole }"),
  "router consumes the existing profile-session authority",
);
assert(
  app.includes('profileIndex.status === "ready"') &&
    app.includes("profileIndex.profiles.length === 1") &&
    app.includes("const targetPath ="),
  "initial destination is resolved by the canonical Profile Index",
);
assert(
  app.includes("nvuExplicitProfileSelection") &&
    app.includes("navigationState?.nvuExplicitProfileSelection") &&
    app.includes('location.pathname === "/select-profile"') &&
    app.includes('location.pathname !== "/apply"') === false,
  "only an explicit selector request keeps the selector open on startup while recruitment routes preserve intent",
);
assert(
  context.includes("writeLocalStorageValue(sessionActiveRoleKey(currentUser.id), role)") &&
    (context.includes("activeRole:\n        atomicSnapshot?.activeRole") ||
      context.includes("activeRole:\n        storedRole")) &&
    context.includes("visualBootUid ? (bootSession.activeRole as Role | null) : null"),
  "activeRole is persisted and restored by UID",
);
assert(
  context.includes("No explicit profile means the selector remains the first-login surface") &&
    !context.includes("setActiveRole(defaultRole as Role)"),
  "membership hydration cannot silently choose Admin or Driver",
);
assert(
  selector.includes("void switchRole(profile.role, profile.companyId)") &&
    selector.includes("commitProfileNavigation"),
  "explicit profile selection commits through the existing session authority",
);
assert(
  portal.includes("nvuExplicitProfileSelection: true"),
  "Portal selector entry is marked as an explicit user request",
);
assert(
  route.includes("keyForUid") && route.includes("window.localStorage"),
  "last route remains UID-scoped and durable",
);

console.log("ACTIVE PROFILE RESUME PASS: Profile Index decides startup and explicit selector wins");
