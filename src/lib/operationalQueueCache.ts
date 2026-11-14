import type { DriverQueueView } from "../../functions/src/operationalQueueModel";
export type QueueCacheRecord = {
  schemaVersion: 1;
  scopeKey: string;
  complete: true;
  storedAt: number;
  totalItems: number;
  snapshot: DriverQueueView;
};
export function automaticQueueScope(
  uid: string,
  companyId: string,
  role: string,
  simulatorRef: string,
): string {
  return uid && companyId && role && simulatorRef
    ? JSON.stringify([uid, companyId, role, simulatorRef])
    : "";
}
export function isCompleteQueueCache(
  record: unknown,
  scopeKey: string,
): record is QueueCacheRecord {
  const r = record as QueueCacheRecord;
  if (
    !r ||
    r.schemaVersion !== 1 ||
    r.scopeKey !== scopeKey ||
    r.complete !== true ||
    !Number.isFinite(r.storedAt) ||
    !Array.isArray(r.snapshot?.items) ||
    !Array.isArray(r.snapshot?.queues) ||
    r.totalItems !== r.snapshot.items.length
  )
    return false;
  let uid: string, companyId: string;
  try {
    const scope = JSON.parse(scopeKey || "[]");
    if (
      !Array.isArray(scope) ||
      scope.length !== 4 ||
      scope.some((v) => typeof v !== "string" || !v)
    )
      return false;
    [uid, companyId] = scope;
  } catch {
    return false;
  }
  const counts = new Map<string, number>();
  for (const queue of r.snapshot.queues) {
    if (
      !queue.id ||
      counts.has(queue.id) ||
      !Number.isSafeInteger(queue.count) ||
      queue.count < 0
    )
      return false;
    counts.set(queue.id, 0);
  }
  for (const item of r.snapshot.items) {
    if (!item?.id || !counts.has(item.queueId)) return false;
    counts.set(item.queueId, counts.get(item.queueId)! + 1);
  }
  if (r.snapshot.queues.some((q) => counts.get(q.id) !== q.count)) return false;
  return (
    r.snapshot.driverId === uid &&
    r.snapshot.companyId === companyId &&
    r.snapshot.queues.reduce((n, q) => n + q.count, 0) === r.totalItems &&
    new Set(r.snapshot.items.map((i) => `${i.queueId}\u0000${i.id}`)).size ===
      r.totalItems &&
    r.snapshot.items.every((i) => i.companyId === companyId)
  );
}
let database: Promise<IDBDatabase> | null = null;
const memory = new Map<string, QueueCacheRecord>();
function open(): Promise<IDBDatabase> {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open("nvu.operational.queues.v1", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("snapshots"))
        request.result.createObjectStore("snapshots");
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("QUEUE_CACHE_BLOCKED"));
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        database = null;
      };
      resolve(request.result);
    };
  });
  void database.catch(() => {
    database = null;
  });
  return database;
}
export async function readOperationalQueueCache(
  scopeKey: string,
): Promise<QueueCacheRecord | null> {
  if (!scopeKey) return null;
  const immediate = memory.get(scopeKey);
  if (immediate) return immediate;
  try {
    const db = await open();
    const row = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction("snapshots", "readonly"),
        r = tx.objectStore("snapshots").get(scopeKey);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      tx.onabort = () => reject(tx.error);
    });
    if (!isCompleteQueueCache(row, scopeKey)) return null;
    memory.set(scopeKey, row);
    return row;
  } catch {
    return null;
  }
}
export async function writeOperationalQueueCache(
  scopeKey: string,
  snapshot: DriverQueueView,
): Promise<boolean> {
  const record: QueueCacheRecord = {
    schemaVersion: 1,
    scopeKey,
    complete: true,
    storedAt: Date.now(),
    totalItems: snapshot.items.length,
    snapshot,
  };
  if (!isCompleteQueueCache(record, scopeKey)) return false;
  memory.set(scopeKey, record);
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("snapshots", "readwrite");
      tx.objectStore("snapshots").put(record, scopeKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}
