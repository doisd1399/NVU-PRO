import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relativePath) =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const selectProfile = read("src/pages/SelectProfile.tsx");
const pendingHook = read("src/hooks/useCurrentUserPendingApplications.ts");
const app = read("src/App.tsx");
const recruitmentApply = read("src/pages/RecruitmentApply.tsx");
const registerCompany = read("src/pages/RegisterCompany.tsx");
const driverLayout = read("src/layouts/DriverLayout.tsx");
const gtoLauncher = read("src/services/gtoWorkLauncher.ts");
const pendingPage = read("src/pages/PendingApplications.tsx");

// The pending hook must expose an explicit loading/error contract instead of
// making an empty result indistinguishable from a query that has not settled.
assert.match(pendingHook, /const \[queryError, setQueryError\]/);
assert.match(pendingHook, /setQueryError\(anyQueryFailed\)/);
assert.match(pendingHook, /return \{ applications, loading, queryError \}/);

// SelectProfile may render the generic empty state only after the pending
// identity queries have settled successfully.
assert.match(selectProfile, /!pendingApplicationsLoading/);
assert.match(selectProfile, /!pendingApplicationsQueryError/);
assert.match(selectProfile, /Consultando inscrições e cadastros/);
assert.match(selectProfile, /Não foi possível consultar suas pendências/);
assert.match(selectProfile, /pending-applications-retry/);
assert.match(selectProfile, /Pendências/);
assert.doesNotMatch(selectProfile, /Aguardando aprovação!/);
assert.match(recruitmentApply, /paddingTop: "env\(safe-area-inset-top, 0px\)"/);
assert.match(recruitmentApply, /min-h-16 flex items-center justify-between/);

// Both public submission flows keep the authenticated Google identity and route
// to the central status surface after the Firestore write.
assert.match(recruitmentApply, /signInWithGoogleAccount\(\)/);
assert.match(recruitmentApply, /navigate\("\/pending-applications", \{ replace: true \}\)/);
assert.match(registerCompany, /signInWithGoogleAccount\(\)/);
assert.match(registerCompany, /type: "company_registration"/);
assert.match(registerCompany, /navigate\("\/pending-applications", \{ replace: true \}\)/);

// The onboarding shell may stop residual native projection but must not launch
// GTO or screen capture. This is route-scoped and does not touch DriverLayout.
assert.match(app, /isOnboardingSurface/);
assert.match(app, /GtoObserver\.logoutCleanup\(\)/);
assert.match(app, /GtoObserver\.stopObserver\(\)/);
assert.match(app, /location\.pathname\.startsWith\("\/apply\/"\)/);
assert.match(app, /location\.pathname !== "\/"/);
assert.match(app, /location\.pathname !== "\/login"/);
assert.match(app, /Public recruitment\/cadastro routes must remain the[\s\S]{0,80}current intent/);
assert.doesNotMatch(app, /initialPathnameRef/);
assert.doesNotMatch(app, /isOnboardingSurface[\s\S]{0,1200}requestScreenCapture/);
assert.match(driverLayout, /SimpleAutomationCompletionBridge/);
assert.match(gtoLauncher, /GtoObserver\.startObserver\(\)/);
assert.match(pendingPage, /profileIndex\.status === "ready"/);
assert.match(pendingPage, /profileIndex\.profiles\.length > 0/);
assert.match(pendingPage, /Desconectar/);
assert.match(pendingPage, /Início/);

console.log("recruitment-onboarding-flow: PASS pending precedence, Google identity, status route and projection isolation");
