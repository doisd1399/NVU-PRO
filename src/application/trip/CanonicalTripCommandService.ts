import type { CanonicalTrip } from "../../domain/trip/CanonicalTrip";
import { OfflineFirstCanonicalTripGateway } from "./persistence/OfflineFirstCanonicalTripGateway";
import { auth } from "../../lib/firebase";
import { isDefinitelyOffline } from "../../lib/connectivity";
import { syncEngine } from "../../services/sync/SyncEngine";
import { TripRegistrationService } from "./TripRegistrationService";
import { markTripTombstoned } from "../../lib/tripTombstones";
import { canonicalTripRepository } from "../../repositories/CanonicalTripRepository";
import { emitCanonicalTripUpdated } from "../../lib/CanonicalTripUpdateEvent";
import { tagLocalCommitError } from "../../lib/localCommitDiagnostic";

type CommandDependencies = {
  getCurrentUser?: () => { uid: string } | null;
  isOffline?: () => boolean;
  sync?: Pick<typeof syncEngine, "synchronize" | "getResult"> &
    Partial<Pick<typeof syncEngine, "deleteRemoteFirst" | "acknowledgeServerDeletion">>;
};

/** Single command gateway for Print, Pro, edit and delete. */
export class CanonicalTripCommandService {
  private readonly getCurrentUser: NonNullable<CommandDependencies["getCurrentUser"]>;
  private readonly isOffline: NonNullable<CommandDependencies["isOffline"]>;
  private readonly sync: NonNullable<CommandDependencies["sync"]>;

  constructor(
    private readonly gateway = new OfflineFirstCanonicalTripGateway(),
    dependencies: CommandDependencies = {},
  ) {
    this.getCurrentUser = dependencies.getCurrentUser || (() => auth.currentUser);
    this.isOffline = dependencies.isOffline || isDefinitelyOffline;
    this.sync = dependencies.sync || syncEngine;
  }

  async save(trip: CanonicalTrip): Promise<CanonicalTrip> { return this.gateway.save(trip); }

