const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createWorld, pkg } = require('./helpers/fake-main.cjs');
const PLUGIN = pkg.nvu.pluginVersion;
const token = 'a'.repeat(64), scope = { driverId: 'qa-driver', companyId: 'qa-company', jobId: 'qa-job', contractId: 'qa-contract', simulatorKey: 'ats', total: 6, progress: 0 };
function sandbox(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nvu-main-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
function fakeGame(dir) {
  const game = path.join(dir, 'ATS'); fs.mkdirSync(path.join(game, 'bin/win_x64'), { recursive: true }); fs.writeFileSync(path.join(game, 'bin/win_x64/amtrucks.exe'), 'MZ-QA'); return game;
}
test('Main real inicializa, prepara plugin e executa todos os comandos com contexto e IPC validados', async t => {
  const dir = sandbox(t), game = fakeGame(dir), w = createWorld(dir);
  fs.writeFileSync(path.join(w.user, 'games.json'), JSON.stringify({ version: 1, games: { ats: game } }));
  const { handlers, shortcuts, windows, opened, errors, timers, local, user } = w, id = randomUUID(), bootId = randomUUID();
  const packet = (extra = {}) => ({ version: 1, token, simulatorKey: 'ats', bootId, sequence: 1, at: Date.now(), paused: false, online: true, jobId: id, jobState: 'active', ...extra });
  const f = { game, id, packet };
  w.start();
  await w.settle(); assert.deepEqual(errors, []); assert.equal(windows.length, 1);
  const main = windows[0], event = { sender: main.webContents, senderFrame: main.webContents.mainFrame };
  const invoke = (method, input) => handlers.get('nvu:windows')(event, { method, input });
  assert.equal(main.options.webPreferences.sandbox, true); assert.equal(main.options.webPreferences.nodeIntegration, false);
  await invoke('syncScope', scope); await assert.rejects(invoke('start', scope), /Prepare o ATS/);
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
  fs.writeFileSync(path.join(bridge, 'ats.heartbeat.json'), JSON.stringify(f.packet({ token: bridgeToken, at: Date.now(), pluginVersion:PLUGIN,origin:'QA origem',destination:'QA destino' })));
  const poll = timers.find(timer => timer.ms === 1000).fn; await poll();assert.equal(current().connected,true);assert.equal(current().integration.phase,'connected');assert.equal(current().appVersion,pkg.version);assert.equal(current().telemetryPluginVersion,PLUGIN);assert.equal(windows.length,3);assert.equal(windows[2].options.focusable,false);assert.equal(windows[2].ignored,true);
  await invoke('showOverlay');w.state.focusAllowed=false;await assert.rejects(action('game'),/Windows não liberou/);assert.equal(panel.isVisible(),true);w.state.focusAllowed=true;await action('game');assert.equal(opened.at(-1),'focus:ats');assert.equal(opened.filter(url=>url.startsWith('steam:')).length,1);assert.equal(panel.isVisible(),false);
  await assert.rejects(async()=>handlers.get('nvu:overlay')(overlayEvent,{action:'pause',contextKey:context(),arbitrary:true}),/DENIED/);await invoke('setTheme','dark');assert.equal(current().theme,'dark');await action('theme');assert.equal(current().theme,'light');assert.equal(JSON.parse(fs.readFileSync(path.join(user,'windows-preferences.json'))).theme,'light');
  await invoke('showOverlay');handlers.get('nvu:overlay:move')(overlayEvent,{x:250,y:45});assert.equal(JSON.parse(fs.readFileSync(path.join(user,'overlay.json'))).x,250);assert.throws(()=>handlers.get('nvu:overlay:move')(overlayEvent,{x:1,y:2,arbitrary:true}),/DENIED/);assert.throws(()=>handlers.get('nvu:overlay:move')({sender:{},senderFrame:{}},{x:1,y:2}),/DENIED/);await assert.rejects(invoke('setTheme','invalid'),/THEME_INVALID/);
  fs.writeFileSync(path.join(bridge, `ats-${f.id}.delivery.json`), JSON.stringify({ version: 1, token: bridgeToken, simulatorKey: 'ats', type: 'job.delivered', eventId: f.id, capturedAt: Date.now(), origin: 'QA origem', destination: 'QA destino', amountCents: 10000, currency: 'USD', distanceKm: 12 }));
  await poll(); assert.equal(current().pending.length, 1); assert.equal(current().scope.progress, 0);
  w.state.confirm = 0; await action('stop'); assert.equal(current().active, true);
  const stale = context(); await invoke('syncScope', { ...scope, companyId: 'qa-other-company' });
  await assert.rejects(async () => handlers.get('nvu:overlay')(overlayEvent, { action: 'stop', contextKey: stale }), /contexto mudou/);
  await assert.rejects(handlers.get('nvu:windows')({ sender: {}, senderFrame: {} }, { method: 'status' }), /REJECTED/);
  await invoke('start', { ...scope, companyId: 'qa-other-company' }); w.state.confirm = 1; await action('stop'); assert.equal(current().active, false);
  assert.equal(current().pending.length, 1); assert.equal(current().pending[0].scope.companyId, scope.companyId);
  await handlers.get('nvu:overlay')(overlayEvent,{action:'collapse'});assert.equal(panel.isVisible(),false);shortcuts.get('CommandOrControl+N')();assert.equal(panel.isVisible(),true);shortcuts.get('CommandOrControl+N')();assert.equal(panel.isVisible(),false);assert.equal(shortcuts.has('CommandOrControl+Alt+PageDown'),false);
  w.state.running = ['ats']; await assert.rejects(invoke('removePlugin', { key: 'ats', root: f.game }), /Feche o ATS/);
  w.app.emit('before-quit');
});
