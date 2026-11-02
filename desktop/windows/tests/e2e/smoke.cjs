// Real-Windows smoke test of a built installer: integrity, silent install, shortcuts, first launch, second launch,
// reinstall over a running application and uninstall. Output is a JSON report; nothing is mocked.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sleep, sha256, powershell, powershellJson, processes, windows, killTree, launch, newReport, arg, asArray } = require('./lib.cjs');
const { verifyNsisInstaller } = require('../../tools/nsis-integrity.cjs');

const installer = path.resolve(arg('installer', '')), label = arg('label', 'installer'), out = path.resolve(arg('out', 'artifacts/e2e'));
const installDir = arg('install-dir', path.join(process.env.RUNNER_TEMP || os.tmpdir(), `nvu-install-${label}`));
const userData = path.join(process.env.APPDATA, 'NVU PRO'), token = path.join(process.env.LOCALAPPDATA, 'NVU', 'pro-telemetry', 'bridge.token');
const report = newReport(`smoke-${label}`);
const mtime = file => { try { return fs.statSync(file).mtimeMs; } catch { return 0; } };
const mainProcesses = () => processes().filter(p => p.main && p.exe && p.exe.toLowerCase().startsWith(installDir.toLowerCase()));
const waitFor = async (predicate, ms, step = 500) => { const end = Date.now() + ms; for (;;) { const value = predicate(); if (value) return value; if (Date.now() > end) return null; await sleep(step); } };
const uninstallerOf = () => ['Uninstall NVU.exe', 'Uninstall NVU PRO.exe'].map(n => path.join(installDir, n)).find(f => fs.existsSync(f));

(async () => {
  await report.step('Installer fingerprint and NSIS integrity', () => {
    const stat = fs.statSync(installer), data = { file: path.basename(installer), bytes: stat.size, sha256: sha256(installer) };
    try { data.nsis = verifyNsisInstaller(fs.readFileSync(installer)); } catch (error) { data.nsisError = error.message; }
    data.authenticode = powershellJson(`$s=Get-AuthenticodeSignature -LiteralPath '${installer}'; [pscustomobject]@{status=[string]$s.Status;signer=$s.SignerCertificate.Subject}`);
    return data;
  });
  const install = (title) => report.step(title, () => {
    const started = Date.now(), result = spawnSync(installer, ['/S', `/D=${installDir}`], { timeout: 600000, windowsHide: true, encoding: 'utf8' });
    const data = { exitCode: result.status, signal: result.signal, ms: Date.now() - started, error: result.error && result.error.message };
    if (result.status !== 0) throw Error(`installer exit code ${result.status} ${result.error ? result.error.message : ''}`);
    return data;
  });
  await install('Silent install');
  await report.step('Installed files', () => {
    const must = ['NVU PRO.exe', 'resources/app.asar', 'resources/web/index.html', 'resources/plugin/nvu_scs_telemetry.dll'];
    const data = Object.fromEntries(must.map(f => [f, fs.existsSync(path.join(installDir, f))]));
    data.uninstaller = path.basename(uninstallerOf() || '');
    data.asarSha256 = sha256(path.join(installDir, 'resources/app.asar'));
    if (Object.values(data).some(v => v === false) || !data.uninstaller) throw Error('missing installed files: ' + JSON.stringify(data));
    return data;
  });
  await report.step('Shortcuts and uninstall registration', () => {
    const desktop = path.join(process.env.USERPROFILE, 'Desktop'), programs = path.join(process.env.APPDATA, 'Microsoft/Windows/Start Menu/Programs');
    const links = [];
    for (const dir of [desktop, programs, path.join(programs, 'NVU PRO')]) if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (/^NVU.*\.lnk$/i.test(f)) links.push(path.join(dir, f));
    const targets = links.map(link => ({ link, target: (powershell(`(New-Object -ComObject WScript.Shell).CreateShortcut('${link}').TargetPath`).stdout) }));
    const reg = asArray(powershellJson(`Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' | ForEach-Object { Get-ItemProperty $_.PSPath } | Where-Object { $_.DisplayName -like 'NVU*' } | Select-Object DisplayName,DisplayVersion,Publisher,UninstallString,InstallLocation`));
    if (!targets.length) throw Error('no NVU shortcut was created');
    return { targets, registry: reg };
  });
  let first;
  await report.step('First launch: one main process and a window', async () => {
    launch(path.join(installDir, 'NVU PRO.exe'));
    first = await waitFor(() => { const p = mainProcesses(); return p.length === 1 && windows().some(w => w.handle !== 0) ? p : null; }, 45000);
    if (!first) throw Error('application did not stay running with a window: ' + JSON.stringify({ processes: mainProcesses(), windows: windows() }));
    return { mainPids: first.map(p => p.pid), windows: windows() };
  });
  await report.step('Second launch while the first runs: no second application, bootstrap side effects recorded', async () => {
    await sleep(3000);
    const before = { token: mtime(token), main: mainProcesses().map(p => p.pid), windows: windows().length };
    launch(path.join(installDir, 'NVU PRO.exe'));
    const samples = [];
    for (const wait of [500, 1000, 2000, 4000, 8000]) {
      await sleep(wait); samples.push({ afterMs: wait, main: mainProcesses().map(p => p.pid), windows: windows().filter(w => w.handle !== 0).length });
    }
    const after = { token: mtime(token), main: mainProcesses().map(p => p.pid) };
    const data = { before, samples, after, bridgeTokenRewrittenBySecondInstance: after.token > before.token };
    if (after.main.length !== 1 || after.main[0] !== before.main[0]) throw Error('a second main process remained or the first one changed: ' + JSON.stringify(data));
    return data;
  });
  await report.step('Reinstall over the running application', async () => {
    const before = sha256(path.join(installDir, 'resources/app.asar'));
    const started = Date.now(), result = spawnSync(installer, ['/S', `/D=${installDir}`], { timeout: 600000, windowsHide: true, encoding: 'utf8' });
    const data = { exitCode: result.status, ms: Date.now() - started, asarBefore: before, asarAfter: sha256(path.join(installDir, 'resources/app.asar')),
      mainProcessesAfter: mainProcesses().map(p => p.pid) };
    if (result.status !== 0) throw Error('reinstall over a running app failed: ' + JSON.stringify(data));
    return data;
  });
  await report.step('Stop the application started by this test (only processes under the install folder)', () => {
    const own = processes().filter(p => p.exe && p.exe.toLowerCase().startsWith(installDir.toLowerCase())).map(p => p.pid);
    killTree(own); return { stopped: own.length };
  });
  await report.step('Uninstall keeps user data and removes the program', async () => {
    const uninstaller = uninstallerOf(); if (!uninstaller) throw Error('uninstaller not found');
    const dataBefore = fs.existsSync(userData);
    spawnSync(uninstaller, ['/S', `_?=${installDir}`], { timeout: 300000, windowsHide: true });
    const gone = await waitFor(() => !fs.existsSync(path.join(installDir, 'NVU PRO.exe')), 60000, 1000);
    const data = { programRemoved: !!gone, userDataKeptBefore: dataBefore, userDataKeptAfter: fs.existsSync(userData), remaining: fs.existsSync(installDir) ? fs.readdirSync(installDir).slice(0, 20) : [] };
    if (!gone || !data.userDataKeptAfter) throw Error('uninstall verification failed: ' + JSON.stringify(data));
    return data;
  });
  report.save(path.join(out, `smoke-${label}.json`));
  process.exitCode = report.ok ? 0 : 1;
})().catch(error => { console.error(error); report.ok = false; report.save(path.join(out, `smoke-${label}.json`)); process.exitCode = 1; });
