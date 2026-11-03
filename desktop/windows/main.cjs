'use strict';
const { app, BrowserWindow, ipcMain, protocol, session, screen, globalShortcut, shell, dialog, safeStorage, net, Tray, Menu, nativeImage, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomBytes, createHash } = require('node:crypto');
const { execFileSync, execFile } = require('node:child_process');
const execAsync = require('node:util').promisify(execFile);
const pkg = require('./package.json');
const { Session, atomic, sameScope, validScope } = require('./core/session.cjs');
const { games, realGame } = require('./core/games.cjs');
const { installPlugin, removePlugin } = require('./core/plugin-install.cjs');
const { GoogleAuth } = require('./core/google-auth.cjs');
const { Integration, BridgeReader } = require('./core/integration.cjs');
const { OverlayController } = require('./core/overlay-controller.cjs');
const { AutomationCommands } = require('./core/automation-commands.cjs');
const { assistantView, AssistantNotices } = require('./core/assistant.cjs');
const { TELEMETRY_PLUGIN_VERSION } = require('./core/telemetry-version.cjs');
const { focusGameWindow } = require('./core/game-window.cjs');
const { parseCli } = require('./core/cli.cjs');
const { NvuError, describe } = require('./core/errors.cjs');
const { createLogger } = require('./core/logging.cjs');
const { redactDeep } = require('./core/redact.cjs');
const { pluginPackage, collectVersions } = require('./core/versions.cjs');
const { runStartup, presentStartupFailure, diagnosticBundle } = require('./core/startup.cjs');
const { createInstance } = require('./core/instance.cjs');
const { findRunningNvu, instanceRegistry, readPackageFromInstall } = require('./core/process-list.cjs');
const { runElevatedPlugin, requestElevation, encodeRequest, messageFor, EXIT } = require('./core/elevated-plugin.cjs');
const { prepareSimulator, removeSimulatorPlugin } = require('./core/prepare.cjs');
const { windowsPowerShellEnv } = require('./core/powershell-env.cjs');
const { checkForUpdate, createFetchJson, isTrustedReleaseUrl, validState } = require('./core/update-check.cjs');

