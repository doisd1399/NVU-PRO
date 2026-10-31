import { randomUUID } from "node:crypto";
import * as admin from "./firebaseAdmin";
import * as functions from "firebase-functions/v1";
import { accessRef, accountUsable, companyUsable, activeAccessData, memberRoles, readCompanyAccess, requireCompanyManager } from "./companyAccess";
import { hasSeniorClaim } from "./authorization";
import { membershipCommandReceipt, readMembershipCommandStatus, runMembershipTransaction, type MembershipCommandReceipt } from "./membershipCommandReceipt";
import { driverDisplayIdentity } from "./driverDisplayIdentity";
import { recruitmentIdentityPatch } from "./recruitmentIdentity";
import { leaveFleetMemberCore, previewLeaveFleetMember } from "./fleetMembershipLeave";
import { membershipCapabilities, withdrawApplicationCore, WITHDRAWN } from "./fleetApplications";
type Data = FirebaseFirestore.DocumentData;
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const id = (value: unknown, label: string) => {
  const result = text(value);
  if (!result || result.length > 180 || /[\/\0]/.test(result) || [".", ".."].includes(result))
    throw new functions.https.HttpsError("invalid-argument", `${label} inválido.`);
  return result;
};
const millis = (value: any): number => value?.toMillis?.() || Date.parse(String(value || "")) || 0;

