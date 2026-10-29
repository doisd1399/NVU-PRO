export type OfflineTripStatus = "LOCAL_CREATED" | "PENDING_SYNC" | "SYNCING" | "UPLOADING" | "SERVER_RECEIVED" | "VALIDATION_PENDING" | "SENT" | "VALIDATED" | "FAILED";

export type OfflineTripRecord = {
  id: string;
  createdAt: number;
  createdAtLocal?: string;
  completedAtLocal?: string;
  serverValidatedAt?: string;
  syncStatus?: OfflineTripStatus;
  statusHistory?: OfflineTripStatus[];
  payload: Record<string, any>;
  status: OfflineTripStatus;
  attempts: number;
  errorMessage?: string;
  jobId?: string;
  totalDeliveries?: number;
  tripId?: string;
};

const KEY = "nvu.offline.trip.queue.v2";
const LEGACY_KEY = "nvu.offline.trip.queue.v1";

const read = (): OfflineTripRecord[] => {
  if (typeof window === "undefined") return [];
  try {
    const currentRaw = localStorage.getItem(KEY);
    // An empty v2 queue is authoritative: falling back to v1 after a successful
    // sync would replay trips that were already acknowledged by the server.
    if (currentRaw !== null) {
      const current = JSON.parse(currentRaw);
      return Array.isArray(current) ? current : [];
    }
    const legacyRaw = localStorage.getItem(LEGACY_KEY);
    if (legacyRaw === null) return [];
    const legacy = JSON.parse(legacyRaw);
    if (!Array.isArray(legacy)) return [];
    const migrated: OfflineTripRecord[] = legacy
      .filter((item: any) => item && typeof item.id === "string" &&
        item.payload && typeof item.payload === "object" &&
        !["SYNCED", "VALIDATED"].includes(item.status))
      .map((item: any) => ({
        ...item,
        status: item.status === "FAILED" ? "FAILED" : "PENDING_SYNC",
        syncStatus: item.status === "FAILED" ? "FAILED" : "PENDING_SYNC",
      }));
    // Commit before removing v1. If storage is full, leave v1 intact and
    // return it so the pending records remain accessible on the next launch.
    try {
      localStorage.setItem(KEY, JSON.stringify(migrated));
    } catch {
      return migrated;
    }
    try { localStorage.removeItem(LEGACY_KEY); } catch { /* v2 is authoritative. */ }
    return migrated;
  } catch { return []; }
};

const write = (items: OfflineTripRecord[]) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(items));
};

const emit = (name: string, detail?: unknown) => {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(name, { detail }));
};

const publicSyncStatus = (status: OfflineTripStatus) => {
  switch (status) {
    case "LOCAL_CREATED":
      return typeof navigator !== "undefined" && navigator.onLine === false
        ? "awaiting_connection"
        : "pending_sync";
    case "PENDING_SYNC":
      return typeof navigator !== "undefined" && navigator.onLine === false
        ? "awaiting_connection"
        : "pending_sync";
    case "SYNCING":
      return "syncing";
    case "UPLOADING":
      return "uploading";
    case "SERVER_RECEIVED":
    case "SENT":
      return "server_received";
    case "VALIDATION_PENDING":
      return "validation_pending";
    case "VALIDATED":
      return "validated";
    case "FAILED":
      return "validation_failed";
  }
};

const publishStatus = (item: OfflineTripRecord, status: OfflineTripStatus) => {
  emit("nvu-offline-trip-status", {
    id: item.id,
    jobId: item.jobId,
    status,
    offlineSyncStatus: publicSyncStatus(status),
    errorMessage: item.errorMessage || "",
  });
};

export const setOfflineTripStatus = (id: string, status: OfflineTripStatus) => {
  const queue = read();
  const current = queue.find((item) => item.id === id);
  if (!current) return;
  const nextHistory = [...(current.statusHistory || [current.status]), status];
  const updated: OfflineTripRecord = {
    ...current,
    status,
    syncStatus: status,
    statusHistory: nextHistory,
    payload: {
      ...current.payload,
      offlineSyncStatus: publicSyncStatus(status),
      ...(status === "FAILED" ? { offlineSyncError: current.errorMessage || "VALIDATION_FAILED" } : {}),
    },
  };
  write(queue.map((item) => item.id === id ? updated : item));
  publishStatus(updated, status);
};

export const updateOfflineTripPayload = (id: string, patch: Record<string, unknown>) => {
  const queue = read();
  const current = queue.find((item) => item.id === id);
  if (!current) return;
  const updated = { ...current, payload: { ...current.payload, ...patch } };
  write(queue.map((item) => item.id === id ? updated : item));
  return updated;
};

export const recoverInterruptedOfflineTrips = () => {
  const queue = read();
  for (const item of queue) {
    if (item.status === "VALIDATED") {
      removeOfflineTrip(item.id);
    } else if (item.status === "LOCAL_CREATED" || item.status === "SYNCING" || item.status === "UPLOADING" || item.status === "SERVER_RECEIVED" || item.status === "VALIDATION_PENDING" || item.status === "SENT") {
      setOfflineTripStatus(item.id, "PENDING_SYNC");
    }
  }
};

