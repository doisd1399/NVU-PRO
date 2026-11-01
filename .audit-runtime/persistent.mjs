// src/hooks/usePersistentRankingImage.ts
import { useEffect, useRef, useState } from "react";

// broken-idb:idb
var getRankingImage = () => Promise.reject(new Error("IndexedDB denied"));
var loadRankingImage = () => Promise.resolve(null);
var rankingImageKey = (i) => i.viewerId + ":" + i.assetId;
var readRankingImageMemory = () => null;
var RANKING_IMAGE_CHANGED = "audit-image-changed";

// src/services/vehiclePhotoErrors.ts
function vehiclePhotoErrorCode(failure, stage) {
  const error = failure;
  const values = [typeof error?.code === "string" ? error.code : "", error?.name || "", error?.message || ""];
  const explicit = values.find((value) => /^VEHICLE_PHOTO_[A-Z0-9_]+$/.test(value));
  if (explicit) return explicit;
  const raw = values.join(" ");
  const access = raw.match(/permission-denied|unauthenticated|unavailable|not-found/i);
  if (access) return access[0].toLowerCase();
  if (/abort|timeout|deadline-exceeded/i.test(raw)) return `VEHICLE_PHOTO_${stage.toUpperCase()}_TIMEOUT`;
  if (/failed to fetch|network|load failed/i.test(raw)) return `VEHICLE_PHOTO_${stage.toUpperCase()}_NETWORK`;
  if (/decode|decod|invalid image|compact/i.test(raw)) return "VEHICLE_PHOTO_DECODE_INVALID";
  if (/quota|indexeddb|storage/i.test(raw)) return "VEHICLE_PHOTO_CACHE_FAILED";
  return `VEHICLE_PHOTO_${stage.toUpperCase()}_FAILED`;
}

// src/hooks/usePersistentRankingImage.ts
function usePersistentRankingImage(remoteUrl, viewerId = "", assetId = "", enabled = true) {
  const identity = { viewerId, assetId }, key = viewerId && assetId ? rankingImageKey(identity) : "";
  const found = key ? readRankingImageMemory(identity) : null;
  const immediate = found?.remoteUrl === remoteUrl ? found : null;
  const [state, setState] = useState({ key, remoteUrl, src: immediate?.dataUrl || "" });
  const [activated, setActivated] = useState("");
  const [retry, setRetry] = useState(0);
  const repaired = useRef("");
  useEffect(() => {
    if (!key) return;
    let active = true;
    const apply = async (force = false) => {
      const local = await getRankingImage(identity).catch(() => null);
      if (active && local?.remoteUrl === remoteUrl) setState({ key, remoteUrl, src: local.dataUrl });
      if (!enabled && activated !== key || !active) return;
      try {
        const record = await loadRankingImage(identity, remoteUrl, force);
        if (active && record?.remoteUrl === remoteUrl) setState({ key, remoteUrl, src: record.dataUrl });
      } catch (failure) {
        const message = failure?.message || "";
        console.warn("[NVU] C\xF3pia offline de imagem do ranking:", {
          code: /^RANKING_IMAGE_[A-Z_]+$/.test(message) ? message : vehiclePhotoErrorCode(failure, "cache")
        });
      }
    };
    void apply(retry > 0);
    const onChange = (event) => {
      if (event.detail?.key === key) void getRankingImage(identity).then((local) => {
        if (active && local?.remoteUrl === remoteUrl) setState({ key, remoteUrl, src: local.dataUrl });
      }).catch(() => {
      });
    };
    const onOnline = () => void apply();
    window.addEventListener(RANKING_IMAGE_CHANGED, onChange);
    window.addEventListener("online", onOnline);
    return () => {
      active = false;
      window.removeEventListener(RANKING_IMAGE_CHANGED, onChange);
      window.removeEventListener("online", onOnline);
    };
  }, [key, remoteUrl, enabled, activated, retry]);
  const src = !remoteUrl ? "" : key ? (state.key === key && state.remoteUrl === remoteUrl ? state.src : immediate?.dataUrl || "") || remoteUrl : remoteUrl;
  return { src, onLoad: () => {
    if (key) setActivated(key);
  }, onError: () => {
    if (!key || !src.startsWith("data:") || navigator.onLine === false || repaired.current === key + src) return;
    repaired.current = key + src;
    setRetry((value) => value + 1);
  } };
}
export {
  usePersistentRankingImage
};
