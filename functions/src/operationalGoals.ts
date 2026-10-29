import * as functions from "firebase-functions/v1";
import * as admin from "./firebaseAdmin";
import { companyUsable, requireCompanyManager } from "./companyAccess";
import { parseFinancialGoalRequest, type GoalRequest } from "./operationalGoalPolicy";

/** Financial goals use canonical server authorization, independent of a missing
 * derived simulator index. */
export const manageOperationalGoal = functions.region("us-central1").runWith({ maxInstances: 4, timeoutSeconds: 30, memory: "256MB" }).https.onCall(async (raw: unknown, context) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Entre na sua conta para consultar a meta.");
  let input: GoalRequest;
  try { input = parseFinancialGoalRequest(raw); }
  catch { throw new functions.https.HttpsError("invalid-argument", "Confira a empresa, o período e o valor da meta."); }
  const uid = context.auth.uid;
  const db = admin.firestore();
  return db.runTransaction(async transaction => {
    // Use the same canonical membership, account and revocation boundary as
    // the rest of fleet management. Legacy profile/index roles cannot revive
    // permission after a removal or account suspension.
    const state = await requireCompanyManager(db, transaction, context, input.companyId);
    if (!state.companySnap.exists || !companyUsable(state.company))
      throw new functions.https.HttpsError("failed-precondition", "Empresa indisponível para gerenciar metas.");
    const ref = db.collection("operationalGoals").doc(input.documentId);
    const existing = await transaction.get(ref);
    const data = existing.data();
    if (data && (data.companyId !== input.companyId || data.simulatorId !== input.simulatorId || data.periodKey !== input.periodKey || data.currency !== "BRL" || !Number.isFinite(data.targetAmount) || data.targetAmount < 0)) throw new functions.https.HttpsError("failed-precondition", "A meta salva possui um vínculo inválido e precisa ser revisada.");
    const targetAmount = input.action === "save" ? input.targetAmount! : Number(data?.targetAmount || 0);
    // Retry of an acknowledged amount is idempotent and incurs no second write.
    if (input.action === "save" && (!existing.exists || data?.targetAmount !== targetAmount)) transaction.set(ref, {
      companyId: input.companyId, simulatorId: input.simulatorId, periodKey: input.periodKey,
      targetAmount, currency: "BRL", updatedBy: uid, updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { companyId: input.companyId, simulatorId: input.simulatorId, periodKey: input.periodKey, targetAmount, exists: existing.exists || input.action === "save" };
  });
});
