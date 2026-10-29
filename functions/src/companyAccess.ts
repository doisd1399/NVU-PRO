import * as admin from "./firebaseAdmin";
import * as functions from "firebase-functions/v1";
import { hasSeniorClaim } from "./authorization";

type Data = FirebaseFirestore.DocumentData;
type Tx = FirebaseFirestore.Transaction;
export const accessRef = (db: FirebaseFirestore.Firestore, uid: string, companyId: string) =>
  db.collection("company_access").doc(companyId).collection("members").doc(uid);
export const accountUsable = (user: Data): boolean => user.deleted !== true &&
  !["suspended", "deleted", "blocked", "disabled", "inactive"].includes(String(user.status || "active").toLowerCase()) &&
  !["suspended", "deleted", "blocked", "disabled", "inactive"].includes(String(user.accountStatus || "active").toLowerCase()) &&
  !(user.suspension?.active === true);
export const companyUsable = (company: Data): boolean => company.deleted !== true && company.isDeleted !== true &&
  company.active !== false && company.isActive !== false &&
  !["deleted", "archived", "disabled", "blocked"].includes(String(company.status || "active").toLowerCase());
export const memberRoles = (data: Data): string[] => {
  if (data.status && data.status !== "active") return [];
  const roles = [...(Array.isArray(data.roles) ? data.roles : []), data.role].filter((role): role is string =>
    typeof role === "string" && ["driver", "admin", "owner"].includes(role));
  if (!roles.length) roles.push("driver");
  if (roles.includes("admin") || roles.includes("owner")) roles.push("driver");
  return [...new Set(roles)];
};
export const companyOwner = (company: Data, uid: string) => company.ownerId === uid || company.userId === uid;

/** Reads current canonical rows and the revocation barrier in the caller's transaction. */
export async function readCompanyAccess(db: FirebaseFirestore.Firestore, tx: Tx, uid: string, companyId: string,
  companyRead?: Promise<FirebaseFirestore.DocumentSnapshot>, userRead?: Promise<FirebaseFirestore.DocumentSnapshot>) {
  const [userSnap, companySnap, authorizationSnap, members] = await Promise.all([
    userRead || tx.get(db.collection("users").doc(uid)), companyRead || tx.get(db.collection("frotas").doc(companyId)),
    tx.get(accessRef(db, uid, companyId)),
    tx.get(db.collection("companyMembers").where("userId", "==", uid).where("companyId", "==", companyId)),
  ]);
  const user = userSnap.data() || {}, company = companySnap.data() || {}, authorization = authorizationSnap.data() || {};
  const owner = companySnap.exists && companyOwner(company, uid);
  const roles = owner ? ["owner", "admin", "driver"] : [...new Set(members.docs.flatMap(row => memberRoles(row.data())))];
  const revoked = authorization.status === "removed" || authorization.revokedAt != null;
  const active = userSnap.exists && companySnap.exists && companyUsable(company) && accountUsable(user) && !revoked && roles.length > 0;
  return { userSnap, companySnap, authorizationSnap, members, user, company, authorization, owner, roles, revoked, active };
}

export function assertCompanyDriver(state: Awaited<ReturnType<typeof readCompanyAccess>>) {
  if (!state.active || !state.roles.includes("driver")) throw new functions.https.HttpsError(
    "permission-denied", "Seu vínculo com esta empresa foi removido, está suspenso ou não está ativo.",
    { reasonCode: "COMPANY_MEMBERSHIP_INACTIVE", retryable: false, stage: "CALLABLE_REGISTRATION" });
  return state;
}

export async function requireCompanyDriver(db: FirebaseFirestore.Firestore, tx: Tx, uid: string, companyId: string) {
  return assertCompanyDriver(await readCompanyAccess(db, tx, uid, companyId));
}

export async function requireCompanyManager(db: FirebaseFirestore.Firestore, tx: Tx,
  context: functions.https.CallableContext, companyId: string,
  companyRead?: Promise<FirebaseFirestore.DocumentSnapshot>) {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Faça login para continuar.");
  const state = await readCompanyAccess(db, tx, context.auth.uid, companyId, companyRead);
  if (!state.userSnap.exists || !accountUsable(state.user)) throw new functions.https.HttpsError("permission-denied", "Conta suspensa ou indisponível.");
  if (!hasSeniorClaim(context) && !(state.active && state.roles.some(role => role === "admin" || role === "owner")))
    throw new functions.https.HttpsError("permission-denied", "Você não administra esta empresa.");
  return state;
}

export function activeAccessData(uid: string, companyId: string, roles: string[]) {
  return { userId: uid, companyId, status: "active", roles, role: roles.includes("admin") || roles.includes("owner") ? "admin" : "driver",
    schemaVersion: 1, updatedAt: admin.firestore.FieldValue.serverTimestamp() };
}

