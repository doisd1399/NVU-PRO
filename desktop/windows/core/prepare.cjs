// The single "Preparar simulador" flow. Every outcome is a plain object with a stable code; nothing here throws for a
// condition the person can fix. Order matters: detect → game closed → install (unprivileged) → elevate only on a
// permission refusal and only after the interface asked for it → independent verification → remember the installation.
const { games } = require('./games.cjs');
const { NvuError, describe } = require('./errors.cjs');

const fail = (code, extra = {}) => { const d = describe(code); return { ok: false, code, title: d.title, action: d.action, message: extra.message || d.title, ...extra }; };

async function prepareSimulator(input, deps) {
  const { integration, store, dll, version, install, elevate, messageFor, logger } = deps;
  const key = input?.key;
  if (!games[key]) throw Error('GAME_INVALID');
  if (typeof input.root === 'string' && input.root) integration.remember({ key, root: input.root });
  const game = integration.game(key);
  if (!game) return fail('NVU-P010');
  if (!integration.expectedHash) return fail('NVU-P060', { message: 'O plugin que acompanha a NVU está ausente.' });
  await integration.refreshProcesses(true);
  if (store.connected(key) || integration.running?.includes(key)) return fail('NVU-P020', { retry: true });
  logger?.info('prepare.start', { key, root: game.root, elevate: input.elevate === true });
  let elevated = false;
  try {
    install({ root: game.root, key, dll, expectedSha256: integration.expectedHash, version });
  } catch (error) {
    if (!(error instanceof NvuError)) throw error;
    if (error.code !== 'NVU-P050') { logger?.warn('prepare.failed', { code: error.code, message: error.message }); return fail(error.code, { message: error.message }); }
    if (input.elevate !== true) { logger?.info('prepare.needs_elevation', { key }); return fail('NVU-P050', { needsElevation: true, message: error.message }); }
    elevated = true;
    const result = await elevate({ action: 'install', key, root: game.root });
    logger?.info('prepare.elevation_result', { exitCode: result.exitCode, declined: result.declined });
    if (result.declined) return fail('NVU-P051');
    if (!result.ok) return fail(messageFor(result.exitCode), { details: { exitCode: result.exitCode } });
  }
  // The elevated process only reports an exit code. Trust the disk, not the code: read it back without privileges.
  integration.cache.clear();
  const after = integration.plugin(game);
  if (!after.installed || !after.current || !after.owned) { logger?.error('prepare.verify_failed', { after }); return fail('NVU-P080', { details: { installed: after.installed, current: after.current, owned: after.owned } }); }
  integration.remember({ key, root: game.root });
  logger?.info('prepare.ok', { key, sha256: after.sha256, elevated });
  return { ok: true, step: 'installed', key, root: game.root, version, sha256: after.sha256, elevated, restartRequired: true };
}

async function removeSimulatorPlugin(input, deps) {
  const { integration, store, remove, elevate, messageFor, logger } = deps;
  const key = input?.key;
  if (!games[key]) throw Error('GAME_INVALID');
  const game = integration.game(key);
  if (!game) return fail('NVU-P010');
  await integration.refreshProcesses(true);
  if (store.connected(key) || integration.running?.includes(key)) return fail('NVU-P020', { retry: true });
  try { remove({ root: game.root, key }); }
  catch (error) {
    if (!(error instanceof NvuError)) throw error;
    if (error.code !== 'NVU-P050') return fail(error.code, { message: error.message });
    if (input.elevate !== true) return fail('NVU-P050', { needsElevation: true, message: error.message });
    const result = await elevate({ action: 'remove', key, root: game.root });
    if (result.declined) return fail('NVU-P051');
    if (!result.ok) return fail(messageFor(result.exitCode), { details: { exitCode: result.exitCode } });
  }
  integration.cache.clear();
  logger?.info('prepare.removed', { key });
  return { ok: true, step: 'removed', key, root: game.root, restartRequired: true };
}
module.exports = { prepareSimulator, removeSimulatorPlugin };
