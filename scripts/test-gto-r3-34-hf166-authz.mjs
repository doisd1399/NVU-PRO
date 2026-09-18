import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const packageJson = JSON.parse(read("package.json"));
const wrapper = read("src/services/googleAuthService.ts");
const login = read("src/pages/Login.tsx");
const appContext = read("src/context/AppContext.tsx");
const adminService = read("src/services/adminOperationsService.ts");
const functionsIndex = read("functions/src/index.ts");
const adminFunctions = read("functions/src/adminOperations.ts");
const seniorPanel = read("src/pages/admin/SeniorPanel.tsx");
const seniorService = read("src/services/seniorAccessService.ts");
const rules = read("firestore.rules");
const gradle = read("android/app/build.gradle");
const runtimeRevision = read("src/lib/gtoRuntimeRevision.ts");
const revision = String(packageJson.gtoWebRuntimeRevision || "");
const versionCode = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1] || 0);
const versionName = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || "";

const checks = [];
const check = (name, ok) => {
  checks.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
};

check(
  "HF166+ version and runtime are monotonic",
  versionCode >= 243
    && versionName === `1.0.${versionCode}`
    && /^R3\.34-PC-HF\d+$/.test(revision)
    && runtimeRevision.includes(revision),
);
check(
  "Android uses the public native Credential Manager option",
  wrapper.includes("FirebaseAuthentication.signInWithGoogle({") && wrapper.includes("useCredentialManager: true"),
);
check(
  "Android has an in-app legacy Google fallback",
  wrapper.includes("useCredentialManager: false") && wrapper.includes("isNativeGoogleCancellation"),
);
check(
  "Native fallback never uses Web popup or redirect",
  wrapper.includes("if (!Capacitor.isNativePlatform())") && wrapper.includes("return signInWithWebPopup();") && !wrapper.slice(wrapper.indexOf("  let nativeResult:")).includes("signInWithWebPopup()"),
);
check(
  "Native token is exchanged with Firebase JS and confirmed",
  wrapper.includes("signInWithCredential") && wrapper.includes("nativeResult.credential?.idToken") && wrapper.includes("userCredential.user.getIdToken()"),
);
check(
  "Login keeps the single shared auth boundary",
  login.includes("signInWithGoogleAccount()") && !login.includes("signInWithPopup") && !login.includes("FirebaseAuthentication"),
);
check(
  "RH client delegates all critical decisions to Functions",
  appContext.includes("approveDriverRequestOnServer(requestId)") && appContext.includes("rejectDriverRequestOnServer(requestId)") && appContext.includes("approveRecruitmentApplicationOnServer(applicationId)") && appContext.includes("rejectRecruitmentApplicationOnServer(applicationId)"),
);
check(
  "RH client no longer writes critical request status directly",
  !/updateDoc\(doc\(db, "solicitacoes_motoristas"/.test(appContext) && !/updateDoc\(doc\(db, "recruitment_applications", applicationId\)/.test(appContext),
);
check(
  "RH callable exports are present",
  functionsIndex.includes('from "./adminOperations"') && adminService.includes('"approveDriverRequest"') && adminService.includes('"rejectDriverRequest"') && adminService.includes('"approveRecruitmentApplication"') && adminService.includes('"rejectRecruitmentApplication"'),
);
check(
  "RH callable validates authenticated company manager on server",
  adminFunctions.includes("assertCompanyManager") && adminFunctions.includes("hasSeniorClaim(context)") && adminFunctions.includes('"permission-denied"'),
);
check(
  "RH callable commits request, user, membership and notification atomically",
  adminFunctions.includes("db.runTransaction") && adminFunctions.includes('"companyMembers"') && adminFunctions.includes('"simulator_members"') && adminFunctions.includes('"notifications"'),
);
check(
  "Senior claim refresh is already enforced",
  seniorService.includes("getIdToken(true)") && seniorService.includes("claims.senior !== true"),
);
check(
  "Senior company handoff refreshes claim and awaits company hydration",
  seniorPanel.includes("getIdTokenResult(true)") && seniorPanel.includes("await loadCompanyById(companyId)") && seniorPanel.includes("await switchRole(\"admin\", companyId)"),
);
check(
  "Senior handoff blocks concurrent entry and does not navigate before switch",
  seniorPanel.includes("enteringCompanyId") && seniorPanel.includes("disabled={loadingAction || enteringCompanyId !== null}") && !seniorPanel.includes("void switchRole(\"admin\", companyId)"),
);
check(
  "Firestore rules still require auth for sensitive fallback writes",
  rules.includes("match /users/{userId}") && rules.includes("allow update") && rules.includes("match /recruitment_applications/{id}") && rules.includes("isAdmin()"),
);

const failed = checks.filter(({ ok }) => !ok);
console.log(`\\n${checks.length - failed.length}/${checks.length} HF166+ authz checks passed.`);
if (failed.length) process.exit(1);
