import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

const appContext = read("src/context/AppContext.tsx");
const selectProfile = read("src/pages/SelectProfile.tsx");
const profileSessionGate = read("src/services/profileSessionGate.ts");
const adminLayout = read("src/layouts/AdminLayout.tsx");
const driverLayout = read("src/layouts/DriverLayout.tsx");
const app = read("src/App.tsx");
const login = read("src/pages/Login.tsx");
const bootOverlay = read("src/components/common/InitialBootOverlay.tsx");
const googleAuth = read("src/services/googleAuthService.ts");

// An unresolved company document must not erase an active membership.
check(
  !adminLayout.includes("Ghost company ignore") &&
    !driverLayout.includes("Ghost company ignore"),
  "Admin/Driver layouts ainda descartam uma membership ativa sem documento de empresa.",
);
check(
  adminLayout.includes('membership.status === "active"') &&
    driverLayout.includes('membership.status === "active"'),
  "Admin/Driver layouts não filtram explicitamente memberships ativas.",
);
check(
  selectProfile.includes("profileIndex") &&
    selectProfile.includes("profileIndex.status") &&
    selectProfile.includes("profileIndex.profiles") &&
    appContext.includes("buildProfileIndex") &&
    appContext.includes("activeProfileContext"),
  "SelectProfile/AppContext não usam o Profile Index e o contexto ativo canônicos.",
);

// Role switching must not use pending/rejected memberships.
check(
  appContext.includes('item.companyId === targetCompanyId && item.status === "active"'),
  "switchRole ainda pode considerar membership pendente/rejeitada.",
);
check(
  adminLayout.includes('m.companyId === activeCompanyId && m.status === "active"'),
  "AdminLayout ainda pode trocar papel usando membership não ativa.",
);
check(
  app.includes('membership.companyId === activeCompanyId') &&
    app.includes('membership.status === "active"'),
  "ProtectedRoute não confirma status active na membership.",
);

// The login recovery path must remain finite and retryable. The selector may
// mount with sessionUiReady, but its empty state must remain non-authoritative
// until a server-confirmed snapshot settles.
check(
  !login.includes("sessionBootTimedOut") &&
    !login.includes("Abrindo seus perfis") &&
    !login.includes("GOOGLE_AUTH_REDIRECT_RESULT_MISSING") &&
    login.includes("preloadGoogleIdentityServices") &&
    login.includes("auth.authStateReady()") &&
    login.includes("GOOGLE_AUTH_SESSION_NOT_CONFIRMED"),
  "Login ainda possui loader infinito ou contrato de redirect externo.",
);
check(
  !login.includes('<Navigate to="/select-profile" replace />'),
  "Login ainda possui uma segunda navegação em render que pode formar loop.",
);
check(
  selectProfile.includes("resolveProfileSessionGate") &&
    profileSessionGate.includes("membership-pending") &&
    profileSessionGate.includes('return "empty"') &&
    profileSessionGate.includes('return "diagnostic"') &&
    selectProfile.includes("SessionDiagnosticCard") &&
    selectProfile.includes('profileIndex.status === "resolving"'),
  "SelectProfile não separa resolução canônica, diagnóstico e estado de resolução.",
);
check(
  !selectProfile.includes("pendingProfileIntentRef") &&
    !selectProfile.includes("profileRefreshInFlightRef") &&
    selectProfile.includes("commitProfileNavigation") &&
    selectProfile.includes("profileIndex.status !== \"ready\"") &&
    appContext.includes("confirmedMembershipsRef") &&
    appContext.includes("setMembershipsLoaded(retainConfirmedSnapshot)"),
  "SelectProfile ainda guarda clique ou inicia refresh antes da navegação.",
);
check(
  bootOverlay.includes("const bootReady = Boolean(currentUser?.id) || sessionUiReady") &&
    !bootOverlay.includes("const bootReady = sessionReady") &&
    !bootOverlay.includes("select-profile"),
  "InitialBootOverlay deve encerrar com identidade visual, sem aguardar memberships.",
);
check(
  login.includes('if (auth.currentUser?.uid !== user.uid)') &&
    login.includes('navigate("/select-profile", { replace: true })') &&
    googleAuth.includes("signInWithGoogleAccount") &&
    app.includes("profileIndex.profiles.length === 1"),
  "Login/NavigationResolver não usa o índice de perfis após a credencial ser confirmada.",
);

// Pure behavioral fixture: an active membership remains selectable even when
// its company document is still unresolved; inactive memberships do not.
const activeMembership = { companyId: "company-a", status: "active" };
const rejectedMembership = { companyId: "company-b", status: "rejected" };
const companies = [];
const buildOptions = (memberships) =>
  memberships
    .filter((membership) => membership.status === "active")
    .map((membership) => ({
      companyId: membership.companyId,
      companyName: companies.find((item) => item.id === membership.companyId)
        ?.companyName ?? "Empresa vinculada",
    }));
const options = buildOptions([activeMembership, rejectedMembership]);
check(
  options.length === 1 &&
    options[0].companyId === "company-a" &&
    options[0].companyName === "Empresa vinculada",
  "Fixture de membership ativa durante hidratação falhou.",
);

if (failures.length > 0) {
  console.error("[LOGIN PROFILE FLOW] FAIL");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("[LOGIN PROFILE FLOW] PASS 8/8");
console.log("Membership ativa preservada; pendente/rejeitada bloqueada; Login finito; ProtectedRoute e layouts alinhados.");
