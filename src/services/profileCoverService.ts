import imageCompression from "browser-image-compression";
import { localImageCompressionWorkerUrl } from "../lib/localImageCompressionWorker";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { isAuthTeardownActive } from "../lib/authLifecycle";
import { convertFileToBase64 } from "../lib/utils";
import { resolveProfileCover, type ProfileCoverMetadata, type ProfileCoverTarget } from "../lib/profileCover";
import { assertDecodable } from "./photoDecode";
import { downloadPhotoBlob } from "./photoDownload";
import { uploadService } from "./uploadService";
import { createProfileCoverSync } from "./profileCoverSync";
import { cacheRemoteProfileCover, getProfileCover, listPendingProfileCovers, PROFILE_COVER_CHANGED, profileCoverKey, putProfileCover, type ProfileCoverRecord } from "./profileCoverStore";

let generation = 0;
const currentUserId = () => isAuthTeardownActive() ? undefined : auth.currentUser?.uid;
const collection = (target: ProfileCoverTarget) => target.scope === "company" ? "frotas" : "users";
const sync = createProfileCoverSync({
  currentUserId, sessionGeneration: () => generation, online: () => navigator.onLine !== false,
  upload: async record => {
    const blob = await (await fetch(record.imageDataUrl)).blob();
    return uploadService.uploadImage({
      file: new File([blob], `capa-${record.revision}.webp`, { type: blob.type }),
      userId: record.viewerId, companyId: record.profileId,
      storageScope: "profile-cover", coverTarget: record, maxOutputBytes: 1_800_000,
    });
  },
  publish: (record, url) => updateDoc(doc(db, collection(record), record.profileId), {
    profileCoverURL: record.removed ? "" : url,
    profileCoverRevision: record.revision,
    profileCoverUpdatedAt: serverTimestamp(),
  }),
});

/** Global outbox: resume after reload, reconnect, foreground and auth restore. */
export function startProfileCoverSync(): () => void {
  let stopped = false, draining = false, rerun = false, delay = 5_000;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const drain = () => {
    const uid = currentUserId();
    if (stopped || !uid || navigator.onLine === false) return;
    if (draining) { rerun = true; return; }
    draining = true; clearTimeout(retry);
    void sync.syncPending(uid).catch(() => undefined).finally(async () => {
      draining = false;
      if (stopped) return;
      if (rerun) { rerun = false; drain(); return; }
      if (currentUserId() !== uid) return;
      const pending = await listPendingProfileCovers(uid).catch(() => []);
      if (stopped) return;
      if (!pending.length) { delay = 5_000; return; }
      retry = setTimeout(drain, delay); delay = Math.min(60_000, delay * 2);
    });
  };
  // Internal upload progress also changes the record. Only a new selection or
  // explicit retry schedules a new drain, avoiding a tight loop on denial.
  const requestDrain = () => { delay = 5_000; drain(); };
  const onVisible = () => { if (document.visibilityState === "visible") requestDrain(); };
  const offAuth = onAuthStateChanged(auth, () => { generation++; clearTimeout(retry); requestDrain(); });
  window.addEventListener("nvu:profile-cover-sync-request", requestDrain);
  window.addEventListener("online", requestDrain);
  window.addEventListener("focus", requestDrain);
  document.addEventListener("visibilitychange", onVisible);
  let removeNative: (() => void) | undefined;
  void import("@capacitor/app").then(({ App }) => App.addListener("appStateChange", state => { if (state.isActive) requestDrain(); }))
    .then(listener => { if (stopped) void listener.remove(); else removeNative = () => { void listener.remove(); }; }).catch(() => undefined);
  drain();
  return () => {
    stopped = true; generation++; clearTimeout(retry); offAuth(); removeNative?.();
    window.removeEventListener("nvu:profile-cover-sync-request", requestDrain);
    window.removeEventListener("online", requestDrain); window.removeEventListener("focus", requestDrain);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

export function retryProfileCoverSync() { window.dispatchEvent(new Event("nvu:profile-cover-sync-request")); }

export async function saveProfileCover(viewerId: string, target: ProfileCoverTarget, file: File | null): Promise<void> {
  const session = generation;
  if (currentUserId() !== viewerId || (target.scope === "driver" && target.profileId !== viewerId)) throw new Error("Sua sessão mudou. Abra o perfil novamente.");
  let imageDataUrl = "";
  if (file) {
    await assertDecodable(file);
    const image = await imageCompression(file, {
      maxWidthOrHeight: 1440, maxSizeMB: 0.6, fileType: "image/webp", useWebWorker: true,
      libURL: localImageCompressionWorkerUrl(),
    });
    if (image.size >= 1_800_000) throw new Error("Escolha uma imagem menor para a capa.");
    imageDataUrl = await convertFileToBase64(new File([image], "capa.webp", { type: image.type }));
  }
  if (currentUserId() !== viewerId || session !== generation) throw new Error("Sua sessão mudou. Abra o perfil novamente.");
  await putProfileCover({ ...target, viewerId, key: profileCoverKey(viewerId, target), revision: crypto.randomUUID(), updatedAt: Date.now(), imageDataUrl, remoteUrl: "", status: "pending", removed: !file });
  retryProfileCoverSync();
}

/** The same canonical document is subscribed by the owner and every viewer. */
export function observeProfileCover(target: ProfileCoverTarget, onChange: (cover: ProfileCoverMetadata) => void, onError: () => void) {
  return onSnapshot(doc(db, collection(target), target.profileId), { includeMetadataChanges: true }, snapshot => {
    // Never erase the last durable image using an unconfirmed memory-cache miss.
    if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
    if (snapshot.exists()) onChange(resolveProfileCover(snapshot.data()));
  }, onError);
}

const requests = new Map<string, string>();
export async function cacheProfileCover(viewerId: string, target: ProfileCoverTarget, remote: ProfileCoverMetadata): Promise<void> {
  const key = profileCoverKey(viewerId, target);
  const token = JSON.stringify(remote); requests.set(key, token);
  const isCurrent = () => requests.get(key) === token;
  const local = await getProfileCover(viewerId, target);
  if (!isCurrent() || local?.status === "pending" || navigator.onLine === false) return;
  if (local?.revision === remote.revision && local.remoteUrl === remote.url && (local.imageDataUrl || local.removed)) return;
  let imageDataUrl = "";
  if (remote.url) {
    const blob = await downloadPhotoBlob(remote.url);
    if (blob.size >= 1_800_000) throw new Error("Capa muito grande.");
    await assertDecodable(blob);
    imageDataUrl = await convertFileToBase64(new File([blob], "capa.webp", { type: blob.type || "image/webp" }));
  }
  await cacheRemoteProfileCover({ ...target, key, viewerId, revision: remote.revision || remote.url || "empty", updatedAt: Date.now(), imageDataUrl, remoteUrl: remote.url, status: "synced", removed: !remote.url }, isCurrent);
  if (isCurrent()) requests.delete(key);
}

// Re-export the event for consumers without coupling their state to Firebase.
export { PROFILE_COVER_CHANGED };
