// Real-Windows end-to-end test of a built installer. Nothing is mocked: the installer, the registry, shortcuts, processes and the
// application are the real ones. Produces a JSON report; the exit code is 0 only when every step passed.
//   node smoke.cjs --installer <NVU-PRO-Setup.exe> [--old-installer <older Setup.exe>] --label <name> --out <dir>
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sleep, sha256, powershell, powershellJson, processes, windows, killTree, launch, newReport, arg, asArray } = require('./lib.cjs');
const { verifyNsisInstaller } = require('../../tools/nsis-integrity.cjs');

const installer = path.resolve(arg('installer', '')), oldInstaller = arg('old-installer') ? path.resolve(arg('old-installer')) : null;
const label = arg('label', 'installer'), out = path.resolve(arg('out', 'artifacts/e2e'));
const installDir = arg('install-dir', path.join(process.env.RUNNER_TEMP || os.tmpdir(), `nvu-install-${label}`));
const decoyDir = path.join(process.env.RUNNER_TEMP || os.tmpdir(), `nvu-decoy-${label}`);
const userData = path.join(process.env.APPDATA, 'NVU PRO'), logs = path.join(userData, 'logs');
const report = newReport(`smoke-${label}`);
const waitFor = async (predicate, ms, step = 500) => { const end = Date.now() + ms; for (;;) { const value = await predicate(); if (value) return value; if (Date.now() > end) return null; await sleep(step); } };
const exe = () => path.join(installDir, 'NVU PRO.exe');
const underInstall = () => processes().filter(p => p.exe && p.exe.toLowerCase().startsWith(installDir.toLowerCase()));
const mains = () => underInstall().filter(p => p.main);
const logLines = () => { try { return fs.readFileSync(path.join(logs, 'nvu.log'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
const run = (file, args, timeout = 600000) => spawnSync(file, args, { timeout, windowsHide: true, encoding: 'utf8' });
const install = (file, extra = []) => run(file, ['/S', ...extra, `/D=${installDir}`]);
const uninstallerOf = () => path.join(installDir, 'Uninstall NVU.exe');

(async () => {
  await report.step('Installer fingerprint, NSIS integrity and Authenticode status', () => {
    const data = { file: path.basename(installer), bytes: fs.statSync(installer).size, sha256: sha256(installer) };
    data.nsis = verifyNsisInstaller(fs.readFileSync(installer));
    data.authenticode = powershellJson(`$s=Get-AuthenticodeSignature -LiteralPath '${installer}'; [pscustomobject]@{status=[string]$s.Status;signer=$s.SignerCertificate.Subject;timestamped=($null -ne $s.TimeStamperCertificate)}`);
    return data;
  });
  if (oldInstaller) await report.step('Previous version: install and keep it running', async () => {
    const r = install(oldInstaller); if (r.status !== 0) throw Error('old installer exit ' + r.status);
    launch(exe()); const ok = await waitFor(() => mains().length === 1 && windows().some(w => w.handle !== 0), 60000);
    if (!ok) throw Error('previous version did not stay running'); return { oldPid: mains()[0].pid };
  });
  await report.step('Install over a RUNNING copy: refused without /FORCECLOSE (exit 5), nothing replaced', async () => {
    if (!oldInstaller) { fs.mkdirSync(installDir, { recursive: true }); const r0 = install(installer); if (r0.status !== 0) throw Error('install exit ' + r0.status); launch(exe()); await waitFor(() => mains().length === 1, 45000); }
    const before = sha256(path.join(installDir, 'resources/app.asar')), runningBefore = mains().map(p => p.pid);
    const r = install(installer);
    const data = { exitCode: r.status, stillRunning: mains().map(p => p.pid), runningBefore, asarUnchanged: sha256(path.join(installDir, 'resources/app.asar')) === before };
    if (r.status !== 5 || !data.stillRunning.length) throw Error('expected exit 5 with the application still running: ' + JSON.stringify(data));
    return data;
  });
  await report.step('Decoy: another program named "NVU PRO.exe" in a different folder must survive the upgrade', async () => {
    fs.mkdirSync(decoyDir, { recursive: true }); fs.copyFileSync(path.join(process.env.SystemRoot, 'System32', 'timeout.exe'), path.join(decoyDir, 'NVU PRO.exe'));
    launch(path.join(decoyDir, 'NVU PRO.exe'), ['/t', '600', '/nobreak']); await sleep(1500);
    return { decoyPids: processes().filter(p => p.exe && p.exe.toLowerCase().startsWith(decoyDir.toLowerCase())).map(p => p.pid) };
  });
  await report.step('Upgrade with /FORCECLOSE: only the NVU of this folder is closed; the decoy lives; files replaced', async () => {
    const decoyBefore = processes().filter(p => p.exe && p.exe.toLowerCase().startsWith(decoyDir.toLowerCase())).map(p => p.pid);
    const r = install(installer, ['/FORCECLOSE']);
    const data = { exitCode: r.status, installDirProcesses: underInstall().length, decoySurvived: processes().filter(p => p.exe && p.exe.toLowerCase().startsWith(decoyDir.toLowerCase())).length === decoyBefore.length && decoyBefore.length > 0 };
    if (r.status !== 0 || data.installDirProcesses !== 0 || !data.decoySurvived) throw Error('upgrade verification failed: ' + JSON.stringify(data));
    killTree(processes().filter(p => p.exe && p.exe.toLowerCase().startsWith(decoyDir.toLowerCase())).map(p => p.pid)); return data;
  });
  await report.step('Installed files, shortcuts and uninstall registration', () => {
    const must = ['NVU PRO.exe', 'resources/app.asar', 'resources/web/index.html', 'resources/plugin/nvu_scs_telemetry.dll', 'resources/plugin/nvu_scs_telemetry.manifest.json', 'Uninstall NVU.exe'];
    const files = Object.fromEntries(must.map(f => [f, fs.existsSync(path.join(installDir, f))])); if (Object.values(files).includes(false)) throw Error('missing: ' + JSON.stringify(files));
    const desktop = path.join(process.env.USERPROFILE, 'Desktop'), programs = path.join(process.env.APPDATA, 'Microsoft/Windows/Start Menu/Programs/NVU PRO');
    const links = [path.join(desktop, 'NVU PRO.lnk'), path.join(programs, 'NVU PRO.lnk'), path.join(programs, 'Desinstalar NVU PRO.lnk')];
    const targets = links.map(link => ({ link: path.basename(link), exists: fs.existsSync(link), target: fs.existsSync(link) ? powershell(`(New-Object -ComObject WScript.Shell).CreateShortcut('${link}').TargetPath`).stdout : '' }));
    if (targets.some(t => !t.exists)) throw Error('shortcut missing: ' + JSON.stringify(targets));
    const reg = asArray(powershellJson(`Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' | ForEach-Object { Get-ItemProperty $_.PSPath } | Where-Object { $_.DisplayName -eq 'NVU PRO' } | Select-Object DisplayName,DisplayVersion,Publisher,InstallLocation`));
    if (reg.length !== 1) throw Error('expected exactly one uninstall entry: ' + JSON.stringify(reg));
    const info = powershellJson(`$i=(Get-Item -LiteralPath '${exe()}').VersionInfo; [pscustomobject]@{product=$i.ProductName;company=$i.CompanyName;version=$i.ProductVersion;description=$i.FileDescription}`);
    if (info.product !== 'NVU PRO') throw Error('executable identity is not NVU: ' + JSON.stringify(info));
    return { files, targets, registry: reg, executable: info };
  });
  await report.step('Real versions reported by the installed application (--nvu-versions-out)', async () => {
    const file = path.join(os.tmpdir(), `nvu-versions-${label}.json`); fs.rmSync(file, { force: true });
    const r = run(exe(), [`--nvu-versions-out=${file}`], 60000); if (r.status !== 0 || !fs.existsSync(file)) throw Error('versions report failed: exit ' + r.status);
    const v = JSON.parse(fs.readFileSync(file, 'utf8')), manifest = JSON.parse(fs.readFileSync(path.join(installDir, 'resources/plugin/nvu_scs_telemetry.manifest.json'), 'utf8'));
    if (v.app.executable.toLowerCase() !== exe().toLowerCase() || !v.plugin.packaged.consistent || v.plugin.expectedVersion !== manifest.version || !v.web.ok) throw Error('inconsistent versions: ' + JSON.stringify(v));
    return { app: v.app.version, web: v.web.version, pluginExpected: v.plugin.expectedVersion, executable: v.app.executable };
  });
  await report.step('First launch: window, healthy start-up report, no dialog', async () => {
    fs.rmSync(logs, { recursive: true, force: true }); launch(exe());
    const ok = await waitFor(() => mains().length === 1 && windows().some(w => w.handle !== 0) && logLines().some(l => l.event === 'startup.complete'), 90000);
    if (!ok) throw Error('no healthy start: ' + JSON.stringify({ processes: mains(), windows: windows(), log: logLines().slice(-5) }));
    const startup = JSON.parse(fs.readFileSync(path.join(logs, 'last-startup.json'), 'utf8'));
    if (!startup.ok) throw Error('start-up report not ok: ' + JSON.stringify(startup.fatal));
    return { pid: mains()[0].pid, steps: startup.steps.map(s => `${s.id}:${s.ok ? 'ok' : s.code}`), warnings: startup.warnings };
  });
  await report.step('Second launch: decides and leaves; no second app, no window, no bootstrap side effects', async () => {
    await sleep(2000); const before = { main: mains().map(p => p.pid), windows: windows().filter(w => w.handle !== 0).length, steps: logLines().filter(l => l.event === 'startup.step_ok').length };
    const started = Date.now(), r = run(exe(), ['--nvu-no-dialogs'], 60000), elapsed = Date.now() - started;
    await sleep(2000);
    const after = { main: mains().map(p => p.pid), windows: windows().filter(w => w.handle !== 0).length, steps: logLines().filter(l => l.event === 'startup.step_ok').length };
    const lines = logLines(), data = { exitCode: r.status, elapsedMs: elapsed, before, after, lockLost: lines.some(l => l.event === 'instance.lock_lost'), result: lines.filter(l => l.event === 'instance.result').at(-1) };
    if (JSON.stringify(before.main) !== JSON.stringify(after.main) || before.windows !== after.windows || before.steps !== after.steps || !data.lockLost || elapsed > 30000) throw Error('second instance misbehaved: ' + JSON.stringify(data));
    return data;
  });
  if (oldInstaller) { /* the takeover scenario against the real previous version is covered by smoke-upgrade.cjs */ }
  await report.step('Stop the application started by this test (only processes under the install folder)', () => { const own = underInstall().map(p => p.pid); killTree(own); return { stopped: own.length }; });
  await report.step('Uninstall (silent) keeps user data and removes the program, shortcuts and registration', async () => {
    fs.mkdirSync(userData, { recursive: true }); const journal = path.join(userData, 'pro-journal.json'); if (!fs.existsSync(journal)) fs.writeFileSync(journal, JSON.stringify({ version: 1, bindings: {}, events: {} }));
    const r = spawnSync(uninstallerOf(), ['/S', `_?=${installDir}`], { timeout: 300000, windowsHide: true });
    const gone = await waitFor(() => !fs.existsSync(exe()), 60000, 1000);
    const data = { exitCode: r.status, programRemoved: !!gone, userDataKept: fs.existsSync(journal), shortcutsRemoved: !fs.existsSync(path.join(process.env.USERPROFILE, 'Desktop', 'NVU PRO.lnk')),
      registryRemoved: asArray(powershellJson(`Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' | ForEach-Object { Get-ItemProperty $_.PSPath } | Where-Object { $_.DisplayName -eq 'NVU PRO' } | Select-Object DisplayName`)).length === 0 };
    if (!data.programRemoved || !data.userDataKept || !data.shortcutsRemoved || !data.registryRemoved) throw Error('uninstall verification failed: ' + JSON.stringify(data));
    return data;
  });
  await report.step('Reinstall after uninstall (clean install) works', () => { const r = install(installer); if (r.status !== 0 || !fs.existsSync(exe())) throw Error('reinstall failed: ' + r.status); return { exitCode: r.status }; });
  report.save(path.join(out, `smoke-${label}.json`));
  process.exitCode = report.ok ? 0 : 1;
})().catch(error => { console.error(error); report.ok = false; report.save(path.join(out, `smoke-${label}.json`)); process.exitCode = 1; });
