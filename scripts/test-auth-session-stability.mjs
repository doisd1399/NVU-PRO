import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const googleAuth = fs.readFileSync(
  new URL("../src/services/googleAuthService.ts", import.meta.url),
  "utf8",
);
const applicationStatus = fs.readFileSync(
  new URL("../src/pages/ApplicationStatus.tsx", import.meta.url),
  "utf8",
);
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

const initializeCalls = googleAuth.match(/\.initialize\(/g) || [];
assert.equal(
  initializeCalls.length,
  1,
  "GIS deve possuir uma única chamada de initialize no código ativo",
);
assert.match(
  googleAuth,
  /let googleIdentityInitialized = false;/,
  "o serviço deve manter o lock de inicialização GIS",
);
assert.match(
  googleAuth,
  /function initializeGoogleIdentityOnce\(\)/,
  "a inicialização GIS deve estar centralizada",
);
assert.match(
  googleAuth,
  /activeAttempt !== attempt/,
  "callbacks GIS precisam estar vinculados à tentativa ativa",
);
assert.match(
  googleAuth,
  /generation !== googlePromptGeneration/,
  "callbacks de uma geração anterior precisam ser ignorados",
);
assert.match(
  googleAuth,
  /accounts\.id\.cancel\?\./,
  "reset da tentativa deve cancelar prompt antigo quando suportado",
);

assert.doesNotMatch(
  applicationStatus,
  /window\.location\.replace\(["']\/select-profile["']\)/,
  "aprovação não pode reinicializar a aplicação por hard reload",
);
assert.match(
  applicationStatus,
  /navigate\(["']\/select-profile["'], \{ replace: true \}\)/,
  "aprovação deve preservar a instância de Auth via navegação SPA",
);

const diagnosticIndex = profileSessionGate.indexOf('return "diagnostic"');
const pendingIndex = profileSessionGate.indexOf('return "membership-pending"');
assert.ok(
  diagnosticIndex >= 0 && selectProfile.includes("resolveProfileSessionGate"),
  "o seletor deve possuir superfície diagnóstica",
);
assert.ok(pendingIndex >= 0, "o seletor deve possuir superfície pendente");
assert.ok(
  diagnosticIndex < pendingIndex,
  "diagnóstico definitivo deve ser renderizado antes do spinner pendente",
);
const commitStart = selectProfile.indexOf("const commitProfileNavigation");
const commitEnd = selectProfile.indexOf("const handleLogout");
assert.ok(commitStart >= 0 && commitEnd > commitStart, "navegação do perfil deve estar delimitada");
assert.doesNotMatch(
  selectProfile.slice(commitStart, commitEnd),
  /refreshSession\(/,
  "o clique do perfil não pode iniciar refresh ou recovery",
);
assert.match(
  selectProfile,
  /onRetry=\{\(\) => refreshSession\(\)\}/,
  "o retry do diagnóstico deve usar a atualização manual",
);
assert.match(
  appContext,
  /recoverMembershipsFromServer\("listener-timeout"\)/,
  "timeout do listener deve iniciar recuperação server-side",
);

console.log("auth-session-stability: PASS 14 assertions");
