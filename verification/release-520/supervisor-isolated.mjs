// qa:auth
var onAuthStateChanged = () => () => {
};

// src/lib/authLifecycle.ts
var isAuthTeardownActive = () => globalThis.__supervisor520.teardown;

// src/services/operationOutbox.ts
var operationOutbox = globalThis.__supervisor520.operationOutbox;
var OPERATION_OUTBOX_CHANGED = "operation-change";
var reconcileOperationOutboxNativeState = async () => {
};
var setOperationPendingTripReader = () => {
};

// src/lib/connectivity.ts
var isDefinitelyOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;
var isConnectivityError = (error) => {
  const value = error;
  const code = String(value?.code || "").toLowerCase();
  const message = String(value?.message || value || "").toLowerCase();
  return isDefinitelyOffline() || ["unavailable", "deadline-exceeded", "network-request-failed", "failed-precondition", "storage/retry-limit-exceeded"].some((token) => code.includes(token)) || ["network", "offline", "internet", "connection", "conex\xE3o", "conexao", "rede", "failed to fetch"].some((token) => message.includes(token));
};

// src/lib/offlineTripQueue.ts
var getOfflineTrips = () => [];
var removeOfflineTrip = () => {
};
var markOfflineTripFailed = () => {
};
var setOfflineTripStatus = () => {
};
var recoverInterruptedOfflineTrips = () => {
};
var retryOfflineTrip = () => false;

// src/services/sync/SyncEngine.ts
var syncEngine = globalThis.__supervisor520.engine;

// src/application/trip/TripRegistrationService.ts
var TripRegistrationService = { register: (t) => t };

// src/lib/firebase.ts
var auth = { currentUser: { uid: "driver" } };

// src/lib/tripTombstones.ts
var isTripTombstoned = () => false;

// src/lib/CanonicalTripUpdateEvent.ts
var CANONICAL_TRIP_UPDATED = "canonical-updated";

// src/services/offline/OfflineDatabase.ts
var OfflineDatabase = class {
  static storageKey = "qa-journal";
};

