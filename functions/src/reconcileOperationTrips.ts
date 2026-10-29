import { managedOperationRevisionPatch } from "./operationSnapshotFields";
import * as admin from "./firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import * as functions from "firebase-functions/v1";
import {
  active,
  buildCanonicalOperationProjection,
  field,
  latestConfirmedTripId,
} from "./canonicalOperationProjection";
import { isCanonicalConfirmedTrip } from "./isCanonicalConfirmedTrip";
import { decideReconciledProgress } from "./operationReconciliationPolicy";
import { operationAwaitingCompletionPatch } from "./operationCompletion";


const canonicalTripMetricMillis = (row: FirebaseFirestore.DocumentData): number => {
  for (const candidate of [row.completedAt, row.completedAtLocal, row.serverValidatedAt, row.uploadedAt, row.createdAt, row.createdAtLocal]) {
    if (!candidate) continue;
    if (candidate instanceof Date) return candidate.getTime();
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
    if (typeof candidate?.toMillis === "function") { const value = Number(candidate.toMillis()); if (Number.isFinite(value)) return value; }
    if (typeof candidate?.toDate === "function") { const value = candidate.toDate(); if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime(); }
    if (typeof candidate?.seconds === "number") { const value = Number(candidate.seconds) * 1000 + Number(candidate.nanoseconds || 0) / 1e6; if (Number.isFinite(value)) return value; }
  }
  return 0;
};

const integerSlot = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const structuralScopeMatches = (
  row: FirebaseFirestore.DocumentData,
  jobId: string,
  job: FirebaseFirestore.DocumentData,
): boolean => {
  if (field(row, "jobId") !== jobId) return false;
  if (field(row, "driverId", "motoristaId", "userId", "criadoPor") !== field(job, "driverId", "motoristaId", "userId")) return false;
  const rowCompany = field(row, "companyId", "empresaId");
  const rowContract = field(row, "contractId", "contratoId");
  const jobCompany = field(job, "companyId", "empresaId");
  const jobContract = field(job, "contractId", "contratoId");
  const source = field(row, "source").toLowerCase();
  const oldServerGtoShape = ["gto_auto", "simple_auto"].includes(source) &&
    row.serverValidatedAt == null && row.serverUpdatedAt == null && row.uploadedAt != null;
  if ((!rowCompany || !rowContract) && !oldServerGtoShape) return false;
  if (rowCompany && rowCompany !== jobCompany) return false;
  if (rowContract && rowContract !== jobContract) return false;
  return true;
};

// Missing legacy scope is historical debt, not a live-operation conflict.
// Only an explicitly present contradictory identity may block reconciliation.
const hasExplicitScopeContradiction = (
  row: FirebaseFirestore.DocumentData,
  jobId: string,
  job: FirebaseFirestore.DocumentData,
): boolean => {
  if (field(row, "jobId") !== jobId) return true;
  const expectedDriver = field(job, "driverId", "motoristaId", "userId");
  const expectedCompany = field(job, "companyId", "empresaId");
  const expectedContract = field(job, "contractId", "contratoId");
  const driver = field(row, "driverId", "motoristaId", "userId", "criadoPor");
  const company = field(row, "companyId", "empresaId");
  const contract = field(row, "contractId", "contratoId");
  return Boolean(
    (driver && expectedDriver && driver !== expectedDriver) ||
    (company && expectedCompany && company !== expectedCompany) ||
    (contract && expectedContract && contract !== expectedContract)
  );
};

/**
 * Reconcile an operation from confirmed history.
 *
 * V4 safety rule: only an exact jobId/driver/company/contract projection may
 * repair the denormalized counter. A terminal operation is never reopened.
 * Legacy rows without jobId remain visible to the audit/migration report but
 * are never attached or mutated by this operational reconciler.
 */
