import assert from "node:assert/strict";
import { managementCacheKey, pendingManagementGoalScopes, readManagementCache, writeManagementCache, type ManagementCacheScope } from "../src/lib/managementOfflineCache.ts";
import { workspacePageIdentity } from "../src/lib/workspacePageIdentity.ts";
class MemoryStorage {
  getItem(key: string) { return Object.hasOwn(this, key) ? this[key] : null; }
  setItem(key: string, value: string) { Object.defineProperty(this, key, { value, configurable: true, enumerable: true, writable: true }); }
  removeItem(key: string) { delete this[key]; }
}
const storage = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
const scope: ManagementCacheScope = { viewerId: "owner", companyId: "dc", simulatorId: "gto", periodId: "2026-10" };
assert.equal(writeManagementCache("summary", scope, { earnings: ["R$ 141.682,00"], tripCount: 5 }), true);
assert.equal(readManagementCache<any>("summary", scope)?.value.tripCount, 5);
for (const other of [{ viewerId: "other" }, { companyId: "other" }, { simulatorId: "other" }, { periodId: "other" }]) {
  assert.equal(readManagementCache("summary", { ...scope, ...other }), null);
}
assert.equal(readManagementCache("goal", scope), null);
assert.equal(writeManagementCache("goal", { ...scope, viewerId: "" }, { amount: 1 }), false);
const pending = { ...scope, periodId: "pending" };
writeManagementCache("goal", pending, { targetAmount: 200000, pending: true });
for (let index = 0; index < 70; index++) writeManagementCache("goal", { ...scope, periodId: String(index) }, { targetAmount: index, pending: false });
assert.equal(readManagementCache<any>("goal", pending)?.value.targetAmount, 200000);
assert.deepEqual(pendingManagementGoalScopes("owner", "dc"), [pending]);
assert.deepEqual(pendingManagementGoalScopes("another-user", "dc"), []);
assert.deepEqual(pendingManagementGoalScopes("owner", "another-company"), []);
assert.ok(Object.keys(storage).filter(key => key.includes(":goal:")).length <= 32);
const key = managementCacheKey("summary", scope);
storage.setItem(key, "not-json"); assert.equal(readManagementCache("summary", scope), null);
storage.setItem(key, JSON.stringify({ version: 7, value: { tripCount: 5 }, savedAt: Date.now() }));assert.equal(readManagementCache("summary", scope), null);
Object.defineProperty(globalThis, "localStorage", { get() { throw new Error("Quota/security error"); }, configurable: true });
assert.equal(readManagementCache("goal", scope), null);assert.equal(writeManagementCache("goal", scope, { targetAmount: 1 }), false);
const central = workspacePageIdentity("/admin/fleet", "", { activeTab: "operations" });
const assets = workspacePageIdentity("/admin/fleet", "", { activeTab: "fleet" });
const trailers = workspacePageIdentity("/admin/fleet", "", { activeTab: "fleet", activeFleetTab: "trailers" });
assert.notEqual(central, assets);assert.notEqual(assets, trailers);
assert.equal(assets, workspacePageIdentity("/admin/fleet", "", { activeTab: "fleet", activeFleetTab: "vehicles" }));
assert.notEqual(workspacePageIdentity("/driver/profile", "", { profileTab: "profile" }), workspacePageIdentity("/driver/profile", "", {}));
console.log("PASS management cache: restart persistence, viewer/company/simulator/period isolation, pending goal retention, bounded storage, corruption/quota recovery and logical navigation keys.");