  async update(trip: CanonicalTrip | string, data?: Partial<CanonicalTrip>): Promise<CanonicalTrip> {
    if (typeof trip !== "string") throw new Error("CANONICAL_TRIP_EDIT_FIELDS_REQUIRED");
    const id = String(trip || "").trim();
    const actor = this.getCurrentUser()?.uid;
    if (!id || !actor) throw new Error("CANONICAL_TRIP_EDIT_IDENTITY_REQUIRED");
    const allowed = new Set(["origem", "destino", "valor", "valorCents", "valorEditadoNoPainelSenior", "valorEditadoPor", "valorEditadoEm"]);
    const patch = data as Record<string, unknown> | undefined;
    if (!patch || !Object.keys(patch).length || Object.keys(patch).some((key) => !allowed.has(key))) {
      throw new Error("CANONICAL_TRIP_EDIT_FIELDS_INVALID");
    }
    const local = await this.gateway.editFields(id, patch, actor);
    if (this.isOffline()) return local;
    // The edit is already durable and explicitly marked editPending. Give a
    // fast ACK one short interaction budget; slow transport continues without
    // trapping the editor behind the entire synchronization backlog.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([this.sync.synchronize(), new Promise<void>(resolve => {
        timer = setTimeout(resolve, 250);
      })]);
    } finally { if (timer) clearTimeout(timer); }
    const editId = typeof local.pendingEditId === "string" ? local.pendingEditId : undefined;
    const result = this.sync.getResult(id, editId);
    if (result?.state === "FAILED" || result?.state === "CONFLICT" || result?.lastError === "CANONICAL_TRIP_CONFLICT_SERVER_WON") {
      throw new Error(result.lastError || "CANONICAL_TRIP_EDIT_FAILED");
    }
    return result?.state === "SERVER_CONFIRMED" && result.operation === "UPDATE"
      ? canonicalTripRepository.get(id) || result.trip : local;
  }

  async delete(tripId: string): Promise<void> {
    const id = String(tripId || "").trim();
    if (!id) throw new Error("CANONICAL_TRIP_ID_REQUIRED");
    // The online path is server-first. Otherwise a permission-denied response
    // leaves a permanent local tombstone even though Firestore kept the trip.
    const offline = this.isOffline();
    const serverFirst = !offline && Boolean(this.sync.deleteRemoteFirst);
    let serverSnapshot: Partial<CanonicalTrip> | undefined;
    if (serverFirst) {
      const result = await this.sync.deleteRemoteFirst!(id);
      serverSnapshot = result.data as Partial<CanonicalTrip>;
      if (!result.localOnly) {
        if (result.tripId !== id || serverSnapshot.deleted !== true || serverSnapshot.status !== "DELETED"
          || !serverSnapshot.deletedAt) throw new Error("SERVER_TRIP_DELETE_ACK_INVALID");
        // A realtime listener may already have removed/tombstoned the row.
        // Do not perform a second local deletion after a durable server ACK.
        await this.sync.acknowledgeServerDeletion?.(id, result.data);
        await this.markTripDeleted(id, true, serverSnapshot);
        return;
      }
    }
    await this.gateway.remove(id, this.getCurrentUser()?.uid);
    if (offline) {
      await this.markTripDeleted(id, false);
      return;
    }
    await (this.sync.synchronize)();
    // The server-first transaction already committed. Queue replay is
    // idempotent, but a concurrent synchronization can leave its item pending.
    if (serverFirst && serverSnapshot) {
      await this.markTripDeleted(id, false);
      return;
    }
    const result = this.sync.getResult(id);
    if (result?.state === "FAILED" || result?.state === "CONFLICT") throw new Error(result.lastError || "CANONICAL_TRIP_DELETE_FAILED");
    if (result?.state !== "SERVER_CONFIRMED") throw new Error("CANONICAL_TRIP_DELETE_PENDING_SERVER_ACK");
    await this.markTripDeleted(id, true, result.trip);
  }

  async addTripWithinOperationLimit(trip: any, _options?: any): Promise<any> {
    const canonicalTrip = TripRegistrationService.register(trip) as CanonicalTrip;
    const tripId = String(canonicalTrip.canonicalTripId || canonicalTrip.tripId || "").trim();
    if (!tripId) throw new Error("CANONICAL_TRIP_ID_REQUIRED");
    const driverId = String(canonicalTrip.driverId || "").trim();
    if (!this.getCurrentUser() || this.getCurrentUser()!.uid !== driverId) throw new Error("CANONICAL_TRIP_AUTH_SCOPE_MISMATCH");
    let savedTrip: CanonicalTrip;
    const localCommitStarted = Date.now();
    try { savedTrip = await this.save(canonicalTrip); }
    catch (error) {
      const tombstoned = (error as { code?: string })?.code === "CANONICAL_TRIP_TOMBSTONED";
      const failure = tagLocalCommitError(error, tombstoned ? "identity-tombstone-check" : "repository-save");
      try { Object.assign(failure, { tripSyncStage: tombstoned ? "IDENTITY_GUARD" : "LOCAL_COMMIT", localCommitTripId: tripId,
        localCommitElapsedMs: Date.now() - localCommitStarted }); } catch { /* diagnostic only */ }
      throw failure;
    }
    const localTrip = savedTrip;
    const pendingReference = { id: tripId, tripId, offline: true, localId: tripId, data: localTrip };
    if (savedTrip.status === "SERVER_CONFIRMED" && savedTrip.serverValidatedAt) {
      return { id: tripId, tripId, offline: false, data: savedTrip, syncState: "SERVER_CONFIRMED" };
    }
    if (this.isOffline()) return pendingReference;
    // Once the journal commits, a supervisor failure cannot undo acceptance.
    // The owned command remains visible and resumable after a reload.
    const synchronization = Promise.resolve().then(() => this.sync.synchronize())
      .catch(() => undefined);
    // Print opens history as soon as the journal commits. The status listener
    // owns subsequent upload, refusal and ACK updates for the same identity.
    if (_options?.waitForServerAck === false) return { ...pendingReference, syncState: "PENDING_SYNC" };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Persistence is already durable. Slow network ACK must not hold the
      // driver's screen; the outbox continues with the same idempotent attempt.
      await Promise.race([synchronization, new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 250);
      })]);
    } finally { if (timer) clearTimeout(timer); }
    let result: ReturnType<typeof syncEngine.getResult>;
    try { result = this.sync.getResult(tripId); }
    catch { return { ...pendingReference, syncState: "PENDING_SYNC", tripSyncStage: "SYNC_SCHEDULE" }; }
    if (result?.state === "SERVER_CONFIRMED") return { id: tripId, tripId, offline: false, data: result.trip };
    if (result?.state === "FAILED" || result?.state === "CONFLICT") {
      return { ...pendingReference, syncState: result.state,
        lastError: result.lastError, tripSyncStage: result.lastFailureStage };
    }
    return { ...pendingReference, syncState: result?.state || "PENDING_SYNC" };
  }

  async markTripDeleted(
    tripId: string,
    serverConfirmed = false,
    serverTrip?: Partial<CanonicalTrip>,
  ): Promise<void> {
    const id = String(tripId || "").trim();
    if (!id) return;
    const now = new Date().toISOString();
    const current = canonicalTripRepository.get(id);
    const historical = Boolean(serverTrip && (serverTrip.historicalReadOnly || !serverTrip.jobId
      || (serverTrip.tripId && serverTrip.tripId !== id)
      || (serverTrip.canonicalTripId && serverTrip.canonicalTripId !== id)));
    const source = serverTrip
      ? historical
        ? TripRegistrationService.registerHistoricalRead({ ...serverTrip, id, physicalDocumentId: id })
        : TripRegistrationService.register({ ...serverTrip, id, physicalDocumentId: id, canonicalTripId: id, tripId: id })
      : current;
    markTripTombstoned(id);
    if (!source) {
      emitCanonicalTripUpdated(TripRegistrationService.register({
        id, canonicalTripId: id, tripId: id, deleted: true, status: "DELETED",
      }));
      return;
    }
    const alreadyDeleted = source.deleted === true || source.status === "DELETED";
    const deletedInput = {
      ...source,
      deleted: true,
      status: "DELETED",
      recordStatus: "DELETED",
      deletedAt: source.deletedAt || now,
      deletedBy: (source as any).deletedBy || this.getCurrentUser()?.uid || "",
      updatedAt: now,
      clientUpdatedAt: source.clientUpdatedAt || now,
      syncVersion: alreadyDeleted
        ? source.syncVersion
        : Math.max(1, Number(source.syncVersion || 0) + 1),
      syncStatus: serverConfirmed ? "synced" : source.syncStatus,
      offlineSyncStatus: "deleted",
      serverUpdatedAt: serverConfirmed ? now : source.serverUpdatedAt,
    } as Partial<CanonicalTrip>;
    const deletedTrip = (source.historicalReadOnly
      ? TripRegistrationService.registerHistoricalRead(deletedInput)
      : TripRegistrationService.register(deletedInput)) as CanonicalTrip;
    if (serverConfirmed) {
      try {
        canonicalTripRepository.applyServerSnapshot(deletedTrip, now);
      } catch (error) {
        console.warn("A exclusão foi confirmada no servidor, mas o cache local será reidratado pelo listener.", error);
      }
    }
    emitCanonicalTripUpdated(deletedTrip);
  }
  async deleteTrip(tripId: string): Promise<void> { return this.delete(tripId); }
}

export const canonicalTripCommandService = new CanonicalTripCommandService();
