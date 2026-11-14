import { OfflineDatabase, readCanonicalOutboxSnapshot } from "../services/offline/OfflineDatabase";
const DB_NAME = "nvu-offline-receipts";
const DB_VERSION = 1;
const STORE_NAME = "receipts";

export type OfflineReceiptRecord = {
  key: string;
  createdAt: number;
  fileName: string;
  contentType: string;
  companyId: string;
  userId: string;
  blob: Blob;
  uploadedUrl?: string;
  blobDigest?: string;
};

const openDatabase = (): Promise<IDBDatabase> => {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("OFFLINE_RECEIPT_STORAGE_UNAVAILABLE"));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error || new Error("OFFLINE_RECEIPT_DB_OPEN_FAILED"));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
};

const withStore = async <T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      const request = operation(store);
      let result: T;
      request.onerror = () => reject(request.error || transaction.error || new Error("OFFLINE_RECEIPT_DB_REQUEST_FAILED"));
      request.onsuccess = () => { result = request.result; };
      transaction.onerror = () => reject(transaction.error || new Error("OFFLINE_RECEIPT_DB_TRANSACTION_FAILED"));
      transaction.onabort = () => reject(transaction.error || new Error("OFFLINE_RECEIPT_DB_TRANSACTION_ABORTED"));
      // A successful put request can still be rolled back. Report success only
      // after the IndexedDB transaction commits the actual image bytes.
      transaction.oncomplete = () => resolve(result);
    });
  } finally {
    database.close();
  }
};

export const buildOfflineReceiptKey = (imageHash: string) =>
  `receipt-${String(imageHash || "").trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 96)}`;

export async function persistOfflineReceipt(
  file: File,
  meta: { imageHash: string; companyId: string; userId: string },
): Promise<string> {
  const hashKey = buildOfflineReceiptKey(meta.imageHash);
  const key = `v2:${encodeURIComponent(meta.userId)}:${encodeURIComponent(meta.companyId)}:${hashKey}`;
  if (!meta.userId || hashKey === "receipt-") throw new Error("OFFLINE_RECEIPT_HASH_REQUIRED");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = typeof crypto !== "undefined" && crypto.subtle
    ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(b => b.toString(16).padStart(2, "0")).join("")
    : null;
  const prior = await getOfflineReceipt(key);
  if (prior) {
    const old = new Uint8Array(await prior.blob.arrayBuffer());
    if (prior.userId !== meta.userId || prior.companyId !== meta.companyId || old.length !== bytes.length ||
        old.some((value, index) => value !== bytes[index])) throw new Error("OFFLINE_RECEIPT_IMMUTABLE_CONFLICT");
  }

  const record: OfflineReceiptRecord = {
    key,
    createdAt: Date.now(),
    fileName: file.name || `comprovante-${Date.now()}.jpg`,
    contentType: file.type || "image/jpeg",
    companyId: String(meta.companyId || "Geral"),
    userId: String(meta.userId || ""),
    blob: file,
    ...(digest ? { blobDigest: digest } : {}),
  };
  let conflict: Error | undefined;
  await withStore("readwrite", (store) => {
    const request = store.get(key);
    request.addEventListener("success", () => {
      const current = request.result as OfflineReceiptRecord | undefined;
      if (!current) { store.put(record); return; }
      const unchangedLegacy = prior && prior.createdAt === current.createdAt && prior.blob.size === current.blob.size;
      if (current.userId !== meta.userId || current.companyId !== meta.companyId ||
          !(digest && current.blobDigest === digest || unchangedLegacy)) {
        conflict = new Error("OFFLINE_RECEIPT_IMMUTABLE_CONFLICT"); store.transaction.abort();
      }
      // Same bytes retain the first file and its completed upload URL. A
      // reselection/retry never overwrites evidence or restarts an upload.
    });
    return request;
  }).catch(error => { throw conflict || error; });
  return key;
}

export async function getOfflineReceipt(key: string): Promise<OfflineReceiptRecord | null> {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return null;
  const result = await withStore<OfflineReceiptRecord | undefined>("readonly", (store) => store.get(normalizedKey));
  return result || null;
}

export async function markOfflineReceiptUploaded(key: string, uploadedUrl: string): Promise<void> {
  await withStore("readwrite", (store) => {
    const request = store.get(key);
    request.addEventListener("success", () => {
      const current = request.result as OfflineReceiptRecord | undefined;
      if (current) store.put({ ...current, uploadedUrl });
    });
    return request;
  });
}

/** A new file selection must never erase the proof of an accepted pending trip.
 * Unknown/corrupt storage is conservatively treated as a live reference. */
export function isOfflineReceiptReferenced(key: string, storage?: Pick<Storage, "getItem">): boolean {
  try {
    const target = storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
    if (!target) return true;
    const raw = target.getItem(OfflineDatabase.storageKey);
    const envelope = raw ? JSON.parse(raw) : { records: {} };
    if (!envelope?.records || typeof envelope.records !== "object" || Array.isArray(envelope.records)) return true;
    if (Object.values(envelope.records).some((record: any) => record?.trip?.offlineReceiptKey === key &&
      (record.syncStatus !== "SERVER_CONFIRMED" || !record.trip.serverValidatedAt || record.trip.editPending))) return true;
    const queue = readCanonicalOutboxSnapshot(target);
    if (Object.values(queue).some((item: any) => item?.trip?.offlineReceiptKey === key && item.state !== "SERVER_CONFIRMED")) return true;
    const legacy = JSON.parse(target.getItem("nvu.offline.trip.queue.v2") || "[]");
    if (!Array.isArray(legacy)) return true;
    return legacy.some(item => item?.payload?.offlineReceiptKey === key && item.status !== "VALIDATED");
  } catch { return true; }
}

export async function removeOfflineReceipt(key: string): Promise<void> {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey || isOfflineReceiptReferenced(normalizedKey)) return;
  await withStore("readwrite", (store) => store.delete(normalizedKey));
}

export const OFFLINE_RECEIPT_DB_NAME = DB_NAME;
export const OFFLINE_RECEIPT_STORE_NAME = STORE_NAME;
