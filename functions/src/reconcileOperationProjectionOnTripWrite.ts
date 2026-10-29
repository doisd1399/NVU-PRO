import * as functions from "firebase-functions/v1";
import * as admin from "./firebaseAdmin";
import { field } from "./canonicalOperationProjection";
import { reconcileOperationTripsCore } from "./reconcileOperationTrips";

type Data = FirebaseFirestore.DocumentData;

const stateSignature = (row: Data): string => JSON.stringify({
  jobId: field(row, "jobId"),
  driverId: field(row, "driverId", "motoristaId", "userId", "criadoPor"),
  deleted: row.deleted === true,
  softDeleted: row.softDeleted === true,
  cancelled: row.cancelado === true,
  status: String(row.status || "").trim().toLowerCase(),
  recordStatus: String(row.recordStatus || "").trim().toLowerCase(),
  serverValidated: row.serverValidatedAt != null,
  serverUpdated: row.serverUpdatedAt != null,
  syncStatus: String(row.offlineSyncStatus || row.syncStatus || row.validationStatus || "").trim().toLowerCase(),
});

const scopeOf = (row: Data): { jobId: string; driverId: string } | null => {
  const jobId = field(row, "jobId");
  const driverId = field(row, "driverId", "motoristaId", "userId", "criadoPor");
  if (!jobId || !driverId || jobId.includes("/") || driverId.includes("/")) return null;
  return { jobId, driverId };
};

/**
 * Cross-version convergence guard.
 *
 * Old APKs were allowed to create a canonical-looking history row and mutate a
 * denormalized operation counter in the same Firestore transaction. V4 routes
 * new writes through server callables, but already-installed clients can still
 * exist in the field. This trigger makes every relevant history create/delete/
 * binding change converge back through the same V4 reconciler, so an old writer
 * cannot permanently reintroduce counter/history/finalization drift.
 */
export const reconcileOperationProjectionOnTripWrite = functions
  .region("us-central1")
  .firestore.document("historico_viagens/{tripId}")
  .onWrite(async (change, context) => {
    const before = change.before.exists ? (change.before.data() || {}) : {};
    const after = change.after.exists ? (change.after.data() || {}) : {};

    // Ignore edits that cannot affect operation membership/confirmation. This
    // prevents slot-ledger metadata repairs from recursively reconciling forever.
    if (change.before.exists && change.after.exists && stateSignature(before) === stateSignature(after)) return;

    const scopes = new Map<string, { jobId: string; driverId: string }>();
    for (const row of [before, after]) {
      const scope = scopeOf(row);
      if (scope) scopes.set(`${scope.driverId}|${scope.jobId}`, scope);
    }
    if (!scopes.size) return;

    const db = admin.firestore();
    for (const scope of scopes.values()) {
      try {
        await reconcileOperationTripsCore(db, scope.driverId, scope.jobId);
      } catch (error) {
        // A malformed/deleted legacy row must not create an infinite trigger
        // retry loop. The authenticated UI reconciler will surface a structural
        // conflict when the operation is next opened.
        console.warn("[NVU operation-v4] trip-write reconciliation skipped", {
          tripId: context.params.tripId,
          jobId: scope.jobId,
          driverId: scope.driverId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });
