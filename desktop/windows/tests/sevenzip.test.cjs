const test = require('node:test');
const assert = require('node:assert/strict');
const { nsisCapable7z } = require('../tools/sevenzip.cjs');
const bundled = async () => '/bundled/7za';

test('7-Zip para NSIS: Linux/macOS usa o 7za do electron-builder', async () => {
  assert.deepEqual(await nsisCapable7z({ platform: 'linux', env: {}, exists: () => false, bundled }), { path: '/bundled/7za', source: 'bundled-7za' });
});
test('7-Zip para NSIS: no Windows o 7za.exe embutido NÃO serve (sem o formato NSIS); usa o 7z.exe instalado', async () => {
  const exists = p => p === 'C:\\Program Files\\7-Zip\\7z.exe';
  const found = await nsisCapable7z({ platform: 'win32', env: { ProgramFiles: 'C:\\Program Files' }, exists, bundled });
  assert.equal(found.source, 'installed-7z'); assert.match(found.path, /7-Zip[\\/]7z\.exe$/);
});
test('7-Zip para NSIS: no Windows sem 7-Zip completo devolve null (o chamador declara "não verificado")', async () => {
  assert.equal(await nsisCapable7z({ platform: 'win32', env: { ProgramFiles: 'C:\\Program Files' }, exists: () => false, bundled }), null);
});
test('7-Zip para NSIS: NVU_7Z tem prioridade e só vale se o arquivo existe', async () => {
  assert.equal((await nsisCapable7z({ platform: 'win32', env: { NVU_7Z: 'D:\\tools\\7z.exe' }, exists: p => p === 'D:\\tools\\7z.exe', bundled })).source, 'NVU_7Z');
  assert.equal(await nsisCapable7z({ platform: 'win32', env: { NVU_7Z: 'D:\\missing\\7z.exe' }, exists: () => false, bundled }), null);
});
