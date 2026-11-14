import { preloadImage, type ImagePreloadPriority } from "../lib/imageCache";
import { getRankingImage, loadRankingImage } from "./rankingImageStore";

export async function preloadRankingImages(
  items: { id: string; logo?: string }[], viewerId: string, assetType: "driver" | "company",
  concurrency = 2, priority: ImagePreloadPriority = "auto",
): Promise<void> {
  if (!viewerId) return;
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      if (!item?.id || !item.logo) continue;
      const identity = { viewerId, assetId: `${assetType}:${item.id}` };
      const local = await getRankingImage(identity);
      if (local) {
        await preloadImage(local.dataUrl, priority);
        // Refresh changed URLs without replacing a valid first paint.
        if (local.remoteUrl !== item.logo && navigator.onLine !== false) void loadRankingImage(identity, item.logo).catch(() => undefined);
        continue;
      }
      if (navigator.onLine === false) continue;
      try {
        const record = await loadRankingImage(identity, item.logo);
        await preloadImage(record?.dataUrl || item.logo, priority);
      } catch { await preloadImage(item.logo, priority); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(concurrency, 1), items.length) }, worker));
}