const appURL = 'nvu://app';
// Must be declared before the app is ready, also in the process that will immediately leave.
protocol.registerSchemesAsPrivileged([{ scheme: 'nvu', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
app.setName('NVU PRO');
const cli = parseCli(process.argv);

// ---- runtime state (assigned by the start-up steps) ----
let main, floater, commands, integration, reader, store, google, bridgeDir, bridgeToken, currentUid = '', scope = null, quitting = false, busy = false;
let diagnostic = '', savedBounds = null, tray, notices, theme = 'light', preferencesFile, logger, startupReport = null, versionInfo = null, packagedPlugin = null;
let dataDir, webDir, csp = '', registry = null, selfIdentity = null, updateInfo = null, updateState = null;
const shortcutIssues = new Set();
const packaged = relative => app.isPackaged ? path.join(process.resourcesPath, relative) : path.join(__dirname, relative === 'web' ? '../../dist' : relative);
const pluginDirectory = () => app.isPackaged ? path.join(process.resourcesPath, 'plugin') : path.join(__dirname, 'plugin/bin');
const allowedMain = event => event.sender === main?.webContents && event.senderFrame === main.webContents.mainFrame
  && event.senderFrame.url.startsWith(`${appURL}/`);

// ---- helpers shared by the commands ----
function overlayContext() { const s = store.live || scope; return createHash('sha256').update(JSON.stringify([currentUid, s?.companyId, s?.jobId, s?.contractId, s?.simulatorKey, store.live?.epoch || 'inactive'])).digest('hex'); }
function currentGame() { return store.live?.simulatorKey || scope?.simulatorKey; }
function versionsView() {
  const perGame = Object.fromEntries(Object.keys(games).map(key => { const s = integration?.status(key, store, reader?.rejections[key]); return [key, s ? { state: s.state, code: s.code, versions: s.versions, gameStartedAt: s.gameStartedAt, root: s.game?.root || null } : null]; }));
  return { ...versionInfo, games: perGame };
}
function startupSummary() {
  if (!startupReport) return null;
  return { ok: startupReport.ok, finishedAt: startupReport.finishedAt, warnings: startupReport.warnings, steps: startupReport.steps.map(s => ({ id: s.id, ok: s.ok, warning: s.warning, code: s.code, ms: s.ms })) };
}
// ---- aviso de nova versão: só AVISA (nunca baixa nem instala); consulta a lista pública de releases, no máximo a cada 12 h ----
const updateDisabled = () => process.env.NVU_NO_UPDATE_CHECK === '1' || !app.isPackaged;
function readUpdateState() {
  try { return validState(JSON.parse(fs.readFileSync(path.join(dataDir, 'update-check.json'), 'utf8'))); } catch { return null; }
}
async function runUpdateCheck() {
  if (updateDisabled() || !dataDir) return updateInfo;
  try {
    updateState = updateState || readUpdateState();
    const result = await checkForUpdate({ currentVersion: app.getVersion(), state: updateState,
      fetchJson: createFetchJson({ fetchImpl: (url, options) => net.fetch(url, options), userAgent: `NVU-PRO-Windows/${app.getVersion()}` }) });
    updateState = result.state; updateInfo = result.info;
    if (!result.cached) {
      try { atomic(path.join(dataDir, 'update-check.json'), updateState); } catch { /* best effort */ }
      logger?.info('update.check', { status: updateInfo.status, available: updateInfo.available === true, latest: updateInfo.latest?.version || null, reason: updateInfo.reason || updateInfo.lastError || null });
    }
    refreshTray(); emit();
  } catch (error) { logger?.warn('update.check_failed', { message: String(error?.message || error).slice(0, 200) }); }
  return updateInfo;
}
function scheduleUpdateChecks() {
  if (updateDisabled()) { logger?.info('update.disabled', { reason: process.env.NVU_NO_UPDATE_CHECK === '1' ? 'env' : 'not_packaged' }); return; }
  setTimeout(() => void runUpdateCheck(), 30000).unref();
  setInterval(() => void runUpdateCheck(), 6 * 3600e3).unref();   // the 12 h throttle decides whether it really asks
}
async function openUpdatePage() {
  const url = updateInfo?.available ? updateInfo.latest?.url : null;
  if (!isTrustedReleaseUrl(url)) throw Error('UPDATE_PAGE_UNAVAILABLE');
  await shell.openExternal(url); logger?.info('update.page_opened', { version: updateInfo.latest.version }); return true;
}
function trayMenuTemplate() {
  const items = [{ label: `NVU PRO ${app.getVersion()}`, enabled: false }];
  if (updateInfo?.available && updateInfo.latest) items.push({ label: `Nova versão ${updateInfo.latest.version} disponível — abrir página`, click: () => { void openUpdatePage().catch(() => {}); } });
  items.push({ label: 'Abrir NVU', click: showMainWindow }, { label: 'Abrir assistente de viagem', click: showOverlay },
    { label: 'Pausar automação', click: () => { store.pause(); emit(); } }, { label: 'Sair da NVU', click: () => gracefulQuit('tray') });
  return items;
}
function refreshTray() { try { tray?.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate())); } catch { /* the tray is optional */ } }
function status() {
  const key = currentGame(), connected = store.connected(key), connection = games[key] ? integration?.status(key, store, reader?.rejections[key]) : null;
  return { ...store.status(currentUid), appVersion: app.getVersion(), telemetryPluginVersion: TELEMETRY_PLUGIN_VERSION, versions: versionsView(), startup: startupSummary(), update: updateInfo, theme, connected,
    paused: store.heartbeats[key]?.paused === true, diagnostic, integration: connection, shortcutIssues: [...shortcutIssues], assistant: assistantView({ store, scope, connected, connection, theme }) };
}
function emit() {
  const s = status(), selected = s.scope || scope;
  if (main && !main.isDestroyed()) main.webContents.send('nvu:windows:update', s);
  const pending = s.pending.filter(row => sameScope(row.scope, selected));
  const notice = notices?.update({ view: s.assistant, store, scope, connected: s.connected }) || null;
  floater?.update({ active: s.active, enabled: s.enabled, connected: s.connected, paused: s.paused, theme, assistant: s.assistant, notice, shortcutIssues: s.shortcutIssues, contextKey: overlayContext(),
    ready: !!selected && !selected.closed && validScope(selected), name: selected?.operationName || 'Selecione uma operação', simulatorKey: selected?.simulatorKey || '', progress: selected?.progress || 0,
    total: selected?.total || 0, pending: pending.length, connection: s.integration });
}
function registerShortcut(key, fn) { if (globalShortcut.register(key, fn) === false) shortcutIssues.add(key); else shortcutIssues.delete(key); }
function setTheme(next) {
  if (!['light', 'dark'].includes(next)) throw Error('WINDOWS_THEME_INVALID');
  if (theme === next) return; theme = next; atomic(preferencesFile, { version: 1, theme }); emit();
}
async function openSimulator(key) {
  if (!Object.hasOwn(games, key)) throw Error('GAME_INVALID'); await integration.refreshProcesses(true);
  if (store.connected(key) || integration.running?.includes(key)) {
    let result; try { result = await focusGameWindow(key); } catch { throw Error('Não foi possível retornar ao simulador. Use Alt+Tab para selecionar o jogo.'); }
    if (result.found) { if (!result.focused) throw Error('O Windows não liberou o foco do jogo. Use Alt+Tab para voltar ao simulador.'); floater.hide(); main.hide(); return; }
  }
  await shell.openExternal(`steam://rungameid/${games[key].steamId}`); floater.hide();
}
function showMainWindow() { if (!main || main.isDestroyed()) return; if (main.isMinimized?.()) main.restore(); main.show(); main.focus(); }
function navigate(action) { floater?.hide(); showMainWindow(); main.webContents.send('nvu:windows:navigate', { action, scope: store.live || scope }); }
function showOverlay() { if (!currentUid) { showMainWindow(); return; } floater.show(); emit(); }
function gracefulQuit(reason) { logger?.info('app.quit', { reason }); quitting = true; try { store?.stop(); } catch { /* the journal is already durable */ } app.quit(); }

// ---- local bridge with the game plugin ----
function secureBridgeDirectory() {
  const base = process.env.LOCALAPPDATA || path.join(app.getPath('appData'), '..', 'Local');
  const root = path.join(base, 'NVU'), dir = path.join(root, 'pro-telemetry');
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch (error) { throw new NvuError('NVU-S040', `Não foi possível criar ${dir}: ${error.code || error.message}`, { cause: error }); }
  // Only the NVU folders are checked for links: the profile itself may legitimately live behind a junction.
  for (const p of [root, dir]) if (fs.lstatSync(p).isSymbolicLink()) throw new NvuError('NVU-S040', `${p} é um link/junção e não pode ser usada.`, { details: { path: p } });
  if (fs.realpathSync(dir).toLowerCase() !== path.join(fs.realpathSync(base), 'NVU', 'pro-telemetry').toLowerCase()) throw new NvuError('NVU-S040', 'A pasta de comunicação está redirecionada.', { details: { path: dir } });
  bridgeDir = dir;
  // Per-user filesystem IPC: remove inherited access and grant the current Windows SID + SYSTEM only (no PowerShell needed).
  let sid = '';
  try { sid = String(execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true, timeout: 10000 })).match(/S-1-5-\d+(?:-\d+)+/)?.[0] || ''; }
  catch (error) { throw new NvuError('NVU-S041', `whoami.exe falhou: ${String(error.message).slice(0, 160)}`, { cause: error }); }
  if (!sid) throw new NvuError('NVU-S041', 'Não foi possível identificar o usuário do Windows (SID).');
  try { execFileSync('icacls.exe', [dir, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { windowsHide: true, stdio: 'pipe', timeout: 15000 }); }
  catch (error) { throw new NvuError('NVU-S041', `icacls.exe falhou: ${String(error.stderr || error.message).slice(0, 160)}`, { cause: error }); }
  const file = path.join(dir, 'bridge.token');
  let token = ''; try { token = fs.readFileSync(file, 'utf8').trim(); } catch { /* first run */ }
  if (!/^[a-f0-9]{64}$/.test(token)) {
    // The key is not user data: keep the unreadable file for inspection and create a new key (the plugin re-reads it every second).
    if (token) { try { fs.renameSync(file, `${file}.invalid-${Date.now()}`); } catch { /* best effort */ } logger.warn('bridge.token_regenerated', {}); }
    token = randomBytes(32).toString('hex');
    try { fs.writeFileSync(file, token, { mode: 0o600 }); } catch (error) { throw new NvuError('NVU-S042', `Não foi possível gravar a chave local: ${error.code || error.message}`, { cause: error }); }
  }
  bridgeToken = token;
}
async function poll() {
  if (busy) return; busy = true;
  try {
    reader.poll(store); diagnostic = reader.message;
    if (currentUid && !store.connected(currentGame())) await integration.refreshProcesses();
  } catch { diagnostic = 'Um evento local precisa de conferência. Os dados foram preservados.'; }
  finally { busy = false; emit(); }
}
async function listGameProcesses() {
  const script = "@(Get-Process -Name amtrucks,eurotrucks2 -ErrorAction SilentlyContinue | ForEach-Object { $s=$null; try { $s=$_.StartTime.ToUniversalTime().ToString('o') } catch {}; [pscustomobject]@{ name=$_.ProcessName; start=$s } }) | ConvertTo-Json -Compress";
  const { stdout } = await execAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 4000, encoding: 'utf8', env: windowsPowerShellEnv() });
  const rows = stdout.trim() ? JSON.parse(stdout) : [];
  return [rows].flat().flatMap(row => {
    const name = String(typeof row === 'string' ? row : row?.name || '').toLowerCase(), key = name === 'amtrucks' ? 'ats' : name === 'eurotrucks2' ? 'ets2' : null;
    return key ? [{ key, startedAt: typeof row === 'object' ? row.start || null : null }] : [];
  });
}

