const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const scopeKeys = ['driverId', 'companyId', 'jobId', 'contractId', 'simulatorKey'];
function atomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(data)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
}
function validScope(s) {
  return s && scopeKeys.every(k => typeof s[k] === 'string' && s[k].length > 0 && s[k].length <= 180 && !/[\/\\\0]/.test(s[k]))
    && ['ets2', 'ats'].includes(s.simulatorKey);
}
function sameScope(a, b) { return validScope(a) && validScope(b) && scopeKeys.every(k => a[k] === b[k]); }
function validateEvent(e) {
  return e && e.version === 1 && ['ets2', 'ats'].includes(e.simulatorKey)
    && /^[a-f0-9-]{36}$/.test(e.eventId) && e.type === 'job.delivered'
    && Number.isSafeInteger(e.capturedAt) && e.capturedAt > 0 && e.capturedAt <= Date.now() + 300000
    && typeof e.origin === 'string' && e.origin.trim().length > 0 && e.origin.length <= 180
    && typeof e.destination === 'string' && e.destination.trim().length > 0 && e.destination.length <= 180
    && e.origin.toLowerCase() !== e.destination.toLowerCase()
    && Number.isSafeInteger(e.amountCents) && e.amountCents > 0 && e.amountCents <= 1000000000
    && Number.isFinite(e.distanceKm) && e.distanceKm > 0 && e.distanceKm <= 50000
    && e.currency === (e.simulatorKey === 'ets2' ? 'EUR' : 'USD');
}
class Session {
  constructor(file, now = () => Date.now()) {
    this.file = file; this.now = now; this.live = null; this.heartbeats = {}; this.sequences = {};
    this.data = { version: 1, bindings: {}, events: {} };
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data.version !== 1 || !data.bindings || !data.events) throw Error('WINDOWS_JOURNAL_INVALID');
      this.data = data;
    }
  }
  save() { atomic(this.file, this.data); }
  start(scope) {
    if (!validScope(scope)) throw Error('WINDOWS_SCOPE_INVALID');
    if (this.live && !sameScope(this.live, scope)) throw Error('Encerre a sessão da outra operação.');
    this.live = { ...scope, epoch: this.live?.epoch || randomUUID(), enabled: true, startedAt: this.now() };
    const h = this.heartbeats[scope.simulatorKey];
    if (h && this.connected(scope.simulatorKey)) this.bind(h);
    return this.status(scope.driverId);
  }
  bind(h) {
    const s = this.live;
    if (!s?.enabled || h.simulatorKey !== s.simulatorKey || !h.jobId) return;
    const key = `${h.simulatorKey}:${h.jobId}`;
    if (!this.data.bindings[key] || sameScope(this.data.bindings[key], s)) delete this.live.blocked;
    if (!this.data.bindings[key]) {
      this.data.bindings[key] = { ...s, boundAt: this.now(), intervals: [{ start: this.now(), end: null }] }; this.save();
    } else if (!sameScope(this.data.bindings[key], s)) {
      // A game freight already bound to one operation can never migrate.
      this.live.blocked = 'Este frete já pertence a outra operação NVU.';
    } else if (!this.data.bindings[key].intervals.some(i => i.end === null)) {
      this.data.bindings[key].intervals.push({ start: this.now(), end: null }); this.save();
    }
  }
  heartbeat(h) {
    if (!h || h.version !== 1 || !['ets2', 'ats'].includes(h.simulatorKey)
      || !/^[a-f0-9-]{36}$/.test(h.bootId) || !Number.isSafeInteger(h.sequence) || h.sequence < 1
      || !Number.isSafeInteger(h.at) || h.at > this.now() + 300000 || h.at < this.now() - 6000
      || typeof h.paused !== 'boolean'
      || (h.online !== undefined && typeof h.online !== 'boolean')
      || (h.jobState !== undefined && !['idle', 'active', 'cancelled', 'delivered'].includes(h.jobState))
      || ['origin', 'destination'].some(key => h[key] !== undefined && (typeof h[key] !== 'string' || h[key].length > 180))
      || ['remainingDistanceKm','plannedDistanceKm'].some(key=>h[key]!==undefined&&h[key]!==null&&(!Number.isFinite(h[key])||h[key]<0||h[key]>50000))
      || (h.jobId && !/^[a-f0-9-]{36}$/.test(h.jobId))) return false;
    const prev = this.sequences[h.simulatorKey] || this.heartbeats[h.simulatorKey];
    if (prev?.bootId === h.bootId && prev.sequence >= h.sequence) return false;
    if (prev && prev.bootId !== h.bootId && h.at < prev.at) return false;
    this.sequences[h.simulatorKey] = { bootId: h.bootId, sequence: h.sequence, at: h.at };
    if (h.online === false) { delete this.heartbeats[h.simulatorKey]; return true; }
    this.heartbeats[h.simulatorKey] = { ...h, receivedAt: this.now() };
    this.bind(h); return true;
  }
  connected(key) { const h = this.heartbeats[key]; return !!h && h.at > this.now() - 5000 && h.receivedAt > this.now() - 5000; }
  ingest(e) {
    if (!e || e.version !== 1 || !['ets2', 'ats'].includes(e.simulatorKey) || e.type !== 'job.delivered'
      || !/^[a-f0-9-]{36}$/.test(e.eventId) || !Number.isSafeInteger(e.capturedAt) || e.capturedAt <= 0
      || e.capturedAt > this.now() + 300000) throw Error('WINDOWS_EVENT_INVALID');
    const id = `${e.simulatorKey}:${e.eventId}`;
    const fingerprint = createHash('sha256').update(JSON.stringify(e)).digest('hex');
    const old = this.data.events[id];
    if (old) { if (old.fingerprint !== fingerprint) throw Error('WINDOWS_EVENT_CONFLICT'); return old; }
    const binding = this.data.bindings[id];
    if (!binding) return null; // Never attach a historical/unbound freight to the current operation.
    const active = binding.intervals.some(i => e.capturedAt >= i.start && (i.end === null || e.capturedAt <= i.end));
    const complete = validateEvent(e);
    const row = { id, fingerprint, event: e, scope: binding,
      state: active && complete ? 'PENDING' : 'REVIEW',
      message: !complete ? 'Dados incompletos. Confira o comprovante pelo lançamento com OCR.' : active ? '' : 'Entrega preservada; sessão pausada, encerrada ou contexto alterado.' };
    this.data.events[id] = row; this.save(); return row;
  }
  pause() {
    if (this.live) {
      for (const b of Object.values(this.data.bindings)) if (sameScope(b, this.live))
        for (const i of b.intervals) if (i.end === null) i.end = this.now();
      this.live.enabled = false; this.save();
    }
  }
  stop() { this.pause(); this.live = null; }
  syncScope(scope) {
    if (this.live && (!sameScope(this.live, scope) || scope.closed)) this.stop();
    if (this.live) { this.live.progress = Number(scope.progress || 0); this.live.total = Number(scope.total || 0); this.live.operationName = scope.operationName; }
  }
  pending(uid) { return Object.values(this.data.events).filter(r => r.scope.driverId === uid && r.state !== 'CONFIRMED'); }
  acknowledge(uid, id, ack) {
    const r = this.data.events[id];
    if (!r || r.scope.driverId !== uid) throw Error('WINDOWS_ACK_SCOPE_MISMATCH');
    if (!['QUEUED', 'REVIEW', 'CONFIRMED'].includes(ack.state)) throw Error('WINDOWS_ACK_STATE_INVALID');
    if (r.state === 'CONFIRMED' && ack.state !== 'CONFIRMED') throw Error('WINDOWS_ACK_ALREADY_CONFIRMED');
    if (ack.state === 'CONFIRMED' && (!ack.tripId || !ack.serverValidated)) throw Error('WINDOWS_ACK_INVALID');
    r.state = ack.state; r.tripId = ack.tripId; r.message = String(ack.message || '').slice(0, 240); this.save();
  }
  status(uid) {
    const s = this.live?.driverId === uid ? this.live : null;
    return { platform: 'windows', active: !!s, enabled: !!s?.enabled, connected: !!s && this.connected(s.simulatorKey),
      paused: s ? this.heartbeats[s.simulatorKey]?.paused === true : false,
      jobState: s ? this.heartbeats[s.simulatorKey]?.jobState || 'idle' : 'idle',
      scope: s, pending: uid ? this.pending(uid) : [] };
  }
}
module.exports = { Session, atomic, validScope, sameScope, validateEvent };
