const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { gameRoot, installPlugin, removePlugin } = require('./plugin-install.cjs');
const games = { ets2: { folder: 'Euro Truck Simulator 2', exe: 'eurotrucks2.exe', steamId: '227300' },
  ats: { folder: 'American Truck Simulator', exe: 'amtrucks.exe', steamId: '270880' } };
function realGame(root, key) {
  if (!games[key]) throw Error('GAME_PATH_INVALID');
  return gameRoot(root, key);
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
// Kept as the stable entry point used by the rest of the application and the tests.
function pluginAction(root, key, dll, remove = false, options = {}) {
  if (!games[key]) throw Error('GAME_INVALID');
  return remove ? removePlugin({ root, key }) : installPlugin({ root, key, dll, expectedSha256: options.expectedSha256, version: options.version });
}
function clampBounds(bounds, displays) {
  const d = displays.find(d => bounds && bounds.x < d.x + d.width && bounds.x + bounds.width > d.x
    && bounds.y < d.y + d.height && bounds.y + bounds.height > d.y) || displays[0];
  const width = Math.min(bounds?.width || 300, d.width), height = Math.min(bounds?.height || 210, d.height);
  return { width, height, x: Math.max(d.x, Math.min(bounds?.x ?? d.x + 20, d.x + d.width - width)),
    y: Math.max(d.y, Math.min(bounds?.y ?? d.y + 30, d.y + d.height - height)) };
}
module.exports = { games, discover, realGame, pluginAction, clampBounds };
