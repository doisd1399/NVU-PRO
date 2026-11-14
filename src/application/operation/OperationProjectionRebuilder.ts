import type { CanonicalTrip } from "../../domain/trip/CanonicalTrip";
import { operationReconciliationService, type OperationProjection } from "../../services/operationReconciliationService";

export type ProjectionRebuildResult = {
  rebuilt: boolean;
  projection: OperationProjection | null;
  reason: string;
};

/**
 * Rebuilds denormalized operation state. It is deliberately best-effort:
 * failure to refresh a cache must not stop a trip from entering the outbox.
 */
export class OperationProjectionRebuilder {
  rebuild(operation: Record<string, unknown>, reason = "projection-stale"): ProjectionRebuildResult {
    try {
      return { rebuilt: true, projection: operationReconciliationService.rebuild(operation), reason };
    } catch {
      return { rebuilt: false, projection: null, reason };
    }
  }

  rebuildAfterTrip(trip: CanonicalTrip, operation?: Record<string, unknown>): ProjectionRebuildResult {
    try {
      const projection = operationReconciliationService.reconcileAfterTripChange(trip, operation);
      return { rebuilt: Boolean(projection), projection, reason: trip.deleted ? "trip-deleted" : "trip-confirmed" };
    } catch {
      return { rebuilt: false, projection: null, reason: "rebuild-failed" };
    }
  }
}

export const operationProjectionRebuilder = new OperationProjectionRebuilder();
