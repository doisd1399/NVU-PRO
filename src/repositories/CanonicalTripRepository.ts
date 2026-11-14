import type { CanonicalTrip } from "../domain/trip/CanonicalTrip";
import { TripRegistrationService } from "../application/trip/TripRegistrationService";
import { canonicalTripStore } from "../lib/CanonicalTripStore";
import {
  filterTombstonedTrips,
  isTripTombstoned,
  markTripTombstoned,
} from "../lib/tripTombstones";
import { OfflineDatabase, type OfflineTripRecord } from "../services/offline/OfflineDatabase";
import { isTrustedServerConfirmedTrip } from "../../functions/src/isCanonicalConfirmedTrip";
import { assertSameTripAttempt } from "../domain/trip/TripAttemptIdentity";
import { localCommitStep } from "../lib/localCommitDiagnostic";
import { makeTombstoneGuardError } from "../lib/tripTombstoneGuardError";

export type CanonicalTripQueue = {
  enqueueAndSave?: (record: OfflineTripRecord) => Promise<unknown>;
  enqueue: (trip: CanonicalTrip) => Promise<unknown>;
  enqueueDeletion: (trip: CanonicalTrip, remoteDeleteRequired?: boolean) => Promise<unknown>;
  enqueueUpdate?: (trip: CanonicalTrip, patch: Record<string, unknown>, actorUserId: string, baseVersion: number, before: CanonicalTrip) => Promise<{ editId: string }>;
};

type RepositoryDependencies = {
  database?: OfflineDatabase;
  queue?: CanonicalTripQueue;
  now?: () => string;
};

const idOf = (trip: Partial<CanonicalTrip> | null | undefined): string =>
  String(
    trip?.physicalDocumentId || trip?.canonicalTripId || trip?.tripId || trip?.clientRequestId || trip?.idempotencyKey || "",
  ).trim();

const isDeleted = (trip: Partial<CanonicalTrip> | null | undefined): boolean =>
  trip?.deleted === true || String(trip?.status || "").toUpperCase() === "DELETED";

const timestampOf = (trip: Partial<CanonicalTrip> | null | undefined): number => {
  const value = Date.parse(String(trip?.updatedAt || trip?.clientUpdatedAt || trip?.createdAt || ""));
  return Number.isFinite(value) ? value : 0;
};

const revisionOf = (trip: Partial<CanonicalTrip> | null | undefined): number =>
  Number(trip?.syncVersion || 0) * 1_000_000_000_000 + timestampOf(trip);

/**
 * Canonical Data Source for every trip read and write.
 *
 * The repository is deliberately independent from React screens. Local state is
 * committed before network I/O, server snapshots replace the local record, and
 * a tombstone always wins over an older snapshot. Hooks and projections consume
 * this source instead of merging their own storage collections.
 */
export class CanonicalTripRepository {
  private readonly database: OfflineDatabase;
  private readonly queue?: CanonicalTripQueue;
  private readonly now: () => string;
  private readonly listeners = new Set<(trips: CanonicalTrip[]) => void>();
  private hydrated = false;
  private lastSnapshotIssues: Array<{ index: number; error: string }> = [];
  private readonly observedRemoteIds = new Set<string>();

  constructor(dependencies: RepositoryDependencies = {}) {
    this.database = dependencies.database || new OfflineDatabase();
    this.queue = dependencies.queue;
    this.now = dependencies.now || (() => new Date().toISOString());
  }

  private hydrateOnce(): void {
    if (this.hydrated) return;
    const records = this.database.list();
    for (const record of records) {
      const trip = record.trip;
      const id = idOf(trip);
      if (!id) continue;
      if (isDeleted(trip)) {
        markTripTombstoned(id);
      }
      canonicalTripStore.upsert(trip);
    }
    this.hydrated = true;
  }

  private publish(): void {
    const snapshot = this.list();
    this.listeners.forEach((listener) => {
      try { listener(snapshot); } catch (error) { console.warn("[NVU] Projeção da viagem será atualizada", error); }
    });
  }

  private persist(
    trip: CanonicalTrip,
    syncStatus: OfflineTripRecord["syncStatus"],
    serverUpdatedAt?: string,
  ): CanonicalTrip {
    const id = idOf(trip);
    if (!id) throw new Error("CANONICAL_TRIP_ID_REQUIRED");
    const record: OfflineTripRecord = {
      trip,
      syncStatus,
      syncVersion: Math.max(1, Number(trip.syncVersion || 1)),
      clientUpdatedAt: String(trip.clientUpdatedAt || trip.updatedAt || this.now()),
      serverUpdatedAt,
    };
    this.database.save(record);
    canonicalTripStore.upsert(trip);
    if (isDeleted(trip)) markTripTombstoned(id);
    return trip;
  }

