import { useEffect, useRef, useState } from "react";
import { getRankingImage, loadRankingImage, rankingImageKey, readRankingImageMemory, RANKING_IMAGE_CHANGED } from "../services/rankingImageStore";
import { vehiclePhotoErrorCode } from "../services/vehiclePhotoErrors";

export function usePersistentRankingImage(remoteUrl: string, viewerId = "", assetId = "", enabled = true) {
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
      if ((!enabled && activated !== key) || !active) return;
      try {
        const record = await loadRankingImage(identity, remoteUrl, force);
        if (active && record?.remoteUrl === remoteUrl) setState({ key, remoteUrl, src: record.dataUrl });
      } catch (failure) {
        const message = (failure as Error)?.message || "";
        console.warn("[NVU] Cópia offline de imagem do ranking:", {
          code: /^RANKING_IMAGE_[A-Z_]+$/.test(message) ? message : vehiclePhotoErrorCode(failure, "cache"),
        });
        // A failed refresh preserves the last durable image.
      }
    };
    void apply(retry > 0);
    const onChange = (event: Event) => { if ((event as CustomEvent).detail?.key === key) void getRankingImage(identity).then((local) => { if (active && local?.remoteUrl === remoteUrl) setState({ key, remoteUrl, src: local.dataUrl }); }).catch(() => {}); };
    const onOnline = () => void apply();
    window.addEventListener(RANKING_IMAGE_CHANGED, onChange); window.addEventListener("online", onOnline);
    return () => { active = false; window.removeEventListener(RANKING_IMAGE_CHANGED, onChange); window.removeEventListener("online", onOnline); };
  }, [key, remoteUrl, enabled, activated, retry]);
  const src = !remoteUrl ? "" : key ? (state.key === key && state.remoteUrl === remoteUrl ? state.src : immediate?.dataUrl || "") || remoteUrl : remoteUrl;
  return { src, onLoad: () => { if (key) setActivated(key); }, onError: () => {
    if (!key || !src.startsWith("data:") || navigator.onLine === false || repaired.current === key + src) return;
    repaired.current = key + src; setRetry((value) => value + 1);
  } };
}