/** Projection recomputation always reads latest canonical state; late events cannot undo a revocation. */
export async function refreshCompanyAccess(db: FirebaseFirestore.Firestore, uid: string, companyId: string) {
  if (!uid || !companyId) return;
  await db.runTransaction(async tx => {
    const state = await readCompanyAccess(db, tx, uid, companyId);
    if (state.revoked) return;
    tx.set(accessRef(db, uid, companyId), state.active ? activeAccessData(uid, companyId, state.roles) : {
      userId: uid, companyId, status: "inactive", roles: [], schemaVersion: 1, updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
}

export const ensureCompanyAccess = functions.region("us-central1").https.onCall(async (input, context) => {
  const uid = context.auth?.uid, companyId = String(input?.companyId || "").trim();
  if (!uid) throw new functions.https.HttpsError("unauthenticated", "Faça login para enviar a imagem.");
  if (!companyId || companyId.length > 180 || /[\/\0]/.test(companyId)) throw new functions.https.HttpsError("invalid-argument", "Empresa inválida.");
  const db = admin.firestore();
  return db.runTransaction(async tx => {
    const state = await readCompanyAccess(db, tx, uid, companyId);
    if (hasSeniorClaim(context) && state.userSnap.exists && state.companySnap.exists && companyUsable(state.company) && accountUsable(state.user)) return { active: true, companyId };
    if (!state.active) throw new functions.https.HttpsError("permission-denied", "Seu vínculo com esta empresa não está ativo.");
    tx.set(accessRef(db, uid, companyId), activeAccessData(uid, companyId, state.roles));
    return { active: true, companyId };
  });
});

export const syncCompanyAccessOnMembershipWrite = functions.firestore.document("companyMembers/{memberId}").onWrite(async change => {
  const identities = [change.before.data(), change.after.data()].filter(Boolean) as Data[];
  const seen = new Set<string>();
  for (const row of identities) {
    const uid = String(row.userId || ""), companyId = String(row.companyId || "");
    if (uid && companyId && !seen.has(`${uid}/${companyId}`)) {
      seen.add(`${uid}/${companyId}`); await refreshCompanyAccess(admin.firestore(), uid, companyId);
    }
  }
});

// Only public identity, simulator resolution and eligibility may leave the private fleet record.
export const PUBLIC_COMPANY_FIELDS = ["companyName", "fleetName", "name", "nome", "logoUrl", "logoURL", "logo", "companyLogoURL",
  "profileCoverURL", "profileCoverRevision", "profileCoverUpdatedAt", "profileDescription", "profileDescriptionRevision", "profileDescriptionUpdatedAt", "simulatorId", "simuladorId", "simulatorName",
  "simuladorNome", "simulator", "simulador", "simulatorCode", "simulatorKey", "simuladorKey", "simuladorCodigo", "gameCode", "packageId", "status", "situacao", "state", "deleted", "isDeleted",
  "softDeleted", "excluida", "excluido", "isActive", "active", "isVerified", "verified", "createdAt", "approvedAt", "rankingEligible", "eligibleForRanking",
  "rankingEnabled", "excludeFromRanking", "currency", "moeda"] as const;
export function publicCompanyData(data: Data) {
  const projected: Data = Object.fromEntries(PUBLIC_COMPANY_FIELDS.filter(key => data[key] !== undefined).map(key => [key, data[key]]));
  if (data.profileDescription !== undefined) projected.profileDescription = typeof data.profileDescription === "string"
    ? Array.from(data.profileDescription.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()).slice(0, 160).join("").trim() : "";
  if (typeof projected.profileDescriptionRevision !== "string") delete projected.profileDescriptionRevision;
  const settings = data.recruitmentSettings;
  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    const publicSettings = Object.fromEntries(["about", "rules", "howItWorks", "benefits", "isActive"].filter(key => typeof settings[key] === (key === "isActive" ? "boolean" : "string")).map(key => [key, settings[key]]));
    if (Object.keys(publicSettings).length) projected.recruitmentSettings = publicSettings;
  }
  return projected;
}
export const syncCompanyPublicProfile = functions.firestore.document("frotas/{companyId}").onWrite(async (change, context) => {
  const db = admin.firestore(), companyId = context.params.companyId;
  // Re-read instead of trusting event order; a late event cannot restore old private fields or deleted identity.
  await db.runTransaction(async tx => {
    const current = await tx.get(change.after.ref), publicRef = db.collection("public_companies").doc(companyId);
    if (current.exists) tx.set(publicRef, publicCompanyData(current.data() || {}));
    else tx.set(publicRef, { status: "deleted", deleted: true });
  });
  const owners = new Set([change.before.get("ownerId"), change.before.get("userId"), change.after.get("ownerId"), change.after.get("userId")]);
  for (const uid of owners) if (typeof uid === "string" && uid) await refreshCompanyAccess(db, uid, companyId);
});

export const syncCompanyAccessOnUserWrite = functions.firestore.document("users/{userId}").onWrite(async (change, context) => {
  if (accountUsable(change.before.data() || {}) === accountUsable(change.after.data() || {})) return;
  const db = admin.firestore(), uid = context.params.userId;
  const [members, ownerRows, userRows] = await Promise.all([
    db.collection("companyMembers").where("userId", "==", uid).get(),
    db.collection("frotas").where("ownerId", "==", uid).get(),
    db.collection("frotas").where("userId", "==", uid).get(),
  ]);
  const ids = new Set<string>([...members.docs.map(row => row.get("companyId")), ...ownerRows.docs.map(row => row.id), ...userRows.docs.map(row => row.id)].filter(Boolean));
  for (const companyId of ids) await refreshCompanyAccess(db, uid, companyId);
});
