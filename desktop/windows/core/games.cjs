const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { atomic } = require('./session.cjs');
const games = { ets2: { folder: 'Euro Truck Simulator 2', exe: 'eurotrucks2.exe', steamId: '227300' },
  ats: { folder: 'American Truck Simulator', exe: 'amtrucks.exe', steamId: '270880' } };
function realGame(root, key) {
  if (!games[key] || typeof root !== 'string' || root.includes('\0')) throw Error('GAME_PATH_INVALID');
  const real = fs.realpathSync(root);
  if (!fs.existsSync(path.join(real, 'bin', 'win_x64', games[key].exe))) throw Error('Selecione a pasta raiz do simulador Windows x64.');
  return real;
}
function discover(roots) {
  const libraries = new Set(roots.filter(Boolean));
  for (const root of [...libraries]) {
    const vdf = path.join(root, 'steamapps', 'libraryfolders.vdf');
    if (fs.existsSync(vdf)) for (const m of fs.readFileSync(vdf, 'utf8').matchAll(/"path"\s+"([^"]+)"/g)) libraries.add(m[1].replace(/\\\\/g, '\\'));
  }
  const found = [];
  for (const lib of libraries) for (const key of Object.keys(games)) {
    try { const root = realGame(path.join(lib, 'steamapps', 'common', games[key].folder), key);
      if (!found.some(g => g.root === root)) found.push({ key, root, label: games[key].folder }); } catch { /* absent game */ }
  }
  return found;
}
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function pluginAction(root, key, dll, remove = false) {
  const real = realGame(root, key), dir = path.join(real, 'bin', 'win_x64', 'plugins');
  // A junction/symlink at the plugin destination must not escape the selected game.
  fs.mkdirSync(dir, { recursive: true });
  const normalizePath = p => process.platform === 'win32' ? p.toLowerCase() : p;
  if (normalizePath(fs.realpathSync(dir)) !== normalizePath(path.resolve(dir))) throw Error('PLUGIN_DESTINATION_REDIRECTED');
  const target = path.join(dir, 'nvu_scs_telemetry.dll'), receipt = `${target}.nvu.json`;
  if (remove) {
    if (!fs.existsSync(target)) return { restartRequired: true };
    const owned = JSON.parse(fs.readFileSync(receipt, 'utf8'));
    if (owned.sha256 !== hash(target)) throw Error('O plugin instalado foi alterado. Remoção automática bloqueada.');
    fs.unlinkSync(target); fs.unlinkSync(receipt);
  } else {
    if (fs.existsSync(target)) {
      if (!fs.existsSync(receipt) || JSON.parse(fs.readFileSync(receipt, 'utf8')).sha256 !== hash(target))
        throw Error('Já existe um plugin com este nome sem identificação NVU válida.');
    }
    const bytes = fs.readFileSync(dll);
    if (bytes.subarray(0, 2).toString() !== 'MZ') throw Error('PLUGIN_BINARY_INVALID');
    fs.copyFileSync(dll, `${target}.tmp`); fs.renameSync(`${target}.tmp`, target);
    atomic(receipt, { product: 'NVU', sha256: hash(target), installedAt: new Date().toISOString() });
  }
  return { restartRequired: true, root: real };
}
function clampBounds(bounds, displays) {
  const d = displays.find(d => bounds && bounds.x < d.x + d.width && bounds.x + bounds.width > d.x
    && bounds.y < d.y + d.height && bounds.y + bounds.height > d.y) || displays[0];
  const width = Math.min(bounds?.width || 300, d.width), height = Math.min(bounds?.height || 210, d.height);
  return { width, height, x: Math.max(d.x, Math.min(bounds?.x ?? d.x + 20, d.x + d.width - width)),
    y: Math.max(d.y, Math.min(bounds?.y ?? d.y + 30, d.y + d.height - height)) };
}
module.exports = { games, discover, realGame, pluginAction, clampBounds };
