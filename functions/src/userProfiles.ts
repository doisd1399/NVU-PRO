import * as admin from "./firebaseAdmin";
import * as functions from "firebase-functions/v1";
import { accountUsable, requireCompanyManager } from "./companyAccess";
import { hasSeniorClaim } from "./authorization";
import { requireActiveAccount } from "./seniorAccountCommands";
import { driverDisplayIdentity } from "./driverDisplayIdentity";

const text = (value: unknown, max = 160) => typeof value === "string" ? value.trim().slice(0, max) : "";
const id = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 128 && !value.includes("/");
const image = (value: unknown) => {
  const url = text(value, 4096);
  return /^https:\/\//.test(url) ? url : "";
};

/** Explicit display whitelist: never copy contacts, permissions, memberships or settings. */
export function publicUserProfile(uid: string, data: Record<string, any>, application?: Record<string, any>) {
  const identity = driverDisplayIdentity({ ...data, id: uid }, application);
  return {
    id: uid, name: text(identity.name), profileNameSource: "user_edit",
    profilePhotoURL: image(identity.profilePhotoURL), profilePhotoSource: "user_edit",
    profileCoverURL: image(data.profileCoverURL), profileCoverRevision: text(data.profileCoverRevision),
    companyId: text(data.companyId, 128), status: accountUsable(data) ? text(data.status || "pending", 24) : "inactive",
    isOnline: data.isOnline === true,
    ...Object.fromEntries(["level","rating","xp","totalDeliveries"].filter(field =>
      typeof data[field] === "number" && Number.isFinite(data[field]) && data[field] >= 0 && data[field] <= 1e12).map(field => [field,data[field]])),
    deleted: data.deleted === true, schemaVersion: 1,
  };
}

/** Re-read the current source inside a transaction so late events cannot resurrect old data. */
export async function refreshPublicUser(db: FirebaseFirestore.Firestore, uid: string) {
  return db.runTransaction(async tx => {
    const source = await tx.get(db.doc(`users/${uid}`));
    const destination = db.doc(`public_users/${uid}`);
    if (!source.exists || source.get("deleted") === true) { tx.delete(destination); return; }
    const profile = source.data() || {};
    const applicationId = profile.approvedIdentityApplicationId ||
      (profile.currentRecruitmentStatus === "approved" ? profile.currentRecruitmentApplicationId : "");
    // Recover only the exact linked, approved NVU identity. The shared resolver
    // rejects another user, revoked forms and company-registration logos.
    const identity = driverDisplayIdentity({ ...profile, id: uid });
    const needsLegacyIdentity = profile.approvedIdentityVersion !== 2 &&
      (profile.profileNameSource !== "user_edit" || profile.profilePhotoSource !== "user_edit");
    const needsPhoto = profile.profilePhotoSource !== "user_edit" && !identity.profilePhotoURL;
    const application = id(applicationId) && (needsLegacyIdentity || needsPhoto)
      ? await tx.get(db.doc(`recruitment_applications/${applicationId}`)) : null;
    tx.set(destination, publicUserProfile(uid, profile,
      application?.exists ? { ...application.data(), id: application.id } : undefined));
  });
}
export const syncUserPublicProfile = functions.runWith({ failurePolicy: true }).firestore
  .document("users/{userId}").onWrite(async (_change, context) => {
    await refreshPublicUser(admin.firestore(), context.params.userId);
  });

/** Private reads are explicit and bounded; ordinary directory views use public_users. */
export const readPrivateUserProfiles = functions.https.onCall(async (input, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError("unauthenticated", "Autenticação obrigatória.");
  const data = input || {};
  if (typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(k => !["ids", "email", "companyId", "existenceOnly"].includes(k)))
    throw new functions.https.HttpsError("invalid-argument", "Consulta de perfis inválida.");
  const db = admin.firestore();
  const senior = hasSeniorClaim(context);
  const companyId = text(data.companyId, 128);
  const email = text(data.email, 254).toLowerCase();
  const requestedIds: string[] = Array.isArray(data.ids) ? data.ids : [];
  if (requestedIds.length > 30 || requestedIds.some(value => !id(value)) || (data.ids !== undefined && !Array.isArray(data.ids)) ||
      (data.email !== undefined && (!email || data.email.length > 254)) || (data.companyId !== undefined && !id(data.companyId)) ||
      (data.existenceOnly !== undefined && typeof data.existenceOnly !== "boolean") || (!email && !requestedIds.length))
    throw new functions.https.HttpsError("invalid-argument", "Informe até 30 identificadores ou um e-mail.");
  const ownEmail = context.auth?.token.email_verified === true && email && email === text(context.auth?.token.email, 254).toLowerCase();
  // A first login can precede users/{uid}. Verified ownership may recover only
  // that e-mail; all existing accounts keep the live suspension/revocation gate.
  const self = await db.doc(`users/${uid}`).get();
  if (self.exists || !ownEmail) await requireActiveAccount(context);
  else {
    const identity = await admin.auth().getUser(uid);
    if (identity.disabled || !identity.emailVerified || identity.email?.toLowerCase() !== email)
      throw new functions.https.HttpsError("permission-denied", "Identidade não confirmada.");
  }
  if (!senior && !ownEmail && requestedIds.some(value => value !== uid)) {
    if (!companyId) throw new functions.https.HttpsError("permission-denied", "Perfil privado.");
    await db.runTransaction(async tx => { await requireCompanyManager(db, tx, context, companyId); });
  }
  if (email && !senior && !ownEmail) {
    if (!companyId || data.existenceOnly !== true) throw new functions.https.HttpsError("permission-denied", "Consulta privada.");
    await db.runTransaction(async tx => { await requireCompanyManager(db, tx, context, companyId); });
  }
  const rows = email ? (await db.collection("users").where("email", "==", text(data.email, 254)).limit(30).get()).docs :
    await db.getAll(...[...new Set(requestedIds)].map(value => db.doc(`users/${value}`)));
  if (data.existenceOnly === true) return { exists: rows.some(row => row.exists), profiles: [] };
  const profiles: Record<string, any>[] = [];
  for (const row of rows) {
    if (!row.exists) continue;
    const profile = row.data() || {};
    if (senior || row.id === uid || ownEmail) { profiles.push({ ...profile, id: row.id }); continue; }
    const access = await db.doc(`company_access/${companyId}/members/${row.id}`).get();
    const company = await db.doc(`frotas/${companyId}`).get();
    if (access.get("status") !== "active" && company.get("ownerId") !== row.id && company.get("userId") !== row.id) {
      const application = await db.collection("recruitment_applications").where("userId","==",row.id).where("companyId","==",companyId).where("status","==","pending").limit(1).get();
      const request = await db.collection("solicitacoes_motoristas").where("motoristaId","==",row.id).where("empresaId","==",companyId).where("status","==","pending").limit(1).get();
      if (application.empty && request.empty) throw new functions.https.HttpsError("permission-denied", "Perfil fora da empresa administrada.");
    }
    profiles.push({ ...publicUserProfile(row.id, profile), email: text(profile.email, 254), whatsapp: text(profile.whatsapp, 40) });
  }
  return { profiles };
});
