import { belongsToVehiclePhoto, vehiclePhotoKey, type VehiclePhotoIdentity } from "../lib/vehiclePhotoIdentity";

export const VEHICLE_PHOTO_DB = "nvu-vehicle-photos-v2";
export const VEHICLE_PHOTO_CHANGED = "nvu-vehicle-photo-changed";
const STORE = "photos";
const POSTER_PREFIX = "nvu-vehicle-photo-poster:";
const FALLBACK_PREFIX = "nvu-vehicle-photo-full:";
const STORAGE_TIMEOUT_MS = 4_000;
let persistenceRequested = false;

function validRecord(value: any): value is VehiclePhotoRecord {
  try {
    return value && value.key === vehiclePhotoKey(value)
      && typeof value.revision === "string" && value.revision.length > 0
      && ["pending", "synced"].includes(value.status)
      && typeof value.imageDataUrl === "string" && /^data:image\/[^;,]+;base64,/.test(value.imageDataUrl)
      && typeof value.posterDataUrl === "string" && /^data:image\//.test(value.posterDataUrl)
      && Number.isFinite(value.updatedAt);
  } catch { return false; }
}

function readFallback(key: string): VehiclePhotoRecord | null {
  try {
    const value = JSON.parse(localStorage.getItem(FALLBACK_PREFIX + key) || "null");
    return validRecord(value) && value.key === key ? value : null;
  } catch { return null; }
}

export interface VehiclePhotoRecord extends VehiclePhotoIdentity {
  key: string;
  companyId: string;
  revision: string;
  imageDataUrl: string;
  posterDataUrl: string;
  contentType: string;
  remoteUrl?: string;
  remoteVersion?: string;
  remoteUpdatedAt?: number;
  needsPublication?: boolean;
  offlinePinned?: boolean;
  status: "pending" | "synced";
  failure?: { stage: "upload" | "publish"; code: string; attempts: number; at: number };
  updatedAt: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("VEHICLE_PHOTO_STORAGE_UNAVAILABLE"));
    const request = indexedDB.open(VEHICLE_PHOTO_DB, 1);
    let settled = false;
    const fail = (error: unknown) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } };
    const timer = setTimeout(() => fail(new Error("VEHICLE_PHOTO_STORAGE_TIMEOUT")), STORAGE_TIMEOUT_MS);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: "key" });
      store.createIndex("userId", "userId");
    };
    request.onsuccess = () => {
      if (settled) return request.result.close();
      settled = true; clearTimeout(timer);
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => fail(request.error);
    request.onblocked = () => fail(new Error("VEHICLE_PHOTO_STORAGE_BLOCKED"));
  });
}

async function transaction<T>(mode: IDBTransactionMode, execute: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      let result: T;
      const timer = setTimeout(() => { try { tx.abort(); } catch { /* already completed */ } reject(new Error("VEHICLE_PHOTO_STORAGE_TIMEOUT")); }, STORAGE_TIMEOUT_MS);
      tx.oncomplete = () => { clearTimeout(timer); resolve(result); };
      tx.onabort = tx.onerror = () => { clearTimeout(timer); reject(tx.error || new Error("VEHICLE_PHOTO_STORAGE_FAILED")); };
      try { execute(tx.objectStore(STORE), (value) => { result = value; }); }
      catch (error) { clearTimeout(timer); try { tx.abort(); } catch { /* closed */ } reject(error); }
    });
  } finally { db.close(); }
}

export function readVehiclePhotoPoster(identity: VehiclePhotoIdentity): { src: string; pending: boolean } | null {
  try {
    const poster = JSON.parse(localStorage.getItem(POSTER_PREFIX + vehiclePhotoKey(identity)) || "null");
    return belongsToVehiclePhoto(poster, identity) && /^data:image\//.test(poster?.posterDataUrl || "")
      ? { src: poster.posterDataUrl, pending: poster.status === "pending" || Boolean(poster.needsPublication) } : null;
  } catch { return null; }
}

function announce(record: VehiclePhotoRecord) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(VEHICLE_PHOTO_CHANGED, { detail: { key: record.key } }));
}

function cachePoster(record: VehiclePhotoRecord) {
  try {
    const key = POSTER_PREFIX + record.key;
    // Bound synchronous thumbnails; full image bytes remain in IndexedDB.
    const old: { key: string; updatedAt: number; size: number }[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const itemKey = localStorage.key(i)!;
      if (!itemKey.startsWith(POSTER_PREFIX) || itemKey === key) continue;
      const item = localStorage.getItem(itemKey) || "";
      try { old.push({ key: itemKey, updatedAt: JSON.parse(item).updatedAt || 0, size: item.length }); }
      catch { localStorage.removeItem(itemKey); }
    }
    old.sort((a, b) => a.updatedAt - b.updatedAt);
    let size = old.reduce((sum, item) => sum + item.size, record.posterDataUrl.length);
    while (old.length >= 24 || (size > 2_000_000 && old.length)) {
      const removed = old.shift()!;
      localStorage.removeItem(removed.key);
      size -= removed.size;
    }
    const { imageDataUrl: _image, ...poster } = record;
    localStorage.setItem(key, JSON.stringify(poster));
  } catch { /* IndexedDB remains the authoritative durable copy. */ }
}

