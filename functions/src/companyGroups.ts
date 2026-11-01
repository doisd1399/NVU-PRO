import * as admin from "./firebaseAdmin";
import * as functions from "firebase-functions/v1";
import { randomUUID } from "node:crypto";
import { hasSeniorClaim } from "./authorization";
import { accountUsable, companyOwner, companyUsable } from "./companyAccess";

/**
 * One company, several simulators. A company stays a single-simulator fleet document (`frotas/{id}`): every server rule
 * about operations, ranking and currency keys on that one simulator. A company "with several simulators" is a group of
 * such fleets that share `companyGroupId`, name, logo and owner; each simulator has its own fleet, drivers, operations
 * and ranking. This module creates the extra fleets and keeps the shared name in step. It never touches existing fleets
 * beyond giving the first one its `companyGroupId`.
 */
type Data = FirebaseFirestore.DocumentData;
type Tx = FirebaseFirestore.Transaction;
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const refuse = (code: functions.https.FunctionsErrorCode, message: string, reasonCode: string) =>
  new functions.https.HttpsError(code, message, { reasonCode, retryable: false });
const safeId = (value: unknown, label: string) => {
  const result = text(value);
  if (!result || result.length > 180 || /[\/\0]/.test(result) || [".", ".."].includes(result)) throw refuse("invalid-argument", `${label} inválido.`, "GROUP_INVALID_ID");
  return result;
};

/** Which actions this server understands. A client shows an option only after the server lists it. */
export const COMPANY_GROUP_CAPABILITIES = ["add-simulators", "rename", "deactivate-simulators"] as const;
export const companyGroupCapabilities = () => ({ success: true, capabilities: [...COMPANY_GROUP_CAPABILITIES], protocolVersion: 1 });

export const MAX_SIMULATORS_PER_REQUEST = 12;
export const MAX_COMPANY_NAME = 200;

// The same alias families the app uses to recognise a simulator ("gto" and "global-truck-online" are one simulator).
const ALIAS_GROUPS: readonly (readonly string[])[] = [
  ["gto", "global-truck-online", "global-truck"], ["wtds", "world-truck-driving-simulator"], ["wbds", "world-bus-driving-simulator"],
  ["toe-3", "toe3", "truckers-of-europe-3"], ["ets-2", "ets2", "euro-truck-simulator-2"], ["ats", "american-truck-simulator"],
  ["pbs", "proton-bus-simulator"],
];
export const simulatorKey = (value: unknown) => text(value).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
/** Every spelling that identifies the same simulator. */
export function simulatorAliases(...values: unknown[]): Set<string> {
  const keys = new Set(values.map(simulatorKey).filter(Boolean));
  for (const group of ALIAS_GROUPS) if (group.some(alias => keys.has(alias))) group.forEach(alias => keys.add(alias));
  return keys;
}
const companyAliases = (company: Data) => simulatorAliases(company.simulatorId, company.simulatorName, company.simulator);

export function cleanCompanyName(value: unknown): string {
  const name = text(value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!name) throw refuse("invalid-argument", "O nome da empresa é obrigatório.", "GROUP_NAME_REQUIRED");
  if (name.length > MAX_COMPANY_NAME) throw refuse("invalid-argument", `O nome da empresa pode ter até ${MAX_COMPANY_NAME} caracteres.`, "GROUP_NAME_TOO_LONG");
  return name;
}

type Actor = { uid: string; senior: boolean };
function actorOf(context: functions.https.CallableContext): Actor {
  const uid = text(context.auth?.uid);
  if (!uid) throw new functions.https.HttpsError("unauthenticated", "Autenticação obrigatória.");
  return { uid, senior: hasSeniorClaim(context) };
}

