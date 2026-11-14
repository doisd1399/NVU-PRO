const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWorld, pkg } = require('./helpers/fake-main.cjs');
const { encodeRequest, EXIT } = require('../core/elevated-plugin.cjs');
const { createHash } = require('node:crypto');

function sandbox(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nvu-start-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
const startup = world => JSON.parse(fs.readFileSync(path.join(world.user, 'logs', 'last-startup.json'), 'utf8'));
const mainWindows = world => world.windows.length;

test('Início saudável: etapas registradas, versões reais expostas e nenhum diálogo', async t => {
  const w = createWorld(sandbox(t)); w.start(); await w.settle();
  assert.deepEqual(w.errors, []); assert.deepEqual(w.boxes, []); assert.deepEqual(w.exits, []);
  const report = startup(w);
  assert.equal(report.ok, true);
  assert.deepEqual(report.steps.map(s => s.id), ['platform', 'data-dir', 'versions', 'bridge', 'journal', 'preferences', 'games', 'oauth-config', 'web', 'protocol', 'window', 'tray', 'ipc', 'shortcut', 'load']);
  const status = await w.handlers.get('nvu:windows')({ sender: w.windows[0].webContents, senderFrame: w.windows[0].webContents.mainFrame }, { method: 'status' });
  assert.equal(status.versions.app.version, pkg.version); assert.equal(status.versions.plugin.expectedVersion, pkg.nvu.pluginVersion);
  assert.equal(status.versions.app.executable, 'C:\\Apps\\NVU PRO\\NVU PRO.exe', 'caminho do executável realmente em execução');
  assert.equal(status.versions.plugin.packaged.consistent, true, 'o plugin empacotado confere com o manifesto da compilação');
  assert.equal(status.startup.ok, true);
  assert(!w.commandsRun.some(c => c[0] === 'powershell.exe'), 'a inicialização não depende mais do PowerShell para a pasta de comunicação');
});
test('Segunda instância (bloqueio perdido): decide e sai, sem serviços, janelas, bandeja, atalho, ponte, chave ou diário', async t => {
  const dir = sandbox(t), w = createWorld(dir, { state: { lock: false } }); w.start(); await w.settle(); await w.settle();
  assert.equal(w.windows.length, 0, 'nenhuma janela criada'); assert.equal(w.handlers.size, 0, 'nenhum IPC registrado'); assert.equal(w.shortcuts.size, 0, 'nenhum atalho global');
  assert.deepEqual(w.commandsRun, [], 'nenhum whoami/icacls/reg executado'); assert.equal(w.timers.length, 0, 'nenhum temporizador de serviço');
  assert.equal(fs.existsSync(path.join(w.local, 'NVU')), false, 'a ponte de telemetria não foi tocada');
  assert.equal(fs.existsSync(path.join(w.user, 'pro-journal.json')), false, 'o diário não foi aberto');
  assert.equal(fs.existsSync(path.join(w.user, 'logs', 'last-startup.json')), false, 'sem bootstrap');
  assert.equal(w.exits.length, 1); assert.notEqual(w.exits[0], undefined);
  assert.equal(w.app.lockRequests.length, 1, 'um único pedido de bloqueio — que também avisa a instância existente');
  assert(w.boxes.some(b => /NVU-I030/.test(b.detail)), 'explica com código quando não identifica a outra NVU');
});
test('Segunda instância em modo sem diálogos: sem caixas, código de saída e registro', async t => {
  const w = createWorld(sandbox(t), { state: { lock: false }, argv: ['--nvu-no-dialogs'] }); w.start(); await w.settle(); await w.settle();
  assert.deepEqual(w.boxes, []); assert.deepEqual(w.exits, [3]);
  assert(fs.readFileSync(path.join(w.user, 'logs', 'nvu.log'), 'utf8').includes('instance.lock_lost'));
});
test('Instância principal traz a janela existente para frente quando outra tenta abrir', async t => {
  const w = createWorld(sandbox(t)); w.start(); await w.settle();
  const main = w.windows[0]; main.hide(); assert.equal(main.visible, false);
  w.app.emit('second-instance', {}, [], '', { product: 'nvu-pro', pid: 7, version: '0.1.0', takeover: false });
  assert.equal(main.visible, true); assert(main.focusCount > 0);
});
test('Falha do diário: código NVU-S050, arquivo preservado, nada apagado, diagnóstico copiável sem dados pessoais', async t => {
  const dir = sandbox(t), w = createWorld(dir); fs.writeFileSync(path.join(w.user, 'pro-journal.json'), '{ "version": 1, corrompido');
  w.state.boxAnswers = [0, 2]; // copiar diagnóstico, depois sair
  w.start(); await w.settle(); await w.settle();
  assert.deepEqual(w.exits, [1]); assert.equal(w.windows.length, 0);
  assert.match(w.boxes[0].detail, /NVU-S050/); assert.match(w.boxes[0].detail, /Etapa: Diário local de viagens/); assert.match(w.boxes[0].message, /não pôde iniciar/);
  assert.deepEqual(w.boxes[0].buttons, ['Copiar diagnóstico', 'Abrir pasta de registros', 'Sair']);
  assert.equal(fs.readFileSync(path.join(w.user, 'pro-journal.json'), 'utf8'), '{ "version": 1, corrompido', 'o arquivo original continua intacto');
  assert(fs.readdirSync(w.user).some(f => f.startsWith('pro-journal.json.invalid-')), 'cópia preservada ao lado');
  assert.equal(w.clipboardWrites.length, 1); const copied = JSON.parse(w.clipboardWrites[0]);
  assert.equal(copied.kind, 'nvu-windows-startup-diagnostic'); assert.equal(copied.startup.fatal.code, 'NVU-S050');
  assert(!w.clipboardWrites[0].includes(os.homedir()) || os.homedir() === '/', 'sem pasta pessoal');
  assert.equal(startup(w).fatal.id, 'journal');
});
test('Falhas da ponte local têm códigos próprios: whoami, icacls e chave inválida (a chave é recriada, não é dado do usuário)', async t => {
  const a = createWorld(sandbox(t), { state: { whoamiFails: true } }); a.start(); await a.settle(); await a.settle();
  assert.match(a.boxes[0].detail, /NVU-S041/); assert.match(a.boxes[0].detail, /whoami/); assert.deepEqual(a.exits, [1]);
  const b = createWorld(sandbox(t), { state: { icaclsFails: true } }); b.start(); await b.settle(); await b.settle();
  assert.match(b.boxes[0].detail, /NVU-S041/); assert.match(b.boxes[0].detail, /icacls/);
  const dir = sandbox(t), c = createWorld(dir); const bridge = path.join(c.local, 'NVU/pro-telemetry'); fs.mkdirSync(bridge, { recursive: true }); fs.writeFileSync(path.join(bridge, 'bridge.token'), 'lixo');
  c.start(); await c.settle();
  assert.deepEqual(c.exits, []); assert.match(fs.readFileSync(path.join(bridge, 'bridge.token'), 'utf8'), /^[a-f0-9]{64}$/);
  assert(fs.readdirSync(bridge).some(f => f.startsWith('bridge.token.invalid-')), 'chave inválida preservada para inspeção');
});
test('Recursos ausentes ou janela que não abre dão códigos distintos; avisos não impedem o início', async t => {
  const web = createWorld(sandbox(t), { state: { noWeb: true } }); web.start(); await web.settle(); await web.settle();
  assert.match(web.boxes[0].detail, /NVU-S080/); assert.deepEqual(web.exits, [1]);
  const load = createWorld(sandbox(t), { state: { failLoad: true } }); load.start(); await load.settle(); await load.settle();
  assert.match(load.boxes[0].detail, /NVU-S090/);
  const warn = createWorld(sandbox(t), { state: { badOauth: true, shortcutBusy: true } }); warn.start(); await warn.settle();
  assert.deepEqual(warn.exits, []); assert.equal(warn.boxes.length, 0); const report = startup(warn);
  assert.deepEqual(report.warnings.map(x => x.code).sort(), ['NVU-S070', 'NVU-S101']); assert.equal(report.ok, true);
});
test('Modo elevado do plugin: sem bloqueio de instância, sem janela e com código de saída; pedido inválido é recusado', async t => {
  const dir = sandbox(t), game = path.join(dir, 'ETS2'); fs.mkdirSync(path.join(game, 'bin/win_x64'), { recursive: true }); fs.writeFileSync(path.join(game, 'bin/win_x64/eurotrucks2.exe'), 'MZ');
  const dllPath = path.resolve(__dirname, '../plugin/bin/nvu_scs_telemetry.dll'), digest = createHash('sha256').update(fs.readFileSync(dllPath)).digest('hex');
  const ok = createWorld(dir, { argv: ['--nvu-elevated-plugin=' + encodeRequest({ key: 'ets2', root: game }, { expectedSha256: digest, version: pkg.nvu.pluginVersion })] }); ok.start(); await ok.settle();
  assert.deepEqual(ok.exits, [EXIT.OK]); assert.deepEqual(ok.app.lockRequests, []); assert.equal(ok.windows.length, 0);
  assert(fs.existsSync(path.join(game, 'bin/win_x64/plugins/nvu_scs_telemetry.dll')));
  const wrong = createWorld(sandbox(t), { argv: ['--nvu-elevated-plugin=' + encodeRequest({ key: 'ets2', root: game }, { expectedSha256: 'f'.repeat(64), version: '0.2.0' })] }); wrong.start();
  assert.deepEqual(wrong.exits, [EXIT.HASH]);
  const junk = createWorld(sandbox(t), { argv: ['--nvu-elevated-plugin=!!!não-é-base64'] }); junk.start(); assert.deepEqual(junk.exits, [EXIT.BAD_REQUEST]);
});
test('Relatório de versões reais pela linha de comando (sem janela, sem bloqueio de instância)', async t => {
  const dir = sandbox(t), out = path.join(dir, 'versions.json'), w = createWorld(dir, { argv: ['--nvu-versions-out=' + out] }); w.start(); await w.settle();
  assert.deepEqual(w.exits, [0]); assert.deepEqual(w.app.lockRequests, []); const report = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(report.app.version, pkg.version); assert.equal(report.plugin.expectedVersion, pkg.nvu.pluginVersion); assert.equal(report.app.executable, 'C:\\Apps\\NVU PRO\\NVU PRO.exe');
});