  private resolvePhysicalTrip(requestedId: string): CanonicalTrip | undefined {
    const requested = String(requestedId || "").trim();
    if (!requested) return undefined;
    const exact = canonicalTripStore.get(requested);
    if (exact) return exact;
    const matches = canonicalTripStore.listIncludingDeleted().filter((trip) =>
      [trip.physicalDocumentId, trip.canonicalTripId, trip.tripId, trip.originalCanonicalTripId, trip.originalTripId]
        .some((alias) => String(alias || "").trim() === requested),
    );
    if (matches.length > 1) throw new Error("CANONICAL_TRIP_ALIAS_AMBIGUOUS");
    return matches[0];
  }

  purgeConfirmedAlias(id: string): void { canonicalTripStore.purge(id); this.publish(); }

  hydrate(): void {
    this.hydrateOnce();
  }

  async saveLocal(input: CanonicalTrip): Promise<CanonicalTrip> {
    localCommitStep("journal-hydrate", () => this.hydrateOnce());
    const trip = localCommitStep("trip-normalize", () => TripRegistrationService.register(input)) as CanonicalTrip;
    const id = idOf(trip);
    const existing = canonicalTripStore.get(id);
    if (isTripTombstoned(id) && !isDeleted(trip)) {
      throw makeTombstoneGuardError();
    }
    // A repeated tap/restart reuses the existing durable attempt.
    if (existing && !isDeleted(existing) && (existing.serverValidatedAt || this.database.get(id))) {
      assertSameTripAttempt(existing, trip);
      return existing;
    }
    const local: CanonicalTrip = {
      ...trip,
      canonicalTripId: id,
      tripId: id,
      status: isDeleted(trip) ? "DELETED" : "PENDING_SYNC",
      recordStatus: trip.recordStatus || "concluida",
      syncStatus: isDeleted(trip) ? "deleted" : "pending_sync",
      offlineSyncStatus: isDeleted(trip) ? "deleted" : "pending_sync",
      validationStatus: isDeleted(trip) ? undefined : "PENDING_VALIDATION",
      deleted: isDeleted(trip),
      syncVersion: Math.max(
        Number(existing?.syncVersion || 0) + (existing ? 1 : 0),
        Number(trip.syncVersion || 1),
      ),
      updatedAt: this.now(),
      clientUpdatedAt: this.now(),
    };
    const record: OfflineTripRecord = { trip: local, syncStatus: "PENDING_SYNC", syncVersion: Number(local.syncVersion || 1), clientUpdatedAt: local.clientUpdatedAt };
    if (this.queue?.enqueueAndSave) {
      await this.queue.enqueueAndSave(record);
      localCommitStep("projection-after-commit", () => canonicalTripStore.upsert(record.trip));
    } else {
      // A repository used without a network queue still records a recoverable
      // intent; SyncEngine reconstructs missing old commands on startup.
      this.persist(local, "PENDING_SYNC");
      await this.queue?.enqueue(local);
    }
    localCommitStep("publish-after-commit", () => this.publish());
    return record.trip;
  }

  async updateLocal(input: CanonicalTrip): Promise<CanonicalTrip> {
    return this.saveLocal(input);
  }

  /** Publish durable queue feedback without treating it as a server ACK. */
  applyLocalSyncState(input: CanonicalTrip, syncStatus: OfflineTripRecord["syncStatus"]): void {
    this.hydrateOnce();
    const current = canonicalTripStore.get(idOf(input));
    if (!current || isDeleted(current) || current.serverValidatedAt || current.editPending ||
        Number(current.syncVersion) !== Number(input.syncVersion)) return;
    this.persist({ ...current, offlineSyncStatus: input.offlineSyncStatus,
      syncStatus: input.syncStatus, validationStatus: input.validationStatus }, syncStatus);
    this.publish();
  }