/** The source company and every other fleet of its group, read in the caller's transaction. */
async function readGroup(db: FirebaseFirestore.Firestore, tx: Tx, companyId: string) {
  const sourceRef = db.collection("frotas").doc(companyId), sourceSnap = await tx.get(sourceRef);
  if (!sourceSnap.exists) throw refuse("not-found", "Empresa não encontrada.", "GROUP_COMPANY_NOT_FOUND");
  const source: Data = sourceSnap.data() || {};
  const groupId = text(source.companyGroupId) || companyId;
  const members = await tx.get(db.collection("frotas").where("companyGroupId", "==", groupId));
  const fleets = new Map<string, { ref: FirebaseFirestore.DocumentReference; data: Data }>();
  fleets.set(companyId, { ref: sourceRef, data: source });
  members.docs.forEach(doc => fleets.set(doc.id, { ref: doc.ref, data: doc.data() || {} }));
  return { sourceRef, source, groupId, fleets };
}

async function assertAllowed(db: FirebaseFirestore.Firestore, tx: Tx, actor: Actor, source: Data) {
  if (!companyUsable(source)) throw refuse("failed-precondition", "A empresa não está disponível.", "GROUP_COMPANY_UNAVAILABLE");
  if (actor.senior) return;
  if (!companyOwner(source, actor.uid)) throw refuse("permission-denied", "Somente o proprietário da empresa pode fazer isso.", "GROUP_OWNER_ONLY");
  const user = await tx.get(db.collection("users").doc(actor.uid));
  if (!user.exists || !accountUsable(user.data() || {})) throw refuse("permission-denied", "Conta suspensa ou indisponível.", "GROUP_ACCOUNT_UNAVAILABLE");
}

/** What a new fleet of the group copies from the company: identity only, never operational state or settings. */
const IDENTITY_FIELDS = ["companyName", "ownerName", "email", "ownerEmail", "cnpj", "whatsapp", "logoUrl", "logoStoragePath", "ownerPhotoUrl", "ownerPhotoStoragePath"] as const;

export type AddSimulatorsResult = {
  success: true; groupId: string; companyId: string;
  created: Array<{ companyId: string; simulatorId: string; simulatorName: string }>;
  existing: Array<{ companyId: string; simulatorId: string; simulatorName: string }>;
  /** Simulators the company had switched off and that were switched back on (nothing was created: history and drivers return). */
  reactivated: Array<{ companyId: string; simulatorId: string; simulatorName: string }>;
  skipped: Array<{ simulatorId: string; reason: "already-in-group" | "unknown-simulator" | "inactive-simulator" }>;
};

/**
 * Adds one fleet per requested simulator to the company's group. Only the owner (or a Senior) can ask. A simulator that
 * the group already has is skipped; repeating the command after a lost answer returns the fleets it created before
 * (their ids are deterministic) instead of making copies.
 */
