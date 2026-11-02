const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { GoogleAuth } = require('../core/google-auth.cjs');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nvu-auth-')); t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); delete globalThis.__realFetch; });
  const vault = path.join(dir, 'google-session.enc'); fs.writeFileSync(vault, Buffer.from('encrypted-refresh-token'));
  const safeStorage = { isEncryptionAvailable: () => true, decryptString: () => 'refresh-token', encryptString: v => Buffer.from(v) };
  const auth = new GoogleAuth({ config: { clientId: 'qa.apps.googleusercontent.com' }, vault, safeStorage, openExternal: async () => {} });
  const real = globalThis.fetch; t.after(() => { globalThis.fetch = real; });
  return { auth, vault, answer: handler => { globalThis.fetch = async (...args) => handler(...args); } };
}
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('Sessão do Google restaurada: credencial revogada é identificada e removida; rede e indisponibilidade preservam a sessão salva', async t => {
  const f = fixture(t);
  f.answer(async () => json(400, { error: 'invalid_grant' }));
  await assert.rejects(f.auth.restore(), e => e.code === 'GOOGLE_TOKEN_REVOKED' && /^GOOGLE_TOKEN_REVOKED: /.test(e.message));
  assert.equal(fs.existsSync(f.vault), false, 'credencial morta removida');
  fs.writeFileSync(f.vault, Buffer.from('x'));
  f.answer(async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(f.auth.restore(), e => e.code === 'GOOGLE_NETWORK'); assert.equal(fs.existsSync(f.vault), true, 'sem rede a sessão salva continua');
  f.answer(async () => json(503, {})); await assert.rejects(f.auth.restore(), e => e.code === 'GOOGLE_UNAVAILABLE'); assert.equal(fs.existsSync(f.vault), true);
  f.answer(async () => json(401, { error: 'invalid_client' })); await assert.rejects(f.auth.restore(), e => e.code === 'GOOGLE_CLIENT_INVALID'); assert.equal(fs.existsSync(f.vault), true);
  f.answer(async () => json(400, { error: 'something_else' })); await assert.rejects(f.auth.restore(), e => e.code === 'GOOGLE_TOKEN_EXCHANGE_FAILED');
});
test('Sem credencial salva a restauração é silenciosa; cofre do Windows indisponível tem código próprio', async t => {
  const f = fixture(t); fs.rmSync(f.vault); assert.equal(await f.auth.restore(), null);
  fs.writeFileSync(f.vault, 'x'); f.auth.safeStorage = { isEncryptionAvailable: () => false };
  await assert.rejects(f.auth.restore(), /WINDOWS_CREDENTIAL_STORAGE_UNAVAILABLE/);
});
