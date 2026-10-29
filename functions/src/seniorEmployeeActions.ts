import { getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v1/https";
import { requireActiveSenior, submitAccountCommand } from "./seniorAccountCommands";
import { removeFleetMemberCore } from "./fleetMembership";

if (getApps().length === 0) initializeApp();
const db = getFirestore();

type RequestData = {
  targetUserId?: unknown;
  companyId?: unknown;
  originalActionId?: unknown;
  reason?: unknown;
  expiresAt?: unknown;
  confirmation?: unknown;
};
type Actor = { uid: string; senior: boolean };
type RecordLike = Record<string, any>;

const asRecord = (value: unknown): RecordLike => value && typeof value === "object" ? value as RecordLike : {};
const text = (value: unknown): string => String(value ?? "").trim();
const asNonEmptyString = (value: unknown, field: string): string => {
  const result = text(value);
  if (!result) throw new HttpsError("invalid-argument", `${field} é obrigatório.`);
  if (["targetUserId", "companyId", "originalActionId"].includes(field) && (result.length > 180 || /[\/\0]/.test(result) || [".", ".."].includes(result))) throw new HttpsError("invalid-argument", `${field} inválido.`);
  return result;
};
const optionalString = (value: unknown, field: string): string | undefined =>
  value === undefined || value === null || value === "" ? undefined : asNonEmptyString(value, field);
const getPayload = (data: unknown): RequestData => {
  if (!data || typeof data !== "object") throw new HttpsError("invalid-argument", "Payload inválido.");
  return data as RequestData;
};
const getActor = requireActiveSenior;
const requireTarget = (actor: Actor, targetUserId: string) => {
  if (actor.uid === targetUserId) throw new HttpsError("failed-precondition", "Não é permitido executar esta ação na própria conta.");
};
const getOwnerId = (company: RecordLike): string => text(company.ownerId || company.userId);
const getRoles = (member: RecordLike): string[] => {
  const values = [member.role, ...(Array.isArray(member.roles) ? member.roles : [])].map(text).filter(Boolean);
  return Array.from(new Set(values));
};

/**
 * A target can be an employee member or the owner of the selected fleet. The
 * owner relationship is verified against the server fleet document rather
 * than trusting the member row sent by the client.
 */
const requireTargetContext = async (targetUserId: string, companyId: string) => {
  const [membershipQuery, companySnap] = await Promise.all([
    db.collection("companyMembers").where("userId", "==", targetUserId).where("companyId", "==", companyId).limit(20).get(),
    db.doc(`frotas/${companyId}`).get(),
  ]);
  if (!companySnap.exists) throw new HttpsError("not-found", "Frota não encontrada.");
  const company = companySnap.data() || {};
  const isOwner = getOwnerId(company) === targetUserId || membershipQuery.docs.some((doc) => getRoles(doc.data() || {}).includes("owner"));
  if (membershipQuery.empty && !isOwner) {
    throw new HttpsError("failed-precondition", "O usuário alvo não pertence à frota selecionada.");
  }
  return { membershipQuery, company, isOwner };
};

const parseDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (typeof (value as any)?.toDate === "function") return (value as any).toDate();
  if (typeof (value as any)?.seconds === "number") return new Date(Number((value as any).seconds) * 1000);
  const date = new Date(value as any);
  return Number.isNaN(date.getTime()) ? null : date;
};
/** Expiration is owned by the independent command worker, never by a list read. */
const normalizeExpiredSuspension = async (_id: string, user: RecordLike, _actor: string, _company?: string) => user;

export const removeDriverFromFleetSenior = onCall(async (data, context) => {
  await getActor(context);
  const payload = getPayload(data);
  return removeFleetMemberCore(db, context, asNonEmptyString(payload.targetUserId, "targetUserId"),
    asNonEmptyString(payload.companyId, "companyId"), optionalString(payload.reason, "reason") || "removed_from_fleet");
});

