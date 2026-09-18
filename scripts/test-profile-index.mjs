import assert from "node:assert/strict";
import { buildProfileIndex } from "../src/services/profileIndex.ts";

const user = {
  id: "uid-1",
  name: "Motorista",
  email: "motorista@example.com",
  status: "active",
};

const baseMembership = {
  id: "membership-1",
  companyId: "company-1",
  userId: "uid-1",
  roles: ["driver"],
  status: "active",
  permissions: [],
};

const company = {
  id: "company-1",
  companyName: "Empresa A",
  simulatorId: "gto",
  simulatorName: "GTO",
  ownerName: "Dono",
  cnpj: "00",
};

const simulators = [{ id: "gto", name: "GTO", active: true }];

const resolving = buildProfileIndex({
  uid: "uid-1",
  memberships: [baseMembership],
  membershipsLoaded: false,
  companies: [company],
  simulators,
  currentUser: user,
});
assert.equal(resolving.status, "resolving");
assert.equal(resolving.profiles.length, 0);

const staleHydrated = buildProfileIndex({
  uid: "uid-1",
  memberships: [
    {
      ...baseMembership,
      id: "membership-admin-driver-1",
      roles: ["admin", "driver"],
    },
  ],
  membershipsLoaded: false,
  membershipsHydrated: true,
  companies: [company],
  simulators: [],
  currentUser: user,
});
assert.equal(staleHydrated.status, "ready");
assert.equal(staleHydrated.profiles.length, 2);
assert.deepEqual(
  staleHydrated.profiles.map((profile) => profile.role).sort(),
  ["admin", "driver"],
);
assert.equal(staleHydrated.profiles[0].simulatorId, "gto");

const ready = buildProfileIndex({
  uid: "uid-1",
  memberships: [baseMembership],
  membershipsLoaded: true,
  companies: [company],
  simulators,
  currentUser: user,
});
assert.equal(ready.status, "ready");
assert.equal(ready.profiles.length, 1);
assert.equal(ready.profiles[0].destination, "/driver/profile");
assert.equal(ready.profiles[0].simulatorId, "gto");

const inactive = buildProfileIndex({
  uid: "uid-1",
  memberships: [{ ...baseMembership, status: "rejected" }],
  membershipsLoaded: true,
  companies: [company],
  simulators,
  currentUser: user,
});
assert.equal(inactive.status, "empty");

const unknownSimulator = buildProfileIndex({
  uid: "uid-1",
  memberships: [baseMembership],
  membershipsLoaded: true,
  companies: [{ ...company, simulatorId: "unknown", simulatorName: "Unknown" }],
  simulators,
  currentUser: user,
});
assert.equal(unknownSimulator.status, "error");
assert.equal(unknownSimulator.profiles.length, 0);
assert.equal(unknownSimulator.invalidProfiles.length, 1);

const missingCompany = buildProfileIndex({
  uid: "uid-1",
  memberships: [baseMembership],
  membershipsLoaded: true,
  companies: [],
  simulators: [],
  currentUser: user,
});
assert.equal(missingCompany.status, "error");
assert.equal(missingCompany.profiles.length, 0);
assert.equal(missingCompany.invalidProfiles.length, 1);
assert.equal(missingCompany.invalidProfiles[0].companyName, "Empresa vinculada");

const missingCompanyStale = buildProfileIndex({
  uid: "uid-1",
  memberships: [baseMembership],
  membershipsLoaded: false,
  membershipsHydrated: true,
  companies: [],
  simulators: [],
  currentUser: user,
});
assert.equal(missingCompanyStale.profiles.length, 0);

const multiple = buildProfileIndex({
  uid: "uid-1",
  memberships: [
    baseMembership,
    {
      ...baseMembership,
      id: "membership-2",
      companyId: "company-2",
      roles: ["admin"],
    },
  ],
  membershipsLoaded: true,
  companies: [
    company,
    {
      ...company,
      id: "company-2",
      companyName: "Empresa B",
      simulatorId: "gto",
    },
  ],
  simulators,
  currentUser: user,
});
assert.equal(multiple.status, "ready");
assert.equal(multiple.profiles.length, 3);
assert.deepEqual(
  multiple.profiles.map((profile) => profile.role),
  ["driver", "admin", "driver"],
);

console.log("profile-index: PASS 8 cenários");
