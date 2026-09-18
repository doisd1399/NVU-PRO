import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relativePath) =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const app = read("src/App.tsx");
const portal = read("src/pages/Portal.tsx");
const selectProfile = read("src/pages/SelectProfile.tsx");
const login = read("src/pages/Login.tsx");
const firebase = read("src/lib/firebase.ts");
const googleAuth = read("src/services/googleAuthService.ts");
const context = read("src/context/AppContext.tsx");

const startupDestination = (pathname) => pathname;

// 1. Logged-out startup: portal first.
assert.equal(startupDestination("/"), "/");
// 2. Persisted login URL reopening: keep the explicit public route.
assert.equal(startupDestination("/login"), "/login");
// 3. Authenticated driver refresh: keep the exact workspace route.
assert.equal(startupDestination("/driver/profile"), "/driver/profile");
// 4. Authenticated admin refresh: keep the exact workspace route.
assert.equal(startupDestination("/admin/fleet"), "/admin/fleet");
// 5. Existing authenticated session + explicit driver choice.
assert.match(selectProfile, /handleSelect/);
assert.match(selectProfile, /profile\.destination/);
assert.match(selectProfile, /navigate\(profile\.destination/);
// 6. Existing authenticated session + explicit admin choice.
assert.match(app, /profileIndex\.profiles\.length === 1/);
assert.match(app, /: "\/select-profile"/);
assert.match(portal, /const hasRestoredIdentity = Boolean\(currentUser\) \|\| Boolean\(sessionUiReady\)/);
assert.match(portal, /const hasApprovedProfile =/);
assert.match(portal, /navigate\(hasApprovedProfile \? "\/select-profile" : "\/pending-applications"/);
assert.match(portal, /disabled=\{false\}/);
assert.doesNotMatch(portal, /"Restaurando conta…"/);
assert.match(portal, /"Fazer Login"/);
// 7. Multiple profiles remain in the selector until a click.
assert.match(app, /profileIndex\.status === "ready"/);
assert.match(selectProfile, /profileIndex\.profiles\.length !== 1/);
// 8. Expired session: protected selection still requires strict sessionReady.
assert.doesNotMatch(selectProfile, /pendingProfileIntentRef/);
assert.match(selectProfile, /profileIndex\.status !== "ready"/);
assert.match(selectProfile, /profileIndex\.status === "ready" && profileIndex\.profiles\.length === 0/);
assert.match(selectProfile, /Navigate to="\/pending-applications"/);
assert.doesNotMatch(selectProfile, /Estamos confirmando sua sessão/);
assert.match(login, /auth\.authStateReady\(\)/);
// 9. Refresh/deep-link: the explicit route is preserved during Auth hydration.
assert.doesNotMatch(app, /isInitialWorkspaceRoute/);
assert.ok(!app.includes('navigate("/", {'));
assert.match(app, /direct refresh\/deep link keeps its explicit URL/);
// 10. The route memory records valid routes but never forces a startup redirect.
assert.match(app, /writeSessionResumeRoute\(/);
assert.doesNotMatch(app, /readSessionResumeRoute\(uid\)/);
// 11. Capacitor/Android and Web share the same route source and Auth persistence.
assert.match(app, /Capacitor\.isNativePlatform\(\)/);
assert.match(app, /CapacitorApp\.addListener\("appStateChange"/);
assert.match(firebase, /browserLocalPersistence/);
assert.match(firebase, /setPersistence\(/);
assert.match(googleAuth, /FirebaseAuthentication/);
assert.match(context, /onAuthStateChanged\(auth/);

console.log("startup-profile-selection: PASS route-preservation scenarios");
console.log("Um perfil autoabre; múltiplos perfis exigem escolha; autorização permanece no guard.");
