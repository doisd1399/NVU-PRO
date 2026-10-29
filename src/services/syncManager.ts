import { onAuthStateChanged } from "firebase/auth";
import { isAuthTeardownActive } from "../lib/authLifecycle";
import { operationOutbox, OPERATION_OUTBOX_CHANGED, reconcileOperationOutboxNativeState, setOperationPendingTripReader } from "./operationOutbox";
import { isConnectivityError } from "../lib/connectivity";
import {
  getOfflineTrips,
  removeOfflineTrip,
  markOfflineTripFailed,
  setOfflineTripStatus,
  recoverInterruptedOfflineTrips,
  retryOfflineTrip,
  type OfflineTripRecord,
} from "../lib/offlineTripQueue";
import { syncEngine } from "./sync/SyncEngine";
import { TripRegistrationService } from "../application/trip/TripRegistrationService";
import { auth } from "../lib/firebase";
import { isTripTombstoned } from "../lib/tripTombstones";
import { CANONICAL_TRIP_UPDATED } from "../lib/CanonicalTripUpdateEvent";
import { OfflineDatabase } from "./offline/OfflineDatabase";

type SyncResult = { validated?: boolean; tripId?: string };
const queuedUserId = (item: OfflineTripRecord) => String(item.payload?.driverId || item.payload?.motoristaId || item.payload?.userId || "").trim();
const operationId = (item: OfflineTripRecord) => String(item.jobId || item.payload?.jobId || "").trim();

/**
 * Public synchronization facade. New app flows use SyncEngine's versioned
 * canonical queue; the injected sender path remains only for old test fixtures
 * and external adapters during migration.
 */
export class SyncManager {
  private static running = false;
  private static sender: ((item: OfflineTripRecord) => Promise<void | SyncResult>) | undefined;
  private static scopeResolver: (() => string) | undefined;
  private static retryTimer: ReturnType<typeof setTimeout> | undefined;
  private static retryDelayMs = 750;
  private static canonicalInitialized = false;
  private static canonicalFlight: Promise<unknown> | null = null;
  private static canonicalDirty = false;

  static configure(sender: (item: OfflineTripRecord) => Promise<void | SyncResult>, scopeResolver?: () => string) {
    this.sender = sender;
    this.scopeResolver = scopeResolver;
  }

  static async synchronizeCanonicalTrips() {
    return this.syncPendingTrips();
  }

  static getPendingRegistrationIds(jobId: string): string[] {
    const uid = auth.currentUser?.uid;
    if (!uid || !jobId) return [];
    const ids = new Set<string>();
    for (const item of syncEngine.getPending()) {
      const trip = item.trip;
      const id = String(trip.canonicalTripId || trip.tripId || "");
      if ((!item.operation || item.operation === "UPSERT") &&
          ["PENDING_SYNC", "SYNCING"].includes(item.state) && trip.driverId === uid &&
          String(trip.jobId || "") === jobId && !trip.deleted && !isTripTombstoned(id)) ids.add(id);
    }
    for (const item of getOfflineTrips()) {
      const payload = item.payload || {};
      const id = String(payload.canonicalTripId || payload.tripId || payload.clientRequestId || payload.idempotencyKey || item.id);
      if (queuedUserId(item) === uid && operationId(item) === jobId &&
          !["FAILED", "VALIDATED"].includes(item.status) && !syncEngine.getResult(id) && !isTripTombstoned(id)) ids.add(id);
    }
    return [...ids];
  }
  static getPendingRegistrationCount(jobId: string): number { return this.getPendingRegistrationIds(jobId).length; }

  static async retryTripRegistration(id: string): Promise<boolean> {
    let retried = await syncEngine.retryRegistration(id);
    if (!retried) {
      const legacy = getOfflineTrips().find((item) => item.id === id);
      if (!legacy || queuedUserId(legacy) !== auth.currentUser?.uid || isTripTombstoned(id)) return false;
      retried = retryOfflineTrip(id);
    }
    if (retried) void this.syncPendingTrips().catch((error) => console.warn("Não foi possível concluir a nova tentativa de envio.", error));
    return retried;
  }