// src/services/syncManager.ts
var queuedUserId = (item) => String(item.payload?.driverId || item.payload?.motoristaId || item.payload?.userId || "").trim();
var operationId = (item) => String(item.jobId || item.payload?.jobId || "").trim();
var SyncManager = class {
  static {
    this.running = false;
  }
  static {
    this.retryDelayMs = 750;
  }
  static {
    this.canonicalInitialized = false;
  }
  static {
    this.canonicalFlight = null;
  }
  static {
    this.canonicalDirty = false;
  }
  static configure(sender, scopeResolver) {
    this.sender = sender;
    this.scopeResolver = scopeResolver;
  }
  static async synchronizeCanonicalTrips() {
    return this.syncPendingTrips();
  }
  static getPendingRegistrationIds(jobId) {
    const uid = auth.currentUser?.uid;
    if (!uid || !jobId) return [];
    const ids = /* @__PURE__ */ new Set();
    for (const item of syncEngine.getPending()) {
      const trip = item.trip;
      const id = String(trip.canonicalTripId || trip.tripId || "");
      if ((!item.operation || item.operation === "UPSERT") && ["PENDING_SYNC", "SYNCING"].includes(item.state) && trip.driverId === uid && String(trip.jobId || "") === jobId && !trip.deleted && !isTripTombstoned(id)) ids.add(id);
    }
    for (const item of getOfflineTrips()) {
      const payload = item.payload || {};
      const id = String(payload.canonicalTripId || payload.tripId || payload.clientRequestId || payload.idempotencyKey || item.id);
      if (queuedUserId(item) === uid && operationId(item) === jobId && !["FAILED", "VALIDATED"].includes(item.status) && !syncEngine.getResult(id) && !isTripTombstoned(id)) ids.add(id);
    }
    return [...ids];
  }
  static getPendingRegistrationCount(jobId) {
    return this.getPendingRegistrationIds(jobId).length;
  }
  static async retryTripRegistration(id) {
    let retried = await syncEngine.retryRegistration(id);
    if (!retried) {
      const legacy = getOfflineTrips().find((item) => item.id === id);
      if (!legacy || queuedUserId(legacy) !== auth.currentUser?.uid || isTripTombstoned(id)) return false;
      retried = retryOfflineTrip(id);
    }
    if (retried) void this.syncPendingTrips().catch((error) => console.warn("N\xE3o foi poss\xEDvel concluir a nova tentativa de envio.", error));
    return retried;
  }
  /**
   * Older profile/print records use nvu.offline.trip.queue.v2. Move every
   * usable non-terminal record into the canonical ACK-controlled queue and
   * remove it only after remote confirmation. Failed legacy records are kept
   * until the driver requests a retry; migration never resets a canonical failure.
   */
  static async migrateLegacyQueueAndSync() {
    const uid = auth.currentUser?.uid;
    const pending = getOfflineTrips().filter(
      (item) => uid && queuedUserId(item) === uid && !["VALIDATED", "FAILED"].includes(item.status)
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
          status: "PENDING_SYNC"
        }));
      } catch (error) {
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
  static scheduleRetry(delayMs = this.retryDelayMs) {
    if (this.retryTimer || typeof window === "undefined" || navigator.onLine === false) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = void 0;
      void this.syncPendingTrips();
    }, delayMs);
  }
  static initialize() {
    if (typeof window === "undefined" || this.canonicalInitialized) return;
    recoverInterruptedOfflineTrips();
    this.canonicalInitialized = true;
    const resume = () => {
      void this.syncPendingTrips().catch((error) => console.warn("[NVU] Sincroniza\xE7\xE3o ser\xE1 retomada", error));
    };
    const resumeNewCanonicalCommand = () => {
      if (isAuthTeardownActive() || !auth.currentUser?.uid || navigator.onLine === false) return;
      void syncEngine.synchronize().catch((error) => console.warn("[NVU] Envio preservado para nova tentativa", error));
      resume();
    };
    setOperationPendingTripReader((_uid, jobId) => this.getPendingRegistrationIds(jobId));
    window.addEventListener("online", resume);
    window.addEventListener(OPERATION_OUTBOX_CHANGED, resume);
    window.addEventListener("nvu-canonical-trip-updated", resume);
    window.addEventListener(CANONICAL_TRIP_UPDATED, resume);
    window.addEventListener("storage", (event) => {
      if (event.key === OfflineDatabase.storageKey) resume();
    });
    window.addEventListener("nvu-canonical-trip-queued", resumeNewCanonicalCommand);
    window.addEventListener("nvu-offline-trip-queued", resume);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) resume();
    });
    onAuthStateChanged(auth, () => resume());
    window.setInterval(() => {
      if (!document.hidden && navigator.onLine !== false && auth.currentUser?.uid) {
        try {
          if (operationOutbox.pending().some((entry) => entry.state !== "REJECTED")) resume();
        } catch {
        }
      }
    }, 5e3);
    if (navigator.onLine !== false) resume();
  }
  static async syncPendingTrips(sender = this.sender) {
    if (!sender) {
      if (isAuthTeardownActive() || !auth.currentUser?.uid || typeof navigator !== "undefined" && navigator.onLine === false) return;
      if (this.canonicalFlight) {
        this.canonicalDirty = true;
        return this.canonicalFlight;
      }
      const uid = auth.currentUser?.uid;
      const task = Promise.resolve().then(async () => {
        let result;
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
        if (auth.currentUser?.uid && auth.currentUser.uid !== uid && !isAuthTeardownActive())
          void this.syncPendingTrips().catch((error) => console.warn("[NVU] Sincroniza\xE7\xE3o ser\xE1 retomada", error));
      };
      void task.then(release, (error) => {
        release();
        console.warn("[NVU] Sincroniza\xE7\xE3o local ser\xE1 retomada", error);
      });
      return task;
    }
    if (this.running || typeof navigator !== "undefined" && navigator.onLine === false) return;
    const scopeUserId = String(this.scopeResolver?.() || "").trim();
    if (this.scopeResolver && !scopeUserId) return;
    const scopedQueue = getOfflineTrips().filter((item) => !scopeUserId || !queuedUserId(item) || queuedUserId(item) === scopeUserId);
    const pending = scopedQueue.filter((item) => item.status === "PENDING_SYNC");
    if (!pending.length) return;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = void 0;
    }
    this.running = true;
    window.dispatchEvent(new CustomEvent("nvu-offline-sync-start", { detail: { count: pending.length } }));
    let synced = 0;
    try {
      for (const item of pending) {
        try {
          setOfflineTripStatus(item.id, "UPLOADING");
          const result = await sender(item) || {};
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
          const code = String(error?.code || "").toLowerCase();
          const retryable = navigator.onLine === false || isConnectivityError(error) && !code.includes("failed-precondition");
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
        this.retryDelayMs = Math.min(this.retryDelayMs * 2, 5 * 6e4);
      } else if (remaining === 0) this.retryDelayMs = 750;
    }
  }
};
export {
  SyncManager
};
