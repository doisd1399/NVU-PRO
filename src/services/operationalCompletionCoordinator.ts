import {
  publishTripHistoryOptimistically,
} from "../hooks/useTripHistory";
import { publishDriverTripOptimistically } from "../hooks/useDriverTrips";

type JobLike = {
  id: string;
  progress?: number;
};

type ContractLike = {
  id: string;
  totalDeliveries?: number;
};

type TripDocumentReference = {
  id: string;
};

type CompletionInput = {
  userId: string;
  companyId: string;
  tripData: Record<string, unknown>;
  job?: JobLike | null;
  contract?: ContractLike | null;
  addTrip: (data: Record<string, unknown>) => Promise<TripDocumentReference>;
  persistTripId: (docRef: TripDocumentReference) => Promise<void>;
  syncJobProgress?: (jobId: string) => Promise<number | null>;
  finishJob?: (jobId: string) => Promise<void>;
  /** Pro-only: return after addTrip and reconcile progress off the UI path. */
  deferOperationReconciliation?: boolean;
  projectedOperationProgress?: number;
  projectedOperationTotalDeliveries?: number;
  onOperationReconciled?: (state: {
    progress?: number;
    totalDeliveries?: number;
    status?: string;
    closed?: boolean;
  }) => void | Promise<void>;
};

type CompletionResult = {
  docRef: TripDocumentReference;
  idempotencyKey: string;
  operationProgress?: number;
  operationTotalDeliveries?: number;
  operationStatus?: string;
  operationClosed?: boolean;
};

const IN_FLIGHT = new Map<string, Promise<CompletionResult>>();

function createIdempotencyKey(input: CompletionInput): string {
  const explicit = String(input.tripData.idempotencyKey || "").trim();
  if (explicit) return explicit;
  const operation = String(input.tripData.operationId || input.job?.id || "no-job").trim();
  const driver = String(input.userId || "no-user").trim();
  const timestamp = String(input.tripData.completedAt || input.tripData.createdAt || Date.now());
  return `trip:${operation}:${driver}:${timestamp}`;
}

function confirmedTripPayload(
  tripData: Record<string, unknown>,
  docRef: TripDocumentReference,
): Record<string, unknown> {
  const timestamp = new Date().toISOString();
  return {
    ...tripData,
    id: docRef.id,
    tripId: docRef.id,
    createdAt: tripData.createdAt || timestamp,
    updatedAt: timestamp,
    completedAt: tripData.completedAt || timestamp,
    dataLancamento: tripData.dataLancamento || timestamp,
  };
}

export function completeTripWithCoordinator(input: CompletionInput): Promise<CompletionResult> {
  const idempotencyKey = createIdempotencyKey(input);
  const existing = IN_FLIGHT.get(idempotencyKey);
  if (existing) return existing;

  const execution = (async () => {
    const docRef = await input.addTrip(input.tripData);
    const optimisticTrip = confirmedTripPayload(input.tripData, docRef);

    // The local store is updated only after addTrip returns the durable document
    // identity. Firestore remains the authority and later replaces this exact id.
    publishTripHistoryOptimistically(
      { userId: input.userId, companyId: input.companyId },
      optimisticTrip,
    );
    publishDriverTripOptimistically(input.userId, optimisticTrip);

    // `addTrip` already confirms the durable Firestore document and its id.
    // The duplicated tripId field is compatibility metadata, not a prerequisite
    // for registration; persist it off the critical path so Pro can acknowledge
    // the trip without waiting for a second network round trip.
    void Promise.resolve()
      .then(() => input.persistTripId(docRef))
      .catch((error) => {
        console.warn("[OperationalCompletionCoordinator] tripId backfill deferred:", error);
      });

    let operationProgress: number | undefined;
    let operationTotalDeliveries: number | undefined;
    let operationStatus: string | undefined;
    let operationClosed = false;
    if (input.job && input.contract && input.syncJobProgress) {
      operationTotalDeliveries = Math.max(
        0,
        Number(
          (input.projectedOperationTotalDeliveries ?? input.contract.totalDeliveries) || 0,
        ),
      );
      const projectedProgress = Math.max(
        0,
        Number(input.projectedOperationProgress ?? Number(input.job.progress || 0) + 1),
      );
      operationProgress = projectedProgress;
      operationClosed = Boolean(
        operationTotalDeliveries > 0 && projectedProgress >= operationTotalDeliveries,
      );
      operationStatus = operationClosed ? "completed" : "active";

      const reconcile = async () => {
        try {
          const syncedProgress = await input.syncJobProgress!(input.job!.id);
          const actualProgress = syncedProgress === null
            ? undefined
            : Math.max(0, Number(syncedProgress));
          const actualClosed = Boolean(
            actualProgress !== undefined
            && operationTotalDeliveries !== undefined
            && operationTotalDeliveries > 0
            && actualProgress >= operationTotalDeliveries,
          );
          if (actualClosed && input.finishJob) {
            await input.finishJob(input.job!.id);
          }
          if (input.onOperationReconciled) {
            await input.onOperationReconciled({
              progress: actualProgress,
              totalDeliveries: operationTotalDeliveries,
              status: actualClosed ? "completed" : "active",
              closed: actualClosed,
            });
          }
        } catch (error) {
          // The trip is already durable. Keep the local projected state and let
          // the next operation-state refresh retry reconciliation; never turn a
          // successful addTrip into a foreground failure because a secondary
          // progress read/write is slow or temporarily unavailable.
          console.warn("[OperationalCompletionCoordinator] reconciliação server-side deferred:", error);
        }
      };

      if (input.deferOperationReconciliation) {
        void reconcile();
      } else {
        await reconcile();
      }
    }

    return {
      docRef,
      idempotencyKey,
      operationProgress,
      operationTotalDeliveries,
      operationStatus,
      operationClosed,
    };
  })();

  IN_FLIGHT.set(idempotencyKey, execution);
  void execution.finally(() => {
    if (IN_FLIGHT.get(idempotencyKey) === execution) IN_FLIGHT.delete(idempotencyKey);
  });
  return execution;
}

export function getOperationalCompletionInFlightCount(): number {
  return IN_FLIGHT.size;
}
