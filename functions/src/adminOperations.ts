import * as admin from "./firebaseAdmin";
import * as functions from "firebase-functions/v1";
import { requireCompanyManager } from "./companyAccess";
import { approveFleetMemberCore } from "./fleetMembership";

const db = admin.firestore();

type CallableContext = functions.https.CallableContext;
type RecordData = Record<string, any>;

type OperationResult = {
  success: true;
  status: "approved" | "rejected";
  requestId?: string;
  applicationId?: string;
  companyId: string;
  userId?: string;
};

function nonEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedEmail(value: unknown): string {
  return nonEmpty(value).toLowerCase();
}

function requireId(data: unknown, key: string): string {
  const value = nonEmpty((data as RecordData | undefined)?.[key]);
  if (!value) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      `${key} é obrigatório.`,
    );
  }
  return value;
}

function safeNotificationId(parts: string[]): string {
  return parts
    .map((part) => part.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 300))
    .join("_")
    .slice(0, 1400);
}

function notificationPayload(params: {
  targetUserId: string;
  companyId: string;
  type: "DRIVER_REQUEST_APPROVED" | "DRIVER_REQUEST_REJECTED" | "RECRUITMENT_APPROVED" | "RECRUITMENT_REJECTED";
  title: string;
  message: string;
  eventId: string;
  actorUserId: string;
}) {
  return {
    userId: params.targetUserId,
    companyId: params.companyId,
    type: params.type,
    title: params.title,
    message: params.message,
    targetProfile: "driver",
    metadata: { eventId: params.eventId },
    titulo: params.title,
    mensagem: params.message,
    tipo: params.type,
    lida: false,
    read: false,
    actorUserId: params.actorUserId,
    dedupeKey: `${params.type}_${params.eventId}`,
    schemaVersion: 3,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAtIso: new Date().toISOString(),
  };
}

function requireAuthenticated(context: CallableContext): string {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Autenticação obrigatória.",
    );
  }
  return context.auth.uid;
}

async function assertCompanyManager(context: CallableContext, companyId: string): Promise<void> {
  await db.runTransaction(async tx => { await requireCompanyManager(db, tx, context, companyId); });
}

async function userRefByEmail(email: string) {
  if (!email) return null;
  const snapshot = await db
    .collection("users")
    .where("email", "==", email)
    .limit(1)
    .get();
  return snapshot.empty ? null : snapshot.docs[0].ref;
}

async function resolveRequestIdentity(
  request: RecordData,
): Promise<{ userId: string; userRef: FirebaseFirestore.DocumentReference }> {
  const requestUserId = nonEmpty(request.motoristaId || request.driverId);
  const requestEmail = normalizedEmail(request.email);
  if (requestUserId) {
    const ref = db.collection("users").doc(requestUserId);
    const snapshot = await ref.get();
    if (snapshot.exists) {
      const existingEmail = normalizedEmail(snapshot.data()?.email);
      if (!requestEmail || !existingEmail || existingEmail === requestEmail) {
        return { userId: requestUserId, userRef: ref };
      }
    }
  }

  const byEmail = await userRefByEmail(requestEmail);
  if (byEmail) return { userId: byEmail.id, userRef: byEmail };

  const created = db.collection("users").doc();
  return { userId: created.id, userRef: created };
}

export const approveDriverRequest = functions.https.onCall(async (data, context) => {
  const result = await approveFleetMemberCore(db, context, { requestId: requireId(data, "requestId"),
    ...(nonEmpty(data?.companyId) ? { companyId: nonEmpty(data.companyId) } : {}) });
  return { ...result, status: "approved" };
});

