'use strict';
/**
 * Aviso de «nova versão disponível». Só AVISA: nunca baixa nem instala nada.
 *
 * Consulta a lista pública de releases do repositório (uma requisição HTTPS; o GitHub vê o IP, como em qualquer download) e só
 * aceita releases publicados (nunca rascunhos) cuja tag seja windows-comunidade-vX.Y.Z[-runN]. O endereço mostrado ao usuário é
 * montado aqui a partir da tag validada; nada da resposta vira link. Toda falha (rede, limite de consultas, resposta estranha)
 * vira um estado «sem aviso», nunca uma exceção para quem chamou.
 */
const REPO = 'doisd1399/NVU-PRO';
const API = `https://api.github.com/repos/${REPO}/releases?per_page=30`;
const TAG = /^windows-comunidade-v(\d{1,4})\.(\d{1,4})\.(\d{1,4})(?:-[0-9A-Za-z.-]{1,40})?$/;
const VERSION = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/;
const HOUR = 3600e3;
const KNOWN_ERRORS = new Set(['RATE_LIMIT', 'TIMEOUT', 'RESPONSE_TOO_LARGE', 'RESPONSE_INVALID', 'HTTP_ERROR', 'URL_NOT_ALLOWED']);

const parseVersion = text => { const m = VERSION.exec(String(text ?? '')); return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null; };
function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) throw Error('VERSION_INVALID');
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}
const releaseUrl = tag => `https://github.com/${REPO}/releases/tag/${encodeURIComponent(tag)}`;
const isTrustedReleaseUrl = url => typeof url === 'string' && url.length < 200
  && url.startsWith(`https://github.com/${REPO}/releases/tag/windows-comunidade-v`) && /^[A-Za-z0-9:/._-]+$/.test(url);

/** Highest published version among the Windows community releases; everything else in the answer is ignored. */
function pickLatest(releases) {
  if (!Array.isArray(releases)) throw Error('RESPONSE_INVALID');
  let best = null;
  for (const item of releases.slice(0, 100)) {
    if (!item || typeof item !== 'object' || item.draft === true || typeof item.tag_name !== 'string') continue;
    const m = TAG.exec(item.tag_name);
    if (!m) continue;
    const candidate = {
      version: `${Number(m[1])}.${Number(m[2])}.${Number(m[3])}`, tag: item.tag_name, url: releaseUrl(item.tag_name),
      name: typeof item.name === 'string' ? item.name.replace(/[\u0000-\u001f]/g, ' ').slice(0, 120) : '', prerelease: item.prerelease === true,
      publishedAt: typeof item.published_at === 'string' && !Number.isNaN(Date.parse(item.published_at)) ? item.published_at : null,
    };
    if (!best) { best = candidate; continue; }
    const order = compareVersions(candidate.version, best.version);
    if (order > 0 || (order === 0 && (candidate.publishedAt || '') > (best.publishedAt || ''))) best = candidate;
  }
  return best;
}
/** The saved answer was evaluated for the version that was running then; the application may have been updated since. */
function rederive(info, currentVersion) {
  if (info.status === 'error' || !info.latest) return { ...info, current: currentVersion };
  const newer = compareVersions(info.latest.version, currentVersion) > 0;
  return { ...info, status: newer ? 'available' : 'current', available: newer, current: currentVersion };
}
function evaluate(releases, currentVersion) {
  const latest = pickLatest(releases);
  if (!latest) return { status: 'none', available: false, current: currentVersion, latest: null };
  const newer = compareVersions(latest.version, currentVersion) > 0;
  return { status: newer ? 'available' : 'current', available: newer, current: currentVersion, latest };
}

/**
 * Throttled check. `state` is what the previous call returned (the caller persists it): a successful answer is reused for 12 hours and
 * a failure is retried after 30 minutes (and keeps showing what was already known).
 */
