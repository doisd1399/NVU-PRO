import { withTripJournalLock } from "../offline/tripJournalLock";
import { localCommitStep, tagLocalCommitError } from "../../lib/localCommitDiagnostic";
import { auth } from "../../lib/firebase";
import type { CanonicalTrip } from "../../domain/trip/CanonicalTrip";
import { resolveOperationalIdentity } from "../../domain/operation/OperationalIdentity";
import { createCanonicalOutboxEntry, type CanonicalTripOutboxEntry } from "../../domain/trip/CanonicalTripOutbox";
import { TripRegistrationService } from "../../application/trip/TripRegistrationService";
import { isConnectivityError } from "../../lib/connectivity";
import { OfflineDatabase, type OfflineTripRecord } from "../offline/OfflineDatabase";
import { firebaseTripSyncAdapter } from "./FirebaseTripSyncAdapter";
import { TripReconciliationService } from "../../application/trip/TripReconciliationService";
import { emitCanonicalTripUpdated } from "../../lib/CanonicalTripUpdateEvent";
import { canonicalTripRepository } from "../../repositories/CanonicalTripRepository";
import { isTripTombstoned } from "../../lib/tripTombstones";
import { failedRegistrationRecoveryReason, inspectFailedRegistrationRecovery, type FailedRegistrationRecovery } from "../../lib/failedTripRegistrationRecovery";
import { isOperationStartPending } from "../../application/operation/OperationSyncBarrier";
import { tripSyncDeadline } from "../../lib/tripSyncDeadline";
import { assertSameTripAttempt } from "../../domain/trip/TripAttemptIdentity";
import { readGtoPrintEvidence } from "../../../functions/src/gtoPrintEvidence";

export type SyncState = "PENDING_SYNC" | "SYNCING" | "SERVER_CONFIRMED" | "FAILED" | "CONFLICT";
export interface SyncItem extends Partial<CanonicalTripOutboxEntry> {
  trip: CanonicalTrip;
  operation?: "UPSERT" | "DELETE" | "UPDATE";
  remoteDeleteRequired?: boolean;
  actorUserId?: string;
  editPatch?: Record<string, unknown>;
  baseVersion?: number;
  editId?: string;
  beforeEdit?: CanonicalTrip;
  registrationProtocolVersion?: number;
  retryAt?: string;
  confirmedAt?: string;
  lastAuthorizationProbeAt?: number;
  serverRetryable?: boolean;
  state: SyncState;
  attempts: number;
  queuedAt: string;
  syncingAt?: string;
  lastError?: string;
  conflictResolution?: "SERVER_WON" | "CLIENT_WON" | "MANUAL_REVIEW";
  alternatives?: Array<{ commandKey: string; entry: SyncItem; reason: string }>;
  /** Explicit History recovery is one attempt, never an automatic retry loop. */
  manualHistoryRecoveryAttempt?: boolean;
  lastFailureStage?: string;
}
type SyncPushResult = { confirmed: true; tripId: string; data: Record<string, unknown> };
type SyncAdapter = {
  push: (trip: CanonicalTrip) => Promise<SyncPushResult>;
  authorizeRecovery?: (trip: CanonicalTrip) => Promise<boolean>;
  delete?: (trip: CanonicalTrip) => Promise<SyncPushResult>;
  update?: (trip: CanonicalTrip, patch: Record<string, unknown>, baseVersion: number, editId: string, actorUserId: string, beforeEdit?: CanonicalTrip) => Promise<SyncPushResult>;
};
type SyncEngineDependencies = {
  operationStartPending?: (uid: string, jobId: string) => boolean;
  adapter?: SyncAdapter;
  getCurrentUser?: () => { uid: string } | null;
  offlineDatabase?: OfflineDatabase;
  storage?: Pick<Storage, "getItem" | "setItem">;
  transportTimeoutMs?: number;
};

const tripIdOf = (trip?: CanonicalTrip) => String(trip?.physicalDocumentId || trip?.canonicalTripId || trip?.tripId || trip?.clientRequestId || trip?.idempotencyKey || "").trim();
const ownerOf = (trip?: CanonicalTrip) => String(trip?.driverId || (trip as any)?.motoristaId || "").trim();
const jobOf = (trip?: CanonicalTrip) => String(trip?.jobId || "").trim();
const validQueueEntry = (item: unknown): item is SyncItem => Boolean(item && typeof item === "object" && (item as any).trip && typeof (item as any).trip === "object");
const queueItems = (queue: Record<string, SyncItem>): SyncItem[] => Object.values(queue).filter(validQueueEntry);
const operationQueueKey = (item: SyncItem) => `${ownerOf(item.trip)}:${jobOf(item.trip) || tripIdOf(item.trip)}`;
const AUTHORIZATION_PROBE_MS = 5 * 60 * 1000;
const recoverableAuthorizationPause = (item: SyncItem) => item.state === "FAILED" &&
  (!item.operation || item.operation === "UPSERT") && item.serverRetryable !== false && !item.alternatives?.length &&
  /^(?:functions\/(?:permission-denied|unauthenticated)|permission-denied|storage\/(?:unauthorized|unauthenticated)):/i.test(item.lastError || "");
const SYNCING_LEASE_MS = 5 * 60 * 1000;
const retryTimeOf = (item: SyncItem): number => {
  const value: unknown = item.retryAt;
  const time = typeof value === "number" ? value : Date.parse(String(value || ""));
  return Number.isFinite(time) ? time : 0;
};
const isAbandonedSync = (item: SyncItem, now = Date.now()) => {
  if (item.state !== "SYNCING") return false;
  const startedAt = Date.parse(String(item.syncingAt || ""));
  return !Number.isFinite(startedAt) || now - startedAt >= SYNCING_LEASE_MS;
};
const isRetryableServerAvailabilityError = (error: unknown): boolean => {
  const code = String((error as any)?.code || "").toLowerCase();
  const message = String((error as any)?.message || error || "").toLowerCase();
  return [
    "functions/not-found",
    "functions/unavailable",
    "functions/internal",
    "functions/deadline-exceeded",
    "unavailable",
    "deadline-exceeded",
    "network-request-failed",
    "storage/retry-limit-exceeded",
    "resource-exhausted",
    "aborted",
  ].some((token) => code.includes(token) || message.includes(token));
};
type SyncStorage = Pick<Storage, "getItem" | "setItem">;
function resolveDefaultStorage(): SyncStorage | null {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
}

