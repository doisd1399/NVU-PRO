// Windows-only: the "new version available" notice in the INSTALLED application, with the real network (api.github.com). Nothing is mocked.
// What the request finds depends on what the repository has published (no community release yet, an equal one, a newer one, or the
// GitHub rate limit), so the test demands the plumbing and compares the result with an independent request (Node fetch + the same pure
// logic) instead of demanding a fixed outcome:
//   1. NVU_NO_UPDATE_CHECK=1: the application opens, logs update.disabled and, after 40 s, nothing was requested or written;
//   2. real check: 30 s after opening it requests the releases, writes %APPDATA%\NVU PRO\update-check.json, logs update.check and stays open;
//   3. reopened, it respects the saved interval (12 h; 30 min after a failure): no new request and the file does not change.
//   node update-e2e.cjs --app <install dir> --out <dir>
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { newReport, arg, processes, windows, killTree, launch, sleep } = require('./lib.cjs');
const { evaluate, API } = require('../../core/update-check.cjs');

const appDir = path.resolve(arg('app', '')), out = path.resolve(arg('out', 'artifacts/e2e'));
const exe = path.join(appDir, 'NVU PRO.exe');
const userData = path.join(process.env.APPDATA, 'NVU PRO'), logFile = path.join(userData, 'logs', 'nvu.log'), stateFile = path.join(userData, 'update-check.json');
const report = newReport('update-e2e');
const waitFor = async (predicate, ms, step = 500) => { const end = Date.now() + ms; for (;;) { const value = await predicate(); if (value) return value; if (Date.now() > end) return null; await sleep(step); } };
const logSince = since => { try { return fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(entry => entry.t >= since); } catch { return []; } };
const mains = () => processes().filter(p => p.main && p.exe && p.exe.toLowerCase().startsWith(appDir.toLowerCase()));
const stop = async () => { killTree(mains().map(p => p.pid)); await waitFor(() => mains().length === 0, 20000); await sleep(1500); };
const readState = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const asked = since => logSince(since).filter(entry => entry.event === 'update.check' || entry.event === 'update.check_failed');
const KNOWN = ['available', 'current', 'none', 'error'], REASONS = ['RATE_LIMIT', 'TIMEOUT', 'RESPONSE_TOO_LARGE', 'RESPONSE_INVALID', 'HTTP_ERROR', 'URL_NOT_ALLOWED', 'NETWORK'];
const healthy = since => waitFor(() => logSince(since).some(entry => entry.event === 'startup.complete') && mains().length === 1 && windows().some(w => w.handle !== 0), 90000);

(async () => {
  const versionsFile = path.join(fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'nvu-update-e2e-')), 'versions.json');
  execFileSync(exe, [`--nvu-versions-out=${versionsFile}`], { timeout: 60000, windowsHide: true });
  const currentVersion = JSON.parse(fs.readFileSync(versionsFile, 'utf8')).app.version;
  let saved = null;

  await report.step('NVU_NO_UPDATE_CHECK=1: opens normally, logs update.disabled and, after 40 s, nothing was requested or written', async () => {
    fs.rmSync(stateFile, { force: true });
    const since = new Date().toISOString(); launch(exe, [], { NVU_NO_UPDATE_CHECK: '1' });
    if (!await healthy(since)) throw Error('no healthy start: ' + JSON.stringify(logSince(since).slice(-6)));
    const disabled = logSince(since).find(entry => entry.event === 'update.disabled');
    if (!disabled || disabled.reason !== 'env') throw Error('update.disabled (env) not logged: ' + JSON.stringify(logSince(since).slice(-8)));
    await sleep(40000);   // the real timer would have fired after 30 s
    if (asked(since).length || fs.existsSync(stateFile)) throw Error('a check ran although it was disabled: ' + JSON.stringify({ asked: asked(since), file: fs.existsSync(stateFile) }));
    await stop(); return { reason: disabled.reason };
  });

  await report.step('Real check: 30 s after opening the application requests the releases, writes update-check.json, logs update.check and stays open', async () => {
    fs.rmSync(stateFile, { force: true });
    const since = new Date().toISOString(); launch(exe, [], { NVU_NO_UPDATE_CHECK: '0' });
    if (!await healthy(since)) throw Error('no healthy start: ' + JSON.stringify(logSince(since).slice(-6)));
    const line = await waitFor(() => asked(since)[0], 120000, 1000);
    if (!line || line.event !== 'update.check') throw Error('no update.check within 120 s: ' + JSON.stringify(line || logSince(since).slice(-8)));
    saved = readState();
    if (saved.version !== 1 || !Number.isFinite(saved.checkedAt) || !saved.info || !KNOWN.includes(saved.info.status)) throw Error('unexpected state file: ' + JSON.stringify(saved).slice(0, 600));
    if (saved.info.status === 'error' && !REASONS.includes(saved.info.reason)) throw Error('unexpected failure reason: ' + saved.info.reason);
    if (mains().length !== 1 || !windows().some(w => w.handle !== 0)) throw Error('the application did not stay open after the check');
    // Independent request (Node fetch) + the same pure logic: the packaged application must reach the same conclusion. If the independent
    // request is itself refused (rate limit, no network on the runner) the comparison is inconclusive and only the plumbing above counts.
    let independent = null;
    try {
      const response = await fetch(API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'NVU-PRO-CI' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (response.ok) independent = evaluate(await response.json(), currentVersion);
    } catch { /* inconclusive */ }
    const data = { currentVersion, status: saved.info.status, available: saved.info.available === true, latest: saved.info.latest?.version ?? null, reason: saved.info.reason ?? null,
      independent: independent && { status: independent.status, latest: independent.latest?.version ?? null } };
    if (independent && saved.info.status === 'error') throw Error('the application failed although the independent request worked: ' + JSON.stringify(data));
    if (independent && (saved.info.status !== independent.status || (saved.info.latest?.version ?? null) !== (independent.latest?.version ?? null))) throw Error('the application disagrees with an independent request: ' + JSON.stringify(data));
    await stop(); return data;
  });

  await report.step('Reopened, the application respects the saved interval: no new request and the file does not change', async () => {
    if (!saved) throw Error('the previous step did not produce a state file');
    const before = fs.readFileSync(stateFile, 'utf8');
    const since = new Date().toISOString(); launch(exe, [], { NVU_NO_UPDATE_CHECK: '0' });
    if (!await healthy(since)) throw Error('no healthy start: ' + JSON.stringify(logSince(since).slice(-6)));
    await sleep(50000);   // the 30 s timer plus time for a (wrong) request to finish
    const after = fs.readFileSync(stateFile, 'utf8');
    if (asked(since).length || after !== before || mains().length !== 1) throw Error('the saved interval was not respected: ' + JSON.stringify({ asked: asked(since), changed: after !== before, running: mains().length }));
    await stop(); return { checkedAt: saved.checkedAt, status: saved.info.status };
  });

  try { fs.rmSync(path.dirname(versionsFile), { recursive: true, force: true }); } catch { /* temporary folder */ }
  report.save(path.join(out, 'update-e2e.json')); process.exitCode = report.ok ? 0 : 1;
})().catch(async error => { console.error(error); report.ok = false; try { await stop(); } catch { /* best effort */ } report.save(path.join(out, 'update-e2e.json')); process.exitCode = 1; });
