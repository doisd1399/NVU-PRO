import assert from "node:assert/strict";
import fs from "node:fs";

const googleAuthService = fs.readFileSync(
  new URL("../src/services/googleAuthService.ts", import.meta.url),
  "utf8",
);
const loginPage = fs.readFileSync(
  new URL("../src/pages/Login.tsx", import.meta.url),
  "utf8",
);
import {
  createGoogleAuthAttempt,
} from "../src/services/googleAuthState.ts";

const attempt = createGoogleAuthAttempt("attempt-1", "web-mobile");
assert.equal(attempt.state().phase, "idle");
attempt.transition("starting");
attempt.transition("awaiting-provider");
attempt.transition("credential-received");
attempt.transition("firebase-authenticating");
attempt.transition("auth-confirmed");
attempt.transition("ready-for-profile-selector");
assert.equal(attempt.state().phase, "ready-for-profile-selector");
assert.throws(
  () => attempt.transition("starting"),
  /GOOGLE_AUTH_TERMINAL_TRANSITION/,
);

const failed = createGoogleAuthAttempt("attempt-2", "android");
failed.transition("starting");
failed.transition("awaiting-provider");
failed.fail();
assert.equal(failed.state().phase, "recoverable-error");
failed.transition("starting");
assert.equal(failed.state().phase, "starting");
assert.throws(
  () => failed.transition("auth-confirmed"),
  /GOOGLE_AUTH_INVALID_TRANSITION/,
);

const cancelled = createGoogleAuthAttempt("attempt-3", "android");
cancelled.transition("starting");
cancelled.transition("awaiting-provider");
cancelled.cancel();
assert.equal(cancelled.state().phase, "cancelled");

assert.match(googleAuthService, /signInWithPopup/);
assert.match(googleAuthService, /isGoogleIdentityNotDisplayedError/);
assert.match(googleAuthService, /using Firebase popup fallback/);
assert.match(googleAuthService, /environment === "android"/);
assert.match(loginPage, /auth\/popup-blocked/);
assert.match(loginPage, /auth\/popup-closed-by-user/);
assert.match(loginPage, /auth\/unauthorized-domain/);
assert.match(loginPage, /auth\/operation-not-allowed/);
assert.match(loginPage, /auth\/network-request-failed/);
assert.match(loginPage, /navegador bloqueou a janela/);
assert.match(loginPage, /provedor Google não está habilitado/);
assert.match(loginPage, /falha de rede/);

console.log("google-auth-state: PASS 3 scenarios + popup fallback + explicit Firebase errors");
