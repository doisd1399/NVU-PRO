import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const files = {
  app: read("src/App.tsx"),
  portal: read("src/pages/Portal.tsx"),
  selectProfile: read("src/pages/SelectProfile.tsx"),
  boot: read("src/components/common/InitialBootOverlay.tsx"),
  pending: read("src/pages/PendingApplications.tsx"),
  status: read("src/pages/ApplicationStatus.tsx"),
  profile: read("src/pages/driver/Profile.tsx"),
  operations: read("src/pages/admin/fleet/OperationsTab.tsx"),
  recruitment: read("src/pages/RecruitmentApply.tsx"),
  registerCompany: read("src/pages/RegisterCompany.tsx"),
  projection: read("src/services/authSessionProjection.ts"),
};

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

// Startup navigation must preserve an explicit deep-link/refresh route. The
// route memory records valid paths but never replaces them with the Portal.
check(
  !files.app.includes("isInitialWorkspaceRoute") &&
    !files.app.includes('navigate("/", { replace: true })') &&
    files.app.includes("direct refresh/deep link keeps its explicit URL") &&
    !files.app.includes("readSessionResumeRoute(uid)"),
  "SessionRouteMemory ainda pode redirecionar a rota recarregada.",
);
check(
  files.selectProfile.includes("must never become navigation intent") &&
    !files.selectProfile.includes("Auto enter if exactly 1 profile") &&
    !files.selectProfile.includes("prepareAndCommitNavigation"),
  "SelectProfile ainda possui auto-enter sem ação explícita do usuário.",
);
check(
  files.portal.includes(
    "const hasRestoredIdentity = Boolean(currentUser) || Boolean(sessionUiReady);",
  ) &&
    files.portal.includes("const hasApprovedProfile") &&
    files.portal.includes('navigate(hasApprovedProfile ? "/select-profile" : "/pending-applications"') &&
    files.portal.includes('navigate("/login")') &&
    files.portal.includes("disabled={false}") &&
    !files.portal.includes('"Restaurando conta…"'),
  "Portal não separa identidade restaurada de perfil aprovado ou voltou a bloquear a hidratação.",
);

// Authentication identity is the global visual prerequisite; membership remains
// authoritative for protected actions without becoming a Router-wide spinner.
check(
  files.app.includes("if (!authInitialized)") &&
    files.app.includes("if (!sessionUiReady)") &&
    !files.app.includes("if (!authInitialized || !sessionReady)"),
  "ProtectedRoute perdeu o gate explícito de identidade visual.",
);
check(
  !files.app.includes("if (!membershipsLoaded && !hasSeniorRole"),
  "ProtectedRoute voltou a bloquear o workspace inteiro enquanto memberships carregam.",
);
check(
  files.app.includes("cached active membership may paint the shell") &&
    files.app.includes("backend authorization authority"),
  "ProtectedRoute não documenta a separação entre apresentação local e autorização server-side.",
);

// The global boot cover must not wait for Firestore membership confirmation.
check(
  files.boot.includes("const bootReady = Boolean(currentUser?.id) || sessionUiReady") &&
    !files.boot.includes("const bootReady = sessionReady"),
  "InitialBootOverlay não está desacoplado da confirmação de memberships.",
);

// Lightweight user-scoped pages must depend on coherent identity only.
check(
  files.pending.includes("sessionUiReady") &&
    files.pending.includes('profileIndex.status === "ready"') &&
    files.pending.includes('to="/select-profile"') &&
    files.pending.includes("Desconectar") &&
    files.pending.includes("Início") &&
    !files.pending.includes("if (!sessionReady || !currentUser)"),
  "PendingApplications perdeu a barreira approved-profile ou as ações compactas.",
);
check(
  files.status.includes("if (!sessionUiReady || !currentUser)") &&
    !files.status.includes("if (!sessionReady || !currentUser || !membershipsLoaded)"),
  "ApplicationStatus voltou a bloquear sua superfície por memberships.",
);
check(
  files.profile.includes("if (!authInitialized || !sessionUiReady || !currentUser)") &&
    !files.profile.includes("!sessionReady || !currentUser"),
  "Perfil do motorista voltou a aguardar autorização remota para montar o shell.",
);
check(
  files.recruitment.includes("sessionUiReady") &&
    files.recruitment.includes('navigate("/pending-applications", { replace: true })') &&
    !files.recruitment.includes("const { sessionReady, currentUser }"),
  "RecruitmentApply não entra na Pendências após o envio ou voltou a tratar memberships como identidade do candidato.",
);
check(
  files.registerCompany.includes("sessionUiReady") &&
    files.registerCompany.includes('navigate("/pending-applications", { replace: true })') &&
    !files.registerCompany.includes("sessionReady"),
  "RegisterCompany não entra na Pendências após o envio ou voltou a depender de sessionReady.",
);

// Page data must render what is already available instead of returning a full
// tab skeleton until every operational collection is synchronized.
check(
  files.operations.includes("operationalDataRefreshing") &&
    !files.operations.includes("if (!operationalDataReady)"),
  "OperationsTab ainda possui um gate agregado de operationalDataReady.",
);

// Strict authorization semantics remain intact in the pure projection.
check(
  files.projection.includes("hasCoherentIdentity && membershipsLoaded") &&
    files.projection.includes("sessionUiReady: hasVisualIdentity || hasCoherentIdentity") &&
    files.projection.includes("visualIdentityReady"),
  "A projeção perdeu a distinção entre prontidão visual e autorização.",
);

if (failures.length > 0) {
  console.error("[AUTH ARCHITECTURE DECOUPLING] FAIL");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("[AUTH ARCHITECTURE DECOUPLING] PASS 14/14");
console.log("Identidade, Router, memberships e readiness de página permanecem desacoplados.");