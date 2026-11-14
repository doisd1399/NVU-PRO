import { managedOperationRevisionPatch } from "./operationSnapshotFields";
import { buildCanonicalOperationProjection, field, latestConfirmedTripId, active } from "./canonicalOperationProjection";
import { isInvalidLowValueGtoPrint } from "./gtoLowValuePolicy";
import { isCanonicalConfirmedTrip } from "./isCanonicalConfirmedTrip";
import * as admin from "./firebaseAdmin";
import * as functions from "firebase-functions/v1";

type RecordData = FirebaseFirestore.DocumentData;
type RepairRequest = { jobId?: unknown; expectedTripId?: unknown; expectedProgress?: unknown };
type Diagnostic = {
  uidPresent: boolean;
  appCheckPresent: boolean;
  jobFound: boolean;
  driverIdMatches: boolean | null;
  progress: number | null;
  lastValidatedTripIdPresent: boolean;
  tripFound: boolean;
  stage: string;
  decision: string;
  errorCode: string | null;
};
const str = (data: RecordData, ...keys: string[]) => field(data, ...keys);
const fail = (message: string): never => {
  throw new functions.https.HttpsError("failed-precondition", message);
};

/**
 * Reconcile only the exact invalid legacy Print row captured by the pending Pro
 * attempt. The counter is diagnostic; deletion rebuilds the job projection from
 * the remaining confirmed history and records the divergence in an audit row.
 */
