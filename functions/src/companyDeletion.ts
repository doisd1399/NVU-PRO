import * as admin from "./firebaseAdmin";
import * as functions from "firebase-functions/v1";
import { hasSeniorClaim } from "./authorization";
import { accessRef, accountUsable, companyOwner, requireCompanyManager } from "./companyAccess";
import { requireActiveSenior } from "./seniorAccountCommands";
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const stamp = () => admin.firestore.FieldValue.serverTimestamp();

/** Both UIs use this server-owned archive. History and operational ledgers are
 * retained. An active operation must be closed through the operational command. */
export const deleteCompanyCanonical = functions.https.onCall(async (input, context) => {
  const companyId = String(input?.companyId || "").trim();
  if (!companyId || companyId.length > 180 || /[\/\0]/.test(companyId)) throw new functions.https.HttpsError("invalid-argument", "Empresa inválida.");
  if (hasSeniorClaim(context)) await requireActiveSenior(context);
  const actionId = `archive_${companyId}`;
  await db.runTransaction(async tx => {
    // A lost response must allow the same active owner to resume an archive
    // even though the company is already marked deleted.
    const prior = await tx.get(db.doc(`company_deletion_commands/${actionId}`));
    if (prior.exists) {
      const uid = context.auth?.uid;
      if (!uid) throw new functions.https.HttpsError("unauthenticated", "Faça login para continuar.");
      const [user, company] = await Promise.all([tx.get(db.doc(`users/${uid}`)), tx.get(db.doc(`frotas/${companyId}`))]);
      if (!user.exists || !accountUsable(user.data() || {}) ||
        !(hasSeniorClaim(context) || prior.get("actorUid") === uid || companyOwner(company.data() || {}, uid)))
        throw new functions.https.HttpsError("permission-denied", "Você não pode retomar esta exclusão.");
      return;
    }
    const state = await requireCompanyManager(db, tx, context, companyId);
    if (!hasSeniorClaim(context) && !state.owner) throw new functions.https.HttpsError("permission-denied", "Apenas o proprietário ou Sênior pode excluir a empresa.");
    const [jobs, legacyJobs, command] = await Promise.all([
      tx.get(db.collection("trabalhos").where("companyId", "==", companyId)), tx.get(db.collection("trabalhos").where("empresaId", "==", companyId)), tx.get(db.doc(`company_deletion_commands/${actionId}`)),
    ]);
    if (command.exists) return;
    if ([...jobs.docs, ...legacyJobs.docs].some(row => !["completed", "cancelled", "canceled", "closed", "deleted", "concluido", "concluida", "cancelado", "cancelada"].includes(String(row.get("status") || "").toLowerCase())))
      throw new functions.https.HttpsError("failed-precondition", "Finalize ou cancele as operações da empresa antes da exclusão. O histórico será preservado.");
    tx.set(state.companySnap.ref, { deleted: true, status: "deleted", active: false, isActive: false, deletedAt: stamp(), deletedBy: context.auth!.uid }, { merge: true });
    tx.set(db.doc(`public_companies/${companyId}`), { deleted: true, status: "deleted", active: false, isActive: false }, { merge: true });
    tx.create(db.doc(`company_deletion_commands/${actionId}`), { actionId, companyId, actorUid: context.auth!.uid, state: "PENDING", createdAt: stamp() });
    tx.create(db.doc(`audit_senior_employee_actions/${actionId}`), { action: "ARCHIVE_COMPANY", actionId, companyId, actorUid: context.auth!.uid,
      historyPreserved: true, result: "pending_cleanup", createdAt: stamp() });
  });
  // The archive is immediately effective; cleanup is resumable after any crash.
  let cleanupPending = false;
  try { await cleanupCompany(companyId, actionId); } catch { cleanupPending = true; }
  return { cleanupPending, success: true, archived: true, companyId, actionId, historyPreserved: true };
});

