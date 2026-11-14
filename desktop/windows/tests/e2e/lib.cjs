// Helpers shared by the Windows end-to-end scripts. Windows-only: they use PowerShell, the registry and real processes.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { windowsPowerShellEnv } = require('../../core/powershell-env.cjs');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function sha256(file) {
  const hash = createHash('sha256'), fd = fs.openSync(file, 'r'), buffer = Buffer.alloc(1 << 20);
  try { for (let n; (n = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0;) hash.update(buffer.subarray(0, n)); } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
function powershell(script, timeout = 60000) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 16 << 20, env: windowsPowerShellEnv() });
  return { status: result.status, stdout: (result.stdout || '').trim(), stderr: (result.stderr || '').trim() };
}
function powershellJson(script, timeout) {
  const result = powershell(`$ErrorActionPreference='Stop'; ${script} | ConvertTo-Json -Compress -Depth 6`, timeout);
  if (result.status !== 0) throw Error(`PowerShell failed: ${result.stderr.slice(0, 500)}`);
  return result.stdout ? JSON.parse(result.stdout) : null;
}
const asArray = value => value == null ? [] : Array.isArray(value) ? value : [value];
function processes(exeName = 'NVU PRO.exe') {
  return asArray(powershellJson(`Get-CimInstance Win32_Process -Filter "Name='${exeName}'" | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine`))
    .map(p => ({ pid: p.ProcessId, parent: p.ParentProcessId, exe: p.ExecutablePath, main: !/--type=/.test(p.CommandLine || ''), commandLine: p.CommandLine }));
}
function windows(name = 'NVU PRO') {
  return asArray(powershellJson(`Get-Process -Name '${name}' -ErrorAction SilentlyContinue | Select-Object Id,MainWindowTitle,MainWindowHandle`))
    .map(p => ({ pid: p.Id, title: p.MainWindowTitle, handle: Number(p.MainWindowHandle) }));
}
function killTree(pids) {
  for (const pid of pids) spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
}
function launch(exe, args = [], env = {}) {
  const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false, env: { ...process.env, ...env } });
  child.unref(); return child;
}
function newReport(name) {
  const report = { name, startedAt: new Date().toISOString(), runner: { os: os.release(), arch: process.arch, node: process.version }, steps: [], ok: true };
  report.step = async (title, fn) => {
    const entry = { title, ok: true }, started = Date.now();
    try { entry.data = await fn(); } catch (error) { entry.ok = false; entry.error = String(error && error.stack || error).slice(0, 4000); report.ok = false; }
    entry.ms = Date.now() - started; report.steps.push(entry);
    console.log(`${entry.ok ? 'PASS' : 'FAIL'} ${title}${entry.ok ? '' : ' :: ' + entry.error.split('\n')[0]}`);
    return entry;
  };
  report.save = file => { report.finishedAt = new Date().toISOString(); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(report, null, 2)); };
  return report;
}
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback;
}
module.exports = { sleep, sha256, powershell, powershellJson, processes, windows, killTree, launch, newReport, arg, asArray };