export const suspendSeniorAccount = onCall(async (data, context) => {
  const actor = await getActor(context), payload = getPayload(data);
  const targetUserId = asNonEmptyString(payload.targetUserId, "targetUserId"), companyId = asNonEmptyString(payload.companyId, "companyId");
  const reason = asNonEmptyString(payload.reason, "reason"), expiresAt = optionalString(payload.expiresAt, "expiresAt");
  if (expiresAt && (!parseDate(expiresAt) || parseDate(expiresAt)!.getTime() <= Date.now())) throw new HttpsError("invalid-argument", "Prazo da suspensão inválido.");
  requireTarget(actor, targetUserId); await requireTargetContext(targetUserId, companyId);
  return submitAccountCommand({ action: "SUSPEND_ACCOUNT", actorUid: actor.uid, targetUserId, companyId, reason, disabled: true,
    buildPatch: (target, actionId) => {
      if (target.deleted || target.accountStatus === "deleted") throw new HttpsError("failed-precondition", "Perfil excluído.");
      return { accountStatus: "suspended", suspension: { active: true, actionId, actionType: "SUSPEND_ACCOUNT", source: "senior_panel", companyId, reason,
        expiresAt: expiresAt || null, suspendedAt: new Date().toISOString(), suspendedBy: actor.uid } };
    } });
});

export const reactivateSeniorAccount = onCall(async (data, context) => {
  const actor = await getActor(context), payload = getPayload(data), targetUserId = asNonEmptyString(payload.targetUserId, "targetUserId");
  requireTarget(actor, targetUserId);
  // Global Senior account action. A removed fleet membership is never restored.
  return submitAccountCommand({ action: "reactivate_account", actorUid: actor.uid, targetUserId, companyId: text(payload.companyId), disabled: false,
    buildPatch: target => {
      if (target.deleted || target.accountStatus === "deleted") throw new HttpsError("failed-precondition", "Perfil excluído exige restauração explícita.");
      if (["blocked", "disabled", "inactive"].includes(String(target.status || "").toLowerCase())) throw new HttpsError("failed-precondition", "A conta possui outro bloqueio administrativo.");
      return { accountStatus: "active", ...(target.status === "suspended" ? { status: target.companyId ? "active" : "pending" } : {}), suspension: { ...asRecord(target.suspension), active: false, reactivatedAt: new Date().toISOString(), reactivatedBy: actor.uid } };
    } });
});

export const deleteSeniorProfile = onCall(async (data, context) => {
  const actor = await getActor(context), payload = getPayload(data), targetUserId = asNonEmptyString(payload.targetUserId, "targetUserId"), companyId = asNonEmptyString(payload.companyId, "companyId");
  if (payload.confirmation !== true) throw new HttpsError("failed-precondition", "A confirmação visual da exclusão é obrigatória.");
  const reason = asNonEmptyString(payload.reason, "reason"); requireTarget(actor, targetUserId); await requireTargetContext(targetUserId, companyId);
  return submitAccountCommand({ action: "delete_profile_soft", actorUid: actor.uid, targetUserId, companyId, reason, disabled: true,
    buildPatch: () => ({ accountStatus: "deleted", deleted: true, deletedAt: new Date().toISOString(), deletedBy: actor.uid, deletionReason: reason }) });
});

