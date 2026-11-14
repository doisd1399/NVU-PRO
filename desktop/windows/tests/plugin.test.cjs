const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { Session } = require('../core/session.cjs');
const { Integration } = require('../core/integration.cjs');
const { installPlugin, removePlugin, inspectPlugin, pluginPaths } = require('../core/plugin-install.cjs');
const { prepareSimulator, removeSimulatorPlugin } = require('../core/prepare.cjs');
const { encodeRequest, decodeRequest, runElevatedPlugin, EXIT, messageFor } = require('../core/elevated-plugin.cjs');
const { NvuError } = require('../core/errors.cjs');

const VERSION = '0.2.0', sha = b => createHash('sha256').update(b).digest('hex');
const logger = { info() {}, warn() {}, error() {} };
function fixture(t, { key = 'ats' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nvu-plugin-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const exe = key === 'ats' ? 'amtrucks.exe' : 'eurotrucks2.exe', game = path.join(dir, key.toUpperCase());
  fs.mkdirSync(path.join(game, 'bin/win_x64'), { recursive: true }); fs.writeFileSync(path.join(game, 'bin/win_x64', exe), 'MZ');
  const pluginDir = path.join(dir, 'package'); fs.mkdirSync(pluginDir);
  const dll = path.join(pluginDir, 'nvu_scs_telemetry.dll'), bytes = Buffer.concat([Buffer.from('MZ'), Buffer.from('plugin-' + VERSION)]);
  fs.writeFileSync(dll, bytes); fs.writeFileSync(path.join(pluginDir, 'nvu_scs_telemetry.manifest.json'), JSON.stringify({ version: VERSION, sha256: sha(bytes), bytes: bytes.length }));
  let time = Date.now(); const now = () => time, session = new Session(path.join(dir, 'journal.json'), now);
  let running = []; const integration = new Integration({ file: path.join(dir, 'games.json'), dll, roots: [], documents: dir, version: VERSION, now, processes: async () => running });
  integration.remember({ key, root: game });
  const bootId = randomUUID();
  const beat = (extra = {}) => session.heartbeat({ version: 1, simulatorKey: key, bootId, sequence: (beat.n = (beat.n || 0) + 1), at: now(), paused: false, online: true, pluginVersion: VERSION, ...extra });
  return { dir, key, game, dll, bytes, pluginDir, session, integration, bootId, beat, now, tick: ms => { time += ms; }, setRunning: v => { running = v; },
    deps: (extra = {}) => ({ integration, store: session, dll, version: VERSION, logger, install: installPlugin, remove: removePlugin, elevate: async () => ({ ok: false, exitCode: 1, declined: false }), messageFor, ...extra }),
    status: () => integration.status(key, session) };
}

test('Estados do plugin: ausente → preparado → aguardando carga → conectado, pausado e desconectado, sempre com as três versões separadas', async t => {
  const f = fixture(t); f.setRunning([]); await f.integration.refreshProcesses(true);
  let s = f.status(); assert.equal(s.state, 'absent'); assert.equal(s.versions.expected, VERSION); assert.equal(s.versions.installed, null); assert.equal(s.versions.loaded, null);
  const r = await prepareSimulator({ key: 'ats' }, f.deps());
  assert.equal(r.ok, true); assert.equal(r.restartRequired, true);
  s = f.status(); assert.equal(s.state, 'ready_to_open'); assert.equal(s.versions.installed, VERSION); assert.equal(s.versions.loaded, null, 'arquivo no disco não significa plugin carregado');
  f.setRunning([{ key: 'ats', startedAt: new Date(f.now() + 5000).toISOString() }]); await f.integration.refreshProcesses(true);
  assert.equal(f.status().state, 'waiting_load');
  f.beat(); s = f.status(); assert.equal(s.state, 'connected'); assert.equal(s.loaded.compatible, true); assert.equal(s.versions.loaded, VERSION);
  f.tick(50); f.beat({ paused: true }); assert.equal(f.status().state, 'paused');
  f.tick(6000); s = f.status(); assert.equal(s.state, 'disconnected'); assert.equal(s.loaded.compatible, true, 'o plugin continua carregado; só a comunicação parou');
  f.setRunning([]); await f.integration.refreshProcesses(true); f.session.heartbeats.ats = undefined; delete f.session.heartbeats.ats;
  assert.equal(f.status().loaded, null, 'jogo fechado: nada carregado'); assert.equal(f.status().state, 'ready_to_open');
});
test('Plugin no disco, jogo aberto ANTES da instalação: instalado aguardando reinício (e não "carregado")', async t => {
  const f = fixture(t);
  f.setRunning([{ key: 'ats', startedAt: new Date(f.now() - 60000).toISOString() }]); await f.integration.refreshProcesses(true);
  fs.mkdirSync(path.join(f.game, 'bin/win_x64/plugins'), { recursive: true });
  installPlugin({ root: f.game, key: 'ats', dll: f.dll, expectedSha256: sha(f.bytes), version: VERSION, now: () => new Date(f.now()) });
  const s = f.status(); assert.equal(s.state, 'restart_required'); assert.equal(s.code, 'NVU-P090'); assert.match(s.message, /jogo foi aberto antes/);
  // A game that loaded an OLD plugin keeps that version visible even though the file on disk is already new.
  f.beat({ pluginVersion: '0.1.3' }); const old = f.status(); assert.equal(old.state, 'restart_required'); assert.equal(old.versions.loaded, '0.1.3'); assert.equal(old.versions.installed, VERSION); assert.match(old.message, /ainda usa o plugin 0\.1\.3/);
  f.tick(100); f.beat({ pluginVersion: VERSION }); assert.equal(f.status().state, 'connected');
});
test('Jogo aberto há mais de um minuto sem o plugin esperado é "não carregou", com código e orientação', async t => {
  const f = fixture(t); await prepareSimulator({ key: 'ats' }, f.deps());
  f.setRunning([{ key: 'ats', startedAt: new Date(f.now() + 1).toISOString() }]); await f.integration.refreshProcesses(true);
  f.tick(61000); const s = f.status(); assert.equal(s.state, 'not_loaded'); assert.equal(s.code, 'NVU-P090'); assert.match(s.message, /aviso de plugin da SCS/);
});
test('Plugin desatualizado e plugin de terceiros: estados distintos; terceiros nunca são sobrescritos; byte-idêntico sem recibo é adotado', async t => {
  const f = fixture(t); const dir = path.join(f.game, 'bin/win_x64/plugins'); fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, 'nvu_scs_telemetry.dll'), other = path.join(dir, 'outro.dll'); fs.writeFileSync(other, 'terceiro');
  fs.writeFileSync(target, 'MZ-versão-antiga'); fs.writeFileSync(target + '.nvu.json', JSON.stringify({ product: 'NVU', version: '0.1.3', sha256: sha(fs.readFileSync(target)), installedAt: new Date().toISOString() }));
  assert.equal(f.status().state, 'outdated'); assert.equal(f.status().versions.installed, '0.1.3');
  assert.equal((await prepareSimulator({ key: 'ats' }, f.deps())).ok, true); assert.equal(f.status().state, 'ready_to_open');
  assert.equal(fs.readFileSync(other, 'utf8'), 'terceiro');
  fs.rmSync(target + '.nvu.json'); fs.writeFileSync(target, 'MZ-binário-desconhecido'); f.integration.cache.clear();
  assert.equal(f.status().state, 'foreign');
  const blocked = await prepareSimulator({ key: 'ats' }, f.deps()); assert.equal(blocked.ok, false); assert.equal(blocked.code, 'NVU-P030'); assert.equal(fs.readFileSync(target, 'utf8'), 'MZ-binário-desconhecido');
  fs.writeFileSync(target, f.bytes); f.integration.cache.clear();   // a copy made by hand, identical to ours
  assert.equal((await prepareSimulator({ key: 'ats' }, f.deps())).ok, true); assert(fs.existsSync(target + '.nvu.json'), 'adotado com recibo');
});
test('Preparar com o jogo aberto pede para fechar (nada é gravado); sem DLL empacotada o fluxo recusa com código próprio', async t => {
  const f = fixture(t); f.setRunning([{ key: 'ats', startedAt: null }]);
  const r = await prepareSimulator({ key: 'ats' }, f.deps()); assert.equal(r.ok, false); assert.equal(r.code, 'NVU-P020'); assert.equal(r.retry, true);
  assert.equal(fs.existsSync(path.join(f.game, 'bin/win_x64/plugins')), false);
  fs.rmSync(f.dll); const broken = new Integration({ file: path.join(f.dir, 'g2.json'), dll: f.dll, roots: [], documents: f.dir, version: VERSION, processes: async () => [] }); broken.remember({ key: 'ats', root: f.game });
  assert.equal(broken.status('ats', f.session).state, 'package_invalid');
  assert.equal((await prepareSimulator({ key: 'ats' }, f.deps({ integration: broken }))).code, 'NVU-P060');
});
test('Sem permissão de gravação: pede o consentimento antes de elevar; elevação recusada ou com resultado enganoso não marca como preparado', async t => {
  const f = fixture(t); let elevations = 0;
  const denied = () => { throw new NvuError('NVU-P050', 'EACCES: permission denied'); };
  let r = await prepareSimulator({ key: 'ats' }, f.deps({ install: denied })); assert.equal(r.ok, false); assert.equal(r.needsElevation, true); assert.equal(r.code, 'NVU-P050');
  r = await prepareSimulator({ key: 'ats', elevate: true }, f.deps({ install: denied, elevate: async () => { elevations++; return { ok: false, exitCode: 1223, declined: true }; } }));
  assert.equal(r.code, 'NVU-P051'); assert.equal(elevations, 1);
  r = await prepareSimulator({ key: 'ats', elevate: true }, f.deps({ install: denied, elevate: async () => { elevations++; return { ok: true, exitCode: 0, declined: false }; } }));
  assert.equal(r.ok, false); assert.equal(r.code, 'NVU-P080', 'o código de saída não basta: o disco é lido de volta sem privilégios');
  r = await prepareSimulator({ key: 'ats', elevate: true }, f.deps({ install: denied, elevate: async () => {
    installPlugin({ root: f.game, key: 'ats', dll: f.dll, expectedSha256: sha(f.bytes), version: VERSION }); elevations++; return { ok: true, exitCode: 0, declined: false }; } }));
  assert.equal(r.ok, true); assert.equal(r.elevated, true); assert.equal(f.status().state, 'ready_to_open');
  r = await prepareSimulator({ key: 'ats', elevate: true }, f.deps({ install: denied, elevate: async () => ({ ok: false, exitCode: EXIT.WRITE, declined: false }) }));
  assert.equal(r.code, 'NVU-P070');
});
test('installPlugin: EACCES vira NVU-P050; falha no meio da gravação não deixa arquivo temporário nem recibo', t => {
  const f = fixture(t);
  const failing = { ...fs, openSync: (file, ...rest) => { if (String(file).endsWith('.tmp')) throw Object.assign(Error('EACCES'), { code: 'EACCES' }); return fs.openSync(file, ...rest); } };
  assert.throws(() => installPlugin({ root: f.game, key: 'ats', dll: f.dll, expectedSha256: sha(f.bytes), fsImpl: failing }), e => e.code === 'NVU-P050');
  const dir = path.join(f.game, 'bin/win_x64/plugins'); assert.deepEqual(fs.readdirSync(dir), [], 'nada ficou na pasta do jogo');
  const readonly = { ...fs, mkdirSync: () => { throw Object.assign(Error('EPERM'), { code: 'EPERM' }); } };
  fs.rmSync(dir, { recursive: true });
  assert.throws(() => installPlugin({ root: f.game, key: 'ats', dll: f.dll, expectedSha256: sha(f.bytes), fsImpl: readonly }), e => e.code === 'NVU-P050');
  assert.throws(() => installPlugin({ root: f.game, key: 'ats', dll: f.dll, expectedSha256: 'a'.repeat(64) }), e => e.code === 'NVU-P060');
});
test('Pasta de plugins redirecionada (link/junção) é recusada; remoção só apaga arquivo com recibo íntegro', t => {
  const f = fixture(t), outside = path.join(f.dir, 'fora'); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(f.game, 'bin/win_x64/plugins'), 'dir');
  assert.throws(() => installPlugin({ root: f.game, key: 'ats', dll: f.dll, expectedSha256: sha(f.bytes) }), e => e.code === 'NVU-P040');
  assert.deepEqual(fs.readdirSync(outside), [], 'nada escapou do jogo'); assert.equal(inspectPlugin(f.game, 'ats').problem, 'NVU-P040');
  fs.unlinkSync(path.join(f.game, 'bin/win_x64/plugins'));
  installPlugin({ root: f.game, key: 'ats', dll: f.dll, expectedSha256: sha(f.bytes), version: VERSION });
  fs.appendFileSync(path.join(f.game, 'bin/win_x64/plugins/nvu_scs_telemetry.dll'), 'alterado');
  assert.throws(() => removePlugin({ root: f.game, key: 'ats' }), e => e.code === 'NVU-P030');
});
test('Processo elevado: só aceita o pedido bem formado; valida origem, hash, destino e jamais lê/escreve fora do jogo', t => {
  const f = fixture(t), digest = sha(f.bytes), req = (o = {}, h = { expectedSha256: digest, version: VERSION }) => encodeRequest({ key: 'ats', root: f.game, ...o }, h);
  assert.equal(decodeRequest(req())?.key, 'ats'); assert.equal(decodeRequest('x'.repeat(5000)), null); assert.equal(decodeRequest(Buffer.from('{"v":2}').toString('base64')), null);
  assert.equal(decodeRequest(Buffer.from(JSON.stringify({ v: 1, key: 'gto', root: f.game, action: 'install', expectedSha256: digest })).toString('base64')), null, 'só ETS2/ATS');
  assert.equal(runElevatedPlugin('###', { pluginDir: f.pluginDir }), EXIT.BAD_REQUEST);
  assert.equal(runElevatedPlugin(req({}, { expectedSha256: 'b'.repeat(64), version: VERSION }), { pluginDir: f.pluginDir }), EXIT.HASH, 'hash pedido ≠ hash do pacote');
  assert.equal(runElevatedPlugin(req({ root: path.join(f.dir, 'nao-e-um-jogo') }), { pluginDir: f.pluginDir }), EXIT.NOT_GAME);
  fs.mkdirSync(path.join(f.dir, 'vazio')); assert.equal(runElevatedPlugin(req(), { pluginDir: path.join(f.dir, 'vazio') }), EXIT.RESOURCES);
  fs.writeFileSync(path.join(f.pluginDir, 'nvu_scs_telemetry.dll'), 'MZ-adulterado'); assert.equal(runElevatedPlugin(req(), { pluginDir: f.pluginDir }), EXIT.HASH, 'DLL do pacote ≠ manifesto');
  fs.writeFileSync(path.join(f.pluginDir, 'nvu_scs_telemetry.dll'), f.bytes);
  assert.equal(runElevatedPlugin(req(), { pluginDir: f.pluginDir }), EXIT.OK); assert.equal(f.integration.plugin(f.integration.game('ats')).current, true);
  const dir = path.join(f.game, 'bin/win_x64/plugins'); fs.writeFileSync(path.join(dir, 'nvu_scs_telemetry.dll'), 'MZ-de-terceiros'); fs.rmSync(path.join(dir, 'nvu_scs_telemetry.dll.nvu.json'));
  assert.equal(runElevatedPlugin(req(), { pluginDir: f.pluginDir }), EXIT.FOREIGN); assert.equal(fs.readFileSync(path.join(dir, 'nvu_scs_telemetry.dll'), 'utf8'), 'MZ-de-terceiros');
  assert.equal(messageFor(EXIT.DECLINED), 'NVU-P051'); assert.equal(messageFor(EXIT.REDIRECTED), 'NVU-P040'); assert.equal(messageFor(EXIT.FOREIGN), 'NVU-P030');
});
test('Remover pelo fluxo único: só o plugin NVU, com jogo fechado, e relê o disco', async t => {
  const f = fixture(t, { key: 'ets2' }); await prepareSimulator({ key: 'ets2' }, f.deps());
  const other = path.join(f.game, 'bin/win_x64/plugins/outro.dll'); fs.writeFileSync(other, 'terceiro');
  const r = await removeSimulatorPlugin({ key: 'ets2' }, f.deps()); assert.equal(r.ok, true); assert(fs.existsSync(other)); assert.equal(f.status().state, 'absent');
  f.setRunning([{ key: 'ets2', startedAt: null }]); await f.integration.refreshProcesses(true);
  assert.equal((await removeSimulatorPlugin({ key: 'ets2' }, f.deps())).code, 'NVU-P020');
});
