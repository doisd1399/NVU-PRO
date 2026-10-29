import { onAuthTeardown } from "../lib/authLifecycle";
import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { rankingVehiclePhotoDocumentKey, vehiclePhotoKey, type VehiclePhotoIdentity } from "../lib/vehiclePhotoIdentity";
import { vehiclePhotoService } from "../services/vehiclePhotoService";
import { invalidateRemoteVehiclePhoto, readRemoteVehiclePhotoDetails } from "../services/vehiclePhotoRepository";
import { vehiclePhotoErrorCode } from "../services/vehiclePhotoErrors";
import { getVehiclePhotoRecord, readVehiclePhotoPoster, VEHICLE_PHOTO_CHANGED, type VehiclePhotoRecord } from "../services/vehiclePhotoStore";

const observedProjections = new Map<string, string>();
onAuthTeardown(() => observedProjections.clear());

export function useVehiclePhoto(identity: VehiclePhotoIdentity | null, companyId: string, synchronize = false) {
  const key = identity ? vehiclePhotoKey(identity) : "";
  const activeKey = useRef(key);
  activeKey.current = key;
  const repaired = useRef("");
  const poster = useMemo(() => identity ? readVehiclePhotoPoster(identity) : null, [key]);
  const [state, setState] = useState({ key, src: poster?.src || null, pending: poster?.pending || false });
  const [busyKey, setBusyKey] = useState("");
  const [remoteStatus, setRemoteStatus] = useState<{ key: string; value: "loading" | "ready" | "missing" | "error" } | null>(null);
  const [cacheStatus, setCacheStatus] = useState<{ key: string; value: "loading" | "ready" | "error" } | null>(null);
  const [imageStatus, setImageStatus] = useState<{ key: string; value: "ready" | "error" } | null>(null);
  const [remoteErrorCode, setRemoteErrorCode] = useState<{ key: string; code: string } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);

  useEffect(() => {
    if (!identity) return;
    let cancelled = false, localSequence = 0, remoteSequence = 0, localFound = false;
    setRemoteStatus({ key, value: "loading" });
    setCacheStatus({ key, value: "loading" });
    setRemoteErrorCode(null);
    const commit = (record: VehiclePhotoRecord) => {
      if (cancelled) return;
      localFound = true;
      setState({ key, src: record.imageDataUrl, pending: record.status === "pending" || Boolean(record.needsPublication) });
      setCacheStatus({ key, value: "ready" });
    };
    const applyLocal = async () => {
      const sequence = ++localSequence;
      try {
        const record = await getVehiclePhotoRecord(identity);
        if (!cancelled && sequence === localSequence && record) commit(record);
      } catch (failure) {
        if (!cancelled) setCacheStatus({ key, value: "error" });
      }
    };
    const localReady = applyLocal();
    const applyRemote = async () => {
      const sequence = ++remoteSequence;
      const active = () => !cancelled && sequence === remoteSequence;
      if (navigator.onLine === false) {
        await localReady;
        if (active()) {
          setRemoteStatus({ key, value: "error" });
          if (!localFound) setRemoteErrorCode({ key, code: "VEHICLE_PHOTO_OFFLINE_COPY_MISSING" });
        }
        return;
      }
      try {
        const remote = await readRemoteVehiclePhotoDetails(db, identity, auth.currentUser?.uid);
        if (!active()) return;
        if (!remote) { setRemoteStatus({ key, value: "missing" }); setRemoteErrorCode(null); return; }
        await localReady;
        if (!active()) return;
        // Local bytes win the race; a cold URL can render while persistence runs.
        setState((current) => current.key === key && current.src?.startsWith("data:image/")
          ? current : { key, src: remote.url, pending: current.key === key && current.pending });
        setRemoteStatus({ key, value: "ready" });
        try {
          const record = await vehiclePhotoService.load(identity, companyId, remote);
          if (!active()) return;
          if (record) commit(record);
          setRemoteErrorCode(null);
        } catch (failure) {
          if (!active()) return;
          console.warn("[NVU] Cópia offline da foto:", {
            code: vehiclePhotoErrorCode(failure, "cache"),
            stage: (failure as { stage?: string })?.stage || "cache",
          });
          // Query/download/cache errors do not invalidate a displayed local photo.
          setCacheStatus({ key, value: "error" });
          setRemoteErrorCode({ key, code: vehiclePhotoErrorCode(failure, "cache") });
        }
      } catch (failure) {
        if (!active()) return;
        setRemoteStatus({ key, value: "error" });
        setRemoteErrorCode({ key, code: vehiclePhotoErrorCode(failure, "metadata") });
      }
    };
    void applyRemote();
    const onChange = (event: Event) => { if ((event as CustomEvent).detail?.key === key) void applyLocal(); };
    const onOnline = () => { invalidateRemoteVehiclePhoto(db, identity); void applyRemote(); };
    window.addEventListener(VEHICLE_PHOTO_CHANGED, onChange);
    window.addEventListener("online", onOnline);
    // Only the visible third-party modal subscribes, not every prefetch row.
    // A new publication invalidates a prior negative lookup immediately.
    const projectionKey = `${auth.currentUser?.uid || ""}:${key}`;
    let lastProjection = observedProjections.get(projectionKey) || "";
    const stopProjection = !synchronize && auth.currentUser ? onSnapshot(
      doc(db, "rankingVehiclePhotos", rankingVehiclePhotoDocumentKey(identity)),
      (snapshot) => {
        if (cancelled || snapshot.metadata.fromCache || navigator.onLine === false) return;
        const data = snapshot.data();
        const version = JSON.stringify([data?.url || "", data?.revision || "", data?.updatedAt || ""]);
        // The first server snapshot may already contain a photo which was
        // absent from an earlier cached getDoc. Refresh on that first positive
        // publication as well as on subsequent changes; never treat a cached
        // missing document as authoritative.
        if (lastProjection !== version && data?.url) {
          invalidateRemoteVehiclePhoto(db, identity);
          void applyRemote();
        }
        lastProjection = version;
        observedProjections.delete(projectionKey); observedProjections.set(projectionKey, version);
        if (observedProjections.size > 128) observedProjections.delete(observedProjections.keys().next().value);
      },
      () => { /* Initial getDoc reports an actionable error without a hot listener. */ },
    ) : () => {};

    let authUid = auth.currentUser?.uid || "";
    const stopAuth = onAuthStateChanged(auth, (user) => {
      const nextUid = user?.uid || "";
      if (nextUid !== authUid && nextUid) void applyRemote();
      authUid = nextUid;
      if (synchronize && user?.uid === identity.userId) void vehiclePhotoService.syncPending(user.uid).catch(() => undefined);
    });
    if (synchronize && auth.currentUser?.uid === identity.userId) void vehiclePhotoService.syncPending(identity.userId).catch(() => undefined);
    return () => {
      cancelled = true;
      stopAuth();
      stopProjection();
      window.removeEventListener(VEHICLE_PHOTO_CHANGED, onChange);
      window.removeEventListener("online", onOnline);
    };
  }, [key, companyId, synchronize]);

  async function save(file: File) {
    if (!identity) return;
    setBusyKey(key);
    setError(null);
    let preview = "";
    try {
      preview = URL.createObjectURL(file);
      setState({ key, src: preview, pending: true });
      const record = await vehiclePhotoService.save(identity, companyId, file);
      setState({ key, src: record.imageDataUrl, pending: record.status === "pending" || Boolean(record.needsPublication) });
      setCacheStatus({ key, value: "ready" });
    } catch (failure) {
      const previous = await getVehiclePhotoRecord(identity).catch(() => null);
      setState({ key, src: previous?.imageDataUrl || null, pending: previous?.status === "pending" || Boolean(previous?.needsPublication) });
      setError({ key, message: failure instanceof Error ? failure.message : "Não foi possível salvar a foto." });
    } finally {
      if (preview) URL.revokeObjectURL(preview);
      setBusyKey((current) => current === key ? "" : current);
    }
  }
  return {
    src: state.key === key ? state.src : poster?.src || null,
    pending: state.key === key ? state.pending : poster?.pending || false,
    remoteStatus: remoteStatus?.key === key ? remoteStatus.value : (identity ? "loading" : "missing"),
    remoteErrorCode: remoteErrorCode?.key === key ? remoteErrorCode.code : null,
    cacheStatus: cacheStatus?.key === key ? cacheStatus.value : "loading",
    imageStatus: imageStatus?.key === key ? imageStatus.value : "loading",
    onImageLoad: () => setImageStatus({ key, value: "ready" }),
    onImageError: () => {
      setImageStatus({ key, value: "error" });
      const attempt = key + ":" + state.src;
      if (!identity || !state.src?.startsWith("data:image/") || state.pending || repaired.current === attempt || navigator.onLine === false) return;
      repaired.current = attempt;
      invalidateRemoteVehiclePhoto(db, identity);
      void vehiclePhotoService.load(identity, companyId, undefined, true).then((record) => {
        if (record && activeKey.current === key && record.imageDataUrl !== state.src) {
          setState({ key, src: record.imageDataUrl, pending: record.status === "pending" || Boolean(record.needsPublication) });
          setCacheStatus({ key, value: "ready" }); setRemoteErrorCode(null);
        }
      }).catch((failure) => { if (activeKey.current === key) setRemoteErrorCode({ key, code: vehiclePhotoErrorCode(failure, "cache") }); });
    },
    busy: busyKey === key && Boolean(key), error: error?.key === key ? error.message : null, save,
  };
}

export type VehiclePhotoController = ReturnType<typeof useVehiclePhoto>;