/** Single atomic revocation, shared by the fleet UI and the Senior callable. */
export async function removeFleetMemberCore(db: FirebaseFirestore.Firestore, context: functions.https.CallableContext,
  targetUserId: string, companyId: string, reason = "removed_from_fleet", receipt?: MembershipCommandReceipt) {
  id(targetUserId, "Motorista"); id(companyId, "Empresa");
  if (context.auth?.uid === targetUserId) throw new functions.https.HttpsError("failed-precondition", "Não remova o próprio vínculo por esta ação.");
  return runMembershipTransaction(db, receipt, async tx => {
    const companyRead = tx.get(db.collection("frotas").doc(companyId));
    const [target] = await Promise.all([
      readCompanyAccess(db, tx, targetUserId, companyId, companyRead),
      requireCompanyManager(db, tx, context, companyId, companyRead),
    ]);
    const emails = [...new Set([text(target.user.email), text(target.user.email).toLowerCase()].filter(Boolean))];
    // Single-field identity indexes: work scales with this driver's records,
    // never with every applicant/employee of a large company. Legacy email
    // and driverId aliases remain covered and tenant-checked below.
    const [applicationQueries, requestQueries, companyMembers, simulatorMembers] = await Promise.all([
      Promise.all([tx.get(db.collection("recruitment_applications").where("userId", "==", targetUserId)),
        ...emails.map(email => tx.get(db.collection("recruitment_applications").where("email", "==", email)))]),
      Promise.all([tx.get(db.collection("solicitacoes_motoristas").where("motoristaId", "==", targetUserId)),
        tx.get(db.collection("solicitacoes_motoristas").where("driverId", "==", targetUserId))]),
      target.owner ? tx.get(db.collection("companyMembers").where("companyId", "==", companyId)) : Promise.resolve(null),
      tx.get(db.collection("simulator_members").where("userId", "==", targetUserId).where("companyId", "==", companyId)),
    ]);
    // A tombstone may predate cleanup of old user fields and application/request
    // projections. A repeated removal must finish that cleanup instead of
    // reporting success while stale fleet associations remain visible.
    const applications = { docs: [...new Map(applicationQueries.flatMap(snapshot => snapshot.docs)
      .filter(row => row.get("companyId") === companyId).map(row => [row.id, row])).values()] };
    const requests = { docs: [...new Map(requestQueries.flatMap(snapshot => snapshot.docs)
      .filter(row => row.get("empresaId") === companyId).map(row => [row.id, row])).values()] };
    const email = text(target.user.email).toLowerCase();
    const needsRejection = (row: FirebaseFirestore.QueryDocumentSnapshot) =>
      row.get("status") !== WITHDRAWN && (row.get("status") !== "rejected" || row.get("isCurrent") !== false || row.get("accessRevokedReason") !== "removed_from_fleet");
    const revokedApplications = applications.docs.filter(row => {
      const data = row.data();
      return data.type !== "company_registration" &&
        (data.userId === targetUserId || Boolean(email && text(data.email).toLowerCase() === email)) && needsRejection(row);
    });
    const revokedRequests = requests.docs.filter(row =>
      (row.get("motoristaId") === targetUserId || row.get("driverId") === targetUserId) && needsRejection(row));
    const staleUserMembership = target.userSnap.exists && (
      Object.prototype.hasOwnProperty.call(target.user.memberships || {}, companyId) ||
      target.user.companyId === companyId || target.user.empresaId === companyId ||
      target.user.currentRecruitmentCompanyId === companyId);
    if (target.revoked && target.members.empty && !target.owner && simulatorMembers.empty &&
        revokedApplications.length === 0 && revokedRequests.length === 0 && !staleUserMembership)
      return { success: true, targetUserId, companyId, removed: true };
    let replacement = "";
    if (target.owner) {
      if (!hasSeniorClaim(context)) throw new functions.https.HttpsError("failed-precondition", "Transfira a propriedade antes de remover o responsável pela empresa.");
      replacement = companyMembers?.docs.map(row => row.data()).find(row => row.userId !== targetUserId && row.status === "active" && memberRoles(row).includes("owner"))?.userId || "";
      if (!replacement) throw new functions.https.HttpsError("failed-precondition", "O proprietário é o único responsável pela frota. Transfira a propriedade antes de remover este vínculo.");
      const successor = await readCompanyAccess(db, tx, replacement, companyId);
      if (!successor.active) throw new functions.https.HttpsError("failed-precondition", "O novo responsável não está ativo.");
    }
    if (target.members.docs.length + simulatorMembers.docs.length + revokedApplications.length + revokedRequests.length > 400)
      throw new functions.https.HttpsError("failed-precondition", "O vínculo requer manutenção administrativa antes da remoção.");
    const now = admin.firestore.FieldValue.serverTimestamp();
    target.members.docs.forEach(row => tx.delete(row.ref));
    const canonicalSimulator = db.collection("simulator_members").doc(`${targetUserId}_${companyId}`);
    simulatorMembers.docs.filter(row => row.ref.path !== canonicalSimulator.path).forEach(row => tx.delete(row.ref));
    tx.delete(canonicalSimulator);
    // Keep a server-owned tombstone. No background projection or recovery may erase it.
    tx.set(accessRef(db, targetUserId, companyId), { userId: targetUserId, companyId, status: "removed", roles: [],
      schemaVersion: 1,
      // Do not move the original revocation boundary when completing old cleanup.
      revokedAt: target.revoked && target.authorization.revokedAt ? target.authorization.revokedAt : now,
      revokedBy: target.revoked && target.authorization.revokedBy ? target.authorization.revokedBy : context.auth!.uid,
      reason: target.revoked && target.authorization.reason ? target.authorization.reason : reason,
      updatedAt: now });
    for (const row of [...revokedApplications, ...revokedRequests]) tx.update(row.ref, {
      status: "rejected", isCurrent: false, accessRevokedAt: now, accessRevokedReason: "removed_from_fleet", updatedAt: now,
    });
    if (replacement) tx.update(target.companySnap.ref, { ownerId: replacement, userId: replacement, updatedAt: now });
    if (target.userSnap.exists) {
      const memberships = { ...(target.user.memberships || {}) }; delete memberships[companyId];
      const patch: Data = { memberships, updatedAt: now };
      if (target.user.companyId === companyId || target.user.empresaId === companyId) {
        Object.assign(patch, { companyId: null, empresaId: admin.firestore.FieldValue.delete(), status: "pending", role: "driver", roles: ["driver"] });
      }
      if (target.user.currentRecruitmentCompanyId === companyId) Object.assign(patch, {
        currentRecruitmentStatus: "rejected", currentRecruitmentCompanyId: admin.firestore.FieldValue.delete(),
        currentRecruitmentApplicationId: admin.firestore.FieldValue.delete(), currentRecruitmentSimulatorId: admin.firestore.FieldValue.delete(),
      });
      tx.update(target.userSnap.ref, patch);
    }
    tx.create(db.collection("audit_senior_employee_actions").doc(), { action: "remove_from_fleet", actorUid: context.auth!.uid,
      targetUserId, companyId, result: "completed", reason, createdAt: now });
    return { success: true, targetUserId, companyId, removed: true };
  });
}

