import assert from "node:assert/strict";
import fs from "node:fs";
import { resolveReauthMemberships } from "../src/services/reauthMembershipPolicy.ts";

const appContext = fs.readFileSync(
  new URL("../src/context/AppContext.tsx", import.meta.url),
  "utf8",
);

const memberships = [{ userId: "uid-1", companyId: "company-a", status: "active" }];

assert.deepEqual(
  resolveReauthMemberships({ uid: "uid-1", memberships }, "uid-1"),
  { memberships, sameUid: true, shouldClearPrevious: false },
  "same UID should restore only presentation memberships",
);
assert.deepEqual(
  resolveReauthMemberships({ uid: "uid-1", memberships }, "uid-2"),
  { memberships: [], sameUid: false, shouldClearPrevious: true },
  "different UID must clear previous presentation memberships",
);
assert.deepEqual(
  resolveReauthMemberships(null, "uid-1"),
  { memberships: [], sameUid: false, shouldClearPrevious: false },
  "missing snapshot must not create memberships",
);

assert.match(appContext, /reauthMembershipsRef/);
assert.match(appContext, /resolveReauthMemberships\(/);
assert.match(appContext, /counts as server authorization/);
assert.match(appContext, /setMembershipsLoaded\(false\)/);

console.log("reauth-membership-policy: PASS 3 scenarios + 4 source checks");
