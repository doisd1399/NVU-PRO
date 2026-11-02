// Windows-only: the plugin preparation against fake game folders using the INSTALLED application and the real elevation wrapper.
// (GitHub runners are administrators with UAC off, so the consent prompt itself cannot be exercised; the PowerShell wrapper, the
// elevated command line and the verification after it are.)  node plugin-e2e.cjs --app <install dir> --out <dir>
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { newReport, arg, processes, killTree, launch, sleep } = require('./lib.cjs');
const appDir = path.resolve(arg('app', '')), out = path.resolve(arg('out', 'artifacts/e2e'));
const { encodeRequest, requestElevation, EXIT } = require('../../core/elevated-plugin.cjs');
const { installPlugin, inspectPlugin } = require('../../core/plugin-install.cjs');
const report = newReport('plugin-e2e'), pluginDir = path.join(appDir, 'resources', 'plugin');
const dll = path.join(pluginDir, 'nvu_scs_telemetry.dll'), manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'nvu_scs_telemetry.manifest.json'), 'utf8'));
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const fakeGame = (root, exe) => { fs.mkdirSync(path.join(root, 'bin', 'win_x64'), { recursive: true }); fs.copyFileSync(path.join(process.env.SystemRoot, 'System32', 'timeout.exe'), path.join(root, 'bin', 'win_x64', exe)); return root; };
(async () => {
  const base = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'nvu-plugin-e2e-'));
  await report.step('Packaged plugin matches its manifest', () => { if (sha(dll) !== manifest.sha256) throw Error('manifest mismatch'); return { version: manifest.version, sha256: manifest.sha256 }; });
  await report.step('Unprivileged install into a user-writable fake ATS, read back, third-party plugin untouched', () => {
    const game = fakeGame(path.join(base, 'ATS'), 'amtrucks.exe'); fs.mkdirSync(path.join(game, 'bin/win_x64/plugins')); fs.writeFileSync(path.join(game, 'bin/win_x64/plugins/other.dll'), 'third-party');
    const r = installPlugin({ root: game, key: 'ats', dll, expectedSha256: manifest.sha256, version: manifest.version });
    const info = inspectPlugin(game, 'ats', { expectedSha256: manifest.sha256 });
    if (!info.installed || !info.current || !info.owned || fs.readFileSync(path.join(game, 'bin/win_x64/plugins/other.dll'), 'utf8') !== 'third-party') throw Error('install verification failed');
    return { changed: r.changed, sha256: info.sha256 };
  });
  await report.step('Elevated mode through the real PowerShell wrapper (Start-Process -Verb RunAs) writes and verifies the plugin', async () => {
    const root = process.env.ProgramData || 'C:\\ProgramData', game = fakeGame(path.join(fs.mkdtempSync(path.join(root, 'NVU-QA-')), 'ETS2'), 'eurotrucks2.exe');
    const request = encodeRequest({ key: 'ets2', root: game }, { expectedSha256: manifest.sha256, version: manifest.version });
    const result = await requestElevation({ exe: path.join(appDir, 'NVU PRO.exe'), args: [`--nvu-elevated-plugin=${request}`] });
    const info = inspectPlugin(game, 'ets2', { expectedSha256: manifest.sha256 });
    if (!result.ok || !info.installed || !info.current || !info.owned) throw Error('elevated install failed: ' + JSON.stringify({ result, info }));
    return { elevatedExit: result.exitCode, sha256: info.sha256 };
  });
  await report.step('Elevated mode refuses a tampered request (wrong hash) with the documented exit code', async () => {
    const game = fakeGame(path.join(base, 'ETS2b'), 'eurotrucks2.exe');
    const request = encodeRequest({ key: 'ets2', root: game }, { expectedSha256: 'f'.repeat(64), version: manifest.version });
    const result = await requestElevation({ exe: path.join(appDir, 'NVU PRO.exe'), args: [`--nvu-elevated-plugin=${request}`] });
    if (result.ok || result.exitCode !== EXIT.HASH || fs.existsSync(path.join(game, 'bin/win_x64/plugins/nvu_scs_telemetry.dll'))) throw Error('tampered request was not refused: ' + JSON.stringify(result));
    return { exitCode: result.exitCode };
  });
  await report.step('A running game process is visible to the application process list (amtrucks.exe stand-in)', async () => {
    const game = fakeGame(path.join(base, 'ATSrun'), 'amtrucks.exe'); launch(path.join(game, 'bin/win_x64/amtrucks.exe'), ['/t', '120', '/nobreak']); await sleep(2000);
    const script = "@(Get-Process -Name amtrucks,eurotrucks2 -ErrorAction SilentlyContinue | ForEach-Object { $s=$null; try { $s=$_.StartTime.ToUniversalTime().ToString('o') } catch {}; [pscustomobject]@{ name=$_.ProcessName; start=$s } }) | ConvertTo-Json -Compress";
    const r = require('node:child_process').spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true });
    const rows = [JSON.parse(r.stdout || '[]')].flat(); killTree(processes('amtrucks.exe').map(p => p.pid));
    if (!rows.some(x => x.name === 'amtrucks' && x.start)) throw Error('process with start time not reported: ' + r.stdout + r.stderr);
    return { rows };
  });
  fs.rmSync(base, { recursive: true, force: true });
  report.save(path.join(out, 'plugin-e2e.json')); process.exitCode = report.ok ? 0 : 1;
})().catch(error => { console.error(error); report.ok = false; report.save(path.join(out, 'plugin-e2e.json')); process.exitCode = 1; });
