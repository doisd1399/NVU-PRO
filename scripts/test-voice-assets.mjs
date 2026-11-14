import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root = path.resolve(import.meta.dirname, '..');
const dir = path.join(root, 'public/audio/nvu');
const catalog = JSON.parse(fs.readFileSync(path.join(dir, 'catalog.json')));
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json')));
assert.equal(catalog.clips.length, 27); assert.equal(manifest.clips.length, 54); assert.deepEqual(manifest.failures, []);
assert.equal(catalog.clips.filter(c => c.kind === 'greeting' && c.role === 'driver').length, 5);
assert.equal(catalog.clips.filter(c => c.kind === 'greeting' && c.role === 'admin').length, 5);
for (const gender of ['male', 'female']) for (const cue of catalog.clips) {
  const expected = manifest.clips.find(row => row.id === cue.id && row.voice === gender);
  assert(expected, gender + ':' + cue.id + ' is missing');
  assert.equal(expected.path, `${gender}/${cue.id}.mp3`); assert.equal(expected.text, cue.text);
  const bytes = fs.readFileSync(path.join(dir, expected.path));
  assert(bytes.length >= 1024, 'empty clip'); assert.equal(bytes.length, expected.sizeBytes);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), expected.sha256);
  assert(expected.durationSeconds >= .4 && expected.durationSeconds < 8, 'unexpected duration');
}
const native = fs.readFileSync(path.join(root, 'android/app/src/main/java/com/nvu/operacional/NvuVoicePlayback.java'), 'utf8');
for (const cue of catalog.clips) assert(native.includes(`"${cue.id}"`), 'cue is missing from the native whitelist: ' + cue.id);
console.log('VOICE_ASSETS_PASS: 54 local MP3, two approved voices, 5 greetings per role, hashes, durations and native catalog parity.');
