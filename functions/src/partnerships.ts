import * as admin from "./firebaseAdmin";
import * as functions from "firebase-functions/v1";
import { createHash } from "node:crypto";
import { requireCompanyManager } from "./companyAccess";
import { driverDisplayIdentity } from "./driverDisplayIdentity";
import { resolveSimulatorCurrency } from "./simulatorCurrencyRegistry";
import { CALLABLE_REGIONS } from "./callableRegions";
import { executeOperationalCommand } from "./operationalCommands";
import { assertCompany, companySimulatorKey, fail, id, text } from "./operationalCommandPolicy";
import {
  MAX_PENDING_OFFERS, PARTNERSHIPS, buildLedger, computeSettlement, isPartnerAvailable, nextPayment, toMillis, type PaymentStatus, matchesRequirement, mayTransition, normalizeOffer, partnershipContractId,
  statusFromJob, type PartnershipStatus,
} from "./partnershipPolicy";

type Data = FirebaseFirestore.DocumentData;
type DB = FirebaseFirestore.Firestore;
const digest = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const TRAILERLESS = ["wbds", "pbs"];
const companyLabel = (company: Data): string => text(company.companyName) || text(company.name) || text(company.nome) || "Empresa";

/** Best effort: a notification failure never undoes the business action. */
async function notifyCompany(db: DB, companyId: string, payload: { type: string; title: string; message: string; partnershipId: string }) {
  try {
    const company = (await db.collection("frotas").doc(companyId).get()).data() || {};
    const members = await db.collection("companyMembers").where("companyId", "==", companyId).where("status", "==", "active").get();
    const targets = new Set<string>([text(company.ownerId), text(company.userId)]);
    members.docs.forEach(row => { const roles = [...(Array.isArray(row.get("roles")) ? row.get("roles") : []), row.get("role")]; if (roles.some(r => r === "admin" || r === "owner")) targets.add(text(row.get("userId"))); });
    targets.delete("");
    await Promise.all([...targets].map(userId => db.collection("notifications").doc(`${payload.type}_${payload.partnershipId}_${userId}`).set({
      userId, companyId, targetProfile: "admin", type: payload.type, title: payload.title, message: payload.message,
      titulo: payload.title, mensagem: payload.message, tipo: payload.type, metadata: { partnershipId: payload.partnershipId },
      dedupeKey: `${payload.type}_${payload.partnershipId}`, schemaVersion: 3, read: false, lida: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: false }).catch(() => undefined)));
  } catch { /* the offer itself is already saved */ }
}

