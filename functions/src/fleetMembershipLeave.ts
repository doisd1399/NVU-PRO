import * as admin from "./firebaseAdmin";
import * as functions from "firebase-functions/v1";
import { accessRef, accountUsable, readCompanyAccess } from "./companyAccess";
import { runMembershipTransaction, type MembershipCommandReceipt } from "./membershipCommandReceipt";
import { operationalDriverStateId } from "./operationalCommands";

type Data = FirebaseFirestore.DocumentData;
type Tx = FirebaseFirestore.Transaction;
type DB = FirebaseFirestore.Firestore;
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const field = (data: Data, ...keys: string[]) => keys.map(key => text(data[key])).find(Boolean) || "";
const safeId = (value: unknown, label: string) => {
  const result = text(value);
  if (!result || result.length > 180 || /[\/\0]/.test(result) || [".", ".."].includes(result))
    throw new functions.https.HttpsError("invalid-argument", `${label} inválido.`);
  return result;
};
const refuse = (code: functions.https.FunctionsErrorCode, message: string, reasonCode: string, details: Data = {}) =>
  new functions.https.HttpsError(code, message, { reasonCode, retryable: false, ...details });

/** Jobs that the departure closes by itself. Anything already running to completion must be finalized first. */
const CANCELLABLE = ["pending", "active", "delayed"];
const BLOCKING = ["awaiting_completion"];
const OPEN = [...CANCELLABLE, ...BLOCKING];
/** The transaction reads two assets per job and has to stay far below the 500-write limit. */
const MAX_JOBS = 25;
const MAX_RECORDS = 200;
export const LEAVE_PROTOCOL_VERSION = 1;

/** Every read the departure needs. Pure reads: the preview and the command share it, so they cannot disagree. */
async function readLeaveState(db: DB, tx: Tx, uid: string, companyId: string) {
  const target = await readCompanyAccess(db, tx, uid, companyId);
  const email = text(target.user.email).toLowerCase();
  const emails = [...new Set([text(target.user.email), email].filter(Boolean))];
  const jobs = db.collection("trabalhos");
  const [canonical, legacy, applicationQueries, requestQueries, simulatorMembers, driverState] = await Promise.all([
    tx.get(jobs.where("companyId", "==", companyId).where("driverId", "==", uid).where("status", "in", OPEN)),
    // Equality-only legacy alias; status is filtered here so no new index is required.
    tx.get(jobs.where("companyId", "==", companyId).where("motoristaId", "==", uid).limit(MAX_RECORDS + 1)),
    Promise.all([tx.get(db.collection("recruitment_applications").where("userId", "==", uid)),
      ...emails.map(value => tx.get(db.collection("recruitment_applications").where("email", "==", value)))]),
    Promise.all([tx.get(db.collection("solicitacoes_motoristas").where("motoristaId", "==", uid)),
      tx.get(db.collection("solicitacoes_motoristas").where("driverId", "==", uid))]),
    tx.get(db.collection("simulator_members").where("userId", "==", uid).where("companyId", "==", companyId)),
    tx.get(db.collection("operationalDriverStates").doc(operationalDriverStateId(companyId, uid))),
  ]);
  if (legacy.size > MAX_RECORDS) throw refuse("failed-precondition", "O histórico deste vínculo requer manutenção administrativa antes da saída.", "LEAVE_NEEDS_MAINTENANCE");
  const openJobs = [...new Map([...canonical.docs, ...legacy.docs].filter(row =>
    OPEN.includes(text(row.get("status"))) && row.get("deleted") !== true && field(row.data(), "companyId", "empresaId") === companyId)
    .map(row => [row.id, row])).values()];
  const cancellable = openJobs.filter(row => CANCELLABLE.includes(text(row.get("status"))));
  const blocking = openJobs.filter(row => BLOCKING.includes(text(row.get("status"))));
  const applications = [...new Map(applicationQueries.flatMap(snapshot => snapshot.docs)
    .filter(row => row.get("companyId") === companyId && row.get("type") !== "company_registration" &&
      (row.get("userId") === uid || Boolean(email && text(row.get("email")).toLowerCase() === email))).map(row => [row.id, row])).values()];
  const requests = [...new Map(requestQueries.flatMap(snapshot => snapshot.docs)
    .filter(row => row.get("empresaId") === companyId && (row.get("motoristaId") === uid || row.get("driverId") === uid)).map(row => [row.id, row])).values()];
  return { target, cancellable, blocking, applications, requests, simulatorMembers, driverState };
}

