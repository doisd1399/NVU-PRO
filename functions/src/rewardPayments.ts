/**
 * Recompensas, fase 2: folha de pagamento semanal, chave Pix do motorista, "pago" com comprovante, confirmação de recebimento e contestação.
 * O NVU organiza e registra: o dinheiro nunca passa por aqui (a empresa paga por Pix, fora do app).
 */
import * as admin from "./firebaseAdmin";
import * as functions from "firebase-functions/v1";
import { createHash } from "node:crypto";
import { requireCompanyManager } from "./companyAccess";
import { CALLABLE_REGIONS } from "./callableRegions";
import { fail, id, text } from "./operationalCommandPolicy";
import { normalizePixKey } from "./partnershipPolicy";
import { managerIds } from "./rewards";
import {
  MAX_PAYROLL_DRIVERS, REWARD_OFFERS, REWARD_PAYEES, REWARD_PAYMENTS, REWARD_SETTINGS, buildPayroll, dateBRT, maskPixKey, nextPaymentStatus, normalizeDispute, normalizeE2e, normalizePayDay, receiptNumber, weekdayBRT,
  type PaymentAction, type PaymentStatus,
} from "./rewardPolicy";

type Data = FirebaseFirestore.DocumentData;
type DB = FirebaseFirestore.Firestore;
const digest = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const companyLabel = (company: Data): string => text(company.companyName) || text(company.name) || text(company.nome) || "Empresa";
const money = (cents: number) => `R$ ${(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const WRITE_LIMIT = 450;

async function push(db: DB, userIds: string[], profile: "driver" | "admin", payload: { type: string; title: string; message: string; companyId: string; refId: string }) {
  await Promise.all([...new Set(userIds.filter(Boolean))].map(userId => db.collection("notifications").doc(`${payload.type}_${payload.refId}_${userId}`).set({
    userId, companyId: payload.companyId, targetProfile: profile, type: payload.type, title: payload.title, message: payload.message,
    titulo: payload.title, mensagem: payload.message, tipo: payload.type, metadata: { paymentId: payload.refId },
    dedupeKey: `${payload.type}_${payload.refId}`, schemaVersion: 3, read: false, lida: false, createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: false }).catch(() => undefined)));
}
const manager = async (db: DB, context: functions.https.CallableContext, companyId: string) => db.runTransaction(tx => requireCompanyManager(db, tx, context, companyId));

/** Dia da semana em que a empresa paga os motoristas (o NVU monta a folha nesse dia, 8h de Brasília). */
export const setRewardPayDay = functions.region(...CALLABLE_REGIONS).https.onCall(async (raw, context) => {
  const uid = context.auth?.uid;
  if (!uid) fail("unauthenticated", "Faça login para continuar.");
  const db = admin.firestore(), data = raw && typeof raw === "object" ? raw as Data : {};
  const companyId = id(data.companyId, "Empresa"), payDay = normalizePayDay(data.payDay);
  await manager(db, context, companyId);
  await db.collection(REWARD_SETTINGS).doc(companyId).set({ companyId, payDay, updatedBy: uid, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  return { success: true, payDay };
});

/** O motorista informa a chave Pix em que recebe. Folhas ainda não pagas passam a usar a chave nova. */
export const setRewardPix = functions.region(...CALLABLE_REGIONS).https.onCall(async (raw, context) => {
  const uid = context.auth?.uid;
  if (!uid) fail("unauthenticated", "Faça login para continuar.");
  const db = admin.firestore(), data = raw && typeof raw === "object" ? raw as Data : {};
  let pix: { type: string; key: string } = { type: "", key: "" };
  try { pix = normalizePixKey(data.type, data.key); } catch (error) { fail("invalid-argument", (error as Error).message); }
  await db.collection(REWARD_PAYEES).doc(uid as string).set({ userId: uid as string, pixType: pix.type, pixKey: pix.key, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  const open = await db.collection(REWARD_PAYMENTS).where("driverId", "==", uid).get();
  const batch = db.batch(); let writes = 0;
  open.docs.filter(row => row.get("status") === "pending" && row.get("pixKey") !== pix.key).slice(0, WRITE_LIMIT).forEach(row => { batch.update(row.ref, { pixType: pix.type, pixKey: pix.key, updatedAt: admin.firestore.FieldValue.serverTimestamp() }); writes++; });
  if (writes) await batch.commit();
  return { success: true, type: pix.type, key: pix.key, updated: writes };
});

type PayrollResult = { payrollId: string; payments: number; totalCents: number; replayed: boolean; partial: boolean };
/**
 * Monta a folha: o que cada motorista já ganhou nas campanhas aceitas e ainda não entrou em folha nenhuma.
 * Idempotente pelo `payrollId`; cada valor entra em uma só folha (o saldo de cada oferta é marcado como "em folha").
 */
export async function generatePayroll(db: DB, companyId: string, payrollId: string, source: "manual" | "auto", actor: string, authorize?: (tx: FirebaseFirestore.Transaction) => Promise<Data>): Promise<PayrollResult> {
  const now = Date.now();
  return db.runTransaction(async tx => {
    const existing = await tx.get(db.collection(REWARD_PAYMENTS).where("payrollId", "==", payrollId).limit(1));
    const company = authorize ? await authorize(tx) : ((await tx.get(db.collection("frotas").doc(companyId))).data() || {});
    if (!existing.empty) return { payrollId, payments: 0, totalCents: 0, replayed: true, partial: false };
    const offers = await tx.get(db.collection(REWARD_OFFERS).where("companyId", "==", companyId).where("status", "==", "accepted"));
    const lines = buildPayroll(offers.docs.map(row => ({ id: row.id, campaignId: text(row.get("campaignId")), campaignName: text(row.get("name")), driverId: text(row.get("driverId")),
      totalCents: Number(row.get("totalCents")) || 0, settledCents: Number(row.get("settledCents")) || 0 })));
    const names = new Map(offers.docs.map(row => [text(row.get("driverId")), text(row.get("driverName")) || "Motorista"]));
    const chosen: typeof lines = []; let writes = 0;
    for (const line of lines) { const cost = 1 + line.items.length; if (chosen.length >= MAX_PAYROLL_DRIVERS || writes + cost > WRITE_LIMIT) break; chosen.push(line); writes += cost; }
    const payees = chosen.length ? await tx.getAll(...chosen.map(line => db.collection(REWARD_PAYEES).doc(line.driverId))) : [];
    const pix = new Map(payees.map(row => [row.id, { type: text(row.get("pixType")), key: text(row.get("pixKey")) }]));
    const stamp = admin.firestore.FieldValue.serverTimestamp();
    let totalCents = 0;
    for (const line of chosen) {
      const payee = pix.get(line.driverId) || { type: "", key: "" };
      tx.create(db.collection(REWARD_PAYMENTS).doc(`${payrollId}_${line.driverId}`), { schemaVersion: 1, payrollId, payrollAtMs: now, source, companyId, companyName: companyLabel(company), driverId: line.driverId, driverName: names.get(line.driverId) || "Motorista",
        amountCents: line.amountCents, items: line.items, pixType: payee.type, pixKey: payee.key, status: "pending", payAttempts: 0, createdBy: actor, createdAt: stamp, updatedAt: stamp });
      for (const item of line.items) tx.update(db.collection(REWARD_OFFERS).doc(item.offerId), { settledCents: admin.firestore.FieldValue.increment(item.cents), updatedAt: stamp });
      totalCents += line.amountCents;
    }
    return { payrollId, payments: chosen.length, totalCents, replayed: false, partial: chosen.length < lines.length };
  }).then(async result => {
    if (!result.replayed && result.payments) {
      const rows = await db.collection(REWARD_PAYMENTS).where("payrollId", "==", payrollId).get();
      await Promise.all(rows.docs.map(row => push(db, [text(row.get("driverId"))], "driver", { type: "REWARD_PAYROLL", refId: row.id, companyId, title: "Recompensa a receber",
        message: `${text(row.get("companyName"))} gerou seu pagamento de ${money(Number(row.get("amountCents")) || 0)}. ${text(row.get("pixKey")) ? "O pagamento será feito por Pix na sua chave cadastrada." : "Cadastre sua chave Pix em Recompensas → Recebimentos para receber."}` })));
      if (source === "auto") await push(db, await managerIds(db, companyId), "admin", { type: "REWARD_PAYROLL_READY", refId: payrollId, companyId, title: "Folha de pagamento pronta",
        message: `A folha de hoje está pronta: ${money(result.totalCents)} para ${result.payments} ${result.payments === 1 ? "motorista" : "motoristas"}. Abra Recompensas → Folha para pagar por Pix.` });
    }
    return result;
  });
}

export const generateRewardPayroll = functions.region(...CALLABLE_REGIONS).runWith({ timeoutSeconds: 120 }).https.onCall(async (raw, context) => {
  const uid = context.auth?.uid;
  if (!uid) fail("unauthenticated", "Faça login para continuar.");
  const db = admin.firestore(), data = raw && typeof raw === "object" ? raw as Data : {};
  const companyId = id(data.companyId, "Empresa"), requestId = id(data.requestId, "Pedido");
  const result = await generatePayroll(db, companyId, `rp_${digest([uid, companyId, requestId]).slice(0, 32)}`, "manual", uid as string, async tx => (await requireCompanyManager(db, tx, context, companyId)).company);
  return { success: true, ...result };
});

/** Todo dia às 8h (Brasília): monta a folha das empresas cujo dia de pagamento é hoje e avisa o responsável. */
export const rewardPayDayTick = functions.runWith({ timeoutSeconds: 300 }).pubsub.schedule("0 8 * * *").timeZone("America/Sao_Paulo").onRun(async () => {
  const db = admin.firestore(), now = Date.now(), settings = await db.collection(REWARD_SETTINGS).where("payDay", "==", weekdayBRT(now)).get();
  for (const row of settings.docs) {
    const companyId = text(row.get("companyId")) || row.id;
    try { await generatePayroll(db, companyId, `rp_auto_${companyId}_${dateBRT(now)}`, "auto", "system"); }
    catch (error) { functions.logger.error("rewardPayDayTick", { companyId, error: (error as Error).message }); }
  }
  return null;
});

type Step = { payment: Data; company: Data };
/** Lê o pagamento e confirma quem pode agir (gestão da empresa ou o motorista dono) e se a ação vale no estado atual. */
async function step(db: DB, tx: FirebaseFirestore.Transaction, context: functions.https.CallableContext, paymentId: string, action: PaymentAction, by: "manager" | "driver"): Promise<Step & { ref: FirebaseFirestore.DocumentReference; target: PaymentStatus | null; replay: boolean }> {
  const ref = db.collection(REWARD_PAYMENTS).doc(paymentId), snap = await tx.get(ref);
  if (!snap.exists) fail("not-found", "O pagamento não foi encontrado.");
  const payment = snap.data() || {};
  let company: Data = {};
  if (by === "manager") company = (await requireCompanyManager(db, tx, context, text(payment.companyId))).company;
  else if (payment.driverId !== context.auth?.uid) fail("permission-denied", "Este pagamento não é seu.");
  const current = text(payment.status) as PaymentStatus, target = nextPaymentStatus(current, action);
  const final: Record<PaymentAction, PaymentStatus> = { pay: "paid", receive: "received", contest: "contested", cancel: "cancelled" };
  const replay = current === final[action];
  if (!target && !replay) fail("failed-precondition", current === "received" ? "Este pagamento já foi confirmado como recebido." : current === "cancelled" ? "Este pagamento foi cancelado." : "Esta ação não vale para a situação atual do pagamento.");
  return { ref, payment, company, target, replay };
}

/** A empresa marca como pago (depois de pagar o Pix no banco) e o NVU gera o comprovante para as duas partes. */
export const markRewardPaid = functions.region(...CALLABLE_REGIONS).https.onCall(async (raw, context) => {
  if (!context.auth?.uid) fail("unauthenticated", "Faça login para continuar.");
  const db = admin.firestore(), data = raw && typeof raw === "object" ? raw as Data : {}, paymentId = id(data.paymentId, "Pagamento"), e2eId = normalizeE2e(data.e2eId);
  const outcome = await db.runTransaction(async tx => {
    const found = await step(db, tx, context, paymentId, "pay", "manager");
    if (found.replay) return { replayed: true, payment: found.payment };
    const paidAtMs = Date.now(), p = found.payment;
    const receipt = { number: receiptNumber(paymentId, paidAtMs), paidAtMs, amountCents: Number(p.amountCents) || 0, payerName: text(p.companyName), payeeName: text(p.driverName), pixType: text(p.pixType), pixKeyMasked: maskPixKey(text(p.pixType), text(p.pixKey)), e2eId,
      campaigns: (Array.isArray(p.items) ? p.items : []).map((item: Data) => text(item.campaignName)).filter(Boolean) };
    const stamp = admin.firestore.FieldValue.serverTimestamp();
    tx.update(found.ref, { status: "paid", paidAtMs, receipt, payAttempts: (Number(p.payAttempts) || 0) + 1, contestReason: admin.firestore.FieldValue.delete(), contestedAtMs: admin.firestore.FieldValue.delete(), updatedAt: stamp });
    return { replayed: false, payment: p, receipt };
  });
  if (!outcome.replayed) await push(db, [text(outcome.payment.driverId)], "driver", { type: "REWARD_PAID", refId: `${paymentId}_${(outcome as any).receipt.paidAtMs}`, companyId: text(outcome.payment.companyId), title: "Pagamento enviado",
    message: `${text(outcome.payment.companyName)} marcou como pago ${money(Number(outcome.payment.amountCents) || 0)}. Confira na sua conta e confirme o recebimento em Recompensas → Recebimentos.` });
  return { success: true, paymentId, status: "paid", replayed: outcome.replayed };
});

/** O motorista confirma que o dinheiro chegou. É o fechamento: depois disso nada muda. */
export const confirmRewardReceived = functions.region(...CALLABLE_REGIONS).https.onCall(async (raw, context) => {
  if (!context.auth?.uid) fail("unauthenticated", "Faça login para continuar.");
  const db = admin.firestore(), paymentId = id((raw as Data | null)?.paymentId, "Pagamento");
  const outcome = await db.runTransaction(async tx => {
    const found = await step(db, tx, context, paymentId, "receive", "driver");
    if (found.replay) return { replayed: true, payment: found.payment };
    tx.update(found.ref, { status: "received", receivedAtMs: Date.now(), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    return { replayed: false, payment: found.payment };
  });
  if (!outcome.replayed) await push(db, await managerIds(db, text(outcome.payment.companyId)), "admin", { type: "REWARD_RECEIVED", refId: paymentId, companyId: text(outcome.payment.companyId), title: "Recebimento confirmado",
    message: `${text(outcome.payment.driverName)} confirmou o recebimento de ${money(Number(outcome.payment.amountCents) || 0)}.` });
  return { success: true, paymentId, status: "received", replayed: outcome.replayed };
});

/** O motorista diz que não recebeu ou que o valor não confere. A empresa responde pagando de novo (novo comprovante) ou cancelando o pagamento. */
export const contestRewardPayment = functions.region(...CALLABLE_REGIONS).https.onCall(async (raw, context) => {
  if (!context.auth?.uid) fail("unauthenticated", "Faça login para continuar.");
  const db = admin.firestore(), data = raw && typeof raw === "object" ? raw as Data : {}, paymentId = id(data.paymentId, "Pagamento"), reason = normalizeDispute(data.reason);
  const outcome = await db.runTransaction(async tx => {
    const found = await step(db, tx, context, paymentId, "contest", "driver");
    if (found.replay) return { replayed: true, payment: found.payment };
    tx.update(found.ref, { status: "contested", contestReason: reason, contestedAtMs: Date.now(), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    return { replayed: false, payment: found.payment };
  });
  if (!outcome.replayed) await push(db, await managerIds(db, text(outcome.payment.companyId)), "admin", { type: "REWARD_CONTESTED", refId: `${paymentId}_${Date.now()}`, companyId: text(outcome.payment.companyId), title: "Pagamento contestado",
    message: `${text(outcome.payment.driverName)} contestou o pagamento de ${money(Number(outcome.payment.amountCents) || 0)}: ${reason}` });
  return { success: true, paymentId, status: "contested", replayed: outcome.replayed };
});

/** Cancela um pagamento ainda não confirmado: o valor volta para o saldo e entra na próxima folha. */
export const cancelRewardPayment = functions.region(...CALLABLE_REGIONS).https.onCall(async (raw, context) => {
  if (!context.auth?.uid) fail("unauthenticated", "Faça login para continuar.");
  const db = admin.firestore(), paymentId = id((raw as Data | null)?.paymentId, "Pagamento");
  const outcome = await db.runTransaction(async tx => {
    const found = await step(db, tx, context, paymentId, "cancel", "manager");
    if (found.replay) return { replayed: true, payment: found.payment };
    const items: Data[] = Array.isArray(found.payment.items) ? found.payment.items : [];
    const offers = items.length ? await tx.getAll(...items.map(item => db.collection(REWARD_OFFERS).doc(text(item.offerId)))) : [];
    const stamp = admin.firestore.FieldValue.serverTimestamp();
    offers.forEach((offer, index) => { if (offer.exists) tx.update(offer.ref, { settledCents: Math.max(0, (Number(offer.get("settledCents")) || 0) - (Number(items[index].cents) || 0)), updatedAt: stamp }); });
    tx.update(found.ref, { status: "cancelled", cancelledAtMs: Date.now(), updatedAt: stamp });
    return { replayed: false, payment: found.payment };
  });
  if (!outcome.replayed) await push(db, [text(outcome.payment.driverId)], "driver", { type: "REWARD_CANCELLED", refId: `${paymentId}_${Date.now()}`, companyId: text(outcome.payment.companyId), title: "Pagamento cancelado",
    message: `${text(outcome.payment.companyName)} cancelou o pagamento de ${money(Number(outcome.payment.amountCents) || 0)}. O valor volta para a próxima folha.` });
  return { success: true, paymentId, status: "cancelled", replayed: outcome.replayed };
});
