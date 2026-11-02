const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fingerprint, assertCopy, copyVerifiedFile } = require('../tools/verified-copy.cjs');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nvu-archive-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'complete.zip'), target = path.join(dir, 'delivery.zip');
  const bytes = Buffer.alloc(4097); for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  fs.writeFileSync(source, bytes); return { dir, source, target, bytes };
}
test('Publicação do ZIP copia os bytes completos e recusa destinos que não sejam arquivos', async t => {
  const f = fixture(t); await copyVerifiedFile(f.source, f.target);
  assert.deepEqual(fs.readFileSync(f.target), f.bytes);
  assert.deepEqual(fs.readFileSync(f.source), f.bytes);
  await assert.rejects(copyVerifiedFile(f.source, f.dir), /FILE_INVALID/);
});
test('Conferência final rejeita ZIP truncado e corrupção de mesmo tamanho', async t => {
  const f = fixture(t), expected = await fingerprint(f.source);
  fs.writeFileSync(f.target, f.bytes.subarray(0, -1));
  await assert.rejects(assertCopy(expected, f.target), /INCOMPLETE/);
  const changed = Buffer.from(f.bytes); changed[changed.length - 1] ^= 1; fs.writeFileSync(f.target, changed);
  await assert.rejects(assertCopy(expected, f.target), /HASH_MISMATCH/);
});
