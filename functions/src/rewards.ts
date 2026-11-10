import * as admin from "./firebaseAdmin";
import * as functions from "firebase-functions/v1";
import { createHash } from "node:crypto";
import { requireCompanyDriver, requireCompanyManager } from "./companyAccess";
import { driverDisplayIdentity } from "./driverDisplayIdentity";
import { CALLABLE_REGIONS } from "./callableRegions";
import { assertCompany, fail, id, text } from "./operationalCommandPolicy";
import { canonicalTripField, isTrustedServerConfirmedTrip } from "./isCanonicalConfirmedTrip";
import { MAX_REWARD_DRIVERS, REWARD_CAMPAIGNS, REWARD_OFFERS, accrueRewards, campaignBudget, normalizeCampaign, type AccrualTrip } from "./rewardPolicy";

type Data = FirebaseFirestore.DocumentData;
type DB = FirebaseFirestore.Firestore;
const digest = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const companyLabel = (company: Data): string => text(company.companyName) || text(company.name) || text(company.nome) || "Empresa";
const ms = (value: any): number => (value?.toMillis?.() ?? (typeof value?.seconds === "number" ? value.seconds * 1000 : typeof value === "number" ? value : Date.parse(String(value || "")))) || 0;
const money = (cents: number) => `R$ ${(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function notifyUsers(db: DB, userIds: string[], payload: { type: string; title: string; message: string; companyId: string; refId: string }) {
  await Promise.all([...new Set(userIds.filter(Boolean))].map(userId => db.collection("notifications").doc(`${payload.type}_${payload.refId}_${userId}`).set({
    userId, companyId: payload.companyId, targetProfile: "driver", type: payload.type, title: payload.title, message: payload.message,
    titulo: payload.title, mensagem: payload.message, tipo: payload.type, metadata: { campaignId: payload.refId },
    dedupeKey: `${payload.type}_${payload.refId}`, schemaVersion: 3, read: false, lida: false, createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: false }).catch(() => undefined)));
}

/** Motoristas ativos da empresa (vínculo ativo com papel de motorista). */
async function activeDrivers(db: DB, companyId: string): Promise<string[]> {
  const rows = await db.collection("companyMembers").where("companyId", "==", companyId).where("status", "==", "active").get();
  return [...new Set(rows.docs.filter(row => { const roles = [...(Array.isArray(row.get("roles")) ? row.get("roles") : []), row.get("role")]; return !roles.length || roles.includes("driver") || roles.includes("admin") || roles.includes("owner"); }).map(row => text(row.get("userId"))).filter(Boolean))];
}

export const createRewardCampaign = functions.region(...CALLABLE_REGIONS).https.onCall(async (raw, context) => {
  const uid = context.auth?.uid;
  if (!uid) fail("unauthenticated", "Faça login para criar a campanha.");
  const db = admin.firestore(), probe = raw && typeof raw === "object" ? raw as Data : {};
  const companyId = id(probe.companyId, "Empresa"), requestId = id(probe.requestId, "Pedido");
  const campaignId = `rc_${digest([uid, requestId]).slice(0, 40)}`;
  await db.runTransaction(tx => requireCompanyManager(db, tx, context, companyId)); // quem não é gestor não vê nada da empresa
  const input = normalizeCampaign(probe, Date.now());
  if (!input.contractId) fail("invalid-argument", "Escolha a operação da campanha.");
  const contractSnap = await db.collection("contratos").doc(input.contractId).get(), contract = contractSnap.data() || {};
  if (!contractSnap.exists || contract.companyId !== companyId || contract.deleted === true) fail("failed-precondition", "A operação escolhida não existe nesta empresa.");
  // Sem limite informado, vale o total de viagens da operação (meta de valor = valor por viagem × total de viagens).
  input.maxTripsPerDriver = input.maxTripsPerDriver || Math.max(0, Math.floor(Number(contract.totalDeliveries) || 0));
  if (!input.maxTripsPerDriver) fail("invalid-argument", "Informe quantas viagens cada motorista pode fazer na campanha.");
  const contractName = text(contract.name) || "Operação";
  const members = await activeDrivers(db, companyId);
  const driverIds = input.audience === "all" ? members : input.driverIds;
  if (input.audience === "selected" && driverIds.some(driver => !members.includes(driver))) fail("failed-precondition", "Um dos motoristas escolhidos não faz parte da equipe ativa da empresa.");
  if (!driverIds.length) fail("failed-precondition", "A empresa não tem motoristas ativos para receber a campanha.");
  if (driverIds.length > MAX_REWARD_DRIVERS) fail("resource-exhausted", `A campanha pode ter no máximo ${MAX_REWARD_DRIVERS} motoristas.`);
  const budgetCents = input.budgetCents || campaignBudget(input, driverIds.length);
  if (budgetCents < input.perTripCents) fail("invalid-argument", "O teto de investimento precisa cobrir ao menos uma viagem.");
  const users = await db.getAll(...driverIds.map(driver => db.collection("users").doc(driver)));
  const names = new Map(users.map(user => [user.id, driverDisplayIdentity({ ...(user.data() || {}), id: user.id }).name]));
  const outcome = await db.runTransaction(async tx => {
    const ref = db.collection(REWARD_CAMPAIGNS).doc(campaignId);
    const [existing, manager] = await Promise.all([tx.get(ref), requireCompanyManager(db, tx, context, companyId)]);
    if (existing.exists) { if (existing.get("createdBy") !== uid) fail("failed-precondition", "Este pedido já foi utilizado."); return { replayed: true, company: manager.company, contractName }; }
    assertCompany(manager.company, false);
    const now = admin.firestore.FieldValue.serverTimestamp();
    tx.create(ref, { schemaVersion: 1, companyId, companyName: companyLabel(manager.company), simulatorId: text(manager.company.simulatorId) || text(manager.company.simulatorName),
      name: input.name, startMs: input.startMs, endMs: input.endMs, perTripCents: input.perTripCents, bonusCents: input.bonusCents, bonusGoalTrips: input.bonusGoalTrips, budgetCents, contractId: input.contractId, contractName, maxTripsPerDriver: input.maxTripsPerDriver,
      audience: input.audience, status: "active", accruedCents: 0, tripsCount: 0, capped: false, driversCount: driverIds.length, acceptedCount: 0, createdBy: uid, createdAt: now, updatedAt: now });
    for (const driverId of driverIds) tx.create(db.collection(REWARD_OFFERS).doc(`${campaignId}_${driverId}`), {
      schemaVersion: 1, campaignId, companyId, companyName: companyLabel(manager.company), driverId, driverName: names.get(driverId) || "Motorista", status: "pending",
      name: input.name, startMs: input.startMs, endMs: input.endMs, perTripCents: input.perTripCents, bonusCents: input.bonusCents, bonusGoalTrips: input.bonusGoalTrips, contractId: input.contractId, contractName, maxTripsPerDriver: input.maxTripsPerDriver,
      trips: 0, tripCents: 0, bonusEarnedCents: 0, totalCents: 0, goalReached: false, acceptedAtMs: 0, createdAt: now, updatedAt: now });
    return { replayed: false, company: manager.company, contractName };
  });
  if (!outcome.replayed) await notifyUsers(db, driverIds, { type: "REWARD_OFFER", refId: campaignId, companyId, title: "Nova recompensa",
    message: `${companyLabel(outcome.company)} enviou a campanha ${input.name} (operação ${outcome.contractName}): ${money(input.perTripCents)} por viagem, até ${input.maxTripsPerDriver} viagens${input.bonusCents ? ` e bônus de ${money(input.bonusCents)} em ${input.bonusGoalTrips} viagens` : ""}. Aceite ou recuse.` });
  return { success: true, campaignId, drivers: driverIds.length, replayed: outcome.replayed };
});

/** Recalcula uma campanha a partir das viagens confirmadas (idempotente: o resultado depende só do que existe). */
export async function recomputeRewardCampaign(db: DB, campaignId: string) {
  const campaignSnap = await db.collection(REWARD_CAMPAIGNS).doc(campaignId).get();
  if (!campaignSnap.exists || campaignSnap.get("status") !== "active") return;
  const campaign = campaignSnap.data() || {}, offers = await db.collection(REWARD_OFFERS).where("campaignId", "==", campaignId).where("status", "==", "accepted").get();
  const trips: AccrualTrip[] = [];
  for (const offer of offers.docs) {
    const rows = await db.collection("historico_viagens").where("driverId", "==", offer.get("driverId")).where("companyId", "==", campaign.companyId).get();
    for (const row of rows.docs) {
      const data = row.data();
      if (!isTrustedServerConfirmedTrip(data)) continue;
      trips.push({ id: row.id, driverId: text(offer.get("driverId")), contractId: canonicalTripField(data, "contractId", "contratoId"), at: ms(data.completedAt) || ms(data.createdAt) || ms(data.dataLancamento) });
    }
  }
  const result = accrueRewards({ startMs: campaign.startMs, endMs: campaign.endMs, perTripCents: campaign.perTripCents, bonusCents: campaign.bonusCents, bonusGoalTrips: campaign.bonusGoalTrips, budgetCents: campaign.budgetCents, contractId: text(campaign.contractId), maxTripsPerDriver: Number(campaign.maxTripsPerDriver) || 0 },
    offers.docs.map(offer => ({ driverId: text(offer.get("driverId")), acceptedAtMs: Number(offer.get("acceptedAtMs")) || 0 })), trips);
  const batch = db.batch(); let writes = 0;
  for (const offer of offers.docs) {
    const row = result.drivers.get(text(offer.get("driverId")));
    if (!row || (offer.get("trips") === row.trips && offer.get("totalCents") === row.totalCents && offer.get("goalReached") === row.goalReached)) continue;
    batch.update(offer.ref, { trips: row.trips, tripCents: row.tripCents, bonusEarnedCents: row.bonusCents, totalCents: row.totalCents, goalReached: row.goalReached, updatedAt: admin.firestore.FieldValue.serverTimestamp() }); writes++;
  }
  if (campaign.accruedCents !== result.accruedCents || campaign.tripsCount !== result.tripsCount || campaign.capped !== result.capped) {
    batch.update(campaignSnap.ref, { accruedCents: result.accruedCents, tripsCount: result.tripsCount, capped: result.capped, updatedAt: admin.firestore.FieldValue.serverTimestamp() }); writes++;
  }
  if (writes) await batch.commit();
  if (result.capped && !campaign.capped) await notifyManagers(db, String(campaign.companyId), `A campanha ${campaign.name} chegou ao teto de ${money(campaign.budgetCents)} e parou de creditar novas viagens.`, campaignId);
}
/** Responsáveis da empresa (dono e administradores ativos). */
export async function managerIds(db: DB, companyId: string): Promise<string[]> {
  const company = (await db.collection("frotas").doc(companyId).get()).data() || {}, targets = new Set<string>([text(company.ownerId), text(company.userId)]);
  const members = await db.collection("companyMembers").where("companyId", "==", companyId).where("status", "==", "active").get();
  members.docs.forEach(row => { const roles = [...(Array.isArray(row.get("roles")) ? row.get("roles") : []), row.get("role")]; if (roles.some(r => r === "admin" || r === "owner")) targets.add(text(row.get("userId"))); });
  targets.delete("");
  return [...targets];
}
async function notifyManagers(db: DB, companyId: string, message: string, refId: string) {
  try {
    const targets = await managerIds(db, companyId);
    await Promise.all(targets.map(userId => db.collection("notifications").doc(`REWARD_CAP_${refId}_${userId}`).set({ userId, companyId, targetProfile: "admin", type: "REWARD_CAP", title: "Teto da campanha atingido", message,
      titulo: "Teto da campanha atingido", mensagem: message, tipo: "REWARD_CAP", metadata: { campaignId: refId }, dedupeKey: `REWARD_CAP_${refId}`, schemaVersion: 3, read: false, lida: false, createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: false }).catch(() => undefined)));
  } catch { /* o aviso nunca desfaz o cálculo */ }
}

export const respondRewardOffer = functions.region(...CALLABLE_REGIONS).https.onCall(async (raw, context) => {
  const uid = context.auth?.uid;
  if (!uid) fail("unauthenticated", "Faça login para responder.");
  const db = admin.firestore(), data = raw && typeof raw === "object" ? raw as Data : {};
  const offerId = id(data.offerId, "Oferta"), decision = text(data.decision);
  if (!["accept", "decline"].includes(decision)) fail("invalid-argument", "Resposta inválida.");
  const outcome = await db.runTransaction(async tx => {
    const ref = db.collection(REWARD_OFFERS).doc(offerId), snap = await tx.get(ref);
    if (!snap.exists) fail("not-found", "A oferta não foi encontrada.");
    const offer = snap.data() || {};
    if (offer.driverId !== uid) fail("permission-denied", "Esta oferta não é sua.");
    const target = decision === "accept" ? "accepted" : "declined";
    if (offer.status === target) return { replayed: true, offer };
    if (offer.status !== "pending") fail("failed-precondition", "Esta oferta não está mais aguardando resposta.");
    const campaignRef = db.collection(REWARD_CAMPAIGNS).doc(text(offer.campaignId)), campaign = await tx.get(campaignRef);
    if (!campaign.exists || campaign.get("status") !== "active" || Number(campaign.get("endMs")) < Date.now()) fail("failed-precondition", "Esta campanha já foi encerrada.");
    if (decision === "accept") await requireCompanyDriver(db, tx, uid as string, text(offer.companyId));
    const now = admin.firestore.FieldValue.serverTimestamp();
    tx.update(ref, { status: target, respondedAt: now, updatedAt: now, ...(decision === "accept" ? { acceptedAtMs: Date.now() } : {}) });
    if (decision === "accept") tx.update(campaignRef, { acceptedCount: admin.firestore.FieldValue.increment(1), updatedAt: now });
    return { replayed: false, offer };
  });
  if (!outcome.replayed) await notifyManagers(db, text(outcome.offer.companyId), `${text(outcome.offer.driverName)} ${decision === "accept" ? "aceitou" : "recusou"} a campanha ${text(outcome.offer.name)}.`, `${text(outcome.offer.campaignId)}_${uid}_${decision}`);
  if (!outcome.replayed && decision === "accept") await recomputeRewardCampaign(db, text(outcome.offer.campaignId));
  return { success: true, offerId, status: decision === "accept" ? "accepted" : "declined", replayed: outcome.replayed };
});

export const cancelRewardCampaign = functions.region(...CALLABLE_REGIONS).https.onCall(async (raw, context) => {
  const uid = context.auth?.uid;
  if (!uid) fail("unauthenticated", "Faça login para continuar.");
  const db = admin.firestore(), campaignId = id((raw as Data | null)?.campaignId, "Campanha");
  await db.runTransaction(async tx => {
    const ref = db.collection(REWARD_CAMPAIGNS).doc(campaignId), snap = await tx.get(ref);
    if (!snap.exists) fail("not-found", "A campanha não foi encontrada.");
    await requireCompanyManager(db, tx, context, text(snap.get("companyId")));
    if (snap.get("status") === "cancelled") return;
    const pending = await tx.get(db.collection(REWARD_OFFERS).where("campaignId", "==", campaignId).where("status", "==", "pending"));
    const now = admin.firestore.FieldValue.serverTimestamp();
    pending.docs.forEach(row => tx.update(row.ref, { status: "cancelled", updatedAt: now }));
    tx.update(ref, { status: "cancelled", cancelledAt: now, updatedAt: now });
  });
  return { success: true, campaignId };
});

/** Viagem confirmada de um motorista: recalcula as campanhas ativas em que ele aceitou. */
export const syncRewardTrips = functions.region("us-central1").runWith({ failurePolicy: true })
  .firestore.document("historico_viagens/{tripId}").onWrite(async change => {
    const rows = [change.before.data(), change.after.data()].filter(Boolean) as Data[];
    const keys = new Set(rows.map(row => `${text(row.driverId) || text(row.motoristaId)}|${text(row.companyId) || text(row.empresaId)}`).filter(key => !key.startsWith("|") && !key.endsWith("|")));
    const db = admin.firestore(), campaigns = new Set<string>();
    for (const key of keys) {
      const [driverId = "", companyId = ""] = key.split("|");
      const offers = await db.collection(REWARD_OFFERS).where("driverId", "==", driverId).where("companyId", "==", companyId).where("status", "==", "accepted").get();
      offers.docs.forEach(row => campaigns.add(text(row.get("campaignId"))));
    }
    for (const campaignId of campaigns) await recomputeRewardCampaign(db, campaignId);
  });