async function detachUser(uid: string, companyId: string, memberRef?: FirebaseFirestore.DocumentReference) {
  await db.runTransaction(async tx => {
    const ref = db.doc(`users/${uid}`), row = await tx.get(ref), user = row.data() || {};
    const memberships = { ...(user.memberships || {}) }; delete memberships[companyId];
    const patch: Record<string, any> = { memberships, updatedAt: stamp() };
    if (user.companyId === companyId || user.empresaId === companyId) Object.assign(patch, {
      companyId: null, empresaId: admin.firestore.FieldValue.delete(), role: "driver", roles: ["driver"],
    });
    if (user.currentRecruitmentCompanyId === companyId) Object.assign(patch, { currentRecruitmentStatus: "rejected", currentRecruitmentCompanyId: admin.firestore.FieldValue.delete() });
    if (row.exists) tx.update(ref, patch);
    tx.set(accessRef(db, uid, companyId), { userId: uid, companyId, status: "removed", roles: [], revokedAt: stamp(), reason: "company_archived", updatedAt: stamp() });
    tx.delete(db.doc(`simulator_members/${uid}_${companyId}`));
    if (memberRef) tx.delete(memberRef);
  });
}

export async function cleanupCompany(companyId: string, actionId: string) {
  // Each pass has a bounded workload. Deleted rows disappear from the next
  // query; late/repeated executions are harmless and never touch trip history.
  const members = await db.collection("companyMembers").where("companyId", "==", companyId).limit(100).get();
  for (const row of members.docs) {
    const uid = String(row.get("userId") || "");
    if (uid) await detachUser(uid, companyId, row.ref);
    else await row.ref.delete();
  }
  for (const field of ["companyId", "empresaId"]) {
    const users = await db.collection("users").where(field, "==", companyId).limit(100).get();
    for (const row of users.docs) await detachUser(row.id, companyId);
  }
  const remaining = await Promise.all([
    db.collection("companyMembers").where("companyId", "==", companyId).limit(1).get(),
    db.collection("users").where("companyId", "==", companyId).limit(1).get(),
    db.collection("users").where("empresaId", "==", companyId).limit(1).get(),
  ]);
  if (remaining.some(rows => !rows.empty)) return;
  const commandRef = db.doc(`company_deletion_commands/${actionId}`);
  // Legacy projections/applications are paginated independently. The command
  // checkpoint and each page commit together, so a retry never skips a page.
  for (const [collection, field, cursorKey] of [
    ["simulator_members", "companyId", "simulatorCursor"],
    ["solicitacoes_motoristas", "empresaId", "requestCursor"],
    ["recruitment_applications", "companyId", "applicationCursor"],
  ]) {
    const command = await commandRef.get();
    if (command.get(cursorKey + "Done")) continue;
    let page = db.collection(collection).where(field, "==", companyId).orderBy(admin.firestore.FieldPath.documentId()).limit(100);
    const cursor = command.get(cursorKey);
    if (cursor) page = page.startAfter(cursor);
    const snapshot = await page.get(), pageBatch = db.batch();
    for (const row of snapshot.docs) {
      if (collection === "simulator_members") pageBatch.delete(row.ref);
      else pageBatch.set(row.ref, row.get("type") === "company_registration"
        ? { companyArchivedAt: stamp() }
        : { status: "rejected", isCurrent: false, accessRevokedAt: stamp(), accessRevokedReason: "company_archived", updatedAt: stamp() }, { merge: true });
    }
    pageBatch.update(commandRef, { [cursorKey]: snapshot.docs.at(-1)?.id || cursor || "", [cursorKey + "Done"]: snapshot.size < 100 });
    await pageBatch.commit();
    if (snapshot.size >= 100) return;
  }
  const batch = db.batch();
  batch.update(db.doc(`company_deletion_commands/${actionId}`), { state: "COMPLETED", completedAt: stamp() });
  batch.set(db.doc(`audit_senior_employee_actions/${actionId}`), { result: "completed", historyPreserved: true, completedAt: stamp() }, { merge: true });
  await batch.commit();
}

export const processCompanyDeletion = functions.runWith({ failurePolicy: true }).firestore
  .document("company_deletion_commands/{actionId}").onCreate(async (snapshot, context) => {
    await cleanupCompany(snapshot.get("companyId"), context.params.actionId);
    if ((await snapshot.ref.get()).get("state") !== "COMPLETED") throw new Error("COMPANY_CLEANUP_PENDING");
  });
export const recoverCompanyDeletions = functions.runWith({ timeoutSeconds: 540 }).pubsub.schedule("every 5 minutes").onRun(async () => {
  const rows = await db.collection("company_deletion_commands").where("state", "==", "PENDING").get();
  for (const row of rows.docs) { try { await cleanupCompany(row.get("companyId"), row.id); } catch (error) { console.warn("COMPANY_CLEANUP_DEFERRED", String((error as any)?.code || "STORAGE_ERROR")); } }
  return null;
});
