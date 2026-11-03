const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createWorld, pkg } = require('./helpers/fake-main.cjs');

const sandbox = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nvu-runtime-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const directive = (policy, name) => (policy.split(';').map(part => part.trim()).find(part => part.startsWith(`${name} `)) || '').split(/\s+/).slice(1);

test('Política de segurança da interface: lê fotos guardadas no aparelho (data:/blob:) para enviá-las, sem abrir a rede nem scripts', async t => {
  const dir = sandbox(t), resources = path.join(dir, 'resources');
  fs.mkdirSync(path.join(resources, 'web'), { recursive: true }); fs.mkdirSync(path.join(resources, 'plugin'), { recursive: true });
  fs.writeFileSync(path.join(resources, 'web/index.html'), '<html><script>1</script></html>');
  fs.copyFileSync(path.join(__dirname, '../plugin/bin/nvu_scs_telemetry.dll'), path.join(resources, 'plugin/nvu_scs_telemetry.dll'));
  const w = createWorld(dir, { process: { resourcesPath: resources } });
  w.app.isPackaged = true;
  let serve; w.electron.protocol.handle = (scheme, handler) => { if (scheme === 'nvu') serve = handler; };
  w.electron.net.fetch = async () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
  w.start(); await w.settle(); assert.equal(typeof serve, 'function');
  const response = await serve({ url: 'nvu://app/', method: 'GET' });
  const policy = response.headers.get('content-security-policy'), connect = directive(policy, 'connect-src');
  // O envio da foto do veículo e da capa faz fetch() do arquivo guardado em data:/blob:. Sem isto a foto ficava "pendente" para sempre.
  assert(connect.includes('data:') && connect.includes('blob:'), `connect-src: ${connect.join(' ')}`);
  for (const host of ['https://*.googleapis.com', 'https://*.googleusercontent.com', 'https://res.cloudinary.com', 'https://*.cloudfunctions.net', 'https://*.run.app']) assert(connect.includes(host), host);
  for (const broad of ['*', 'https:', 'http:', 'ws:', 'wss:']) assert.equal(connect.includes(broad), false, `connect-src não pode abrir ${broad}`);
  assert.deepEqual(directive(policy, 'default-src'), ["'self'"]); assert.deepEqual(directive(policy, 'object-src'), ["'none'"]);
  const scripts = directive(policy, 'script-src');
  assert(!scripts.includes("'unsafe-eval'") && !scripts.includes("'unsafe-inline'"), `script-src: ${scripts.join(' ')}`);   // 'wasm-unsafe-eval' (OCR) é outra coisa
  assert(directive(policy, 'img-src').includes('blob:') && directive(policy, 'img-src').includes('data:'));
  assert.equal(directive(policy, 'script-src').includes('data:') || directive(policy, 'script-src').includes('blob:'), false, 'scripts nunca vêm de data:/blob:');
  assert.equal((await serve({ url: 'nvu://outro/', method: 'GET' })).status, 403);
});

test('Confirmação da entrega pela interface: o registro mostra o estado e o tempo desde a entrega no jogo', async t => {
  const dir = sandbox(t), w = createWorld(dir), token = 'a'.repeat(64);
  const game = path.join(dir, 'ATS'); fs.mkdirSync(path.join(game, 'bin/win_x64'), { recursive: true }); fs.writeFileSync(path.join(game, 'bin/win_x64/amtrucks.exe'), 'MZ-QA');
  fs.writeFileSync(path.join(w.user, 'games.json'), JSON.stringify({ version: 1, games: { ats: game } }));
  const scope = { driverId: 'qa-driver', companyId: 'qa-company', jobId: 'qa-job', contractId: 'qa-contract', simulatorKey: 'ats', total: 6, progress: 0 };
  w.start(); await w.settle();
  const main = w.windows[0], event = { sender: main.webContents, senderFrame: main.webContents.mainFrame };
  const invoke = (method, input) => w.handlers.get('nvu:windows')(event, { method, input });
  await invoke('syncScope', scope); await invoke('installPlugin', { key: 'ats', root: game }); await invoke('start', scope);
  const bridge = path.join(w.local, 'NVU/pro-telemetry'), bridgeToken = fs.readFileSync(path.join(bridge, 'bridge.token'), 'utf8'), bootId = randomUUID(), id = randomUUID();
  const packet = (extra = {}) => ({ version: 1, token: bridgeToken, simulatorKey: 'ats', bootId, sequence: 1, at: Date.now(), paused: false, online: true, jobId: id, jobState: 'active', pluginVersion: pkg.nvu.pluginVersion, origin: 'QA origem', destination: 'QA destino', ...extra });
  fs.writeFileSync(path.join(bridge, 'ats.heartbeat.json'), JSON.stringify(packet()));
  const poll = w.timers.find(timer => timer.ms === 1000).fn; await poll();
  const capturedAt = Date.now() - 4000;
  fs.writeFileSync(path.join(bridge, `ats-${id}.delivery.json`), JSON.stringify({ version: 1, token: bridgeToken, simulatorKey: 'ats', type: 'job.delivered', eventId: id, capturedAt, origin: 'QA origem', destination: 'QA destino', amountCents: 10000, currency: 'USD', distanceKm: 12 }));
  await poll();
  const row = (await invoke('status')).pending[0]; assert(row, 'a entrega ficou pendente');
  await invoke('acknowledge', { id: row.id, state: 'QUEUED', tripId: 'trip-qa', message: 'Viagem salva.' });
  await invoke('acknowledge', { id: row.id, state: 'CONFIRMED', tripId: 'trip-qa', serverValidated: true });
  const lines = fs.readFileSync(path.join(w.user, 'logs/nvu.log'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(line => line.event === 'delivery.ack');
  assert.deepEqual(lines.map(line => [line.state, line.serverValidated]), [['QUEUED', false], ['CONFIRMED', true]]);
  assert(lines.every(line => Number.isFinite(line.ageMs) && line.ageMs >= 4000 && line.ageMs < 60000), JSON.stringify(lines));
  assert.equal(JSON.stringify(lines).includes('trip-qa'), false, 'o registro não guarda identificadores da viagem');
  w.app.emit('before-quit');
});

test('Sessão do Firebase no Windows é guardada no disco (como no Android): sem isso o aplicativo não abre offline', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../../src/lib/firebase.ts'), 'utf8');
  const call = /setPersistence\(\s*auth,\s*([\s\S]*?)\)\s*\.then/.exec(source);
  assert(call, 'setPersistence(auth, …) não encontrado');
  assert.equal(call[1].trim().replace(/,$/, ''), 'browserLocalPersistence', 'a persistência não pode depender da plataforma');
  assert.equal(/inMemoryPersistence/.test(source), false);
});