function assertCanLeave(state: Awaited<ReturnType<typeof readLeaveState>>) {
  const { target } = state;
  if (!target.userSnap.exists || !target.companySnap.exists) throw refuse("not-found", "Empresa ou conta não encontrada.", "LEAVE_NOT_FOUND");
  // A suspended account keeps every restriction; leaving must never be a way around one.
  if (!accountUsable(target.user)) throw refuse("permission-denied", "Conta suspensa ou indisponível.", "LEAVE_ACCOUNT_UNAVAILABLE");
  if (target.owner) throw refuse("failed-precondition", "Transfira a propriedade da empresa antes de sair dela.", "LEAVE_OWNER");
  if (state.blocking.length) throw refuse("failed-precondition",
    state.blocking.length === 1 ? "Finalize a operação que aguarda conclusão antes de sair da empresa."
      : `Finalize as ${state.blocking.length} operações que aguardam conclusão antes de sair da empresa.`,
    "LEAVE_AWAITING_COMPLETION", { awaitingCompletion: state.blocking.length });
  if (state.cancellable.length > MAX_JOBS) throw refuse("failed-precondition", "Há trabalhos demais para encerrar de uma vez. Peça à gestão para cancelá-los.", "LEAVE_TOO_MANY_JOBS");
}

const alreadyLeft = (state: Awaited<ReturnType<typeof readLeaveState>>, companyId: string) => {
  const { target } = state;
  const memberships = target.user.memberships || {};
  const stale = Object.prototype.hasOwnProperty.call(memberships, companyId) || target.user.companyId === companyId || target.user.empresaId === companyId;
  return target.revoked && target.members.empty && state.simulatorMembers.empty && !stale && state.cancellable.length === 0 && state.blocking.length === 0;
};

/** Read-only summary used by the confirmation dialog. Writes nothing. */
export async function previewLeaveFleetMember(db: DB, context: functions.https.CallableContext, companyId: string) {
  const uid = safeId(context.auth?.uid, "Conta");
  const id = safeId(companyId, "Empresa");
  return db.runTransaction(async tx => {
    const state = await readLeaveState(db, tx, uid, id);
    if (!state.target.active && !state.target.revoked) {
      if (!state.target.userSnap.exists || !accountUsable(state.target.user)) assertCanLeave(state);
      throw refuse("failed-precondition", "Você não possui vínculo ativo com esta empresa.", "LEAVE_NOT_LINKED");
    }
    if (alreadyLeft(state, id)) return { success: true, preview: true, companyId: id, alreadyLeft: true, canLeave: true, jobsToCancel: 0, awaitingCompletion: 0, protocolVersion: LEAVE_PROTOCOL_VERSION };
    let blocker = "";
    try { assertCanLeave(state); } catch (error) {
      if (!(error instanceof functions.https.HttpsError)) throw error;
      blocker = String((error.details as Data | undefined)?.reasonCode || "LEAVE_BLOCKED");
    }
    return {
      success: true, preview: true, companyId: id, canLeave: !blocker, blocker: blocker || null,
      companyName: text(state.target.company.companyName || state.target.company.name || state.target.company.fleetName),
      jobsToCancel: state.cancellable.length, awaitingCompletion: state.blocking.length,
      jobs: state.cancellable.slice(0, 10).map(row => ({ id: row.id, status: text(row.get("status")),
        name: text(row.get("contractNameSnapshot") || row.get("contractName") || row.get("contractSnapshot")?.name) })),
      protocolVersion: LEAVE_PROTOCOL_VERSION,
    };
  });
}

/**
 * Voluntary departure of the signed-in driver from one company. The target is always the caller. One transaction ends
 * the access, cancels the open jobs (never completes them), releases vehicle and trailer that no other running job is
 * using, clears the driver state and closes the applications of this company. Other companies are left untouched.
 */
