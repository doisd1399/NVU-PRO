import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const appContext = fs.readFileSync(
  path.join(root, "src/context/AppContext.tsx"),
  "utf8",
);
const membershipRepository = fs.readFileSync(
  path.join(root, "src/services/membershipRepository.ts"),
  "utf8",
);
const login = fs.readFileSync(path.join(root, "src/pages/Login.tsx"), "utf8");
const identity = fs.readFileSync(
  path.join(root, "src/services/userIdentityService.ts"),
  "utf8",
);
const selectProfile = fs.readFileSync(
  path.join(root, "src/pages/SelectProfile.tsx"),
  "utf8",
);

const checks = [
  [
    "membership query remains UID-scoped",
    membershipRepository.includes('where("userId", "==", uid)') &&
      appContext.includes("createMembershipRepository"),
  ],
  [
    "post-reconciliation membership confirmation uses Firestore server",
    (appContext.includes("getDocsFromServer") ||
      membershipRepository.includes("getDocsFromServer")) &&
      appContext.includes("confirmCanonicalMemberships"),
  ],
  [
    "legacy reconciliation exposes pending migration state",
    identity.includes("pendingLegacyUserIds") &&
      identity.includes("migrationComplete"),
  ],
  [
    "login confirms Firebase Auth before profile navigation",
    login.includes("auth.authStateReady()") &&
      login.includes("GOOGLE_AUTH_SESSION_NOT_CONFIRMED") &&
      login.includes('navigate("/select-profile", { replace: true })') &&
      !login.includes("confirmCanonicalMemberships"),
  ],
  [
    "identity reconciliation is central and Web auth has no external redirect",
    appContext.includes("unifyUserDocument(firebaseUser)") &&
      login.includes("preloadGoogleIdentityServices") &&
      !login.includes("GOOGLE_AUTH_REDIRECT_RESULT_MISSING") &&
      !login.includes("window.location.reload()"),
  ],
  [
    "active membership is not discarded while company loads",
    !selectProfile.includes("if (companies.length > 0 && !comp) return"),
  ],
  [
    "unresolved company keeps an explicit non-empty identity",
    selectProfile.includes('Empresa vinculada (carregando...)'),
  ],
  [
    "protected navigation still uses membership company id",
    selectProfile.includes('handleSelect("driver", activeCompany!.companyId)'),
  ],
];

let failed = 0;
for (const [label, passed] of checks) {
  if (passed) {
    console.log(`PASS ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL ${label}`);
  }
}

if (failed > 0) {
  console.error(`Login/membership recovery gate failed: ${failed} check(s).`);
  process.exit(1);
}

console.log(`Login/membership recovery gate passed: ${checks.length}/${checks.length}.`);