/** Atomic approval or self-recovery of an approval issued by the server. */
export async function approveFleetMemberCore(db: FirebaseFirestore.Firestore, context: functions.https.CallableContext,
  input: { companyId?: string; applicationId?: string; requestId?: string; repair?: boolean }, receipt?: MembershipCommandReceipt) {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Faça login para continuar.");
  const documentId = id(input.applicationId || input.requestId, "Inscrição");
  const recruitment = Boolean(input.applicationId);
  const documentRef = db.collection(recruitment ? "recruitment_applications" : "solicitacoes_motoristas").doc(documentId);
  return runMembershipTransaction(db, receipt, async tx => {
    const snapshot = await tx.get(documentRef), application = snapshot.data() || {};
    if (!snapshot.exists || application.type === "company_registration") throw new functions.https.HttpsError("not-found", "Inscrição de motorista não encontrada.");
    const companyId = id(application.companyId || application.empresaId, "Empresa");
    if (input.companyId && companyId !== input.companyId) throw new functions.https.HttpsError("permission-denied", "Inscrição de outra empresa.");
    let uid = text(application.userId || application.motoristaId || application.driverId);
    if (!uid && text(application.email)) {
      const candidates = await tx.get(db.collection("users").where("email", "==", text(application.email).toLowerCase()).limit(2));
      if (candidates.size !== 1) throw new functions.https.HttpsError("failed-precondition", "O candidato precisa ter uma conta identificada para ser aprovado.");
      uid = candidates.docs[0].id;
    }
    id(uid, "Conta do motorista");
    // The actor and candidate are independent reads. Share the company read
    // and authorize in the same transaction, without a second network round.
    const companyRead = tx.get(db.collection("frotas").doc(companyId));
    const [target] = await Promise.all([
      readCompanyAccess(db, tx, uid, companyId, companyRead),
      input.repair ? Promise.resolve() : requireCompanyManager(db, tx, context, companyId, companyRead),
    ]);
    if (!target.userSnap.exists || !target.companySnap.exists || !companyUsable(target.company) || !accountUsable(target.user))
      throw new functions.https.HttpsError("failed-precondition", "Conta ou empresa indisponível.");
    const email = text(application.email).toLowerCase();
    if (email && text(target.user.email).toLowerCase() !== email)
      throw new functions.https.HttpsError("failed-precondition", "A conta e o e-mail da inscrição não correspondem.");
    if (input.repair) {
      if (uid !== context.auth!.uid || application.status !== "approved" || target.revoked ||
          (application.approvalAuthorityVersion !== 1 && !target.active))
        throw new functions.https.HttpsError("permission-denied", "A inscrição precisa ser confirmada novamente pelo gestor da empresa.");
    }
    if (application.status === WITHDRAWN)
      throw new functions.https.HttpsError("failed-precondition", "O candidato retirou esta inscrição. Peça uma nova inscrição.");
    if (application.isCurrent === false || application.accessRevokedAt || application.accessRevokedReason === "removed_from_fleet")
      throw new functions.https.HttpsError("failed-precondition", "Inscrição revogada. Envie uma nova solicitação.");
    if (recruitment && !input.repair) {
      // Supersession is per company: a newer application of the same candidate to the same company replaces this one.
      // Applications to other companies are independent and never affect it.
      const sameCompany = await tx.get(db.collection("recruitment_applications").where("userId", "==", uid));
      const newer = sameCompany.docs.find(row => row.id !== documentId && text(row.get("companyId")) === companyId &&
        row.get("type") !== "company_registration" && row.get("isCurrent") !== false &&
        ["pending", "approved"].includes(text(row.get("status"))) && millis(row.get("createdAt")) > millis(application.createdAt));
      if (newer) throw new functions.https.HttpsError("failed-precondition", "Esta inscrição foi substituída por uma inscrição mais recente.");
    }
    if (target.revoked && (input.repair || millis(application.createdAt) <= millis(target.authorization.revokedAt)))
      throw new functions.https.HttpsError("failed-precondition", "O vínculo foi removido. É necessária uma nova inscrição e aprovação.");
    if (!["pending", "rejected", "approved"].includes(application.status))
      throw new functions.https.HttpsError("failed-precondition", "Situação da inscrição inválida.");
    const roles = target.owner ? ["owner", "admin", "driver"] : [...new Set([...target.members.docs.flatMap(row => memberRoles(row.data())), "driver"])];
    const now = admin.firestore.FieldValue.serverTimestamp();
    const memberships = { ...(target.user.memberships || {}), [companyId]: { role: roles.includes("admin") ? "admin" : "driver", roles, status: "active" } };
    const profilePatch = recruitment ? recruitmentIdentityPatch(target.user, application, documentId, now) : {};
    tx.update(target.userSnap.ref, { companyId, status: "active", memberships, updatedAt: now, driverProfileEnabled: true,
      ...(recruitment ? profilePatch : {
        name: text(target.user.name) || text(application.fullName) || "Motorista",
        ...(!target.user.profilePhotoURL && application.applicationPhotoURL ? { profilePhotoURL: application.applicationPhotoURL } : {}),
      }),
      ...(recruitment ? { currentRecruitmentApplicationId: documentId, currentRecruitmentCompanyId: companyId,
        currentRecruitmentStatus: "approved", currentRecruitmentType: "driver_application" } : {}),
    });
    // One physical canonical row; historical duplicate rows cannot keep a stale role alive.
    const canonicalRef = db.collection("companyMembers").doc(`${uid}_${companyId}`);
    target.members.docs.filter(row => row.ref.path !== canonicalRef.path).forEach(row => tx.delete(row.ref));
    tx.set(canonicalRef, { userId: uid, companyId, roles, status: "active", permissions: [],
      joinedAt: target.members.docs[0]?.get("joinedAt") || now, updatedAt: now });
    tx.set(db.collection("simulator_members").doc(`${uid}_${companyId}`), { userId: uid, companyId, roles,
      role: roles.includes("admin") ? "admin" : "driver", simulatorId: target.company.simulatorId || target.company.simuladorId || "default", status: "active", isEligible: true });
    tx.set(accessRef(db, uid, companyId), activeAccessData(uid, companyId, roles));
    if (application.status !== "approved") tx.set(db.collection("notifications").doc(`MEMBERSHIP_APPROVED_${documentId}`), {
      userId: uid, actorUserId: context.auth!.uid, companyId, targetProfile: "driver", type: "RECRUITMENT_APPROVED",
      title: "Solicitação aprovada", message: `Sua solicitação para a empresa ${target.company.companyName || ""} foi aprovada!`,
      read: false, createdAt: now, dedupeKey: `MEMBERSHIP_APPROVED_${documentId}`,
    });
    tx.update(documentRef, { userId: uid, status: "approved", isCurrent: true, approvalAuthorityVersion: 1,
      approvedBy: input.repair ? application.approvedBy || context.auth!.uid : context.auth!.uid,
      approvedAt: application.approvedAt || now, updatedAt: now });
    return { success: true, userId: uid, companyId, roles,
      displayProfile: { ...driverDisplayIdentity({ ...target.user, ...profilePatch }),
        ...Object.fromEntries(["approvedIdentityApplicationId", "approvedIdentityName", "approvedIdentityPhotoURL", "approvedIdentityVersion", "profileNameSource", "profilePhotoSource"]
          .map(key => [key, ({ ...target.user, ...profilePatch } as Data)[key]])
          .filter(([, value]) => value !== undefined)),
        email: text(target.user.email), whatsapp: text(application.whatsapp || target.user.whatsapp) },
      ...(recruitment ? { applicationId: documentId } : { requestId: documentId }) };
  });
}