  /**
   * Older profile/print records use nvu.offline.trip.queue.v2. Move every
   * usable non-terminal record into the canonical ACK-controlled queue and
   * remove it only after remote confirmation. Failed legacy records are kept
   * until the driver requests a retry; migration never resets a canonical failure.
   */
  private static async migrateLegacyQueueAndSync() {
    const uid = auth.currentUser?.uid;
    const pending = getOfflineTrips().filter((item) => uid && queuedUserId(item) === uid &&
      !["VALIDATED", "FAILED"].includes(item.status),
    );
    for (const item of pending) {
      const payload = item.payload || {};
      const stableId = String(payload.canonicalTripId || payload.tripId || payload.clientRequestId || payload.idempotencyKey || item.id).trim();
      if (!stableId) continue;
      if (syncEngine.getResult(stableId) || isTripTombstoned(stableId)) continue;
      try {
        await syncEngine.enqueue(TripRegistrationService.register({
          ...payload,
          id: stableId,
          canonicalTripId: stableId,
          tripId: stableId,
          jobId: payload.jobId || item.jobId,
          operationId: payload.jobId || item.jobId,
          driverId: payload.driverId || payload.motoristaId || payload.userId,
          status: "PENDING_SYNC",
        }));
      } catch (error) {
        // Keep malformed legacy data for explicit user removal. It never stops
        // synchronization of valid records.
        markOfflineTripFailed(item.id, error, { retryable: false });
      }
    }
    const result = await syncEngine.synchronize();
    for (const item of pending) {
      const payload = item.payload || {};
      const stableId = String(payload.canonicalTripId || payload.tripId || payload.clientRequestId || payload.idempotencyKey || item.id).trim();
      if (stableId && syncEngine.getResult(stableId)?.state === "SERVER_CONFIRMED") {
        removeOfflineTrip(item.id);
      }
    }
    return result;
  }

  private static scheduleRetry(delayMs = this.retryDelayMs) {
    if (this.retryTimer || typeof window === "undefined" || navigator.onLine === false) return;
    this.retryTimer = setTimeout(() => { this.retryTimer = undefined; void this.syncPendingTrips(); }, delayMs);
  }

