import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { CachedImage } from "../../src/components/common/CachedImage";
import { StableImage } from "../../src/components/common/StableImage";
import * as store from "../../src/services/displayImageStore";
import { prepareTripReceipt } from "../../src/lib/prepareTripReceipt";
import { getProfileCover, putProfileCover, profileCoverKey } from "../../src/services/profileCoverStore";
import { useProfileCover } from "../../src/hooks/useProfileCover";

const qa = (window as any).qa520 = { ...store, prepareTripReceipt, ready: false, compression: null, coverAtMount: "" };
store.activateDisplayViewer("viewer-A");
await store.hydrateDisplayImages("viewer-A");
await getProfileCover("viewer-A", { scope: "driver", profileId: "driver-A" });
function Cover() {
  const cover = useProfileCover("viewer-A", { scope: "driver", profileId: "driver-A" }, { url: "", revision: "" });
  qa.coverAtMount = cover.src;
  return <CachedImage data-testid="cover" src={cover.src} width={200} height={80}/>;
}
function Fixture() {
  const [url, setUrl] = useState("https://images.example.test/avatar-A.png");
  const [mounted, setMounted] = useState(true);
  const [cover, setCover] = useState(false);
  const [ranking, setRanking] = useState(false);
  qa.setUrl = setUrl; qa.mount = setMounted; qa.cover = setCover; qa.ranking = setRanking;
  qa.seedCover = async (dataUrl: string) => {
    const target = { scope: "driver" as const, profileId: "driver-A" };
    await putProfileCover({ ...target, viewerId: "viewer-A", key: profileCoverKey("viewer-A", target), revision: "r1", updatedAt: Date.now(), imageDataUrl: dataUrl, remoteUrl: "https://images.example.test/banner-A.png", status: "synced" });
  };
  return <>{mounted && <CachedImage data-testid="avatar" src={url} width={150} height={150}/>}
    {ranking && <StableImage src={url} persistentViewerId="viewer-A" persistentAssetId="same-driver" wrapperClassName="avatar" fallback={<span>Fallback</span>}/>}
    {cover && <Cover/>}</>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
qa.ready = true;
