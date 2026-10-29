import * as functions from "firebase-functions/v1";
import * as admin from "./firebaseAdmin";
import { createHash, timingSafeEqual } from "node:crypto";
import { requireActiveAccount } from "./seniorAccountCommands";

const db = admin.firestore();

const PASSWORD_HASH_PREFIX = "nvu-senior-v1:";
// Hash da senha legada. O valor em texto puro não é mais distribuído no app.
// SENIOR_PANEL_PASSWORD_HASH pode substituir este hash sem alterar o cliente.
const LEGACY_PASSWORD_HASH =
  "ae209624637b38eb385a4be1d3a939722e355bf2ab4754c0798125a75957a58f";
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const BLOCK_DURATION_MS = 30 * 60 * 1000;
const MAX_FAILURES_PER_WINDOW = 5;

type AttemptState = {
  failureCount?: unknown;
  windowStartedAtMs?: unknown;
  blockedUntilMs?: unknown;
};

function hashPassword(password: string): string {
  return createHash("sha256")
    .update(`${PASSWORD_HASH_PREFIX}${password}`)
    .digest("hex");
}

function configuredPasswordHash(): string {
  const configured = String(process.env.SENIOR_PANEL_PASSWORD_HASH || "")
    .trim()
    .toLowerCase();
  return /^[a-f0-9]{64}$/.test(configured) ? configured : LEGACY_PASSWORD_HASH;
}

function passwordMatches(password: string): boolean {
  const actual = Buffer.from(hashPassword(password), "hex");
  const expected = Buffer.from(configuredPasswordHash(), "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function finiteNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

async function registerAttempt(
  uid: string,
  accepted: boolean,
): Promise<{ blockedUntilMs: number; remainingAttempts: number }> {
  const attemptRef = db.collection("security_rate_limits").doc(`senior_${uid}`);
  const now = Date.now();

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(attemptRef);
    const state = (snapshot.data() || {}) as AttemptState;
    const currentlyBlockedUntil = finiteNumber(state.blockedUntilMs);

    if (currentlyBlockedUntil > now) {
      return { blockedUntilMs: currentlyBlockedUntil, remainingAttempts: 0 };
    }

    if (accepted) {
      if (snapshot.exists) transaction.delete(attemptRef);
      return {
        blockedUntilMs: 0,
        remainingAttempts: MAX_FAILURES_PER_WINDOW,
      };
    }

    const previousWindowStart = finiteNumber(state.windowStartedAtMs);
    const withinWindow =
      previousWindowStart > 0 && now - previousWindowStart < ATTEMPT_WINDOW_MS;
    const failureCount = withinWindow
      ? finiteNumber(state.failureCount) + 1
      : 1;
    const windowStartedAtMs = withinWindow ? previousWindowStart : now;
    const blockedUntilMs =
      failureCount >= MAX_FAILURES_PER_WINDOW ? now + BLOCK_DURATION_MS : 0;

    transaction.set(attemptRef, {
      uid,
      failureCount,
      windowStartedAtMs,
      blockedUntilMs,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      deleteAfter: admin.firestore.Timestamp.fromMillis(
        Math.max(blockedUntilMs, windowStartedAtMs + ATTEMPT_WINDOW_MS) +
          24 * 60 * 60 * 1000,
      ),
    });

    return {
      blockedUntilMs,
      remainingAttempts: Math.max(0, MAX_FAILURES_PER_WINDOW - failureCount),
    };
  });
}

export const authenticateSeniorAccess = functions
  .runWith({ timeoutSeconds: 30, memory: "256MB" })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Entre com sua conta Google antes de acessar o Painel Sênior.",
      );
    }

    const uid = context.auth.uid;
    const password = typeof data?.password === "string" ? data.password.trim() : "";
    if (!password || password.length > 128) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Informe uma senha de acesso válida.",
      );
    }

    await requireActiveAccount(context);
    const accepted = passwordMatches(password);
    const attempt = await registerAttempt(uid, accepted);
    if (attempt.blockedUntilMs > Date.now()) {
      throw new functions.https.HttpsError(
        "resource-exhausted",
        "Muitas tentativas. Aguarde 30 minutos antes de tentar novamente.",
        { blockedUntilMs: attempt.blockedUntilMs },
      );
    }
    if (!accepted) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Senha de acesso inválida.",
        { remainingAttempts: attempt.remainingAttempts },
      );
    }

    // Recheck after the rate-limit transaction, immediately before granting
    // authority. Password authentication must never reactivate the account.
    const { identity: userRecord } = await requireActiveAccount(context);
    const currentClaims = userRecord.customClaims || {};
    await admin.auth().setCustomUserClaims(uid, {
      ...currentClaims,
      senior: true,
    });

    const userRef = db.collection("users").doc(uid);
    await userRef.update(
      {
        id: uid,
        role: "senior",
        roles: admin.firestore.FieldValue.arrayUnion("senior"),
        seniorAccessGrantedAt: admin.firestore.FieldValue.serverTimestamp(),
        seniorAccessVersion: 1,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    );

    await db.collection("senior_access_audits").add({
      actorUid: uid,
      action: "senior_claim_granted",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      role: "senior",
      tokenRefreshRequired: true,
    };
  });