export async function addCompanySimulatorsCore(db: FirebaseFirestore.Firestore, context: functions.https.CallableContext,
  input: { companyId?: unknown; simulatorIds?: unknown; registrationId?: unknown }): Promise<AddSimulatorsResult> {
  const actor = actorOf(context), companyId = safeId(input.companyId, "Empresa");
  const requested = [...new Set((Array.isArray(input.simulatorIds) ? input.simulatorIds : []).map(text).filter(Boolean))];
  if (!requested.length) throw refuse("invalid-argument", "Escolha ao menos um simulador.", "GROUP_NO_SIMULATOR");
  if (requested.length > MAX_SIMULATORS_PER_REQUEST) throw refuse("invalid-argument", "Simuladores demais de uma vez.", "GROUP_TOO_MANY");
  requested.forEach(id => safeId(id, "Simulador"));
  const registrationId = text(input.registrationId);
  if (registrationId) safeId(registrationId, "Cadastro");

  return db.runTransaction(async tx => {
    const { sourceRef, source, groupId, fleets } = await readGroup(db, tx, companyId);
    await assertAllowed(db, tx, actor, source);
    const ownerId = text(source.ownerId) || text(source.userId);
    if (!ownerId) throw refuse("failed-precondition", "A empresa não tem proprietário definido.", "GROUP_NO_OWNER");

    // Reads first: the catalog entries, the deterministic ids of the new fleets and the owner's membership rows.
    const catalog = await Promise.all(requested.map(id => tx.get(db.collection("simulators").doc(id))));
    const usedAliases = new Set<string>();
    fleets.forEach(({ data }) => { if (companyUsable(data)) companyAliases(data).forEach(key => usedAliases.add(key)); });
    const plan: Array<{ id: string; name: string; aliases: Set<string>; ref: FirebaseFirestore.DocumentReference; memberRef: FirebaseFirestore.DocumentReference }> = [];
    const skipped: AddSimulatorsResult["skipped"] = [];
    const dormantBack: Array<{ ref: FirebaseFirestore.DocumentReference; id: string; name: string }> = [];
    const taken = new Set<string>();
    requested.forEach((id, index) => {
      const snap = catalog[index], entry: Data = snap.data() || {};
      if (!snap.exists) return void skipped.push({ simulatorId: id, reason: "unknown-simulator" });
      if (entry.active === false) return void skipped.push({ simulatorId: id, reason: "inactive-simulator" });
      const aliases = simulatorAliases(id, entry.name, entry.key, entry.code);
      if ([...aliases].some(key => usedAliases.has(key) || taken.has(key))) return void skipped.push({ simulatorId: id, reason: "already-in-group" });
      aliases.forEach(key => taken.add(key));
      // A simulator the company switched off before comes back as it was, instead of a second, empty fleet.
      const dormant = [...fleets.values()].find(fleet => fleet.data.deactivatedForSimulator === true && [...companyAliases(fleet.data)].some(alias => aliases.has(alias)));
      if (dormant) return void dormantBack.push({ ref: dormant.ref, id, name: text(dormant.data.simulatorName) || text(entry.name) || id });
      const key = simulatorKey(id) || simulatorKey(entry.name) || `sim${index}`;
      const ref = db.collection("frotas").doc(`${groupId}-${key}`.slice(0, 180));
      plan.push({ id, name: text(entry.name) || id, aliases, ref, memberRef: db.collection("companyMembers").doc(`${ref.id}_${ownerId}`) });
    });
    const existingFleets = await Promise.all(plan.map(item => tx.get(item.ref)));
    const existing: AddSimulatorsResult["existing"] = [], created: AddSimulatorsResult["created"] = [], reactivated: AddSimulatorsResult["reactivated"] = [];
    const now = admin.firestore.FieldValue.serverTimestamp(), isoNow = new Date().toISOString();
    const FieldValue = admin.firestore.FieldValue;
    dormantBack.forEach(item => {
      const identity = Object.fromEntries(IDENTITY_FIELDS.filter(field => source[field] !== undefined).map(field => [field, source[field]]));
      tx.update(item.ref, { ...identity, status: "active", deactivatedForSimulator: FieldValue.delete(), deactivatedAt: FieldValue.delete(), deactivatedBy: FieldValue.delete(),
        reactivatedAt: now, reactivatedBy: actor.uid });
      reactivated.push({ companyId: item.ref.id, simulatorId: item.id, simulatorName: item.name });
    });
    plan.forEach((item, index) => {
      const current = existingFleets[index];
      // A fleet of this group and simulator already exists (an earlier attempt whose answer was lost): report it.
      if (current.exists && companyUsable(current.data() || {})) return void existing.push({ companyId: item.ref.id, simulatorId: item.id, simulatorName: item.name });
      // An old fleet with that id was deleted: the new one takes a fresh id instead of reviving it.
      const ref = current.exists ? db.collection("frotas").doc() : item.ref;
      const memberRef = current.exists ? db.collection("companyMembers").doc(`${ref.id}_${ownerId}`) : item.memberRef;
      const identity = Object.fromEntries(IDENTITY_FIELDS.filter(field => source[field] !== undefined).map(field => [field, source[field]]));
      tx.set(ref, { ...identity, ownerId, userId: ownerId, simulatorId: item.id, simulatorName: item.name, status: "active",
        companyGroupId: groupId, sourceCompanyId: companyId, ...(registrationId ? { sourceRegistrationId: registrationId } : text(source.sourceRegistrationId) ? { sourceRegistrationId: text(source.sourceRegistrationId) } : {}),
        createdAt: isoNow, approvedAt: isoNow, addedBy: actor.uid, addedAt: now });
      tx.set(memberRef, { companyId: ref.id, userId: ownerId, roles: ["admin", "driver"], status: "active",
        permissions: ["admin", "owner", "manage_fleet", "all"], joinedAt: isoNow });
      tx.set(db.collection("simulator_members").doc(`${ownerId}_${ref.id}`), { userId: ownerId, companyId: ref.id, simulatorId: item.id,
        status: "active", role: "admin", roles: ["admin", "driver"], isEligible: true }, { merge: true });
      created.push({ companyId: ref.id, simulatorId: item.id, simulatorName: item.name });
    });
    // The first fleet becomes part of the group it started (nothing else changes in it).
    if (created.length && !text(source.companyGroupId)) tx.update(sourceRef, { companyGroupId: groupId });
    return { success: true as const, groupId, companyId, created, existing, reactivated, skipped };
  });
}