export async function executeFleetMembershipCommand(db: FirebaseFirestore.Firestore, input: any, context: functions.https.CallableContext) {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Faça login para continuar.");
  const receipt = membershipCommandReceipt(db, { ...input, diagnosticId: input?.diagnosticId || randomUUID() }, context.auth.uid);
  if (input?.action === "command-status") return readMembershipCommandStatus(db, receipt);
  if (input?.action === "set-role") {
    const companyId = id(input.companyId, "Empresa"), uid = id(input.targetUserId, "Motorista");
    if (!["admin", "driver"].includes(input.role)) throw new functions.https.HttpsError("invalid-argument", "Papel inválido.");
    return runMembershipTransaction(db, receipt, async tx => {
      await requireCompanyManager(db, tx, context, companyId);
      const target = await readCompanyAccess(db, tx, uid, companyId);
      if (!target.active) throw new functions.https.HttpsError("failed-precondition", "O vínculo do motorista não está ativo.");
      if (target.owner && input.role === "driver") throw new functions.https.HttpsError("failed-precondition", "Transfira a propriedade antes de retirar a administração do responsável.");
      const roles = target.owner ? ["owner", "admin", "driver"] : input.role === "admin" ? ["admin", "driver"] : ["driver"];
      const canonical = db.doc(`companyMembers/${uid}_${companyId}`), now = admin.firestore.FieldValue.serverTimestamp();
      target.members.docs.filter(row => row.ref.path !== canonical.path).forEach(row => tx.delete(row.ref));
      tx.set(canonical, {userId:uid,companyId,status:"active",roles,permissions:[],
        joinedAt:target.members.docs[0]?.get("joinedAt") || now,updatedAt:now});
      tx.set(db.doc(`simulator_members/${uid}_${companyId}`), {userId:uid,companyId,status:"active",roles,
        role:input.role,simulatorId:target.company.simulatorId || "default",isEligible:true});
      tx.set(accessRef(db,uid,companyId),activeAccessData(uid,companyId,roles));
      tx.update(target.userSnap.ref,{memberships:{...(target.user.memberships || {}),[companyId]:{roles,role:input.role,status:"active"}},
        ...(target.user.companyId === companyId ? {roles,role:input.role} : {}),updatedAt:now});
      tx.set(db.collection("audit_senior_employee_actions").doc(),{action:"set_fleet_role",actorUid:context.auth!.uid,
        targetUserId:uid,companyId,roles,createdAt:now});
      return {success:true,companyId,userId:uid,roles};
    });
  }
  if (input?.action === "capabilities") return membershipCapabilities();
  if (input?.action === "withdraw-application") return withdrawApplicationCore(db, context, { companyId: input.companyId, applicationId: input.applicationId }, receipt);
  if (input?.action === "leave" || input?.action === "leave-preview") {
    // The departing account is always the caller; a supplied target can only repeat it.
    if (text(input.targetUserId) && text(input.targetUserId) !== context.auth.uid)
      throw new functions.https.HttpsError("permission-denied", "A saída só pode ser feita pela própria conta.");
    return input.action === "leave" ? leaveFleetMemberCore(db, context, id(input.companyId, "Empresa"), receipt)
      : previewLeaveFleetMember(db, context, id(input.companyId, "Empresa"));
  }
  if (input?.action === "remove") return removeFleetMemberCore(db, context, id(input.targetUserId, "Motorista"), id(input.companyId, "Empresa"), text(input.reason) || "removed_from_fleet", receipt);
  if (input?.action === "approve-application") return approveFleetMemberCore(db, context, { companyId: id(input.companyId, "Empresa"), applicationId: id(input.applicationId, "Inscrição") }, receipt);
  if (input?.action === "approve-request") return approveFleetMemberCore(db, context, { companyId: id(input.companyId, "Empresa"), requestId: id(input.requestId, "Solicitação") }, receipt);
  throw new functions.https.HttpsError("invalid-argument", "Ação de vínculo inválida.");
}