export async function leaveFleetMemberCore(db: DB, context: functions.https.CallableContext, companyIdInput: string, receipt?: MembershipCommandReceipt) {
  const uid = safeId(context.auth?.uid, "Conta");
  const companyId = safeId(companyIdInput, "Empresa");
  const outcome = await runMembershipTransaction(db, receipt, async tx => {
    const state = await readLeaveState(db, tx, uid, companyId);
    const { target } = state;
    if (!target.active && !target.revoked) {
      if (!target.userSnap.exists || !accountUsable(target.user)) assertCanLeave(state);
      throw refuse("failed-precondition", "Você não possui vínculo ativo com esta empresa.", "LEAVE_NOT_LINKED");
    }
    if (alreadyLeft(state, companyId)) return { success: true, companyId, userId: uid, left: true, cancelledJobs: 0, cancelledJobIds: [] as string[] };
    assertCanLeave(state);

    // Resources of the jobs being closed, and who else still uses them. All reads happen before the first write.
    const closing = new Set(state.cancellable.map(row => row.id));
    const resources = new Map<string, { collection: string; id: string; key: string }>();
    for (const row of state.cancellable) {
      const data = row.data();
      const vehicle = field(data, "vehicleId", "veiculoId"), trailer = field(data, "trailerId", "reboqueId");
      if (vehicle) resources.set(`veiculos/${vehicle}`, { collection: "veiculos", id: safeId(vehicle, "Veículo"), key: "vehicleId" });
      if (trailer) resources.set(`reboques/${trailer}`, { collection: "reboques", id: safeId(trailer, "Reboque"), key: "trailerId" });
    }
    const usage = await Promise.all([...resources.values()].map(async resource => {
      const [asset, others] = await Promise.all([tx.get(db.collection(resource.collection).doc(resource.id)),
        tx.get(db.collection("trabalhos").where("companyId", "==", companyId).where(resource.key, "==", resource.id).where("status", "in", ["active", "delayed", "awaiting_completion"]))]);
      return { asset, shared: others.docs.some(row => !closing.has(row.id) && row.get("deleted") !== true) };
    }));

    const records = state.applications.filter(row => row.get("accessRevokedReason") !== "left_company" || row.get("isCurrent") !== false);
    const requests = state.requests.filter(row => row.get("accessRevokedReason") !== "left_company" || row.get("isCurrent") !== false);
    if (target.members.docs.length + state.simulatorMembers.docs.length + records.length + requests.length + state.cancellable.length * 3 > 400)
      throw refuse("failed-precondition", "O vínculo requer manutenção administrativa antes da saída.", "LEAVE_NEEDS_MAINTENANCE");

    const now = admin.firestore.FieldValue.serverTimestamp(), iso = new Date().toISOString();
    for (const row of state.cancellable) tx.update(row.ref, { status: "cancelled", cancelledAt: row.get("cancelledAt") || iso, cancelledBy: uid,
      cancelReason: "driver_left_company", operationalRevision: Number(row.get("operationalRevision") || 0) + 1 });
    if (state.driverState.exists && closing.has(text(state.driverState.get("currentJobId"))))
      tx.set(state.driverState.ref, { currentJobId: null, updatedAt: now }, { merge: true });
    usage.forEach(({ asset, shared }) => {
      if (asset.exists && asset.get("companyId") === companyId && asset.get("status") === "in_use" && !shared) tx.update(asset.ref, { status: "available" });
    });

    target.members.docs.forEach(row => tx.delete(row.ref));
    const canonicalSimulator = db.collection("simulator_members").doc(`${uid}_${companyId}`);
    state.simulatorMembers.docs.filter(row => row.ref.path !== canonicalSimulator.path).forEach(row => tx.delete(row.ref));
    tx.delete(canonicalSimulator);
    // Same server-owned barrier a removal leaves: a late event or an old approval cannot bring the access back.
    tx.set(accessRef(db, uid, companyId), { userId: uid, companyId, status: "removed", roles: [], schemaVersion: 1,
      revokedAt: target.revoked && target.authorization.revokedAt ? target.authorization.revokedAt : now,
      revokedBy: uid, reason: "left_company", updatedAt: now });
    for (const row of [...records, ...requests]) tx.update(row.ref, {
      // An approved application stays approved as history; only its power to grant access ends.
      ...(row.get("status") === "approved" ? {} : { status: "rejected" }),
      isCurrent: false, accessRevokedAt: now, accessRevokedReason: "left_company", updatedAt: now });

    // The user document keeps status, moderation and every other link. Only this company's traces are removed.
    const memberships = { ...(target.user.memberships || {}) }; delete memberships[companyId];
    const patch: Data = { memberships, updatedAt: now, driverProfileEnabled: true };
    if (target.user.companyId === companyId || target.user.empresaId === companyId) {
      Object.assign(patch, { companyId: null, empresaId: admin.firestore.FieldValue.delete() });
      const strip = (list: unknown) => (Array.isArray(list) ? list : []).filter(role => role !== "admin" && role !== "owner");
      if (["admin", "owner"].includes(text(target.user.role)) || (Array.isArray(target.user.roles) && target.user.roles.some((role: string) => role === "admin" || role === "owner")))
        Object.assign(patch, { role: "driver", roles: strip(target.user.roles).length ? strip(target.user.roles) : ["driver"] });
    }
    if (target.user.currentRecruitmentCompanyId === companyId) Object.assign(patch, {
      currentRecruitmentStatus: admin.firestore.FieldValue.delete(), currentRecruitmentCompanyId: admin.firestore.FieldValue.delete(),
      currentRecruitmentApplicationId: admin.firestore.FieldValue.delete(), currentRecruitmentSimulatorId: admin.firestore.FieldValue.delete(),
      currentRecruitmentType: admin.firestore.FieldValue.delete(),
    });
    tx.update(target.userSnap.ref, patch);
    tx.create(db.collection("audit_senior_employee_actions").doc(), { action: "leave_fleet", actorUid: uid, targetUserId: uid, companyId,
      result: "completed", reason: "left_company", cancelledJobIds: state.cancellable.map(row => row.id), createdAt: now });
    return { success: true, companyId, userId: uid, left: true, cancelledJobs: state.cancellable.length,
      cancelledJobIds: state.cancellable.map(row => row.id), driverName: text(target.user.name || target.user.displayName) };
  });
  await notifyManagement(db, uid, companyId, outcome, receipt?.commandId);
  return outcome;
}