export const rejectDriverRequest = functions.https.onCall(
  async (data, context): Promise<OperationResult> => {
    const actorId = requireAuthenticated(context);
    const requestId = requireId(data, "requestId");
    const requestRef = db.collection("solicitacoes_motoristas").doc(requestId);
    const firstSnapshot = await requestRef.get();
    if (!firstSnapshot.exists) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Solicitação de motorista não encontrada.",
      );
    }
    const first = firstSnapshot.data() || {};
    const companyId = nonEmpty(first.empresaId || first.companyId);
    const driverId = nonEmpty(first.motoristaId || first.driverId);
    await assertCompanyManager(context, companyId);
    if (!driverId) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "A solicitação não possui motorista identificado.",
      );
    }

    const notificationRef = db
      .collection("notifications")
      .doc(safeNotificationId([driverId, "DRIVER_REQUEST_REJECTED", requestId]));
    await db.runTransaction(async (transaction) => {
      await requireCompanyManager(db, transaction, context, companyId);
      const requestSnapshot = await transaction.get(requestRef);
      if (!requestSnapshot.exists) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Solicitação de motorista não encontrada.",
        );
      }
      const request = requestSnapshot.data() || {};
      const currentCompanyId = nonEmpty(request.empresaId || request.companyId);
      const currentDriverId = nonEmpty(request.motoristaId || request.driverId);
      if (currentCompanyId !== companyId || currentDriverId !== driverId) {
        throw new functions.https.HttpsError(
          "aborted",
          "A solicitação mudou enquanto era processada. Tente novamente.",
        );
      }
      const notificationSnapshot = await transaction.get(notificationRef);
      if (request.status !== "rejected") {
        transaction.set(
          requestRef,
          {
            status: "rejected",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            rejectedBy: actorId,
            rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
      if (!notificationSnapshot.exists) {
        transaction.set(
          notificationRef,
          notificationPayload({
          targetUserId: driverId,
          companyId,
          type: "DRIVER_REQUEST_REJECTED",
          title: "Solicitação recusada",
          message: "Sua solicitação de entrada na empresa foi recusada.",
          eventId: requestId,
          actorUserId: actorId,
          }),
          { merge: true },
        );
      }
    });

    return { success: true, status: "rejected", requestId, companyId, userId: driverId };
  },
);

export const approveRecruitmentApplication = functions.https.onCall(async (data, context) => {
  const result = await approveFleetMemberCore(db, context, { applicationId: requireId(data, "applicationId"),
    ...(nonEmpty(data?.companyId) ? { companyId: nonEmpty(data.companyId) } : {}) });
  return { ...result, status: "approved" };
});

export const rejectRecruitmentApplication = functions.https.onCall(
  async (data, context): Promise<OperationResult> => {
    const actorId = requireAuthenticated(context);
    const applicationId = requireId(data, "applicationId");
    const applicationRef = db
      .collection("recruitment_applications")
      .doc(applicationId);
    const firstSnapshot = await applicationRef.get();
    if (!firstSnapshot.exists) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Candidatura não encontrada.",
      );
    }
    const first = firstSnapshot.data() || {};
    if (nonEmpty(first.type) === "company_registration") {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Esta solicitação pertence ao fluxo de empresa, não ao RH de motoristas.",
      );
    }
    const companyId = nonEmpty(first.companyId);
    await assertCompanyManager(context, companyId);
    const identity = await resolveRequestIdentity(first);
    const notificationRef = db
      .collection("notifications")
      .doc(safeNotificationId([identity.userId, "RECRUITMENT_REJECTED", applicationId]));

    await db.runTransaction(async (transaction) => {
      await requireCompanyManager(db, transaction, context, companyId);
      const applicationSnapshot = await transaction.get(applicationRef);
      if (!applicationSnapshot.exists) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Candidatura não encontrada.",
        );
      }
      const application = applicationSnapshot.data() || {};
      if (nonEmpty(application.companyId) !== companyId) throw new functions.https.HttpsError("aborted", "A empresa da inscrição mudou. Tente novamente.");
      const userSnapshot = await transaction.get(identity.userRef);
      const notificationSnapshot = await transaction.get(notificationRef);

      if (application.status !== "rejected") {
        transaction.set(
          applicationRef,
          {
            status: "rejected",
            rejectedBy: actorId,
            rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }

      if (
        userSnapshot.exists &&
        nonEmpty(userSnapshot.data()?.currentRecruitmentApplicationId) === applicationId
      ) {
        transaction.set(
          identity.userRef,
          {
            currentRecruitmentStatus: "rejected",
            currentRecruitmentType: "driver_application",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }

      if (!notificationSnapshot.exists) {
        transaction.set(
          notificationRef,
          notificationPayload({
          targetUserId: identity.userId,
          companyId,
          type: "RECRUITMENT_REJECTED",
          title: "Solicitação recusada",
          message: "Sua solicitação para a empresa foi recusada.",
          eventId: applicationId,
          actorUserId: actorId,
          }),
          { merge: true },
        );
      }
    });

    return {
      success: true,
      status: "rejected",
      applicationId,
      companyId,
      userId: identity.userId,
    };
  },
);