const CLOSED_JOB_STATUS = ["completed", "cancelled", "canceled", "closed", "deleted", "concluido", "concluida", "cancelado", "cancelada"];
export type DeactivateResult = { success: true; groupId: string; companyId: string;
  deactivated: Array<{ companyId: string; simulatorId: string; simulatorName: string }>; alreadyInactive: string[]; remaining: number };

/**
 * Switches simulators of the company off without deleting anything: the fleet is archived (the server already treats an
 * archived fleet as unavailable: no new operations, not listed, not ranked) and marked so that adding the simulator again
 * brings the same fleet back with its drivers, trips and history. The company always keeps at least one simulator, and a
 * simulator with an operation still open cannot be switched off.
 */
export async function deactivateCompanySimulatorsCore(db: FirebaseFirestore.Firestore, context: functions.https.CallableContext,
  input: { companyId?: unknown; companyIds?: unknown }): Promise<DeactivateResult> {
  const actor = actorOf(context), companyId = safeId(input.companyId, "Empresa");
  const targets = [...new Set((Array.isArray(input.companyIds) ? input.companyIds : []).map(text).filter(Boolean))];
  if (!targets.length) throw refuse("invalid-argument", "Escolha ao menos um simulador.", "GROUP_NO_SIMULATOR");
  if (targets.length > MAX_SIMULATORS_PER_REQUEST) throw refuse("invalid-argument", "Simuladores demais de uma vez.", "GROUP_TOO_MANY");
  targets.forEach(id => safeId(id, "Simulador"));
  return db.runTransaction(async tx => {
    const { source, groupId, fleets } = await readGroup(db, tx, companyId);
    await assertAllowed(db, tx, actor, source);
    const picked = targets.map(id => {
      const fleet = fleets.get(id);
      if (!fleet) throw refuse("invalid-argument", "Esse simulador não faz parte da empresa.", "GROUP_NOT_IN_GROUP");
      return { id, ...fleet };
    });
    const alreadyInactive = picked.filter(item => item.data.deactivatedForSimulator === true).map(item => item.id);
    const toDeactivate = picked.filter(item => item.data.deactivatedForSimulator !== true);
    const targetIds = new Set(toDeactivate.map(item => item.id));
    const remaining = [...fleets.entries()].filter(([id, fleet]) => companyUsable(fleet.data) && !targetIds.has(id)).length;
    if (toDeactivate.length && remaining < 1) throw refuse("failed-precondition", "A empresa precisa continuar com pelo menos um simulador ativo.", "GROUP_LAST_SIMULATOR");
    const jobs = await Promise.all(toDeactivate.flatMap(item => [
      tx.get(db.collection("trabalhos").where("companyId", "==", item.id)), tx.get(db.collection("trabalhos").where("empresaId", "==", item.id))]));
    if (jobs.some(snapshot => snapshot.docs.some(row => !CLOSED_JOB_STATUS.includes(String(row.get("status") || "").toLowerCase()))))
      throw refuse("failed-precondition", "Finalize ou cancele as operações desse simulador antes de desativá-lo. O histórico é preservado.", "GROUP_OPEN_OPERATIONS");
    const now = admin.firestore.FieldValue.serverTimestamp();
    toDeactivate.forEach(item => tx.update(item.ref, { status: "archived", deactivatedForSimulator: true, deactivatedAt: now, deactivatedBy: actor.uid }));
    return { success: true as const, groupId, companyId, alreadyInactive, remaining,
      deactivated: toDeactivate.map(item => ({ companyId: item.id, simulatorId: text(item.data.simulatorId), simulatorName: text(item.data.simulatorName) })) };
  });
}