export const createPartnershipOffer = functions.region(...CALLABLE_REGIONS).https.onCall(async (raw, context) => {
  const uid = context.auth?.uid;
  if (!uid) fail("unauthenticated", "Faça login para enviar a oferta.");
  const db = admin.firestore();
  const probe = raw && typeof raw === "object" ? raw as Data : {};
  const contractorId = id(probe.contractorCompanyId, "Empresa contratante"), executorId = id(probe.executorCompanyId, "Empresa parceira");
  const requestId = id(probe.requestId, "Pedido");
  const partnershipId = `po_${digest([uid, requestId]).slice(0, 40)}`;
  const result = await db.runTransaction(async tx => {
    const ref = db.collection(PARTNERSHIPS).doc(partnershipId);
    const [existing, contractor, executorSnap, pending] = await Promise.all([
      tx.get(ref), requireCompanyManager(db, tx, context, contractorId), tx.get(db.collection("frotas").doc(executorId)),
      tx.get(db.collection(PARTNERSHIPS).where("contractorCompanyId", "==", contractorId).where("status", "==", "pending").limit(MAX_PENDING_OFFERS + 1)),
    ]);
    const key = await companySimulatorKey(tx, db, contractor.company);
    const offer = normalizeOffer(probe, Date.now(), TRAILERLESS.includes(key));
    const fingerprint = digest([contractorId, executorId, offer.operationName, offer.totalTrips, offer.trailerRequirement, offer.durationDays, offer.conditions, offer.goalAmountCents, offer.agreedAmountCents]);
    if (existing.exists) {
      if (existing.get("createdBy") !== uid || existing.get("fingerprint") !== fingerprint) fail("failed-precondition", "Este pedido já foi utilizado com outros dados.");
      return { partnershipId, replayed: true };
    }
    assertCompany(contractor.company, false);
    if (!isPartnerAvailable(contractor.company)) fail("failed-precondition", "Sua empresa não está ativa para novas parcerias.");
    if (!executorSnap.exists) fail("not-found", "A empresa parceira não foi encontrada.");
    const executor = executorSnap.data() || {};
    assertCompany(executor, false);
    if (!isPartnerAvailable(executor)) fail("failed-precondition", "A empresa parceira não está ativa no sistema.");
    if (await companySimulatorKey(tx, db, executor) !== key) fail("failed-precondition", "A empresa parceira precisa ser do mesmo simulador.");
    if (pending.size > MAX_PENDING_OFFERS) fail("resource-exhausted", `Você já tem ${MAX_PENDING_OFFERS} ofertas aguardando resposta.`);
    const currency = resolveSimulatorCurrency({ simulatorId: key }).currency || "BRL";
    tx.create(ref, {
      schemaVersion: 1, status: "pending", revision: 1, fingerprint, contractorCompanyId: contractorId, executorCompanyId: executorId,
      contractorName: companyLabel(contractor.company), executorName: companyLabel(executor), simulatorId: key, currency,
      operationName: offer.operationName, totalTrips: offer.totalTrips,
      trailerRequirement: offer.trailerRequirement, durationDays: offer.durationDays, deadlineAt: null, deadlineMs: null, acceptedAt: null,
      conditions: offer.conditions, goalAmountCents: offer.goalAmountCents, agreedAmountCents: offer.agreedAmountCents, settlement: null, payment: null, createdBy: uid,
      progress: 0, earningsCents: 0, bestCents: 0, averageCents: 0, ledger: [], jobId: null, driverId: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { partnershipId, replayed: false, executorId, name: offer.operationName, contractorName: companyLabel(contractor.company), executorReady: executor.operationalCommandVersion === 1 };
  });
  const ready = (result as Data).executorReady !== false;
  if (!result.replayed) await notifyCompany(db, (result as Data).executorId, { type: "PARTNERSHIP_OFFER", partnershipId,
    title: "Nova oferta de parceria", message: `${(result as Data).contractorName} enviou a oferta ${(result as Data).name}.${ready ? "" : " Para aceitar, prepare a confirmação operacional da empresa em Operações."}` });
  // `executorReady` só avisa o app: a oferta vale mesmo que a parceira ainda precise preparar a confirmação operacional para aceitar.
  return { success: true, partnershipId, replayed: result.replayed, executorReady: ready };
});

export const respondPartnershipOffer = functions.region(...CALLABLE_REGIONS).https.onCall(async (raw, context) => {
  const uid = context.auth?.uid;
  if (!uid) fail("unauthenticated", "Faça login para responder à oferta.");
  const db = admin.firestore();
  const data = raw && typeof raw === "object" ? raw as Data : {};
  const partnershipId = id(data.partnershipId, "Oferta"), decision = text(data.decision);
  if (!["accept", "decline"].includes(decision)) fail("invalid-argument", "Resposta inválida.");
  const outcome = await db.runTransaction(async tx => {
    const ref = db.collection(PARTNERSHIPS).doc(partnershipId);
    const snap = await tx.get(ref);
    if (!snap.exists) fail("not-found", "A oferta não foi encontrada.");
    const p = snap.data() || {};
    const state = await requireCompanyManager(db, tx, context, text(p.executorCompanyId));
    const target: PartnershipStatus = decision === "accept" ? "accepted" : "declined";
    if (p.status === target) return { replayed: true, p };
    if (p.status !== "pending") fail("failed-precondition", "Esta oferta não está mais aguardando resposta.");
    if (decision === "accept") {
      if (!isPartnerAvailable(state.company)) fail("failed-precondition", "Sua empresa não está ativa para novos trabalhos.");
      assertCompany(state.company, false);
      if (state.company.operationalCommandVersion !== 1)
        fail("failed-precondition", "Para aceitar parcerias, a sua empresa precisa estar preparada para a confirmação operacional. Prepare-a em Operações (fila automática) e tente de novo.");
    }
    // O prazo da operação só começa a contar agora, no aceite: duração em dias a partir deste instante.
    const startsNow = decision === "accept" ? Date.now() : 0, days = Number(p.durationDays) || 0;
    const clock = decision === "accept" && days > 0 ? { deadlineMs: startsNow + days * 86_400_000, deadlineAt: new Date(startsNow + days * 86_400_000).toISOString(), acceptedAt: admin.firestore.FieldValue.serverTimestamp() } : {};
    tx.update(ref, { ...clock, status: target, respondedAt: admin.firestore.FieldValue.serverTimestamp(), respondedBy: uid,
      revision: Number(p.revision || 1) + 1, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    return { replayed: false, p };
  });
  if (!outcome.replayed) await notifyCompany(db, text(outcome.p.contractorCompanyId), { type: decision === "accept" ? "PARTNERSHIP_ACCEPTED" : "PARTNERSHIP_DECLINED", partnershipId,
    title: decision === "accept" ? "Oferta aceita" : "Oferta recusada",
    message: `${text(outcome.p.executorName)} ${decision === "accept" ? "aceitou" : "recusou"} a oferta ${text(outcome.p.operationName)}.` });
  return { success: true, partnershipId, status: decision === "accept" ? "accepted" : "declined", replayed: outcome.replayed };
});

export const cancelPartnershipOffer = functions.region(...CALLABLE_REGIONS).https.onCall(async (raw, context) => {
  const uid = context.auth?.uid;
  if (!uid) fail("unauthenticated", "Faça login para continuar.");
  const db = admin.firestore();
  const partnershipId = id((raw as Data | null)?.partnershipId, "Oferta");
  const outcome = await db.runTransaction(async tx => {
    const ref = db.collection(PARTNERSHIPS).doc(partnershipId);
    const snap = await tx.get(ref);
    if (!snap.exists) fail("not-found", "A oferta não foi encontrada.");
    const p = snap.data() || {};
    if (p.status === "cancelled") return { replayed: true, p };
    // The contractor withdraws a pending offer; the executor may give up an accepted offer that has no driver yet.
    const byContractor = p.status === "pending", byExecutor = p.status === "accepted" && !p.jobId;
    if (!byContractor && !byExecutor) fail("failed-precondition", "Esta oferta não pode mais ser cancelada aqui.");
    await requireCompanyManager(db, tx, context, text(byContractor ? p.contractorCompanyId : p.executorCompanyId));
    tx.update(ref, { status: "cancelled", cancelledAt: admin.firestore.FieldValue.serverTimestamp(), cancelledBy: uid,
      cancelledByCompanyId: byContractor ? p.contractorCompanyId : p.executorCompanyId, revision: Number(p.revision || 1) + 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    return { replayed: false, p, byContractor };
  });
  if (!outcome.replayed) await notifyCompany(db, text(outcome.byContractor ? outcome.p.executorCompanyId : outcome.p.contractorCompanyId), { type: "PARTNERSHIP_CANCELLED", partnershipId,
    title: "Oferta cancelada", message: `A oferta ${text(outcome.p.operationName)} foi cancelada.` });
  return { success: true, partnershipId, status: "cancelled", replayed: outcome.replayed };
});

/**
 * The executor picks a driver from its OWN team. The job is an ordinary job of the executor (same membership checks,
 * same trip validation); it only carries the partnership markers so the ranking credits the contractor.
 */
export const designatePartnershipDriver = functions.region(...CALLABLE_REGIONS).https.onCall(async (raw, context) => {
  const uid = context.auth?.uid;
  if (!uid) fail("unauthenticated", "Faça login para designar o motorista.");
  const db = admin.firestore();
  const data = raw && typeof raw === "object" ? raw as Data : {};
  const partnershipId = id(data.partnershipId, "Oferta"), driverId = id(data.driverId, "Motorista"), vehicleId = id(data.vehicleId, "Veículo");
  const trailerId = text(data.trailerId) || null;
  const prepared = await db.runTransaction(async tx => {
    const ref = db.collection(PARTNERSHIPS).doc(partnershipId);
    const snap = await tx.get(ref);
    if (!snap.exists) fail("not-found", "A oferta não foi encontrada.");
    const p = snap.data() || {};
    const executorId = text(p.executorCompanyId);
    const [state, vehicle, trailer] = await Promise.all([
      requireCompanyManager(db, tx, context, executorId), tx.get(db.collection("veiculos").doc(vehicleId)),
      trailerId ? tx.get(db.collection("reboques").doc(id(trailerId, "Reboque"))) : Promise.resolve(null)]);
    if (p.jobId) {
      if (p.driverId !== driverId) fail("failed-precondition", "Esta oferta já tem um motorista designado.");
      return { replayed: true, p, executorId };
    }
    if (p.status !== "accepted") fail("failed-precondition", "Aceite a oferta antes de designar o motorista.");
    if (Number(p.deadlineMs) <= Date.now()) fail("failed-precondition", "O prazo desta oferta já passou.");
    // O veículo é escolha da empresa que vai operar: qualquer veículo da PRÓPRIA frota (a oferta não exige veículo).
    if (!vehicle.exists || vehicle.get("companyId") !== executorId) fail("failed-precondition", "O veículo precisa ser da sua empresa.");
    // Reboque: obrigatório e conferido só quando a oferta exige; sem exigência, é opcional (sempre da própria frota).
    if (p.trailerRequirement) {
      if (!trailer || !trailer.exists || trailer.get("companyId") !== executorId) return fail("failed-precondition", "Escolha um reboque da sua empresa.");
      if (!matchesRequirement(p.trailerRequirement, text(trailer.get("name")))) fail("failed-precondition", `A oferta exige o reboque ${text(p.trailerRequirement)}.`);
    } else if (trailer && (!trailer.exists || trailer.get("companyId") !== executorId)) return fail("failed-precondition", "O reboque precisa ser da sua empresa.");
    const key = await companySimulatorKey(tx, db, state.company);
    // Simuladores sem reboque (ônibus) nunca carregam reboque, mesmo que o app envie um.
    const finalTrailerId = TRAILERLESS.includes(key) ? null : trailerId;
    const contractId = partnershipContractId(partnershipId);
    const contractRef = db.collection("contratos").doc(contractId);
    const contract = await tx.get(contractRef);
    if (contract.exists) tx.update(contractRef, { trailerId: finalTrailerId });
    if (!contract.exists) {
      // Not a catalog item: hidden from every list and from the automatic queues (id prefix + `partnershipId`).
      tx.create(contractRef, {
        companyId: executorId, empresaId: executorId, name: text(p.operationName), simulator: key, simulatorId: key, mode: "simple",
        totalDeliveries: Number(p.totalTrips), deadlineDays: 1, trailerId: finalTrailerId, deliveries: [], status: "partnership", deleted: false,
        partnership: true, partnershipId, contractorCompanyId: p.contractorCompanyId, scoreCompanyId: p.contractorCompanyId,
        partnershipDeadlineAt: p.deadlineAt, createdAt: admin.firestore.FieldValue.serverTimestamp(), schemaVersion: 1,
      });
    }
    return { replayed: false, p, executorId, contractId, trailerId: finalTrailerId };
  });
  if (prepared.replayed) return { success: true, partnershipId, jobId: prepared.p.jobId, replayed: true };
  // Standard, idempotent command: validates the driver's membership/suspension, the fleet and maintenance rules.
  const assigned = await executeOperationalCommand(db, { action: "assign", companyId: prepared.executorId, requestId: `pd_${partnershipId}`,
    contractId: prepared.contractId, driverId, vehicleId, trailerId: prepared.trailerId }, context);
  await db.runTransaction(async tx => {
    const ref = db.collection(PARTNERSHIPS).doc(partnershipId);
    const [snap, user] = await Promise.all([tx.get(ref), tx.get(db.collection("users").doc(driverId))]);
    const p = snap.data() || {};
    if (p.jobId && p.jobId !== assigned.jobId) return;
    const job = assigned.job || {};
    tx.update(ref, { jobId: assigned.jobId, jobContractId: prepared.contractId, driverId, driverName: driverDisplayIdentity(user.data() || {}).name,
      vehicleId, vehicleName: text(job.vehicleName), vehiclePlate: text(job.vehiclePlate), trailerName: text(job.trailerName),
      designatedAt: admin.firestore.FieldValue.serverTimestamp(), designatedBy: uid, revision: Number(p.revision || 1) + 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  });
  return { success: true, partnershipId, jobId: assigned.jobId, replayed: false };
});

/** The partnership follows the physical job: status, driver, vehicle, start photo and dates. */
async function projectJob(db: DB, partnershipId: string, jobId: string, job: Data | undefined) {
  if (!job) return;
  await db.runTransaction(async tx => {
    const ref = db.collection(PARTNERSHIPS).doc(partnershipId);
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const p = snap.data() || {};
    if (p.jobId && p.jobId !== jobId) return;
    const revision = Number(job.operationalRevision || 0);
    if (revision < Number(p.jobRevision || 0)) return;
    const next = statusFromJob(job.status);
    const patch: Data = { jobId, jobRevision: revision, driverId: text(job.driverId) || p.driverId || null, jobProgress: Number(job.progress || 0),
      vehicleName: text(job.vehicleName) || p.vehicleName || "", vehiclePlate: text(job.vehiclePlate) || p.vehiclePlate || "",
      trailerName: text(job.trailerName) || p.trailerName || "" };
    if (text(job.startVehiclePhotoUrl)) patch.startPhotoUrl = text(job.startVehiclePhotoUrl);
    if (job.startedAt) patch.startedAt = job.startedAt;
    if (job.completedAt) patch.completedAt = job.completedAt;
    if (next && mayTransition(p.status as PartnershipStatus, next)) patch.status = next;
    // Ao concluir, o app calcula o valor final (−25% fora do prazo) e abre a liquidação: a pagar (contratante) e a receber (executora).
    if (next === "completed" && p.status !== "completed" && !p.settlement) {
      const completedAtMs = toMillis(job.completedAt) || Date.now(), settlement = computeSettlement(p.agreedAmountCents, Number(p.deadlineMs) || 0, completedAtMs);
      patch.completedAtMs = completedAtMs;
      if (settlement) { patch.settlement = settlement; patch.payment = { status: "pending" as PaymentStatus }; }
    }
    patch.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    tx.update(ref, patch);
  });
}
export const syncPartnershipFromJob = functions.region("us-central1").runWith({ failurePolicy: true })
  .firestore.document("trabalhos/{jobId}").onWrite(async (change, context) => {
    const after = change.after.exists ? change.after.data() : undefined, before = change.before.exists ? change.before.data() : undefined;
    const partnershipId = text(after?.partnershipId) || text(before?.partnershipId);
    if (!partnershipId) return;
    await projectJob(admin.firestore(), partnershipId, context.params.jobId, after);
  });

/** Confirmed trips of the partnership, each counted once, drive progress, earnings and the results screen. */
export async function projectTrips(db: DB, partnershipId: string) {
  await db.runTransaction(async tx => {
    const ref = db.collection(PARTNERSHIPS).doc(partnershipId);
    const snap = await tx.get(ref);
    const p = snap.data();
    if (!snap.exists || !p?.jobId || !p.driverId) return;
    const rows = await tx.get(db.collection("historico_viagens").where("partnershipId", "==", partnershipId));
    const ledger = buildLedger(rows.docs.map(row => ({ id: row.id, data: row.data() })),
      { operationId: text(p.jobId), driverId: text(p.driverId), companyId: text(p.executorCompanyId), contractId: partnershipContractId(partnershipId) });
    const entries = ledger.entries.map(entry => ({ n: entry.n, at: entry.at, cents: entry.cents }));
    const same = p.progress === ledger.progress && p.earningsCents === ledger.earningsCents && JSON.stringify(p.ledger || []) === JSON.stringify(entries);
    if (same) return;
    tx.update(ref, { progress: ledger.progress, earningsCents: ledger.earningsCents, bestCents: ledger.bestCents, averageCents: ledger.averageCents,
      ledger: entries, lastTripAt: entries.length ? entries[entries.length - 1].at : null, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  });
}
export const syncPartnershipTrips = functions.region("us-central1").runWith({ failurePolicy: true })
  .firestore.document("historico_viagens/{tripId}").onWrite(async (change) => {
    const ids = new Set([text(change.before.data()?.partnershipId), text(change.after.data()?.partnershipId)].filter(Boolean));
    for (const partnershipId of ids) await projectTrips(admin.firestore(), partnershipId);
  });

/**
 * Liquidação do acordo (registro, sem mover dinheiro): a contratante marca "pago" e a executora confirma "recebido".
 * O valor vem do cálculo feito na conclusão; o NVU só acompanha e mostra a carteira das duas empresas.
 */
export const settlePartnershipPayment = functions.region(...CALLABLE_REGIONS).https.onCall(async (raw, context) => {
  const uid = context.auth?.uid;
  if (!uid) fail("unauthenticated", "Faça login para continuar.");
  const db = admin.firestore();
  const data = raw && typeof raw === "object" ? raw as Data : {};
  const partnershipId = id(data.partnershipId, "Parceria"), action = text(data.action);
  if (!["paid", "received"].includes(action)) fail("invalid-argument", "Ação inválida.");
  const outcome = await db.runTransaction(async tx => {
    const ref = db.collection(PARTNERSHIPS).doc(partnershipId);
    const snap = await tx.get(ref);
    if (!snap.exists) fail("not-found", "A parceria não foi encontrada.");
    const p = snap.data() || {};
    if (p.status !== "completed" || !p.settlement || !p.payment) fail("failed-precondition", "Esta parceria não tem valor a liquidar.");
    const contractorSide = action === "paid";
    await requireCompanyManager(db, tx, context, text(contractorSide ? p.contractorCompanyId : p.executorCompanyId));
    const current = text(p.payment.status) as PaymentStatus, target = nextPayment(current, action as "paid" | "received");
    if (!target) {
      if ((action === "paid" && current !== "pending") || (action === "received" && current === "settled")) return { replayed: true, p };
      fail("failed-precondition", "Este pagamento não pode mais ser alterado.");
    }
    const now = admin.firestore.FieldValue.serverTimestamp();
    tx.update(ref, { payment: { ...p.payment, status: target, ...(action === "paid" ? { paidAt: now, paidBy: uid } : { settledAt: now, settledBy: uid }) }, revision: Number(p.revision || 1) + 1, updatedAt: now });
    return { replayed: false, p, target };
  });
  if (!outcome.replayed) await notifyCompany(db, text(action === "paid" ? outcome.p.executorCompanyId : outcome.p.contractorCompanyId), { type: action === "paid" ? "PARTNERSHIP_PAID" : "PARTNERSHIP_SETTLED", partnershipId,
    title: action === "paid" ? "Pagamento informado" : "Recebimento confirmado",
    message: action === "paid" ? `${text(outcome.p.contractorName)} informou o pagamento da ${text(outcome.p.operationName)}. Confirme o recebimento.` : `${text(outcome.p.executorName)} confirmou o recebimento da ${text(outcome.p.operationName)}.` });
  return { success: true, partnershipId, status: (outcome as Data).target || text(outcome.p.payment?.status), replayed: outcome.replayed };
});
