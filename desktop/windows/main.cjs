const { app, BrowserWindow, ipcMain, protocol, session, screen, globalShortcut, shell, dialog, safeStorage, net, Tray, Menu, nativeImage, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomBytes, createHash } = require('node:crypto');
const { execFileSync, execFile } = require('node:child_process');
const execAsync = require('node:util').promisify(execFile);
const { Session, atomic } = require('./core/session.cjs');
const { games, realGame, pluginAction } = require('./core/games.cjs');
const { GoogleAuth } = require('./core/google-auth.cjs');
const { Integration, BridgeReader } = require('./core/integration.cjs');
const { OverlayController } = require('./core/overlay-controller.cjs');
const { AutomationCommands } = require('./core/automation-commands.cjs');
const { assistantView, AssistantNotices } = require('./core/assistant.cjs');
const { TELEMETRY_PLUGIN_VERSION } = require('./core/telemetry-version.cjs');
const { focusGameWindow } = require('./core/game-window.cjs');
protocol.registerSchemesAsPrivileged([{ scheme: 'nvu', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
app.setName('NVU PRO');
if (!app.requestSingleInstanceLock()) app.quit();
let main, floater, commands, integration, reader, store, google, bridgeDir, bridgeToken, currentUid = '', scope = null, quitting = false, busy = false;
let diagnostic = '', savedBounds = null, tray, notices, theme = 'light', preferencesFile;
const shortcutIssues = new Set();
const appURL = 'nvu://app';
const packaged = (relative) => app.isPackaged ? path.join(process.resourcesPath, relative) : path.join(__dirname, relative === 'web' ? '../../dist' : relative);
const allowedMain = event => event.sender === main?.webContents && event.senderFrame === main.webContents.mainFrame
  && event.senderFrame.url.startsWith(`${appURL}/`);
function overlayContext() { const s = store.live || scope; return createHash('sha256').update(JSON.stringify([currentUid, s?.companyId, s?.jobId, s?.contractId, s?.simulatorKey, store.live?.epoch || 'inactive'])).digest('hex'); }
function currentGame() { return store.live?.simulatorKey || scope?.simulatorKey; }
function status() {
 const key=currentGame(),connected=store.connected(key),connection=games[key]?integration?.status(key,store,reader?.rejections[key]):null;
 return {...store.status(currentUid),appVersion:app.getVersion(),telemetryPluginVersion:TELEMETRY_PLUGIN_VERSION,theme,connected,paused:store.heartbeats[key]?.paused===true,diagnostic,integration:connection,shortcutIssues:[...shortcutIssues],assistant:assistantView({store,scope,connected,connection,theme})};
}
function emit() {
 const s=status(),selected=s.scope||scope;if(main&&!main.isDestroyed())main.webContents.send('nvu:windows:update',s);
 const pending=s.pending.filter(row=>require('./core/session.cjs').sameScope(row.scope,selected));
 const notice=notices?.update({view:s.assistant,store,scope,connected:s.connected})||null;
 floater?.update({active:s.active,enabled:s.enabled,connected:s.connected,paused:s.paused,theme,assistant:s.assistant,notice,shortcutIssues:s.shortcutIssues,contextKey:overlayContext(),ready:!!selected&&!selected.closed&&require('./core/session.cjs').validScope(selected),name:selected?.operationName||'Selecione uma operação',simulatorKey:selected?.simulatorKey||'',progress:selected?.progress||0,total:selected?.total||0,pending:pending.length,connection:s.integration});
}
function registerShortcut(key,fn){if(globalShortcut.register(key,fn)===false)shortcutIssues.add(key);else shortcutIssues.delete(key);}
function setTheme(next){
 if(!['light','dark'].includes(next))throw Error('WINDOWS_THEME_INVALID');
 if(theme===next)return;theme=next;atomic(preferencesFile,{version:1,theme});emit();
}
async function openSimulator(key){
 if(!Object.hasOwn(games,key))throw Error('GAME_INVALID');await integration.refreshProcesses(true);
 if(store.connected(key)||integration.running?.includes(key)){
  let result;try{result=await focusGameWindow(key);}catch{throw Error('Não foi possível retornar ao simulador. Use Alt+Tab para selecionar o jogo.');}
  if(result.found){if(!result.focused)throw Error('O Windows não liberou o foco do jogo. Use Alt+Tab para voltar ao simulador.');floater.hide();main.hide();return;}
 }
 await shell.openExternal(`steam://rungameid/${games[key].steamId}`);floater.hide();
}
function navigate(action) { floater?.hide(); main.show(); main.focus(); main.webContents.send('nvu:windows:navigate', { action, scope: store.live || scope }); }
function startCurrent(input) {
  return commands.start(input);
}
function showOverlay() {
  if (!currentUid) { main?.show(); return; }
  floater.show(); emit();
}
function secureBridgeDirectory() {
  bridgeDir = path.join(app.getPath('appData'), '..', 'Local', 'NVU', 'pro-telemetry');
  // Use the actual Windows LocalAppData known-folder path when roaming/local live on different drives.
  if (process.env.LOCALAPPDATA) bridgeDir = path.join(process.env.LOCALAPPDATA, 'NVU', 'pro-telemetry');
  fs.mkdirSync(bridgeDir, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(bridgeDir).isSymbolicLink() || fs.realpathSync(bridgeDir).toLowerCase() !== path.resolve(bridgeDir).toLowerCase()) throw Error('WINDOWS_BRIDGE_REDIRECTED');
  // Per-user filesystem IPC: remove inherited access and grant current Windows SID + SYSTEM only.
  const who = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value | ConvertTo-Json'], { encoding: 'utf8', windowsHide: true }).trim());
  if (!/^S-1-5-\d+(?:-\d+)+$/.test(who)) throw Error('WINDOWS_SID_INVALID');
  execFileSync('icacls.exe', [bridgeDir, '/inheritance:r', '/grant:r', `*${who}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { windowsHide: true, stdio: 'pipe' });
  const file = path.join(bridgeDir, 'bridge.token');
  bridgeToken = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : randomBytes(32).toString('hex');
  if (!/^[a-f0-9]{64}$/.test(bridgeToken)) throw Error('WINDOWS_BRIDGE_TOKEN_INVALID');
  fs.writeFileSync(file, bridgeToken, { mode: 0o600 });
}
async function poll() {
  if (busy) return; busy = true;
  try {
    reader.poll(store); diagnostic = reader.message;
    if (currentUid && !store.connected(currentGame())) await integration.refreshProcesses();
  } catch { diagnostic = 'Um evento local precisa de conferência. Os dados foram preservados.'; }
  finally { busy = false; emit(); }
}
app.on('second-instance', () => { main?.show(); main?.focus(); });
app.whenReady().then(async () => {
  if (process.platform !== 'win32') { dialog.showErrorBox('NVU Windows', 'Esta edição requer Windows x64.'); app.quit(); return; }
  secureBridgeDirectory();
  const dataDir = app.getPath('userData');
  store = new Session(path.join(dataDir, 'pro-journal.json'));
  notices = new AssistantNotices(path.join(dataDir, 'assistant-notices.json'));
  preferencesFile = path.join(dataDir, 'windows-preferences.json');
  try { theme = JSON.parse(fs.readFileSync(preferencesFile, 'utf8')).theme === 'dark' ? 'dark' : 'light'; } catch { /* First run. */ }
  const dll = app.isPackaged ? packaged('plugin/nvu_scs_telemetry.dll') : path.join(__dirname, 'plugin/bin/nvu_scs_telemetry.dll');
  let steamRoot = '';
  try { steamRoot = execFileSync('reg.exe', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { encoding: 'utf8', windowsHide: true }).match(/SteamPath\s+REG_SZ\s+(.+)/)?.[1]?.trim() || ''; } catch { /* Manual selection remains available. */ }
  integration = new Integration({ file: path.join(dataDir, 'games.json'), dll, version: TELEMETRY_PLUGIN_VERSION, documents: app.getPath('documents'),
    roots: [steamRoot, path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam'), path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Steam')],
    processes: async () => {
      const { stdout } = await execAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "@(@(Get-Process -Name amtrucks,eurotrucks2 -ErrorAction SilentlyContinue) | ForEach-Object { $_.ProcessName }) | ConvertTo-Json -Compress"], { windowsHide: true, timeout: 4000, encoding: 'utf8' });
      const names = stdout.trim() ? JSON.parse(stdout) : []; return [names].flat().flatMap(name => String(name).toLowerCase() === 'amtrucks' ? ['ats'] : String(name).toLowerCase() === 'eurotrucks2' ? ['ets2'] : []);
    } });
  commands = new AutomationCommands({ store, integration, getScope: () => scope, getUid: () => currentUid, status, emit, show: () => floater.ensure(), navigate,
    openGame: openSimulator,
    confirmStop: async () => (await dialog.showMessageBox(floater?.opened ? floater.panel : main, { type: 'question', buttons: ['Continuar PRO', 'Encerrar PRO'], defaultId: 0, cancelId: 0,
      message: 'Encerrar a automação PRO?', detail: 'As viagens pendentes serão preservadas. A operação NVU continua disponível no painel.' })).response === 1 });
  reader = new BridgeReader(bridgeDir, bridgeToken);
  try { savedBounds = JSON.parse(fs.readFileSync(path.join(dataDir, 'overlay.json'), 'utf8')); } catch { /* initial position */ }
  const cfgFile = path.join(dataDir, 'google-oauth.json');
  const config = JSON.parse(fs.readFileSync(fs.existsSync(cfgFile) ? cfgFile : path.join(__dirname, 'config/google-oauth.json'), 'utf8'));
  config.clientId = process.env.NVU_GOOGLE_DESKTOP_CLIENT_ID || config.clientId;
  config.clientSecret = process.env.NVU_GOOGLE_DESKTOP_CLIENT_SECRET || config.clientSecret;
  google = new GoogleAuth({ config, vault: path.join(dataDir, 'google-session.enc'), safeStorage, openExternal: url => shell.openExternal(url) });
  const web = fs.realpathSync(packaged('web'));
  const index = fs.readFileSync(path.join(web, 'index.html'), 'utf8');
  const crypto = require('node:crypto');
  const hashes = [...index.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
  const csp = `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' ${hashes.join(' ')}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self' https://*.googleapis.com https://*.googleusercontent.com https://*.firebaseio.com wss://*.firebaseio.com https://*.cloudfunctions.net https://*.run.app https://*.firebaseapp.com; frame-src https://*.firebaseapp.com; object-src 'none'; base-uri 'self'`;
  protocol.handle('nvu', async request => {
    const url = new URL(request.url); if (url.host !== 'app' || request.method !== 'GET') return new Response('', { status: 403 });
    let decoded; try { decoded = decodeURIComponent(url.pathname); } catch { return new Response('', { status: 400 }); }
    const candidate = path.resolve(web, `.${decoded}`);
    if (!candidate.startsWith(`${web}${path.sep}`) && candidate !== web) return new Response('', { status: 403 });
    const exists = fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    if (!exists && path.extname(candidate)) return new Response('', { status: 404 });
    const file = exists ? candidate : path.join(web, 'index.html');
    if (!fs.realpathSync(file).startsWith(`${web}${path.sep}`)) return new Response('', { status: 403 });
    const response = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(response.headers); headers.set('Content-Security-Policy', csp);
    return new Response(response.body, { status: response.status, headers });
  });
  session.defaultSession.setPermissionRequestHandler((_, __, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  main = new BrowserWindow({ width: 1200, height: 800, minWidth: 800, minHeight: 560, backgroundColor: '#102e39',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true,
      sandbox: true, webSecurity: true, backgroundThrottling: false } });
  main.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  main.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`${appURL}/`)) e.preventDefault(); });
  main.on('close', e => { if (store.live && !quitting) { e.preventDefault(); main.hide(); } });
  main.on('closed', () => app.quit());
  floater = new OverlayController({ savedBounds, displays: () => screen.getAllDisplays().map(d => d.workArea), cursor: () => screen.getCursorScreenPoint(),
    save: bounds => atomic(path.join(dataDir, 'overlay.json'), bounds),
    createWindow: (surface, bounds) => {
      const w = new BrowserWindow({ ...bounds, frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false, roundedCorners: false, thickFrame: false,
        focusable: surface === 'panel', hasShadow: false, show: false,
        backgroundColor: '#00000000', webPreferences: { preload: path.join(__dirname, 'ui/overlay-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } });
      if(surface==='panel')w.webContents.on('before-input-event',(event,input)=>{if(!(input.control&&!input.alt&&!input.meta&&String(input.key).toLowerCase()==='n'))event.preventDefault();});
      w.setAlwaysOnTop(true, 'screen-saver'); w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      w.webContents.on('will-navigate', event => event.preventDefault());
      void w.loadFile(path.join(__dirname, 'ui/overlay.html'), { query: { surface } }); return w;
    }, actions: action => action==='theme'?setTheme(theme==='dark'?'light':'dark'):commands.execute(action) });
  Menu.setApplicationMenu(null);
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'ui/tray.png')));
  tray.setToolTip('NVU PRO Windows');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir NVU', click: () => { main.show(); main.focus(); } },
    { label: 'Abrir assistente de viagem', click: showOverlay },
    { label: 'Pausar automação', click: () => { store.pause(); emit(); } },
    { label: 'Sair da NVU', click: () => app.quit() },
  ]));
  tray.on('double-click', () => { main.show(); main.focus(); });
  ipcMain.handle('nvu:windows', async (event, request) => {
    if (!allowedMain(event) || !request || typeof request.method !== 'string' || JSON.stringify(request).length > 32768) throw Error('WINDOWS_IPC_REJECTED');
    const { method, input } = request;
    switch (method) {
      case 'signIn': return google.signIn();
      case 'restoreAuth': return google.restore();
      case 'signOut': store.stop(); currentUid = ''; scope = null; floater.hide(); google.clear(); emit(); return;
      case 'syncScope': { const previousUid=currentUid; scope=input; currentUid=typeof input?.driverId==='string'?input.driverId:''; store.syncScope(input); if(!currentUid||currentUid!==previousUid)floater.hide(); emit(); return status(); }
      case 'status': return status();
      case 'start':
        return startCurrent(input);
      case 'pause': return commands.execute('pause');
      case 'stop': return commands.execute('stop');
      case 'acknowledge': store.acknowledge(currentUid, input.id, input); emit(); return;
      case 'showOverlay': showOverlay(); return;
      case 'openGame': return openSimulator(input);
      case 'setTheme': return setTheme(input);
      case 'chooseGame': { if(!input||!Object.hasOwn(games,input.key)||typeof input.root!=='string'||input.root.length>4096)throw Error('GAME_INVALID');integration.remember(input);emit();return integration.refreshGames(); }
      case 'discoverGames': return integration.refreshGames();
      case 'diagnose': case 'copyDiagnostics': {
        if (!games[input]) throw Error('GAME_INVALID'); await integration.refreshProcesses(true);
        const report = { appVersion: app.getVersion(), ...integration.diagnostic(input, store, reader.rejections[input]) };
        if (method === 'copyDiagnostics') clipboard.writeText(JSON.stringify(report, null, 2)); return report;
      }
      case 'selectGame': {
        if (!games[input]) throw Error('GAME_INVALID');
        const picked = await dialog.showOpenDialog(main, { title: `Pasta do ${games[input].folder}`, properties: ['openDirectory'] });
        if (picked.canceled) return null;
        const game = { key: input, root: realGame(picked.filePaths[0], input), label: games[input].folder }; integration.remember(game); return game;
      }
      case 'installPlugin': case 'removePlugin': {
        if (!input || !games[input.key]) throw Error('GAME_INVALID');
        await integration.refreshProcesses(true);
        if (store.connected(input.key) || integration.running?.includes(input.key)) throw Error(`Feche o ${input.key.toUpperCase()} antes de instalar, atualizar ou remover o plugin.`);
        const result = await dialog.showMessageBox(main, { type: 'question', buttons: ['Cancelar', method === 'installPlugin' ? 'Instalar' : 'Remover'], defaultId: 0,
          message: `Plugin NVU — ${games[input.key].folder}`, detail: `Destino: ${realGame(input.root, input.key)}\nReinicie o simulador após esta ação.` });
        if (result.response !== 1) return { cancelled: true };
        try { const result = pluginAction(input.root, input.key, dll, method === 'removePlugin'); integration.remember(input); emit(); return result; }
        catch (error) { if (error.code === 'EACCES' || error.code === 'EPERM') throw Error('Sem permissão para modificar esta pasta. Solicite ao administrador a instalação somente do plugin.'); throw error; }
      }
      default: throw Error('WINDOWS_IPC_METHOD_DENIED');
    }
  });
  ipcMain.handle('nvu:overlay', (event, request) => {
    if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).some(key=>!['action','contextKey'].includes(key))||JSON.stringify(request).length>512)throw Error('OVERLAY_ACTION_DENIED');
    const { action, contextKey } = request;
    if (typeof action !== 'string' || action.length > 32 || (contextKey !== undefined && (typeof contextKey !== 'string' || contextKey.length > 64))) throw Error('OVERLAY_ACTION_DENIED');
    if (['pause', 'resume', 'stop', 'panel', 'trips', 'setup', 'game'].includes(action) && contextKey !== overlayContext()) { emit(); throw Error('O contexto mudou. Abra novamente as ações da NVU.'); }
    return floater.command(floater.surface(event), action).catch(error => { diagnostic = String(error.message).slice(0, 240); emit(); throw error; });
  });
  ipcMain.handle('nvu:overlay:move',(event,position)=>{
    if(floater.surface(event)!=='panel'||!position||typeof position!=='object'||Array.isArray(position)||Object.keys(position).sort().join(',')!=='x,y'||!['x','y'].every(k=>Number.isSafeInteger(position[k])&&Math.abs(position[k])<=100000))throw Error('OVERLAY_POSITION_DENIED');
    floater.move(position);
  });
  registerShortcut('CommandOrControl+N', () => { if (currentUid) floater.toggle(); else main.show(); });
  for (const e of ['display-removed', 'display-metrics-changed']) screen.on(e, () => {
    floater.layout();emit();
  });
  await main.loadURL(`${appURL}/`); setInterval(poll, 1000).unref(); setInterval(() => floater.tick(), 1000).unref();
}).catch(() => { dialog.showErrorBox('NVU Windows', 'A inicialização segura falhou. Verifique a instalação e as permissões da pasta NVU.'); app.quit(); });
app.on('before-quit', () => { quitting = true; store?.stop(); globalShortcut.unregisterAll(); floater?.destroy(); tray?.destroy(); });
app.on('window-all-closed', () => app.quit());
