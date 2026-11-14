import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const appContext = read("src/context/AppContext.tsx");
const identity = read("src/services/userIdentityService.ts");
const compactEditor = read("src/components/CompactProfileEditorModal.tsx");
const driverProfile = read("src/pages/driver/Profile.tsx");
const adminOperations = read("functions/src/adminOperations.ts");
const functionsIndex = read("functions/src/index.ts");
const fleetMembership = read("functions/src/fleetMembership.ts");
const companyTab = read("src/pages/admin/fleet/CompanyTab.tsx");

// Company name must actually reach Firestore. Simulator identity remains protected.
assert.doesNotMatch(appContext, /delete editableUpdates\.companyName/);
assert.match(appContext, /editableUpdates\.companyName = normalizedCompanyName/);
assert.match(appContext, /delete editableUpdates\.simulatorId/);
assert.match(appContext, /delete editableUpdates\.simulatorName/);
assert.match(compactEditor, /companyName: trimmedName/);
// The company edit surface is the one shared form (the inline company form only creates companies).
assert.match(companyTab, /<CompactProfileEditorModal open=\{isEditing && !isAddingNew\} mode="company"/);
assert.doesNotMatch(companyTab, /updateCompany\(activeCompany\.id/);

// Both driver profile editors persist the canonical users/{uid}.name and mark user edits.
// The driver profile page uses the same form (the old ProfileModal is gone).
assert.match(driverProfile, /<CompactProfileEditorModal\s+open=\{isEditProfileOpen\}\s+mode="driver"/);
assert.ok(!fs.existsSync(path.join(root, "src/components/ProfileModal.tsx")), "the legacy profile editor was removed");
for (const source of [compactEditor]) {
  assert.match(source, /profileNameSource: "user_edit"/);
  assert.match(source, /profileNameUpdatedAt: profileUpdatedAt/);
  assert.match(source, /updatedAt: profileUpdatedAt/);
}
assert.match(compactEditor, /name: trimmedName/);
assert.match(compactEditor, /name: trimmedName/);

// Login/resume reconciliation must keep the canonical persisted name first.
assert.match(identity, /const persistedCanonicalName =/);
assert.match(identity, /name:\s*\n\s*persistedCanonicalName \|\|\s*\n\s*resolveCanonicalProfileName/);

// Both current and legacy approvals use the same server-side name policy.
assert.match(appContext, /manageFleetMembership\(\{ action: "approve-application", companyId, applicationId \}\)/);
assert.doesNotMatch(appContext, /\n\s*name: app\.fullName,\n/);
assert.match(adminOperations, /approveFleetMemberCore\(db, context/);
assert.match(functionsIndex, /approveFleetMemberCore\(db, context/);
assert.match(fleetMembership, /name: text\(target\.user\.name\) \|\| text\(application\.fullName\) \|\| "Motorista"/);

// approvedIdentityName may remain as immutable/historical onboarding evidence,
// but it can no longer be ahead of users/{uid}.name in live profile resolution.
assert.match(fleetMembership, /recruitmentIdentityPatch\(target.user, application, documentId, now\)/);
assert.match(identity, /await runTransaction\(db, async tx =>/);

console.log("profile-identity-single-source: PASS companyName and driver users.name remain canonical after edits");