  async editFieldsLocal(id: string, patch: Record<string, unknown>, actorUserId: string): Promise<CanonicalTrip> {
    this.hydrateOnce();
    const current = this.resolvePhysicalTrip(id);
    if (!current || isDeleted(current)) throw new Error("CANONICAL_TRIP_NOT_FOUND");
    if (!this.queue?.enqueueUpdate) throw new Error("CANONICAL_TRIP_EDIT_QUEUE_UNAVAILABLE");
    const now = this.now();
    const previousRecord = this.database.get(id);
    const baseVersion = Number((current as any).pendingEditBaseVersion ?? current.syncVersion ?? 1);
    const localPatch = Object.fromEntries(Object.entries(patch).filter(([key]) => key === "origem" || key === "destino"));
    const local = {
      ...current, ...localPatch,
      updatedAt: now, clientUpdatedAt: now,
      syncVersion: baseVersion + 1,
      pendingEditBaseVersion: baseVersion,
      editPending: true,
      pendingEditValue: "valor" in patch ? Number(patch.valor) : (current as any).pendingEditValue,
    } as CanonicalTrip;
    const queued = await this.queue.enqueueUpdate(local, patch, actorUserId, baseVersion, current);
    (local as any).pendingEditId = queued.editId;
    this.database.save({
      trip: local, syncStatus: "PENDING_SYNC", syncVersion: local.syncVersion,
      clientUpdatedAt: now, serverUpdatedAt: previousRecord?.serverUpdatedAt,
    });
    canonicalTripStore.upsert(local);
    this.publish();
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("nvu-canonical-trip-queued", { detail: { tripId: id, operation: "UPDATE" } }));
    return local;
  }

  settleEdit(input: CanonicalTrip, expectedEditId: string): CanonicalTrip {
    this.hydrateOnce();
    const id = idOf(input);
    const current = canonicalTripStore.get(id);
    if (current?.editPending && current.pendingEditId !== expectedEditId) return current;
    const cleanInput = { ...input, editPending: false, pendingEditId: undefined, pendingEditBaseVersion: undefined, pendingEditValue: undefined };
    const confirmed = (input.historicalReadOnly
      ? TripRegistrationService.registerHistoricalRead(cleanInput)
      : TripRegistrationService.register(cleanInput)) as CanonicalTrip;
    const result = canonicalTripStore.replaceAuthoritative(confirmed);
    if (isDeleted(result)) markTripTombstoned(id);
    this.database.save({
      trip: result, syncStatus: "SERVER_CONFIRMED", syncVersion: result.syncVersion,
      clientUpdatedAt: String(result.clientUpdatedAt || this.now()), serverUpdatedAt: this.now(),
    });
    this.publish();
    return result;
  }

  rejectEdit(before: CanonicalTrip, expectedEditId: string): void {
    this.hydrateOnce();
    const id = idOf(before);
    if (canonicalTripStore.get(id)?.pendingEditId !== expectedEditId) return;
    const cleanBefore = { ...before, editPending: false, pendingEditId: undefined, pendingEditBaseVersion: undefined, pendingEditValue: undefined };
    const restored = (before.historicalReadOnly
      ? TripRegistrationService.registerHistoricalRead(cleanBefore)
      : TripRegistrationService.register(cleanBefore)) as CanonicalTrip;
    canonicalTripStore.replaceAuthoritative(restored);
    this.database.save({
      trip: restored, syncStatus: "SERVER_CONFIRMED", syncVersion: restored.syncVersion,
      clientUpdatedAt: String(restored.clientUpdatedAt || this.now()), serverUpdatedAt: String(restored.serverUpdatedAt || this.now()),
    });
    this.publish();
  }

  /** Forget a failed device-local projection only; never queues or performs a remote delete. */
  discardFailedLocalProjection(tripId: string): void {
    const id = String(tripId || "").trim();
    if (!id) return;
    canonicalTripStore.purge(id);
    this.publish();
  }

  async deleteLocal(tripId: string, actorUserId?: string): Promise<void> {
    this.hydrateOnce();
    const requestedId = String(tripId || "").trim();
    if (!requestedId) throw new Error("CANONICAL_TRIP_ID_REQUIRED");
    const current = this.resolvePhysicalTrip(requestedId);
    if (!current || isDeleted(current)) throw new Error("CANONICAL_TRIP_NOT_FOUND");
    const id = idOf(current);
    const now = this.now();
    const tombstone = {
      ...(current || {}),
      canonicalTripId: current.canonicalTripId || id,
      tripId: current.tripId || id,
      clientRequestId: current?.clientRequestId || id,
      idempotencyKey: current?.idempotencyKey || id,
      operationId: current?.operationId || current?.jobId || "",
      driverId: current?.driverId || actorUserId || "",
      companyId: current?.companyId || "",
      simulatorId: current?.simulatorId || "unknown",
      contractId: current?.contractId || "",
      status: "DELETED",
      recordStatus: "DELETED",
      deleted: true,
      deletedAt: now,
      updatedAt: now,
      clientUpdatedAt: now,
      syncVersion: Number(current?.syncVersion || 0) + 1,
    } as CanonicalTrip;
    const remoteDeleteRequired = Boolean(this.observedRemoteIds.has(id) || this.database.get(id)?.serverUpdatedAt || (current as any)?.serverValidatedAt);
    this.persist(tombstone, "PENDING_SYNC");
    markTripTombstoned(id);
    this.publish();
    await this.queue?.enqueueDeletion(tombstone, remoteDeleteRequired);
  }

  applyServerSnapshot(input: CanonicalTrip, serverUpdatedAt = this.now()): CanonicalTrip {
    return this.applyServerSnapshots([input], serverUpdatedAt)[0];
  }

  /** Commit one Firestore snapshot with one storage write and one UI publish. */
  applyServerSnapshots(inputs: CanonicalTrip[], serverUpdatedAt = this.now()): CanonicalTrip[] {
    return this.applySnapshotBatch(inputs, serverUpdatedAt, false);
  }

  /**
   * Remote observations belong to the read projection, not the durable command
   * store. Browsing a large history must not consume storage reserved for local
   * commands, and an observation must never acknowledge a queued command.
   */
  applyServerReadSnapshots(inputs: CanonicalTrip[], serverUpdatedAt = this.now()): CanonicalTrip[] {
    return this.applySnapshotBatch(inputs, serverUpdatedAt, true);
  }

  private applySnapshotBatch(inputs: CanonicalTrip[], serverUpdatedAt: string, readObservation: boolean): CanonicalTrip[] {
    this.hydrateOnce();
    const pendingIds = readObservation
      ? new Set(this.database.list().filter((record) => record.syncStatus !== "SERVER_CONFIRMED").map((record) => idOf(record.trip)))
      : new Set<string>();
    const records: OfflineTripRecord[] = [];
    const pendingCandidates: CanonicalTrip[] = [];
    const pendingTombstones: string[] = [];
    const results: CanonicalTrip[] = [];
    const batchWinners = new Map<string, CanonicalTrip>();
    inputs.forEach((input, index) => {
      const key = idOf(input) || `__batch_${index}`;
      const previous = batchWinners.get(key);
      if (!previous || revisionOf(input) > revisionOf(previous) ||
          (revisionOf(input) === revisionOf(previous) && isDeleted(input) && !isDeleted(previous))) {
        batchWinners.set(key, input);
      }
    });
    Array.from(batchWinners.values()).forEach((input, index) => {
      try {
      // Only a physical job with original server proof is LIVE. Legacy aliases
      // and an unproven jobId remain historical observations.
      const hasPhysicalJob = Boolean(String((input as any).jobId || "").trim());
      const historicalRead = !hasPhysicalJob || !isTrustedServerConfirmedTrip(input as any);
      const trip = (historicalRead ? TripRegistrationService.registerHistoricalRead(input) : TripRegistrationService.register(input)) as CanonicalTrip;
      const id = idOf(trip);
      if (readObservation) this.observedRemoteIds.add(id);
      const local = canonicalTripStore.get(id);
      const incomingRevision = revisionOf(trip);
      if (readObservation && local && pendingIds.has(id)) {
        results.push(local);
        return;
      }
      // A read preserves real durable commands above. A flag copied from an
      // older remote row must not freeze subsequent remote observations.
      if (!readObservation && local?.editPending && !isDeleted(trip)) {
        results.push(local);
        return;
      }
      if (isTripTombstoned(id) && !isDeleted(trip)) {
        results.push(local || ({ ...trip, canonicalTripId: id, tripId: id, deleted: true, status: "DELETED" } as CanonicalTrip));
        return;
      }
      if (local && incomingRevision < revisionOf(local)) {
        results.push(local);
        return;
      }
      const confirmed: CanonicalTrip = {
        ...trip,
        canonicalTripId: trip.canonicalTripId || id,
        tripId: trip.tripId || id,
        originalCanonicalTripId: (input as any).canonicalTripId || (trip as any).originalCanonicalTripId || undefined,
        originalTripId: (input as any).tripId || (trip as any).originalTripId || undefined,
        status: isDeleted(trip) ? "DELETED" : trip.status,
        recordStatus: isDeleted(trip) ? "DELETED" : trip.recordStatus,
        deleted: isDeleted(trip),
        serverUpdatedAt: trip.serverUpdatedAt,
        updatedAt: String(trip.updatedAt || (historicalRead ? "" : serverUpdatedAt)),
        clientUpdatedAt: String(trip.clientUpdatedAt || trip.updatedAt || (historicalRead ? "" : serverUpdatedAt)),
        syncVersion: Number(trip.syncVersion || 1),
      };
      if (isDeleted(confirmed)) pendingTombstones.push(id);
      // An older Firestore alias must not overwrite a newer local edit.
      const accepted = local && Number(local.syncVersion || 0) > Number(confirmed.syncVersion || 0)
        ? local
        : confirmed;
      if (accepted !== local) {
        pendingCandidates.push(accepted);
        records.push({
          trip: accepted,
          syncStatus: "SERVER_CONFIRMED",
          syncVersion: Number(accepted.syncVersion || 1),
          clientUpdatedAt: String(accepted.clientUpdatedAt || accepted.updatedAt || serverUpdatedAt),
          serverUpdatedAt: historicalRead ? undefined : serverUpdatedAt,
        });
      }
      results.push(accepted);
      } catch (error) {
        this.lastSnapshotIssues.push({ index, error: error instanceof Error ? error.message : String(error) });
      }
    });
    try {
      // Commands/ACKs remain durable-first. Read observations are re-fetchable
      // and use the separate bounded history cache owned by the read hooks.
      if (!readObservation) this.database.saveMany(records);
      pendingCandidates.forEach((candidate) => canonicalTripStore.upsert(candidate));
      pendingTombstones.forEach((id) => markTripTombstoned(id));
    } catch (error) {
      this.lastSnapshotIssues.push({ index: -1, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
    if (records.length) this.publish();
    const resultById = new Map(results.map((result) => [idOf(result), result]));
    return inputs.map((input) => resultById.get(idOf(input))).filter(Boolean) as CanonicalTrip[];
  }

  beginSnapshotGeneration(): void {
    this.lastSnapshotIssues = [];
  }

  getLastSnapshotIssues(): Array<{ index: number; error: string }> {
    return this.lastSnapshotIssues.slice();
  }

  get(id: string): CanonicalTrip | undefined {
    this.hydrateOnce();
    const requested = String(id || "").trim();
    return canonicalTripStore.get(requested) || canonicalTripStore.listIncludingDeleted().find((trip) =>
      [trip.physicalDocumentId, trip.canonicalTripId, trip.tripId, trip.originalCanonicalTripId, trip.originalTripId]
        .some((alias) => String(alias || "").trim() === requested),
    );
  }

  list(): CanonicalTrip[] {
    this.hydrateOnce();
    return filterTombstonedTrips(canonicalTripStore.list()).filter((trip) => !isDeleted(trip));
  }

  listIncludingDeleted(): CanonicalTrip[] {
    this.hydrateOnce();
    return canonicalTripStore.listIncludingDeleted();
  }

  listPending(): OfflineTripRecord[] {
    this.hydrateOnce();
    return this.database.list().filter((record) => record.syncStatus !== "SERVER_CONFIRMED");
  }

  markSyncing(id: string): void {
    this.database.updateSyncStatus(String(id || "").trim(), "SYNCING");
  }

  confirmServer(id: string, serverTrip?: CanonicalTrip): CanonicalTrip | undefined {
    const current = serverTrip || this.database.get(String(id || "").trim())?.trip;
    if (!current) return undefined;
    return this.applyServerSnapshot(current);
  }

  subscribe(listener: (trips: CanonicalTrip[]) => void): () => void {
    this.listeners.add(listener);
    try { listener(this.list()); } catch (error) { console.warn("[NVU] Observador de viagens indisponível", error); }
    return () => this.listeners.delete(listener);
  }

  /** Used by tests and migration diagnostics without exposing internal maps. */
  inspect(id: string): { trip?: CanonicalTrip; tombstoned: boolean; updatedAt: number } {
    const trip = this.get(id);
    return { trip, tombstoned: isTripTombstoned(id), updatedAt: timestampOf(trip) };
  }
}

export const canonicalTripRepository = new CanonicalTripRepository();