async function checkForUpdate({ currentVersion, fetchJson, state = null, now = Date.now, minIntervalMs = 12 * HOUR, errorRetryMs = 30 * 60e3 } = {}) {
  if (!parseVersion(currentVersion)) return { info: { status: 'error', available: false, reason: 'CURRENT_VERSION_INVALID' }, state, cached: true };
  const t = now();
  if (state?.checkedAt && state.info) {
    const age = t - state.checkedAt, wait = state.failed ? errorRetryMs : minIntervalMs;
    if (age >= 0 && age < wait) return { info: rederive(state.info, currentVersion), state, cached: true };
  }
  try {
    const info = { ...evaluate(await fetchJson(API), currentVersion), checkedAt: t };
    return { info, state: { version: 1, checkedAt: t, info, failed: false }, cached: false };
  } catch (error) {
    const reason = KNOWN_ERRORS.has(error?.message) ? error.message : 'NETWORK';
    const known = state?.info && state.info.status !== 'error' ? state.info : null;   // keep showing a notice that was already known
    const info = known ? { ...rederive(known, currentVersion), lastError: reason } : { status: 'error', available: false, current: currentVersion, latest: null, reason, checkedAt: t };
    return { info, state: { version: 1, checkedAt: t, info, failed: true }, cached: false };
  }
}

/**
 * A state file read from disk is trusted only after being rebuilt field by field: the link always comes from the validated tag
 * (never from the file) and unknown fields are dropped. Anything that does not fit means «no state» and the next check asks again.
 */
function validState(saved) {
  try {
    const info = saved?.info;
    if (saved?.version !== 1 || !Number.isFinite(saved.checkedAt) || !info || typeof info !== 'object' || !['available', 'current', 'none', 'error'].includes(info.status)) return null;
    const known = reason => (KNOWN_ERRORS.has(reason) || reason === 'NETWORK') ? reason : undefined;
    let latest = null;
    if (info.latest != null) {
      const m = typeof info.latest.tag === 'string' ? TAG.exec(info.latest.tag) : null;
      if (!m) return null;
      latest = { version: `${Number(m[1])}.${Number(m[2])}.${Number(m[3])}`, tag: info.latest.tag, url: releaseUrl(info.latest.tag),
        name: typeof info.latest.name === 'string' ? info.latest.name.replace(/[\u0000-\u001f]/g, ' ').slice(0, 120) : '', prerelease: info.latest.prerelease === true,
        publishedAt: typeof info.latest.publishedAt === 'string' && !Number.isNaN(Date.parse(info.latest.publishedAt)) ? info.latest.publishedAt : null };
    }
    const clean = { status: info.status, available: info.available === true, current: parseVersion(info.current) ? info.current : undefined, latest, checkedAt: saved.checkedAt };
    if (known(info.reason)) clean.reason = info.reason;
    if (known(info.lastError)) clean.lastError = info.lastError;
    return { version: 1, checkedAt: saved.checkedAt, failed: saved.failed === true, info: clean };
  } catch { return null; }
}

/** fetch wrapper for the one allowed API address: timeout, size limit, no redirects, JSON only. */
function createFetchJson({ fetchImpl, userAgent, timeoutMs = 8000, maxBytes = 512 * 1024 } = {}) {
  return async url => {
    if (typeof url !== 'string' || !url.startsWith(`https://api.github.com/repos/${REPO}/`) || typeof fetchImpl !== 'function') throw Error('URL_NOT_ALLOWED');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { signal: controller.signal, redirect: 'error',
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': userAgent || 'NVU-PRO-Windows', 'X-GitHub-Api-Version': '2022-11-28' } });
      if (response.status === 403 || response.status === 429) throw Error('RATE_LIMIT');
      if (!response.ok) throw Error('HTTP_ERROR');
      const text = await response.text();
      if (text.length > maxBytes) throw Error('RESPONSE_TOO_LARGE');
      try { return JSON.parse(text); } catch { throw Error('RESPONSE_INVALID'); }
    } catch (error) {
      if (controller.signal.aborted) throw Error('TIMEOUT');
      throw error;
    } finally { clearTimeout(timer); }
  };
}

module.exports = { REPO, API, parseVersion, compareVersions, pickLatest, evaluate, checkForUpdate, createFetchJson, isTrustedReleaseUrl, releaseUrl, validState };
