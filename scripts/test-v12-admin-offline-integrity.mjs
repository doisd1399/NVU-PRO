import fs from 'node:fs';
import assert from 'node:assert/strict';
const rules=fs.readFileSync('firestore.rules','utf8');
const app=fs.readFileSync('src/context/AppContext.tsx','utf8');
const sync=fs.readFileSync('src/lib/syncSimulatorMembers.ts','utf8');
const offline=fs.readFileSync('src/lib/offlineSessionSnapshot.ts','utf8');
const active=fs.readFileSync('src/lib/activeOperationSnapshot.ts','utf8');
const company=fs.readFileSync('src/context/CompanyContext.tsx','utf8');
const checks = [
  ['company manager recognizes deterministic admin membership', /function hasCompanyAdminMembership\(companyId\)/.test(rules) && /simulator_members/.test(rules)],
  ['owner alias ownerId accepted', /ownerId == request\.auth\.uid/.test(rules)],
  ['recruitment scoped to company manager', /isCompanyManager\(resource\.data\.companyId\)/.test(rules)],
  ['manager can update company user', /!isOwner\(userId\)[\s\S]*isCompanyManager\(request\.resource\.data\.companyId\)/.test(rules)],
  ['simulator membership keeps admin role', /roles\.includes\("admin"\) \? "admin"/.test(sync)],
  ['simulator membership persists roles', /roles: Array\.from\(new Set\(roles\)\)/.test(sync)],
  ['offline simulator cache cannot be erased by empty cache snapshot', /snap\.metadata\.fromCache && simulatorsData\.length === 0/.test(app)],
  ['offline jobs preserve last nonempty scope', /preserveCachedJobs/.test(app)],
  ['offline contracts preserve last nonempty scope', /preserveCachedContracts/.test(app)],
  ['atomic offline session includes simulators', /simulators: Record<string, unknown>\[\]/.test(offline)],
  ['active operation snapshot persists job', /job: Record<string, unknown>/.test(active)],
  ['offline company cache miss cannot erase active company', /companySnapshot\.metadata\.fromCache && !companySnapshot\.exists\(\)/.test(company)],
];
for (const [name, ok] of checks) { assert.ok(ok, name); console.log('PASS', name); }
console.log(`PASS ${checks.length}/${checks.length} V12 invariants`);
