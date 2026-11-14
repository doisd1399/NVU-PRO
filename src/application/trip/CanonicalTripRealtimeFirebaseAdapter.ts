import {
  collection,
  onSnapshot,
  query,
  where,
  type Firestore,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import { canonicalTripRepository } from "../../repositories/CanonicalTripRepository";
import { canonicalTripRealtimeService } from "./CanonicalTripRealtimeService";
import type { CanonicalTrip } from "../../domain/trip/CanonicalTrip";
import { tripMatchesReadScope } from "../../lib/tripReadScope";
import type { TripReadCoverageHandler, TripReadSourceStatus } from "../../lib/tripReadCoverage";
import { historyReadFailureCode } from "../../lib/historyReadFailure";
import { inspectLocalTripSync } from "../../lib/localTripSyncDiagnostic";
import { ScopedHistoryReadProjection } from "../../lib/scopedHistoryReadProjection";

export type CanonicalTripReadScope = {
  driverId?: string;
  companyId?: string;
  companyIds?: string[];
  diagnosticOwnerDriverIds?: string[];
};
type SnapshotHandler = (trips: CanonicalTrip[]) => void;
type ErrorHandler = (error: unknown) => void;
type RealtimeDependencies = {
  firestore?: Firestore;
  getCurrentUser?: () => { uid: string } | null;
  readProjection?: "history";
};
const clean = (value: unknown) => String(value || "").trim();
let readGeneration = 0;

const ingestSnapshot = (documents: QueryDocumentSnapshot[]) =>
  canonicalTripRepository.applyServerReadSnapshots(
    documents.map(
      (document) =>
        ({
          ...document.data(),
          id: document.id,
          physicalDocumentId: document.id,
        }) as Partial<CanonicalTrip> as CanonicalTrip,
    ),
  );

/** Authorized server listeners; every document is normalized into the repository. */
export function listenCanonicalTripsForScope(
  scope: CanonicalTripReadScope,
  onData: SnapshotHandler,
  onError?: ErrorHandler,
  dependencies: RealtimeDependencies = {},
  onServerConfirmed?: (confirmed: boolean) => void,
  onReadCoverage?: TripReadCoverageHandler,
): Unsubscribe {
  const firestore = dependencies.firestore || db;
  const getCurrentUser =
    dependencies.getCurrentUser || (() => auth.currentUser);
  const authenticatedUserId = clean(getCurrentUser()?.uid);
  const driverId = clean(scope.driverId);
  const companyIds = Array.from(
    new Set(
      [scope.companyId, ...(scope.companyIds || [])].map(clean).filter(Boolean),
    ),
  );
  const unsubs: Unsubscribe[] = [];
  let closed = false;
  const failedSources = new Set<string>();
  const transportFailedSources = new Set<string>();
  const confirmedSources = new Set<string>();
  const generation = ++readGeneration;
  const historyProjection = dependencies.readProjection === "history" ? new ScopedHistoryReadProjection() : null;
  const driverFields = historyProjection
    ? ["driverId", "motoristaId", "userId", "criadoPor"] as const
    : ["driverId", "motoristaId"] as const;
  const expectedSources = (driverId ? driverFields.length : 0) + companyIds.length * 2;
  let commandStorageAvailable = true;
  const sourceStates = new Map<string, {
    field: "driverId" | "motoristaId" | "userId" | "criadoPor" | "companyId" | "empresaId";
    status: TripReadSourceStatus;
    ids: Set<string>;
    rejectedRows: number;
    fromCache: boolean;
    hasPendingWrites: boolean;
    errorCode?: string;
  }>();
  for (const field of driverFields) {
    if (driverId) sourceStates.set(`driver:${field}:${driverId}`, {
      field, status: "waiting", ids: new Set(), rejectedRows: 0, fromCache: false, hasPendingWrites: false,
    });
  }
  for (const companyId of companyIds) for (const field of ["companyId", "empresaId"] as const) {
    sourceStates.set(`company:${field}:${companyId}`, {
      field, status: "waiting", ids: new Set(), rejectedRows: 0, fromCache: false, hasPendingWrites: false,
    });
  }
  const emitCoverage = () => {
    if (closed || !onReadCoverage) return;
    const states = [...sourceStates.values()];
    const ids = new Set(states.flatMap((source) => [...source.ids]));
    const projection = historyProjection ? historyProjection.list(scope) : canonicalTripRepository.list().filter((trip) => tripMatchesReadScope(trip, scope));
    const physicalId = (trip: CanonicalTrip) => clean(trip.physicalDocumentId || trip.canonicalTripId || trip.tripId);
    // Payload flags can survive in old server documents. They are not proof of
    // a command on this device. Only the durable command store and SDK metadata
    // determine local synchronization pending; no command is acknowledged here.
    let pendingRecords: ReturnType<typeof canonicalTripRepository.listPending> = [];
    try { pendingRecords = canonicalTripRepository.listPending(); }
    catch (error) {
      if (!historyProjection) throw error;
      commandStorageAvailable = false;
    }
    const pendingIds = new Set(pendingRecords.map((record) => physicalId(record.trip)));
    const projectionIds = new Set(projection.map(physicalId));
    const scopedPending = pendingRecords.filter((record) => historyProjection
      ? tripMatchesReadScope(record.trip, scope) : projectionIds.has(physicalId(record.trip)));
    const unobservedProjectionRows = historyProjection ? 0 : projection.filter((trip) => !ids.has(physicalId(trip))).length;
    const pendingLocalRows = historyProjection ? scopedPending.length : projection.filter((trip) => pendingIds.has(physicalId(trip))).length;
    const unverifiedProjectionRows = historyProjection ? 0 : projection.filter((trip) => !ids.has(physicalId(trip)) || pendingIds.has(physicalId(trip))).length;
    const respondedSources = states.filter((source) => source.status !== "waiting").length;
    const complete = expectedSources > 0 && confirmedSources.size === expectedSources &&
      failedSources.size === 0 && unverifiedProjectionRows === 0;
    onReadCoverage({
      generation, status: complete ? "complete" : respondedSources ? "partial" : "unknown",
      scope: { ...(driverId ? { driverId } : {}), companyIds: [...companyIds], authenticatedUserId },
      expectedSources, respondedSources, confirmedSources: confirmedSources.size, failedSources: failedSources.size,
      physicalRows: ids.size, projectedRows: projection.length, unverifiedProjectionRows,
      unobservedProjectionRows, pendingLocalRows,
      ...(historyProjection ? { projectionMode: "scoped-history" as const, commandStorageAvailable,
        historyAssessment: historyProjection.assess(scope) } : {}),
      ...(scopedPending.length ? { localSyncDiagnostic: inspectLocalTripSync(scopedPending, ids, authenticatedUserId, undefined, scope.diagnosticOwnerDriverIds || []) } : {}),
      rejectedRows: historyProjection ? historyProjection.getRejectedRows() : states.reduce((sum, source) => sum + source.rejectedRows, 0),
      fromCache: states.some((source) => source.fromCache),
      hasPendingWrites: states.some((source) => source.hasPendingWrites), atomic: false,
      sources: states.map((source) => ({ field: source.field, status: source.status, rows: source.ids.size,
        ...(source.errorCode ? { errorCode: source.errorCode } : {}),
      })),
    });
  };
  const emit = () => {
    if (!closed && clean(getCurrentUser()?.uid) === authenticatedUserId)
      onData(historyProjection ? historyProjection.list(scope) : canonicalTripRepository.list());
  };
  const handle = (source: string, snapshot: QuerySnapshot) => {
    if (closed) return;
    if (clean(getCurrentUser()?.uid) !== authenticatedUserId) {
      fail(source, new Error("CANONICAL_TRIP_AUTH_SCOPE_CHANGED"));
      return;
    }
    const issueBaseline = canonicalTripRepository.getLastSnapshotIssues?.().length || 0;
    const serverConfirmed =
      !snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites;
    const state = sourceStates.get(source)!;
    state.ids = new Set(snapshot.docs.map((document) => document.id));
    state.fromCache = snapshot.metadata.fromCache;
    state.hasPendingWrites = snapshot.metadata.hasPendingWrites;
    state.status = serverConfirmed ? "server" : state.hasPendingWrites ? "pending" : "cache";
    state.rejectedRows = 0;
    state.errorCode = undefined;
    // A response becomes confirmed only after the entire ingestion succeeds.
    confirmedSources.delete(source);
    onServerConfirmed?.(false);
    // Downgrade coverage before repository subscribers receive this generation.
    emitCoverage();
    try {
      const rejected = historyProjection?.replaceSource(source, snapshot.docs.map(document => ({
        id: document.id, data: document.data(), hasPendingWrites: document.metadata?.hasPendingWrites,
      })), snapshot.metadata) || 0;
      state.rejectedRows = rejected;
      if (historyProjection) {
        try { ingestSnapshot(snapshot.docs); }
        catch { commandStorageAvailable = false; }
      } else ingestSnapshot(snapshot.docs);
    } catch (error) {
      failedSources.add(source);
      state.status = "failed";
      state.errorCode = historyReadFailureCode(error);
      state.rejectedRows = snapshot.docs.length;
      onServerConfirmed?.(false);
      emitCoverage();
      onError?.(error);
      return;
    }
    emit();
    // Historical normalization is independent of operational command storage.
    const snapshotIssues = historyProjection ? [] : (canonicalTripRepository.getLastSnapshotIssues?.() || []).slice(issueBaseline);
    if (snapshotIssues.length || state.rejectedRows) {
      failedSources.add(source);
      state.status = "failed";
      state.errorCode = "CANONICAL_TRIP_SNAPSHOT_PARTIAL";
      state.rejectedRows = Math.max(state.rejectedRows, snapshotIssues.length);
      onServerConfirmed?.(false);
      emitCoverage();
      onError?.(new Error("CANONICAL_TRIP_SNAPSHOT_PARTIAL"));
      return;
    }
    if (transportFailedSources.has(source) && snapshot.docs.length === 0) failedSources.add(source);
    else {
      transportFailedSources.delete(source);
      failedSources.delete(source);
    }
    if (serverConfirmed && !failedSources.has(source)) confirmedSources.add(source);
    if (snapshotIssues.length === 0 && confirmedSources.size === expectedSources && failedSources.size === 0)
      onServerConfirmed?.(true);
    if (failedSources.has(source)) state.status = "failed";
    emitCoverage();
  };
  const fail = (source: string, error: unknown) => {
    if (closed) return;
    failedSources.add(source);
    confirmedSources.delete(source);
    transportFailedSources.add(source);
    onServerConfirmed?.(false);
    const state = sourceStates.get(source);
    if (state) {
      state.status = "failed";
      state.errorCode = historyReadFailureCode(error);
    }
    emitCoverage();
    onError?.(error);
  };

  emitCoverage();

  if (driverId) {
    if (!getCurrentUser() || getCurrentUser()!.uid !== driverId) {
      onError?.(new Error("CANONICAL_TRIP_DRIVER_SCOPE_MISMATCH"));
      return () => undefined;
    }
    // Each query uses one identity field so Firestore Rules can prove the
    // owner boundary even for legacy documents with different aliases.
    for (const driverField of driverFields) {
      unsubs.push(
        onSnapshot(
          query(
            collection(firestore, "historico_viagens"),
            where(driverField, "==", driverId),
          ),
            { includeMetadataChanges: true },
            (snapshot) => handle(`driver:${driverField}:${driverId}`, snapshot),
            (error) => fail(`driver:${driverField}:${driverId}`, error),
          ),
      );
    }
  }
  for (const companyId of companyIds) {
    for (const companyField of ["companyId", "empresaId"]) {
      unsubs.push(
        onSnapshot(
          query(
            collection(firestore, "historico_viagens"),
            where(companyField, "==", companyId),
          ),
          { includeMetadataChanges: true },
            (snapshot) =>
            handle(`company:${companyField}:${companyId}`, snapshot),
            (error) => fail(`company:${companyField}:${companyId}`, error),
          ),
      );
    }
  }
  if (!unsubs.length) {
    onError?.(new Error("CANONICAL_TRIP_READ_SCOPE_REQUIRED"));
    return () => undefined;
  }
  // Local edits and other readers can change the shared projection between SDK
  // responses. Reassess coverage without creating another Firestore listener.
  let stopCoverageProjection = () => undefined;
  if (onReadCoverage || historyProjection) {
    try {
      stopCoverageProjection = canonicalTripRepository.subscribe(() => {
        emitCoverage();
        if (historyProjection && [...sourceStates.values()].some(source => source.status !== "waiting")) emit();
      });
    } catch (error) {
      if (!historyProjection) throw error;
      commandStorageAvailable = false;
      emitCoverage();
    }
  }
  return () => {
    closed = true;
    stopCoverageProjection();
    unsubs.forEach((unsubscribe) => unsubscribe());
  };
}

export function startCanonicalTripRealtimeSync(): Unsubscribe {
  // Scoped consumers own the single Firestore query for their scope. The app
  // bootstrap only subscribes to the repository-backed projection so it cannot
  // create a second driver listener and replay the same dataset.
  return canonicalTripRealtimeService.subscribe(() => undefined);
}
