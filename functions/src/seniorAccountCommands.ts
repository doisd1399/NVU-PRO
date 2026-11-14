import * as admin from "./firebaseAdmin";
import * as functions from "firebase-functions/v1";
import { randomUUID } from "node:crypto";
import { accountUsable } from "./companyAccess";
import { hasSeniorClaim } from "./authorization";
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const auth = admin.auth();
const now = () => admin.firestore.FieldValue.serverTimestamp();
const commands = () => db.collection("senior_account_commands");

/** A cached ID token must not revive a blocked, deleted or revoked account. */
export async function requireActiveAccount(context: functions.https.CallableContext) {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError("unauthenticated", "Autenticação obrigatória.");
  const [profile, identity] = await Promise.all([db.doc(`users/${uid}`).get(), auth.getUser(uid).catch(error => {
    if (error.code === "auth/user-not-found")
      throw new functions.https.HttpsError("permission-denied", "Conta ou sessão administrativa indisponível. Entre novamente.");
    throw error;
  })]);
  const authTime = Number(context.auth?.token.auth_time || 0) * 1000;
  const revokedBefore = Date.parse(identity.tokensValidAfterTime || "") || 0;
  if (!profile.exists || !accountUsable(profile.data() || {}) || identity.disabled || !authTime || authTime < revokedBefore)
    throw new functions.https.HttpsError("permission-denied", "Conta ou sessão administrativa indisponível. Entre novamente.");
  return { uid, profile, identity };
}

/** Claims express authority; current account and token revocation express eligibility. */
export async function requireActiveSenior(context: functions.https.CallableContext) {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Autenticação obrigatória.");
  if (!hasSeniorClaim(context)) throw new functions.https.HttpsError("permission-denied", "Permissão Sênior obrigatória.");
  const { uid } = await requireActiveAccount(context);
  return { uid, senior: true };
}

/** Recovery never guesses a rollback across Firestore and Authentication.
 * The intended state, audit and command are committed before external effects. */
export async function executeAccountCommand(actionId: string): Promise<boolean> {
  const ref = commands().doc(actionId), token = randomUUID();
  const claim = await db.runTransaction(async tx => {
    const command = await tx.get(ref), data = command.data();
    if (!data || data.state === "COMPLETED") return null;
    const target = await tx.get(db.doc(`users/${data.targetUserId}`));
    if (target.get("pendingAccountCommand") !== actionId) return null;
    if (Number(data.leaseUntil || 0) > Date.now()) return null;
    tx.update(ref, { leaseToken: token, leaseUntil: Date.now() + 120_000, attempts: Number(data.attempts || 0) + 1, updatedAt: now() });
    return data;
  });
  if (!claim) return (await ref.get()).get("state") === "COMPLETED";
  try {
    await auth.updateUser(claim.targetUserId, { disabled: claim.disabled === true });
    await auth.revokeRefreshTokens(claim.targetUserId);
    await db.runTransaction(async tx => {
      const [command, target] = await Promise.all([tx.get(ref), tx.get(db.doc(`users/${claim.targetUserId}`))]);
      if (command.get("leaseToken") !== token || target.get("pendingAccountCommand") !== actionId) return;
      tx.set(target.ref, { ...claim.finalPatch, pendingAccountCommand: admin.firestore.FieldValue.delete(), accountActionState: "COMPLETED", updatedAt: now() }, { merge: true });
      tx.update(ref, { state: "COMPLETED", leaseUntil: 0, completedAt: now(), updatedAt: now() });
      tx.set(db.doc(`audit_senior_employee_actions/${actionId}`), { result: "completed", completedAt: now() }, { merge: true });
    });
    return (await ref.get()).get("state") === "COMPLETED";
  } catch (error) {
    await db.runTransaction(async tx => {
      const current = await tx.get(ref);
      if (current.get("leaseToken") !== token || current.get("state") === "COMPLETED") return;
      tx.update(ref, { state: "PENDING", leaseUntil: 0, lastErrorCode: String((error as any)?.code || "AUTH_UPDATE_FAILED").slice(0, 100), updatedAt: now() });
      tx.set(db.doc(`audit_senior_employee_actions/${actionId}`), { result: "pending_recovery", updatedAt: now() }, { merge: true });
    });
    return false;
  }
}