export const endSeniorOperationalSuspension = onCall(async (data, context) => {
  const actor = await getActor(context);
  const payload = getPayload(data);
  const targetUserId = asNonEmptyString(payload.targetUserId, "targetUserId");
  const companyId = asNonEmptyString(payload.companyId, "companyId");
  requireTarget(actor, targetUserId);
  await requireTargetContext(targetUserId, companyId);

  const targetRef = db.doc(`users/${targetUserId}`);
  const actionRef = db.collection("audit_senior_employee_actions").doc();
  let previousState: RecordLike = {};

  await db.runTransaction(async (transaction) => {
    const targetSnapshot = await transaction.get(targetRef);
    if (!targetSnapshot.exists) {
      throw new HttpsError("not-found", "Perfil do usuário não encontrado.");
    }

    const target = targetSnapshot.data() || {};
    const operational = asRecord(target.operationalSuspension);
    const operationalCompanyId = text(operational.companyId);
    const endsAt = parseDate(target.operationalSuspendedUntil ?? operational.endsAt);
    const active = Boolean(endsAt && endsAt.getTime() > Date.now());

    if (!active || (operationalCompanyId && operationalCompanyId !== companyId)) {
      throw new HttpsError("failed-precondition", "Não existe suspensão operacional ativa para este usuário nesta frota.");
    }

    previousState = {
      operationalSuspendedAt: target.operationalSuspendedAt ?? null,
      operationalSuspendedUntil: target.operationalSuspendedUntil ?? null,
      operationalSuspensionDurationHours: target.operationalSuspensionDurationHours ?? null,
      operationalSuspensionReasons: target.operationalSuspensionReasons ?? null,
      operationalSuspensionMessage: target.operationalSuspensionMessage ?? null,
      operationalSuspension: operational,
    };

    const endedAt = Timestamp.now();
    transaction.set(targetRef, {
      operationalSuspendedUntil: endedAt,
      operationalSuspension: {
        ...operational,
        active: false,
        endsAt: endedAt,
        endedAt,
        endedBy: actor.uid,
        endActionId: actionRef.id,
      },
      isOnline: false,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.create(actionRef, { actionId: actionRef.id, action: "END_OPERATIONAL_SUSPENSION", actionType: "END_OPERATIONAL_SUSPENSION",
      actorUid: actor.uid, targetUserId, companyId, result: "completed", previousState,
      resultingState: { operationalSuspensionActive: false }, createdAt: FieldValue.serverTimestamp() });
  });



  return { success: true, action: "END_OPERATIONAL_SUSPENSION", actionId: actionRef.id };
});

export const reverseSeniorSuspension = onCall(async (data, context) => {
  const actor = await getActor(context), payload = getPayload(data), targetUserId = asNonEmptyString(payload.targetUserId, "targetUserId");
  requireTarget(actor, targetUserId);
  return submitAccountCommand({ action: "REVERSE_SUSPENSION", actorUid: actor.uid, targetUserId, companyId: text(payload.companyId), disabled: false,
    buildPatch: (target, actionId) => {
      const suspension = asRecord(target.suspension), requested = text(payload.originalActionId || suspension.actionId);
      if (target.deleted || target.accountStatus === "deleted" || !suspension.active || suspension.actionType !== "SUSPEND_ACCOUNT" || !requested || requested !== suspension.actionId)
        throw new HttpsError("failed-precondition", "Não existe esta suspensão reversível para o usuário.");
      return { accountStatus: "active", ...(target.status === "suspended" ? { status: target.companyId ? "active" : "pending" } : {}), suspension: { ...suspension, active: false, reversedAt: new Date().toISOString(), reversedBy: actor.uid, reversalActionId: actionId } };
    } });
});

export const listSeniorSuspendedMembers = onCall(async (_data, context) => {
  const actor = await getActor(context);
  const now = Date.now();
  const nowTimestamp = Timestamp.fromMillis(now);

  // There are two distinct suspension schemas in NVU:
  // 1) senior account suspension: accountStatus + suspension.active
  // 2) operational suspension: operationalSuspendedUntil / operationalSuspension.endsAt
  // The previous implementation queried only schema #1, so a driver blocked by
  // the moderation flow (schema #2) was invisible to this management view.
  const [accountSnapshot, operationalSnapshot, nestedOperationalSnapshot] = await Promise.all([
    db.collection("users").where("accountStatus", "==", "suspended").limit(500).get(),
    db.collection("users").where("operationalSuspendedUntil", ">", nowTimestamp).limit(500).get(),
    db.collection("users").where("operationalSuspension.endsAt", ">", nowTimestamp).limit(500).get(),
  ]);

  const userDocs = new Map<string, any>();
  for (const snapshot of [accountSnapshot, operationalSnapshot, nestedOperationalSnapshot]) {
    snapshot.docs.forEach((doc) => userDocs.set(doc.id, doc));
  }

  const result: RecordLike[] = [];
  for (const userDoc of userDocs.values()) {
    let user: RecordLike = { id: userDoc.id, ...(userDoc.data() || {}) };

    const memberships = await db.collection("companyMembers").where("userId", "==", userDoc.id).limit(50).get();
    const membershipRows: RecordLike[] = memberships.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
    const companies = new Map<string, RecordLike>();

    const membershipCompanyIds = Array.from(new Set(
      membershipRows.map((membership) => text(membership.companyId)).filter(Boolean),
    ));
    const membershipCompanySnapshots = await Promise.all(
      membershipCompanyIds.map((companyId) => db.doc(`frotas/${companyId}`).get()),
    );
    membershipCompanySnapshots.forEach((company, index) => {
      if (company.exists) {
        const companyId = membershipCompanyIds[index];
        companies.set(companyId, { id: companyId, ...(company.data() || {}) });
      }
    });

    const ownerCompanies = await db.collection("frotas").where("ownerId", "==", userDoc.id).limit(50).get();
    ownerCompanies.docs.forEach((doc) => companies.set(doc.id, { id: doc.id, ...(doc.data() || {}) }));

    const operational = asRecord(user.operationalSuspension);
    const operationalCompanyId = text(operational.companyId);
    if (operationalCompanyId && !companies.has(operationalCompanyId)) {
      const company = await db.doc(`frotas/${operationalCompanyId}`).get();
      if (company.exists) companies.set(operationalCompanyId, { id: operationalCompanyId, ...(company.data() || {}) });
    }

    user = await normalizeExpiredSuspension(
      userDoc.id,
      user,
      actor.uid,
      Array.from(companies.keys())[0],
    );

    const accountSuspension = asRecord(user.suspension);
    const accountActive = user.accountStatus === "suspended" && accountSuspension.active === true;
    const currentOperational = asRecord(user.operationalSuspension);
    const operationalEndsAt = parseDate(user.operationalSuspendedUntil ?? currentOperational.endsAt);
    const operationalStartsAt = parseDate(user.operationalSuspendedAt ?? currentOperational.startsAt);
    const operationalActive = Boolean(operationalEndsAt && operationalEndsAt.getTime() > now);

    if (!accountActive && !operationalActive) continue;

    const suspensionType: "account" | "operational" = accountActive ? "account" : "operational";
    const normalizedSuspension = suspensionType === "account"
      ? {
          active: true,
          type: "account",
          suspendedAt: accountSuspension.suspendedAt ?? null,
          expiresAt: accountSuspension.expiresAt ?? null,
          durationHours: accountSuspension.expiresAt && accountSuspension.suspendedAt
            ? Math.max(0, (parseDate(accountSuspension.expiresAt)?.getTime() || 0) - (parseDate(accountSuspension.suspendedAt)?.getTime() || 0)) / 3600000
            : null,
          reason: text(accountSuspension.reason),
          reasons: [],
          message: "",
          suspendedBy: text(accountSuspension.suspendedBy),
          actionId: text(accountSuspension.actionId),
          companyId: text(accountSuspension.companyId),
        }
      : {
          active: true,
          type: "operational",
          suspendedAt: operationalStartsAt,
          expiresAt: operationalEndsAt,
          durationHours: Number(currentOperational.durationHours ?? user.operationalSuspensionDurationHours) || null,
          reason: Array.isArray(currentOperational.reasons) ? currentOperational.reasons.join(", ") : text(user.operationalSuspensionReasons),
          reasons: Array.isArray(currentOperational.reasons)
            ? currentOperational.reasons.map((reason) => text(reason)).filter(Boolean)
            : Array.isArray(user.operationalSuspensionReasons)
              ? user.operationalSuspensionReasons.map((reason) => text(reason)).filter(Boolean)
              : [],
          message: text(currentOperational.message ?? user.operationalSuspensionMessage),
          suspendedBy: text(currentOperational.createdBy),
          actionId: text(currentOperational.endActionId),
          companyId: operationalCompanyId,
          tripId: text(currentOperational.tripId),
        };

    const targetCompanies = Array.from(companies.entries());
    if (targetCompanies.length === 0) {
      const fallbackCompanyId = text(normalizedSuspension.companyId);
      if (fallbackCompanyId) {
        result.push({
          user,
          userId: userDoc.id,
          companyId: fallbackCompanyId,
          companyName: fallbackCompanyId,
          company: {},
          membership: { userId: userDoc.id, companyId: fallbackCompanyId, role: "driver" },
          suspensionType,
          suspension: normalizedSuspension,
        });
      }
      continue;
    }

    for (const [companyId, company] of targetCompanies) {
      result.push({
        user,
        userId: userDoc.id,
        companyId,
        companyName: text(company.companyName || company.name || company.razaoSocial || companyId),
        company,
        membership: membershipRows.find((row) => text(row.companyId) === companyId) || {
          userId: userDoc.id,
          companyId,
          role: getOwnerId(company) === userDoc.id ? "owner" : "driver",
        },
        suspensionType,
        suspension: normalizedSuspension,
      });
    }
  }

  return { success: true, members: result, checkedAt: new Date(now).toISOString() };
});