export class SyncEngine {
  // Queue and local records share OfflineDatabase's atomic envelope.
  private readonly reconciliation = new TripReconciliationService();
  private readonly offlineDatabase: OfflineDatabase;
  private readonly adapter: SyncAdapter;
  private readonly getCurrentUser: () => { uid: string } | null;
  private readonly storage: SyncStorage | null;
  private readonly operationStartPending: (uid: string, jobId: string) => boolean;
  private readonly transportTimeoutMs: number;
  private running: Promise<{ synchronized: number; results: SyncItem[]; validated: boolean; tripId?: string }> | null = null;
  private synchronizeAgain = false;
  private readonly queueWaiters = new Set<() => void>();
  private wakeQueueWorkers(): void {
    const waiters = [...this.queueWaiters]; this.queueWaiters.clear(); waiters.forEach(wake => wake());
  }
  private pendingHeads(uid: string): Array<[string, SyncItem]> {
    const candidates = Object.entries(this.read()).filter((entry): entry is [string, SyncItem] => validQueueEntry(entry[1]) &&
      (entry[1].state === "PENDING_SYNC" || entry[1].state === "SYNCING") &&
      (entry[1].operation === "UPDATE" ? entry[1].actorUserId === uid : ownerOf(entry[1].trip) === uid))
      .sort((a, b) => String(a[1].queuedAt || a[1].trip.createdAt || "").localeCompare(String(b[1].queuedAt || b[1].trip.createdAt || "")));
    const seen = new Set<string>();
    return candidates.filter(([, item]) => { const key = operationQueueKey(item); if (seen.has(key)) return false; seen.add(key); return true; });
  }
  private readonly entryFlights = new Map<string, Promise<void>>();
  private authorizationRecovery: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private queueMutation: Promise<void> = Promise.resolve();

  constructor(dependencies: SyncEngineDependencies = {}) {
    this.offlineDatabase = dependencies.offlineDatabase || new OfflineDatabase(dependencies.storage === undefined ? {} : { storage: dependencies.storage });
    this.adapter = dependencies.adapter || firebaseTripSyncAdapter;
    this.getCurrentUser = dependencies.getCurrentUser || (() => auth.currentUser);
    this.storage = dependencies.storage === undefined ? resolveDefaultStorage() : dependencies.storage;
    this.operationStartPending = dependencies.operationStartPending || isOperationStartPending;
    this.transportTimeoutMs = dependencies.transportTimeoutMs ?? 180_000;
  }

  private read(): Record<string, SyncItem> {
    const queue = this.offlineDatabase.readOutbox() as Record<string, SyncItem>;
    if (this.migrateLegacyQueueKeys(queue)) this.write(queue);
    return queue;
  }

  /** Convert pre-physical-key entries without discarding edits or receipts. */
  private migrateLegacyQueueKeys(queue: Record<string, SyncItem>): boolean {
    let changed = false;
    for (const [storedKey, entry] of Object.entries(queue)) {
      if (!validQueueEntry(entry)) continue;
      const physicalId = String(entry.trip?.physicalDocumentId || "").trim();
      if (!physicalId || storedKey === physicalId) continue;
      // These are current, intentional command keys, not a legacy alias for
      // the document. Collapsing them turned a new edit into a migration
      // conflict with a previous failed/acknowledged attempt.
      if (entry.schemaVersion === 1 && entry.operation === "UPDATE" && entry.editId &&
          storedKey === `${physicalId}::command:${entry.editId}`) continue;
      const existing = queue[physicalId];
      if (Object.hasOwn(queue, physicalId) && !validQueueEntry(existing)) continue;
      if (!existing) {
        queue[physicalId] = { ...entry, trip: { ...entry.trip, physicalDocumentId: physicalId } };
        delete queue[storedKey];
        changed = true;
        continue;
      }
      const existingPatch = existing.editPatch || {};
      const incomingPatch = entry.editPatch || {};
      const conflictingFields = Object.keys(incomingPatch).filter((field) =>
        Object.hasOwn(existingPatch, field) && String(existingPatch[field]) !== String(incomingPatch[field]),
      );
      const commandCompatible = existing.operation === entry.operation &&
        String(existing.actorUserId || "") === String(entry.actorUserId || "") &&
        Number(existing.baseVersion || 0) === Number(entry.baseVersion || 0) &&
        existing.state !== "SERVER_CONFIRMED" && entry.state !== "SERVER_CONFIRMED" &&
        existing.operation !== "DELETE" && Number(existing.attempts || 0) === 0 &&
        !existing.lastError && !existing.syncingAt;
      if (!commandCompatible || conflictingFields.length) {
        const alternatives = [
          ...(existing.alternatives || []),
          { commandKey: storedKey, entry: { ...entry, trip: { ...entry.trip, physicalDocumentId: physicalId } },
            reason: conflictingFields.length ? "PAYLOAD_CONFLICT" : "COMMAND_OR_STATE_CONFLICT" },
        ];
        queue[physicalId] = {
          ...existing,
          trip: { ...existing.trip, physicalDocumentId: physicalId },
          state: "CONFLICT",
          lastError: "CANONICAL_TRIP_QUEUE_MIGRATION_CONFLICT",
          conflictResolution: "MANUAL_REVIEW",
          alternatives,
        };
        delete queue[storedKey];
        changed = true;
        continue;
      }
      queue[physicalId] = {
        ...existing,
        trip: { ...existing.trip, physicalDocumentId: physicalId },
        editPatch: { ...incomingPatch, ...existingPatch },
        beforeEdit: existing.beforeEdit || entry.beforeEdit,
        baseVersion: existing.baseVersion ?? entry.baseVersion,
        editId: existing.editId || entry.editId,
        queuedAt: [existing.queuedAt, entry.queuedAt].filter(Boolean).sort()[0] || entry.queuedAt,
        state: existing.state,
        lastError: existing.lastError,
        conflictResolution: existing.conflictResolution,
      };
      delete queue[storedKey];
      changed = true;
    }
    return changed;
  }

  private write(queue: Record<string, SyncItem>, record?: OfflineTripRecord) {
    try { this.offlineDatabase.commitOutbox(queue, record); }
    catch (cause) { if (record) throw cause; throw Object.assign(new Error("SYNC_QUEUE_STORAGE_WRITE_FAILED"), { cause }); }
  }

  /** Serialize within this process and, where supported, across browser tabs. */
  private async mutateQueue<T>(mutator: (queue: Record<string, SyncItem>) => T, record?: OfflineTripRecord): Promise<T> {
    const previous = this.queueMutation;
    let release!: () => void;
    this.queueMutation = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const commit = () => {
      const queue = localCommitStep("queue-read", () => this.read());
      const result = localCommitStep("queue-validate", () => mutator(queue));
      localCommitStep("journal-write", () => this.write(queue, record));
      return result;
    };
    try {
      return await withTripJournalLock(commit);
    } catch (error) {
      throw tagLocalCommitError(error, "journal-lock");
    } finally { release(); }
  }