export const repairInvalidGtoPrintProgress = functions.region("us-central1").https.onCall(
  async (raw: unknown, context) => {
    const uid = context.auth?.uid;
    const diagnostic: Diagnostic = {
      uidPresent: Boolean(uid), appCheckPresent: Boolean(context.app),
      jobFound: false, driverIdMatches: null, progress: null,
      lastValidatedTripIdPresent: false, tripFound: false,
      stage: "AUTH", decision: "REJECTED", errorCode: null,
    };
    try {
      if (!uid) throw new functions.https.HttpsError("unauthenticated", "Faça login para retomar a viagem.");
      diagnostic.stage = "ARGUMENT";
      const { jobId, expectedTripId, expectedProgress } = (raw || {}) as RepairRequest;
      if (typeof jobId !== "string" || !/^[A-Za-z0-9_-]{8,180}$/.test(jobId) ||
          typeof expectedTripId !== "string" || !expectedTripId.startsWith(`print:${jobId}:`) ||
          expectedTripId.length > 400 || !Number.isInteger(expectedProgress) ||
          typeof expectedProgress !== "number" || expectedProgress < 0 || expectedProgress > 10000) {
        throw new functions.https.HttpsError("invalid-argument", "Contexto da operação inválido.");
      }
      const db = admin.firestore();
      const jobRef = db.collection("trabalhos").doc(jobId);
      const tripRef = db.collection("historico_viagens").doc(expectedTripId);
      const slotRef = db.collection("trip_operation_slots").doc(expectedTripId);
      const auditRef = db.collection("trip_deletion_audits")
        .doc(`gto-low-ocr-${expectedTripId.replace(/[^A-Za-z0-9_-]/g, "_")}`);
      const now = admin.firestore.FieldValue.serverTimestamp();
      const result = await db.runTransaction(async (tx) => {
        diagnostic.stage = "JOB_AND_HISTORY_READ";
        const [jobDoc, tripDoc, slotDoc, auditDoc, byJob] = await Promise.all([
          tx.get(jobRef), tx.get(tripRef), tx.get(slotRef), tx.get(auditRef),
          // Repair is constrained to the exact physical execution.
          tx.get(db.collection("historico_viagens").where("jobId", "==", jobId)),
        ]);
        diagnostic.jobFound = jobDoc.exists;
        diagnostic.tripFound = tripDoc.exists;
        if (!jobDoc.exists) throw new functions.https.HttpsError("not-found", "Operação não encontrada.");
        const job = jobDoc.data() || {};
        diagnostic.stage = "DRIVER_MATCH";
        diagnostic.driverIdMatches = str(job, "driverId", "motoristaId", "userId") === uid;
        if (!diagnostic.driverIdMatches) {
          throw new functions.https.HttpsError("permission-denied", "Operação de outro motorista.");
        }
        diagnostic.progress = Number.isInteger(job.progress) ? Number(job.progress) : null;
        diagnostic.lastValidatedTripIdPresent = typeof job.lastValidatedTripId === "string" &&
          job.lastValidatedTripId.length > 0;

        const rows = new Map<string, { id: string; data: RecordData }>();
        for (const snapshot of byJob.docs) {
          if (!rows.has(snapshot.id)) rows.set(snapshot.id, { id: snapshot.id, data: snapshot.data() || {} });
        }
        const projection = buildCanonicalOperationProjection({
          physicalJobId: jobId,
          operation: { ...job, id: jobId },
          confirmedHistory: [...rows.values()],
        });
        const trip = tripDoc.data() || {};
        const slotNumber = Number(trip.operationSlot);
        const slotData = slotDoc.data() || {};
        const auditData = auditDoc.data() || {};
        const slotMatches = !slotDoc.exists || (
          str(slotData, "tripId", "canonicalTripId") === expectedTripId &&
          str(slotData, "jobId") === jobId &&
          slotData.operationSlot === slotNumber &&
          str(slotData, "driverId", "motoristaId") === uid
        );

        diagnostic.stage = "REPLAY_CHECK";
        // Lost ACK: only the same audited tombstone may be acknowledged twice.
        if (tripDoc.exists && trip.deleted === true && trip.status === "DELETED" && auditDoc.exists) {
          if (trip.invalidReason !== "GTO_PRINT_OCR_BELOW_1000" ||
              auditData.reason !== "GTO_PRINT_OCR_BELOW_1000" ||
              auditData.tripId !== expectedTripId || auditData.jobId !== jobId ||
              auditData.actorUserId !== uid || slotDoc.exists ||
              [...rows.values()].some((row) => row.id !== expectedTripId && active(row.data) &&
                Number(row.data.operationSlot) === slotNumber)) {
            return fail("Reparo anterior não pôde ser confirmado.");
          }
          diagnostic.decision = "ALREADY_REPAIRED";
          const rebuilt = buildCanonicalOperationProjection({
            physicalJobId: jobId,
            operation: { ...job, id: jobId },
            confirmedHistory: projection.confirmedTrips.filter((row) => row.id !== expectedTripId),
          });
          return { repaired: true, alreadyRepaired: true, progress: rebuilt.confirmedTripCount, reason: diagnostic.decision };
        }

        diagnostic.stage = "EXPECTED_STATE";
        if (!tripDoc.exists || trip.deleted === true || trip.status === "DELETED" || auditDoc.exists ||
            !slotMatches || !projection.confirmedTripIds.includes(expectedTripId)) {
          return fail("Operação, Print ou slot mudou; solicite reconciliação.");
        }
        diagnostic.stage = "PRINT_ELIGIBILITY";
        if (!isInvalidLowValueGtoPrint({ id: expectedTripId, ...trip }, projection, uid) ||
            !isCanonicalConfirmedTrip(trip, {
              operationId: jobId,
              driverId: str(job, "driverId", "motoristaId", "userId"),
              companyId: str(job, "companyId", "empresaId"),
              contractId: str(job, "contractId", "contratoId"),
            }) ||
            [...rows.values()].some((row) => row.id !== expectedTripId && active(row.data) &&
              Number(row.data.operationSlot) === slotNumber)) {
          return fail("O Print anterior não é um erro GTO isolado.");
        }

        const originalValueCents = typeof trip.valorCents === "number" ? trip.valorCents :
          typeof trip.valor === "number" ? Math.round(trip.valor * 100) : Number(trip.earnings);
        const rebuilt = buildCanonicalOperationProjection({
          physicalJobId: jobId,
          operation: { ...job, id: jobId },
          confirmedHistory: projection.confirmedTrips.filter((row) => row.id !== expectedTripId),
        });
        const latestTripId = latestConfirmedTripId(rebuilt);
        const totalDeliveries = Math.max(0, Number(job.totalDeliveries || 0));
        const currentLifecycle = String(job.status || "").trim().toLowerCase();
        const terminalLifecycle = [
          "completed", "finalized", "finalizado", "finalizada", "closed", "encerrado", "encerrada",
          "concluido", "concluida",
        ].includes(currentLifecycle);
        const rebuiltStatus = terminalLifecycle
          ? job.status
          : totalDeliveries > 0 && rebuilt.confirmedTripCount < totalDeliveries
            ? (currentLifecycle === "pending" && rebuilt.confirmedTripCount === 0 ? "pending" : "active")
            : job.status;
        diagnostic.stage = "WRITE_PENDING";
        tx.update(tripRef, {
          deleted: true, status: "DELETED", deletedAt: now, deletedBy: uid,
          updatedAt: now, serverUpdatedAt: now, invalidReason: "GTO_PRINT_OCR_BELOW_1000",
        });
        if (slotDoc.exists) tx.delete(slotRef);
        tx.update(jobRef, {
          ...managedOperationRevisionPatch(job),
          progress: rebuilt.confirmedTripCount,
          lastDeletedTripId: expectedTripId,
          ...(latestTripId ? { lastValidatedTripId: latestTripId } : { lastValidatedTripId: admin.firestore.FieldValue.delete() }),
          ...(rebuiltStatus && rebuiltStatus !== job.status ? { status: rebuiltStatus } : {}),
          progressUpdatedAt: now, operationProgressReconciled: true,
          operationReconciliationVersion: 4,
          operationProgressReconciledAt: now, operationProjectionRebuiltAt: now,
          operationProjectionSource: "confirmed-history",
        });
        tx.create(auditRef, {
          tripId: expectedTripId, jobId, driverId: uid,
          companyId: str(job, "companyId", "empresaId"), originalValueCents,
          previousProgress: diagnostic.progress, expectedProgress,
          confirmedProgressBefore: projection.confirmedTripCount,
          confirmedProgressAfter: rebuilt.confirmedTripCount,
          reason: "GTO_PRINT_OCR_BELOW_1000", actorUserId: uid,
          projectionRebuilt: true, createdAt: now, schemaVersion: 2,
        });
        diagnostic.decision = "REPAIRED";
        return { repaired: true, alreadyRepaired: false, progress: rebuilt.confirmedTripCount, reason: diagnostic.decision };
      });
      diagnostic.stage = "COMMITTED";
      functions.logger.info("gto_print_repair_decision", diagnostic);
      return result;
    } catch (error) {
      diagnostic.errorCode = error instanceof functions.https.HttpsError ? error.code : "internal";
      functions.logger.warn("gto_print_repair_decision", diagnostic);
      throw error;
    }
  },
);
