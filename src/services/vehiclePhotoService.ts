import imageCompression from "browser-image-compression";
import { localImageCompressionWorkerUrl } from "../lib/localImageCompressionWorker";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../lib/firebase";
import { compressImage, convertFileToBase64 } from "../lib/utils";
import { isAuthTeardownActive } from "../lib/authLifecycle";
import { vehiclePhotoKey, type VehiclePhotoIdentity } from "../lib/vehiclePhotoIdentity";
import { uploadService } from "./uploadService";
import { invalidateRemoteVehiclePhoto, readRemoteVehiclePhotoDetails, writeRemoteVehiclePhoto, type RemoteVehiclePhotoDetails } from "./vehiclePhotoRepository";
import { vehiclePhotoFailure } from "./vehiclePhotoErrors";
import { getVehiclePhotoRecord, listPendingVehiclePhotos, putVehiclePhotoRecord, updateVehiclePhotoRecord, VEHICLE_PHOTO_CHANGED, type VehiclePhotoRecord } from "./vehiclePhotoStore";
import { createVehiclePhotoSync } from "./vehiclePhotoSync";
import { downloadPhotoBlob } from "./photoDownload";
import { assertDecodable } from "./photoDecode";

const sync = createVehiclePhotoSync({
  currentUserId: () => isAuthTeardownActive() ? undefined : auth.currentUser?.uid,
  upload: async (record) => {
    const blob = await (await fetch(record.imageDataUrl)).blob();
    return uploadService.uploadImage({
      file: new File([blob], "veiculo.webp", { type: blob.type }),
      companyId: record.companyId, userId: record.userId,
      folder: `vehicle-photos-${record.simulatorId}-${record.vehicleId}`,
      maxOutputBytes: 1_800_000,
    });
  },
  writeMetadata: (record, url) => writeRemoteVehiclePhoto(db, record, url, record.revision),
});

async function imageBytes(file: File, preserveOptimized = false): Promise<{ imageDataUrl: string; posterDataUrl: string; contentType: string }> {
  const dimensions = await assertDecodable(file);
  const compressed = preserveOptimized && file.size <= 850_000 && Math.max(dimensions.width, dimensions.height) <= 1280 ? file : await imageCompression(file, {
    maxSizeMB: 0.8, maxWidthOrHeight: 1280, useWebWorker: true, fileType: "image/webp",
    libURL: localImageCompressionWorkerUrl(),
  });
  const imageDataUrl = await convertFileToBase64(compressed);
  const posterDataUrl = await compressImage(imageDataUrl, 480, 320, 0.65);
  return { imageDataUrl, posterDataUrl, contentType: compressed.type || "image/webp" };
}


function makeRecord(identity: VehiclePhotoIdentity, companyId: string, bytes: Awaited<ReturnType<typeof imageBytes>>): VehiclePhotoRecord {
  return {
    ...identity, ...bytes, companyId, key: vehiclePhotoKey(identity),
    revision: crypto.randomUUID(), updatedAt: Date.now(), status: "pending",
  };
}

