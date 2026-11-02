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
test('DLL compilada é PE x64 completo e contém os exports oficiais do SDK', () => {
  const result = verifyPlugin(path.resolve(__dirname, '../plugin/bin/nvu_scs_telemetry.dll'));
  assert.equal(result.machine, 'x64'); assert(result.bytes > 512);
});
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
  const f = fixture(t); assert.throws(() => f.integration.assertReady('ats', f.session), /Instale o plugin/);
  pluginAction(f.game, 'ats', f.dll); f.integration.running = [];
  assert.equal(f.integration.status('ats', f.session).phase, 'game_closed');
  f.integration.running = ['ats']; assert.equal(f.integration.status('ats', f.session).phase, 'waiting_plugin');
  const restored = new Integration({ file: path.join(f.dir, 'games.json'), dll: f.dll, roots: [], documents: f.dir }); assert.equal(restored.game('ats').root, f.game);
  fs.appendFileSync(f.dll, 'new-version'); const updated = new Integration({ file: path.join(f.dir, 'games.json'), dll: f.dll, roots: [], documents: f.dir });
  assert.throws(() => updated.assertReady('ats', f.session), /Atualize o plugin/);
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
  assert.throws(() => f.integration.assertReady('ats', f.session), /plugin anterior/);
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
test('Main real inicializa, prepara plugin e executa todos os comandos com contexto e IPC validados', async t => {
  const f = fixture(t), handlers = new Map(), shortcuts = new Map(), windows = [], opened = [], errors = [], timers = [];
  const user = path.join(f.dir, 'user'), local = path.join(f.dir, 'local'); fs.mkdirSync(user); fs.mkdirSync(local);
  fs.copyFileSync(path.join(f.dir, 'games.json'), path.join(user, 'games.json'));
  let running = [], confirm = 1, focusAllowed = true;
  const child = { execFileSync: name => name === 'powershell.exe' ? '"S-1-5-21-123"' : '', execFile() {} };
  child.execFile[promisify.custom] = async () => ({ stdout: JSON.stringify(running.map(k => k === 'ats' ? 'amtrucks' : 'eurotrucks2')) });
  const app = Object.assign(new EventEmitter(), { isPackaged: false, setName() {}, requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(), getPath: name => name === 'userData' ? user : name === 'documents' ? f.dir : path.join(f.dir, 'Roaming'), getVersion: () => '0.1.4', quit() {} });
  const screen = Object.assign(new EventEmitter(), { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1100, height: 750 } }], getCursorScreenPoint: () => ({ x: 50, y: 50 }) });
  class BrowserWindow extends Window { constructor(options) { super(options); this.options = options; windows.push(this); } }
  const electron = { app, BrowserWindow, screen, protocol: { registerSchemesAsPrivileged() {}, handle() {} }, session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } },
    ipcMain: { handle: (name, callback) => handlers.set(name, callback) }, globalShortcut: { register: (key, callback) => shortcuts.set(key, callback), unregister: key => shortcuts.delete(key), unregisterAll() {} },
    shell: { openExternal: async url => opened.push(url) }, dialog: { showErrorBox: (_, error) => errors.push(error), showMessageBox: async () => ({ response: confirm }), showOpenDialog: async () => ({ canceled: true }) }, safeStorage: {}, net: {},
    Tray: class { setToolTip() {} setContextMenu() {} on() {} destroy() {} }, Menu: { setApplicationMenu() {}, buildFromTemplate: x => x }, nativeImage: { createFromPath() {} }, clipboard: { writeText() {} } };
  const file = path.resolve(__dirname, '../main.cjs'), req = createRequire(file), web = path.resolve(__dirname, '../../../dist');
  const fakeFs = { ...fs, realpathSync: p => p === web ? web : fs.realpathSync(p), readFileSync: (p, encoding) => String(p) === path.join(web, 'index.html') ? '<html></html>'
    : String(p).endsWith('config/google-oauth.json') ? JSON.stringify({ clientId: 'qa.apps.googleusercontent.com' }) : fs.readFileSync(p, encoding) };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { require: name => name === 'electron' ? electron : name === 'node:child_process' ? child : name === 'node:fs' ? fakeFs : name === './core/game-window.cjs' ? {focusGameWindow:async key=>{opened.push('focus:'+key);return{found:true,focused:focusAllowed};}} : req(name),
    __dirname: path.dirname(file), process: { platform: 'win32', env: { LOCALAPPDATA: local, ProgramFiles: f.dir, 'ProgramFiles(x86)': f.dir } },
    URL, Response, Headers, console, setInterval: (fn, ms) => { timers.push({ fn, ms }); return { unref() {} }; } }, { filename: file });
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(errors, []); assert.equal(windows.length, 1);
  const main = windows[0], event = { sender: main.webContents, senderFrame: main.webContents.mainFrame };
  const invoke = (method, input) => handlers.get('nvu:windows')(event, { method, input });
  assert.equal(main.options.webPreferences.sandbox, true); assert.equal(main.options.webPreferences.nodeIntegration, false);
  await invoke('syncScope', scope); await assert.rejects(invoke('start', scope), /Instale o plugin/);
  await invoke('installPlugin', { key: 'ats', root: f.game }); await invoke('start', scope); assert.equal(windows.length, 3);
  const panel=windows[1],overlayEvent={sender:panel.webContents,senderFrame:panel.webContents.mainFrame};
  assert.equal(panel.options.focusable,true);assert.equal(panel.options.transparent,true);assert.equal(panel.options.resizable,false);assert.equal(panel.getBounds().width,1100);
  let keyboardBlocked=false;panel.webContents.emit('before-input-event',{preventDefault:()=>{keyboardBlocked=true;}},{key:'Enter',control:false});assert(keyboardBlocked);
  const current = () => main.messages.filter(m => m.name === 'nvu:windows:update').at(-1).value;
  const context=()=>panel.messages.filter(m=>m.name==='nvu:overlay:update').at(-1).value.contextKey;
  const action = name => handlers.get('nvu:overlay')(overlayEvent, { action: name, contextKey: context() });
  assert.equal(panel.isVisible(),false);await invoke('showOverlay');assert.equal(panel.isVisible(),true);assert.deepEqual([...shortcuts.keys()],['CommandOrControl+N']); assert.equal(current().active, true); assert.equal(current().connected, false);
  await action('pause'); assert.equal(current().enabled,false);assert.equal(panel.isVisible(),true); await action('resume'); assert.equal(current().enabled, true);
  for (const name of ['panel', 'trips', 'setup']) { await action(name); assert.equal(main.messages.filter(m => m.name === 'nvu:windows:navigate').at(-1).value.action, name); }
  await action('game'); assert.equal(opened.at(-1), 'steam://rungameid/270880'); assert.equal(current().connected, false);
  const bridge = path.join(local, 'NVU/pro-telemetry'), bridgeToken = fs.readFileSync(path.join(bridge, 'bridge.token'), 'utf8');
  fs.writeFileSync(path.join(bridge, 'ats.heartbeat.json'), JSON.stringify(f.packet({ token: bridgeToken, at: Date.now(), pluginVersion:'0.1.4',origin:'QA origem',destination:'QA destino' })));
  const poll = timers.find(timer => timer.ms === 1000).fn; await poll();assert.equal(current().connected,true);assert.equal(current().integration.phase,'connected');assert.equal(current().appVersion,'0.1.4');assert.equal(current().telemetryPluginVersion,'0.1.4');assert.equal(windows.length,3);assert.equal(windows[2].options.focusable,false);assert.equal(windows[2].ignored,true);
  await invoke('showOverlay');focusAllowed=false;await assert.rejects(action('game'),/Windows não liberou/);assert.equal(panel.isVisible(),true);focusAllowed=true;await action('game');assert.equal(opened.at(-1),'focus:ats');assert.equal(opened.filter(url=>url.startsWith('steam:')).length,1);assert.equal(panel.isVisible(),false);
  await assert.rejects(async()=>handlers.get('nvu:overlay')(overlayEvent,{action:'pause',contextKey:context(),arbitrary:true}),/DENIED/);await invoke('setTheme','dark');assert.equal(current().theme,'dark');await action('theme');assert.equal(current().theme,'light');assert.equal(JSON.parse(fs.readFileSync(path.join(user,'windows-preferences.json'))).theme,'light');
  await invoke('showOverlay');handlers.get('nvu:overlay:move')(overlayEvent,{x:250,y:45});assert.equal(JSON.parse(fs.readFileSync(path.join(user,'overlay.json'))).x,250);assert.throws(()=>handlers.get('nvu:overlay:move')(overlayEvent,{x:1,y:2,arbitrary:true}),/DENIED/);assert.throws(()=>handlers.get('nvu:overlay:move')({sender:{},senderFrame:{}},{x:1,y:2}),/DENIED/);await assert.rejects(invoke('setTheme','invalid'),/THEME_INVALID/);
  fs.writeFileSync(path.join(bridge, `ats-${f.id}.delivery.json`), JSON.stringify({ version: 1, token: bridgeToken, simulatorKey: 'ats', type: 'job.delivered', eventId: f.id, capturedAt: Date.now(), origin: 'QA origem', destination: 'QA destino', amountCents: 10000, currency: 'USD', distanceKm: 12 }));
  await poll(); assert.equal(current().pending.length, 1); assert.equal(current().scope.progress, 0);
  confirm = 0; await action('stop'); assert.equal(current().active, true);
  const stale = context(); await invoke('syncScope', { ...scope, companyId: 'qa-other-company' });
  await assert.rejects(async () => handlers.get('nvu:overlay')(overlayEvent, { action: 'stop', contextKey: stale }), /contexto mudou/);
  await assert.rejects(handlers.get('nvu:windows')({ sender: {}, senderFrame: {} }, { method: 'status' }), /REJECTED/);
  await invoke('start', { ...scope, companyId: 'qa-other-company' }); confirm = 1; await action('stop'); assert.equal(current().active, false);
  assert.equal(current().pending.length, 1); assert.equal(current().pending[0].scope.companyId, scope.companyId);
  await handlers.get('nvu:overlay')(overlayEvent,{action:'collapse'});assert.equal(panel.isVisible(),false);shortcuts.get('CommandOrControl+N')();assert.equal(panel.isVisible(),true);shortcuts.get('CommandOrControl+N')();assert.equal(panel.isVisible(),false);assert.equal(shortcuts.has('CommandOrControl+Alt+PageDown'),false);
  running = ['ats']; await assert.rejects(invoke('removePlugin', { key: 'ats', root: f.game }), /Feche o ATS/);
  app.emit('before-quit');
});