// ---- plugin preparation / removal (single flow shared by the interface and the legacy commands) ----
function prepareDeps() {
  return { integration, store, dll: path.join(pluginDirectory(), 'nvu_scs_telemetry.dll'), version: TELEMETRY_PLUGIN_VERSION, logger,
    install: installPlugin, remove: removePlugin,
    elevate: async ({ action, key, root }) => {
      const request = encodeRequest({ key, root, action }, { expectedSha256: integration.expectedHash, version: TELEMETRY_PLUGIN_VERSION });
      const flag = `--nvu-elevated-plugin=${request}`;
      // Packaged: NVU PRO.exe <flag>. Development: electron.exe <app folder> <flag>.
      const args = process.defaultApp ? [app.getAppPath(), flag] : [flag];
      return requestElevation({ exe: process.execPath, args });
    }, messageFor };
}

// ---- start-up steps ----
function startupSteps() {
  return [
    { id: 'platform', title: 'Sistema operacional', run: async () => { if (process.platform !== 'win32') throw new NvuError('NVU-S010', 'Esta edição requer Windows x64.'); return { platform: process.platform, arch: process.arch }; } },
    { id: 'data-dir', title: 'Pasta de dados da NVU', run: async () => {
      dataDir = app.getPath('userData');
      try { fs.mkdirSync(dataDir, { recursive: true }); const probe = path.join(dataDir, `.write-test-${process.pid}`); fs.writeFileSync(probe, 'ok'); fs.unlinkSync(probe); }
      catch (error) { throw new NvuError('NVU-S020', `${dataDir}: ${error.code || error.message}`, { cause: error }); }
      return { dir: dataDir }; } },
    { id: 'versions', title: 'Versões do aplicativo e do plugin empacotado', fatal: false, code: 'NVU-S060', run: async () => {
      try { webDir = fs.realpathSync(packaged('web')); } catch { webDir = packaged('web'); }
      packagedPlugin = pluginPackage(path.join(pluginDirectory(), 'nvu_scs_telemetry.dll'), path.join(pluginDirectory(), 'nvu_scs_telemetry.manifest.json'), TELEMETRY_PLUGIN_VERSION, fs);
      versionInfo = collectVersions({ app, process, webDir, plugin: packagedPlugin, pkg, packaged: app.isPackaged });
      logger.info('versions', versionInfo);
      if (packagedPlugin.problem) throw new NvuError('NVU-S060', `Plugin empacotado: ${packagedPlugin.problem}`, { fatal: false, details: packagedPlugin });
      return { app: versionInfo.app.version, web: versionInfo.web.version, plugin: packagedPlugin.version }; } },
    { id: 'bridge', title: 'Comunicação local com o plugin', run: async () => { secureBridgeDirectory(); return { dir: bridgeDir }; } },
    { id: 'journal', title: 'Diário local de viagens', run: async () => {
      const file = path.join(dataDir, 'pro-journal.json');
      try { store = new Session(file); }
      catch (error) {
        let copy = ''; try { copy = `${file}.invalid-${new Date().toISOString().replace(/[:.]/g, '-')}`; fs.copyFileSync(file, copy); } catch { copy = ''; }
        throw new NvuError('NVU-S050', `pro-journal.json: ${error.message}${copy ? ` (cópia preservada em ${path.basename(copy)})` : ''}`, { cause: error, details: { copy: copy && path.basename(copy) } });
      }
      return { events: Object.keys(store.data.events).length }; } },
    { id: 'preferences', title: 'Preferências e avisos', fatal: false, run: async () => {
      notices = new AssistantNotices(path.join(dataDir, 'assistant-notices.json'));
      preferencesFile = path.join(dataDir, 'windows-preferences.json');
      try { theme = JSON.parse(fs.readFileSync(preferencesFile, 'utf8')).theme === 'dark' ? 'dark' : 'light'; } catch { /* First run. */ } } },
    { id: 'games', title: 'Simuladores e Steam', fatal: false, code: 'NVU-S110', run: async () => {
      const dll = path.join(pluginDirectory(), 'nvu_scs_telemetry.dll');
      let steamRoot = '';
      try { steamRoot = execFileSync('reg.exe', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { encoding: 'utf8', windowsHide: true }).match(/SteamPath\s+REG_SZ\s+(.+)/)?.[1]?.trim() || ''; } catch { /* Manual selection remains available. */ }
      integration = new Integration({ file: path.join(dataDir, 'games.json'), dll, version: TELEMETRY_PLUGIN_VERSION, documents: app.getPath('documents'),
        roots: [steamRoot, path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam'), path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Steam')],
        processes: listGameProcesses });
      commands = new AutomationCommands({ store, integration, getScope: () => scope, getUid: () => currentUid, status, emit, show: () => floater.ensure(), navigate, openGame: openSimulator,
        confirmStop: async () => (await dialog.showMessageBox(floater?.opened ? floater.panel : main, { type: 'question', buttons: ['Continuar PRO', 'Encerrar PRO'], defaultId: 0, cancelId: 0,
          message: 'Encerrar a automação PRO?', detail: 'As viagens pendentes serão preservadas. A operação NVU continua disponível no painel.' })).response === 1 });
      reader = new BridgeReader(bridgeDir, bridgeToken);
      try { savedBounds = JSON.parse(fs.readFileSync(path.join(dataDir, 'overlay.json'), 'utf8')); } catch { /* initial position */ }
      return { games: integration.games.map(g => ({ key: g.key, root: g.root })) }; } },
    { id: 'oauth-config', title: 'Configuração do login Google', fatal: false, code: 'NVU-S070', run: async () => {
      let config = {};
      try {
        const cfgFile = path.join(dataDir, 'google-oauth.json');
        config = JSON.parse(fs.readFileSync(fs.existsSync(cfgFile) ? cfgFile : path.join(__dirname, 'config/google-oauth.json'), 'utf8'));
      } finally {
        config.clientId = process.env.NVU_GOOGLE_DESKTOP_CLIENT_ID || config.clientId;
        config.clientSecret = process.env.NVU_GOOGLE_DESKTOP_CLIENT_SECRET || config.clientSecret;
        google = new GoogleAuth({ config, vault: path.join(dataDir, 'google-session.enc'), safeStorage, openExternal: url => shell.openExternal(url) });
      }
      return { clientConfigured: /\.apps\.googleusercontent\.com$/.test(config.clientId || '') }; } },
    { id: 'web', title: 'Arquivos da interface', run: async () => {
      try { webDir = fs.realpathSync(packaged('web')); } catch (error) { throw new NvuError('NVU-S080', `${packaged('web')}: ${error.code || error.message}`, { cause: error }); }
      let index; try { index = fs.readFileSync(path.join(webDir, 'index.html'), 'utf8'); } catch (error) { throw new NvuError('NVU-S080', `index.html: ${error.code || error.message}`, { cause: error }); }
      const hashes = [...index.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
      try {
        csp = `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' ${hashes.join(' ')}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; worker-src 'self' blob:; `
          + `connect-src 'self' data: blob: https://*.googleapis.com https://*.googleusercontent.com https://res.cloudinary.com https://*.firebaseio.com wss://*.firebaseio.com https://*.cloudfunctions.net https://*.run.app https://*.firebaseapp.com; `
          + `frame-src https://*.firebaseapp.com; object-src 'none'; base-uri 'self'`;
      } catch (error) { throw new NvuError('NVU-S081', String(error.message), { cause: error }); }
      if (!versionInfo?.web?.ok) logger.warn('web.build_info_missing', versionInfo?.web || {});
      return { dir: webDir, scriptHashes: hashes.length }; } },
    { id: 'protocol', title: 'Protocolo interno nvu://', run: async () => {
      protocol.handle('nvu', async request => {
        const url = new URL(request.url); if (url.host !== 'app' || request.method !== 'GET') return new Response('', { status: 403 });
        let decoded; try { decoded = decodeURIComponent(url.pathname); } catch { return new Response('', { status: 400 }); }
        const candidate = path.resolve(webDir, `.${decoded}`);
        if (!candidate.startsWith(`${webDir}${path.sep}`) && candidate !== webDir) return new Response('', { status: 403 });
        const exists = fs.existsSync(candidate) && fs.statSync(candidate).isFile();
        if (!exists && path.extname(candidate)) return new Response('', { status: 404 });
        const file = exists ? candidate : path.join(webDir, 'index.html');
        if (!fs.realpathSync(file).startsWith(`${webDir}${path.sep}`)) return new Response('', { status: 403 });
        const response = await net.fetch(pathToFileURL(file).toString());
        const headers = new Headers(response.headers); headers.set('Content-Security-Policy', csp);
        return new Response(response.body, { status: response.status, headers });
      });
      session.defaultSession.setPermissionRequestHandler((_, __, callback) => callback(false));
      session.defaultSession.setPermissionCheckHandler(() => false); } },
    { id: 'window', title: 'Janela principal', run: async () => {
      main = new BrowserWindow({ width: 1200, height: 800, minWidth: 800, minHeight: 560, backgroundColor: '#102e39',
        webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: false } });
      main.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      main.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`${appURL}/`)) e.preventDefault(); });
      // While a PRO session is live the window hides to the tray instead of closing; "Sair da NVU" in the tray really quits.
      main.on('close', e => { if (store.live && !quitting) { e.preventDefault(); main.hide(); } });
      main.on('closed', () => app.quit());
      floater = new OverlayController({ savedBounds, displays: () => screen.getAllDisplays().map(d => d.workArea), cursor: () => screen.getCursorScreenPoint(),
        save: bounds => atomic(path.join(dataDir, 'overlay.json'), bounds),
        createWindow: (surface, bounds) => {
          const w = new BrowserWindow({ ...bounds, frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false, roundedCorners: false, thickFrame: false,
            focusable: surface === 'panel', hasShadow: false, show: false, backgroundColor: '#00000000',
            webPreferences: { preload: path.join(__dirname, 'ui/overlay-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } });
          if (surface === 'panel') w.webContents.on('before-input-event', (event, input) => { if (!(input.control && !input.alt && !input.meta && String(input.key).toLowerCase() === 'n')) event.preventDefault(); });
          w.setAlwaysOnTop(true, 'screen-saver'); w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
          w.webContents.on('will-navigate', event => event.preventDefault());
          void w.loadFile(path.join(__dirname, 'ui/overlay.html'), { query: { surface } }); return w;
        }, actions: action => action === 'theme' ? setTheme(theme === 'dark' ? 'light' : 'dark') : commands.execute(action) });
      Menu.setApplicationMenu(null); } },
    { id: 'tray', title: 'Ícone da bandeja', fatal: false, code: 'NVU-S100', run: async () => {
      tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'ui/tray.png')));
      tray.setToolTip(`NVU PRO Windows ${app.getVersion()}`);
      tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate()));
      tray.on('double-click', showMainWindow); } },
    { id: 'ipc', title: 'Comandos da interface', run: async () => { registerIpc(); } },
    { id: 'shortcut', title: 'Atalho Ctrl+N', fatal: false, code: 'NVU-S101', run: async () => {
      registerShortcut('CommandOrControl+N', () => { if (currentUid) floater.toggle(); else showMainWindow(); });
      for (const e of ['display-removed', 'display-metrics-changed']) screen.on(e, () => { floater.layout(); emit(); });
      if (shortcutIssues.has('CommandOrControl+N')) throw new NvuError('NVU-S101', 'CommandOrControl+N já está em uso por outro programa.', { fatal: false }); } },
    { id: 'load', title: 'Abrir a interface da NVU', run: async () => {
      try { await main.loadURL(`${appURL}/`); } catch (error) { throw new NvuError('NVU-S090', String(error.message || error).slice(0, 200), { cause: error }); }
      setInterval(poll, 1000).unref(); setInterval(() => floater.tick(), 1000).unref();
      try { scheduleUpdateChecks(); } catch { /* optional */ } } },
  ];
}

