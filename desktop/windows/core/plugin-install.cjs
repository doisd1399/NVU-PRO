// Writing (and removing) ONLY the NVU plugin inside a game. Pure file-system logic with injected fs so that it runs the
// same way unprivileged, elevated and under test. Never touches any other plugin, never follows links out of the game.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { NvuError } = require('./errors.cjs');

const GAMES = Object.freeze({ ets2: { folder: 'Euro Truck Simulator 2', exe: 'eurotrucks2.exe' }, ats: { folder: 'American Truck Simulator', exe: 'amtrucks.exe' } });
const DLL = 'nvu_scs_telemetry.dll';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => process.platform === 'win32' ? String(a).toLowerCase() === String(b).toLowerCase() : a === b;

function gameRoot(root, key, fsImpl = fs) {
  if (!GAMES[key] || typeof root !== 'string' || root.includes('\0') || !root) throw new NvuError('NVU-P010', 'Caminho do jogo inválido.');
  let real; try { real = fsImpl.realpathSync(root); } catch { throw new NvuError('NVU-P010', 'A pasta do jogo não existe mais.'); }
  if (!fsImpl.existsSync(path.join(real, 'bin', 'win_x64', GAMES[key].exe))) throw new NvuError('NVU-P010', 'Selecione a pasta raiz do simulador Windows x64 (a que contém bin\\win_x64).');
  return real;
}
/** Every directory between the game root and the plugin folder must be a real directory (no symlink/junction). */
function pluginPaths(root, key, { create = false, fsImpl = fs } = {}) {
  const real = gameRoot(root, key, fsImpl);
  const dir = path.join(real, 'bin', 'win_x64', 'plugins'), target = path.join(dir, DLL), receipt = path.join(dir, DLL + '.nvu.json');
  let current = real, exists = true;
  for (const part of ['bin', 'win_x64', 'plugins']) {
    current = path.join(current, part);
    let stat = null; try { stat = fsImpl.lstatSync(current); } catch { /* absent */ }
    if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) throw new NvuError('NVU-P040', `${current} não é uma pasta comum.`);
    if (!stat) { if (!create) { exists = false; break; } fsImpl.mkdirSync(current); }
  }
  if (exists && !same(fsImpl.realpathSync(dir), path.resolve(dir))) throw new NvuError('NVU-P040', 'A pasta de plugins está redirecionada.');
  return { root: real, dir, target, receipt, exists };
}
function readReceipt(file, fsImpl = fs) { try { return JSON.parse(fsImpl.readFileSync(file, 'utf8')); } catch { return null; } }
const permission = error => error && (error.code === 'EACCES' || error.code === 'EPERM' || error.code === 'EROFS');

/** What is on disk right now, independent of what the game has loaded. */
function inspectPlugin(root, key, { expectedSha256, fsImpl = fs, cache } = {}) {
  let p; try { p = pluginPaths(root, key, { fsImpl }); } catch (error) { return { installed: false, current: false, owned: false, problem: error.code || 'NVU-P040' }; }
  let stat; try { stat = fsImpl.lstatSync(p.target); } catch { return { installed: false, current: false, owned: false }; }
  if (!stat.isFile() || stat.isSymbolicLink()) return { installed: false, current: false, owned: false, problem: 'NVU-P040' };
  const stamp = `${stat.mtimeMs}:${stat.size}`, hit = cache?.get(p.target);
  const digest = hit?.stamp === stamp ? hit.sha256 : sha(fsImpl.readFileSync(p.target)); cache?.set(p.target, { stamp, sha256: digest });
  const receipt = readReceipt(p.receipt, fsImpl), owned = !!receipt && receipt.product === 'NVU' && receipt.sha256 === digest;
  return { installed: true, current: expectedSha256 ? digest === expectedSha256 : false, owned, sha256: digest, version: receipt?.version || null, installedAt: receipt?.installedAt || null, foreign: !owned };
}
function atomicWrite(target, bytes, fsImpl) {
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
    const fd = fsImpl.openSync(temp, 'wx', 0o644);
    try { fsImpl.writeFileSync(fd, bytes); fsImpl.fsyncSync(fd); } finally { fsImpl.closeSync(fd); }
    fsImpl.renameSync(temp, target);
  } catch (error) { try { fsImpl.unlinkSync(temp); } catch { /* nothing to clean */ } throw error; }
}
/**
 * Copies the packaged plugin. The destination is verified byte-for-byte AFTER writing; the receipt is written last, so a
 * receipt always describes a file that was verified.
 */
function installPlugin({ root, key, dll, expectedSha256, version, fsImpl = fs, now = () => new Date() }) {
  let bytes; try { bytes = fsImpl.readFileSync(dll); } catch { throw new NvuError('NVU-P060', 'O plugin empacotado não foi encontrado.'); }
  if (bytes.subarray(0, 2).toString() !== 'MZ') throw new NvuError('NVU-P060', 'O plugin empacotado não é um executável Windows válido.');
  const digest = sha(bytes);
  if (expectedSha256 && digest !== expectedSha256) throw new NvuError('NVU-P060', 'O plugin empacotado não confere com o hash esperado.');
  let p;
  try { p = pluginPaths(root, key, { create: true, fsImpl }); } catch (error) { if (permission(error)) throw new NvuError('NVU-P050', error.message, { cause: error }); throw error; }
  const present = inspectPlugin(root, key, { expectedSha256: digest, fsImpl });
  // Byte-identical to the packaged plugin => it IS ours (e.g. copied by hand earlier): adopt it by writing the receipt only.
  const identical = present.installed && present.current;
  if (present.installed && present.foreign && !identical) throw new NvuError('NVU-P030', `Já existe um plugin com este nome sem identificação NVU válida (${p.target}).`);
  // Already installed by NVU and identical: change nothing, so the install time keeps meaning "when the file last changed".
  if (identical && present.owned) return { restartRequired: false, root: p.root, target: p.target, sha256: digest, changed: false };
  try {
    if (!identical) atomicWrite(p.target, bytes, fsImpl);
    const written = sha(fsImpl.readFileSync(p.target));
    if (written !== digest) throw new NvuError('NVU-P080', 'Hash gravado diferente do esperado.');
    atomicWrite(p.receipt, Buffer.from(JSON.stringify({ product: 'NVU', version: version || null, sha256: digest, installedAt: now().toISOString() })), fsImpl);
  } catch (error) {
    if (error instanceof NvuError) throw error;
    if (permission(error)) throw new NvuError('NVU-P050', String(error.message), { cause: error, details: { code: error.code } });
    throw new NvuError('NVU-P070', String(error.message), { cause: error, details: { code: error.code } });
  }
  return { restartRequired: !identical, root: p.root, target: p.target, sha256: digest, changed: !identical };
}
function removePlugin({ root, key, fsImpl = fs }) {
  const p = pluginPaths(root, key, { fsImpl });
  if (!fsImpl.existsSync(p.target)) return { restartRequired: true, root: p.root };
  const receipt = readReceipt(p.receipt, fsImpl);
  if (!receipt || receipt.sha256 !== sha(fsImpl.readFileSync(p.target))) throw new NvuError('NVU-P030', 'O plugin instalado foi alterado. Remoção automática bloqueada.');
  try { fsImpl.unlinkSync(p.target); fsImpl.unlinkSync(p.receipt); } catch (error) { throw new NvuError(permission(error) ? 'NVU-P050' : 'NVU-P070', String(error.message), { cause: error }); }
  return { restartRequired: true, root: p.root };
}
module.exports = { GAMES, DLL, sha, gameRoot, pluginPaths, inspectPlugin, installPlugin, removePlugin, permission };
