import {
  publishTripHistoryOptimistically,
} from "../hooks/useTripHistory";
import { TripRegistrationService } from "../application/trip/TripRegistrationService";
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
  offline?: boolean;
  localId?: string;
  data?: Record<string, unknown>;
  syncState?: string;
  lastError?: string;
  tripSyncStage?: string;
};

type CompletionInput = {
  userId: string;
  companyId: string;
  tripData: Record<string, unknown>;
  job?: JobLike | null;
  contract?: ContractLike | null;
  addTrip: (data: Record<string, unknown>) => Promise<TripDocumentReference>;
  persistTripId?: (docRef: TripDocumentReference) => Promise<void>;
  syncJobProgress?: (jobId: string) => Promise<number | null>;
  /** Pro-only: return after addTrip and reconcile progress off the UI path. */
  deferOperationReconciliation?: boolean;
  projectedOperationProgress?: number;
  projectedOperationTotalDeliveries?: number;
  onOperationReconciled?: (state: {
    progress?: number;
    totalDeliveries?: number;
    status?: string;
    closed?: boolean;
    readyToFinalize?: boolean;
  }) => void | Promise<void>;
};

type CompletionResult = {
  docRef: TripDocumentReference;
  idempotencyKey: string;
  operationProgress?: number;
  operationTotalDeliveries?: number;
  operationStatus?: string;
  operationClosed?: boolean;
  operationReadyToFinalize?: boolean;
};

const IN_FLIGHT = new Map<string, Promise<CompletionResult>>();

function createIdempotencyKey(input: CompletionInput): string {
  const explicit = String(input.tripData.idempotencyKey || "").trim();
  if (explicit) return explicit;
  const operation = String(input.tripData.jobId || input.job?.id || "no-job").trim();
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
    ...(docRef.data || {}),
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
  const flightKey = JSON.stringify([input.userId, input.companyId, input.job?.id || input.tripData.jobId || "", idempotencyKey]);
  const existing = IN_FLIGHT.get(flightKey);
  if (existing) return existing;

  const execution = (async () => {
    console.info("TRIP_CREATE_START", { idempotencyKey, jobId: input.job?.id, companyId: input.companyId });
    // Normalize identity before the offline-first command performs the one
    // authoritative transaction or persists the local pending record.
    const canonicalTrip = TripRegistrationService.register(input.tripData as any);
    console.info("TRIP_VALIDATION_RESULT", { tripId: canonicalTrip.tripId, driverId: input.userId, jobId: input.job?.id });
    const docRef = await input.addTrip({
      ...input.tripData,
      tripId: canonicalTrip.tripId,
      clientRequestId: canonicalTrip.clientRequestId,
      idempotencyKey: canonicalTrip.idempotencyKey,
      syncVersion: canonicalTrip.syncVersion,
      source: canonicalTrip.source,
    });
    const isOfflineTrip = docRef.offline === true || String(docRef.id || docRef.localId || "").startsWith("local-");
    const optimisticTrip = confirmedTripPayload(
      isOfflineTrip
        ? { ...input.tripData, offlineSyncStatus: "pending_sync" }
        : input.tripData,
      docRef,
    );

    // The local store is updated only after addTrip returns the durable document
    // identity. Firestore remains the authority and later replaces this exact id.
    for (const publish of [
      () => publishTripHistoryOptimistically({ userId: input.userId, companyId: input.companyId }, optimisticTrip),
      () => publishDriverTripOptimistically(input.userId, optimisticTrip),
    ]) {
      try { publish(); }
      catch { console.warn("[NVU] Viagem salva; a projeção do histórico será reidratada."); }
    }
    console.info("TRIP_HISTORY_UPDATE", { tripId: docRef.id, offline: isOfflineTrip });

    let operationProgress: number | undefined;
    let operationTotalDeliveries: number | undefined;
    let operationStatus: string | undefined;
    let operationClosed = false;
    let operationReadyToFinalize = false;
    if (input.job && input.contract && input.syncJobProgress) {
      operationTotalDeliveries = Math.max(
        0,
        Number(
          (input.projectedOperationTotalDeliveries ?? input.contract.totalDeliveries) || 0,
        ),
      );
      // Projected progress is only a provisional UI hint. Definitive progress
      // and terminal state come from the server-reconciled trip count below.
      operationProgress = undefined;
      operationClosed = false;
      operationStatus = isOfflineTrip ? "pending_validation" : "reconciliation_pending";

      const reconcile = async () => {
        try {
          const syncedProgress = await input.syncJobProgress!(input.job!.id);
          const actualProgress = syncedProgress === null
            ? undefined
            : Math.max(0, Number(syncedProgress));
          const actualReadyToFinalize = Boolean(
            actualProgress !== undefined
            && operationTotalDeliveries !== undefined
            && operationTotalDeliveries > 0
            && actualProgress >= operationTotalDeliveries,
          );
          if (actualProgress !== undefined) {
            operationProgress = actualProgress;
            operationStatus = actualReadyToFinalize ? "awaiting_completion" : "active";
            operationClosed = false;
            operationReadyToFinalize = actualReadyToFinalize;
          }
          if (input.onOperationReconciled) {
            await input.onOperationReconciled({
              progress: actualProgress,
              totalDeliveries: operationTotalDeliveries,
              status: actualReadyToFinalize ? "awaiting_completion" : "active",
              closed: false,
              readyToFinalize: actualReadyToFinalize,
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

      if (isOfflineTrip) {
        // Offline trips remain visible in history, but never finalize operation
        // progress before server validation.
        operationProgress = undefined;
        operationStatus = "pending_validation";
        operationClosed = false;
        operationReadyToFinalize = false;
      } else if (input.deferOperationReconciliation) {
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
      operationReadyToFinalize,
    };
  })();

  IN_FLIGHT.set(flightKey, execution);
  const cleanup = () => {
    if (IN_FLIGHT.get(flightKey) === execution) IN_FLIGHT.delete(flightKey);
  };
  // An ignored finally() creates a second rejected promise on submission
  // failure, even when the caller handles the original rejection.
  void execution.then(cleanup, cleanup);
  return execution;
}

export function getOperationalCompletionInFlightCount(): number {
  return IN_FLIGHT.size;
}
