import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nvu-voice-offline-'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/audio/nvu/manifest.json')));
const previous = { caches: globalThis.caches, fetch: globalThis.fetch };
const entries = new Map(); let downloads = 0;
globalThis.caches = { open: async () => ({
  match: async url => entries.get(url)?.clone(),
  put: async (url, response) => { entries.set(url, response.clone()); },
}) };
globalThis.fetch = async url => {
  assert(String(url).startsWith('/audio/nvu/'), 'only same-origin bundled MP3 may be fetched');
  downloads++;
  return new Response(fs.readFileSync(path.join(root, 'public', String(url))), { headers: { 'content-type': 'audio/mpeg' } });
};
try {
  const bundle = path.join(temp, 'cache.mjs');
  await build({ entryPoints: [path.join(root, 'src/lib/voiceAssetCache.ts')], bundle: true,
    format: 'esm', platform: 'node', outfile: bundle, define: { 'import.meta.env.BASE_URL': '"/"' } });
  const cache = await import(pathToFileURL(bundle).href);
  await Promise.all([cache.warmVoiceAssets(), cache.warmVoiceAssets()]);
  assert.equal(downloads, 98); assert.equal(entries.size, 98);
  globalThis.fetch = async () => { throw Error('offline'); };
  for (const clip of manifest.clips) {
    const asset = await cache.resolveVoiceAsset(clip.voice, clip.id);
    assert(asset.url.startsWith('blob:'), 'cached audio must resolve offline');
    const bytes = Buffer.from(await (await previous.fetch(asset.url)).arrayBuffer());
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), clip.sha256);
    asset.release();
    await assert.rejects(previous.fetch(asset.url), 'object URL must be released');
  }
  await cache.warmVoiceAssets(); assert.equal(downloads, 98);
  globalThis.caches = { open: async () => { throw Error('storage denied'); } };
  const fallback = await cache.resolveVoiceAsset('male', 'event_trip_saved');
  assert.equal(fallback.url, '/audio/nvu/male/event_trip_saved.mp3'); fallback.release();
  console.log('VOICE_OFFLINE_PASS: 98 cached MP3 match SHA-256 offline; concurrent warming, URL cleanup and denied-storage fallback verified.');
} finally {
  globalThis.caches = previous.caches; globalThis.fetch = previous.fetch;
  fs.rmSync(temp, { recursive: true, force: true });
}