export async function submitAccountCommand(input: {
  action: string; actorUid: string; targetUserId: string; companyId?: string; reason?: string;
  disabled: boolean; requestId?: string; buildPatch: (target: Record<string, any>, actionId: string) => Record<string, any>;
}) {
  const requestedId = input.requestId && /^[A-Za-z0-9_-]{8,100}$/.test(input.requestId) ? input.requestId : commands().doc().id;
  const actionId = await db.runTransaction(async tx => {
    const targetRef = db.doc(`users/${input.targetUserId}`), target = await tx.get(targetRef);
    if (!target.exists) throw new functions.https.HttpsError("not-found", "Perfil não encontrado.");
    const priorId = String(target.get("pendingAccountCommand") || requestedId);
    const prior = await tx.get(commands().doc(priorId));
    if (prior.exists) {
      if (prior.get("action") !== input.action || prior.get("actorUid") !== input.actorUid || prior.get("targetUserId") !== input.targetUserId)
        throw new functions.https.HttpsError("failed-precondition", "Existe uma ação administrativa pendente para esta conta.");
      return priorId;
    }
    const patch = input.buildPatch(target.data() || {}, requestedId);
    tx.create(commands().doc(requestedId), { actionId: requestedId, action: input.action, actorUid: input.actorUid,
      targetUserId: input.targetUserId, companyId: input.companyId || null, disabled: input.disabled,
      finalPatch: patch, state: "PENDING", attempts: 0, leaseUntil: 0, createdAt: now(), updatedAt: now() });
    tx.set(targetRef, { ...(input.disabled ? patch : {}), pendingAccountCommand: requestedId, accountActionState: "PENDING", updatedAt: now() }, { merge: true });
    tx.create(db.doc(`audit_senior_employee_actions/${requestedId}`), { actionId: requestedId, action: input.action, actionType: input.action,
      actorUid: input.actorUid, targetUserId: input.targetUserId, companyId: input.companyId || null, reason: input.reason || "",
      previousState: { accountStatus: target.get("accountStatus") || "active", suspension: target.get("suspension") || null },
      result: "pending", createdAt: now() });
    return requestedId;
  });
  const completed = await executeAccountCommand(actionId);
  return { success: completed, pending: !completed, state: completed ? "COMPLETED" : "PENDING", action: input.action, actionId };
}

export const processSeniorAccountCommand = functions.runWith({ failurePolicy: true }).firestore
  .document("senior_account_commands/{actionId}").onCreate(async (_snapshot, context) => {
    if (!await executeAccountCommand(context.params.actionId)) throw new Error("ACCOUNT_COMMAND_PENDING_RECOVERY");
  });

/** Independent of opening a Senior screen; revisits old data as well as new commands. */
export const recoverSeniorAccountCommands = functions.runWith({ timeoutSeconds: 540 }).pubsub.schedule("every 1 minutes").onRun(async () => {
  const pending = await commands().where("state", "==", "PENDING").get();
  for (const row of pending.docs) { try { await executeAccountCommand(row.id); } catch (error) { console.warn("ACCOUNT_COMMAND_RECOVERY_DEFERRED", String((error as any)?.code || "STORAGE_ERROR")); } }
  const users = await db.collection("users").where("accountStatus", "==", "suspended").get();
  for (const row of users.docs) {
    const user = row.data(), suspension = user.suspension || {};
    const expires = suspension.expiresAt?.toMillis?.() || Date.parse(String(suspension.expiresAt || ""));
    if (!suspension.active || !expires || expires > Date.now() || user.deleted || user.pendingAccountCommand) continue;
    try { await submitAccountCommand({ action: "EXPIRE_SUSPENSION", actorUid: "server_expiration", targetUserId: row.id,
      companyId: suspension.companyId, disabled: false,
      buildPatch: latest => {
        if (latest.deleted || latest.accountStatus !== "suspended" || latest.suspension?.actionId !== suspension.actionId ||
            !latest.suspension?.active || (Date.parse(String(latest.suspension.expiresAt || "")) || Infinity) > Date.now())
          throw new functions.https.HttpsError("failed-precondition", "A suspensão foi alterada.");
        return { accountStatus: "active", ...(latest.status === "suspended" ? { status: latest.companyId ? "active" : "pending" } : {}), suspension: { ...latest.suspension, active: false, expiredAt: new Date().toISOString(), expiredBy: "server_expiration" } };
      } }); } catch (error) { console.warn("SUSPENSION_EXPIRATION_DEFERRED", String((error as any)?.code || "STORAGE_ERROR")); }
  }
  return null;
});