export async function getVehiclePhotoRecord(identity: VehiclePhotoIdentity): Promise<VehiclePhotoRecord | null> {
  const key = vehiclePhotoKey(identity);
  let record: VehiclePhotoRecord | undefined;
  try {
    record = await transaction<VehiclePhotoRecord | undefined>("readonly", (store, result) => {
      store.get(key).onsuccess = (event) => result((event.target as IDBRequest).result);
    });
  } catch { /* Older WebViews may require the localStorage fallback. */ }
  // A full/blocked IndexedDB can retain an older *valid* record while the
  // user's newly selected photo was saved successfully in the fallback.
  // A valid fallback exists only after the primary write failed; it wins.
  const fallback = readFallback(key);
  if (fallback && belongsToVehiclePhoto(fallback, identity)) return fallback;
  return validRecord(record) && belongsToVehiclePhoto(record, identity) ? record : null;
}

export async function putVehiclePhotoRecord(record: VehiclePhotoRecord, expectedRevision?: string | null): Promise<boolean> {
  if (!validRecord(record)) throw new Error("VEHICLE_PHOTO_INVALID_RECORD");
  try {
    const saved = await transaction<boolean>("readwrite", (store, result) => {
      if (expectedRevision === undefined) { store.put(record); return result(true); }
      store.get(record.key).onsuccess = (event) => {
        const raw = (event.target as IDBRequest).result;
        const current = validRecord(raw) ? raw : undefined;
        if ((current?.revision || null) !== expectedRevision) return result(false);
        store.put(record);
        result(true);
      };
    });
    if (!saved) return false;
    try { localStorage.removeItem(FALLBACK_PREFIX + record.key); } catch { /* optional cleanup */ }
  } catch (storageFailure) {
    // Never report a locally saved photo if neither durable store accepted it.
    const current = readFallback(record.key);
    if (!current && expectedRevision !== undefined && expectedRevision !== null) throw new Error("VEHICLE_PHOTO_STORAGE_FULL_OR_UNAVAILABLE", { cause: storageFailure });
    if (expectedRevision !== undefined && (current?.revision || null) !== expectedRevision) return false;
    try { localStorage.setItem(FALLBACK_PREFIX + record.key, JSON.stringify(record)); }
    catch (fallbackFailure) { throw new Error("VEHICLE_PHOTO_STORAGE_FULL_OR_UNAVAILABLE", { cause: new AggregateError([storageFailure, fallbackFailure]) }); }
  }
  cachePoster(record);
  if (!persistenceRequested && typeof navigator !== "undefined") {
    persistenceRequested = true;
    void navigator.storage?.persist?.().catch(() => false);
  }
  announce(record);
  return true;
}

export async function updateVehiclePhotoRecord(record: VehiclePhotoRecord, patch: Partial<VehiclePhotoRecord>): Promise<VehiclePhotoRecord | null> {
  // Another revision may have been saved into the fallback while an older
  // upload was in flight. Such an upload may never change the winner's state.
  const fallbackWinner = readFallback(record.key);
  if (fallbackWinner && fallbackWinner.revision !== record.revision) return null;
  let updated: VehiclePhotoRecord | null = null;
  let storageFailure: unknown;
  try {
    updated = await transaction<VehiclePhotoRecord | null>("readwrite", (store, result) => {
      store.get(record.key).onsuccess = (event) => {
        const current = (event.target as IDBRequest).result as VehiclePhotoRecord | undefined;
        if (!current || current.revision !== record.revision) return result(null);
        const next = { ...current, ...patch, userId: current.userId, simulatorId: current.simulatorId, vehicleId: current.vehicleId, key: current.key, revision: current.revision };
        if (!validRecord(next)) return result(null);
        store.put(next);
        result(next);
      };
    });
  } catch (error) { storageFailure = error; }
  // A different revision in IndexedDB is not proof that this update is stale:
  // the authoritative version may be in localStorage after an IDB write error.
  if (!updated) {
    try {
      const current = readFallback(record.key);
      if (current?.revision === record.revision) {
        const next = { ...current, ...patch, userId: current.userId, simulatorId: current.simulatorId, vehicleId: current.vehicleId, key: current.key, revision: current.revision };
        if (!validRecord(next)) throw new Error("VEHICLE_PHOTO_INVALID_RECORD");
        localStorage.setItem(FALLBACK_PREFIX + record.key, JSON.stringify(next));
        updated = next;
      }
    } catch (error) { storageFailure = error; }
  }
  if (!updated && storageFailure) throw new Error("VEHICLE_PHOTO_STORAGE_UPDATE_FAILED", { cause: storageFailure });
  if (updated) { cachePoster(updated); announce(updated); }
  return updated;
}

export async function listPendingVehiclePhotos(userId: string, includeSynced = false): Promise<VehiclePhotoRecord[]> {
  let records: VehiclePhotoRecord[] = [];
  try {
    records = await transaction<VehiclePhotoRecord[]>("readonly", (store, result) => {
      store.index("userId").getAll(userId).onsuccess = (event) => result((event.target as IDBRequest).result);
    });
  } catch { /* collect localStorage fallback records */ }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      if (!key.startsWith(FALLBACK_PREFIX)) continue;
      try {
        const record = JSON.parse(localStorage.getItem(key) || "null");
        if (validRecord(record) && record.userId === userId) {
          // Prefer the newest fallback even if the IDB row is a valid synced
          // older revision. Otherwise a pending image can disappear forever.
          records = records.filter((item) => item.key !== record.key);
          records.push(record);
        }
      } catch {
        // One corrupt fallback entry must not hide later pending records.
      }
    }
  } catch { /* IndexedDB records remain usable */ }
  return records.filter((record) => validRecord(record) && record.userId === userId && (includeSynced || record.status === "pending" || record.needsPublication));
}
