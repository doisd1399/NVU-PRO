import * as functions from "firebase-functions/v1";
import * as admin from "./firebaseAdmin";

const db = () => admin.firestore();
const STATES = new Set([
  "IDLE",
  "WAITING_FREIGHT",
  "CONFIRMING_FREIGHT",
  "TRIP_IN_PROGRESS",
  "RESULT_DETECTED",
  "AWAITING_BONUS_VALIDATION",
  "RESULT_CONFIRMED",
  "REJECTED_BONUS",
  "CANCELLED",
]);

const transitions: Record<string, Set<string>> = {
  IDLE: new Set(["WAITING_FREIGHT", "CANCELLED"]),
  WAITING_FREIGHT: new Set(["CONFIRMING_FREIGHT", "CANCELLED", "IDLE"]),
  CONFIRMING_FREIGHT: new Set(["TRIP_IN_PROGRESS", "WAITING_FREIGHT", "CANCELLED", "IDLE"]),
  TRIP_IN_PROGRESS: new Set(["RESULT_DETECTED", "REJECTED_BONUS", "WAITING_FREIGHT", "CANCELLED"]),
  RESULT_DETECTED: new Set(["AWAITING_BONUS_VALIDATION", "RESULT_CONFIRMED", "REJECTED_BONUS", "WAITING_FREIGHT", "CANCELLED"]),
  AWAITING_BONUS_VALIDATION: new Set(["RESULT_CONFIRMED", "REJECTED_BONUS", "RESULT_DETECTED", "WAITING_FREIGHT", "CANCELLED"]),
  RESULT_CONFIRMED: new Set(["IDLE", "WAITING_FREIGHT", "CANCELLED"]),
  REJECTED_BONUS: new Set(["IDLE", "WAITING_FREIGHT", "CANCELLED"]),
  CANCELLED: new Set(["IDLE", "WAITING_FREIGHT"]),
};

const text = (value: unknown, max = 240) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";

const assertState = (state: string) => {
  if (!STATES.has(state)) throw new functions.https.HttpsError("invalid-argument", "Estado GTO inválido.");
};

const sessionRef = (sessionId: string) => db().collection("gto_trip_sessions").doc(sessionId);
const activeRef = (driverId: string) => db().collection("gto_active_gto_sessions").doc(driverId);

export const syncGtoTripState = functions.region("us-central1").https.onCall(async (rawData: any, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError("unauthenticated", "Autenticação obrigatória.");

  const sessionId = text(rawData?.sessionId, 160);
  const driverId = text(rawData?.driverId, 220);
  const companyId = text(rawData?.companyId, 220);
  const jobId = text(rawData?.jobId, 220);
  const state = text(rawData?.state, 60).toUpperCase();
  const expectedState = text(rawData?.expectedState, 60).toUpperCase();
  const reason = text(rawData?.reason, 500);
  const selectedRow = Number.isFinite(Number(rawData?.selectedRow)) ? Math.trunc(Number(rawData.selectedRow)) : -1;

  if (!sessionId || !/^[A-Za-z0-9_-]{8,160}$/.test(sessionId)) {
    throw new functions.https.HttpsError("invalid-argument", "Sessão GTO inválida.");
  }
  if (!driverId || driverId !== uid) throw new functions.https.HttpsError("permission-denied", "Motorista inválido.");
  assertState(state);

  const ref = sessionRef(sessionId);
  const now = admin.firestore.FieldValue.serverTimestamp();

  const result = await db().runTransaction(async (tx) => {
    const currentSnap = await tx.get(ref);
    const current = currentSnap.exists ? (currentSnap.data() || {}) : null;
    const currentState = text(current?.state, 60).toUpperCase() || "IDLE";

    // HF58 Cost Safe: a lost callable response must be idempotent. If the first
    // transaction already committed the requested target state, the retry returns
    // success without another pair of Firestore writes or an ABORTED retry loop.
    if (currentSnap.exists && currentState === state) {
      return { previousState: currentState, state, duplicate: true };
    }

    const bootstrapState = !currentSnap.exists && (state === "WAITING_FREIGHT" || state === "IDLE");
    if (!currentSnap.exists && state !== "WAITING_FREIGHT" && state !== "IDLE") {
      throw new functions.https.HttpsError("failed-precondition", "A sessão precisa começar em WAITING_FREIGHT.");
    }
    if (expectedState && !bootstrapState && expectedState !== currentState) {
      throw new functions.https.HttpsError("aborted", "O estado remoto mudou antes desta transição.");
    }
    if (currentSnap.exists && currentState !== state && !transitions[currentState]?.has(state)) {
      throw new functions.https.HttpsError("failed-precondition", `Transição remota inválida: ${currentState} -> ${state}`);
    }

    const activePointer = await tx.get(activeRef(uid));
    const activeSessionId = text(activePointer.data()?.sessionId, 160);

    if (state === "WAITING_FREIGHT" && activeSessionId && activeSessionId !== sessionId) {
      tx.set(sessionRef(activeSessionId), {
        state: "CANCELLED",
        active: false,
        cancellationReason: "REPLACED_BY_NEW_FREIGHT_SESSION",
        cancelledAt: now,
        updatedAt: now,
      }, { merge: true });
    }

    const terminal = ["RESULT_CONFIRMED", "REJECTED_BONUS", "CANCELLED"].includes(state);
    tx.set(ref, {
      sessionId,
      driverId: uid,
      companyId: companyId || text(current?.companyId),
      jobId: jobId || text(current?.jobId),
      state,
      reason,
      selectedRow: selectedRow >= 0 ? selectedRow : (typeof current?.selectedRow === "number" ? current.selectedRow : null),
      active: !terminal,
      stateVersion: admin.firestore.FieldValue.increment(1),
      updatedAt: now,
      lastHeartbeatAt: now,
      source: "GTO_NATIVE_ANDROID",
    }, { merge: true });
    tx.set(activeRef(uid), {
      sessionId: terminal ? null : sessionId,
      driverId: uid,
      state,
      active: !terminal,
      updatedAt: now,
    }, { merge: true });

    return { previousState: currentState, state };
  });

  return { success: true, sessionId, ...result };
});
