import { VOICE_CATALOG } from './voiceCatalog';
const CACHE_NAME = 'nvu-voice-v2-approved';
let warmed = false;
let warming: Promise<void> | null = null;
const urlFor = (voice: string, cue: string) => `${import.meta.env.BASE_URL}audio/nvu/${voice}/${cue}.mp3`;
/** Static local assets only. No synthesis, remote provider, credentials or Firebase. */
export function warmVoiceAssets(): Promise<void> {
  if (warmed || typeof caches === 'undefined') return Promise.resolve();
  if (warming) return warming;
  warming = (async () => {
    const cache = await caches.open(CACHE_NAME);
    const urls = ['male', 'female'].flatMap(voice => Object.keys(VOICE_CATALOG).map(cue => urlFor(voice, cue)));
    let index = 0;
    await Promise.all(Array.from({ length: 3 }, async () => {
      for (;;) {
        const url = urls[index++]; if (!url) return;
        if (await cache.match(url)) continue;
        const response = await fetch(url, { credentials: 'same-origin', cache: 'force-cache' });
        if (response.ok && response.headers.get('content-type')?.includes('audio/')) await cache.put(url, response);
      }
    }));
    warmed = (await Promise.all(urls.map(url => cache.match(url)))).every(Boolean);
  })().catch(() => undefined).finally(() => { warming = null; });
  return warming;
}
export async function resolveVoiceAsset(voice: string, cue: string): Promise<{ url: string; release: () => void }> {
  const url = urlFor(voice, cue);
  try {
    if (typeof caches !== 'undefined') {
      const cached = await (await caches.open(CACHE_NAME)).match(url);
      if (cached) { const local = URL.createObjectURL(await cached.blob()); return { url: local, release: () => URL.revokeObjectURL(local) }; }
    }
  } catch { /* Browser storage can be denied or full. Android uses bundled assets. */ }
  return { url, release: () => {} };
}
