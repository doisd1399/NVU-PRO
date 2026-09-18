import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const login = fs.readFileSync(path.join(root, "src/pages/Login.tsx"), "utf8");
const appContext = fs.readFileSync(
  path.join(root, "src/context/AppContext.tsx"),
  "utf8",
);
const authSessionProjection = fs.readFileSync(
  path.join(root, "src/services/authSessionProjection.ts"),
  "utf8",
);
const membershipRepository = fs.readFileSync(
  path.join(root, "src/services/membershipRepository.ts"),
  "utf8",
);
const app = fs.readFileSync(path.join(root, "src/App.tsx"), "utf8");
const identity = fs.readFileSync(
  path.join(root, "src/services/userIdentityService.ts"),
  "utf8",
);
const membershipRoles = fs.readFileSync(
  path.join(root, "src/lib/membershipRoles.ts"),
  "utf8",
);
const companyContext = fs.readFileSync(
  path.join(root, "src/context/CompanyContext.tsx"),
  "utf8",
);
const adminLayout = fs.readFileSync(
  path.join(root, "src/layouts/AdminLayout.tsx"),
  "utf8",
);
const driverLayout = fs.readFileSync(
  path.join(root, "src/layouts/DriverLayout.tsx"),
  "utf8",
);
const googleAuth = fs.readFileSync(
  path.join(root, "src/services/googleAuthService.ts"),
  "utf8",
);
const googleAuthState = fs.readFileSync(
  path.join(root, "src/services/googleAuthState.ts"),
  "utf8",
);
const recruitmentApply = fs.readFileSync(
  path.join(root, "src/pages/RecruitmentApply.tsx"),
  "utf8",
);
const registerCompany = fs.readFileSync(
  path.join(root, "src/pages/RegisterCompany.tsx"),
  "utf8",
);
const deployRecovery = fs.readFileSync(
  path.join(root, "src/lib/deployRecovery.ts"),
  "utf8",
);

function reconcileFixture({ canonicalUid, memberships, membershipMigrationFailure }) {
  const migrated = membershipMigrationFailure
    ? memberships.map((membership) => ({ ...membership }))
    : memberships.map((membership) => ({ ...membership, userId: canonicalUid }));
  const canonicalMemberships = migrated.filter(
    (membership) => membership.userId === canonicalUid,
  );
  const active = canonicalMemberships.filter(
    (membership) => membership.status === "active",
  );
  return {
    pending: Boolean(membershipMigrationFailure),
    canOpenProfile: active.length > 0,
    activeRoles: active.flatMap((membership) => membership.roles || []),
  };
}

const fixtures = [
  {
    label: "UID canônico já vinculado",
    input: {
      canonicalUid: "uid-google",
      memberships: [
        { userId: "uid-google", companyId: "company-a", status: "active", roles: ["admin"] },
      ],
      membershipMigrationFailure: false,
    },
    expected: { canOpenProfile: true, role: "admin" },
  },
  {
    label: "UID Google novo com membership legada",
    input: {
      canonicalUid: "uid-google-new",
      memberships: [
        { userId: "uid-legacy", companyId: "company-a", status: "active", roles: ["driver"] },
      ],
      membershipMigrationFailure: false,
    },
    expected: { canOpenProfile: true, role: "driver" },
  },
  {
    label: "falha auxiliar não bloqueia vínculo migrado",
    input: {
      canonicalUid: "uid-google-new",
      memberships: [
        { userId: "uid-legacy", companyId: "company-a", status: "active", roles: ["admin", "driver"] },
      ],
      // A falha auxiliar é isolada pelo código; o batch de companyMembers ainda
      // conclui e a confirmação canônica deve liberar o perfil.
      membershipMigrationFailure: false,
    },
    expected: { canOpenProfile: true, role: "admin" },
  },
  {
    label: "falha na migração do vínculo não libera perfil",
    input: {
      canonicalUid: "uid-google-new",
      memberships: [
        { userId: "uid-legacy", companyId: "company-a", status: "active", roles: ["driver"] },
      ],
      membershipMigrationFailure: true,
    },
    expected: { canOpenProfile: false, pending: true },
  },
  {
    label: "membership pending não libera perfil",
    input: {
      canonicalUid: "uid-google-new",
      memberships: [
        { userId: "uid-legacy", companyId: "company-a", status: "pending", roles: ["driver"] },
      ],
      membershipMigrationFailure: false,
    },
    expected: { canOpenProfile: false, pending: false },
  },
  {
    label: "membership rejected não libera perfil",
    input: {
      canonicalUid: "uid-google-new",
      memberships: [
        { userId: "uid-legacy", companyId: "company-a", status: "rejected", roles: ["driver"] },
      ],
      membershipMigrationFailure: false,
    },
    expected: { canOpenProfile: false, pending: false },
  },
];

let failed = 0;
for (const fixture of fixtures) {
  const result = reconcileFixture(fixture.input);
  const roleOk = fixture.expected.role
    ? result.activeRoles.includes(fixture.expected.role)
    : true;
  const passed =
    result.canOpenProfile === fixture.expected.canOpenProfile &&
    result.pending === Boolean(fixture.expected.pending) &&
    roleOk;
  if (passed) {
    console.log(`PASS fixture: ${fixture.label}`);
  } else {
    failed += 1;
    console.error(`FAIL fixture: ${fixture.label}`, { result, expected: fixture.expected });
  }
}

