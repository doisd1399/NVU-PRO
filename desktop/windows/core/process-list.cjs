// Finding OTHER copies of NVU PRO without ever touching a different Electron application.
// A process is "NVU" only when ALL of these hold: its image name is ours, it is a main process (no --type=), and the
// application package next to its executable is named "nvu-windows". Anything else is ignored, never closed.
const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { windowsPowerShellEnv } = require('./powershell-env.cjs');
const exec = promisify(execFile);
const PACKAGE_NAME = 'nvu-windows';

async function listProcessesByImage(imageName, run = exec) {
  if (!/^[\w .-]+\.exe$/i.test(imageName)) throw Error('PROCESS_IMAGE_INVALID');
  const script = `$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process -Filter "Name='${imageName}'" | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine) | ConvertTo-Json -Compress`;
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 8000, encoding: 'utf8', maxBuffer: 1 << 20, env: windowsPowerShellEnv() });
  const parsed = stdout.trim() ? JSON.parse(stdout) : [];
  return [parsed].flat().filter(Boolean).map(p => ({ pid: Number(p.ProcessId), parent: Number(p.ParentProcessId), exe: p.ExecutablePath || '', commandLine: p.CommandLine || '' }))
    .filter(p => Number.isSafeInteger(p.pid) && p.pid > 0);
}
const isMainProcess = p => !/(^|\s)--type=/.test(p.commandLine || '');
// Electron patches fs so that files INSIDE app.asar can be read like normal files.
const readPackageFromInstall = (dir, fsImpl = fs) => {
  try { const pkg = JSON.parse(fsImpl.readFileSync(path.join(dir, 'resources', 'app.asar', 'package.json'), 'utf8')); return { name: pkg.name, version: pkg.version }; }
  catch { return null; }
};
function identifyNvu(proc, readPackage = readPackageFromInstall) {
  if (!proc?.exe || !isMainProcess(proc)) return null;
  const dir = path.win32.dirname(proc.exe) === '.' ? path.dirname(proc.exe) : path.win32.dirname(proc.exe);
  const pkg = readPackage(dir);
  const verified = pkg?.name === PACKAGE_NAME && /(^|[\\/])NVU PRO\.exe$/i.test(proc.exe);
  return { pid: proc.pid, exe: proc.exe, dir, version: pkg?.version || null, verified };
}
function compareVersions(a, b) {
  const parse = v => String(v || '0').split(/[.+-]/).slice(0, 3).map(n => Number.parseInt(n, 10) || 0);
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1;
  return 0;
}
const sameFile = (a, b) => path.win32.normalize(String(a)).toLowerCase() === path.win32.normalize(String(b)).toLowerCase();
/** `tasklist` ships with every Windows edition and needs no PowerShell/WMI: it confirms that a PID currently runs the expected image name. */
async function pidRunsImage(pid, imageName, run = exec) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || !/^[\w .-]+\.exe$/i.test(imageName)) return false;
  try {
    const { stdout } = await run('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FI', `IMAGENAME eq ${imageName}`, '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 8000, encoding: 'utf8' });
    return stdout.split(/\r?\n/).some(line => line.toLowerCase().startsWith(`"${imageName.toLowerCase()}","${pid}"`));
  } catch { return false; }
}
/**
 * Where is the running NVU? 1) the instance file the running copy wrote (versions >= 0.2.0), confirmed by tasklist;
 * 2) the process list (older versions, which wrote nothing). Either source alone can fail; the result is the union.
 */
async function findRunningNvu({ imageName, registry, list = listProcessesByImage, confirm = pidRunsImage }) {
  const found = new Map();
  try { for (const p of await list(imageName)) found.set(p.pid, p); } catch { /* PowerShell/WMI unavailable: the instance file may still answer */ }
  const recorded = registry?.read?.();
  if (recorded && Number.isSafeInteger(recorded.pid) && !found.has(recorded.pid) && recorded.exe && await confirm(recorded.pid, imageName)) found.set(recorded.pid, { pid: recorded.pid, parent: 0, exe: recorded.exe, commandLine: '' });
  return [...found.values()];
}
const instanceRegistry = (file, fsImpl = fs) => ({
  write: self => { try { fsImpl.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.tmp`; fsImpl.writeFileSync(tmp, JSON.stringify({ pid: self.pid, exe: self.exe, version: self.version, startedAt: new Date().toISOString() })); fsImpl.renameSync(tmp, file); } catch { /* the process list still works */ } },
  read: () => { try { const data = JSON.parse(fsImpl.readFileSync(file, 'utf8')); return data && typeof data === 'object' ? data : null; } catch { return null; } },
  remove: self => { try { const data = JSON.parse(fsImpl.readFileSync(file, 'utf8')); if (data.pid === self.pid) fsImpl.unlinkSync(file); } catch { /* nothing to remove */ } },
});
module.exports = { PACKAGE_NAME, pidRunsImage, findRunningNvu, instanceRegistry, listProcessesByImage, isMainProcess, readPackageFromInstall, identifyNvu, compareVersions, sameFile };
