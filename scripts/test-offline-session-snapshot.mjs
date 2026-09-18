import assert from "node:assert/strict";

const storage = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  },
};

const {
  readOfflineSessionSnapshot,
  writeOfflineSessionSnapshot,
  clearOfflineSessionSnapshot,
} = await import("../src/lib/offlineSessionSnapshot.ts");

const uid = "uid-offline-a";
const snapshot = {
  uid,
  user: { id: uid, name: "Motorista Offline", email: "offline@example.com" },
  memberships: [
    {
      id: "membership-a",
      uid,
      userId: uid,
      companyId: "company-a",
      status: "active",
      roles: ["driver"],
    },
  ],
  companies: [
    {
      id: "company-a",
      companyName: "Empresa Offline",
      simulatorId: "gto",
      simulatorName: "GTO",
    },
  ],
  simulators: [{ id: "gto", name: "GTO", active: true }],
  activeCompanyId: "company-a",
  activeRole: "driver",
  profileContext: {
    companyId: "company-a",
    role: "driver",
    simulatorId: "gto",
    destination: "/driver",
  },
};

assert.equal(writeOfflineSessionSnapshot(snapshot), true);
const restored = readOfflineSessionSnapshot(uid);
assert.ok(restored);
assert.equal(restored.uid, uid);
assert.equal(restored.user.name, "Motorista Offline");
assert.equal(restored.companies[0].id, "company-a");
assert.equal(restored.simulators[0].id, "gto");
assert.equal(restored.profileContext.destination, "/driver");

// STALE is still valid for visual hydration; age is not an invalidation rule.
const key = "nvu.session.v5.snapshot.uid-offline-a";
storage.set(
  key,
  JSON.stringify({
    ...restored,
    cachedAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
  }),
);
assert.equal(readOfflineSessionSnapshot(uid)?.user.id, uid);

// A different UID can never read the snapshot.
assert.equal(readOfflineSessionSnapshot("uid-offline-b"), null);
storage.set(
  key,
  JSON.stringify({ ...restored, uid: "uid-offline-b" }),
);
assert.equal(readOfflineSessionSnapshot(uid), null);

// Corrupt/partial data is rejected instead of producing a fake profile.
storage.set(
  key,
  JSON.stringify({
    version: 1,
    uid,
    cachedAt: Date.now(),
    user: { id: uid },
    memberships: [],
  }),
);
assert.equal(readOfflineSessionSnapshot(uid), null);

storage.set(
  key,
  JSON.stringify({ ...restored, version: 999 }),
);
assert.equal(readOfflineSessionSnapshot(uid), null);

// Explicit cleanup is scoped and deterministic.
assert.equal(writeOfflineSessionSnapshot(snapshot), true);
clearOfflineSessionSnapshot(uid);
assert.equal(readOfflineSessionSnapshot(uid), null);

console.log(
  "offline-session-snapshot: PASS complete/stale restore, UID isolation, corruption rejection and explicit cleanup",
);
