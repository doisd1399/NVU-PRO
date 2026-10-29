import * as admin from "./firebaseAdmin";
import * as functions from "firebase-functions/v1";
import { buildCanonicalOperationProjection, field } from "./canonicalOperationProjection";
import { operationCompletionPatch } from "./operationCompletion";
import { applyOperationalCompletion, readOperationalCompletion } from "./operationalCommands";

const validJobId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,180}$/.test(value);

/**
 * Explicit driver confirmation for a full canonical operation.
 *
 * The final trip only moves the job to `awaiting_completion`. This callable is
 * the single authenticated server boundary that performs the terminal
 * `completed` transition after re-validating the canonical trip ledger.
 */
export const completeCanonicalOperation = functions
  .region("us-central1")
  .https.onCall(async (input: unknown, context) => {
    const uid = context.auth?.uid;
    if (!uid) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Faça login para finalizar a operação.",
      );
    }

    const jobId = (input as { jobId?: unknown } | null)?.jobId;
    if (!validJobId(jobId)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Operação inválida.",
      );
    }

    const db = admin.firestore();
    return db.runTransaction(async (tx) => {
      const jobRef = db.collection("trabalhos").doc(jobId);
      const jobSnapshot = await tx.get(jobRef);
      if (!jobSnapshot.exists) {
        throw new functions.https.HttpsError(
          "not-found",
          "A operação não foi encontrada.",
        );
      }

      const job = jobSnapshot.data() || {};
      const ownerId = field(job, "driverId", "motoristaId", "userId");
      if (ownerId !== uid) {
        throw new functions.https.HttpsError(
          "permission-denied",
          "Esta operação pertence a outro motorista.",
        );
      }
      if (job.deleted === true) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "A operação foi removida e não pode ser finalizada.",
        );
      }

      const lifecycle = String(job.status || "").trim().toLowerCase();
      if (lifecycle === "completed" && job.operationalCommandVersion === 1 &&
          job.operationStatusUpdatedByCanonicalGateway === true && job.manualCompletionConfirmedAt &&
          job.completionSource === "driver-explicit-confirmation") {
        return {
          completed: true,
          alreadyCompleted: true,
          operationalRevision: Number(job.operationalRevision || 0),
          jobId,
          status: "completed",
          progress: Math.max(0, Number(job.progress || 0)),
          total: Math.max(0, Number(job.totalDeliveries || 0)),
        };
      }
      if (["cancelled", "canceled"].includes(lifecycle)) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "A operação foi cancelada e não pode ser finalizada.",
        );
      }

      const contractId = field(job, "contractId", "contratoId");
      const companyId = field(job, "companyId", "empresaId");
      if (!contractId || !companyId) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "O vínculo canônico da operação está incompleto.",
        );
      }

      const contractRef = db.collection("contratos").doc(contractId);
      const contractSnapshot = await tx.get(contractRef);
      if (!contractSnapshot.exists) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "O contrato da operação não foi encontrado.",
        );
      }
      const contract = contractSnapshot.data() || {};
      if (field(contract, "companyId", "empresaId") !== companyId) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "O contrato não pertence à empresa da operação.",
        );
      }

      const total = Number(job.totalDeliveries ?? contract.totalDeliveries);
      if (!Number.isInteger(total) || total < 1) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "A quantidade prevista de viagens é inválida.",
        );
      }

      const historySnapshot = await tx.get(
        db.collection("historico_viagens").where("jobId", "==", jobId),
      );
      const projection = buildCanonicalOperationProjection({
        physicalJobId: jobId,
        operation: { ...job, id: jobId, totalDeliveries: total },
        confirmedHistory: historySnapshot.docs.map((row) => ({
          id: row.id,
          data: row.data(),
        })),
      });

      if (projection.confirmedTripCount < total) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "OPERATION_TRIPS_NOT_VALIDATED",
        );
      }
      if (projection.confirmedTripCount > total) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "OPERATION_CAPACITY_OVERFLOW",
        );
      }

      const terminalPatch = operationCompletionPatch(
        job,
        contract,
        projection.confirmedTripCount,
        total,
      );
      const coordination = await readOperationalCompletion(tx, db, job);
      const serverNow = admin.firestore.FieldValue.serverTimestamp();
      tx.update(jobRef, {
        ...terminalPatch,
        progress: projection.confirmedTripCount,
        completedAt: lifecycle === "completed" && job.completedAt ? job.completedAt : serverNow,
        manualCompletionConfirmedAt: serverNow,
        manualCompletionRequestedBy: uid,
        completionSource: "driver-explicit-confirmation",
        operationReadyForManualCompletion: false,
        operationProgressReconciled: true,
        operationProgressReconciledAt: serverNow,
        operationReconciliationVersion: 4,
        ...(job.operationalCommandVersion === 1 ? { operationalRevision: Number(job.operationalRevision || 0) + 1 } : {}),
      });
      applyOperationalCompletion(tx, jobId, job, coordination);

      return {
        completed: true,
        alreadyCompleted: lifecycle === "completed",
        operationalRevision: Number(job.operationalRevision || 0) + (job.operationalCommandVersion === 1 ? 1 : 0),
        jobId,
        status: "completed",
        progress: projection.confirmedTripCount,
        total,
      };
    });
  });
