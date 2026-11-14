import { downloadPhotoBlob } from "./photoDownload";

type Record = { key: string; viewerId: string; url: string; blob: Blob; savedAt: number; usedAt: number };
type Ready = Record & { src: string };
const MAX_ROWS = 192, MAX_BYTES = 64 * 1024 * 1024;
const memory = new Map<string, Ready>();
const flights = new Map<string, Promise<string>>();
const listeners = new Map<string, Set<() => void>>();
const viewerListeners = new Set<() => void>();
let viewer = "public", database: Promise<IDBDatabase> | undefined;
export const displayImageKey = (viewerId: string, url: string) => JSON.stringify([viewerId || "public", url]);
export const displayImageViewer = () => viewer;
export function subscribeDisplayViewer(listener: () => void) { viewerListeners.add(listener); return () => { viewerListeners.delete(listener); }; }
const remote = (url: string) => /^https?:\/\//i.test(url);
function open(): Promise<IDBDatabase> {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("nvu-display-images-v1", 1);
    let expired = false;
    const timer = setTimeout(() => { expired = true; reject(new Error("IMAGE_CACHE_TIMEOUT")); }, 2000);
    req.onupgradeneeded = () => { const s = req.result.createObjectStore("images", { keyPath: "key" }); s.createIndex("viewer", "viewerId"); };
    req.onsuccess = () => { if (expired) return req.result.close(); clearTimeout(timer); req.result.onversionchange = () => { req.result.close(); database = undefined; }; resolve(req.result); };
    req.onerror = req.onblocked = () => { clearTimeout(timer); reject(new Error("IMAGE_CACHE_UNAVAILABLE")); };
  }).catch(error => { database = undefined; throw error; });
  return database;
}
async function access<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("images", mode); let value: T;
    const timer = setTimeout(() => { try { tx.abort(); } catch { /* complete */ } reject(new Error("IMAGE_CACHE_TIMEOUT")); }, 2000);
    tx.oncomplete = () => { clearTimeout(timer); resolve(value); };
    tx.onerror = tx.onabort = () => { clearTimeout(timer); reject(new Error("IMAGE_CACHE_UNAVAILABLE")); };
    try { work(tx.objectStore("images"), result => { value = result; }); } catch (error) { clearTimeout(timer); reject(error); }
  });
}
function valid(row: Record | undefined, key: string): row is Record {
  return !!row && row.key === key && row.key === displayImageKey(row.viewerId, row.url)
    && row.blob instanceof Blob && row.blob.size > 0 && row.blob.size <= 10 * 1024 * 1024
    && /^image\//.test(row.blob.type) && Number.isFinite(row.savedAt);
}
function remember(row: Record): string {
  const old = memory.get(row.key);
  if (old && old.savedAt === row.savedAt) return old.src;
  const next = { ...row, src: URL.createObjectURL(row.blob) };
  memory.delete(row.key); memory.set(row.key, next);
  if (old) setTimeout(() => URL.revokeObjectURL(old.src), 30_000);
  for (const [key, value] of memory) {
    if (memory.size <= MAX_ROWS) break;
    if (listeners.get(key)?.size) continue;
    memory.delete(key); URL.revokeObjectURL(value.src);
  }
  listeners.get(row.key)?.forEach(listener => listener());
  return next.src;
}
export function readDisplayImage(viewerId: string, url: string): string {
  const row = memory.get(displayImageKey(viewerId, url));
  return row?.src || "";
}
export function subscribeDisplayImage(viewerId: string, url: string, listener: () => void) {
  const key = displayImageKey(viewerId, url), set = listeners.get(key) || new Set();
  set.add(listener); listeners.set(key, set);
  return () => { set.delete(listener); if (!set.size) listeners.delete(key); };
}
export async function hydrateDisplayImages(viewerId: string): Promise<void> {
  try {
    const rows = await access<Record[]>("readonly", (store, done) => { store.index("viewer").getAll(viewerId, MAX_ROWS).onsuccess = e => done((e.target as IDBRequest).result); });
    if (viewer !== viewerId) return;
    rows.forEach(row => { if (valid(row, row.key)) remember(row); });
  } catch { /* Rendering works even when persistent storage is unavailable. */ }
}
export function activateDisplayViewer(viewerId: string) {
  const next = viewerId || "public";
  if (viewer !== next) {
    viewer = next;
    // Bytes stay on disk under the original owner; a new account cannot select them.
    for (const [key, row] of memory) if (row.viewerId !== next) { URL.revokeObjectURL(row.src); memory.delete(key); }
    viewerListeners.forEach(listener => listener());
  }
  void hydrateDisplayImages(next);
}
async function save(row: Record): Promise<void> {
  try {
    await access<void>("readwrite", (store, done) => {
      store.put(row);
      store.getAll().onsuccess = e => {
        const rows = ((e.target as IDBRequest).result as Record[]).sort((a,b) => b.usedAt - a.usedAt);
        let bytes = 0;
        rows.forEach((r, index) => { bytes += r.blob.size; if (index >= MAX_ROWS || bytes > MAX_BYTES) store.delete(r.key); });
        done();
      };
    });
  } catch { /* Cache failure never prevents display or consumes the trip journal budget. */ }
}
let activeDownloads = 0;
const waiting: (() => void)[] = [];
/** Exact-URL bytes, shared by every page. Cached hits never require a network request. */
export async function cacheDisplayImage(viewerId: string, url: string, force = false): Promise<string> {
  if (!remote(url)) return url;
  const key = displayImageKey(viewerId, url), existing = flights.get(key);
  if (existing) return existing;
  const task = (async () => {
    let local: Record | undefined = memory.get(key);
    if (!local) {
      try { local = await access<Record>("readonly", (s, done) => { s.get(key).onsuccess = e => done((e.target as IDBRequest).result); }); } catch { /* optional */ }
    }
    const source = valid(local, key) ? remember(local) : "";
    // Versioned Firebase URLs change when edited. Revalidate mutable URLs daily in background.
    if (!force && local && source && (Date.now() - local.savedAt < 86_400_000 || /firebasestorage\.googleapis\.com/.test(url))) {
      if (Date.now() - local.usedAt > 60_000) void save({ ...local, usedAt: Date.now() });
      return source;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) return source || url;
    if (activeDownloads >= 2) await new Promise<void>(resolve => waiting.push(resolve)); else activeDownloads++;
    try {
      const blob = await downloadPhotoBlob(url, { preferCache: !force });
      const row = { key, viewerId, url, blob, savedAt: Date.now(), usedAt: Date.now() };
      await save(row);
      return viewer === viewerId ? remember(row) : source || url;
    } catch { return source || url; }
    finally { const next = waiting.shift(); if (next) next(); else activeDownloads--; }
  })();
  flights.set(key, task);
  try { return await task; } finally { if (flights.get(key) === task) flights.delete(key); }
}
export async function repairDisplayImage(viewerId: string, url: string) {
  const key = displayImageKey(viewerId, url), row = memory.get(key);
  if (row) { URL.revokeObjectURL(row.src); memory.delete(key); }
  listeners.get(key)?.forEach(listener => listener());
  try { await access<void>("readwrite", (s, done) => { s.delete(key); done(); }); } catch { /* optional */ }
  return cacheDisplayImage(viewerId, url, true);
}