  static initialize() {
    if (typeof window === "undefined" || this.canonicalInitialized) return;
    recoverInterruptedOfflineTrips();
    this.canonicalInitialized = true;
    // This is the only event supervisor. When no legacy sender is configured,
    // syncPendingTrips migrates old records and then invokes SyncEngine once.
    // Calling synchronizeCanonicalTrips beside it caused duplicate replay and
    // duplicate migration work for the same event.
    const resume = () => { void this.syncPendingTrips().catch(error => console.warn("[NVU] Sincronização será retomada", error)); };
    const resumeNewCanonicalCommand = () => {
      if (isAuthTeardownActive() || !auth.currentUser?.uid || navigator.onLine === false) return;
      // The engine enforces the per-operation start barrier itself. A new
      // receipt must not wait behind another operation's slow finish/cleanup.
      void syncEngine.synchronize().catch(error => console.warn("[NVU] Envio preservado para nova tentativa", error));
      resume();
    };
    setOperationPendingTripReader((_uid, jobId) => this.getPendingRegistrationIds(jobId));
    window.addEventListener("online", resume);
    window.addEventListener(OPERATION_OUTBOX_CHANGED, resume);
    window.addEventListener("nvu-canonical-trip-updated", resume);
    window.addEventListener(CANONICAL_TRIP_UPDATED, resume);
    window.addEventListener("storage", event => { if (event.key === OfflineDatabase.storageKey) resume(); });
    window.addEventListener("nvu-canonical-trip-queued", resumeNewCanonicalCommand);
    window.addEventListener("nvu-offline-trip-queued", resume);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) resume(); });
    onAuthStateChanged(auth, () => resume());
    // A suspended WebView may miss a native receipt ACK. Resume only while a
    // local operation command is pending; no idle server polling is introduced.
    window.setInterval(() => {
      if (!document.hidden && navigator.onLine !== false && auth.currentUser?.uid) {
        try { if (operationOutbox.pending().some(entry => entry.state !== "REJECTED")) resume(); } catch { /* surfaced by the command UI */ }
      }
    }, 5000);
    if (navigator.onLine !== false) resume();
  }

  static async syncPendingTrips(sender = this.sender): Promise<unknown> {
    if (!sender) {
      if (isAuthTeardownActive() || !auth.currentUser?.uid || typeof navigator !== "undefined" && navigator.onLine === false) return;
      if (this.canonicalFlight) { this.canonicalDirty = true; return this.canonicalFlight; }
      const uid = auth.currentUser?.uid;
      const task = Promise.resolve().then(async () => {
        let result: unknown;
        do {
          this.canonicalDirty = false;
          await reconcileOperationOutboxNativeState();
          if (isAuthTeardownActive() || auth.currentUser?.uid !== uid) break;
          await operationOutbox.synchronize("start");
          await reconcileOperationOutboxNativeState();
          if (isAuthTeardownActive() || auth.currentUser?.uid !== uid) break;
          result = await this.migrateLegacyQueueAndSync();
          if (isAuthTeardownActive() || auth.currentUser?.uid !== uid) break;
          await operationOutbox.synchronize("finish");
          await reconcileOperationOutboxNativeState();
        } while (this.canonicalDirty && auth.currentUser?.uid === uid && navigator.onLine !== false);
        return result;
      });
      this.canonicalFlight = task;
      const release = () => {
        this.canonicalFlight = null;
        // An auth event can join the old flight. Resume the new owner's queue
        // after it releases, without replaying another owner's commands.
        if (auth.currentUser?.uid && auth.currentUser.uid !== uid && !isAuthTeardownActive())
          void this.syncPendingTrips().catch(error => console.warn("[NVU] Sincronização será retomada", error));
      };
      void task.then(release, error => {
        release();
        console.warn("[NVU] Sincronização local será retomada", error);
      });
      return task;
    }
    if (this.running || typeof navigator !== "undefined" && navigator.onLine === false) return;
    const scopeUserId = String(this.scopeResolver?.() || "").trim();
    if (this.scopeResolver && !scopeUserId) return;
    const scopedQueue = getOfflineTrips().filter((item) => !scopeUserId || !queuedUserId(item) || queuedUserId(item) === scopeUserId);
    const pending = scopedQueue.filter((item) => item.status === "PENDING_SYNC");
    if (!pending.length) return;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = undefined; }
    this.running = true;
    window.dispatchEvent(new CustomEvent("nvu-offline-sync-start", { detail: { count: pending.length } }));
    let synced = 0;
    try {
      for (const item of pending) {
        try {
          setOfflineTripStatus(item.id, "UPLOADING");
          const result: SyncResult = (await sender(item)) || {};
          setOfflineTripStatus(item.id, "SERVER_RECEIVED");
          setOfflineTripStatus(item.id, "VALIDATION_PENDING");
          if (result?.validated === true) {
            setOfflineTripStatus(item.id, "VALIDATED");
            removeOfflineTrip(item.id);
            window.dispatchEvent(new CustomEvent("nvu-offline-trip-validated", { detail: { id: item.id, jobId: item.jobId || item.payload?.jobId, tripId: result.tripId || "", totalDeliveries: Number(item.totalDeliveries || 0) } }));
            synced += 1;
          } else {
            markOfflineTripFailed(item.id, new Error("SERVER_VALIDATION_NOT_CONFIRMED"), { retryable: true });
          }
        } catch (error) {
          const code = String((error as any)?.code || "").toLowerCase();
          const retryable = navigator.onLine === false || (isConnectivityError(error) && !code.includes("failed-precondition"));
          markOfflineTripFailed(item.id, error, { retryable });
        }
      }
    } finally {
      this.running = false;
      const remainingQueue = getOfflineTrips().filter((item) => !scopeUserId || !queuedUserId(item) || queuedUserId(item) === scopeUserId);
      const remaining = remainingQueue.filter((item) => item.status !== "VALIDATED").length;
      window.dispatchEvent(new CustomEvent("nvu-offline-sync-finish", { detail: { synced, remaining } }));
      if (remainingQueue.some((item) => item.status === "PENDING_SYNC") && navigator.onLine !== false) {
        this.scheduleRetry(this.retryDelayMs);
        this.retryDelayMs = Math.min(this.retryDelayMs * 2, 5 * 60_000);
      } else if (remaining === 0) this.retryDelayMs = 750;
    }
  }
}
