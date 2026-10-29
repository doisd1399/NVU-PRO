import { useEffect, useState } from "react";
import { resolveProfileCoverSource, type ProfileCoverMetadata, type ProfileCoverTarget } from "../lib/profileCover";
import { cacheProfileCover, observeProfileCover, retryProfileCoverSync } from "../services/profileCoverService";
import { getProfileCover, profileCoverKey, PROFILE_COVER_CHANGED, readProfileCoverMemory, type ProfileCoverRecord } from "../services/profileCoverStore";

export function useProfileCover(viewerId: string, target: ProfileCoverTarget, known: ProfileCoverMetadata) {
  const key = profileCoverKey(viewerId, target);
  const [local, setLocal] = useState<ProfileCoverRecord | null>(() => readProfileCoverMemory(viewerId, target));
  const [remote, setRemote] = useState({ key, ...known });
  useEffect(() => {
    if (!viewerId || !target.profileId) return;
    let active = true;
    setLocal(readProfileCoverMemory(viewerId, target));
    setRemote({ key, ...known });
    const hydrate = () => void getProfileCover(viewerId, target).then(record => { if (active) setLocal(record); }).catch(() => undefined);
    const refresh = (cover: ProfileCoverMetadata) => {
      if (!active) return;
      setRemote({ key, ...cover });
      void cacheProfileCover(viewerId, target, cover).catch(() => undefined);
    };
    hydrate();
    // A cached URL can warm bytes before the first server snapshot, but an
    // absent URL in old user/company caches cannot erase a confirmed cover.
    if (known.url) refresh(known);
    const changed = (event: Event) => { if ((event as CustomEvent).detail?.key === key) hydrate(); };
    const online = () => { const cover = latestRemote; if (cover.url || cover.revision) refresh(cover); retryProfileCoverSync(); };
    let latestRemote = known;
    const stop = observeProfileCover(target, cover => { latestRemote = cover; refresh(cover); }, () => { /* Keep last local/remote identity on read failure. */ });
    window.addEventListener(PROFILE_COVER_CHANGED, changed); window.addEventListener("online", online);
    return () => { active = false; stop(); window.removeEventListener(PROFILE_COVER_CHANGED, changed); window.removeEventListener("online", online); };
  }, [key, known.url, known.revision]);
  const record = local?.key === key ? local : readProfileCoverMemory(viewerId, target);
  const canonical = remote.key === key ? remote : known;
  const src = resolveProfileCoverSource(record, canonical.url);
  return { src, pending: record?.status === "pending", failed: Boolean(record?.failure), retry: retryProfileCoverSync };
}
