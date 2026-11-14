import * as admin from "./firebaseAdmin";
import * as functions from "firebase-functions/v1";
import { accountUsable } from "./companyAccess";
import { runMembershipTransaction, type MembershipCommandReceipt } from "./membershipCommandReceipt";

type Data = FirebaseFirestore.DocumentData;
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const safeId = (value: unknown, label: string) => {
  const result = text(value);
  if (!result || result.length > 180 || /[\/\0]/.test(result) || [".", ".."].includes(result))
    throw new functions.https.HttpsError("invalid-argument", `${label} inválido.`);
  return result;
};
const refuse = (code: functions.https.FunctionsErrorCode, message: string, reasonCode: string) =>
  new functions.https.HttpsError(code, message, { reasonCode, retryable: false });

/** Which commands this server understands. A client shows an option only after the server lists it. */
export const MEMBERSHIP_CAPABILITIES = ["leave", "leave-preview", "withdraw-application"] as const;
export const membershipCapabilities = () => ({ success: true, capabilities: [...MEMBERSHIP_CAPABILITIES], protocolVersion: 2 });

/** An application that the candidate withdrew is closed history: it can be neither approved nor rejected afterwards. */
export const WITHDRAWN = "withdrawn";

/**
 * The applicant withdraws an own application that nobody has answered yet. It stays in the company's history as
 * "withdrawn" (never as rejected) and cannot be approved any more. Only the applicant can do it; other companies'
 * applications and the account's other state are untouched. Repeating the command is a success.
 */
export async function withdrawApplicationCore(db: FirebaseFirestore.Firestore, context: functions.https.CallableContext,
  input: { companyId?: unknown; applicationId?: unknown }, receipt?: MembershipCommandReceipt) {
  const uid = safeId(context.auth?.uid, "Conta");
  const companyId = safeId(input.companyId, "Empresa"), applicationId = safeId(input.applicationId, "Inscrição");
  return runMembershipTransaction(db, receipt, async tx => {
    const applicationRef = db.collection("recruitment_applications").doc(applicationId), userRef = db.collection("users").doc(uid);
    const [applicationSnap, userSnap] = await Promise.all([tx.get(applicationRef), tx.get(userRef)]);
    const application: Data = applicationSnap.data() || {};
    // Existence and ownership share one answer, so an id of someone else's application is never confirmed.
    if (!applicationSnap.exists || application.type === "company_registration" || application.userId !== uid || text(application.companyId) !== companyId)
      throw refuse("not-found", "Inscrição não encontrada.", "WITHDRAW_NOT_FOUND");
    if (!userSnap.exists || !accountUsable(userSnap.data() || {})) throw refuse("permission-denied", "Conta suspensa ou indisponível.", "WITHDRAW_ACCOUNT_UNAVAILABLE");
    const result = { success: true, companyId, applicationId, withdrawn: true };
    if (application.status === WITHDRAWN) return result;
    if (application.status === "approved") throw refuse("failed-precondition", "Esta inscrição já foi aprovada.", "WITHDRAW_ALREADY_APPROVED");
    if (application.status !== "pending") throw refuse("failed-precondition", "Esta inscrição já foi respondida pela empresa.", "WITHDRAW_ALREADY_ANSWERED");
    const now = admin.firestore.FieldValue.serverTimestamp();
    tx.update(applicationRef, { status: WITHDRAWN, isCurrent: false, withdrawnAt: now, withdrawnBy: uid, updatedAt: now });
    const user: Data = userSnap.data() || {};
    // The legacy "latest application" pointer must not keep pointing at something that no longer exists for the company.
    if (text(user.currentRecruitmentApplicationId) === applicationId) tx.update(userRef, {
      currentRecruitmentApplicationId: admin.firestore.FieldValue.delete(), currentRecruitmentCompanyId: admin.firestore.FieldValue.delete(),
      currentRecruitmentSimulatorId: admin.firestore.FieldValue.delete(), currentRecruitmentStatus: admin.firestore.FieldValue.delete(),
      currentRecruitmentType: admin.firestore.FieldValue.delete(), updatedAt: now });
    return result;
  });
}
