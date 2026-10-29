import type { ProfileCoverTarget } from "../lib/profileCover";

export type ProfileCoverRecord = ProfileCoverTarget & {
  key: string;
  viewerId: string;
  revision: string;
  updatedAt: number;
  imageDataUrl: string;
  remoteUrl: string;
  status: "pending" | "synced";
  /** Empty image is an intentional removal; it must also synchronize. */
  removed?: boolean;
  failure?: boolean;
};
export const PROFILE_COVER_CHANGED = "nvu:profile-cover-changed";
const PREFIX = "nvu-profile-cover:v1:";
const memory = new Map<string, ProfileCoverRecord>();
const locks = new Map<string, Promise<unknown>>();
export const profileCoverKey = (viewerId: string, target: ProfileCoverTarget) => PREFIX + [viewerId, target.scope, target.profileId].map(encodeURIComponent).join(":");
export const readProfileCoverMemory = (viewerId: string, target: ProfileCoverTarget) => memory.get(profileCoverKey(viewerId, target)) || null;

function valid(record: any): record is ProfileCoverRecord {
  return Boolean(record?.viewerId && record?.profileId && ["driver", "company"].includes(record.scope)
    && record.key === profileCoverKey(record.viewerId, record) && record.revision
    && Number.isFinite(record.updatedAt) && ["pending", "synced"].includes(record.status)
    && typeof record.remoteUrl === "string" && (!record.remoteUrl || /^https:\/\//.test(record.remoteUrl))
    && typeof record.imageDataUrl === "string" && record.imageDataUrl.length <= 2_600_000
    && (record.removed === true || /^data:image\/(webp|jpeg|png);base64,/.test(record.imageDataUrl)));
}

async function access<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("nvu-profile-covers-v1", 1);
    let finished = false;
    const timer = setTimeout(() => { finished = true; reject(new Error("Armazenamento da capa indisponível.")); }, 4_000);
    request.onupgradeneeded = () => request.result.createObjectStore("covers", { keyPath: "key" });
    request.onsuccess = () => {
      if (finished) return request.result.close();
      finished = true; clearTimeout(timer);
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = request.onblocked = () => { finished = true; clearTimeout(timer); reject(request.error || new Error("Armazenamento da capa indisponível.")); };
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction("covers", mode); let value: T;
      const timer = setTimeout(() => { try { transaction.abort(); } catch { /* finished */ } reject(new Error("Não foi possível salvar a capa neste aparelho.")); }, 4_000);
      transaction.oncomplete = () => { clearTimeout(timer); resolve(value); };
      transaction.onerror = transaction.onabort = () => { clearTimeout(timer); reject(transaction.error || new Error("Não foi possível salvar a capa neste aparelho.")); };
      try { run(transaction.objectStore("covers"), next => { value = next; }); }
      catch (error) { clearTimeout(timer); try { transaction.abort(); } catch { /* finished */ } reject(error); }
    });
  } finally { db.close(); }
}

function remember(record: ProfileCoverRecord) {
  memory.delete(record.key); memory.set(record.key, record);
  if (memory.size > 64) {
    for (const [key, value] of memory) { if (value.status === "synced") memory.delete(key); if (memory.size <= 48) break; }
  }
}
function notify(record: ProfileCoverRecord) {
  remember(record);
  window.dispatchEvent(new CustomEvent(PROFILE_COVER_CHANGED, { detail: { key: record.key } }));
}
async function locked<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) || Promise.resolve();
  // The same account can be open in two web tabs. A browser-wide lock also
  // protects the durable fallback while each tab has its own JavaScript map.
  const execute = () => navigator.locks?.request ? navigator.locks.request(`profile-cover:${key}`, run) : run();
  const next = previous.catch(() => undefined).then(execute);
  locks.set(key, next);
  try { return await next; } finally { if (locks.get(key) === next) locks.delete(key); }
}
export async function getProfileCover(viewerId: string, target: ProfileCoverTarget): Promise<ProfileCoverRecord | null> {
  if (!viewerId || !target.profileId) return null;
  const key = profileCoverKey(viewerId, target);
  let record: unknown;
  try { record = await access("readonly", (store, result) => { store.get(key).onsuccess = event => result((event.target as IDBRequest).result); }); }
  catch { /* Independently durable fallback, never report a memory-only save. */ }
  try {
    const fallback = JSON.parse(localStorage.getItem(key) || "null");
    // A failed IndexedDB write may leave an older row behind. A durable
    // fallback always wins until a later successful write removes it.
    if (valid(fallback) && fallback.key === key) record = fallback;
  } catch { /* unavailable */ }
  if (!valid(record) || record.key !== key) return memory.get(key) || null;
  remember(record); return record;
}
async function write(record: ProfileCoverRecord) {
  if (!valid(record)) throw new Error("A capa preparada é inválida. Escolha outra imagem.");
  try {
    await access<void>("readwrite", (store, result) => { store.put(record); result(); });
    try { localStorage.removeItem(record.key); } catch { /* optional cleanup */ }
  } catch (cause) {
    try { localStorage.setItem(record.key, JSON.stringify(record)); }
    catch { throw new Error("Não há espaço para salvar a capa neste aparelho.", { cause }); }
  }
  notify(record);
  void navigator.storage?.persist?.().catch(() => false);
}
export function putProfileCover(record: ProfileCoverRecord): Promise<void> {
  return locked(record.key, () => write(record));
}
/** Prevent an old upload/cache read from replacing a more recent local choice. */
export function updateProfileCover(record: ProfileCoverRecord, changes: Partial<Pick<ProfileCoverRecord, "remoteUrl" | "status" | "failure">>): Promise<ProfileCoverRecord | null> {
  return locked(record.key, async () => {
    const latest = await getProfileCover(record.viewerId, record);
    if (!latest || latest.revision !== record.revision) return null;
    const next = { ...latest, ...changes }; await write(next); return next;
  });
}
export function cacheRemoteProfileCover(record: ProfileCoverRecord, isCurrent: () => boolean): Promise<void> {
  return locked(record.key, async () => {
    const latest = await getProfileCover(record.viewerId, record);
    if (!isCurrent() || latest?.status === "pending") return;
    await write(record);
    // Bound downloaded covers; unsent edits are never evicted.
    try {
      await access<void>("readwrite", (store, result) => {
        store.getAll().onsuccess = event => {
          const rows = ((event.target as IDBRequest).result as unknown[]).filter(valid).filter(row => row.status === "synced").sort((a,b) => b.updatedAt - a.updatedAt);
          rows.slice(48).forEach(row => { store.delete(row.key); memory.delete(row.key); }); result();
        };
      });
    } catch { /* the current image is already durable */ }
  });
}
export async function listPendingProfileCovers(viewerId: string): Promise<ProfileCoverRecord[]> {
  const records = new Map<string, ProfileCoverRecord>();
  try {
    const rows = await access<unknown[]>("readonly", (store, result) => { store.getAll().onsuccess = event => result((event.target as IDBRequest).result || []); });
    rows.filter(valid).forEach(row => records.set(row.key, row));
  } catch { /* fallback below */ }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i); if (!key?.startsWith(PREFIX)) continue;
      const record = JSON.parse(localStorage.getItem(key) || "null");
      if (valid(record)) records.set(record.key, record);
    }
  } catch { /* unavailable */ }
  return [...records.values()].filter(record => record.viewerId === viewerId && record.status === "pending");
}
