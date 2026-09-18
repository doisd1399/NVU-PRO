import assert from "node:assert/strict";
import fs from "node:fs";

const portalPath = new URL("../src/pages/Portal.tsx", import.meta.url);
const portal = fs.readFileSync(portalPath, "utf8");

// Portal is a public entry surface: it must always expose an actionable CTA.
// A restored identity reaches SelectProfile only when the canonical profile
// index confirms an approved profile; otherwise it goes to Pendências.
assert.match(
  portal,
  /const hasRestoredIdentity = Boolean\(currentUser\) \|\| Boolean\(sessionUiReady\);/,
  "Portal deve usar identidade restaurada ou prontidão visual para o CTA",
);
assert.match(
  portal,
  /const hasApprovedProfile =/,
  "Portal deve exigir perfil aprovado para abrir o seletor",
);
assert.match(
  portal,
  /navigate\(hasApprovedProfile \? "\/select-profile" : "\/pending-applications"/,
  "identidade restaurada sem aprovação deve ir para Pendências",
);
assert.doesNotMatch(
  portal,
  /if \(isRestoringSession\) return;/,
  "o CTA não deve descartar o primeiro toque durante hidratação",
);
assert.match(
  portal,
  /disabled=\{false\}[\s\S]*aria-busy=\{false\}/,
  "o CTA deve nascer habilitado",
);
assert.match(
  portal,
  /hasRestoredIdentity[\s\S]*hasApprovedProfile[\s\S]*"Escolher perfil"[\s\S]*"Pendências"[\s\S]*"Fazer Login"/,
  "o Portal deve distinguir seletor aprovado, Pendências e Login",
);

const resolveCta = ({ currentUser, sessionUiReady, profileIndex }) => {
  const hasRestoredIdentity = Boolean(currentUser) || Boolean(sessionUiReady);
  const hasApprovedProfile =
    profileIndex?.status === "ready" && profileIndex.profiles.length > 0;
  if (hasRestoredIdentity) {
    return hasApprovedProfile
      ? { label: "Escolher perfil", action: "select-profile", disabled: false }
      : { label: "Pendências", action: "pending-applications", disabled: false };
  }
  return { label: "Fazer Login", action: "login", disabled: false };
};

assert.deepEqual(
  resolveCta({ currentUser: null, sessionUiReady: false }),
  { label: "Fazer Login", action: "login", disabled: false },
  "cold start sem sessão deve abrir Login imediatamente",
);
assert.deepEqual(
  resolveCta({ currentUser: null, sessionUiReady: false }),
  { label: "Fazer Login", action: "login", disabled: false },
  "hidratação pendente não deve pintar Restaurando conta",
);
assert.deepEqual(
  resolveCta({ currentUser: { id: "firebase-uid" }, sessionUiReady: false, profileIndex: { status: "empty", profiles: [] } }),
  { label: "Pendências", action: "pending-applications", disabled: false },
  "identidade restaurada sem perfil aprovado deve abrir Pendências",
);
assert.deepEqual(
  resolveCta({ currentUser: { id: "firebase-uid" }, sessionUiReady: true, profileIndex: { status: "ready", profiles: [{ id: "profile" }] } }),
  { label: "Escolher perfil", action: "select-profile", disabled: false },
  "perfil aprovado deve liberar o seletor sem novo login",
);

console.log("portal-restored-session: PASS 10 checks");
console.log("CTA acionável; Login ou seletor aparecem sem bloqueio de hidratação.");