// ---- IPC ----
function registerIpc() {
  ipcMain.handle('nvu:windows', async (event, request) => {
    if (!allowedMain(event) || !request || typeof request.method !== 'string' || JSON.stringify(request).length > 32768) throw Error('WINDOWS_IPC_REJECTED');
    const { method, input } = request;
    switch (method) {
      case 'signIn': return google.signIn();
      case 'restoreAuth': return google.restore();
      case 'signOut': store.stop(); currentUid = ''; scope = null; floater.hide(); google.clear(); emit(); return;
      case 'syncScope': { const previousUid = currentUid; scope = input; currentUid = typeof input?.driverId === 'string' ? input.driverId : ''; store.syncScope(input); if (!currentUid || currentUid !== previousUid) floater.hide(); emit(); return status(); }
      case 'status': return status();
      case 'versions': return versionsView();
      case 'startupReport': return redactDeep(startupReport);
      case 'copyStartupReport': clipboard.writeText(JSON.stringify(diagnosticBundle({ report: startupReport, versions: versionsView(), logger }), null, 2)); return true;
      case 'openLogs': await shell.openPath(logger.dir); return true;
      case 'openUpdatePage': return openUpdatePage();
      case 'start': return commands.start(input);
      case 'pause': return commands.execute('pause');
      case 'stop': return commands.execute('stop');
      case 'acknowledge': {
        const captured = store.data?.events?.[input?.id]?.event?.capturedAt;
        store.acknowledge(currentUid, input.id, input);
        logger?.info('delivery.ack', { state: input.state, serverValidated: input.serverValidated === true, ageMs: Number.isFinite(captured) ? Math.max(0, Date.now() - captured) : null });
        emit(); return; }
      case 'showOverlay': showOverlay(); return;
      case 'openGame': return openSimulator(input);
      case 'setTheme': return setTheme(input);
      case 'chooseGame': { if (!input || !Object.hasOwn(games, input.key) || typeof input.root !== 'string' || input.root.length > 4096) throw Error('GAME_INVALID'); integration.remember(input); emit(); return integration.refreshGames(); }
      case 'discoverGames': return integration.refreshGames();
      case 'diagnose': case 'copyDiagnostics': {
        if (!games[input]) throw Error('GAME_INVALID'); await integration.refreshProcesses(true);
        const report = { appVersion: app.getVersion(), versions: versionsView(), startup: startupSummary(), ...integration.diagnostic(input, store, reader.rejections[input]) };
        if (method === 'copyDiagnostics') clipboard.writeText(JSON.stringify(redactDeep(report), null, 2)); return report;
      }
      case 'selectGame': {
        if (!games[input]) throw Error('GAME_INVALID');
        const picked = await dialog.showOpenDialog(main, { title: `Pasta do ${games[input].folder}`, properties: ['openDirectory'] });
        if (picked.canceled) return null;
        const game = { key: input, root: realGame(picked.filePaths[0], input), label: games[input].folder }; integration.remember(game); return game;
      }
      case 'prepareSimulator': { const result = await prepareSimulator(input, prepareDeps()); emit(); return result; }
      case 'removeSimulatorPlugin': { const result = await removeSimulatorPlugin(input, prepareDeps()); emit(); return result; }
      // Legacy commands kept for older interface bundles: same flow, with the native confirmation they always had.
      case 'installPlugin': case 'removePlugin': {
        if (!input || !games[input.key]) throw Error('GAME_INVALID');
        await integration.refreshProcesses(true);
        if (store.connected(input.key) || integration.running?.includes(input.key)) throw Error(`Feche o ${input.key.toUpperCase()} antes de instalar, atualizar ou remover o plugin.`);
        const answer = await dialog.showMessageBox(main, { type: 'question', buttons: ['Cancelar', method === 'installPlugin' ? 'Instalar' : 'Remover'], defaultId: 0,
          message: `Plugin NVU — ${games[input.key].folder}`, detail: `Destino: ${realGame(input.root, input.key)}\nReinicie o simulador após esta ação.` });
        if (answer.response !== 1) return { cancelled: true };
        integration.remember(input);
        const result = method === 'installPlugin' ? await prepareSimulator({ key: input.key, elevate: false }, prepareDeps()) : await removeSimulatorPlugin({ key: input.key, elevate: false }, prepareDeps());
        if (!result.ok) throw Error(result.message || describe(result.code).title);
        emit(); return result;
      }
      default: throw Error('WINDOWS_IPC_METHOD_DENIED');
    }
  });
  ipcMain.handle('nvu:overlay', (event, request) => {
    if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).some(key => !['action', 'contextKey'].includes(key)) || JSON.stringify(request).length > 512) throw Error('OVERLAY_ACTION_DENIED');
    const { action, contextKey } = request;
    if (typeof action !== 'string' || action.length > 32 || (contextKey !== undefined && (typeof contextKey !== 'string' || contextKey.length > 64))) throw Error('OVERLAY_ACTION_DENIED');
    if (['pause', 'resume', 'stop', 'panel', 'trips', 'setup', 'game'].includes(action) && contextKey !== overlayContext()) { emit(); throw Error('O contexto mudou. Abra novamente as ações da NVU.'); }
    return floater.command(floater.surface(event), action).catch(error => { diagnostic = String(error.message).slice(0, 240); emit(); throw error; });
  });
  ipcMain.handle('nvu:overlay:move', (event, position) => {
    if (floater.surface(event) !== 'panel' || !position || typeof position !== 'object' || Array.isArray(position) || Object.keys(position).sort().join(',') !== 'x,y' || !['x', 'y'].every(k => Number.isSafeInteger(position[k]) && Math.abs(position[k]) <= 100000)) throw Error('OVERLAY_POSITION_DENIED');
    floater.move(position);
  });
}

