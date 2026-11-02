// The user's real situation: an OLD copy of NVU (the shipped 0.1.x build, which hides in the tray and ignores takeover requests)
// is still running, and the NEW version is opened from another folder. Real installers, real processes, real lock.
//   node smoke-upgrade.cjs --old-installer <0.1.x Setup.exe> --installer <new Setup.exe> --out <dir>
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sleep, processes, windows, killTree, launch, newReport, arg } = require('./lib.cjs');
const oldInstaller = path.resolve(arg('old-installer', '')), installer = path.resolve(arg('installer', '')), out = path.resolve(arg('out', 'artifacts/e2e'));
const base = path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'nvu-upgrade'), oldDir = path.join(base, 'old-0.1.x'), newDir = path.join(base, 'new');
const userData = path.join(process.env.APPDATA, 'NVU PRO'), logs = path.join(userData, 'logs'), journal = path.join(userData, 'pro-journal.json');
const report = newReport('smoke-upgrade');
const waitFor = async (predicate, ms, step = 500) => { const end = Date.now() + ms; for (;;) { const value = await predicate(); if (value) return value; if (Date.now() > end) return null; await sleep(step); } };
const under = dir => processes().filter(p => p.exe && p.exe.toLowerCase().startsWith(dir.toLowerCase()));
const logLines = () => { try { return fs.readFileSync(path.join(logs, 'nvu.log'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
const run = (file, args, timeout = 120000) => spawnSync(file, args, { timeout, windowsHide: true, encoding: 'utf8' });
(async () => {
  await report.step('Install the previous (shipped) version and the new version in different folders', () => {
    for (const [file, dir] of [[oldInstaller, oldDir], [installer, newDir]]) { const r = run(file, ['/S', `/D=${dir}`], 600000); if (r.status !== 0) throw Error(`${path.basename(file)} exit ${r.status}`); }
    return { oldDir, newDir };
  });
  await report.step('Previous version runs (window + tray behaviour) with pending trips in the shared journal', async () => {
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(journal, JSON.stringify({ version: 1, bindings: {}, events: { 'ats:11111111-1111-1111-1111-111111111111': { id: 'ats:11111111-1111-1111-1111-111111111111', state: 'PENDING', fingerprint: 'x', event: { version: 1, simulatorKey: 'ats', type: 'job.delivered', eventId: '11111111-1111-1111-1111-111111111111', capturedAt: Date.now() - 1000, origin: 'A', destination: 'B', amountCents: 100, currency: 'USD', distanceKm: 5 }, scope: { driverId: 'u', companyId: 'c', jobId: 'j', contractId: 'k', simulatorKey: 'ats' } } } }));
    launch(path.join(oldDir, 'NVU PRO.exe')); const ok = await waitFor(() => under(oldDir).some(p => p.main) && windows().some(w => w.handle !== 0), 60000);
    if (!ok) throw Error('previous version did not start'); return { oldMainPid: under(oldDir).find(p => p.main).pid };
  });
  const journalBefore = fs.readFileSync(journal, 'utf8');
  await report.step('New version opened while the old one runs (no dialogs): does nothing destructive and says why', async () => {
    const r = run(path.join(newDir, 'NVU PRO.exe'), ['--nvu-no-dialogs'], 60000); await sleep(1500);
    const lines = logLines(), result = lines.filter(l => l.event === 'instance.result').at(-1);
    const data = { exitCode: r.status, result, oldStillRunning: under(oldDir).some(p => p.main), newProcesses: under(newDir).length };
    if (!data.oldStillRunning || r.status === 0 && !result || data.newProcesses !== 0 || !['other-version-kept', 'unknown-owner'].includes(result?.kind)) throw Error('unexpected: ' + JSON.stringify(data));
    return data;
  });
  await report.step('New version with --nvu-replace-running: the verified old NVU is closed and the new one becomes the primary instance', async () => {
    launch(path.join(newDir, 'NVU PRO.exe'), ['--nvu-no-dialogs', '--nvu-replace-running']);
    const ok = await waitFor(() => under(oldDir).length === 0 && under(newDir).some(p => p.main) && logLines().some(l => l.event === 'startup.complete'), 90000);
    const lines = logLines(), data = { oldGone: under(oldDir).length === 0, newMain: under(newDir).filter(p => p.main).map(p => p.pid), takeover: lines.some(l => l.event === 'instance.takeover_done'), complete: lines.some(l => l.event === 'startup.complete') };
    if (!ok || !data.takeover) throw Error('takeover failed: ' + JSON.stringify({ data, tail: lines.slice(-6) }));
    return data;
  });
  await report.step('Pending trips survived the replacement byte for byte', () => { const after = fs.readFileSync(journal, 'utf8'); if (after !== journalBefore) throw Error('journal changed while switching versions'); return { bytes: after.length }; });
  await report.step('Cleanup (only processes of these two install folders)', () => { killTree([...under(newDir), ...under(oldDir)].map(p => p.pid)); return {}; });
  report.save(path.join(out, 'smoke-upgrade.json')); process.exitCode = report.ok ? 0 : 1;
})().catch(error => { console.error(error); report.ok = false; report.save(path.join(out, 'smoke-upgrade.json')); process.exitCode = 1; });