  /** Repository's registration and outbox share one durable commit. */
  async enqueueAndSave(record: OfflineTripRecord) {
    const trip = record.trip, id = tripIdOf(trip);
    if (!id) throw new Error("CANONICAL_TRIP_ID_REQUIRED");
    await this.mutateQueue(queue => {
      const existing = queue[id];
      if (existing && !validQueueEntry(existing)) throw new Error("CANONICAL_TRIP_QUEUE_ENTRY_REQUIRES_REVIEW");
      if (existing) {
        assertSameTripAttempt(existing.trip, trip);
        if (existing.state === "SERVER_CONFIRMED") {
          record.trip = existing.trip; record.syncStatus = "SERVER_CONFIRMED";
          record.clientUpdatedAt = existing.trip.clientUpdatedAt; return;
        }
        if (existing.operation && existing.operation !== "UPSERT") throw new Error("CANONICAL_TRIP_PENDING_COMMAND_CONFLICT");
        if (Number(existing.trip.syncVersion || 1) !== Number(trip.syncVersion || 1)) throw new Error("CANONICAL_TRIP_PENDING_VERSION_CONFLICT");
        record.trip = existing.trip; record.clientUpdatedAt = existing.trip.clientUpdatedAt;
        return;
      }
      queue[id] = createCanonicalOutboxEntry({ trip, identity: trip.operationalIdentity || resolveOperationalIdentity(trip as unknown as Record<string, unknown>), existing });
    }, record);
    if (this.running) { this.synchronizeAgain = true; this.wakeQueueWorkers(); }
    // Notify only after both the trip and its command are durable.
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("nvu-canonical-trip-queued", { detail: { tripId: id } }));
    return { queued: true, id };
  }

  /** Recover pre-505 orphan records and recognizable old transport failures.
   * Domain rejections, deleted history, edits and other owners are untouched. */
  private async recoverPendingRecords(uid: string): Promise<void> {
    const records = this.offlineDatabase.list();
    const recordsById = new Map(records.map(record => [tripIdOf(record.trip), record]));
    await this.mutateQueue(queue => {
      for (const record of records) {
        const trip = record.trip, id = tripIdOf(trip);
        if (!id || ownerOf(trip) !== uid || trip.deleted || trip.status === "DELETED" ||
            isTripTombstoned(id) || record.syncStatus === "SERVER_CONFIRMED" || trip.serverValidatedAt ||
            trip.historicalReadOnly || trip.editPending || !jobOf(trip) || !trip.companyId || !trip.contractId ||
            !trip.idempotencyKey || !Number.isFinite(Number(trip.valor)) || Number(trip.valor) <= 0) continue;
        const commands = queueItems(queue).filter(item => tripIdOf(item.trip) === id);
        if (!commands.length && !Object.hasOwn(queue, id)) queue[id] = createCanonicalOutboxEntry({ trip, identity: trip.operationalIdentity || resolveOperationalIdentity(trip as unknown as Record<string, unknown>) });
      }
      for (const item of queueItems(queue)) {
        if (ownerOf(item.trip) !== uid || item.state !== "FAILED" || item.alternatives?.length ||
            (item.operation && item.operation !== "UPSERT") || (item as any).serverRetryable === false) continue;
        const original = recordsById.get(tripIdOf(item.trip));
        const oldConfirmationReadFailure = item.lastFailureStage === "SERVER_READ" &&
          original?.trip.offlineSyncStatus === "server_received" &&
          /^(?:functions\/)?(?:permission-denied|unauthenticated):/i.test(item.lastError || "");
        if (!oldConfirmationReadFailure && !isRetryableServerAvailabilityError({ code: String(item.lastError || "").split(":")[0] })) continue;
        item.state = "PENDING_SYNC";
        item.retryAt = undefined;
        item.manualHistoryRecoveryAttempt = false;
      }
    });
    // Old authorization repairs must never hold a newly saved receipt behind a
    // 20-second network probe. Each paused entry retains its own retry barrier.
    if (!this.authorizationRecovery) {
      this.authorizationRecovery = this.recoverAuthorizationPauses(uid).finally(() => {
        this.authorizationRecovery = null;
      });
      void this.authorizationRecovery.catch(() => undefined);
    }
  }

  private async recoverAuthorizationPauses(uid: string): Promise<void> {
    if (!this.adapter.authorizeRecovery) return;
    let recovered = false;
    for (const [id, item] of Object.entries(this.read())) {
      if (this.getCurrentUser()?.uid !== uid) break;
      if (ownerOf(item.trip) !== uid || !recoverableAuthorizationPause(item) ||
          Number(item.lastAuthorizationProbeAt || 0) + AUTHORIZATION_PROBE_MS > Date.now()) continue;
      const claimed = await this.mutateQueue(queue => {
        const current = queue[id];
        if (!current || !recoverableAuthorizationPause(current) || this.getCurrentUser()?.uid !== uid ||
            Number(current.lastAuthorizationProbeAt || 0) + AUTHORIZATION_PROBE_MS > Date.now()) return undefined;
        current.lastAuthorizationProbeAt = Date.now(); return current;
      });
      if (!claimed) continue;
      let allowed = false;
      try { allowed = await tripSyncDeadline(this.adapter.authorizeRecovery(claimed.trip), 20_000, "AUTHORIZATION_RECOVERY"); } catch { /* paused, probe later */ }
      if (allowed && this.getCurrentUser()?.uid === uid) recovered = true;
      await this.patchEntry(id, current => this.getCurrentUser()?.uid === uid && current.state === "FAILED" &&
        current.lastAuthorizationProbeAt === claimed.lastAuthorizationProbeAt && allowed
          ? { ...current, state: "PENDING_SYNC", retryAt: undefined, syncingAt: undefined }
          : current);
    }
    if (recovered && this.getCurrentUser()?.uid === uid) void this.synchronize().catch(() => undefined);
  }

  private async patchEntry(id: string, patch: (entry: SyncItem) => SyncItem, expectedSyncingAt?: string) {
    return this.mutateQueue((queue) => {
      const current = queue[id];
      if (!current || (expectedSyncingAt && current.syncingAt !== expectedSyncingAt)) return undefined;
      queue[id] = patch(current);
      return queue[id];
    });
  }

  async enqueue(trip: CanonicalTrip) {
    const id = tripIdOf(trip);
    if (!id) throw new Error("CANONICAL_TRIP_ID_REQUIRED");
    const queued = await this.mutateQueue((queue) => {
      const existing = queue[id];
      const incomingVersion = Number(trip.syncVersion || 1);
      const existingVersion = Number(existing?.trip?.syncVersion || 0);
      if (existing?.state === "SERVER_CONFIRMED" && incomingVersion <= existingVersion && trip.status !== "PENDING_SYNC") return false;
      if (existing?.state === "SYNCING" && !isAbandonedSync(existing) && incomingVersion <= existingVersion) return false;
      queue[id] = createCanonicalOutboxEntry({ trip, identity: trip.operationalIdentity || resolveOperationalIdentity(trip as unknown as Record<string, unknown>), existing });
      return true;
    });
    if (queued && this.running) this.synchronizeAgain = true;
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("nvu-canonical-trip-queued", { detail: { tripId: id } }));
    return { queued, id };
  }

  async enqueueDeletion(trip: CanonicalTrip, remoteDeleteRequired = true) {
    const id = tripIdOf(trip);
    if (!id) throw new Error("CANONICAL_TRIP_ID_REQUIRED");
    const queued = await this.mutateQueue((queue) => {
      const existing = queue[id];
      if (existing?.operation === "DELETE" && existing.state === "SERVER_CONFIRMED" && Number(existing.trip.syncVersion || 0) >= Number(trip.syncVersion || 0)) return false;
      queue[id] = createCanonicalOutboxEntry({ trip, identity: trip.operationalIdentity || resolveOperationalIdentity(trip as unknown as Record<string, unknown>), operation: "DELETE", existing: { ...existing, remoteDeleteRequired } });
      return true;
    });
    if (queued && this.running) this.synchronizeAgain = true;
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("nvu-canonical-trip-queued", { detail: { tripId: id, operation: "DELETE" } }));
    return { queued: true, id };
  }

  async enqueueUpdate(trip: CanonicalTrip, patch: Record<string, unknown>, actorUserId: string, baseVersion: number, before: CanonicalTrip) {
    const id = tripIdOf(trip);
    // Only a command for this trip can conflict with its edit. Unrelated
    // receipts must not prevent persisting an edit into the durable outbox.
    await this.entryFlights.get(id);
    if (!id || !actorUserId) throw new Error("CANONICAL_TRIP_EDIT_IDENTITY_REQUIRED");
    const result = await this.mutateQueue((queue) => {
      if (this.getCurrentUser()?.uid !== actorUserId) throw new Error("TRIP_EDIT_ACTOR_SCOPE_MISMATCH");
      const existing = queue[id];
      if (existing?.operation === "UPDATE" && existing.state === "PENDING_SYNC" && existing.actorUserId !== actorUserId) throw new Error("TRIP_EDIT_ACTOR_SCOPE_MISMATCH");
      if (existing?.state === "SYNCING" && !isAbandonedSync(existing)) throw new Error("TRIP_EDIT_SYNC_IN_PROGRESS");
      if (existing && existing.state !== "SERVER_CONFIRMED" && existing.operation !== "UPDATE") throw new Error("TRIP_EDIT_PENDING_REGISTRATION");
      const mergeable = existing?.operation === "UPDATE" && (existing.state === "PENDING_SYNC" || isAbandonedSync(existing)) &&
        Number(existing.attempts || 0) === 0 && !existing.lastError && !existing.syncingAt;
      const editId = mergeable ? existing!.editId! : globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
      const targetKey = existing && existing.operation === "UPDATE" && !mergeable && existing.state !== "SERVER_CONFIRMED"
        ? `${id}::command:${editId}` : id;
      queue[targetKey] = { ...createCanonicalOutboxEntry({ trip, identity: trip.operationalIdentity || resolveOperationalIdentity(trip as unknown as Record<string, unknown>), operation: "UPDATE", existing: mergeable ? existing : undefined }), actorUserId, editId, editPatch: { ...(mergeable ? existing!.editPatch : {}), ...patch }, baseVersion: mergeable ? existing!.baseVersion : baseVersion, beforeEdit: mergeable ? existing!.beforeEdit : before, state: "PENDING_SYNC", attempts: 0, queuedAt: mergeable ? existing!.queuedAt : new Date().toISOString() };
      return { editId };
    });
    if (this.running) { this.synchronizeAgain = true; this.wakeQueueWorkers(); }
    return result;
  }

  synchronize() {
    if (this.running) {
      this.synchronizeAgain = true; this.wakeQueueWorkers();
      return this.running;
    }
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    const uid = this.getCurrentUser()?.uid;
    this.running = (async () => {
      const results: SyncItem[] = [];
      do {
        this.synchronizeAgain = false;
        const batch = await this.runSynchronization();
        results.push(...batch.results);
        // Commands queued during a request are drained in the same flight,
        // rather than waiting for the retry timer after an obsolete snapshot.
      } while (this.synchronizeAgain && this.getCurrentUser()?.uid === uid &&
        (typeof navigator === "undefined" || navigator.onLine !== false));
      const confirmed = results.filter(item => item.state === "SERVER_CONFIRMED");
      return { synchronized: confirmed.length, results, validated: confirmed.length > 0,
        tripId: confirmed.at(-1) ? tripIdOf(confirmed.at(-1)!.trip) : undefined };
    })().finally(() => {
      this.running = null;
      try { this.scheduleRetryIfPending(); } catch (error) { console.warn("[NVU] Fila preservada; armazenamento indisponível", error); }
    });
    return this.running;
  }

  private scheduleRetryIfPending(): void {
    if (this.retryTimer || typeof navigator === "undefined" || navigator.onLine === false || !this.getCurrentUser()?.uid) return;
    const pending = [...this.pendingHeads(this.getCurrentUser()!.uid).map(([, item]) => item), ...queueItems(this.read()).filter(recoverableAuthorizationPause)].filter((item) =>
      (item.state === "PENDING_SYNC" || item.state === "SYNCING" || Boolean(this.adapter.authorizeRecovery) && recoverableAuthorizationPause(item)) &&
      (item.operation === "UPDATE" ? item.actorUserId : ownerOf(item.trip)) === this.getCurrentUser()!.uid &&
      // The operation supervisor resumes these receipts after the start ACK.
      // Rechecking a blocked dependency every 750ms only consumes CPU/storage.
      !(jobOf(item.trip) && this.operationStartPending(this.getCurrentUser()!.uid, jobOf(item.trip))),
    );
    if (!pending.length) return;
    const delay = Math.max(750, Math.min(...pending.map((item) => recoverableAuthorizationPause(item)
      ? Math.max(0, Number(item.lastAuthorizationProbeAt || 0) + AUTHORIZATION_PROBE_MS - Date.now())
      : item.state === "SYNCING"
      ? Math.max(0, Date.parse(String(item.syncingAt || "")) + SYNCING_LEASE_MS - Date.now())
      : Math.max(0, retryTimeOf(item) - Date.now()))));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.synchronize().catch(error => console.warn("[NVU] Sincronização será retomada", error));
    }, delay);
  }

  /** Revalidate old protocol failures once; never change a receipt or identity. */
  private async recoverRegistrationProtocolFailures(uid: string): Promise<void> {
    await this.mutateQueue((queue) => {
      for (const item of queueItems(queue)) {
        const trip = item.trip as CanonicalTrip & Record<string, any>;
        const fixedPrintProtocol = trip.gtoEntryMode === "print" && trip.gtoReceiptAnalyzed === true &&
          trip.gtoRewardedAdDetected !== true &&
          /GTO_RECEIPT_AMOUNT_OR_BONUS_INVALID/.test(item.lastError || "") &&
          readGtoPrintEvidence(trip.receiptText, trip.gtoReceiptEvidence).amountCents === Number(trip.valorCents);
        if (item.state !== "FAILED" || (item.operation && item.operation !== "UPSERT") ||
            ownerOf(trip) !== uid || Number(item.registrationProtocolVersion || 0) >= (fixedPrintProtocol ? 507 : 409) ||
            !/invalid-argument|SERVER_SIMPLE_TRIP_ACK_MISSING/i.test(item.lastError || "") ||
            trip.deleted === true || isTripTombstoned(tripIdOf(trip)) || item.alternatives?.length || (!trip.imageHash && !trip.simpleAutomation && trip.gtoEntryMode !== "print") ||
            !tripIdOf(trip) || !jobOf(trip) || !trip.companyId || !Number.isFinite(Number(trip.valor)) || Number(trip.valor) <= 0) continue;
        item.state = "PENDING_SYNC";
        item.registrationProtocolVersion = fixedPrintProtocol ? 507 : 409;
        item.retryAt = undefined;
        item.syncingAt = undefined;
      }
    });
  }

  private async runSynchronization() {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return { synchronized: 0, results: [], validated: false };
    const uid = this.getCurrentUser()?.uid || "";
    if (!uid) return { synchronized: 0, results: [], validated: false };
    await this.recoverPendingRecords(uid);
    await this.recoverRegistrationProtocolFailures(uid);
    const results: SyncItem[] = [];
    const activeOperations = new Set<string>();
    const processCandidate = async (id: string, candidate: SyncItem) => {
      if (this.getCurrentUser()?.uid !== uid || (typeof navigator !== "undefined" && navigator.onLine === false)) return;
      // A provisional operation uses its eventual physical server ID, but its
      // receipts must not reach the writer before the start is acknowledged.
      if (jobOf(candidate.trip) && this.operationStartPending(uid, jobOf(candidate.trip))) return;
      const tripKey = tripIdOf(candidate.trip);
      let release!: () => void;
      const entryFlight = new Promise<void>(resolve => { release = resolve; });
      this.entryFlights.set(tripKey, entryFlight);
      try {
        const syncingAt = new Date().toISOString();
        const item = await this.mutateQueue(queue => {
          const current = queue[id];
          // Claim the current durable entry, not the batch's possibly superseded
          // snapshot. This prevents an edit arriving mid-flight being lost.
          if (!current || this.getCurrentUser()?.uid !== uid ||
            (current.state !== "PENDING_SYNC" && !isAbandonedSync(current)) ||
            retryTimeOf(current) > Date.now() ||
            (current.operation === "UPDATE" ? current.actorUserId : ownerOf(current.trip)) !== uid) return undefined;
          queue[id] = { ...current, state: "SYNCING", syncingAt, attempts: current.attempts + 1, lastError: undefined };
          return queue[id];
        });
        if (!item) return;
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("nvu-trip-sync-state-changed"));
        let serverAcknowledged = false;
        try {
          const deleting = item.operation === "DELETE";
          const updating = item.operation === "UPDATE";
          if (deleting && !this.adapter.delete) throw new Error("CANONICAL_TRIP_DELETE_ADAPTER_UNAVAILABLE");
          if (updating && (!this.adapter.update || !item.editPatch || !item.editId || !item.actorUserId)) throw new Error("CANONICAL_TRIP_EDIT_ADAPTER_UNAVAILABLE");
          const sending: Promise<SyncPushResult> = updating
            ? this.adapter.update!(item.trip, item.editPatch!, Number(item.baseVersion || 1), item.editId!, item.actorUserId!, item.beforeEdit)
            : deleting
            ? item.remoteDeleteRequired === false
              ? Promise.resolve({ confirmed: true as const, tripId: id, data: { deleted: true, status: "DELETED", deletedAt: (item.trip as any).deletedAt || new Date().toISOString() } })
              : this.adapter.delete!(item.trip)
            : this.adapter.push(item.trip);
          const result = await tripSyncDeadline(sending, this.transportTimeoutMs, "TRANSPORT");
          if (result.confirmed !== true || !result.tripId) throw new Error(deleting ? "SERVER_TRIP_DELETE_ACK_INVALID" : "SERVER_TRIP_ACK_INVALID");
          if (deleting) {
            if (result.data.deleted !== true || result.data.status !== "DELETED" || !result.data.deletedAt) throw new Error("SERVER_TRIP_DELETE_ACK_INVALID");
          } else if (updating) {
            if (result.data.lastEditId !== item.editId || !result.data.serverValidatedAt) throw new Error("SERVER_TRIP_EDIT_ACK_INVALID");
          } else if (!result.data?.serverValidatedAt) throw new Error("SERVER_TRIP_ACK_INVALID");
          serverAcknowledged = true;
          const confirmedTripInput = {
            ...item.trip,
            ...(result.data as Record<string, unknown>),
            id: result.tripId,
            physicalDocumentId: result.tripId,
            canonicalTripId: result.tripId,
            tripId: result.tripId,
            status: deleting ? "DELETED" : "SERVER_CONFIRMED",
            recordStatus: deleting ? "DELETED" : "concluida",
            syncStatus: "synced",
            offlineSyncStatus: deleting ? "deleted" : "synced",
            validationStatus: deleting ? undefined : "VALIDATED",
            serverValidatedAt: deleting ? undefined : result.data.serverValidatedAt,
            editPending: updating ? false : (item.trip as any).editPending,
            pendingEditId: updating ? undefined : (item.trip as any).pendingEditId,
            pendingEditBaseVersion: updating ? undefined : (item.trip as any).pendingEditBaseVersion,
            pendingEditValue: updating ? undefined : (item.trip as any).pendingEditValue,
          } as Partial<CanonicalTrip>;
          const historicalTrip = !jobOf(item.trip) || Boolean((item.trip as any).historicalReadOnly);
          const confirmedTrip = (historicalTrip
            ? TripRegistrationService.registerHistoricalRead({ ...confirmedTripInput, physicalDocumentId: result.tripId })
            : TripRegistrationService.register(confirmedTripInput)) as CanonicalTrip;
          if (!updating) this.offlineDatabase.save({
            trip: confirmedTrip,
            syncStatus: "SERVER_CONFIRMED",
            syncVersion: Number(confirmedTrip.syncVersion || 1),
            clientUpdatedAt: String(confirmedTrip.clientUpdatedAt || confirmedTrip.updatedAt || new Date().toISOString()),
            serverUpdatedAt: new Date().toISOString(),
          });
          if (updating) canonicalTripRepository.settleEdit(confirmedTrip, item.editId!);
          else canonicalTripRepository.applyServerSnapshot(confirmedTrip);
          const confirmedItem = await this.patchEntry(id, (current) => ({ ...current, trip: confirmedTrip, state: "SERVER_CONFIRMED", confirmedAt: new Date().toISOString(), syncingAt: undefined, lastError: undefined }), syncingAt);
          if (!confirmedItem) return;
          if (!updating && !deleting && id !== result.tripId) {
            // The writer recognized the same receipt under its original ID.
            // Forget only the proven duplicate local projection, never history.
            this.offlineDatabase.remove(id);
            canonicalTripRepository.purgeConfirmedAlias(id);
          }
          if (!deleting && !updating) {
            // A refresh failure cannot undo an already committed server ACK.
            void Promise.resolve().then(() => this.reconciliation.reconcileConfirmedTrip(confirmedTrip))
              .catch(error => console.warn("Viagem confirmada; o painel será atualizado na próxima reconciliação.", error));
          }
          emitCanonicalTripUpdated(confirmedTrip);
          results.push(confirmedItem);
        } catch (error) {
          const code = String((error as any)?.code || "").toLowerCase();
          const conflict = code.includes("canonical_trip_conflict") || code === "conflict";
          const serverTrip = (error as any)?.serverTrip as Partial<CanonicalTrip> | undefined;
          if (conflict && serverTrip) {
            const winner = (!jobOf(item.trip) || (item.trip as any).historicalReadOnly
              ? TripRegistrationService.registerHistoricalRead({ ...serverTrip, physicalDocumentId: String((serverTrip as any).physicalDocumentId || (serverTrip as any).id || tripIdOf(item.trip)), conflictResolution: "SERVER_WON" })
              : TripRegistrationService.register({ ...serverTrip, conflictResolution: "SERVER_WON" } as Partial<CanonicalTrip>));
            if (item.operation === "UPDATE") canonicalTripRepository.settleEdit(winner, item.editId!);
            else {
              this.offlineDatabase.save({ trip: winner, syncStatus: "SERVER_CONFIRMED", syncVersion: Number(winner.syncVersion || 1), clientUpdatedAt: winner.clientUpdatedAt, serverUpdatedAt: new Date().toISOString() });
              canonicalTripRepository.applyServerSnapshot(winner);
            }
            const conflictItem = await this.patchEntry(id, (current) => ({ ...current, trip: winner, state: "SERVER_CONFIRMED", confirmedAt: new Date().toISOString(), conflictResolution: "SERVER_WON", syncingAt: undefined, lastError: "CANONICAL_TRIP_CONFLICT_SERVER_WON" }), syncingAt);
            if (!conflictItem) return;
            emitCanonicalTripUpdated(winner);
            if (item.operation === "UPDATE" && typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent("nvu-trip-edit-rejected", { detail: { tripId: id, reason: "CANONICAL_TRIP_CONFLICT_SERVER_WON" } }));
            }
            results.push(conflictItem);
            return;
          }
          const registrationAccepted = serverAcknowledged || (error as any)?.tripRegistrationAccepted === true;
          const availabilityRetryable = (error as any)?.details?.retryable === true || registrationAccepted || (typeof navigator !== "undefined" && navigator.onLine === false) ||
            isRetryableServerAvailabilityError(error) ||
            (isConnectivityError(error) && !code.includes("permission-denied") && !code.includes("failed-precondition"));
          const details = (error as any)?.details && typeof (error as any).details === "object" ? (error as any).details : {};
          // A read denied after a successful callable is not a refused write.
          // Keep the original attempt pending; replay still rechecks current
          // membership and must obtain the complete, scope-checked server ACK.
          const confirmationReadPending = registrationAccepted && (error as any)?.tripSyncStage === "SERVER_READ";
          const retryable = availabilityRetryable && details.retryable !== false && !conflict &&
            (confirmationReadPending || (!code.includes("permission-denied") && !code.includes("unauthenticated")));
          const safeReasonCode = /^[A-Z0-9_]{3,80}$/.test(String(details.reasonCode || "")) ? String(details.reasonCode) : "UNDETERMINED_SERVER_REJECTION";
          const lastError = [String((error as any)?.code || ""), safeReasonCode, String((error as any)?.message || error)].filter(Boolean).join(": ").slice(0, 500);
          const failedItem = await this.patchEntry(id, (current) => ({ ...current,
            state: retryable ? "PENDING_SYNC" : conflict ? "CONFLICT" : "FAILED", syncingAt: undefined, lastError,
            registrationProtocolVersion: 507,
            serverRetryable: details.retryable,
            lastAuthorizationProbeAt: /permission-denied|unauthenticated|storage\/unauthorized/i.test(code) ? Date.now() : current.lastAuthorizationProbeAt,
            lastFailureStage: String((error as any)?.tripSyncStage || details.stage || "UNKNOWN"),
            retryAt: retryable ? new Date(Date.now() + (registrationAccepted ? 30_000 : Math.min(60_000, 750 * 2 ** Math.min(7, Math.max(0, current.attempts - 1)) * (0.8 + Math.random() * 0.4)))).toISOString() : undefined,
          }), syncingAt);
          if (!failedItem) return;
          if (item.operation === "UPDATE" && !retryable && item.beforeEdit && item.editId) {
            canonicalTripRepository.rejectEdit(item.beforeEdit, item.editId);
            if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("nvu-trip-edit-rejected", { detail: { tripId: id, reason: failedItem.lastError } }));
          }
          const localRecord = this.offlineDatabase.get(id);
          if (localRecord && item.operation !== "UPDATE") {
            const failedTrip = { ...localRecord.trip,
              offlineSyncStatus: registrationAccepted ? "server_received" : retryable && typeof navigator !== "undefined" && navigator.onLine === false ? "awaiting_connection" : retryable ? "pending_sync" : "validation_failed",
              syncStatus: retryable ? "pending_sync" : "validation_failed",
              validationStatus: retryable ? "PENDING_VALIDATION" : "VALIDATION_FAILED",
            } as CanonicalTrip;
            const localSyncStatus = retryable ? "PENDING_SYNC" : "CONFLICT";
            this.offlineDatabase.save({ ...localRecord, trip: failedTrip, syncStatus: localSyncStatus });
            canonicalTripRepository.applyLocalSyncState(failedTrip, localSyncStatus);
            emitCanonicalTripUpdated(failedTrip);
          }
          results.push(failedItem);
          // A malformed or permanently rejected old trip remains visible and
          // removable, but never blocks a later valid trip in the same operation.
          // Connectivity failures are retried on the next synchronization run.
        }
      } finally {
        if (this.entryFlights.get(tripKey) === entryFlight) this.entryFlights.delete(tripKey);
        release();
      }
    };
    const worker = async () => {
      while (this.getCurrentUser()?.uid === uid && (typeof navigator === "undefined" || navigator.onLine !== false)) {
        // Read fresh work after every completion/wake. A newly saved operation
        // can use an idle worker while another operation's upload is slow.
        const next = this.pendingHeads(uid).find(([, item]) => !activeOperations.has(operationQueueKey(item)) &&
          (item.state === "PENDING_SYNC" || isAbandonedSync(item)) && retryTimeOf(item) <= Date.now() &&
          !(jobOf(item.trip) && this.operationStartPending(uid, jobOf(item.trip))));
        if (!next) {
          if (!activeOperations.size) return;
          await new Promise<void>(resolve => this.queueWaiters.add(resolve));
          continue;
        }
        const key = operationQueueKey(next[1]); activeOperations.add(key);
        try {
          await processCandidate(next[0], next[1]);
        } finally { activeOperations.delete(key); this.wakeQueueWorkers(); }
      }
    };
    await Promise.all(Array.from({ length: 3 }, () => worker()));
    const confirmed = results.filter((item) => item.state === "SERVER_CONFIRMED");
    return { synchronized: confirmed.length, results, validated: confirmed.length > 0, tripId: confirmed.at(-1) ? tripIdOf(confirmed.at(-1)!.trip) : undefined };
  }

  getPending() { return queueItems(this.read()).filter((item) => item.state !== "SERVER_CONFIRMED"); }
  getOwnedPendingRegistrations(companyId: string, jobId?: string) {
    return this.getOwnedHistoryRegistrations(companyId, jobId).filter(item => item.state !== "SERVER_CONFIRMED");
  }
  /** Retain recent ACKs in history while its Firestore listener catches up. */
  getOwnedHistoryRegistrations(companyId: string, jobId?: string) {
    const uid = this.getCurrentUser()?.uid;
    return queueItems(this.read()).filter(item => ownerOf(item.trip) === uid && uid &&
      item.trip.companyId === companyId && (!jobId || jobOf(item.trip) === jobId) &&
      (!item.operation || item.operation === "UPSERT") && !item.trip.deleted && !isTripTombstoned(tripIdOf(item.trip)));
  }
  getResult(tripId: string, editId?: string) {
    const id = String(tripId || "").trim(), queue = this.read();
    // A second edit may have its own command key while an older attempt is
    // retrying. Never report the older command's receipt as the new edit's ACK.
    return editId ? queueItems(queue).find(item => item.operation === "UPDATE" && item.editId === editId && tripIdOf(item.trip) === id) : validQueueEntry(queue[id]) ? queue[id] : undefined;
  }

  inspectFailedHistoryRegistrations(companyId: string) {
    return inspectFailedRegistrationRecovery(this.offlineDatabase.list(), this.getCurrentUser()?.uid || "", companyId, this.storage);
  }

  /** User-requested discard of one unchanged failed local registration. Never contacts the server. */
  async discardFailedHistoryRegistration(proposal: FailedRegistrationRecovery): Promise<boolean> {
    if (this.running) await this.running;
    const uid = this.getCurrentUser()?.uid || "";
    if (!uid || uid !== proposal.driverId || !proposal.tripId) return false;
    const record = this.offlineDatabase.get(proposal.tripId);
    if (!record || JSON.stringify(record) !== proposal.expectedLocalRecord || record.syncStatus === "SERVER_CONFIRMED" || record.trip.serverValidatedAt) return false;

    const discarded = await this.mutateQueue(queue => {
      const current = queue[proposal.commandKey];
      if (!current || this.getCurrentUser()?.uid !== uid || JSON.stringify(current) !== proposal.expectedCommand ||
          JSON.stringify(this.offlineDatabase.get(proposal.tripId)) !== proposal.expectedLocalRecord) return false;
      const matches = Object.entries(queue).filter(([, entry]) => entry?.trip && String(entry.trip.physicalDocumentId || entry.trip.canonicalTripId || entry.trip.tripId || entry.trip.clientRequestId || entry.trip.idempotencyKey || "").trim() === proposal.tripId);
      if (matches.length !== 1 || !["FAILED", "CONFLICT"].includes(current.state)) return false;
      delete queue[proposal.commandKey];
      return true;
    });
    if (!discarded) return false;
    this.offlineDatabase.remove(proposal.tripId);
    canonicalTripRepository.discardFailedLocalProjection(proposal.tripId);
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("nvu-canonical-trip-updated", { detail: { tripId: proposal.tripId, discardedLocal: true } }));
    return true;
  }

  /** User-requested, single replay of an unchanged, owned failed UPSERT. */
  async retryFailedHistoryRegistration(proposal: FailedRegistrationRecovery): Promise<boolean> {
    if (this.running) await this.running;
    const uid = this.getCurrentUser()?.uid || "";
    if (!uid || uid !== proposal.driverId) return false;
    const id = proposal.tripId;
    if (!id || isTripTombstoned(id)) return false;
    const eligible = this.inspectFailedHistoryRegistrations(proposal.companyId).rows.some(row =>
      row.commandKey === proposal.commandKey && row.expectedCommand === proposal.expectedCommand &&
      row.expectedLocalRecord === proposal.expectedLocalRecord && ["READY", "PERMISSION_DENIED", "SERVER_PRECONDITION", "PRINT_PROTOCOL_RETRY"].includes(row.reason));
    if (!eligible) return false;
    const record = this.offlineDatabase.get(id);
    if (!record || JSON.stringify(record) !== proposal.expectedLocalRecord) return false;
    const queued = await this.mutateQueue(queue => {
      const current = queue[proposal.commandKey];
      // Recheck authentication, payload and the exact command after the queue
      // mutation lock. A changed row/collision is never repaired by guessing.
      if (!current || this.getCurrentUser()?.uid !== uid || JSON.stringify(current) !== proposal.expectedCommand ||
          JSON.stringify(this.offlineDatabase.get(id)) !== proposal.expectedLocalRecord ||
          !["READY", "PERMISSION_DENIED", "SERVER_PRECONDITION", "PRINT_PROTOCOL_RETRY"].includes(failedRegistrationRecoveryReason(proposal.commandKey, current, record, queue, uid, proposal.companyId))) return undefined;
      const pending = { ...current, state: "PENDING_SYNC" as const, retryAt: undefined,
        syncingAt: undefined, manualHistoryRecoveryAttempt: true };
      queue[proposal.commandKey] = pending;
      return pending;
    });
    if (!queued) return false;
    const trip = { ...record.trip, status: "PENDING_SYNC", syncStatus: "pending_sync",
      offlineSyncStatus: "pending_sync", validationStatus: "PENDING_VALIDATION" } as CanonicalTrip;
    this.offlineDatabase.save({ ...record, trip, syncStatus: "PENDING_SYNC" });
    canonicalTripRepository.applyLocalSyncState(trip, "PENDING_SYNC");
    emitCanonicalTripUpdated(trip);
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("nvu-canonical-trip-queued", { detail: { tripId: id } }));
    return true;
  }

  /** Retry the saved registration, retaining its receipt, identity and request ID. */
  async retryRegistration(tripId: string): Promise<boolean> {
    const id = String(tripId || "").trim();
    const uid = this.getCurrentUser()?.uid;
    if (!uid) throw new Error("CANONICAL_TRIP_AUTH_REQUIRED");
    const retried = await this.mutateQueue((queue) => {
      const current = queue[id];
      if (!current) return false;
      if (ownerOf(current.trip) !== uid) throw new Error("CANONICAL_TRIP_AUTH_SCOPE_MISMATCH");
      if ((current.operation && current.operation !== "UPSERT") || current.trip.deleted === true ||
          current.trip.status === "DELETED" || isTripTombstoned(id)) return false;
      if (current.state === "SERVER_CONFIRMED" || (current.state === "SYNCING" && !isAbandonedSync(current))) return true;
      const trip = { ...current.trip, status: "PENDING_SYNC", syncStatus: "pending_sync",
        offlineSyncStatus: "pending_sync", validationStatus: "PENDING_VALIDATION" } as CanonicalTrip;
      queue[id] = { ...current, trip, state: "PENDING_SYNC", retryAt: undefined,
        syncingAt: undefined, lastError: undefined };
      return true;
    });
    const pending = retried ? this.getResult(id) : undefined;
    if (pending?.state === "PENDING_SYNC") {
      const local = this.offlineDatabase.get(id);
      if (local) this.offlineDatabase.save({ ...local, trip: pending.trip, syncStatus: "PENDING_SYNC" });
      canonicalTripRepository.applyLocalSyncState(pending.trip, "PENDING_SYNC");
      emitCanonicalTripUpdated(pending.trip);
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("nvu-canonical-trip-queued", { detail: { tripId: id } }));
    }
    return retried;
  }
  // Online deletion must obtain the server ACK before a durable local tombstone
  // is written. A denied transaction must leave the visible trip intact.
  async deleteRemoteFirst(tripId: string): Promise<SyncPushResult & { localOnly?: boolean }> {
    if (this.running) await this.running;
    if (!this.adapter.delete) throw new Error("CANONICAL_TRIP_DELETE_ADAPTER_UNAVAILABLE");
    const id = String(tripId || "").trim();
    const record = this.offlineDatabase.get(id);
    const queued = this.read()[id];
    // Never try to read an unsynchronized document: owner-scoped rules deny
    // reads of documents that do not exist yet.
    if (record && !record.serverUpdatedAt && !(record.trip as any).serverValidatedAt &&
        queued && queued.attempts === 0 && queued.state === "PENDING_SYNC") {
      return { confirmed: true as const, tripId: id, localOnly: true as const,
        data: { ...record.trip, deleted: true, status: "DELETED", deletedAt: new Date().toISOString() } };
    }
    const local = record?.trip || queued?.trip;
    return this.adapter.delete(local || ({ canonicalTripId: id, tripId: id } as CanonicalTrip));
  }

  /** A server-first tombstone supersedes queued edits/upserts for the same
   * physical document. It never creates a receipt or another remote write. */
  async acknowledgeServerDeletion(tripId: string, data: Record<string, unknown>): Promise<void> {
    const id = String(tripId || "").trim();
    if (!id || data.deleted !== true || data.status !== "DELETED" || !data.deletedAt
      || (data.physicalDocumentId && data.physicalDocumentId !== id))
      throw new Error("SERVER_TRIP_DELETE_ACK_INVALID");
    await this.mutateQueue(queue => {
      const current = queue[id];
      const input: Partial<CanonicalTrip> = { ...(current?.trip || {}), ...data, id, physicalDocumentId: id };
      const trip = (input.historicalReadOnly || !input.jobId
        ? TripRegistrationService.registerHistoricalRead(input)
        : TripRegistrationService.register({ ...input, canonicalTripId: id, tripId: id })) as CanonicalTrip;
      queue[id] = { ...(current || { attempts: 0, queuedAt: new Date().toISOString() }), trip, operation: "DELETE", state: "SERVER_CONFIRMED",
        syncingAt: undefined, retryAt: undefined, lastError: undefined, editPatch: undefined, editId: undefined };
      this.offlineDatabase.save({
        trip, syncStatus: "SERVER_CONFIRMED", syncVersion: Number(trip.syncVersion || 1),
        clientUpdatedAt: String((trip as any).clientUpdatedAt || new Date().toISOString()),
        serverUpdatedAt: String((trip as any).serverUpdatedAt || new Date().toISOString()),
      });
    });
  }
}

export const syncEngine = new SyncEngine();
