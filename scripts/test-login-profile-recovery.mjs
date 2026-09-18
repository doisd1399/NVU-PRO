import assert from "node:assert/strict";
import fs from "node:fs";

const login = fs.readFileSync(new URL("../src/pages/Login.tsx", import.meta.url), "utf8");
const appContext = fs.readFileSync(
  new URL("../src/context/AppContext.tsx", import.meta.url),
  "utf8",
);
const selectProfile = fs.readFileSync(
  new URL("../src/pages/SelectProfile.tsx", import.meta.url),
  "utf8",
);
const profileSessionGate = fs.readFileSync(
  new URL("../src/services/profileSessionGate.ts", import.meta.url),
  "utf8",
);
const bootOverlay = fs.readFileSync(
  new URL("../src/components/common/InitialBootOverlay.tsx", import.meta.url),
  "utf8",
);
const portal = fs.readFileSync(
  new URL("../src/pages/Portal.tsx", import.meta.url),
  "utf8",
);

assert.equal(
  login.includes('(currentUser && !sessionStorage.getItem("loginRedirect"))'),
  false,
  "o loader global antigo não pode depender apenas da existência de currentUser",
);
assert.equal(
  login.includes("sessionBootTimedOut") ||
    login.includes("Abrindo seus perfis") ||
    login.includes("GOOGLE_AUTH_REDIRECT_RESULT_MISSING"),
  false,
  "Login não pode manter loader infinito nem o contrato de redirect externo",
);
assert.match(login, /preloadGoogleIdentityServices/);
assert.match(login, /signInWithGoogleAccount/);
assert.match(login, /auth\.authStateReady\(\)/);
assert.match(login, /GOOGLE_AUTH_SESSION_NOT_CONFIRMED/);
assert.match(login, /navigate\("\/select-profile", \{ replace: true \}\)/);
assert.match(
  appContext,
  /setMembershipsLoaded\(true\);\s*setSessionRecovering\(false\);/s,
  "memberships precisa liberar o estado após recuperação ou falha definitiva",
);

assert.match(
  selectProfile,
  /profileIndex\.profiles/,
  "o seletor deve consumir perfis já resolvidos pelo índice canônico",
);
assert.match(
  appContext,
  /buildProfileIndex/,
  "o índice de perfis deve ser derivado no contexto canônico",
);
assert.match(
  appContext,
  /sessionUiReady/,
  "o contexto deve expor uma prontidão visual separada da autorização",
);
assert.match(
  appContext,
  /unifyUserDocument\(firebaseUser\)/,
  "a reconciliação de identidade deve pertencer ao observer central de Auth",
);
assert.match(
  selectProfile,
  /profileIndex\.status === "resolving"/,
  "o seletor deve aguardar somente a resolução do índice mínimo",
);
assert.match(
  appContext,
  /membershipsUiReady/,
  "o contexto deve diferenciar snapshot visual de autorização server-side",
);
assert.equal(
  bootOverlay.includes("select-profile"),
  false,
  "o overlay inicial não pode cobrir o seletor de perfil",
);
assert.match(
  bootOverlay,
  /const bootReady = Boolean\(currentUser\?\.id\) \|\| sessionUiReady/,
  "o overlay global deve encerrar com identidade visual, sem aguardar memberships",
);
assert.match(
  portal,
  /const hasRestoredIdentity = Boolean\(currentUser\)/,
  "o portal deve reconhecer identidade restaurada sem aguardar memberships",
);
assert.match(
  portal,
  /const hasApprovedProfile =/,
  "o portal deve exigir o índice canônico para considerar um perfil aprovado",
);
assert.match(
  portal,
  /navigate\(hasApprovedProfile \? "\/select-profile" : "\/pending-applications"/,
  "o portal deve separar seletor aprovado de Pendências para identidade restaurada",
);
assert.doesNotMatch(
  portal,
  /if \(isRestoringSession\) return;/,
  "o Portal não pode bloquear o primeiro toque durante a hidratação",
);
assert.match(
  portal,
  /navigate\("\/login"\)/,
  "o Portal deve manter Login quando não há identidade",
);
assert.equal(
  selectProfile.includes("!profileCompaniesHydrated"),
  false,
  "hidratação visual de empresas não pode bloquear a abertura do seletor",
);
assert.equal(
  profileSessionGate.includes("membership-pending") &&
    profileSessionGate.includes('return "empty"') &&
    profileSessionGate.includes('return "diagnostic"') &&
    selectProfile.includes("resolveProfileSessionGate"),
  true,
  "o seletor deve separar confirmação server-side, vazio definitivo e diagnóstico",
);
assert.doesNotMatch(
  selectProfile,
  /pendingProfileIntentRef|profileRefreshInFlightRef|companyHydrationFailures/,
  "o seletor não deve manter hydration, fila de clique ou refresh crítico próprios",
);

console.log("login-profile-recovery: PASS");