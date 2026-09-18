import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relativePath) =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const app = read("src/App.tsx");
const auth = read("src/contexts/AuthSessionProvider.tsx");
const memberships = read("src/contexts/MembershipProvider.tsx");
const profile = read("src/contexts/ProfileSessionProvider.tsx");
const operational = read("src/contexts/OperationalDataProvider.tsx");
const appContext = read("src/context/AppContext.tsx");
const google = read("src/services/googleAuthService.ts");

for (const providerSource of [auth, memberships, profile, operational]) {
  assert.match(providerSource, /createContext/);
  assert.match(providerSource, /useMemo/);
  assert.doesNotMatch(providerSource, /onAuthStateChanged|onSnapshot|getDocs|signInWithCredential/);
}

assert.match(auth, /useSessionStore/);
assert.match(memberships, /useSessionStore/);
assert.match(memberships, /useCompanyStore/);
assert.match(profile, /useSessionStore/);
assert.match(operational, /useOperationalStore/);
assert.match(app, /<AppProvider>/);
assert.match(app, /<AuthSessionProvider>/);
assert.match(app, /<MembershipProvider>/);
assert.match(app, /<ProfileSessionProvider>/);
assert.match(app, /<OperationalDataProvider>/);
assert.match(app, /useAuthSession\(\)/);
assert.match(app, /useMembershipSession\(\)/);
assert.match(app, /useProfileSession\(\)/);
assert.match(appContext, /onAuthStateChanged/);
assert.equal((appContext.match(/onAuthStateChanged\(auth/g) || []).length, 1);
assert.match(google, /authPersistenceReady/);
assert.match(google, /auth\.authStateReady\(\)/);

console.log("modular-provider-boundaries: PASS 23 structural checks");
