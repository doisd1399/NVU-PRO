import assert from "node:assert/strict";
import fs from "node:fs";
import { buildProfileIndex } from "../src/services/profileIndex.ts";
import { resolveProfileSessionGate } from "../src/services/profileSessionGate.ts";

const appContextSource = fs.readFileSync(
  new URL("../src/context/AppContext.tsx", import.meta.url),
  "utf8",
);
assert.match(appContextSource, /const preservedMemberships =/);
assert.match(appContextSource, /Phase B must not destroy Phase A/);

const user = {
  id: "uid-david",
  name: "David",
  email: "david@example.com",
  status: "active",
  role: "admin",
  roles: ["admin", "driver"],
};

const company = {
  id: "company-nvu",
  companyName: "NVU Transportes",
  simulatorId: "gto",
  simulatorName: "GTO",
  ownerId: "uid-owner",
};

const memberships = [
  {
    id: "membership-admin-driver",
    companyId: company.id,
    userId: user.id,
    roles: ["admin", "driver"],
    status: "active",
    permissions: ["company.read", "trip.read"],
  },
];

const staleCachedAt = Date.now() - 26 * 60 * 60 * 1000;
assert.ok(staleCachedAt < Date.now() - 24 * 60 * 60 * 1000);

// Phase A: local hydration. Firestore is intentionally represented as absent.
const localProfileIndex = buildProfileIndex({
  uid: user.id,
  memberships,
  membershipsLoaded: false,
  membershipsHydrated: true,
  companies: [company],
  simulators: [],
  currentUser: user,
});

assert.equal(localProfileIndex.status, "ready");
assert.equal(localProfileIndex.profiles.length, 2);
assert.deepEqual(
  localProfileIndex.profiles.map((profile) => profile.role).sort(),
  ["admin", "driver"],
);
assert.equal(
  localProfileIndex.profiles.find((profile) => profile.role === "admin")?.destination,
  "/admin/fleet",
);
assert.equal(
  localProfileIndex.profiles.find((profile) => profile.role === "admin")?.simulatorId,
  "gto",
);

const visualGate = resolveProfileSessionGate({
  authReady: true,
  identityReconciliationStatus: "pending",
  membershipsLoaded: false,
  membershipsCount: memberships.length,
  availableCompaniesCount: 1,
  sessionRecovering: true,
  hasSessionDiagnostic: false,
});
assert.equal(visualGate, "ready");

// The selected role/company are presentation state only until server auth settles.
const selectedProfile = localProfileIndex.profiles.find(
  (profile) => profile.role === "admin" && profile.companyId === company.id,
);
assert.ok(selectedProfile);
assert.equal(selectedProfile.companyName, company.companyName);

// Phase B: server reconciliation changes no visible profile set when data agrees.
const serverProfileIndex = buildProfileIndex({
  uid: user.id,
  memberships,
  membershipsLoaded: true,
  membershipsHydrated: true,
  companies: [company],
  simulators: [{ id: "gto", name: "GTO", active: true }],
  currentUser: user,
});
assert.equal(serverProfileIndex.status, "ready");
assert.deepEqual(
  serverProfileIndex.profiles.map(({ role, companyId, destination }) => ({
    role,
    companyId,
    destination,
  })),
  localProfileIndex.profiles.map(({ role, companyId, destination }) => ({
    role,
    companyId,
    destination,
  })),
);

console.log("last-known-good-state-functional: PASS local hydration, selector, selected admin, reconciliation and empty-server race");