export const reconcileOperationTripsCore = async (
  db: FirebaseFirestore.Firestore,
  uid: string,
  jobId: string,
) => {
  const jobRef = db.collection("trabalhos").doc(jobId);
  return db.runTransaction(async (tx) => {
      const jobDoc = await tx.get(jobRef);
      if (!jobDoc.exists) throw new functions.https.HttpsError("not-found", "Operação não encontrada.");
      const job = jobDoc.data() || {};
      if (field(job, "driverId", "motoristaId", "userId") !== uid)
        throw new functions.https.HttpsError("permission-denied", "Operação de outro motorista.");

      const boundContractId = field(job, "contractId", "contratoId");
      const contractSnapshot = boundContractId
        ? await tx.get(db.collection("contratos").doc(boundContractId))
        : null;
      const contract = contractSnapshot?.exists ? (contractSnapshot.data() || {}) : {};

      // Operational reconciliation is scoped by the physical execution id only.
      // Legacy operationId/trabalhoId aliases belong to the read-only migration
      // audit and must never enter the live projection or block a new execution.
      const [byJob, claimsByJob] = await Promise.all([
        tx.get(db.collection("historico_viagens").where("jobId", "==", jobId)),
        tx.get(db.collection("trip_operation_slots").where("jobId", "==", jobId)),
      ]);

      const rows = new Map<string, FirebaseFirestore.DocumentData>();
      for (const row of byJob.docs) rows.set(row.id, row.data());

      const claims = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
      for (const row of claimsByJob.docs) claims.set(row.id, row);

      const confirmationScope = {
        operationId: jobId,
        driverId: field(job, "driverId", "motoristaId", "userId"),
        companyId: field(job, "companyId", "empresaId"),
        contractId: field(job, "contractId", "contratoId"),
      };
      const totalDeliveries = Math.max(0, Number(job.totalDeliveries || 0));

      // Non-canonical rows already bound to this physical job (pending/incomplete proof)
      // are excluded from the confirmed projection. LIVE reconciliation never
      // attributes or mutates legacy/unbound rows.
      // Historical attribution belongs exclusively to offline audit/migration tooling.

      const projection = buildCanonicalOperationProjection({
        physicalJobId: jobId,
        operation: { ...job, id: jobId },
        confirmedHistory: [...rows.entries()].map(([id, data]) => ({ id, data })),
      });
      const tripIds = projection.confirmedTripIds;

      // Every canonical trip must also have a deterministic slot ledger entry.
      // Older client writers could persist a confirmed history row without a
      // claim, leaving progress/history correct but the next free slot unsafe.
      // V4 repairs that derived ledger server-side before finalization.
      const canonicalTripIds = tripIds
        .slice()
        .sort((left, right) =>
          canonicalTripMetricMillis(rows.get(left) || {}) - canonicalTripMetricMillis(rows.get(right) || {}) || left.localeCompare(right));
      const canonicalClaimSnapshots = await Promise.all(
        canonicalTripIds.map((id) => tx.get(db.collection("trip_operation_slots").doc(id))),
      );
      const canonicalClaimsById = new Map(canonicalClaimSnapshots.map((snapshot) => [snapshot.id, snapshot]));
      const canonicalCapacityOverflow = totalDeliveries > 0 && tripIds.length > totalDeliveries;
      let slotLedgerConflict = false;
      const slotAssignments = new Map<string, number>();
      const reservedSlots = new Set<number>();
      const maxCanonicalSlot = totalDeliveries > 0 ? totalDeliveries : Math.max(1, tripIds.length);

      // Existing same-operation claims have first priority. They are already a
      // durable uniqueness assertion and should not be renumbered unnecessarily.
      for (const id of canonicalTripIds) {
        const claimSnapshot = canonicalClaimsById.get(id);
        if (!claimSnapshot?.exists) continue;
        const claim = claimSnapshot.data() || {};
        const linkedJob = field(claim, "jobId");
        if (linkedJob && linkedJob !== jobId && claim.deleted !== true) {
          slotLedgerConflict = true;
          continue;
        }
        const slot = integerSlot(claim.operationSlot);
        if (linkedJob === jobId && slot && slot <= maxCanonicalSlot && !reservedSlots.has(slot)) {
          slotAssignments.set(id, slot);
          reservedSlots.add(slot);
        }
      }

      // Preserve an existing row slot when no valid claim reserved one.
      for (const id of canonicalTripIds) {
        if (slotAssignments.has(id)) continue;
        const row = rows.get(id) || {};
        const slot = integerSlot(row.operationSlot);
        if (slot && slot <= maxCanonicalSlot && !reservedSlots.has(slot)) {
          slotAssignments.set(id, slot);
          reservedSlots.add(slot);
        }
      }

      // Fill any remaining holes deterministically.
      for (const id of canonicalTripIds) {
        if (slotAssignments.has(id)) continue;
        let slot: number | null = null;
        for (let next = 1; next <= maxCanonicalSlot; next += 1) {
          if (!reservedSlots.has(next)) { slot = next; break; }
        }
        if (!slot) {
          slotLedgerConflict = true;
          continue;
        }
        slotAssignments.set(id, slot);
        reservedSlots.add(slot);
      }

      const canonicalSlotPatches: Array<{
        id: string;
        rowRef: FirebaseFirestore.DocumentReference;
        claimRef: FirebaseFirestore.DocumentReference;
        rowPatch: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>;
        claimPatch: Record<string, unknown>;
      }> = [];
      for (const id of canonicalTripIds) {
        const slot = slotAssignments.get(id);
        if (!slot) continue;
        const row = rows.get(id) || {};
        const claimSnapshot = canonicalClaimsById.get(id);
        const claim = claimSnapshot?.exists ? (claimSnapshot.data() || {}) : {};
        const claimMatches = claimSnapshot?.exists &&
          field(claim, "jobId") === jobId &&
          field(claim, "driverId", "motoristaId", "userId") === confirmationScope.driverId &&
          integerSlot(claim.operationSlot) === slot &&
          field(claim, "tripId", "canonicalTripId") === id &&
          claim.deleted !== true;
        const rowMatches = integerSlot(row.operationSlot) === slot && field(row, "operationSlotKey") === id;
        if (claimMatches && rowMatches) continue;
        const rowPatch: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> = {};
        if (!rowMatches) {
          rowPatch.operationSlot = slot;
          rowPatch.operationSlotKey = id;
          rowPatch.operationProjectionVersion = 4;
          rowPatch.slotLedgerRebuiltAt = FieldValue.serverTimestamp();
          rows.set(id, { ...row, operationSlot: slot, operationSlotKey: id, operationProjectionVersion: 4 });
        }
        const claimPatch: Record<string, unknown> = {
          jobId, operationId: jobId, trabalhoId: jobId,
          driverId: confirmationScope.driverId,
          companyId: confirmationScope.companyId,
          contractId: confirmationScope.contractId,
          operationSlot: slot, tripId: id, schemaVersion: 4,
          deleted: false, updatedAt: FieldValue.serverTimestamp(),
        };
        canonicalSlotPatches.push({
          id, rowRef: db.collection("historico_viagens").doc(id),
          claimRef: db.collection("trip_operation_slots").doc(id), rowPatch, claimPatch,
        });
      }

      const rawReportedProgress = job.progress;
      const pointer = field(job, "lastValidatedTripId");
      const lastDoc = pointer ? await tx.get(db.collection("historico_viagens").doc(pointer)) : null;
      const lastMissing = Boolean(pointer && (!lastDoc?.exists || !active(lastDoc.data() || {})));

      const invalidScope = [...rows.values()].some((row) => active(row) && hasExplicitScopeContradiction(row, jobId, job));
      const invalidActive = false;

      const liveClaims = [...claims.values()].filter((claim) => claim.data().deleted !== true);
      const orphanCandidates = liveClaims.filter((claim) => {
        const data = claim.data();
        if (field(data, "driverId", "motoristaId", "userId") !== confirmationScope.driverId) return false;
        const tripId = field(data, "tripId", "canonicalTripId");
        const row = rows.get(tripId);
        return !row || !structuralScopeMatches(row, jobId, job) || !isCanonicalConfirmedTrip(row, confirmationScope);
      });
      const referenced = await Promise.all(orphanCandidates.map(async (claim) => {
        const tripId = field(claim.data(), "tripId", "canonicalTripId");
        return { claim, snapshot: tripId && !tripId.includes("/")
          ? await tx.get(db.collection("historico_viagens").doc(tripId)) : null };
      }));
      const orphanClaims = referenced.filter(({ claim, snapshot }) => {
        if (!snapshot) return false;
        const claimScope = claim.data();
        const claimCompany = field(claimScope, "companyId", "empresaId");
        const claimContract = field(claimScope, "contractId", "contratoId");
        if ((claimCompany && claimCompany !== confirmationScope.companyId) ||
            (claimContract && claimContract !== confirmationScope.contractId)) return false;
        if (!snapshot.exists) return true;
        const row = snapshot.data() || {};
        // A slot claim is derived state. If it points to a row already bound to
        // this exact physical job and scope but that row is not canonically
        // server-confirmed, the claim must not veto every future submission.
        // Firestore transactions are atomic, so a visible claim + noncanonical
        // row cannot be a partially committed current writer. Preserve the row
        // for audit/review and reclaim only the derived slot claim.
        if (structuralScopeMatches(row, jobId, job) && !isCanonicalConfirmedTrip(row, confirmationScope)) return true;
        return !active(row) && structuralScopeMatches(row, jobId, job);
      }).map(({ claim }) => claim);
      const ambiguousClaims = orphanCandidates.filter((claim) => !orphanClaims.includes(claim));
      const orphanSet = new Set(orphanClaims.map((claim) => claim.id));
      const remainingClaimsMatch = liveClaims
        .filter((claim) => !orphanSet.has(claim.id))
        .every((claim) => {
          const data = claim.data();
          const row = rows.get(field(data, "tripId", "canonicalTripId"));
          return Boolean(row && structuralScopeMatches(row, jobId, job) && isCanonicalConfirmedTrip(row, confirmationScope) &&
            field(data, "driverId", "motoristaId", "userId") === confirmationScope.driverId);
        });

      const latest = latestConfirmedTripId(projection);
      const pointerMismatch = pointer !== latest;
      const explicitDeletedInScope = [...rows.values()].some((row) =>
        !active(row) && field(row, "jobId") === jobId &&
        field(row, "driverId", "motoristaId", "userId", "criadoPor") === confirmationScope.driverId);
      const structuralConflict = invalidScope || invalidActive || Boolean(ambiguousClaims.length) || !remainingClaimsMatch ||
        canonicalCapacityOverflow || slotLedgerConflict;
      // V4 performs an exhaustive server-side scan of every supported driver
      // and operation alias before deciding the count. Once that scan has no
      // structural ambiguity, the canonical projection is authoritative in both
      // directions; a stale denormalized `job.progress` is no longer preserved
      // forever merely because an old counter is larger. This is what removes
      // the recurrent `contador 2 / histórico 0` deadlock without reviving the
      // old jobId-only 12 -> 3 regression.
      const authoritativeCoverageComplete = !structuralConflict;
      const safeDecreaseEvidence = lastMissing || orphanClaims.length > 0 || explicitDeletedInScope || authoritativeCoverageComplete;
      const progressDecision = decideReconciledProgress({
        reportedProgress: rawReportedProgress,
        confirmedCount: projection.confirmedTripCount,
        safeDecreaseEvidence,
        hasConflict: structuralConflict,
      });
      const { reportedProgress, progressMismatch, unresolvedDownwardGap, canRepairProgress } = progressDecision;
      const conflict = structuralConflict || unresolvedDownwardGap;
      const safeToRebuild = !conflict;
      const canRepairPointer = pointerMismatch && safeToRebuild && !unresolvedDownwardGap;
      const needsAuditMarker = Number(job.operationReconciliationVersion || 0) < 4;
      const currentLifecycle = String(job.status || "").trim().toLowerCase();
      const canCompleteLifecycle = safeToRebuild && totalDeliveries > 0 &&
        projection.confirmedTripCount >= totalDeliveries &&
        ["active", "delayed", "pending"].includes(currentLifecycle);
      const needsWrite = canonicalSlotPatches.length > 0 || canRepairProgress || canRepairPointer ||
        orphanClaims.length > 0 || lastMissing || needsAuditMarker || canCompleteLifecycle;
      let repaired = false;

      if (safeToRebuild && needsWrite) {
        for (const repair of canonicalSlotPatches) {
          if (Object.keys(repair.rowPatch).length) tx.update(repair.rowRef, repair.rowPatch);
          tx.set(repair.claimRef, repair.claimPatch, { merge: true });
        }

        const jobPatch: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> = {
          ...managedOperationRevisionPatch(job),
          operationProgressReconciled: true,
          operationProgressReconciledAt: FieldValue.serverTimestamp(),
          operationProjectionRebuiltAt: FieldValue.serverTimestamp(),
          operationProjectionSource: canonicalSlotPatches.length ? "confirmed-history+slot-ledger-repair" : "confirmed-history",
          operationReconciliationVersion: 4,
        };
        if (canRepairProgress) {
          jobPatch.progress = projection.confirmedTripCount;
          jobPatch.progressUpdatedAt = FieldValue.serverTimestamp();
        }
        if (canCompleteLifecycle) {
          // The canonical ledger owns readiness. Once the required number of
          // confirmed trips exists, stop new trips at `awaiting_completion`;
          // only the explicit driver finalization callable may set `completed`.
          Object.assign(jobPatch, operationAwaitingCompletionPatch(job, contract, projection.confirmedTripCount, totalDeliveries));
        }
        if (canRepairPointer) {
          jobPatch.lastValidatedTripId = latest || FieldValue.delete();
        }
        if (lastMissing && pointer) jobPatch.lastDeletedTripId = pointer;
        tx.update(jobRef, jobPatch);

        for (const orphanClaim of orphanClaims) {
          tx.update(orphanClaim.ref, {
            deleted: true,
            deletedAt: FieldValue.serverTimestamp(),
            deletedReason: "CONFIRMED_HISTORY_REBUILD",
          });
        }

        const suffix = pointer || orphanClaims[0]?.id || "projection";
        tx.create(db.collection("trip_reconciliation_audits").doc(`${jobId}_${suffix}_${Date.now()}`), {
          jobId,
          driverId: uid,
          previousProgress: reportedProgress,
          confirmedProgress: projection.confirmedTripCount,
          slotLedgerRepairedCount: canonicalSlotPatches.length,
          orphanClaimCleared: orphanClaims.length > 0,
          lifecycleStatusPreserved: !canCompleteLifecycle,
          lifecycleCompletedByCanonicalProjection: false,
          lifecycleReadyForManualCompletion: canCompleteLifecycle,
          reason: canonicalSlotPatches.length ? "CANONICAL_SLOT_LEDGER_REBUILT"
            : canRepairProgress ? "COUNTER_DRIFT_REPAIRED"
              : orphanClaims.length > 0 ? "ORPHAN_OPERATION_SLOT"
                : needsAuditMarker ? "CANONICAL_AUDIT_V4" : "PROJECTION_REBUILD",
          createdAt: FieldValue.serverTimestamp(),
          source: "confirmed-history-v4",
        });
        repaired = true;
      }

      const reason = invalidScope ? "SCOPE_MISMATCH"
        : invalidActive ? "INVALID_ACTIVE_TRIP"
          : canonicalCapacityOverflow ? "CANONICAL_CAPACITY_OVERFLOW"
            : slotLedgerConflict ? "CANONICAL_SLOT_LEDGER_CONFLICT"
                    : ambiguousClaims.length ? "AMBIGUOUS_ORPHAN_SLOT"
                  : !remainingClaimsMatch ? "ORPHAN_SLOT"
                    : unresolvedDownwardGap ? "UNRESOLVED_CANONICAL_GAP"
                      : canonicalSlotPatches.length ? "CANONICAL_SLOT_LEDGER_REBUILT"
                          : canCompleteLifecycle ? "LIFECYCLE_AWAITING_COMPLETION"
                          : progressMismatch ? "COUNT_MISMATCH"
                          : lastMissing ? "MISSING_LAST_TRIP"
                            : needsAuditMarker ? "CANONICAL_AUDIT_V4"
                              : "CONSISTENT";

      return {
        jobId,
        tripIds,
        confirmedCount: projection.confirmedTripCount,
        legacyRecoveredCount: 0,
        serverProgress: progressDecision.nextProgress,
        status: conflict ? "conflict" : repaired ? "repaired" : "consistent",
        reason,
        slotLedgerRepairedCount: canonicalSlotPatches.length,
        lifecycleStatus: canCompleteLifecycle ? "awaiting_completion" : String(job.status || ""),
      };
  });
};

export const reconcileOperationTrips = functions.region("us-central1").https.onCall(
  async (input: unknown, context) => {
    const uid = context.auth?.uid;
    if (!uid) throw new functions.https.HttpsError("unauthenticated", "Faça login para conferir a operação.");
    const jobId = (input as { jobId?: unknown } | null)?.jobId;
    if (typeof jobId !== "string" || !/^[A-Za-z0-9_-]{1,180}$/.test(jobId))
      throw new functions.https.HttpsError("invalid-argument", "Operação inválida.");
    return reconcileOperationTripsCore(admin.firestore(), uid, jobId);
  },
);