// ---- process entry points ----
function printVersionsAndExit() {
  try {
    const plugin = pluginPackage(path.join(pluginDirectory(), 'nvu_scs_telemetry.dll'), path.join(pluginDirectory(), 'nvu_scs_telemetry.manifest.json'), TELEMETRY_PLUGIN_VERSION, fs);
    const web = (() => { try { return fs.realpathSync(packaged('web')); } catch { return packaged('web'); } })();
    const report = collectVersions({ app, process, webDir: web, plugin, pkg, packaged: app.isPackaged });
    fs.writeFileSync(cli.versionsOut, JSON.stringify(report, null, 2)); app.exit(0);
  } catch (error) { try { fs.writeFileSync(cli.versionsOut, JSON.stringify({ error: String(error.message || error) })); } catch { /* nothing else to do */ } app.exit(2); }
}
async function bootstrapApp() {
  const report = await runStartup({ steps: startupSteps(), ctx: {}, logger });
  startupReport = report;
  try { fs.writeFileSync(path.join(logger.dir, 'last-startup.json'), JSON.stringify(redactDeep(report), null, 2)); } catch { /* the log already has the steps */ }
  if (!report.ok) {
    await presentStartupFailure({ report, versions: versionInfo || { app: { version: app.getVersion(), executable: process.execPath }, web: {}, plugin: { expectedVersion: TELEMETRY_PLUGIN_VERSION } }, logger,
      dialogs: { show: options => dialog.showMessageBox(options) }, clipboard, shell, noDialogs: cli.noDialogs });
    quitting = true; app.exit(1); return;
  }
  logger.info('startup.complete', { warnings: report.warnings });
}
function startPrimary() {
  logger = createLogger({ dir: path.join(app.getPath('userData'), 'logs'), name: 'nvu' });
  const self = { pid: process.pid, exe: process.execPath, version: app.getVersion() };
  selfIdentity = self;
  registry = instanceRegistry(path.join(app.getPath('userData'), 'instance.json'));
  const instance = createInstance({ app, cli, self, logger,
    find: () => findRunningNvu({ imageName: path.basename(process.execPath), registry }), readPackage: dir => readPackageFromInstall(dir),
    dialogs: { show: options => dialog.showMessageBox(options) },
    killer: { close: pid => execAsync('taskkill.exe', ['/PID', String(Number(pid)), '/T'], { windowsHide: true }), force: pid => execAsync('taskkill.exe', ['/PID', String(Number(pid)), '/T', '/F'], { windowsHide: true }) },
    alive: pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } } });
  const becomePrimary = () => { registry.write(self); app.on('second-instance', instance.primaryHandler({ show: showMainWindow, quit: () => gracefulQuit('takeover') })); };
  if (instance.requestLock()) { becomePrimary(); void app.whenReady().then(bootstrapApp).catch(fatalStartup); return; }
  // Lost the lock: decide and leave. Nothing below this line runs in this process unless it takes over.
  void app.whenReady().then(() => instance.handleLostLock()).then(result => {
    logger.info('instance.result', { kind: result.kind, exitCode: result.exitCode });
    if (result.primary) { becomePrimary(); return bootstrapApp(); }
    app.exit(result.exitCode);
  }).catch(fatalStartup);
}
function fatalStartup(error) {
  try { logger?.error('startup.unexpected', { message: String(error?.message || error), stack: String(error?.stack || '').split('\n').slice(0, 5).join('\n') }); } catch { /* ignore */ }
  if (!cli.noDialogs) dialog.showErrorBox('NVU PRO', `A NVU não pôde iniciar.\nCódigo: NVU-S999\n${String(error?.message || error).slice(0, 300)}`);
  app.exit(1);
}

app.on('before-quit', () => { quitting = true; try { if (selfIdentity) registry?.remove(selfIdentity); } catch { /* best effort */ } store?.stop(); globalShortcut.unregisterAll(); floater?.destroy(); tray?.destroy(); });
app.on('window-all-closed', () => app.quit());

if (cli.elevatedPlugin) {
  // Elevated helper: no instance lock, no window, no services. The exit code is the whole answer.
  app.exit(runElevatedPlugin(cli.elevatedPlugin, { pluginDir: pluginDirectory() }));
} else if (cli.versionsOut) {
  printVersionsAndExit();
} else {
  startPrimary();
}