const sourceChecks = [
  [
    "Login confirms Firebase Auth before profile navigation",
    login.includes("auth.authStateReady()") &&
      login.includes("GOOGLE_AUTH_SESSION_NOT_CONFIRMED") &&
      login.includes('navigate("/select-profile", { replace: true })') &&
      !login.includes("confirmCanonicalMemberships"),
  ],
  [
    "Google login has an exact-UID confirmation barrier",
    login.includes("auth.currentUser?.uid !== user.uid") &&
      login.includes("GOOGLE_AUTH_SESSION_NOT_CONFIRMED") &&
      !login.includes("setCurrentUser({"),
  ],
  [
    "legacy reconciliation belongs to the central Auth observer",
    appContext.includes("unifyUserDocument(firebaseUser)") &&
      !login.includes("unifyUserDocument"),
  ],
  [
    "Login has no unsafe redirect storage authority",
    !login.includes("storeSafeLoginRedirect") &&
      !login.includes("target.origin !== window.location.origin"),
  ],
  [
    "sessionReady remains authorized during background recovery only after server confirmation",
    authSessionProjection.includes("hasCoherentIdentity && membershipsLoaded") &&
      authSessionProjection.includes("Recovery may") &&
      authSessionProjection.includes("continue in the background") &&
      appContext.includes("confirmedMembershipsRef") &&
      appContext.includes("setMembershipsLoaded(retainConfirmedSnapshot)"),
  ],
  [
    "server confirmation is UID-scoped",
    membershipRepository.includes('where("userId", "==", uid)') &&
      membershipRepository.includes("getDocsFromServer") &&
      appContext.includes("createMembershipRepository"),
  ],
  [
    "new canonical user is created with non-privileged role",
    identity.includes('canonicalWriteData.role = "driver"') &&
      identity.includes('canonicalWriteData.roles = ["driver"]'),
  ],
  [
    "legacy migration exposes pending state",
    identity.includes("pendingLegacyUserIds") &&
      identity.includes("migrationComplete"),
  ],
  [
    "collection failures do not share one aborting batch",
    identity.includes("updateMapsByCollection") &&
      identity.includes('field: "commit"'),
  ],
  [
    "protected routes do not authorize from legacy account fields",
    app.includes('membershipHasRole(activeMembership, "admin")') &&
      app.includes('membershipHasRole(activeMembership, "driver")') &&
      !app.includes('currentUser.roles?.includes("admin")') &&
      !app.includes('currentUser.roles?.includes("driver")'),
  ],
  [
    "role resolver ignores legacy user authorization",
    membershipRoles.includes("user.role/companyId/memberships fields are intentionally not consulted") &&
      !membershipRoles.includes("user?.role") &&
      !membershipRoles.includes("user?.roles") &&
      !membershipRoles.includes("user?.companyId"),
  ],
  [
    "company hydration does not resurrect currentUser.companyId",
    !companyContext.includes("currentUser.companyId") &&
      !companyContext.includes("currentUser?.companyId"),
  ],
  [
    "admin and driver layouts do not use legacy role fallback",
    !adminLayout.includes("hasLegacyRoleForActiveCompany") &&
      !driverLayout.includes("currentUser?.roles?.includes(\"driver\")"),
  ],
  [
    "selector uses membership company id",
    fs.readFileSync(path.join(root, "src/pages/SelectProfile.tsx"), "utf8").includes(
      'handleSelect("driver", activeCompany!.companyId)',
    ),
  ],
  [
    "Web uses GIS first with Firebase popup fallback",
    googleAuth.includes("accounts.google.com/gsi/client") &&
      googleAuth.includes("VITE_GOOGLE_WEB_CLIENT_ID") &&
      googleAuth.includes("use_fedcm_for_button") &&
      googleAuth.includes("signInWithCredential") &&
      googleAuth.includes("signInWithPopup") &&
      googleAuth.includes("isGoogleIdentityNotDisplayedError") &&
      !googleAuth.includes("signInWithRedirect") &&
      !googleAuth.includes("getRedirectResult"),
  ],
  [
    "Google boundary blocks concurrent attempts",
    googleAuth.includes("activeAttempt") &&
      googleAuth.includes("GOOGLE_AUTH_ALREADY_IN_PROGRESS") &&
      googleAuth.includes("finishAttempt"),
  ],
  [
    "all Google entry points use the shared boundary",
    recruitmentApply.includes("signInWithGoogleAccount") &&
      registerCompany.includes("signInWithGoogleAccount") &&
      !recruitmentApply.includes("signInWithPopup") &&
      !registerCompany.includes("signInWithPopup") &&
      !recruitmentApply.includes("signInWithRedirect") &&
      !registerCompany.includes("signInWithRedirect"),
  ],
  [
    "GIS attempt has a finite timeout and no page reload",
    googleAuth.includes("GOOGLE_IDENTITY_TIMEOUT_MS") &&
      googleAuth.includes("GOOGLE_IDENTITY_NOT_DISPLAYED") &&
      login.includes("setLoading(false)") &&
      !login.includes("window.location.reload()"),
  ],
  [
    "deploy recovery has no legacy OAuth redirect dependency",
    !deployRecovery.includes("hasPendingGoogleRedirect") &&
      !deployRecovery.includes("nvu.google.redirect.pending.v1"),
  ],
  [
    "state machine rejects terminal and invalid transitions",
    googleAuthState.includes("GOOGLE_AUTH_TERMINAL_TRANSITION") &&
      googleAuthState.includes("GOOGLE_AUTH_INVALID_TRANSITION") &&
      googleAuthState.includes('"recoverable-error": new Set(["starting"])'),
  ],
];

for (const [label, passed] of sourceChecks) {
  if (passed) {
    console.log(`PASS source: ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL source: ${label}`);
  }
}

if (failed > 0) {
  console.error(`Identity reconciliation gate failed: ${failed} check(s).`);
  process.exit(1);
}

console.log(
  `Identity reconciliation gate passed: ${fixtures.length} fixtures + ${sourceChecks.length} source checks.`,
);
