// Removes personal data before anything is written to a log, shown in a diagnostic or copied for support.
const personalHome = require('node:os').homedir();
const ownHome = personalHome.length > 1 ? new RegExp(personalHome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g') : null;
const redact = value => (ownHome ? String(value).replace(ownHome, '%USERPROFILE%') : String(value))
  .replace(/[a-z]:[\\/]Users[\\/][^\\/\r\n"]+/ig, '%USERPROFILE%')
  .replace(/\/(?:home|Users)\/[^/\r\n"]+/g, '%USERPROFILE%')
  .replace(/[\w.+-]+@[\w.-]+\.[a-z]+/ig, '[email]')
  .replace(/\b[0-9a-f]{64}\b/ig, '[redacted]')
  .replace(/(access_token|refresh_token|id_token|authorization|token)\s*[:=]\s*\S+/ig, '$1=[redacted]')
  .replace(/eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g, '[jwt]');
function redactDeep(value, depth = 0) {
  if (typeof value === 'string') return redact(value).slice(0, 2000);
  if (depth > 6 || value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 100).map(item => redactDeep(item, depth + 1));
  return Object.fromEntries(Object.entries(value).slice(0, 100).map(([k, v]) => [k, /token|secret|password/i.test(k) ? '[redacted]' : redactDeep(v, depth + 1)]));
}
module.exports = { redact, redactDeep };
