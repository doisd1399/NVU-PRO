import * as admin from "./firebaseAdmin";
import * as functions from "firebase-functions/v1";
import { createHash } from "node:crypto";
import { requireCompanyDriver, requireCompanyManager } from "./companyAccess";
import { driverDisplayIdentity } from "./driverDisplayIdentity";
import { CALLABLE_REGIONS } from "./callableRegions";
import { assertCompany, fail, id, text } from "./operationalCommandPolicy";
import { canonicalTripField, isTrustedServerConfirmedTrip } from "./isCanonicalConfirmedTrip";
import { executeOperationalCommand } from "./operationalCommands";
import { DAY_MS, MAX_REWARD_DRIVERS, REWARD_CAMPAIGNS, REWARD_OFFERS, accrueRewards, campaignBudget, normalizeCampaign, type AccrualTrip } from "./rewardPolicy";

type Data = FirebaseFirestore.DocumentData;
type DB = FirebaseFirestore.Firestore;
const digest = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const companyLabel = (company: Data): string => text(company.companyName) || text(company.name) || text(company.nome) || "Empresa";
/** Ganho gerado pela viagem, em centavos (campo do histórico: valorCents ou valor). */
const tripValueCents = (data: Data): number => { const cents = Number(data.valorCents); if (Number.isFinite(cents)) return Math.max(0, Math.round(cents)); const value = Number(data.valor); return Number.isFinite(value) ? Math.max(0, Math.round(value * 100)) : 0; };
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

/** Encaminha o trabalho (mesmo comando de "Encaminhar trabalho") a um motorista; o pedido é fixo por campanha+motorista, então repetir não duplica. */
async function dispatchJob(db: DB, context: functions.https.CallableContext, args: { campaignId: string; companyId: string; contractId: string; driverId: string; vehicleId: string; trailerId: string | null }) {
  const send = (trailerId: string | null) => executeOperationalCommand(db, { action: "assign", companyId: args.companyId, requestId: `rwj_${args.campaignId}_${args.driverId}`.slice(0, 120), contractId: args.contractId, driverId: args.driverId, vehicleId: args.vehicleId, trailerId }, context);
  try { return await send(args.trailerId); }
  catch (error) { // simuladores sem reboque (WBDS/PBS) guardam a operação sem reboque mesmo que o cadastro tenha um
    if (args.trailerId && /reboque da opera/i.test(String((error as Error)?.message))) return send(null);
    throw error;
  }
}
const dueMsOf = (job: Data): number => { const due = Date.parse(String(job?.dueAt || job?.deadlineDate || "")); return Number.isFinite(due) ? due : 0; };

