const fs = require('node:fs');
const path = require('node:path');
const { createHash, timingSafeEqual } = require('node:crypto');
const { atomic } = require('./session.cjs');
const { games, discover, realGame } = require('./games.cjs');
const { inspectPlugin } = require('./plugin-install.cjs');
const { redact } = require('./redact.cjs');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
// A game that has been running this long without the expected plugin heartbeat did not load it.
const LOAD_TIMEOUT_MS = 60000;
class Integration {
  constructor({ file, dll, roots, documents, version, processes = async () => null, now = Date.now }) {
    Object.assign(this, { file, dll, roots, documents, version, processes, now });
    this.expectedHash = (() => { try { return hash(dll); } catch { return null; } })(); this.selected = {}; this.running = null; this.processInfo = {}; this.firstSeen = {}; this.checkedAt = 0; this.cache = new Map();
    try { this.selected = JSON.parse(fs.readFileSync(file, 'utf8')).games || {}; } catch { /* First setup. */ }
    this.refreshGames();
  }
  refreshGames() {
    const found = discover(this.roots);
    for (const key of Object.keys(games)) {
      try { const root = realGame(this.selected[key], key); found.unshift({ key, root, label: games[key].folder }); } catch { /* Absent saved installation. */ }
    }
    this.games = found.filter((g, i, all) => all.findIndex(other => other.root === g.root && other.key === g.key) === i);
    return this.games.map(g => ({ ...g, plugin: this.plugin(g) }));
  }
  remember(g) { this.selected[g.key] = realGame(g.root, g.key); atomic(this.file, { version: 1, games: this.selected }); this.refreshGames(); }
  game(key) { return this.games.find(g => g.key === key); }
  /** What is on disk. `current` = the file is byte-identical to the plugin packaged with THIS application. */
  plugin(g) {
    const info = inspectPlugin(g.root, g.key, { expectedSha256: this.expectedHash, cache: this.cache });
    return { installed: info.installed, current: !!info.current, owned: !!info.owned, foreign: !!info.foreign, sha256: info.sha256, version: info.version || null,
      installedAt: info.installedAt || null, ...(info.problem ? { problem: info.problem } : {}) };
  }
  async refreshProcesses(force = false) {
    if (!force && this.now() - this.checkedAt < 5000) return;
    this.checkedAt = this.now();
    try {
      const rows = await this.processes();
      // Older callers return plain keys; the Windows implementation returns { key, startedAt } so a restart can be detected.
      this.running = rows ? rows.map(row => typeof row === 'string' ? row : row.key) : null;
      this.processInfo = Object.fromEntries((rows || []).filter(row => row && typeof row === 'object').map(row => [row.key, row]));
      for (const key of Object.keys(games)) { if (this.running?.includes(key)) this.firstSeen[key] ??= this.now(); else delete this.firstSeen[key]; }
    } catch { this.running = null; }
  }
  /**
   * Everything the person needs to know, in one place. `state` is the canonical state shown by the interface;
   * `phase` is kept for the existing commands. The three versions are separate on purpose:
   * expected (this application), installed (file in the game folder) and loaded (reported by the running game).
   */
  status(key, session, rejection) {
    const game = this.game(key), plugin = game ? this.plugin(game) : null;
    const running = this.running ? this.running.includes(key) : null;
    const heartbeat = session.heartbeats[key], expected = this.version;
    const loadedVersion = heartbeat?.pluginVersion || null;
    const startedAt = this.processInfo[key]?.startedAt ? Date.parse(this.processInfo[key].startedAt) : null;
    const installedAt = plugin?.installedAt ? Date.parse(plugin.installedAt) : null;
    const startedBeforeInstall = running && startedAt && installedAt && startedAt < installedAt - 1000;
    const runningFor = this.firstSeen[key] ? this.now() - this.firstSeen[key] : 0;
    let phase, state, message, code = null;
    if (session.connected(key) && expected && loadedVersion !== expected) { phase = 'plugin_restart'; state = 'restart_required'; message = `O jogo ainda usa o plugin ${loadedVersion || 'anterior'}. Feche e abra o simulador para carregar o ${expected}.`; code = 'NVU-P090'; }
    else if (session.connected(key)) { phase = heartbeat.paused ? 'paused' : 'connected'; state = heartbeat.paused ? 'paused' : 'connected'; message = heartbeat.paused ? 'Jogo conectado e pausado.' : 'Telemetria conectada.'; }
    else if (!this.expectedHash) { phase = 'package_invalid'; state = 'package_invalid'; code = 'NVU-S060'; message = 'O plugin que acompanha a NVU está ausente (um antivírus pode tê-lo removido). Reinstale a NVU com o instalador completo.'; }
    else if (!game) { phase = 'game_not_configured'; state = 'game_missing'; message = `Localize a pasta do ${key.toUpperCase()} para preparar a conexão.`; code = 'NVU-P010'; }
    else if (plugin.foreign && plugin.installed) { phase = 'plugin_foreign'; state = 'foreign'; message = 'Existe um arquivo com o nome do plugin NVU que não foi instalado pela NVU. Nada foi alterado.'; code = 'NVU-P030'; }
    else if (!plugin.installed) { phase = 'plugin_missing'; state = 'absent'; message = `Prepare o ${key.toUpperCase()}: o plugin NVU ainda não está instalado.`; }
    else if (!plugin.current) { phase = 'plugin_update'; state = 'outdated'; message = `O plugin instalado (${plugin.version || 'versão desconhecida'}) é diferente do esperado (${expected}). Prepare o simulador com o jogo fechado.`; }
    else if (rejection && this.now() - rejection.at < 10000) { phase = rejection.reason; state = 'disconnected'; code = null;
      message = rejection.reason === 'token_mismatch' ? 'A comunicação local não foi autenticada. Confira se NVU e jogo usam o mesmo usuário Windows.' : 'Um pacote de telemetria foi recusado. Abra o diagnóstico da conexão.'; }
    else if (startedBeforeInstall && !loadedVersion) { phase = 'plugin_restart'; state = 'restart_required'; message = 'O plugin já está no disco, mas o jogo foi aberto antes. Feche e abra o simulador.'; code = 'NVU-P090'; }
    else if (heartbeat) { phase = 'heartbeat_expired'; state = 'disconnected'; message = 'A comunicação do plugin parou. A conexão foi removida; as pendências estão preservadas.'; }
    else if (Object.keys(games).some(other => other !== key && session.connected(other))) { phase = 'wrong_game'; state = 'disconnected'; message = `O simulador conectado é diferente da operação ${key.toUpperCase()}.`; }
    else if (running === false) { phase = 'game_closed'; state = 'ready_to_open'; message = `Plugin ${expected} preparado. Abra o ${key.toUpperCase()} para conectar.`; }
    else if (running && runningFor > LOAD_TIMEOUT_MS) { phase = 'waiting_plugin'; state = 'not_loaded'; code = 'NVU-P090'; message = 'O jogo está aberto, mas não carregou o plugin NVU. Feche e abra o simulador e aceite o aviso de plugin da SCS, se aparecer.'; }
    else { phase = 'waiting_plugin'; state = 'waiting_load'; message = 'Aguardando o jogo carregar o plugin. Se ele foi preparado com o jogo aberto, feche e abra o jogo; confira o aviso de SDK da SCS.'; }
    return { simulatorKey: key, phase, state, code, message, running, plugin, game: game || null,
      versions: { expected, installed: plugin?.version || (plugin?.installed && plugin.current ? expected : null), loaded: loadedVersion, installedSha256: plugin?.sha256 || null, expectedSha256: this.expectedHash },
      pluginVersion: loadedVersion, lastHeartbeatAt: heartbeat?.at || null, gameStartedAt: this.processInfo[key]?.startedAt || null };
  }
  assertReady(key, session) {
    const state = this.status(key, session);
    if (!state.game || !state.plugin?.installed || !state.plugin.current || state.phase === 'plugin_restart') throw Error(state.message);
    return state;
  }
  diagnostic(key, session, rejection) {
    const state = this.status(key, session, rejection);
    let sdkLog = [], logAvailable = false;
    const log = path.join(this.documents, games[key].folder, 'game.log.txt');
    try {
      const stat = fs.statSync(log), fd = fs.openSync(log, 'r'), size = Math.min(stat.size, 524288), buffer = Buffer.alloc(size);
      try { fs.readSync(fd, buffer, 0, size, stat.size - size); } finally { fs.closeSync(fd); }
      sdkLog = buffer.toString('utf8').split(/\r?\n/).filter(line => /\[sdk\]|NVU PRO|nvu_scs_telemetry/i.test(line)).slice(-25).map(line => redact(line).slice(0, 500));
      logAvailable = true;
    } catch { /* Nonstandard game home or log not created yet. */ }
    return { version: 2, simulatorKey: key, phase: state.phase, state: state.state, code: state.code, message: state.message, running: state.running,
      plugin: state.plugin, versions: state.versions, pluginVersion: state.pluginVersion, lastHeartbeatAt: state.lastHeartbeatAt, gameStartedAt: state.gameStartedAt, logAvailable, sdkLog };
  }
}
class BridgeReader {
  constructor(directory, token, now = Date.now) { Object.assign(this, { directory, token, now }); this.rejections = {}; this.message = ''; }
  read(name, key) {
    const file = path.join(this.directory, name);
    if (!fs.existsSync(file)) return null;
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) throw Error('packet_invalid');
    const packet = JSON.parse(fs.readFileSync(file, 'utf8'));
    const token = Buffer.from(typeof packet.token === 'string' ? packet.token : ''), expected = Buffer.from(this.token);
    if (token.length !== expected.length || !timingSafeEqual(token, expected)) throw Error('token_mismatch');
    if (packet.simulatorKey !== key || packet.version !== 1) throw Error('packet_invalid');
    delete packet.token; return packet;
  }
  poll(session) {
    this.message = '';
    // Heartbeats have priority even when old delivery files need manual review.
    for (const key of Object.keys(games)) {
      try { const packet = this.read(`${key}.heartbeat.json`, key); if (!packet) continue;
        const previous = session.sequences[key] || session.heartbeats[key];
        if (session.heartbeat(packet)) delete this.rejections[key];
        else if (!(previous?.bootId === packet.bootId && previous.sequence >= packet.sequence) && packet.at >= this.now() - 6000)
          this.rejections[key] = { reason: 'packet_invalid', at: this.now() };
      } catch (error) { this.rejections[key] = { reason: error.message === 'token_mismatch' ? error.message : 'packet_invalid', at: this.now() }; }
    }
    const names = fs.readdirSync(this.directory).filter(name => /^(ets2|ats)-[a-f0-9-]{36}\.delivery\.json$/.test(name));
    for (const name of names.slice(0, 100)) {
      try { const key = name.startsWith('ets2-') ? 'ets2' : 'ats'; const packet = this.read(name, key);
        const saved = session.ingest(packet); if (saved) fs.unlinkSync(path.join(this.directory, name));
        else this.message = 'Há uma entrega sem vínculo prévio. Confira o comprovante; ela não será transferida para a operação atual.';
      } catch { this.message = 'Uma entrega local precisa de conferência. O arquivo foi preservado.'; }
    }
  }
}
module.exports = { Integration, BridgeReader };
