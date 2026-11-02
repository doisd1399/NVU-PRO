// Runs the REAL main.cjs inside a vm with a fake Electron, Windows commands and file system hooks.
// Controlled test: it exercises our code paths, not Windows or Electron themselves.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const { promisify } = require('node:util');
const { pathToFileURL } = require('node:url');
const pkg = require('../../package.json');

class Window extends EventEmitter {
  constructor(bounds = {}) { super(); this.bounds = { x: 20, y: 30, width: 64, height: 64, ...bounds }; this.visible = false; this.messages = []; this.url = 'file:///qa/overlay.html';
    this.webContents = Object.assign(new EventEmitter(), { mainFrame: { url: this.url }, send: (name, value) => this.messages.push({ name, value }), getURL: () => this.url, setWindowOpenHandler() {} }); }
  getBounds() { return this.bounds; } setBounds(bounds) { this.bounds = { ...bounds }; }
  showInactive() { this.visible = true; } show() { this.visible = true; } focus() { this.focusCount = (this.focusCount || 0) + 1; } hide() { this.visible = false; }
  isVisible() { return this.visible; } isDestroyed() { return !!this.destroyed; } destroy() { this.destroyed = true; this.visible = false; } isMinimized() { return false; } restore() {}
  setIgnoreMouseEvents(value) { this.ignored = value; } setAlwaysOnTop() {}
  async loadURL(url) { if (this.failLoad) throw Error('ERR_FAILED (-2) loading ' + url); this.url = url; this.webContents.mainFrame.url = url; }
  async loadFile(file, options) { this.url = pathToFileURL(file).toString() + '?surface=' + options.query.surface; this.webContents.mainFrame.url = this.url; }
}

/** Creates the fake world. `overrides` can change the process arguments, lock result, commands and files. */
function createWorld(dir, overrides = {}) {
  const handlers = new Map(), shortcuts = new Map(), windows = [], opened = [], errors = [], timers = [], boxes = [], clipboardWrites = [], exits = [], commandsRun = [];
  const user = path.join(dir, 'user'), local = path.join(dir, 'local'); fs.mkdirSync(user, { recursive: true }); fs.mkdirSync(local, { recursive: true });
  const state = { running: [], confirm: 1, focusAllowed: true, lock: true, boxAnswers: [], icaclsFails: false, whoami: '"QA\\\\user","S-1-5-21-123"\r\n', ...overrides.state };
  const child = {
    execFileSync: (name, args) => {
      commandsRun.push([name, ...(args || [])]);
      if (name === 'whoami.exe') { if (state.whoamiFails) throw Object.assign(Error('whoami blocked'), { stderr: 'blocked' }); return state.whoami; }
      if (name === 'icacls.exe') { if (state.icaclsFails) throw Object.assign(Error('Access is denied'), { stderr: 'Access is denied.' }); return ''; }
      return '';
    },
    execFile() {},
  };
  child.execFile[promisify.custom] = async () => ({ stdout: JSON.stringify(state.running.map(k => k === 'ats' ? 'amtrucks' : 'eurotrucks2')) });
  const app = Object.assign(new EventEmitter(), { isPackaged: false, setName() {}, requestSingleInstanceLock: data => { app.lockRequests.push(data); return state.lock; }, lockRequests: [],
    whenReady: () => Promise.resolve(), getPath: name => name === 'userData' ? user : name === 'documents' ? dir : path.join(dir, 'Roaming'), getVersion: () => pkg.version, getAppPath: () => path.resolve(__dirname, '../..'),
    quit() { app.quitCalled = (app.quitCalled || 0) + 1; }, exit(code) { exits.push(code); } });
  const screen = Object.assign(new EventEmitter(), { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1100, height: 750 } }], getCursorScreenPoint: () => ({ x: 50, y: 50 }) });
  class BrowserWindow extends Window { constructor(options) { super(options); this.options = options; this.failLoad = !!state.failLoad && windows.length === 0; windows.push(this); } }
  const web = path.resolve(__dirname, '../../../../dist');
  const electron = { app, BrowserWindow, screen, protocol: { registerSchemesAsPrivileged() {}, handle() {} }, session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } },
    ipcMain: { handle: (name, callback) => handlers.set(name, callback) }, globalShortcut: { register: (key, callback) => { if (state.shortcutBusy) return false; shortcuts.set(key, callback); return true; }, unregister: key => shortcuts.delete(key), unregisterAll() {} },
    shell: { openExternal: async url => opened.push(url), openPath: async p => { opened.push('path:' + p); return ''; } },
    dialog: { showErrorBox: (_, error) => errors.push(error), showMessageBox: async (...args) => { const options = args.at(-1); boxes.push(options); const next = state.boxAnswers.shift(); const leave = options.buttons?.indexOf('Sair'); return { response: next ?? (leave >= 0 ? leave : state.confirm) }; }, showOpenDialog: async () => ({ canceled: true }) },
    safeStorage: {}, net: {}, Tray: class { setToolTip() {} setContextMenu() {} on() {} destroy() {} }, Menu: { setApplicationMenu() {}, buildFromTemplate: x => x }, nativeImage: { createFromPath() {} },
    clipboard: { writeText: text => clipboardWrites.push(text) } };
  const file = path.resolve(__dirname, '../../main.cjs'), req = createRequire(file);
  const files = { 'index.html': '<html></html>', ...overrides.files };
  const missing = p => Object.assign(Error(`ENOENT: no such file or directory, '${p}'`), { code: 'ENOENT' });
  const fakeFs = { ...fs, realpathSync: Object.assign(p => { if (p === web) { if (state.noWeb) throw missing(p); return web; } return fs.realpathSync(p); }, fs.realpathSync),
    readFileSync: (p, encoding) => { const s = String(p);
      if (s === path.join(web, 'index.html')) { if (state.noWeb) throw missing(s); return files['index.html']; }
      if (s.endsWith('config/google-oauth.json')) { if (state.badOauth) return '{ not json'; return JSON.stringify({ clientId: 'qa.apps.googleusercontent.com' }); }
      return fs.readFileSync(p, encoding); } };
  const context = {
    require: name => name === 'electron' ? electron : name === 'node:child_process' ? child : name === 'node:fs' ? fakeFs
      : name === './core/game-window.cjs' ? { focusGameWindow: async key => { opened.push('focus:' + key); return { found: true, focused: state.focusAllowed }; } } : req(name),
    __dirname: path.dirname(file), URL, Response, Headers, console, Promise,
    process: { platform: 'win32', arch: 'x64', pid: 4242, argv: ['NVU PRO.exe', ...(overrides.argv || [])], execPath: 'C:\\Apps\\NVU PRO\\NVU PRO.exe', versions: { electron: '45.2.1', chrome: '140', node: '24' },
      env: { LOCALAPPDATA: local, ProgramFiles: dir, 'ProgramFiles(x86)': dir, ...overrides.env }, kill: pid => { if (!state.alivePids?.has(pid)) throw Object.assign(Error('no'), { code: 'ESRCH' }); return true; }, ...overrides.process },
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return { unref() {} }; } };
  return { state, app, electron, windows, handlers, shortcuts, opened, errors, timers, boxes, clipboardWrites, exits, commandsRun, user, local, web, context, file,
    start() { vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, { filename: file }); },
    settle: () => new Promise(resolve => setTimeout(resolve, 30)) };
}
module.exports = { createWorld, Window, pkg };
