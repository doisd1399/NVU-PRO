import { doc, getDoc, serverTimestamp, setDoc, type Firestore } from "firebase/firestore";
import { belongsToVehiclePhoto, rankingVehiclePhotoDocumentKey, vehiclePhotoDocumentKey, resolveVehiclePhotoOperationSimulatorEvidence, type VehiclePhotoIdentity } from "../lib/vehiclePhotoIdentity";

function findRecord(data: Record<string, any> | undefined, identity: VehiclePhotoIdentity): Record<string, any> | null {
  if (belongsToVehiclePhoto(data, identity) && /^https:\/\//.test(data?.url || "")) return data!;
  const scoped = data?.vehiclePhotosV2?.[vehiclePhotoDocumentKey(identity)];
  if (belongsToVehiclePhoto(scoped, identity) && /^https:\/\//.test(scoped.url || "")) return scoped;
  const legacy = data?.vehiclePhotos?.[identity.vehicleId];
  if (!legacy || legacy.vehicleId !== identity.vehicleId || (legacy.userId && legacy.userId !== identity.userId)) return null;
  // Unscoped R3-era URLs lack simulator evidence. Never project one onto a
  // filtered simulator merely because its vehicleId is the same.
  const context = resolveVehiclePhotoOperationSimulatorEvidence(legacy, null, "");
  if (context.conflict || context.simulatorId !== identity.simulatorId) return null;
  return /^https:\/\//.test(legacy.url || "") ? legacy : null;
}

export function findRemoteVehiclePhoto(data: Record<string, any> | undefined, identity: VehiclePhotoIdentity): string | null {
  return findRecord(data, identity)?.url || null;
}

function timestamp(value: any): number {
  const raw = value?.toMillis?.() ?? (typeof value?.seconds === "number" ? value.seconds * 1000 + (value.nanoseconds || 0) / 1e6 : value);
  const parsed = typeof raw === "string" ? Date.parse(raw) : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export type RemoteVehiclePhotoDetails = {
  url: string; revision: string; updatedAt: number; version: string; source: "projection" | "legacy";
};
type Entry = { identityKey: string; expiresAt: number; request: Promise<RemoteVehiclePhotoDetails | null> };
const snapshots = new WeakMap<Firestore, Map<string, Entry>>();
const POSITIVE_TTL = 3_000;
const NEGATIVE_TTL = 500;

function details(record: Record<string, any>, source: RemoteVehiclePhotoDetails["source"]): RemoteVehiclePhotoDetails {
  const updatedAt = timestamp(record.updatedAt);
  const revision = String(record.revision || (updatedAt ? updatedAt : record.url));
  return { url: record.url, revision, updatedAt, source, version: JSON.stringify([record.url, revision, updatedAt]) };
}

export function invalidateRemoteVehiclePhoto(database: Firestore, identity: VehiclePhotoIdentity): void {
  const identityKey = rankingVehiclePhotoDocumentKey(identity);
  const cache = snapshots.get(database);
  for (const [key, entry] of cache || []) if (entry.identityKey === identityKey) cache!.delete(key);
}

export async function readRemoteVehiclePhotoDetails(database: Firestore, identity: VehiclePhotoIdentity, viewerId?: string): Promise<RemoteVehiclePhotoDetails | null> {
  const cache = snapshots.get(database) || new Map<string, Entry>();
  snapshots.set(database, cache);
  const identityKey = rankingVehiclePhotoDocumentKey(identity);
  const cacheKey = JSON.stringify([identityKey, viewerId || ""]);
  const prior = cache.get(cacheKey);
  if (prior && prior.expiresAt > Date.now()) return prior.request;
  // Bound metadata memory without touching any persisted offline image.
  if (cache.size >= 256) for (const [key, value] of cache) {
    if (value.expiresAt !== Infinity) { cache.delete(key); if (cache.size < 256) break; }
  }
  const entry = { identityKey, expiresAt: Infinity, request: null! as Entry["request"] };
  entry.request = (async () => {
    const snapshot = await getDoc(doc(database, "rankingVehiclePhotos", identityKey));
    const projected = snapshot.exists() ? findRecord(snapshot.data(), identity) : null;
    if (projected) return details(projected, "projection");
    if (viewerId === identity.userId) {
      const legacySnapshot = await getDoc(doc(database, "users", identity.userId));
      const legacy = findRecord(legacySnapshot.data(), identity);
      if (legacy) return details(legacy, "legacy");
    }
    return null;
  })();
  cache.set(cacheKey, entry);
  try {
    const result = await entry.request;
    // Reusing a settled request never extends its TTL.
    if (cache.get(cacheKey) === entry) entry.expiresAt = Date.now() + (result ? POSITIVE_TTL : NEGATIVE_TTL);
    return result;
  } catch (error) {
    if (cache.get(cacheKey) === entry) cache.delete(cacheKey);
    throw error;
  }
}

export async function readRemoteVehiclePhoto(database: Firestore, identity: VehiclePhotoIdentity, viewerId?: string): Promise<string | null> {
  return (await readRemoteVehiclePhotoDetails(database, identity, viewerId))?.url || null;
}

export async function writeRemoteVehiclePhoto(database: Firestore, identity: VehiclePhotoIdentity, url: string, revision?: string): Promise<void> {
  if (!/^https:\/\//.test(url)) throw new Error("VEHICLE_PHOTO_REMOTE_URL_REQUIRED");
  await setDoc(doc(database, "rankingVehiclePhotos", rankingVehiclePhotoDocumentKey(identity)), {
    userId: identity.userId, simulatorId: identity.simulatorId, vehicleId: identity.vehicleId,
    vehicleName: identity.vehicleName || "", url, ...(revision ? { revision } : {}), updatedAt: serverTimestamp(),
  }, { merge: true });
  invalidateRemoteVehiclePhoto(database, identity);
}
