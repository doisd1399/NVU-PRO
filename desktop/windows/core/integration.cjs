const fs = require('node:fs');
const path = require('node:path');
const { createHash, timingSafeEqual } = require('node:crypto');
const { atomic } = require('./session.cjs');
const { games, discover, realGame } = require('./games.cjs');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
class Integration {
  constructor({ file, dll, roots, documents, version, processes = async () => null, now = Date.now }) {
    Object.assign(this, { file, dll, roots, documents, version, processes, now });
    this.expectedHash = hash(dll); this.selected = {}; this.running = null; this.checkedAt = 0; this.cache = new Map();
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
  plugin(g) {
    const file = path.join(g.root, 'bin/win_x64/plugins/nvu_scs_telemetry.dll');
    try {
      const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink()) return { installed: false, current: false };
      const stamp = `${stat.mtimeMs}:${stat.size}`, cached = this.cache.get(file);
      const sha256 = cached?.stamp === stamp ? cached.sha256 : hash(file); this.cache.set(file, { stamp, sha256 });
      let owned = false; try { owned = JSON.parse(fs.readFileSync(file + '.nvu.json', 'utf8')).sha256 === sha256; } catch { /* Manual copy. */ }
      return { installed: true, current: sha256 === this.expectedHash, owned, sha256 };
    } catch { return { installed: false, current: false }; }
  }
  async refreshProcesses(force = false) {
    if (!force && this.now() - this.checkedAt < 5000) return;
    this.checkedAt = this.now(); try { this.running = await this.processes(); } catch { this.running = null; }
  }
  status(key, session, rejection) {
    const game = this.game(key), plugin = game ? this.plugin(game) : null;
    const running = this.running ? this.running.includes(key) : null;
    const heartbeat = session.heartbeats[key];
    let phase, message;
    if (session.connected(key) && this.version && heartbeat.pluginVersion !== this.version) { phase = 'plugin_restart'; message = 'O jogo ainda usa um plugin anterior. Feche e abra o simulador para carregar a atualização.'; }
    else if (session.connected(key)) { phase = heartbeat.paused ? 'paused' : 'connected'; message = heartbeat.paused ? 'Jogo conectado e pausado.' : 'Telemetria conectada.'; }
    else if (!game) { phase = 'game_not_configured'; message = `Localize a pasta do ${key.toUpperCase()} para preparar a conexão.`; }
    else if (!plugin.installed) { phase = 'plugin_missing'; message = `Instale o plugin NVU no ${key.toUpperCase()} com o jogo fechado.`; }
    else if (!plugin.current) { phase = 'plugin_update'; message = 'Atualize o plugin NVU com o jogo fechado e abra o simulador novamente.'; }
    else if (rejection && this.now() - rejection.at < 10000) { phase = rejection.reason; message = rejection.reason === 'token_mismatch' ? 'A comunicação local não foi autenticada. Confira se NVU e jogo usam o mesmo usuário Windows.' : 'Um pacote de telemetria foi recusado. Abra o diagnóstico da conexão.'; }
    else if (heartbeat) { phase = 'heartbeat_expired'; message = 'A comunicação do plugin parou. A conexão foi removida; as pendências estão preservadas.'; }
    else if (Object.keys(games).some(other => other !== key && session.connected(other))) { phase = 'wrong_game'; message = `O simulador conectado é diferente da operação ${key.toUpperCase()}.`; }
    else if (running === false) { phase = 'game_closed'; message = `Plugin preparado. Abra o ${key.toUpperCase()} para conectar.`; }
    else { phase = 'waiting_plugin'; message = 'Sem sinal do plugin. Se ele foi instalado com o jogo aberto, feche e abra o jogo; confira o aviso de SDK da SCS.'; }
    return { simulatorKey: key, phase, message, running, plugin, game: game || null,
      pluginVersion: heartbeat?.pluginVersion || null, lastHeartbeatAt: heartbeat?.at || null };
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
      sdkLog = buffer.toString('utf8').split(/\r?\n/).filter(line => /\[sdk\]|NVU PRO|nvu_scs_telemetry/i.test(line)).slice(-25)
        .map(line => line.replace(/[a-z]:[\\/]Users[\\/][^\\/\r\n]+/ig, '%USERPROFILE%').replace(/[\w.+-]+@[\w.-]+\.[a-z]+/ig, '[email]')
          .replace(/\b[0-9a-f]{64}\b/ig, '[redacted]').replace(/(access_token|refresh_token|id_token|authorization|token)\s*[:=]\s*\S+/ig, '$1=[redacted]').slice(0, 500));
      logAvailable = true;
    } catch { /* Nonstandard game home or log not created yet. */ }
    return { version: 1, simulatorKey: key, phase: state.phase, message: state.message, running: state.running,
      plugin: state.plugin, pluginVersion: state.pluginVersion, lastHeartbeatAt: state.lastHeartbeatAt, logAvailable, sdkLog };
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
