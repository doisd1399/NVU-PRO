const fs = require('node:fs');
const path = require('node:path');
const { redactDeep } = require('./redact.cjs');
// Append-only JSON lines. A failure to log never interrupts the application (the caller is told through ok=false).
function createLogger({ dir, name = 'nvu', maxBytes = 1 << 20, keep = 3, now = () => new Date(), fsImpl = fs }) {
  const file = path.join(dir, `${name}.log`);
  let ready = false, ok = true;
  function rotate() {
    try {
      if (fsImpl.statSync(file).size < maxBytes) return;
      for (let i = keep - 1; i >= 1; i--) if (fsImpl.existsSync(`${file}.${i}`)) fsImpl.renameSync(`${file}.${i}`, `${file}.${i + 1}`);
      fsImpl.renameSync(file, `${file}.1`);
    } catch { /* first write or concurrent rotation */ }
  }
  function log(level, event, data = {}) {
    try {
      if (!ready) { fsImpl.mkdirSync(dir, { recursive: true }); ready = true; }
      rotate();
      fsImpl.appendFileSync(file, JSON.stringify({ t: now().toISOString(), level, event, ...redactDeep(data) }) + '\n');
      ok = true;
    } catch { ok = false; }
    return ok;
  }
  return { file, dir, log, info: (e, d) => log('info', e, d), warn: (e, d) => log('warn', e, d), error: (e, d) => log('error', e, d), get ok() { return ok; },
    tail(lines = 200) { try { return fsImpl.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-lines); } catch { return []; } } };
}
module.exports = { createLogger };