const loading = new Map<string, Promise<VehiclePhotoRecord | null>>();
const lastPublicationAudit = new Map<string, number>();
async function reconcileOwnerPublications(userId: string): Promise<void> {
  if (auth.currentUser?.uid !== userId || navigator.onLine === false) return;
  if (Date.now() - (lastPublicationAudit.get(userId) || 0) < 120_000) return;
  lastPublicationAudit.set(userId, Date.now());
  for (const record of await listPendingVehiclePhotos(userId, true)) {
    if (auth.currentUser?.uid !== userId || isAuthTeardownActive()) return;
    if (record.status !== "synced" || record.needsPublication || !/^https:\/\//.test(record.remoteUrl || "")) continue;
    try {
      invalidateRemoteForAudit(record);
      const remote = await readRemoteVehiclePhotoDetails(db, record, userId);
      // A published projection, even for a newer revision, is authoritative.
      if (remote?.source === "projection") continue;
      await updateVehiclePhotoRecord(record, { needsPublication: true });
    } catch { /* Retry later; never claim a missing projection on read failure. */ }
  }
}
function invalidateRemoteForAudit(identity: VehiclePhotoIdentity) {
  invalidateRemoteVehiclePhoto(db, identity);
}

let queueStarted = false;
function startQueue(): void {
  if (queueStarted || typeof window === "undefined") return;
  queueStarted = true;
  let retry: ReturnType<typeof setTimeout> | undefined, retryDelay = 5_000, draining = false, rerun = false;
  const drain = () => {
    const uid = auth.currentUser?.uid;
    if (!uid || navigator.onLine === false || isAuthTeardownActive()) return;
    if (draining) { rerun = true; return; }
    draining = true;
    if (retry) clearTimeout(retry);
    void reconcileOwnerPublications(uid).catch(() => undefined)
      .then(() => sync.syncPending(uid)).catch(() => undefined).finally(async () => {
      draining = false;
      if (rerun) { rerun = false; drain(); return; }
      if (auth.currentUser?.uid !== uid || isAuthTeardownActive()) return;
      const pending = await listPendingVehiclePhotos(uid).catch(() => []);
      if (!pending.length) { retryDelay = 5_000; return; }
      retry = setTimeout(drain, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 300_000);
    });
  };
  onAuthStateChanged(auth, () => { if (retry) clearTimeout(retry); retryDelay = 5_000; drain(); });
  window.addEventListener(VEHICLE_PHOTO_CHANGED, () => { if (!draining) drain(); });
  window.addEventListener("online", drain);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") drain(); });
  window.addEventListener("focus", drain);
  void import("@capacitor/app").then(({ App }) => App.addListener("appStateChange", (state) => { if (state.isActive) drain(); })).catch(() => undefined);
  drain();
}

export const vehiclePhotoService = {
  async load(identity: VehiclePhotoIdentity, companyId: string, knownRemote?: RemoteVehiclePhotoDetails, forceDownload = false): Promise<VehiclePhotoRecord | null> {
    const local = await getVehiclePhotoRecord(identity);
    if (local?.status === "pending") return local;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return local;
    const key = vehiclePhotoKey(identity);
    if (loading.has(key)) {
      const existing = loading.get(key)!;
      if (!forceDownload) return existing;
      await existing.catch(() => undefined);
      return vehiclePhotoService.load(identity, companyId, knownRemote, true);
    }
    const task = (async () => {
      let remote: Awaited<ReturnType<typeof readRemoteVehiclePhotoDetails>> = null;
      try { remote = knownRemote || await readRemoteVehiclePhotoDetails(db, identity, auth.currentUser?.uid); } catch (error) {
        console.warn("[NVU] Consulta da foto:", {
          code: (error as { code?: string })?.code || "unknown",
          ownerIsViewer: auth.currentUser?.uid === identity.userId,
          hasLocalCopy: Boolean(local),
        });
        // Preserve a previously downloaded image while offline. Without a local
        // copy, propagate the failure so the UI never reports "not registered".
        if (local) return local;
        throw error;
      }
      // Historic localStorage URLs were keyed by owner+vehicle only, not by
      // simulator. Reusing one here could publish another simulator's photo.
      // They require an explicit scoped identity/review instead of an unsafe
      // automatic backfill. IndexedDB photo bytes remain untouched.
      if (!remote) {
        if (local?.status === "synced" && local.remoteUrl && auth.currentUser?.uid === identity.userId) {
          await updateVehiclePhotoRecord(local, { needsPublication: true });
          try { await sync.sync(identity); } catch { /* Durable publication retry on resume. */ }
          return await getVehiclePhotoRecord(identity);
        }
        return local;
      }
      const sameVersion = local?.remoteVersion ? local.remoteVersion === remote.version : local?.revision === remote.revision && !local.remoteUpdatedAt;
      if (!forceDownload && local?.remoteUrl === remote.url && sameVersion && local.status === "synced") {
        if (!local.remoteVersion) await putVehiclePhotoRecord({ ...local, remoteVersion: remote.version, remoteUpdatedAt: remote.updatedAt }, local.revision);
        return await getVehiclePhotoRecord(identity);
      }
      const blob = await downloadPhotoBlob(remote.url);
      let bytes: Awaited<ReturnType<typeof imageBytes>>;
      try { bytes = await imageBytes(new File([blob], "veiculo", { type: blob.type }), true); } catch (error) { throw vehiclePhotoFailure(error, "decode"); }
      const needsPublication = remote.source === "legacy" && auth.currentUser?.uid === identity.userId;
      const record: VehiclePhotoRecord = { ...makeRecord(identity, companyId, bytes), remoteUrl: remote.url, revision: remote.revision, remoteVersion: remote.version, remoteUpdatedAt: remote.updatedAt, updatedAt: remote.updatedAt || Date.now(), status: "synced", needsPublication, offlinePinned: true };
      try { await putVehiclePhotoRecord(record, local?.revision || null); } catch (error) { throw vehiclePhotoFailure(error, "cache"); }
      if (needsPublication) {
        try { await sync.sync(identity); } catch (error) { console.warn("[NVU] Foto recuperada; publicação pendente:", error); }
      }
      return await getVehiclePhotoRecord(identity);
    })();
    loading.set(key, task);
    try { return await task; } finally { loading.delete(key); }
  },
  async save(identity: VehiclePhotoIdentity, companyId: string, file: File): Promise<VehiclePhotoRecord> {
    if (auth.currentUser?.uid !== identity.userId || isAuthTeardownActive()) throw new Error("VEHICLE_PHOTO_SESSION_CHANGED");
    if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) throw new Error("Escolha uma imagem JPG, PNG ou WEBP de até 10 MB.");
    const record = makeRecord(identity, companyId, await imageBytes(file));
    if (auth.currentUser?.uid !== identity.userId || isAuthTeardownActive()) throw new Error("VEHICLE_PHOTO_SESSION_CHANGED");
    await putVehiclePhotoRecord(record); // Persist actual bytes BEFORE the network request.
    // Best-effort protection against browser storage eviction. Never block saving.
    void navigator.storage?.persist?.().catch(() => false);
    try { await sync.sync(record); }
    catch (error) { console.warn("[NVU] Foto salva no aparelho; envio pendente:", error); }
    return await getVehiclePhotoRecord(identity) || record;
  },
  sync: sync.sync,
  syncPending: sync.syncPending,
  startQueue,
};

if (typeof window !== "undefined") startQueue();