export const enqueueOfflineTrip = (
  payload: Record<string, any>,
  meta: { jobId?: string; totalDeliveries?: number; tripId?: string } = {},
) => {
  const requestKey = String(payload?.idempotencyKey || payload?.clientRequestId || "").trim();
  const queue = read();
  const existing = requestKey
    ? queue.find((item) => String(item.payload?.idempotencyKey || item.payload?.clientRequestId || "") === requestKey)
    : undefined;
  if (existing) return existing;

  const nowLocal = new Date().toISOString();
  const candidateCreatedAtLocal = payload?.createdAtLocal || nowLocal;
  const parsedCreatedAtLocal = new Date(candidateCreatedAtLocal);
  const createdAtLocal = Number.isNaN(parsedCreatedAtLocal.getTime()) ? nowLocal : parsedCreatedAtLocal.toISOString();
  const candidateCompletedAtLocal = payload?.completedAtLocal || createdAtLocal;
  const parsedCompletedAtLocal = new Date(candidateCompletedAtLocal);
  const completedAtLocal = Number.isNaN(parsedCompletedAtLocal.getTime()) ? createdAtLocal : parsedCompletedAtLocal.toISOString();

  const item: OfflineTripRecord = {
    id: `local-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: parsedCreatedAtLocal.getTime() > 0 ? parsedCreatedAtLocal.getTime() : Date.now(),
    createdAtLocal,
    completedAtLocal,
    payload: { ...payload, createdAtLocal, completedAtLocal, offlineSyncStatus: "awaiting_connection", offlineCreatedAt: createdAtLocal },
    status: "LOCAL_CREATED",
    syncStatus: "LOCAL_CREATED",
    statusHistory: ["LOCAL_CREATED"],
    attempts: 0,
    ...meta,
  };
  queue.push(item);
  write(queue);
  publishStatus(item, "LOCAL_CREATED");
  setOfflineTripStatus(item.id, "PENDING_SYNC");
  emit("nvu-offline-trip-queued", { id: item.id, jobId: item.jobId });
  return read().find((candidate) => candidate.id === item.id) || item;
};

export const getOfflineTrips = () => read();
export const getPendingOfflineTrips = () => read().filter((item) => item.status === "PENDING_SYNC");
export const getPendingOfflineTripsForJob = (jobId: string) => read().filter(
  (item) => ["LOCAL_CREATED", "PENDING_SYNC", "SYNCING", "UPLOADING", "SERVER_RECEIVED", "VALIDATION_PENDING", "SENT"].includes(item.status) &&
    (item.jobId === jobId || String(item.payload?.jobId || "") === jobId),
);

export const removeOfflineTrip = (id: string) => {
  const queue = read();
  const item = queue.find((candidate) => candidate.id === id);
  write(queue.filter((candidate) => candidate.id !== id));
  emit("nvu-offline-trip-synced", { id, jobId: item?.jobId });
};

export const markOfflineTripFailed = (
  id: string,
  error?: unknown,
  options: { retryable?: boolean } = {},
) => {
  const queue = read();
  const current = queue.find((item) => item.id === id);
  if (!current) return;
  const errorMessage = String((error as any)?.message || (error as any)?.code || error || "VALIDATION_FAILED").slice(0, 240);
  const status: OfflineTripStatus = options.retryable ? "PENDING_SYNC" : "FAILED";
  const updated: OfflineTripRecord = {
    ...current,
    status,
    syncStatus: status,
    attempts: current.attempts + 1,
    errorMessage: options.retryable ? undefined : errorMessage,
    statusHistory: [...(current.statusHistory || [current.status]), status],
    payload: {
      ...current.payload,
      offlineSyncStatus: publicSyncStatus(status),
      ...(options.retryable ? { offlineSyncError: errorMessage } : { offlineSyncError: errorMessage }),
    },
  };
  write(queue.map((item) => item.id === id ? updated : item));
  publishStatus(updated, status);
};

export const retryOfflineTrip = (id: string) => {
  const queue = read();
  const current = queue.find((item) => item.id === id);
  if (!current || current.status !== "FAILED") return false;
  const updated: OfflineTripRecord = {
    ...current,
    status: "PENDING_SYNC",
    syncStatus: "PENDING_SYNC",
    errorMessage: undefined,
    statusHistory: [...(current.statusHistory || [current.status]), "PENDING_SYNC"],
    payload: {
      ...current.payload,
      offlineSyncStatus: "awaiting_connection",
      offlineSyncError: "",
    },
  };
  write(queue.map((item) => item.id === id ? updated : item));
  publishStatus(updated, "PENDING_SYNC");
  emit("nvu-offline-trip-queued", { id: itemId(updated), jobId: updated.jobId, manualRetry: true });
  return true;
};

const itemId = (item: OfflineTripRecord) => item.id;
export const OFFLINE_TRIP_QUEUE_KEY = KEY;
export const OFFLINE_TRIP_QUEUE_LEGACY_KEY = LEGACY_KEY;