/**
 * Best effort and outside the departure transaction, so a large fleet cannot make the exit fail or slow it down.
 * The dedupe key makes a repeated delivery a no-op.
 */
async function notifyManagement(db: DB, uid: string, companyId: string, outcome: Data, commandId?: string) {
  if (!outcome.left || outcome.driverName === undefined || !commandId) return;
  try {
    const [company, members] = await Promise.all([db.collection("frotas").doc(companyId).get(),
      db.collection("companyMembers").where("companyId", "==", companyId).get()]);
    const recipients = new Set<string>();
    for (const key of ["ownerId", "userId"]) { const value = text((company.data() || {})[key]); if (value && value !== uid) recipients.add(value); }
    for (const member of members.docs) {
      const data = member.data(), recipient = text(data.userId);
      if (recipient && recipient !== uid && (data.status == null || data.status === "active") && Array.isArray(data.roles) && data.roles.includes("admin")) recipients.add(recipient);
    }
    const jobs = Number(outcome.cancelledJobs || 0);
    const name = text(outcome.driverName) || "Um motorista";
    const message = `${name} saiu da empresa${jobs ? `; ${jobs === 1 ? "1 trabalho foi cancelado" : `${jobs} trabalhos foram cancelados`}` : ""}.`;
    const now = admin.firestore.FieldValue.serverTimestamp();
    await Promise.all([...recipients].slice(0, 100).map(async recipient => {
      const dedupeKey = `DRIVER_LEFT_COMPANY_${commandId}_${recipient}`;
      try {
        await db.collection("notifications").doc(dedupeKey).create({ userId: recipient, companyId, actorUserId: uid, targetProfile: "corporate",
          type: "DRIVER_LEFT_COMPANY", title: "Motorista saiu da empresa", message, titulo: "Motorista saiu da empresa", mensagem: message,
          tipo: "DRIVER_LEFT_COMPANY", metadata: { driverId: uid, cancelledJobIds: outcome.cancelledJobIds || [] },
          read: false, lida: false, dedupeKey, schemaVersion: 3, createdAt: now });
      } catch (error) {
        if ((error as { code?: unknown })?.code !== 6) throw error; // 6 = ALREADY_EXISTS: delivered before.
      }
    }));
  } catch (error) {
    functions.logger.warn("fleet_leave_notification_failed", { companyId, actorUid: uid, message: String((error as Error)?.message || error) });
  }
}