export const createRewardCampaign = functions.region(...CALLABLE_REGIONS).runWith({ timeoutSeconds: 180 }).https.onCall(async (raw, context) => {
  const uid = context.auth?.uid;
  if (!uid) fail("unauthenticated", "Faça login para criar a campanha.");
  const db = admin.firestore(), probe = raw && typeof raw === "object" ? raw as Data : {};
  const companyId = id(probe.companyId, "Empresa"), requestId = id(probe.requestId, "Pedido");
  const campaignId = `rc_${digest([uid, requestId]).slice(0, 40)}`;
  await db.runTransaction(tx => requireCompanyManager(db, tx, context, companyId)); // quem não é gestor não vê nada da empresa
  const input = normalizeCampaign(probe, Date.now());
  if (!input.contractId) fail("invalid-argument", "Escolha a operação da campanha.");
  const vehicleId = id(probe.vehicleId, "Veículo");
  const vehicleSnap = await db.collection("veiculos").doc(vehicleId).get(), vehicle = vehicleSnap.data() || {};
  if (!vehicleSnap.exists || vehicle.companyId !== companyId || vehicle.deleted === true) fail("failed-precondition", "O veículo escolhido não existe nesta empresa.");
  if (vehicle.status === "maintenance") fail("failed-precondition", "O veículo escolhido está em manutenção. Escolha outro.");
  const contractSnap = await db.collection("contratos").doc(input.contractId).get(), contract = contractSnap.data() || {};
  if (!contractSnap.exists || contract.companyId !== companyId || contract.deleted === true) fail("failed-precondition", "A operação escolhida não existe nesta empresa.");
  // As viagens vêm da operação (o empresário não estipula): cada motorista pode ser pago pelas viagens da operação, até a meta de ganhos.
  input.maxTripsPerDriver = Math.max(0, Math.floor(Number(contract.totalDeliveries) || 0));
  if (!input.maxTripsPerDriver) fail("invalid-argument", "Essa operação não tem viagens cadastradas.");
  const contractName = text(contract.name) || "Operação";
  const members = await activeDrivers(db, companyId);
  const driverIds = input.audience === "all" ? members : input.driverIds;
  if (input.audience === "selected" && driverIds.some(driver => !members.includes(driver))) fail("failed-precondition", "Um dos motoristas escolhidos não faz parte da equipe ativa da empresa.");
  if (!driverIds.length) fail("failed-precondition", "A empresa não tem motoristas ativos para receber a campanha.");
  if (driverIds.length > MAX_REWARD_DRIVERS) fail("resource-exhausted", `A campanha pode ter no máximo ${MAX_REWARD_DRIVERS} motoristas.`);
  const settings = (await db.collection("rewardSettings").doc(companyId).get()).data() || {}, payDay = Number.isInteger(settings.payDay) && settings.payDay >= 0 && settings.payDay <= 6 ? settings.payDay : null; // o motorista vê o dia de pagamento da empresa na própria oferta
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
      name: input.name, startMs: input.startMs, endMs: input.endMs, perTripCents: input.perTripCents, bonusCents: input.bonusCents, bonusGoalTrips: input.bonusGoalTrips, budgetCents, contractId: input.contractId, contractName, vehicleId, vehicleName: text(vehicle.name), maxTripsPerDriver: input.maxTripsPerDriver, goalCents: input.goalCents, openEnded: input.openEnded, deadlineDays: Math.max(0, Math.floor(Number(contract.deadlineDays) || 0)),
      audience: input.audience, revision: 1, status: "active", accruedCents: 0, tripsCount: 0, capped: false, driversCount: driverIds.length, acceptedCount: 0, createdBy: uid, createdAt: now, updatedAt: now });
    for (const driverId of driverIds) tx.create(db.collection(REWARD_OFFERS).doc(`${campaignId}_${driverId}`), {
      schemaVersion: 1, campaignId, companyId, companyName: companyLabel(manager.company), driverId, driverName: names.get(driverId) || "Motorista", status: "pending",
      name: input.name, startMs: input.startMs, endMs: input.endMs, perTripCents: input.perTripCents, bonusCents: input.bonusCents, bonusGoalTrips: input.bonusGoalTrips, contractId: input.contractId, contractName, vehicleId, vehicleName: text(vehicle.name), maxTripsPerDriver: input.maxTripsPerDriver, goalCents: input.goalCents, openEnded: input.openEnded, deadlineDays: Math.max(0, Math.floor(Number(contract.deadlineDays) || 0)),
      revision: 1, payDay, trips: 0, tripCents: 0, bonusEarnedCents: 0, totalCents: 0, simCents: 0, goalReached: false, acceptedAtMs: 0, createdAt: now, updatedAt: now });
    return { replayed: false, company: manager.company, contractName };
  });
  // Cada motorista recebe o trabalho na fila (mesmo comando de "Encaminhar trabalho"). Quem não puder receber (suspensão, vínculo, cadastro) sai da campanha com o motivo.
  const pendingOffers = (await db.collection(REWARD_OFFERS).where("campaignId", "==", campaignId).where("status", "==", "pending").get()).docs.filter(row => !row.get("jobId") && !row.get("dispatchError"));
  const trailerId = text(contract.trailerId) || null, sent: string[] = [], failed: { driverId: string; driverName: string; message: string }[] = [];
  for (let index = 0; index < pendingOffers.length; index += 5) await Promise.all(pendingOffers.slice(index, index + 5).map(async offer => {
    const driverId = text(offer.get("driverId"));
    try {
      const assigned = await dispatchJob(db, context, { campaignId, companyId, contractId: input.contractId, driverId, vehicleId, trailerId });
      const job = (assigned.job || {}) as Data, due = dueMsOf(job);
      await offer.ref.update({ jobId: text(assigned.jobId), vehicleId, vehicleName: text(job.vehicleName) || text(vehicle.name), vehiclePlate: text(job.vehiclePlate) || text(vehicle.plate), dispatchedAtMs: Date.now(),
        ...(due ? { deadlineMs: due, openDeadlineMs: due } : {}), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      sent.push(driverId);
    } catch (error) {
      const message = String((error as Error)?.message || "Não foi possível encaminhar o trabalho.").replace(/^(functions|firebase)[^:]*:\s*/i, "").slice(0, 300);
      await offer.ref.update({ status: "cancelled", dispatchError: message, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      failed.push({ driverId, driverName: names.get(driverId) || "Motorista", message });
    }
  }));
  if (pendingOffers.length && !sent.length && !outcome.replayed) await db.collection(REWARD_CAMPAIGNS).doc(campaignId).update({ status: "cancelled", cancelledAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  if (sent.length) await notifyUsers(db, sent, { type: "REWARD_OFFER", refId: campaignId, companyId, title: "Trabalho com pagamento",
    message: `${companyLabel(outcome.company)} encaminhou a operação ${outcome.contractName} para a sua fila: ${money(input.perTripCents)} por viagem (${input.maxTripsPerDriver} viagens)${input.goalCents ? `; meta de ganhos da operação: ${money(input.goalCents)}` : ""}. Só recebe quem concluir no prazo. Veja as condições ao iniciar o trabalho.` });
  return { success: true, campaignId, drivers: sent.length + (outcome.replayed ? driverIds.length - pendingOffers.length : 0), failed, replayed: outcome.replayed };
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
      trips.push({ id: row.id, driverId: text(offer.get("driverId")), contractId: canonicalTripField(data, "contractId", "contratoId"), valueCents: tripValueCents(data), at: ms(data.completedAt) || ms(data.createdAt) || ms(data.dataLancamento) });
    }
  }
  const result = accrueRewards({ startMs: campaign.startMs, endMs: campaign.endMs, perTripCents: campaign.perTripCents, bonusCents: campaign.bonusCents, bonusGoalTrips: campaign.bonusGoalTrips, budgetCents: campaign.budgetCents, contractId: text(campaign.contractId), maxTripsPerDriver: Number(campaign.maxTripsPerDriver) || 0, goalCents: Number(campaign.goalCents) || 0 },
    offers.docs.map(offer => ({ driverId: text(offer.get("driverId")), acceptedAtMs: Number(offer.get("acceptedAtMs")) || 0, deadlineMs: Number(offer.get("deadlineMs")) || 0 })), trips, Date.now());
  const batch = db.batch(); let writes = 0;
  const expiredNow: { offer: FirebaseFirestore.QueryDocumentSnapshot; lost: number }[] = [], completedNow: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  for (const offer of offers.docs) {
    const row = result.drivers.get(text(offer.get("driverId")));
    if (!row) continue;
    const completed = Number(campaign.maxTripsPerDriver) > 0 && row.trips >= Number(campaign.maxTripsPerDriver);
    const same = offer.get("trips") === row.trips && offer.get("totalCents") === row.totalCents && offer.get("goalReached") === row.goalReached && (Number(offer.get("simCents")) || 0) === row.simCents && (offer.get("expired") === true) === row.expired && (Number(offer.get("lostCents")) || 0) === row.lostCents;
    const closeDeadline = (completed || row.expired) && offer.get("openDeadlineMs") !== undefined;
    if (same && !closeDeadline) continue;
    batch.update(offer.ref, { trips: row.trips, tripCents: row.tripCents, bonusEarnedCents: row.bonusCents, totalCents: row.totalCents, goalReached: row.goalReached, simCents: row.simCents, expired: row.expired, lostCents: row.lostCents,
      ...(row.expired && offer.get("expired") !== true ? { expiredAtMs: Date.now() } : {}), ...(completed && offer.get("completedAtMs") === undefined ? { completedAtMs: Date.now() } : {}),
      ...(closeDeadline ? { openDeadlineMs: admin.firestore.FieldValue.delete() } : {}), updatedAt: admin.firestore.FieldValue.serverTimestamp() }); writes++;
    if (row.expired && offer.get("expired") !== true) expiredNow.push({ offer, lost: row.lostCents });
    if (completed && !row.expired && offer.get("completedAtMs") === undefined) completedNow.push(offer);
  }
  if (campaign.accruedCents !== result.accruedCents || campaign.tripsCount !== result.tripsCount || campaign.capped !== result.capped) {
    batch.update(campaignSnap.ref, { accruedCents: result.accruedCents, tripsCount: result.tripsCount, capped: result.capped, updatedAt: admin.firestore.FieldValue.serverTimestamp() }); writes++;
  }
  if (writes) await batch.commit();
  for (const { offer, lost } of expiredNow) await notifyUsers(db, [text(offer.get("driverId"))], { type: "REWARD_EXPIRED", refId: offer.id, companyId: text(campaign.companyId), title: "Prazo encerrado",
    message: `Você não concluiu a operação ${text(offer.get("contractName")) || text(offer.get("name"))} no prazo e perdeu o pagamento${lost ? ` de ${money(lost)}` : ""}.` });
  for (const offer of completedNow) await notifyManagers(db, String(campaign.companyId), `${text(offer.get("driverName"))} concluiu a operação ${text(offer.get("contractName")) || text(campaign.name)} no prazo. O pagamento entra na próxima folha.`, `${offer.id}_done`, { type: "REWARD_COMPLETED", title: "Operação concluída" });
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
async function notifyManagers(db: DB, companyId: string, message: string, refId: string, kind: { type: string; title: string } = { type: "REWARD_CAP", title: "Teto da campanha atingido" }) {
  try {
    const targets = await managerIds(db, companyId);
    await Promise.all(targets.map(userId => db.collection("notifications").doc(`${kind.type}_${refId}_${userId}`).set({ userId, companyId, targetProfile: "admin", type: kind.type, title: kind.title, message,
      titulo: kind.title, mensagem: message, tipo: kind.type, metadata: { campaignId: refId }, dedupeKey: `${kind.type}_${refId}`, schemaVersion: 3, read: false, lida: false, createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: false }).catch(() => undefined)));
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
    const acceptedAt = Date.now(), days = Math.max(0, Math.floor(Number(offer.deadlineDays) || 0)), dispatched = Boolean(text(offer.jobId)) && Number(offer.deadlineMs) > 0;
    if (decision === "accept" && dispatched && Number(offer.deadlineMs) < acceptedAt) fail("failed-precondition", "O prazo desta operação já terminou. Não há pagamento para este trabalho.");
    // Prazo da operação: trabalho encaminhado usa o prazo do próprio trabalho (a partir do encaminhamento); oferta antiga conta a partir do aceite. Sem concluir até lá, perde o pagamento.
    tx.update(ref, { status: target, respondedAt: now, updatedAt: now, ...(decision === "accept" ? { acceptedAtMs: acceptedAt, ...(!dispatched && days ? { deadlineMs: acceptedAt + days * DAY_MS, openDeadlineMs: acceptedAt + days * DAY_MS } : {}) } : {}) });
    if (decision === "accept") tx.update(campaignRef, { acceptedCount: admin.firestore.FieldValue.increment(1), updatedAt: now });
    return { replayed: false, offer };
  });
  if (!outcome.replayed) await notifyManagers(db, text(outcome.offer.companyId), `${text(outcome.offer.driverName)} ${decision === "accept" ? "aceitou" : "recusou"} a campanha ${text(outcome.offer.name)}.`, `${text(outcome.offer.campaignId)}_${uid}_${decision}`);
  if (!outcome.replayed && decision === "accept") await recomputeRewardCampaign(db, text(outcome.offer.campaignId));
  return { success: true, offerId, status: decision === "accept" ? "accepted" : "declined", replayed: outcome.replayed };
});

export const cancelRewardCampaign = functions.region(...CALLABLE_REGIONS).runWith({ timeoutSeconds: 120 }).https.onCall(async (raw, context) => {
  const uid = context.auth?.uid;
  if (!uid) fail("unauthenticated", "Faça login para continuar.");
  const db = admin.firestore(), campaignId = id((raw as Data | null)?.campaignId, "Campanha");
  const queued = await db.runTransaction(async tx => {
    const ref = db.collection(REWARD_CAMPAIGNS).doc(campaignId), snap = await tx.get(ref);
    if (!snap.exists) fail("not-found", "A campanha não foi encontrada.");
    const companyId = text(snap.get("companyId"));
    await requireCompanyManager(db, tx, context, companyId);
    if (snap.get("status") === "cancelled") return { companyId, jobs: [] as { jobId: string; driverId: string }[] };
    const pending = await tx.get(db.collection(REWARD_OFFERS).where("campaignId", "==", campaignId).where("status", "==", "pending"));
    const now = admin.firestore.FieldValue.serverTimestamp();
    pending.docs.forEach(row => tx.update(row.ref, { status: "cancelled", updatedAt: now }));
    tx.update(ref, { status: "cancelled", cancelledAt: now, updatedAt: now });
    return { companyId, jobs: pending.docs.map(row => ({ jobId: text(row.get("jobId")), driverId: text(row.get("driverId")) })).filter(row => row.jobId) };
  });
  // Trabalhos encaminhados que o motorista ainda não iniciou saem da fila dele (quem já iniciou continua; as viagens ficam registradas).
  for (const job of queued.jobs) { try { await executeOperationalCommand(db, { action: "cancel", companyId: queued.companyId, requestId: `rwx_${campaignId}_${job.driverId}`.slice(0, 120), jobId: job.jobId }, context); } catch (error) { functions.logger.warn("cancelRewardCampaign job", { campaignId, jobId: job.jobId, error: (error as Error).message }); } }
  return { success: true, campaignId };
});

/**
 * Exclui uma campanha CANCELADA do histórico da empresa (some das listas; os dados, os ganhos e os pagamentos já feitos ficam guardados).
 * Campanha em andamento não pode ser excluída: primeiro se encerra.
 */
export const hideRewardCampaign = functions.region(...CALLABLE_REGIONS).https.onCall(async (raw, context) => {
  const uid = context.auth?.uid;
  if (!uid) fail("unauthenticated", "Faça login para continuar.");
  const db = admin.firestore(), campaignId = id((raw as Data | null)?.campaignId, "Campanha");
  await db.runTransaction(async tx => {
    const ref = db.collection(REWARD_CAMPAIGNS).doc(campaignId), snap = await tx.get(ref);
    if (!snap.exists) fail("not-found", "A campanha não foi encontrada.");
    await requireCompanyManager(db, tx, context, text(snap.get("companyId")));
    if (snap.get("hidden") === true) return;
    if (snap.get("status") !== "cancelled") fail("failed-precondition", "Só campanhas canceladas podem ser excluídas do histórico. Encerre a campanha primeiro.");
    const now = admin.firestore.FieldValue.serverTimestamp();
    tx.update(ref, { hidden: true, hiddenAt: now, hiddenBy: uid, updatedAt: now });
  });
  return { success: true, campaignId };
});

/**
 * Edita uma campanha em andamento (nome, valor por viagem e meta de ganhos). Vale para todos os motoristas que ainda podem receber e cada um é avisado do que mudou.
 * O valor por viagem não muda depois que já existe pagamento gerado (folha): o que foi pago não pode ser reescrito.
 */
export const updateRewardCampaign = functions.region(...CALLABLE_REGIONS).runWith({ timeoutSeconds: 120 }).https.onCall(async (raw, context) => {
  const uid = context.auth?.uid;
  if (!uid) fail("unauthenticated", "Faça login para continuar.");
  const db = admin.firestore(), data = raw && typeof raw === "object" ? raw as Data : {}, campaignId = id(data.campaignId, "Campanha");
  const outcome = await db.runTransaction(async tx => {
    const ref = db.collection(REWARD_CAMPAIGNS).doc(campaignId), snap = await tx.get(ref);
    if (!snap.exists) fail("not-found", "A campanha não foi encontrada.");
    const campaign = snap.data() || {}, companyId = text(campaign.companyId);
    await requireCompanyManager(db, tx, context, companyId);
    if (campaign.status !== "active") fail("failed-precondition", "Esta campanha foi encerrada e não pode mais ser editada.");
    const revision = Number(campaign.revision) || 1;
    if (data.expectedRevision !== undefined && Number(data.expectedRevision) !== revision) fail("aborted", "A campanha foi alterada em outro lugar. Atualize a tela e tente de novo.");
    const checked = normalizeCampaign({ name: data.name ?? campaign.name, perTripCents: data.perTripCents ?? campaign.perTripCents, goalCents: data.goalCents ?? campaign.goalCents, audience: "all", contractId: campaign.contractId }, Date.now());
    const changes: string[] = [], patch: Data = {};
    if (checked.name !== text(campaign.name)) { patch.name = checked.name; changes.push(`Nome: ${checked.name}`); }
    if (checked.perTripCents !== Number(campaign.perTripCents)) { patch.perTripCents = checked.perTripCents; changes.push(`Valor por viagem: ${money(Number(campaign.perTripCents) || 0)} → ${money(checked.perTripCents)}`); }
    if (checked.goalCents !== (Number(campaign.goalCents) || 0)) { patch.goalCents = checked.goalCents; changes.push(`Meta de ganhos: ${Number(campaign.goalCents) ? money(Number(campaign.goalCents)) : "sem meta"} → ${checked.goalCents ? money(checked.goalCents) : "sem meta"}`); }
    if (!changes.length) fail("failed-precondition", "Nenhuma alteração para salvar.");
    const offers = await tx.get(db.collection(REWARD_OFFERS).where("campaignId", "==", campaignId));
    if (patch.perTripCents !== undefined && offers.docs.some(row => (Number(row.get("settledCents")) || 0) > 0)) fail("failed-precondition", "Já existe pagamento gerado nesta campanha. Só dá para mudar o nome e a meta.");
    const livePayments = patch.perTripCents !== undefined ? await tx.get(db.collection("rewardPayments").where("companyId", "==", companyId).where("status", "in", ["pending", "paid", "contested"])) : null;
    if (livePayments?.docs.some(row => (Array.isArray(row.get("items")) ? row.get("items") : []).some((item: Data) => text(item.campaignId) === campaignId))) fail("failed-precondition", "Há pagamento desta campanha na folha. Conclua ou cancele o pagamento antes de mudar o valor por viagem.");
    const now = admin.firestore.FieldValue.serverTimestamp(), next = revision + 1, live = offers.docs.filter(row => ["pending", "accepted"].includes(text(row.get("status"))));
    const merged = { perTripCents: Number(patch.perTripCents ?? campaign.perTripCents), bonusCents: Number(campaign.bonusCents) || 0, maxTripsPerDriver: Number(campaign.maxTripsPerDriver) || 0 };
    const campaignPatch: Data = { ...patch, revision: next, updatedAt: now };
    if (patch.perTripCents !== undefined) campaignPatch.budgetCents = Math.max(merged.perTripCents, campaignBudget(merged, Number(campaign.driversCount) || live.length));
    tx.update(ref, campaignPatch);
    live.forEach(row => tx.update(row.ref, { ...patch, revision: next, changedAtMs: Date.now(), changeNote: changes.join(" · ").slice(0, 400), updatedAt: now }));
    return { companyId, name: checked.name, changes, revision: next, drivers: live.map(row => text(row.get("driverId"))), company: text(campaign.companyName) };
  });
  await notifyUsers(db, outcome.drivers, { type: "REWARD_UPDATED", refId: `${campaignId}_r${outcome.revision}`, companyId: outcome.companyId, title: "Pagamento alterado",
    message: `${outcome.company || "A empresa"} alterou as condições de ${outcome.name}. ${outcome.changes.join("; ")}.` });
  await recomputeRewardCampaign(db, campaignId);
  return { success: true, campaignId, revision: outcome.revision, notified: outcome.drivers.length };
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

/** Todo dia às 7h30 (Brasília): fecha as ofertas com prazo vencido (o motorista perde o pagamento e é avisado) e avisa quem está perto do prazo. */
export const rewardDeadlineTick = functions.runWith({ timeoutSeconds: 300 }).pubsub.schedule("30 7 * * *").timeZone("America/Sao_Paulo").onRun(async () => {
  const db = admin.firestore(), now = Date.now(), campaigns = new Set<string>();
  (await db.collection(REWARD_OFFERS).where("openDeadlineMs", "<", now).get()).docs.forEach(row => { if (row.get("status") === "accepted") campaigns.add(text(row.get("campaignId"))); });
  for (const campaignId of campaigns) { try { await recomputeRewardCampaign(db, campaignId); } catch (error) { functions.logger.error("rewardDeadlineTick", { campaignId, error: (error as Error).message }); } }
  const soon = await db.collection(REWARD_OFFERS).where("openDeadlineMs", ">=", now).where("openDeadlineMs", "<", now + 36 * 3_600_000).get();
  for (const row of soon.docs.filter(item => item.get("status") === "accepted" && item.get("expired") !== true)) {
    await notifyUsers(db, [text(row.get("driverId"))], { type: "REWARD_DEADLINE_SOON", refId: row.id, companyId: text(row.get("companyId")), title: "Prazo termina em breve",
      message: `Conclua a operação ${text(row.get("contractName")) || text(row.get("name"))} até ${new Date(Number(row.get("openDeadlineMs")) - 3 * 3_600_000).toISOString().slice(8, 10)}/${new Date(Number(row.get("openDeadlineMs")) - 3 * 3_600_000).toISOString().slice(5, 7)} para receber. Depois do prazo, o pagamento é perdido.` });
  }
  return null;
});
