import imageCompression from "browser-image-compression";
import { localImageCompressionWorkerUrl } from "../lib/localImageCompressionWorker";
import { convertFileToBase64 } from "../lib/utils";
import { assertDecodable } from "./photoDecode";
import { downloadPhotoBlob } from "./photoDownload";

export type RankingImageIdentity = { viewerId: string; assetId: string };
export type RankingImageRecord = RankingImageIdentity & { key: string; remoteUrl: string; dataUrl: string; savedAt: number };
export const RANKING_IMAGE_CHANGED = "nvu:ranking-image-changed";
const PREFIX = "nvu-ranking-image:v1:";
const TTL = 60 * 60_000;
const memory = new Map<string, RankingImageRecord>();
const running = new Map<string, Promise<RankingImageRecord | null>>();
const requested = new Map<string, string>();
let active = 0;
const waiting: (() => void)[] = [];
export const rankingImageKey = (id: RankingImageIdentity) => PREFIX + [id.viewerId, id.assetId].map(encodeURIComponent).join(":");
const valid = (value: any, id: RankingImageIdentity): value is RankingImageRecord =>
  value?.key === rankingImageKey(id) && value.viewerId === id.viewerId && value.assetId === id.assetId
  && Number.isFinite(value.savedAt) && typeof value.remoteUrl === "string"
  && typeof value.dataUrl === "string" && /^data:image\/[^;,]+;base64,/.test(value.dataUrl);

function remember(record: RankingImageRecord) {
  memory.delete(record.key); memory.set(record.key, record);
  while (memory.size > 512) memory.delete(memory.keys().next().value!);
}
export function readRankingImageMemory(id: RankingImageIdentity): RankingImageRecord | null { return memory.get(rankingImageKey(id)) || null; }

async function access<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("nvu-ranking-images-v1", 1);
    let settled = false;
    const timer = setTimeout(() => { settled = true; reject(new Error("RANKING_IMAGE_STORAGE_TIMEOUT")); }, 4_000);
    req.onupgradeneeded = () => req.result.createObjectStore("images", { keyPath: "key" });
    req.onsuccess = () => { if (settled) return req.result.close(); settled = true; clearTimeout(timer); req.result.onversionchange = () => req.result.close(); resolve(req.result); };
    req.onerror = req.onblocked = () => { settled = true; clearTimeout(timer); reject(req.error || new Error("RANKING_IMAGE_STORAGE_UNAVAILABLE")); };
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction("images", mode); let value: T;
      const timer = setTimeout(() => { try { tx.abort(); } catch { /* completed */ } reject(new Error("RANKING_IMAGE_STORAGE_TIMEOUT")); }, 4_000);
      tx.oncomplete = () => { clearTimeout(timer); resolve(value); };
      tx.onerror = tx.onabort = () => { clearTimeout(timer); reject(tx.error || new Error("RANKING_IMAGE_STORAGE_FAILED")); };
      try { run(tx.objectStore("images"), (next) => { value = next; }); }
      catch (error) { clearTimeout(timer); try { tx.abort(); } catch { /* completed */ } reject(error); }
    });
  } finally { db.close(); }
}

export async function getRankingImage(id: RankingImageIdentity): Promise<RankingImageRecord | null> {
  if (!id.viewerId || !id.assetId) return null;
  const key = rankingImageKey(id), cached = memory.get(key);
  if (cached) return cached;
  let record: unknown;
  try { record = await access("readonly", (store, result) => { store.get(key).onsuccess = (event) => result((event.target as IDBRequest).result); }); }
  catch { /* Read the independently validated fallback below. */ }
  if (!valid(record, id)) {
    try { record = JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
  }
  if (!valid(record, id)) return null;
  remember(record); return record;
}

async function put(record: RankingImageRecord): Promise<void> {
  try {
    await access<void>("readwrite", (store, result) => { store.put(record); result(); });
    try { localStorage.removeItem(record.key); } catch { /* optional fallback cleanup */ }
  } catch (error) {
    try { localStorage.setItem(record.key, JSON.stringify(record)); }
    catch { throw new Error("RANKING_IMAGE_STORAGE_FULL_OR_UNAVAILABLE", { cause: error }); }
  }
  remember(record);
  window.dispatchEvent(new CustomEvent(RANKING_IMAGE_CHANGED, { detail: { key: record.key } }));
  void navigator.storage?.persist?.().catch(() => false);
}

/** Scope the bytes to the viewer and asset; never depend on HTTP cache for offline. */
export async function loadRankingImage(id: RankingImageIdentity, remoteUrl: string, force = false): Promise<RankingImageRecord | null> {
  if (!id.viewerId || !id.assetId) return null;
  const cached = await getRankingImage(id);
  const key = rankingImageKey(id);
  requested.set(key, remoteUrl);
  while (requested.size > 512) requested.delete(requested.keys().next().value!);
  if (!remoteUrl || navigator.onLine === false) return cached;
  if (!force && cached?.remoteUrl === remoteUrl && Date.now() - cached.savedAt < TTL) return cached;
  const requestKey = JSON.stringify([key, remoteUrl]);
  const existing = running.get(requestKey); if (existing) return existing;
  const task = (async () => {
    if (active >= 2) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      if (navigator.onLine === false) return cached;
      const blob = await downloadPhotoBlob(remoteUrl); await assertDecodable(blob);
      const file = await imageCompression(new File([blob], "ranking", { type: blob.type }), {
        maxWidthOrHeight: 384, maxSizeMB: 0.08, fileType: "image/webp", useWebWorker: true,
        libURL: localImageCompressionWorkerUrl(),
      });
      const dataUrl = await convertFileToBase64(file);
      if (requested.get(key) !== remoteUrl) return getRankingImage(id);
      const record = { ...id, key, remoteUrl, dataUrl, savedAt: Date.now() };
      await put(record); return record;
    } finally { const next = waiting.shift(); if (next) next(); else active--; }
  })();
  running.set(requestKey, task);
  try { return await task; } finally { running.delete(requestKey); if (requested.get(key) === remoteUrl) requested.delete(key); }
}