export type RenameResult = { success: true; groupId: string; companyName: string; updated: number };

/** The owner (or a Senior) renames the company: the new name is written to every fleet of the group in one batch. */
export async function renameCompanyGroupCore(db: FirebaseFirestore.Firestore, context: functions.https.CallableContext,
  input: { companyId?: unknown; companyName?: unknown }): Promise<RenameResult> {
  const actor = actorOf(context), companyId = safeId(input.companyId, "Empresa"), companyName = cleanCompanyName(input.companyName);
  return db.runTransaction(async tx => {
    const { source, groupId, fleets } = await readGroup(db, tx, companyId);
    await assertAllowed(db, tx, actor, source);
    const now = admin.firestore.FieldValue.serverTimestamp();
    let updated = 0;
    fleets.forEach(({ ref, data }) => {
      if (!companyUsable(data) || text(data.companyName) === companyName) return;
      tx.update(ref, { companyName, nameChangedAt: now, nameChangedBy: actor.uid });
      updated += 1;
    });
    return { success: true as const, groupId, companyName, updated };
  });
}

/**
 * One callable for the group commands. The client calls `capabilities` first and offers "adicionar simuladores" and the
 * company-wide rename only when the published server lists them.
 */
export const manageCompanyGroup = functions.region("us-central1").runWith({ ingressSettings: "ALLOW_ALL" }).https.onCall(async (input, context) => {
  const diagnosticId = /^[a-zA-Z0-9_-]{8,80}$/.test(text(input?.diagnosticId)) ? text(input?.diagnosticId) : randomUUID();
  const action = text(input?.action);
  try {
    actorOf(context);
    const db = admin.firestore();
    if (action === "capabilities") return companyGroupCapabilities();
    if (action === "add-simulators") return await addCompanySimulatorsCore(db, context, input || {});
    if (action === "rename") return await renameCompanyGroupCore(db, context, input || {});
    if (action === "deactivate-simulators") return await deactivateCompanySimulatorsCore(db, context, input || {});
    throw refuse("invalid-argument", "Ação de empresa inválida.", "GROUP_INVALID_ACTION");
  } catch (error) {
    if (error instanceof functions.https.HttpsError) {
      const details = error.details && typeof error.details === "object" && !Array.isArray(error.details) ? { ...(error.details as Record<string, unknown>) } : {};
      details.diagnosticId ||= diagnosticId;
      throw new functions.https.HttpsError(error.code, error.message, details);
    }
    const cause = error as { code?: unknown; message?: unknown };
    functions.logger.error("company_group_failed", { diagnosticId, action, companyId: text(input?.companyId), actorUid: context.auth?.uid || null,
      code: String(cause?.code || "unknown"), message: String(cause?.message || error) });
    throw new functions.https.HttpsError("internal", `Não foi possível concluir agora. Referência: ${diagnosticId}`, { diagnosticId, reasonCode: "GROUP_INTERNAL", retryable: true });
  }
});