/** Keep domain refusals distinct from infrastructure failures. A reference
 * joins the user's error to server logs without exposing database details. */
let firstFleetInvocation = true;
export const manageFleetMembership = functions.region("us-central1").runWith({ ingressSettings: "ALLOW_ALL" }).https.onCall(async (input, context) => {
  const startedAt = Date.now(), coldStart = firstFleetInvocation;
  firstFleetInvocation = false;
  const suppliedId = text(input?.diagnosticId);
  const diagnosticId = /^[a-zA-Z0-9_-]{8,80}$/.test(suppliedId) ? suppliedId : randomUUID();
  try {
    const result = await executeFleetMembershipCommand(admin.firestore(), { ...input, diagnosticId }, context);
    functions.logger.info("fleet_membership_completed", { diagnosticId, action: text(input?.action),
      durationMs: Date.now() - startedAt, coldStart });
    return result;
  }
  catch (error) {
    if (error instanceof functions.https.HttpsError) {
      const details = error.details && typeof error.details === "object" && !Array.isArray(error.details)
        ? { ...(error.details as Record<string, unknown>) } : {};
      details.diagnosticId ||= diagnosticId;
      details.reasonCode ||= `MEMBERSHIP_${String(error.code).toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
      const message = String(error.message || "");
      throw new functions.https.HttpsError(error.code, message.includes(diagnosticId)
        ? message : `${message} Referência: ${diagnosticId}`, details);
    }
    const cause = error as { code?: unknown; message?: unknown; stack?: unknown };
    const code = String(cause?.code || "unknown").toLowerCase();
    functions.logger.error("fleet_membership_failed", { diagnosticId, action: text(input?.action),
      companyId: text(input?.companyId), targetUserId: text(input?.targetUserId),
      actorUid: context.auth?.uid || null, code, message: String(cause?.message || error), stack: cause?.stack || null });
    if (["4", "10", "14", "deadline-exceeded", "aborted", "unavailable"].includes(code))
      throw new functions.https.HttpsError("unavailable", `A conexão com o servidor foi interrompida. Tente novamente. Referência: ${diagnosticId}`,
        { diagnosticId, reasonCode: "MEMBERSHIP_SERVER_UNAVAILABLE", retryable: true });
    if (["9", "failed-precondition"].includes(code))
      throw new functions.https.HttpsError("failed-precondition", `O servidor precisa concluir a configuração das consultas de vínculo. Referência: ${diagnosticId}`,
        { diagnosticId, reasonCode: "MEMBERSHIP_QUERY_NOT_READY", retryable: false });
    throw new functions.https.HttpsError("internal", `O servidor não confirmou a alteração do vínculo. Consulte o estado da frota e tente novamente. Referência: ${diagnosticId}`,
      { diagnosticId, reasonCode: "MEMBERSHIP_SERVER_FAILURE", retryable: false });
  }
});
