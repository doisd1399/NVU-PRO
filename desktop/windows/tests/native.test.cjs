const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const { promisify } = require('node:util');
const { pathToFileURL } = require('node:url');
const { Session } = require('../core/session.cjs');
const { Integration, BridgeReader } = require('../core/integration.cjs');
const { pluginAction } = require('../core/games.cjs');
const { OverlayController } = require('../core/overlay-controller.cjs');
const { verifyPlugin } = require('../tools/plugin-integrity.cjs');
test('DLL compilada é PE x64 completo, exporta exatamente as funções oficiais do SDK (tabela de exportação real), só importa DLLs do sistema e a verificação recusa as que não cumprem isso', () => {
  const dllFile = path.resolve(__dirname, '../plugin/bin/nvu_scs_telemetry.dll');
  const result = verifyPlugin(dllFile);
  assert.equal(result.machine, 'x64'); assert(result.bytes > 512);
  assert.deepEqual([...result.exports].sort(), ['scs_telemetry_init', 'scs_telemetry_shutdown']);
  for (const name of result.imports) assert(['kernel32.dll', 'shell32.dll', 'ole32.dll', 'msvcrt.dll'].includes(name), `importação inesperada (o plugin precisa ser autossuficiente): ${name}`);
  const real = fs.readFileSync(dllFile), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nvu-pe-'));
    const replaceAll = (bytes, from, to) => { assert.equal(from.length, to.length); let count = 0; for (let at; (at = bytes.toString('latin1').toLowerCase().indexOf(from + '\0')) >= 0 && count < 100; count++) bytes.write(to, at, 'latin1'); return count; };   // case-insensitive: MSVC writes KERNEL32.dll, MinGW writes msvcrt.dll
  try {
    // Export names renamed in place AND the plain strings appended at the end: a text search would still find them, the real export table does not offer them.
    const renamed = Buffer.from(real); for (const name of REQUIRED) assert(replaceAll(renamed, name, 'x' + name.slice(1)) > 0);
    fs.writeFileSync(path.join(dir, 'renamed.dll'), Buffer.concat([renamed, Buffer.from(REQUIRED.join('\0') + '\0')]));
    assert.throws(() => verifyPlugin(path.join(dir, 'renamed.dll')), /PLUGIN_EXPORTS_REQUIRED/);
    // One imported DLL name replaced (same length) by the Visual C++ runtime: refused, because the player's PC may not have it.
    const dependent = Buffer.from(real), [from, to] = result.imports.includes('msvcrt.dll') ? ['msvcrt.dll', 'msvcp1.dll'] : ['kernel32.dll', 'msvcp140.dll'];
    assert(replaceAll(dependent, from, to) > 0); fs.writeFileSync(path.join(dir, 'dependent.dll'), dependent);
    assert.throws(() => verifyPlugin(path.join(dir, 'dependent.dll')), /PLUGIN_RUNTIME_DEPENDENCY/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
const REQUIRED = ['scs_telemetry_init', 'scs_telemetry_shutdown'];
const token = 'a'.repeat(64), scope = { driverId: 'qa-driver', companyId: 'qa-company', jobId: 'qa-job', contractId: 'qa-contract', simulatorKey: 'ats', total: 6, progress: 0 };
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nvu-native-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const game = path.join(dir, 'ATS'), bridge = path.join(dir, 'bridge'), dll = path.join(dir, 'plugin.dll');
  fs.mkdirSync(path.join(game, 'bin/win_x64'), { recursive: true }); fs.writeFileSync(path.join(game, 'bin/win_x64/amtrucks.exe'), 'MZ-QA');
  fs.mkdirSync(bridge); fs.writeFileSync(dll, 'MZ-QA-plugin');
  let time = Date.now(); const now = () => time; const session = new Session(path.join(dir, 'journal.json'), now);
  const integration = new Integration({ file: path.join(dir, 'games.json'), dll, roots: [], documents: dir, now }); integration.remember({ key: 'ats', root: game });
  const reader = new BridgeReader(bridge, token, now), id = randomUUID(), bootId = randomUUID();
  const packet = (extra = {}) => ({ version: 1, token, simulatorKey: 'ats', bootId, sequence: 1, at: now(), paused: false, online: true, jobId: id, jobState: 'active', ...extra });
  const heartbeat = value => fs.writeFileSync(path.join(bridge, 'ats.heartbeat.json'), JSON.stringify(value));
  return { dir, game, bridge, dll, session, integration, reader, packet, heartbeat, id, now, tick: ms => { time += ms; } };
}
test('Preparação bloqueia plugin ausente/desatualizado e mantém a pasta selecionada após reinício', t => {
  const f = fixture(t); assert.throws(() => f.integration.assertReady('ats', f.session), /Prepare o ATS/);
  pluginAction(f.game, 'ats', f.dll); f.integration.running = [];
  assert.equal(f.integration.status('ats', f.session).phase, 'game_closed');
  f.integration.running = ['ats']; assert.equal(f.integration.status('ats', f.session).phase, 'waiting_plugin');
  const restored = new Integration({ file: path.join(f.dir, 'games.json'), dll: f.dll, roots: [], documents: f.dir }); assert.equal(restored.game('ats').root, f.game);
  fs.appendFileSync(f.dll, 'new-version'); const updated = new Integration({ file: path.join(f.dir, 'games.json'), dll: f.dll, roots: [], documents: f.dir });
  assert.throws(() => updated.assertReady('ats', f.session), /diferente do esperado/);
});
test('Ponte real por arquivos autentica ATS, expira, reconecta e preserva entrega antes de confirmar', t => {
  const f = fixture(t); pluginAction(f.game, 'ats', f.dll); f.session.start(scope);
  f.heartbeat(f.packet()); f.reader.poll(f.session); assert.equal(f.session.connected('ats'), true);
  const delivery = { version: 1, token, simulatorKey: 'ats', type: 'job.delivered', eventId: f.id, capturedAt: f.now(), origin: 'QA origem', destination: 'QA destino', amountCents: 10000, currency: 'USD', distanceKm: 12 };
  fs.writeFileSync(path.join(f.bridge, `ats-${f.id}.delivery.json`), JSON.stringify(delivery)); f.reader.poll(f.session);
  assert.equal(f.session.pending('qa-driver').length, 1); assert.equal(f.session.data.events[`ats:${f.id}`].state, 'PENDING');
  f.tick(5100); f.reader.poll(f.session); assert.equal(f.session.connected('ats'), false); assert.equal(f.integration.status('ats', f.session).phase, 'heartbeat_expired');
  f.heartbeat(f.packet({ sequence: 2 })); f.reader.poll(f.session); assert.equal(f.session.connected('ats'), true); assert.equal(f.session.pending('qa-driver').length, 1);
  f.heartbeat(f.packet({ sequence: 3, online: false })); f.reader.poll(f.session); assert.equal(f.session.connected('ats'), false);
  f.heartbeat(f.packet({ sequence: 2 })); f.reader.poll(f.session); assert.equal(f.session.connected('ats'), false);
});
test('Token incorreto, pacote inválido e nome de simulador divergente não criam conexão', t => {
  const f = fixture(t); f.heartbeat(f.packet({ token: 'b'.repeat(64) })); f.reader.poll(f.session);
  assert.equal(f.reader.rejections.ats.reason, 'token_mismatch'); assert.equal(f.session.connected('ats'), false);
  f.heartbeat(f.packet({ simulatorKey: 'ets2' })); f.reader.poll(f.session); assert.equal(f.reader.rejections.ats.reason, 'packet_invalid');
  f.heartbeat(f.packet({ sequence: -1 })); f.reader.poll(f.session); assert.equal(f.session.connected('ats'), false);
  f.heartbeat(f.packet()); f.reader.poll(f.session); assert.equal(f.session.connected('ats'), true); assert.equal(f.reader.rejections.ats, undefined);
});
test('Frete já em andamento pode ser vinculado com o jogo pausado; pausa explícita do PRO continua protegida', t => {
  const f = fixture(t); f.session.start(scope); f.heartbeat(f.packet({ paused: true })); f.reader.poll(f.session);
  assert(f.session.data.bindings[`ats:${f.id}`]);
  const event = { version: 1, simulatorKey: 'ats', type: 'job.delivered', eventId: f.id, capturedAt: f.now(), origin: 'QA origem', destination: 'QA destino', amountCents: 10000, currency: 'USD', distanceKm: 12 };
  assert.equal(f.session.ingest(event).state, 'PENDING');
  f.tick(100); f.session.pause(); f.tick(10); const nextId = randomUUID(); f.heartbeat(f.packet({ sequence: 2, jobId: nextId, paused: true })); f.reader.poll(f.session);
  assert.equal(f.session.data.bindings[`ats:${nextId}`], undefined);
});
test('Plugin antigo ainda carregado exige reinício, mesmo após atualizar o arquivo no disco', t => {
  const f = fixture(t); pluginAction(f.game, 'ats', f.dll); f.integration.version = '0.1.2';
  f.heartbeat(f.packet({ pluginVersion: '0.1.1' })); f.reader.poll(f.session);
  assert.equal(f.integration.status('ats', f.session).phase, 'plugin_restart');
  assert.throws(() => f.integration.assertReady('ats', f.session), /ainda usa o plugin/);
  f.heartbeat(f.packet({ sequence: 2, pluginVersion: '0.1.2' })); f.reader.poll(f.session);
  assert.equal(f.integration.status('ats', f.session).phase, 'connected');
});
test('Diagnóstico inclui apenas linhas SDK relevantes e remove identificação pessoal e tokens', t => {
  const f = fixture(t), logs = path.join(f.dir, 'American Truck Simulator'); fs.mkdirSync(logs);
  fs.writeFileSync(path.join(logs, 'game.log.txt'), `Personal chat not collected\n[sdk] nvu_scs_telemetry C:\\Users\\QA Person\\game.dll qa@example.test token=${token}\n[NVU PRO 0.1.2] ATS telemetry initialized.\n`);
  const report = f.integration.diagnostic('ats', f.session), text = JSON.stringify(report);
  assert.equal(report.logAvailable, true); assert.equal(report.sdkLog.length, 2);
  assert(!text.includes('QA Person')); assert(!text.includes('qa@example.test')); assert(!text.includes(token)); assert(!text.includes('Personal chat'));
});
class Window extends EventEmitter {
  constructor(bounds = {}) { super(); this.bounds = { x: 20, y: 30, width: 64, height: 64, ...bounds }; this.visible = false; this.messages = []; this.url = 'file:///qa/overlay.html';
    this.webContents = Object.assign(new EventEmitter(), { mainFrame: { url: this.url }, send: (name, value) => this.messages.push({ name, value }), getURL: () => this.url, setWindowOpenHandler() {} }); }
  getBounds() { return this.bounds; } setBounds(bounds) { this.bounds = { ...bounds }; }
  showInactive() { this.visible = true; } show() { this.visible = true; } focus() { this.focusCount=(this.focusCount||0)+1; } hide() { this.visible = false; }
  isVisible() { return this.visible; } isDestroyed() { return !!this.destroyed; } destroy() { this.destroyed = true; this.visible = false; }
  setIgnoreMouseEvents(value) { this.ignored = value; } setAlwaysOnTop() {}
  async loadURL(url) { this.url = url; this.webContents.mainFrame.url = url; }
  async loadFile(file, options) { this.url = pathToFileURL(file).toString() + '?surface=' + options.query.surface; this.webContents.mainFrame.url = this.url; }
}
test('Painel recebe foco, permanece aberto sem cursor, migra posição e avisos não tomam foco',async()=>{
 let point={x:500,y:100},time=1000,areas=[{x:0,y:0,width:1000,height:700}],saved;const calls=[],surfaces=[],visibility=[];
 const c=new OverlayController({createWindow:(surface,b)=>{surfaces.push(surface);return new Window(b);},displays:()=>areas,cursor:()=>point,now:()=>time,savedBounds:{x:20,y:30,width:64,height:64},save:b=>{saved=b;},onVisibility:value=>visibility.push(value),actions:a=>calls.push(a)});
 c.ensure();assert.deepEqual(surfaces,['panel']);assert.equal(c.panel.getBounds().width,1000);assert.equal(c.panel.getBounds().height,700);assert.equal(c.panelLayout.width,400);assert.equal(c.panelLayout.height,560);assert.equal(c.panel.isVisible(),false);
 c.show();assert.equal(c.panel.isVisible(),true);assert.equal(c.panel.ignored,false);assert(c.panel.focusCount>0);point={x:-9999,y:-9999};time+=120000;c.tick();c.panel.emit('blur');assert.equal(c.panel.isVisible(),true);
 const focus=c.panel.focusCount;c.update({theme:'dark',notice:{id:'qa-confirmed',expiresAt:time+11000},assistant:{}});assert.deepEqual(surfaces,['panel','notice']);assert.equal(c.notice.ignored,true);assert.equal(c.panel.focusCount,focus);assert.equal(c.notice.getBounds().x+c.notice.getBounds().width/2,500);assert.equal(c.notice.getBounds().y,24);
 c.move({x:300,y:50});assert.equal(saved.x,300);assert.equal(c.panel.getBounds().x,0);assert.equal(c.panelLayout.x,300);areas=[{x:-800,y:0,width:800,height:600}];c.layout();assert(c.panel.getBounds().x<0);assert(c.notice.getBounds().x<0);
 for(const a of['pause','resume','panel','trips','setup','game','stop'])await c.command('panel',a);assert.deepEqual(calls,['pause','resume','panel','trips','setup','game','stop']);assert.equal(c.panel.isVisible(),true);
 await assert.rejects(c.command('notice','stop'),/DENIED/);await assert.rejects(c.command('panel','execute-shell'),/DENIED/);assert.throws(()=>c.surface({sender:{},senderFrame:{}}),/DENIED/);
 assert.equal(c.control,undefined);time+=11001;c.tick();assert.equal(c.notice.isVisible(),false);assert.equal(c.panel.isVisible(),true);
 let prevented=false;c.panel.emit('close',{preventDefault:()=>{prevented=true;}});assert(prevented);assert.equal(c.panel.isVisible(),false);assert.equal(visibility.at(-1),false);
});
